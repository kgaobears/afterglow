"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Check, ClipboardList, Plus, Sparkles, X } from "lucide-react";
import type { ModelChoice } from "./local-inference";
import LocalDiagnosticsPanel from "./local-diagnostics-panel";
import { ProcessingQueueControls, useLocalProcessingQueue } from "./local-processing-provider";
import { processingLabel, type ProcessingJob } from "./processing-queue";
import PendingPeopleReview from "./pending-people-review";
import { buildUnifiedReviewQueue, groupPotentialPeople, partitionNotesForReview } from "./pending-people";
import type { FactType } from "./fact-type";
import FactTypePicker from "./fact-type-picker";
import TemporalHint from "./temporal-hint";
import type { TemporalFields } from "./temporal-facts";

type Person = { id:string;name:string;context:string;followUp:string;lastSeen:string };
type Session = ProcessingJob & { groupName:string;date:string };
type Item = { id:string;gatheringId:string;name:string;detail:string;factType?:FactType;contactId:string|null;status:string;reason:string } & TemporalFields;
type Props = { people:Person[]; onRefresh:()=>Promise<void>; initialSelection?:string|null };

function LocalAISection({ session, onRetry }: { session: Session; onRetry: (id: string) => Promise<void> }) {
 const queue=useLocalProcessingQueue();
 const job=queue.jobs.find(item=>item.id===session.id)||session;
 const working=queue.activeId===session.id;
 const waiting=job.processingStatus==="queued"||job.processingStatus==="processing";
 const buttonLabel=job.processingStatus==="failed"?"Retry processing":job.processingStatus==="completed"?"Reprocess note":"Queue for processing";
 const showRetry=!waiting;
 return <section className="panel local-ai-panel">
   <div><div className="eyebrow">PRIVATE ON-DEVICE EXTRACTION</div><h3>Automatic local AI</h3><p>Gatherings join a persistent queue as soon as you save them. While Afterglow is open, the local model extracts, verifies, classifies and dates individual memories one gathering at a time. If your iPhone locks or the app closes, work resumes when you return. Keep your iPhone awake during processing; the first run may need to download a 1–2 GB model. No online LLM is used.</p></div>
   <div className="local-ai-controls"><label>Model<select value={queue.modelChoice} onChange={e=>queue.setModelChoice(e.target.value as ModelChoice)}><option value="quality">Higher accuracy · 1.5B</option><option value="light">Lightweight · 0.5B</option></select></label>
     {showRetry&&<button className="primary-btn" onClick={()=>void onRetry(session.id)}><Sparkles size={16}/> {buttonLabel}</button>}
     <span className={`queue-job-status queue-job-${job.processingStatus}`}>{processingLabel(job)}</span>
   </div>
   {working&&queue.progress&&<div className="local-progress" role="status">{queue.progress.fraction!==undefined&&<progress value={queue.progress.fraction} max={1}/>}<span>{queue.progress.phase}</span></div>}
   {job.processingStatus==="failed"&&job.processingError&&<div className="error">{job.processingError}<p>Your original note is saved. You can retry whenever the device is ready.</p></div>}
   <ProcessingQueueControls/>
   {queue.testingOptions.showDiagnostics&&<LocalDiagnosticsPanel data={queue.diagnostics?.gatheringId===session.id?queue.diagnostics:{}}/>}
 </section>;
}

export default function GatheringWorkspace({people,onRefresh,initialSelection}:Props){
 const queue=useLocalProcessingQueue();
 const [sessions,setSessions]=useState<Session[]>([]),[items,setItems]=useState<Item[]>([]),[selected,setSelected]=useState<string|null>(null),[creating,setCreating]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [title,setTitle]=useState(""),[groupName,setGroup]=useState(""),[date,setDate]=useState(new Date().toISOString().slice(0,10)),[raw,setRaw]=useState("");
 async function load(){const r=await fetch("/api/gatherings");if(!r.ok)throw Error("Couldn't load gatherings");const d=await r.json() as {sessions:Session[],items:Item[]};setSessions(d.sessions);setItems(d.items)}
 useEffect(()=>{void load().catch(e=>setError(String(e)))},[queue.revision]);
 useEffect(()=>{if(initialSelection)setSelected(initialSelection)},[initialSelection]);
 async function action(input:unknown){const r=await fetch("/api/gatherings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)});const d=await r.json() as {id?:string;error?:string;extracted?:number;pending?:number;peoplePending?:number;status?:string};if(!r.ok)throw Error(d.error||"Could not save");void queue.refresh().catch(()=>{});return d}
 async function capture(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");try{const d=await action({action:"capture",title:title||groupName||"Gathering",groupName,date,rawText:raw});await load();setSelected(d.id||null);setCreating(false);setTitle("");setRaw("")}catch(e){setError(String(e))}finally{setBusy(false)}}
 async function confirm(ids:string[]){setBusy(true);setError("");try{await action({action:"confirm",ids});await load();await onRefresh()}catch(e){setError(String(e))}finally{setBusy(false)}}
 async function dismiss(id:string){setBusy(true);setError("");try{await action({action:"dismiss",id});await load()}catch(e){setError(String(e))}finally{setBusy(false)}}
 async function resolvePerson(input:{gatheringId:string;personName:string;itemIds:string[];contactId:string;newName:string}){setBusy(true);setError("");try{await action({action:"resolve_person",...input});await load();await onRefresh()}catch(e){setError(String(e));throw e}finally{setBusy(false)}}
 async function rejectPerson(input:{gatheringId:string;personName:string;itemIds:string[]}){setBusy(true);setError("");try{await action({action:"reject_person",...input});await load()}catch(e){setError(String(e));throw e}finally{setBusy(false)}}
 async function approveFact(item:Item){
   setBusy(true);setError("");try{const result=await action({action:"approve_fact",id:item.id});await load();if(result.status==="confirmed")await onRefresh()}catch(e){setError(String(e))}finally{setBusy(false)}
 }
 async function assignSpeaker(id:string,targetId:string){setBusy(true);setError("");try{await action({action:"assign_speaker",id,targetId});await load()}catch(e){setError(String(e))}finally{setBusy(false)}}
 async function setFactType(id:string,factType:FactType){setBusy(true);setError("");try{await action({action:"set_fact_type",id,factType});await load()}catch(e){setError(String(e));throw e}finally{setBusy(false)}}
 async function retryLocal(id:string){setError("");try{await queue.retry(id)}catch(e){setError(e instanceof Error?e.message:String(e))}}
 const session=sessions.find(s=>s.id===selected),current=items.filter(i=>i.gatheringId===selected&&i.status!=="rejected");
 const pendingPeople=groupPotentialPeople(current,people);
 const {ready,needsReview:unresolved,confirmed}=partitionNotesForReview(current);
 const reviewQueue=buildUnifiedReviewQueue(unresolved,pendingPeople);
 const groups=[...new Set([...sessions.map(s=>s.groupName),...people.map(p=>p.context)].filter(Boolean))];
 const upcoming=people.filter(p=>p.followUp.trim()||(p.lastSeen&&p.context));
 return <div className="gathering-workspace"><div className="section-heading"><div><div className="eyebrow">EVENT-FIRST MEMORY</div><h1>Gatherings</h1><p>Write naturally. Sort out the people afterward, only when necessary.</p></div><button className="primary-btn" onClick={()=>{setCreating(true);setSelected(null)}}><Plus size={16}/> Capture a gathering</button></div>
 {error&&<div className="error">{error}</div>}
 {creating?<section className="panel capture-panel"><button className="back" onClick={()=>setCreating(false)}>← Back to gatherings</button><div className="eyebrow">ONE NOTE, MANY MEMORIES</div><h2>What happened?</h2><p className="muted">No need to add people or link profiles first. Write everything you remember from the gathering.</p><form onSubmit={capture} className="capture-form"><div className="capture-meta"><label>Gathering name<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Church small group"/></label><label>Group<input value={groupName} onChange={e=>setGroup(e.target.value)} list="known-groups" placeholder="Church"/><datalist id="known-groups">{groups.map(g=><option value={g} key={g}/>)}</datalist></label><label>Date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label></div><label className="field-label">YOUR UNFILTERED NOTES</label><textarea className="capture-text" value={raw} required autoFocus onChange={e=>setRaw(e.target.value)} placeholder={"Jason started a new job. Sarah's daughter is applying to college. Michael has been training for a marathon.\n\nJust write naturally — one sentence or many."}/><div className="capture-footer"><span>Save now; local AI will organize your memories automatically while Afterglow is open.</span><button className="primary-btn" disabled={busy||!raw.trim()}>{busy?"Saving…":"Save gathering"} <Sparkles size={16}/></button></div></form></section>:
 session?<><button className="back" onClick={()=>setSelected(null)}>← All gatherings</button><div className="event-heading"><div><div className="eyebrow">{session.date}{session.groupName?` · ${session.groupName.toUpperCase()}`:""}</div><h2>{session.title}</h2><p>{current.length} extracted memories · {confirmed.length} saved · {pendingPeople.length} people to identify · {unresolved.length} notes to review</p></div></div>
 <LocalAISection session={session} onRetry={retryLocal}/>
 <div className="event-columns"><div><section className="panel review-panel"><div className="panel-head"><h3>Ready to save</h3>{ready.length>0&&<button className="primary-btn" disabled={busy} onClick={()=>void confirm(ready.map(x=>x.id))}><Check size={15}/> Confirm all {ready.length}</button>}</div>
 {ready.length?ready.map(i=><div className="capture-item" key={i.id}>
   <span className="status-dot good"/>
   <div><strong>{people.find(p=>p.id===i.contactId)?.name||i.name}</strong><p>{i.detail}</p><TemporalHint fact={i}/><small>{i.reason}</small>
     <FactTypePicker name={i.name} value={i.factType} disabled={busy} onChange={factType=>{void setFactType(i.id,factType).catch(()=>{})}}/>
   </div>
   <div className="fact-actions"><button className="review-button fact-approve-button" disabled={busy} onClick={()=>void approveFact(i)}><Check size={15}/> Approve</button><button className="review-button fact-reject-button" disabled={busy} onClick={()=>void dismiss(i.id)}><X size={15}/> Reject</button></div>
 </div>):<p className="muted">No outstanding confident matches.</p>}</section>
 <section className="panel review-panel unified-review-panel"><div className="panel-head"><h3>Review queue</h3><span className="count-pill">{reviewQueue.length}</span></div>{pendingPeople.length>0&&<p className="muted">Approve or reject each fact here. If its speaker is unclear, choose from the pending people in this gathering.</p>}{reviewQueue.length?<PendingPeopleReview groups={pendingPeople} queue={reviewQueue} contacts={people} gatheringId={session.id} busy={busy} onResolve={resolvePerson} onRejectPerson={rejectPerson} onApproveFact={i=>void approveFact(i)} onRejectFact={dismiss} onAssignSpeaker={assignSpeaker} onSetFactType={setFactType}/>:<p className="muted">Nothing ambiguous. You're all caught up.</p>}</section>
 {confirmed.length>0&&<section className="panel review-panel"><h3>Saved memories</h3>{confirmed.map(i=><div className="capture-item" key={i.id}><Check size={16} color="#4a8866"/><div><strong>{i.name}</strong><p>{i.detail}</p><TemporalHint fact={i}/><small>{i.factType==="profile"?"Profile fact":"Timeline event"}</small></div></div>)}</section>}</div>
 <aside className="panel original-note"><div className="eyebrow">SOURCE NOTE</div><h3>What you wrote</h3><p>{session.rawText}</p><small>Kept intact, even as individual memories are organized.</small></aside></div></>:
 <><div className="gathering-layout"><section className="panel"><div className="panel-head"><h3>Your gatherings</h3><button onClick={()=>setCreating(true)}>+ New gathering</button></div>{sessions.length?sessions.map(s=>{const claims=items.filter(i=>i.gatheringId===s.id&&i.status!=="rejected"),persons=groupPotentialPeople(claims,people);return <button className="gathering-row" key={s.id} onClick={()=>setSelected(s.id)}><span className="gathering-icon"><ClipboardList size={20}/></span><span><strong>{s.title}</strong><small>{s.date}{s.groupName?` · ${s.groupName}`:""}</small><em>{claims.length} memories{persons.length?` · ${persons.length} people to identify`:""} · {partitionNotesForReview(claims).needsReview.length} notes to review</em><small className={`queue-job-${s.processingStatus}`}>{processingLabel(queue.jobs.find(job=>job.id===s.id)||s)}</small></span><ArrowRight size={16}/></button>}):<div className="empty"><span>✳</span><strong>Start with a gathering</strong><p>You don't need to create any contacts first.</p><button onClick={()=>setCreating(true)}>Capture a conversation <ArrowRight size={14}/></button></div>}</section>
 <section className="panel briefing"><div className="eyebrow">BEFORE YOU MEET AGAIN</div><h3>Conversation starters</h3><p className="muted">A little refresher of things worth following up on.</p>{upcoming.slice(0,6).map(p=><div className="brief-row" key={p.id}><strong>{p.name}</strong><span>{p.followUp||`Last spoke ${p.lastSeen}`}</span></div>)}{!upcoming.length&&<p className="muted">Once you save memories and follow-up questions, they'll show up here.</p>}</section></div></>}
 </div>;
}
