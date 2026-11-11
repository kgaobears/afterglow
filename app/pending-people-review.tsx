"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { eligiblePendingSpeakers, needsSpeakerSelection } from "./pending-people";
import type { CandidateNote, KnownContact, PendingPersonGroup, ReviewQueueEntry } from "./pending-people";
import type { FactType } from "./fact-type";
import FactTypePicker from "./fact-type-picker";
import TemporalHint from "./temporal-hint";

type ResolveInput = { gatheringId: string; personName: string; itemIds: string[]; contactId: string; newName: string };
type RejectInput = { gatheringId: string; personName: string; itemIds: string[] };
type ReviewNote = CandidateNote & { reason: string; gatheringId: string };
type ContactOption = KnownContact & { context?: string };
type Props = {
  groups: PendingPersonGroup<ReviewNote>[];
  queue: ReviewQueueEntry<ReviewNote>[];
  contacts: ContactOption[];
  gatheringId: string;
  busy: boolean;
  onResolve: (input: ResolveInput) => Promise<void>;
  onRejectPerson: (input: RejectInput) => Promise<void>;
  onApproveFact: (item: ReviewNote) => void;
  onRejectFact: (id: string) => Promise<void>;
  onAssignSpeaker: (id: string, targetId: string) => Promise<void>;
  onSetFactType: (id: string, factType: FactType) => Promise<void>;
};

function SpeakerPicker({ itemId, choices, busy, onAssignSpeaker }: {
  itemId: string;
  choices: PendingPersonGroup<ReviewNote>[];
  busy: boolean;
  onAssignSpeaker: Props["onAssignSpeaker"];
}) {
  if (!choices.length) return null;
  return <label className="speaker-picker">Speaker
    <select aria-label="Assign speaker from this gathering" defaultValue="" disabled={busy} onChange={event => { if (event.target.value) void onAssignSpeaker(itemId, event.target.value); }}>
      <option value="" disabled>Choose a pending person…</option>
      {choices.map(group => <option key={group.key} value={group.items[0].id}>{group.name}</option>)}
    </select>
  </label>;
}

function PersonRow({ group, contacts, gatheringId, busy, onResolve, onRejectPerson, speakerChoices, onAssignSpeaker }: {
  group: PendingPersonGroup<ReviewNote>;
  contacts: ContactOption[];
  gatheringId: string;
  busy: boolean;
  onResolve: Props["onResolve"];
  onRejectPerson: Props["onRejectPerson"];
  speakerChoices: PendingPersonGroup<ReviewNote>[];
  onAssignSpeaker: Props["onAssignSpeaker"];
}) {
  const unknown = group.name === "Unknown person";
  const [choice, setChoice] = useState(group.existingContactId || (group.matchCount > 1 || unknown ? "" : "new"));
  const [showContactPicker, setShowContactPicker] = useState(!!group.existingContactId || group.matchCount > 1 || unknown);
  const [saving, setSaving] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const approved = group.items.filter(item => item.status === "approved_pending_person").length;
  const remaining = group.items.length - approved;
  const identity = unknown ? "Speaker unidentified" : group.matchCount > 1 ? `${group.matchCount} possible contacts` : group.existingContactId ? "Possible existing contact" : "Potential new person";
  const input = { gatheringId, personName: group.items[0].name, itemIds: group.items.map(item => item.id) };

  async function accept() {
    setSaving(true);
    try {
      await onResolve({ ...input, contactId: choice, newName: group.name });
    } catch {
      // The gathering workspace displays the error and preserves this row.
    } finally {
      setSaving(false);
    }
  }

  async function reject() {
    setSaving(true);
    try {
      await onRejectPerson(input);
    } catch {
      // The gathering workspace displays the error and preserves this row.
    } finally {
      setSaving(false);
    }
  }

  return <div className="capture-item review-queue-person">
    <span className="status-dot pending"/>
    <div className="pending-person-main">
      <span className="review-queue-kind">PERSON</span>
      <strong>{group.name}</strong>
      <small>{identity} · {remaining} to review{approved ? ` · ${approved} approved` : ""}</small>
      {unknown && group.items.filter(item => item.status === "approved_pending_person").map(item =>
        <SpeakerPicker key={item.id} itemId={item.id} choices={speakerChoices} busy={busy || saving} onAssignSpeaker={onAssignSpeaker}/>
      )}
      {showContactPicker ? <div className="person-chooser">
        <select aria-label={`Contact for ${group.name}`} value={choice} disabled={busy || saving} onChange={event => {
          setChoice(event.target.value);
          if (event.target.value === "new") setShowContactPicker(false);
        }}>
          <option value="" disabled>Choose an existing contact…</option>
          {!unknown && <option value="new">Create new contact instead</option>}
          {contacts.map(person => <option value={person.id} key={person.id}>{person.name}{person.context ? ` · ${person.context}` : ""}</option>)}
        </select>
      </div> : <button type="button" className="person-merge-switch" disabled={busy || saving} onClick={() => {setChoice(""); setShowContactPicker(true);}}>Merge with existing contact instead</button>}
      {confirmReject ? <div className="person-reject-confirm">
        <p>Reject this person and {group.items.length} extracted {group.items.length === 1 ? "fact" : "facts"}? The original gathering note will remain saved.</p>
        <div className="person-row-actions">
          <button className="review-button" disabled={busy || saving} onClick={() => setConfirmReject(false)}>Cancel</button>
          <button className="review-button fact-reject-button" disabled={busy || saving} onClick={() => void reject()}><X size={14}/> Reject facts</button>
        </div>
      </div> : <div className="person-row-actions">
        <button className="review-button fact-approve-button" disabled={busy || saving || !choice} onClick={() => void accept()}>
          <Check size={15}/> {saving ? "Saving…" : choice === "new" ? "Create contact" : "Merge"}
        </button>
        <button className="review-button fact-reject-button" disabled={busy || saving} onClick={() => setConfirmReject(true)}><X size={15}/> Reject</button>
      </div>}
    </div>
  </div>;
}

export default function PendingPeopleReview({ groups, queue, contacts, gatheringId, busy, onResolve, onRejectPerson, onApproveFact, onRejectFact, onAssignSpeaker, onSetFactType }: Props) {
  const speakerChoices = eligiblePendingSpeakers(groups);

  return <>
    {queue.map(entry => entry.kind === "person" ?
      <PersonRow key={`person:${entry.group.key}`} group={entry.group} contacts={contacts} gatheringId={gatheringId} busy={busy}
        onResolve={onResolve} onRejectPerson={onRejectPerson} speakerChoices={speakerChoices} onAssignSpeaker={onAssignSpeaker}/> :
      <div className="capture-item review-queue-note" key={`note:${entry.item.id}`}>
        <span className="status-dot pending"/>
        <div>
          <strong>{entry.item.name.toLowerCase() === "unattributed" ? "Unknown person" : entry.item.name}</strong>
          <p>{entry.item.detail}</p>
          <TemporalHint fact={entry.item}/>
          <small>{entry.item.reason}{!entry.item.contactId ? entry.item.name.toLowerCase() === "unattributed" ? " · Speaker unknown" : " · Person not yet approved" : ""}</small>
          <FactTypePicker name={entry.item.name} value={entry.item.factType} disabled={busy}
            onChange={factType => { void onSetFactType(entry.item.id, factType).catch(() => {}); }}/>
          {needsSpeakerSelection(entry.item) && <SpeakerPicker itemId={entry.item.id} choices={speakerChoices} busy={busy} onAssignSpeaker={onAssignSpeaker}/>}
        </div>
        <div className="fact-actions">
          <button className="review-button fact-approve-button" disabled={busy} onClick={() => onApproveFact(entry.item)}><Check size={15}/> Approve</button>
          <button className="review-button fact-reject-button" disabled={busy} onClick={() => void onRejectFact(entry.item.id)}><X size={15}/> Reject</button>
        </div>
      </div>
    )}
  </>;
}
