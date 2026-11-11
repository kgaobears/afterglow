"use client";

import { ArrowRight, Bookmark, CalendarDays, MessageCircle, Plus } from "lucide-react";
import { partitionContactMemories, type FactType } from "./fact-type";
import { type TemporalFields } from "./temporal-facts";
import { contactTimelinePoints, timelineDateLabel, type Conversation } from "./contact-timeline";
import TemporalHint from "./temporal-hint";

type Person = {
  id: string; name: string; context: string; tags: string; note: string;
  followUp: string; favorite: boolean;
};
type Memory = { id: string; contactId: string; body: string; date: string; factType: FactType } & TemporalFields;

const colors = ["#e8b5a6", "#afc4b5", "#c8b2d3", "#e3c79b", "#a8bfd7"];
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();

export default function ContactProfile({ person, entries, conversations, tab, onBack, onUpdate, onAddMemory, onSetFactType }: {
  person: Person;
  entries: Memory[];
  conversations: Conversation[];
  tab: string;
  onBack: () => void;
  onUpdate: (changes: Partial<Person>) => void;
  onAddMemory: (type: FactType) => void;
  onSetFactType: (id: string, type: FactType) => void;
}) {
  const { profile, timeline } = partitionContactMemories(entries.filter(entry => entry.contactId === person.id));
  const points = contactTimelinePoints(timeline, conversations);

  return <>
    <button className="back" onClick={onBack}>← Back to {tab.toLowerCase()}</button>
    <div className="profile">
      <div className="avatar large" style={{ background: colors[person.name.charCodeAt(0) % colors.length] }}>{initials(person.name)}</div>
      <div><div className="eyebrow">PERSONAL PROFILE</div><h1>{person.name}</h1><p>{person.context || "Someone worth remembering"}</p></div>
      <button className="outline-btn" onClick={() => onUpdate({ favorite: !person.favorite })}>{person.favorite ? "♥ Favorite" : "♡ Favorite"}</button>
    </div>

    <div className="columns contact-memory-columns">
      <section className="panel">
        <div className="panel-head"><h3>Profile facts</h3><button onClick={() => onAddMemory("profile")}><Plus size={13}/> Add fact</button></div>
        <p className="memory-section-intro">The lasting things to remember about {person.name.split(" ")[0]}.</p>
        {profile.map(memory => <div className="contact-memory-item" key={memory.id}>
          <Bookmark className="contact-memory-icon" size={15}/>
          <div className="contact-memory-body"><p>{memory.body}</p><TemporalHint fact={memory}/><small>Noted {memory.date}</small></div>
          <button className="contact-memory-move" title="Move to timeline" aria-label={`Move to timeline: ${memory.body}`} onClick={() => onSetFactType(memory.id, "timeline")}>Move to timeline <ArrowRight size={12}/></button>
        </div>)}
        {!profile.length && <p className="muted contact-memory-empty">Family, interests, work and other enduring details will appear here.</p>}
        <hr/>
        <h3 className="contact-notes-title">Personal notes</h3>
        <textarea className="inline-note" key={person.id + person.note} defaultValue={person.note} placeholder="Anything else you'd like to remember…" onBlur={event => { if (event.target.value !== person.note) onUpdate({ note: event.target.value }); }}/>
        <label className="field-label">HOW YOU KNOW THEM</label>
        <input className="plain-input" key={person.id + person.context} defaultValue={person.context} onBlur={event => { if (event.target.value !== person.context) onUpdate({ context: event.target.value }); }}/>
        <label className="field-label">TAGS</label>
        <input className="plain-input" key={person.id + person.tags} defaultValue={person.tags} placeholder="Friends, church, gym" onBlur={event => { if (event.target.value !== person.tags) onUpdate({ tags: event.target.value }); }}/>
      </section>
      <section className="panel">
        <div className="panel-head"><h3>Timeline</h3><button onClick={() => onAddMemory("timeline")}><Plus size={13}/> Add event</button></div>
        <p className="memory-section-intro">Life events and the times you caught up, from most recent to oldest.</p>
        {!!points.length && <div className="contact-timeline" aria-label={`Timeline of moments with ${person.name}`}>
          {points.map(point => <div className={`contact-timeline-point ${point.kind === "conversation" ? "contact-timeline-talk-point" : "contact-timeline-event-point"}`} key={point.key}>
            <div className="contact-timeline-rail" aria-hidden="true"><span className="contact-timeline-dot">{point.kind === "conversation" ? <MessageCircle size={12}/> : <CalendarDays size={12}/>}</span></div>
            <div className="contact-timeline-content">
              <div className="contact-timeline-heading"><span>{timelineDateLabel(point.date)}</span><span className={`contact-timeline-kind ${point.kind}`}>{point.kind === "conversation" ? "Talked" : "Life event"}</span></div>
              {point.kind === "conversation" ? <div className="contact-timeline-conversation"><strong>{point.conversation.title}</strong>{point.conversation.groupName && <small>{point.conversation.groupName}</small>}</div> : <div className="contact-timeline-event">
                <div className="contact-memory-body"><p>{point.memory.body}</p><TemporalHint fact={point.memory}/><small>Shared on {point.memory.date}</small></div>
                <button className="contact-memory-move" title="Move to profile facts" aria-label={`Move to profile facts: ${point.memory.body}`} onClick={() => onSetFactType(point.memory.id, "profile")}>Move to profile <ArrowRight size={12}/></button>
              </div>}
            </div>
          </div>)}
        </div>}
        {!points.length && <p className="muted contact-memory-empty">Conversations and life events will appear here as you add memories.</p>}
        <hr/>
        <label className="field-label">ASK ABOUT NEXT TIME</label>
        <textarea className="inline-note short" key={person.id + person.followUp} defaultValue={person.followUp} placeholder="How did the interview go?" onBlur={event => { if (event.target.value !== person.followUp) onUpdate({ followUp: event.target.value }); }}/>
      </section>
    </div>
  </>;
}
