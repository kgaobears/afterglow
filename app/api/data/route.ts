import { NextRequest, NextResponse } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { capturedItems, contacts, gatherings, moments } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";
import { validFactType } from "../../fact-type";

export const dynamic = "force-dynamic";
async function context() {
  const user = await getChatGPTUser();
  if (!user) return null;
  return { user, db: getDb() };
}
export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const [people, entries, sessions, confirmed] = await Promise.all([
    ctx.db.select().from(contacts).where(eq(contacts.ownerId, ctx.user.userId)).orderBy(desc(contacts.createdAt)),
    ctx.db.select().from(moments).where(eq(moments.ownerId, ctx.user.userId)).orderBy(desc(moments.createdAt)),
    ctx.db.select({ id: gatherings.id, title: gatherings.title, groupName: gatherings.groupName, date: gatherings.date })
      .from(gatherings).where(eq(gatherings.ownerId, ctx.user.userId)),
    ctx.db.select({ gatheringId: capturedItems.gatheringId, contactId: capturedItems.contactId })
      .from(capturedItems).where(and(eq(capturedItems.ownerId, ctx.user.userId), eq(capturedItems.status, "confirmed"))),
  ]);
  // A confirmed extracted note proves this contact was associated with this
  // conversation. Each gathering produces one marker per contact, regardless
  // of how many facts were captured or approved.
  const sessionsById = new Map(sessions.map(session => [session.id, session]));
  const uniquePairs = new Set<string>();
  const conversations = confirmed.flatMap(item => {
    if (!item.contactId) return [];
    const pair = `${item.gatheringId}:${item.contactId}`;
    if (uniquePairs.has(pair)) return [];
    uniquePairs.add(pair);
    const session = sessionsById.get(item.gatheringId);
    return session ? [{ ...session, contactId: item.contactId }] : [];
  });
  return NextResponse.json({ people, entries, conversations });
}
export async function POST(request: NextRequest) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  if (body.type === "contact") {
    const name = String(body.name || "").trim().slice(0, 120);
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
    const id = crypto.randomUUID();
    await ctx.db.insert(contacts).values({ id, ownerId: ctx.user.userId, name, context: String(body.context || "").slice(0, 200), tags: String(body.tags || "").slice(0, 200), note: String(body.note || "").slice(0, 2000), lastSeen: String(body.lastSeen || "").slice(0, 20), followUp: String(body.followUp || "").slice(0, 200), createdAt: Date.now() });
    return NextResponse.json({ id });
  }
  if (body.type === "moment") {
    const contactId = String(body.contactId || "");
    const text = String(body.body || "").trim().slice(0, 5000);
    const found = await ctx.db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.ownerId, ctx.user.userId)));
    if (!found.length || !text) return NextResponse.json({ error: "Contact and note required" }, { status: 400 });
    await ctx.db.insert(moments).values({ id: crypto.randomUUID(), ownerId: ctx.user.userId, contactId, body: text,
      factType: validFactType(body.factType) ? body.factType : "timeline",
      date: String(body.date || new Date().toISOString().slice(0, 10)).slice(0, 20), createdAt: Date.now() });
    await ctx.db.update(contacts).set({ lastSeen: String(body.date || new Date().toISOString().slice(0, 10)).slice(0, 20) }).where(and(eq(contacts.id, contactId), eq(contacts.ownerId, ctx.user.userId)));
    return NextResponse.json({ ok: true });
  }
  if (body.type === "update") {
    const id = String(body.id || "");
    const values: Record<string, string | boolean> = {};
    for (const key of ["name", "context", "tags", "note", "lastSeen", "followUp"]) if (typeof body[key] === "string") values[key] = body[key].slice(0, 2000);
    if (typeof body.favorite === "boolean") values.favorite = body.favorite;
    await ctx.db.update(contacts).set(values).where(and(eq(contacts.id, id), eq(contacts.ownerId, ctx.user.userId)));
    return NextResponse.json({ ok: true });
  }
  if (body.type === "set_fact_type") {
    const id = String(body.id || "");
    const factType = body.factType;
    if (!validFactType(factType)) return NextResponse.json({ error: "Choose Profile fact or Timeline event" }, { status: 400 });
    const updated = await ctx.db.update(moments).set({ factType }).where(and(eq(moments.id, id), eq(moments.ownerId, ctx.user.userId))).returning({ id: moments.id });
    if (!updated.length) return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    // Facts saved via the current review flow share their captured ID.
    await ctx.db.update(capturedItems).set({ factType }).where(and(eq(capturedItems.id, id), eq(capturedItems.ownerId, ctx.user.userId)));
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
