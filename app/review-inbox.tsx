"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Check, Inbox } from "lucide-react";
import { useLocalProcessingQueue } from "./local-processing-provider";
import PendingPeopleReview from "./pending-people-review";
import { buildReviewSections, type InboxNote, type InboxSession } from "./review-inbox-model";

type Person = { id: string; name: string; context: string };

export default function ReviewInbox({ people, onRefresh, onOpenGathering }: {
  people: Person[];
  onRefresh: () => Promise<void>;
  onOpenGathering: (id: string) => void;
}) {
  const processing = useLocalProcessingQueue();
  const [sessions, setSessions] = useState<InboxSession[]>([]);
  const [items, setItems] = useState<InboxNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/gatherings", { cache: "no-store" });
    if (!response.ok) throw new Error("Couldn't load the review inbox");
    const data = await response.json() as { sessions: InboxSession[]; items: InboxNote[] };
    setSessions(data.sessions);
    setItems(data.items);
    setError("");
    setLoading(false);
  }

  useEffect(() => { void load().catch(cause => { setLoading(false); setError(String(cause)); }); }, [processing.revision, processing.reviewCount]);

  async function action(payload: Record<string, unknown>, refreshContacts = false) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/gatherings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { status?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "Couldn't save review decision");
      await load();
      void processing.refresh().catch(() => {});
      if (refreshContacts) await onRefresh();
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    } finally { setBusy(false); }
  }

  const sections = buildReviewSections(sessions, items, people);
  const count = sections.reduce((sum, section) => sum + section.count, 0);

  return <div className="review-inbox-page">
    <div className="section-heading">
      <div><div className="eyebrow">THE LITTLE THINGS, SORTED</div><h1>Review {count > 0 && <span>({count})</span>}</h1><p>One place to check the people and memories Afterglow found.</p></div>
      {count > 0 && <span className="count-pill">{count} awaiting review</span>}
    </div>
    {error && <div className="error" role="alert">{error} <button onClick={() => void load().catch(cause => setError(String(cause)))}>Retry loading</button></div>}
    {loading ? <section className="panel"><p className="muted">Opening your review inbox…</p></section> : error ? null : sections.length ?
      <div className="review-inbox-sections">
        {sections.map(section => <section className="panel review-inbox-gathering" key={section.session.id}>
          <div className="review-inbox-gathering-heading">
            <div><div className="eyebrow">{section.session.date}{section.session.groupName ? ` · ${section.session.groupName.toUpperCase()}` : ""}</div><h3>{section.session.title}</h3></div>
            <button type="button" className="review-inbox-source-link" onClick={() => onOpenGathering(section.session.id)}>View gathering <ArrowRight size={14}/></button>
          </div>
          <div className="review-inbox-meta">
            <span>{section.count} {section.count === 1 ? "item" : "items"} to review</span>
            {section.confident.length > 1 && <button className="review-button fact-approve-button" disabled={busy} onClick={() => { void action({ action: "confirm", ids: section.confident.map(item => item.id) }, true).catch(() => {}); }}><Check size={14}/> Approve {section.confident.length} confident matches</button>}
          </div>
          <PendingPeopleReview
            groups={section.groups} queue={section.queue} contacts={people} gatheringId={section.session.id} busy={busy}
            onResolve={async input => { await action({ action: "resolve_person", ...input }, true); }}
            onRejectPerson={async input => { await action({ action: "reject_person", ...input }); }}
            onApproveFact={item => { void action({ action: "approve_fact", id: item.id }, true).catch(() => {}); }}
            onRejectFact={async id => { await action({ action: "dismiss", id }); }}
            onAssignSpeaker={async (id, targetId) => { await action({ action: "assign_speaker", id, targetId }); }}
            onSetFactType={async (id, factType) => { await action({ action: "set_fact_type", id, factType }); }}
          />
        </section>)}
      </div> : <section className="panel review-inbox-empty">
        <div className="review-inbox-empty-icon"><Inbox size={24}/></div>
        <h3>You're all caught up.</h3>
        <p>When the local AI finishes organizing a gathering, its people and facts will appear here for your approval.</p>
      </section>}
  </div>;
}
