import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq, inArray, lt, or } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { capturedItems, contacts, gatherings, moments } from "../../../db/schema";
import { inferFactType, validFactType } from "../../fact-type";
import { sanitizeTemporalPayload } from "../../temporal-facts";
import { protectCapturedItem, suppressReprocessedFact } from "../../reprocess-policy";

export const dynamic = "force-dynamic";
type Contact = typeof contacts.$inferSelect;
const STALE_JOB_MS = 90_000;
function storedTiming(item: typeof capturedItems.$inferSelect) {
  return {
    temporalNature: item.temporalNature, timeStart: item.timeStart, timeEnd: item.timeEnd,
    timePrecision: item.timePrecision, timeCertainty: item.timeCertainty, timeExpression: item.timeExpression,
  };
}

// Conservative local extraction: exact/unique names are actionable, anything
// uncertain is left for review. A model-backed extractor can replace this later.
function extract(raw: string, people: Contact[]) {
  const fragments = raw.split(/\n+/).flatMap(line => {
    const clean = line.replace(/^\s*[-*•]\s*/, "").trim();
    if (!clean) return [];
    if (/^[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?\s*[-–—:]\s*/u.test(clean)) return [clean];
    return clean.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);
  });
  const ignored = new Set(["At", "In", "On", "The", "We", "I", "It", "Today", "Yesterday", "Last", "After", "Church", "Small", "Met", "Talked", "Someone", "His", "Her", "Their", "My"]);
  return fragments.map(original => {
    const fragment = original.replace(/^([A-Z][\p{L}'-]+)'s\s+/u, "$1 mentioned ");
    const m = fragment.match(/^([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?)(?:\s*[-–—:]\s*|\s+(?:said|mentioned|told|is|was|has|had|got|started|will|plans|-'s|'s)\s+)(.+)$/u);
    const name = m && !ignored.has(m[1].split(" ")[0]) ? m[1].trim() : "";
    const detail = m ? m[2].trim() : original;
    const factType = inferFactType(detail);
    if (!name) return { name: "Unattributed", detail: original, factType, contactId: null, status: "needs_review", reason: "Who shared this?" };
    const normalized = name.toLowerCase();
    const exact = people.filter(p => p.name.toLowerCase() === normalized);
    const matching = exact.length ? exact : people.filter(p => p.name.split(/\s+/)[0].toLowerCase() === normalized);
    const vagueDate = /\b(next|last)\s+(?:week|month|year)|\b(sometime|recently|tomorrow)\b/i.test(detail);
    const unclear = /^(?:his|her|their)\b/i.test(detail) || /\b(?:he|she|they)\s+said\b/i.test(detail);
    if (matching.length !== 1 || vagueDate || unclear) {
      const reason = matching.length > 1 ? "Multiple possible contacts" : !matching.length ? "New person — review later" : vagueDate ? "Check the date" : "Check who this refers to";
      return { name, detail, factType, contactId: matching.length === 1 ? matching[0].id : null, status: "needs_review", reason };
    }
    return { name, detail, factType, contactId: matching[0].id, status: "ready", reason: "Matched confidently" };
  });
}

async function getContext() {
  const user = await getChatGPTUser();
  return user ? { ownerId: user.userId, db: getDb() } : null;
}

export async function GET() {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const [sessions, items] = await Promise.all([
    ctx.db.select().from(gatherings).where(eq(gatherings.ownerId, ctx.ownerId)).orderBy(desc(gatherings.createdAt)),
    ctx.db.select().from(capturedItems).where(eq(capturedItems.ownerId, ctx.ownerId)).orderBy(desc(capturedItems.createdAt)),
  ]);
  return NextResponse.json({ sessions, items });
}

export async function POST(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const data = await req.json() as Record<string, unknown>;
  if (data.action === "capture") {
    const raw = String(data.rawText || "").trim().slice(0, 25000);
    if (!raw) return NextResponse.json({ error: "Write a few notes first" }, { status: 400 });
    const title = String(data.title || "Untitled gathering").trim().slice(0, 160);
    const groupName = String(data.groupName || "").trim().slice(0, 120);
    const date = String(data.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const people = await ctx.db.select().from(contacts).where(eq(contacts.ownerId, ctx.ownerId));
    const extracted = extract(raw, people);
    const id = crypto.randomUUID();
    await ctx.db.insert(gatherings).values({ id, ownerId: ctx.ownerId, title, groupName, date, rawText: raw, createdAt: Date.now(), processingStatus: "queued", processingPhase: "Waiting for on-device AI", processingUpdatedAt: Date.now() });
    if (extracted.length) await ctx.db.insert(capturedItems).values(extracted.map((item, i) => ({ id: crypto.randomUUID(), ownerId: ctx.ownerId, gatheringId: id, ...item, createdAt: Date.now() + i })));
    return NextResponse.json({ id });
  }
  if (data.action === "queue_claim") {
    const now = Date.now();
    const eligible = await ctx.db.select().from(gatherings).where(and(eq(gatherings.ownerId, ctx.ownerId), or(
      eq(gatherings.processingStatus, "queued"),
      and(eq(gatherings.processingStatus, "processing"), lt(gatherings.processingUpdatedAt, now - STALE_JOB_MS)),
    ))).orderBy(asc(gatherings.createdAt)).limit(8);
    // The conditional update is an atomic lease. Only one open tab/device can
    // claim this gathering; a suspended iPhone tab eventually loses its lease.
    for (const candidate of eligible) {
      const token = crypto.randomUUID();
      const condition = candidate.processingStatus === "queued" ? eq(gatherings.processingStatus, "queued") : and(
        eq(gatherings.processingStatus, "processing"), eq(gatherings.processingUpdatedAt, candidate.processingUpdatedAt),
      );
      const claimed = await ctx.db.update(gatherings).set({ processingStatus: "processing", processingPhase: "Loading on-device model", processingUpdatedAt: now, processingToken: token, processingError: "", processingAttempt: candidate.processingAttempt + 1 })
        .where(and(eq(gatherings.id, candidate.id), eq(gatherings.ownerId, ctx.ownerId), condition)).returning({ id: gatherings.id });
      if (claimed.length) return NextResponse.json({ job: { ...candidate, processingStatus: "processing", processingToken: token } });
    }
    return NextResponse.json({ job: null });
  }
  if (["queue_heartbeat", "queue_checkpoint", "queue_release", "queue_fail"].includes(String(data.action))) {
    const id = String(data.id || ""), token = String(data.token || "");
    if (!id || !token) return NextResponse.json({ error: "Missing processing lease" }, { status: 400 });
    const where = and(eq(gatherings.id, id), eq(gatherings.ownerId, ctx.ownerId), eq(gatherings.processingStatus, "processing"), eq(gatherings.processingToken, token));
    const now = Date.now();
    let changes: Partial<typeof gatherings.$inferInsert> = { processingUpdatedAt: now };
    if (data.action === "queue_checkpoint") {
      const checkpoint = JSON.stringify(data.checkpoint ?? {});
      if (checkpoint.length > 250_000 || !data.checkpoint || typeof data.checkpoint !== "object") return NextResponse.json({ error: "Invalid checkpoint" }, { status: 400 });
      changes = { ...changes, processingCheckpoint: checkpoint, processingPhase: String(data.phase || "Processing").slice(0, 140) };
    } else if (data.action === "queue_release") {
      changes = { ...changes, processingStatus: "queued", processingToken: null, processingPhase: "Interrupted — resume when active" };
    } else if (data.action === "queue_fail") {
      changes = { ...changes, processingStatus: "failed", processingToken: null, processingPhase: "Needs attention", processingError: String(data.error || "Processing failed").slice(0, 500) };
    }
    const updated = await ctx.db.update(gatherings).set(changes).where(where).returning({ id: gatherings.id });
    return updated.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Processing lease expired" }, { status: 409 });
  }
  if (data.action === "queue_retry") {
    const id = String(data.id || "");
    const [session] = await ctx.db.select().from(gatherings).where(and(eq(gatherings.id, id), eq(gatherings.ownerId, ctx.ownerId)));
    if (!session) return NextResponse.json({ error: "Gathering not found" }, { status: 404 });
    if (session.processingStatus === "processing" && session.processingUpdatedAt >= Date.now() - STALE_JOB_MS) return NextResponse.json({ error: "This gathering is already being processed" }, { status: 409 });
    await ctx.db.update(gatherings).set({ processingStatus: "queued", processingPhase: "Waiting for on-device AI", processingUpdatedAt: Date.now(), processingToken: null, processingError: "", processingCheckpoint: "", processingAttempt: 0,
      reconsiderRejected: data.reconsiderRejected === true,
    }).where(and(eq(gatherings.id, id), eq(gatherings.ownerId, ctx.ownerId)));
    return NextResponse.json({ queued: true });
  }
  if (data.action === "enrich") {
    const id = String(data.id || "");
    const [session] = await ctx.db.select().from(gatherings).where(and(eq(gatherings.id, id), eq(gatherings.ownerId, ctx.ownerId)));
    if (!session) return NextResponse.json({ error: "Gathering not found" }, { status: 404 });
    const processingToken = String(data.processingToken || "");
    if ((processingToken && (session.processingStatus !== "processing" || session.processingToken !== processingToken)) ||
      (!processingToken && session.processingStatus === "processing")) return NextResponse.json({ error: "Processing lease expired" }, { status: 409 });
    const proposed = Array.isArray(data.memories) ? data.memories.slice(0, 40) : [];
    const norm = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
    const [people, existing] = await Promise.all([
      ctx.db.select().from(contacts).where(eq(contacts.ownerId, ctx.ownerId)),
      ctx.db.select().from(capturedItems).where(and(eq(capturedItems.ownerId, ctx.ownerId), eq(capturedItems.gatheringId, id))),
    ]);
    // Keep facts the user has already approved even if they are waiting for a
    // person to be identified. Re-running local AI must not erase that choice.
    const protectedItems = existing.filter(x => protectCapturedItem(x.status));
    const seen = new Set(protectedItems.filter(x => suppressReprocessedFact(x.status, session.reconsiderRejected)).map(x => `${norm(x.name)}|${norm(x.detail)}`));
    const valid: Array<typeof capturedItems.$inferInsert> = [];
    for (const entry of proposed) {
      if (!entry || typeof entry !== "object") continue;
      const proposal = entry as Record<string, unknown>;
      const name = String(proposal.name || "Unattributed").trim().slice(0, 120);
      const proposedDetail = String(proposal.detail || "").trim().slice(0, 1000);
      const quote = String(proposal.quote || "").trim().slice(0, 800);
      if (!proposedDetail) continue;
      // The detail is the atomic note. A literal source quotation is optional;
      // confidence comes from the separate on-device verification pass.
      const detail = proposedDetail;
      const dedupeKey = `${norm(name)}|${norm(detail)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const exact = people.filter(p => norm(p.name) === norm(name));
      const matched = exact.length ? exact : people.filter(p => norm(p.name.split(/\s+/)[0]) === norm(name));
      const unattributed = !name || name === "Unattributed";
      const dateRisk = /\b(?:next|last|this|past)\s+(?:weekend|week|month|year)\b|\b(?:sometime|recently|tomorrow|yesterday)\b/i.test(detail);
      const namedInSuggestion = people.filter(p => new RegExp(`\\b${p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(`${detail} ${quote}`));
      const multiPersonQuote = new Set(namedInSuggestion.map(p => p.id)).size > 1;
      const unverified = proposal.verification !== "verified";
      // New-contact identity is a separate review item. A verified memory can
      // remain ready even before its proposed person has been linked.
      const uncertain = unattributed || matched.length > 1 || dateRisk || multiPersonQuote || unverified;
      valid.push({ id: crypto.randomUUID(), ownerId: ctx.ownerId, gatheringId: id, name: name || "Unattributed", detail,
        factType: inferFactType(detail, proposal.factType),
        ...sanitizeTemporalPayload(proposal, detail, session.rawText, session.date),
        contactId: matched.length === 1 ? matched[0].id : null, status: uncertain ? "needs_review" : "ready",
        reason: unattributed ? "Attribution uncertain" : matched.length > 1 ? "Multiple possible contacts" : multiPersonQuote ? "Multiple people mentioned — check attribution" : dateRisk ? "Check the date" : unverified ? "AI verification inconclusive — check this memory" : !matched.length ? "Potential new person — confirm identity" : "Matched and checked by local AI", createdAt: Date.now() + valid.length });
    }
    if (!valid.length && protectedItems.length) {
      // A rerun whose proposals are all already approved or rejected is a
      // successful no-op. It must not resurrect a declined suggestion.
      if (processingToken) {
        const completed = await ctx.db.update(gatherings).set({ processingStatus: "completed", processingPhase: "Ready for review", processingUpdatedAt: Date.now(), processingToken: null, processingCheckpoint: "", processingError: "", reconsiderRejected: false })
          .where(and(eq(gatherings.id, id), eq(gatherings.ownerId, ctx.ownerId), eq(gatherings.processingStatus, "processing"), eq(gatherings.processingToken, processingToken))).returning({ id: gatherings.id });
        if (!completed.length) return NextResponse.json({ error: "Processing lease expired" }, { status: 409 });
      }
      return NextResponse.json({ extracted: 0, pending: 0, peoplePending: 0 });
    }
    if (!valid.length) return NextResponse.json({ error: "No usable memories were returned. Your original note is safe." }, { status: 422 });
    if (processingToken) {
      const lease = await ctx.db.update(gatherings).set({ processingUpdatedAt: Date.now(), processingPhase: "Saving memories" })
        .where(and(eq(gatherings.id, id), eq(gatherings.ownerId, ctx.ownerId), eq(gatherings.processingStatus, "processing"), eq(gatherings.processingToken, processingToken))).returning({ id: gatherings.id });
      if (!lease.length) return NextResponse.json({ error: "Processing lease expired" }, { status: 409 });
    }
    const replace = existing.filter(x => !protectCapturedItem(x.status));
    if (replace.length) await ctx.db.delete(capturedItems).where(and(eq(capturedItems.ownerId, ctx.ownerId), inArray(capturedItems.id, replace.map(x => x.id))));
    await ctx.db.insert(capturedItems).values(valid);
    if (processingToken) await ctx.db.update(gatherings).set({ processingStatus: "completed", processingPhase: "Ready for review", processingUpdatedAt: Date.now(), processingToken: null, processingCheckpoint: "", processingError: "", reconsiderRejected: false }).where(and(eq(gatherings.id, id), eq(gatherings.ownerId, ctx.ownerId), eq(gatherings.processingToken, processingToken)));
    const peoplePending = new Set(valid.filter(x => !x.contactId && x.name !== "Unattributed").map(x => x.name.trim().toLowerCase())).size;
    return NextResponse.json({ extracted: valid.length, pending: valid.filter(x => x.status === "needs_review").length, peoplePending });
  }
  if (data.action === "confirm") {
    const ids = Array.isArray(data.ids) ? data.ids.filter((v): v is string => typeof v === "string").slice(0, 200) : [];
    if (!ids.length) return NextResponse.json({ error: "Nothing selected" }, { status: 400 });
    const items = await ctx.db.select().from(capturedItems).where(and(eq(capturedItems.ownerId, ctx.ownerId), inArray(capturedItems.id, ids)));
    const ready = items.filter(item => item.status === "ready" && item.contactId);
    const validContacts = await ctx.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.ownerId, ctx.ownerId));
    const valid = new Set(validContacts.map(p => p.id));
    const validReady = ready.filter(x => x.contactId && valid.has(x.contactId));
    const sessionIds = [...new Set(validReady.map(x => x.gatheringId))];
    const sessions = sessionIds.length ? await ctx.db.select().from(gatherings).where(and(eq(gatherings.ownerId, ctx.ownerId), inArray(gatherings.id, sessionIds))) : [];
    const byId = new Map(sessions.map(s => [s.id, s]));
    for (const item of validReady) {
      const session = byId.get(item.gatheringId);
      if (!session || !item.contactId) continue;
      await ctx.db.insert(moments).values({ id: item.id, ownerId: ctx.ownerId, contactId: item.contactId, body: item.detail, factType: item.factType, ...storedTiming(item), date: session.date, createdAt: Date.now() }).onConflictDoNothing();
      await ctx.db.update(capturedItems).set({ status: "confirmed", reason: "Saved to person" }).where(and(eq(capturedItems.id, item.id), eq(capturedItems.ownerId, ctx.ownerId)));
    }
    return NextResponse.json({ confirmed: validReady.length });
  }
  if (data.action === "dismiss") {
    const id = String(data.id || "");
    const [item] = await ctx.db.select().from(capturedItems).where(and(eq(capturedItems.id, id), eq(capturedItems.ownerId, ctx.ownerId)));
    if (!item || item.status === "confirmed") return NextResponse.json({ error: "Suggestion unavailable" }, { status: 404 });
    // A rejected suggestion must stay rejected even if the queued local model
    // finishes later or an extraction is retried.
    await ctx.db.update(capturedItems).set({ status: "rejected", reason: "Fact rejected" }).where(and(eq(capturedItems.id, id), eq(capturedItems.ownerId, ctx.ownerId)));
    return NextResponse.json({ dismissed: true });
  }
  if (data.action === "set_fact_type") {
    const id = String(data.id || "");
    const factType = data.factType;
    if (!validFactType(factType)) return NextResponse.json({ error: "Choose Profile fact or Timeline event" }, { status: 400 });
    const updated = await ctx.db.update(capturedItems).set({ factType }).where(and(
      eq(capturedItems.id, id), eq(capturedItems.ownerId, ctx.ownerId),
      inArray(capturedItems.status, ["ready", "needs_review", "approved_pending_person"]),
    )).returning({ id: capturedItems.id });
    return updated.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Fact unavailable for editing" }, { status: 404 });
  }
  if (data.action === "approve_fact") {
    const id = String(data.id || "");
    const [item] = await ctx.db.select().from(capturedItems).where(and(eq(capturedItems.id, id), eq(capturedItems.ownerId, ctx.ownerId)));
    if (!item || item.status === "confirmed" || item.status === "approved_pending_person" || item.status === "rejected") return NextResponse.json({ error: "Fact unavailable for approval" }, { status: 404 });
    const [session] = await ctx.db.select().from(gatherings).where(and(eq(gatherings.id, item.gatheringId), eq(gatherings.ownerId, ctx.ownerId)));
    if (!session) return NextResponse.json({ error: "Gathering not found" }, { status: 404 });

    let contactId = item.contactId;
    let contactName = item.name;
    const chosen = String(data.contactId || "");
    if (!contactId && chosen) {
      if (chosen === "new") {
        const name = String(data.newName || item.name).trim().slice(0, 120);
        if (!name || name.toLowerCase() === "unattributed") return NextResponse.json({ error: "Enter a person's name" }, { status: 400 });
        contactId = crypto.randomUUID();
        contactName = name;
        await ctx.db.insert(contacts).values({ id: contactId, ownerId: ctx.ownerId, name, context: session.groupName, createdAt: Date.now() });
      } else {
        const [found] = await ctx.db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(and(eq(contacts.id, chosen), eq(contacts.ownerId, ctx.ownerId)));
        if (!found) return NextResponse.json({ error: "Select a person" }, { status: 400 });
        contactId = found.id;
        contactName = found.name;
      }
    }
    if (contactId) {
      const [found] = await ctx.db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.ownerId, ctx.ownerId)));
      if (!found) return NextResponse.json({ error: "Contact unavailable" }, { status: 404 });
      contactName = found.name;
      // Reusing the captured note ID makes retries idempotent if a write is interrupted.
      await ctx.db.insert(moments).values({ id: item.id, ownerId: ctx.ownerId, contactId, body: item.detail, factType: item.factType, ...storedTiming(item), date: session.date, createdAt: Date.now() }).onConflictDoNothing();
      await ctx.db.update(capturedItems).set({ contactId, name: contactName, status: "confirmed", reason: "Approved and saved" }).where(and(eq(capturedItems.id, item.id), eq(capturedItems.ownerId, ctx.ownerId)));
      return NextResponse.json({ status: "confirmed" });
    }
    // The contact decision always happens on the person row. This includes
    // ambiguous names and facts whose speaker has not yet been identified.
    await ctx.db.update(capturedItems).set({ status: "approved_pending_person", reason: "Fact approved — awaiting person" }).where(and(eq(capturedItems.id, item.id), eq(capturedItems.ownerId, ctx.ownerId)));
    return NextResponse.json({ status: "approved_pending_person" });
  }
  if (data.action === "assign_speaker") {
    const id = String(data.id || "");
    const targetId = String(data.targetId || "");
    const [source, target] = await Promise.all([
      ctx.db.select().from(capturedItems).where(and(eq(capturedItems.id, id), eq(capturedItems.ownerId, ctx.ownerId))),
      ctx.db.select().from(capturedItems).where(and(eq(capturedItems.id, targetId), eq(capturedItems.ownerId, ctx.ownerId))),
    ]);
    const fact = source[0], proposedPerson = target[0];
    const name = proposedPerson?.name.trim() || "";
    if (!fact || fact.status === "confirmed" || fact.status === "rejected" || !proposedPerson || fact.gatheringId !== proposedPerson.gatheringId || proposedPerson.contactId || proposedPerson.status === "confirmed" || proposedPerson.status === "rejected" || !name || name.toLowerCase() === "unattributed") {
      return NextResponse.json({ error: "Choose a pending person from this gathering" }, { status: 400 });
    }
    const approved = fact.status === "approved_pending_person";
    await ctx.db.update(capturedItems).set({ name, contactId: null,
      status: approved ? "approved_pending_person" : "needs_review",
      reason: approved ? "Fact approved — awaiting person" : "Speaker selected from this gathering — approve or reject",
    }).where(and(eq(capturedItems.id, fact.id), eq(capturedItems.ownerId, ctx.ownerId)));
    return NextResponse.json({ assigned: true });
  }
  if (data.action === "resolve_person") {
    const gatheringId = String(data.gatheringId || "");
    const personName = String(data.personName || "").trim().slice(0, 120);
    const normalizeName = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
    const anonymous = normalizeName(personName) === "unattributed";
    const itemIds = Array.isArray(data.itemIds) ? data.itemIds.filter((value): value is string => typeof value === "string").slice(0, 40) : [];
    if (!personName || (anonymous && itemIds.length !== 1)) return NextResponse.json({ error: "Select a proposed person" }, { status: 400 });
    const [session] = await ctx.db.select().from(gatherings).where(and(eq(gatherings.id, gatheringId), eq(gatherings.ownerId, ctx.ownerId)));
    if (!session) return NextResponse.json({ error: "Gathering not found" }, { status: 404 });
    const all = await ctx.db.select().from(capturedItems).where(and(eq(capturedItems.ownerId, ctx.ownerId), eq(capturedItems.gatheringId, gatheringId)));
    const pending = all.filter(item => item.contactId === null && item.status !== "confirmed" && item.status !== "rejected" && normalizeName(item.name) === normalizeName(personName) && (!anonymous || item.id === itemIds[0]));
    if (!pending.length) return NextResponse.json({ error: "No pending memories for this person" }, { status: 404 });
    const chosen = String(data.contactId || "");
    if (chosen === "unattributed") {
      for (const item of pending) await ctx.db.update(capturedItems).set({ name: "Unattributed", contactId: null, status: "needs_review", reason: "Identity not confirmed — review this memory" }).where(and(eq(capturedItems.id, item.id), eq(capturedItems.ownerId, ctx.ownerId)));
      return NextResponse.json({ linked: pending.length, result: "unattributed" });
    }
    let contactId = chosen;
    let resolvedName = personName;
    if (chosen === "new") {
      const name = String(data.newName || personName).trim().slice(0, 120);
      if (!name || normalizeName(name) === "unattributed") return NextResponse.json({ error: "Enter a person's name" }, { status: 400 });
      contactId = crypto.randomUUID();
      resolvedName = name;
      await ctx.db.insert(contacts).values({ id: contactId, ownerId: ctx.ownerId, name, context: session.groupName, createdAt: Date.now() });
    } else {
      const [contact] = await ctx.db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(and(eq(contacts.id, chosen), eq(contacts.ownerId, ctx.ownerId)));
      if (!contact) return NextResponse.json({ error: "Select an existing person" }, { status: 400 });
      resolvedName = contact.name;
    }
    for (const item of pending) {
      if (item.status === "approved_pending_person") {
        await ctx.db.insert(moments).values({ id: item.id, ownerId: ctx.ownerId, contactId, body: item.detail, factType: item.factType, ...storedTiming(item), date: session.date, createdAt: Date.now() }).onConflictDoNothing();
        await ctx.db.update(capturedItems).set({ contactId, name: resolvedName, status: "confirmed", reason: "Approved and saved" }).where(and(eq(capturedItems.id, item.id), eq(capturedItems.ownerId, ctx.ownerId)));
      } else {
        await ctx.db.update(capturedItems).set({ contactId, name: resolvedName,
          reason: item.status === "ready" ? "Person confirmed — ready to save" : item.reason === "New person — review later" ? "Check this memory before saving" : item.reason,
        }).where(and(eq(capturedItems.id, item.id), eq(capturedItems.ownerId, ctx.ownerId)));
      }
    }
    return NextResponse.json({ linked: pending.length, contactId });
  }
  if (data.action === "reject_person") {
    const gatheringId = String(data.gatheringId || "");
    const personName = String(data.personName || "").trim().slice(0, 120);
    const normalizeName = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
    const anonymous = normalizeName(personName) === "unattributed";
    const itemIds = Array.isArray(data.itemIds) ? data.itemIds.filter((value): value is string => typeof value === "string").slice(0, 40) : [];
    if (!personName || (anonymous && itemIds.length !== 1)) return NextResponse.json({ error: "Select a pending person" }, { status: 400 });
    const [session] = await ctx.db.select({ id: gatherings.id }).from(gatherings).where(and(eq(gatherings.id, gatheringId), eq(gatherings.ownerId, ctx.ownerId)));
    if (!session) return NextResponse.json({ error: "Gathering not found" }, { status: 404 });
    const all = await ctx.db.select().from(capturedItems).where(and(eq(capturedItems.ownerId, ctx.ownerId), eq(capturedItems.gatheringId, gatheringId)));
    const pending = all.filter(item => !item.contactId && item.status !== "confirmed" && item.status !== "rejected" && normalizeName(item.name) === normalizeName(personName) && (!anonymous || item.id === itemIds[0]));
    if (!pending.length) return NextResponse.json({ error: "Person proposal unavailable" }, { status: 404 });
    // Soft-reject the proposed person and associated unsaved facts. The user's
    // original gathering text stays untouched, and re-extraction won't revive
    // the rejected suggestions unexpectedly.
    for (const item of pending) await ctx.db.update(capturedItems).set({ status: "rejected", reason: "Person proposal rejected" }).where(and(eq(capturedItems.id, item.id), eq(capturedItems.ownerId, ctx.ownerId)));
    return NextResponse.json({ rejected: pending.length });
  }
  if (data.action === "review_note") {
    const id = String(data.id || "");
    const [item] = await ctx.db.select().from(capturedItems).where(and(eq(capturedItems.id, id), eq(capturedItems.ownerId, ctx.ownerId)));
    if (!item || item.status === "confirmed" || item.contactId) return NextResponse.json({ error: "Pending note unavailable" }, { status: 404 });
    const name = String(data.name || "").replace(/\s+/g, " ").trim().slice(0, 120);
    const detail = String(data.detail || "").trim().slice(0, 5000);
    if (!name || !detail) return NextResponse.json({ error: "A person and a memory are required" }, { status: 400 });
    const unattributed = name.toLowerCase() === "unattributed";
    await ctx.db.update(capturedItems).set({ name, detail,
      status: unattributed ? "needs_review" : "ready",
      reason: unattributed ? "Who shared this?" : "Memory reviewed — person still pending",
    }).where(and(eq(capturedItems.id, id), eq(capturedItems.ownerId, ctx.ownerId)));
    return NextResponse.json({ ok: true });
  }
  if (data.action === "resolve") {
    const id = String(data.id || "");
    const [item] = await ctx.db.select().from(capturedItems).where(and(eq(capturedItems.id, id), eq(capturedItems.ownerId, ctx.ownerId)));
    if (!item || item.status === "confirmed") return NextResponse.json({ error: "Item unavailable" }, { status: 404 });
    const chosen = String(data.contactId || "");
    let contactId = chosen;
    if (chosen === "new") {
      const name = String(data.name || item.name).trim().slice(0, 120);
      if (!name || name === "Unattributed") return NextResponse.json({ error: "Enter a name" }, { status: 400 });
      contactId = crypto.randomUUID();
      const [session] = await ctx.db.select().from(gatherings).where(and(eq(gatherings.id, item.gatheringId), eq(gatherings.ownerId, ctx.ownerId)));
      await ctx.db.insert(contacts).values({ id: contactId, ownerId: ctx.ownerId, name, context: session?.groupName || "", createdAt: Date.now() });
    } else {
      const [found] = await ctx.db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, chosen), eq(contacts.ownerId, ctx.ownerId)));
      if (!found) return NextResponse.json({ error: "Select a person" }, { status: 400 });
    }
    const detail = String(data.detail || item.detail).trim().slice(0, 5000);
    if (!detail) return NextResponse.json({ error: "Memory can't be empty" }, { status: 400 });
    await ctx.db.update(capturedItems).set({ contactId, detail, status: "ready", reason: "Reviewed match" }).where(and(eq(capturedItems.id, id), eq(capturedItems.ownerId, ctx.ownerId)));
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
