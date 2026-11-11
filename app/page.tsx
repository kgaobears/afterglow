"use client";
import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, Heart, Inbox, LayoutGrid, Plus, Search, Settings2, Sparkles, Users, X } from "lucide-react";
import GatheringWorkspace from "./gathering-workspace";
import ReviewInbox from "./review-inbox";
import { useLocalProcessingQueue } from "./local-processing-provider";
import ContactProfile from "./contact-profile";
import { type FactType } from "./fact-type";
import type { TemporalFields } from "./temporal-facts";
import TemporalHint from "./temporal-hint";
import TestingSettingsPage from "./testing-settings-page";

type Person = { id:string; name:string; context:string; tags:string; note:string; lastSeen:string; followUp:string; favorite:boolean };
type Moment = { id:string; contactId:string; body:string; date:string; factType:FactType; createdAt:number } & TemporalFields;
type Conversation = { id:string; contactId:string; title:string; groupName:string; date:string };
const initials=(s:string)=>s.split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase();
const colors=["#e8b5a6","#afc4b5","#c8b2d3","#e3c79b","#a8bfd7"];
function OverviewReviewPrompt({count,onOpen}:{count:number;onOpen:()=>void}){
 if(!count)return null;
 return <button type="button" className="overview-review-prompt" onClick={onOpen}>
   <span className="overview-review-icon"><Inbox size={19}/></span>
   <span><strong>{count} {count===1?"item":"items"} ready for your review</strong><small>Check the people and short memories the AI found.</small></span>
   <span className="overview-review-action">Review now <ArrowRight size={15}/></span>
 </button>;
}
export default function Home(){
 const processing=useLocalProcessingQueue();
 const [localDate,setLocalDate]=useState("");
 const [people,P]=useState<Person[]>([]),[entries,E]=useState<Moment[]>([]),[conversations,C]=useState<Conversation[]>([]),[tab,T]=useState("Overview"),[selected,S]=useState<string|null>(null),[modal,M]=useState(""),[search,Q]=useState(""),[loading,L]=useState(true),[error,R]=useState("");
 const [requestedGathering,setRequestedGathering]=useState<string|null>(null);
 const [form,F]=useState({name:"",context:"",tags:"",note:"",followUp:""}),[note,N]=useState({contactId:"",body:"",factType:"timeline" as FactType,date:new Date().toISOString().slice(0,10)}),[batch,B]=useState([{contactId:"",body:""}]),[saving,V]=useState(false);
 const person=people.find(x=>x.id===selected),follow=people.filter(x=>x.followUp.trim());
 async function refresh(){try{const r=await fetch("/api/data");if(!r.ok)throw Error("Unable to load your private notebook. Please sign in.");const d=await r.json() as {people:Person[],entries:Moment[],conversations?:Conversation[]};P(d.people);E(d.entries);C(d.conversations||[]);R("")}catch(e){R(String(e))}finally{L(false)}}
 useEffect(()=>{
   setLocalDate(new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}));
   void refresh();
   const onProcessed = () => { void refresh(); };
   window.addEventListener("afterglow-memories-updated", onProcessed);
   return () => window.removeEventListener("afterglow-memories-updated", onProcessed);
 },[]);
 useEffect(()=>{if(modal==="batch"){M("");T("Gatherings");S(null)}},[modal]);
 async function send(payload:unknown):Promise<{id?:string;ok?:boolean}>{const r=await fetch("/api/data",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});if(!r.ok)throw Error(((await r.json()) as {error?:string}).error||"Save failed");return r.json() as Promise<{id?:string;ok?:boolean}>}
 async function submit(e:React.FormEvent){e.preventDefault();V(true);try{if(modal==="person"){const d=await send({type:"contact",...form});S(d.id||null);T("People");F({name:"",context:"",tags:"",note:"",followUp:""})}else if(modal==="note")await send({type:"moment",...note});else for(const row of batch.filter(x=>x.contactId&&x.body.trim()))await send({type:"moment",...row,date:new Date().toISOString().slice(0,10)});await refresh();M("");N({contactId:"",body:"",factType:"timeline",date:new Date().toISOString().slice(0,10)});B([{contactId:"",body:""}])}catch(e){R(String(e))}finally{V(false)}}
 async function update(id:string,changes:Partial<Person>){try{await send({type:"update",id,...changes});await refresh()}catch(e){R(String(e))}}
 async function changeFactType(id:string,factType:FactType){try{await send({type:"set_fact_type",id,factType});await refresh()}catch(e){R(String(e))}}
 function openNote(id="",factType:FactType="timeline"){N({contactId:id||people[0]?.id||"",body:"",factType,date:new Date().toISOString().slice(0,10)});M("note")}
 const nav=[{name:"Overview",icon:LayoutGrid},{name:"Review",icon:Inbox},{name:"Gatherings",icon:Sparkles},{name:"People",icon:Users},{name:"Conversations",icon:BookOpen},{name:"Follow-ups",icon:Heart},{name:"Settings",icon:Settings2}];
 const row=(p:Person)=><button className="person-row" key={p.id} onClick={()=>S(p.id)}><span className="avatar" style={{background:colors[p.name.charCodeAt(0)%colors.length]}}>{initials(p.name)}</span><span className="row-main"><strong>{p.name} {p.favorite&&<i>♥</i>}</strong><small>{p.context||p.tags||"New connection"}</small></span><span className="row-date">{p.lastSeen||"New"}</span><ArrowRight size={15}/></button>;
 const momentRow=(m:Moment)=><button className="moment-row" key={m.id} onClick={()=>{S(m.contactId);T("People")}}><span className="moment-dot"/><span><strong>{people.find(p=>p.id===m.contactId)?.name||"Someone"} <small>· {m.date}{m.factType==="profile"?" · Profile fact":""}</small></strong><p>{m.body}</p><TemporalHint fact={m}/></span><ArrowRight size={15}/></button>;
 const empty=(title:string,desc:string,action:string,fn:()=>void)=><div className="empty"><span>✳</span><strong>{title}</strong><p>{desc}</p><button onClick={fn}>{action} <ArrowRight size={14}/></button></div>;
 return <div className="shell"><aside className="sidebar"><div className="brand"><div className="brand-icon"><Sparkles size={21}/></div><div><strong>afterglow<span>.</span></strong><small>PEOPLE, REMEMBERED</small></div></div><div className="nav-label">WORKSPACE</div><nav>{nav.map(n=><button key={n.name} className={`nav-item ${tab===n.name?"active":""} ${n.name==="Review"?"review-nav":""}`} onClick={()=>{T(n.name);S(null);if(n.name==="Gatherings")setRequestedGathering(null)}}><n.icon size={18}/>{n.name}{n.name==="Review"&&processing.reviewCount>0&&<em>{processing.reviewCount}</em>}{n.name==="Follow-ups"&&follow.length>0&&<em>{follow.length}</em>}</button>)}</nav><div className="sidebar-bottom"><div>✳</div><p>Good relationships are<br/>made of little moments.</p><small>A little space to remember them.</small></div></aside>
 {!(tab==="Gatherings"||tab==="Review")&&<main className="main">
   <div className="topbar"><span>YOUR SPACE / {tab.toUpperCase()} {person?`/ ${person.name.toUpperCase()}`:""}</span><span>{localDate}</span></div>
   <div className="content">{error&&<div className="error">{error} <button onClick={()=>void refresh()}>Retry</button></div>}
   {loading?<p>Opening your notebook…</p>:person?
     <ContactProfile person={person} entries={entries} conversations={conversations.filter(c=>c.contactId===person.id)} tab={tab} onBack={()=>S(null)}
       onUpdate={changes=>void update(person.id,changes)}
       onAddMemory={kind=>openNote(person.id,kind)}
       onSetFactType={(id,kind)=>void changeFactType(id,kind)}/>
     :
 tab==="Overview"?<><div className="welcome"><div className="eyebrow">YOUR PERSONAL RELATIONSHIP NOTEBOOK</div><h1>Remember the little things<span>.</span></h1><p>Keep the stories, details, and conversations that make people feel seen.</p><div className="actions"><button className="primary-btn" onClick={()=>M("batch")}><Sparkles size={16}/> Quick batch capture <ArrowRight size={16}/></button><button className="outline-btn" onClick={()=>M("person")}><Plus size={16}/> Add a person</button></div><div className="welcome-mark">✳</div></div><OverviewReviewPrompt count={processing.reviewCount} onOpen={()=>{T("Review");S(null)}}/><div className="stats"><div><span>PEOPLE IN YOUR CIRCLE</span><strong>{String(people.length).padStart(2,"0")}</strong><small>Connections worth keeping</small></div><div><span>CONVERSATIONS SAVED</span><strong>{String(entries.length).padStart(2,"0")}</strong><small>Moments you won't forget</small></div><div><span>THINGS TO FOLLOW UP</span><strong>{String(follow.length).padStart(2,"0")}</strong><small>Thoughtful next conversations</small></div></div><div className="columns"><section className="panel"><div className="panel-head"><h3>Your people</h3><button onClick={()=>T("People")}>See all →</button></div>{people.length?people.slice(0,5).map(row):empty("Your circle starts here","Add someone you know or just met.","Add first person",()=>M("person"))}</section><section className="panel"><div className="panel-head"><h3>Recent moments</h3><button onClick={()=>people.length?openNote():M("person")}>+ Add note</button></div>{entries.length?entries.slice(0,5).map(momentRow):empty("A story worth keeping","Record the little details after catching up.","Add conversation",()=>people.length?openNote():M("person"))}</section></div></>:
 tab==="People"?<><div className="section-heading"><div><div className="eyebrow">YOUR CONNECTIONS</div><h1>People <span>({people.length})</span></h1><p>Everyone you want to keep in touch with.</p></div><button className="primary-btn" onClick={()=>M("person")}><Plus size={17}/> Add person</button></div><div className="searchbox"><Search size={18}/><input placeholder="Search by name, context, or tag…" value={search} onChange={e=>Q(e.target.value)}/></div><section className="panel list-panel">{people.filter(p=>(p.name+p.context+p.tags).toLowerCase().includes(search.toLowerCase())).map(row)}{!people.length&&empty("No people yet","Start building your circle.","Add person",()=>M("person"))}</section></>:
 tab==="Conversations"?<><div className="section-heading"><div><div className="eyebrow">YOUR SHARED MOMENTS</div><h1>Conversations</h1><p>The small details are often the big things.</p></div><button className="primary-btn" onClick={()=>people.length?openNote():M("person")}><Plus size={17}/> Add note</button></div><section className="panel list-panel">{entries.map(momentRow)}{!entries.length&&empty("No moments yet","Capture your next conversation.","Add a note",()=>people.length?openNote():M("person"))}</section></>:
 tab==="Settings"?<TestingSettingsPage/>:
 tab==="Gatherings"||tab==="Review"?null:
 <><div className="section-heading"><div><div className="eyebrow">A LITTLE THOUGHTFULNESS</div><h1>Follow-ups</h1><p>Things to ask the next time you meet.</p></div></div><section className="panel list-panel">{follow.map(p=><button className="follow-row" key={p.id} onClick={()=>S(p.id)}><span className="avatar" style={{background:colors[p.name.charCodeAt(0)%colors.length]}}>{initials(p.name)}</span><span><strong>{p.name}</strong><small>{p.followUp}</small></span><ArrowRight size={16}/></button>)}{!follow.length&&empty("You're all caught up","Add a question on someone's profile.","See people",()=>T("People"))}</section></>}
 </div></main>}{(tab==="Gatherings"||tab==="Review")&&<main className="main gathering-main"><div className="topbar"><span>YOUR SPACE / {tab.toUpperCase()}</span><span>YOUR MEMORY NOTEBOOK</span></div><div className="content">{tab==="Gatherings"?<GatheringWorkspace people={people} onRefresh={refresh} initialSelection={requestedGathering}/>:<ReviewInbox people={people} onRefresh={refresh} onOpenGathering={id=>{setRequestedGathering(id);T("Gatherings");S(null)}}/>}</div></main>}
 {modal&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)M("")}}>
   <div className="dialog"><div className="dialog-head"><div><div className="eyebrow">{modal==="person"?"A NEW CONNECTION":modal==="batch"?"AFTER THE GATHERING":"KEEP THE MOMENT"}</div><h2>{modal==="person"?"Add someone new":modal==="batch"?"Batch capture":note.factType==="profile"?"Add a profile fact":"Add a timeline event"}</h2></div><button onClick={()=>M("")}><X size={20}/></button></div>
   <form className="form" onSubmit={submit}>
     {modal==="person"?<>
       <label>Name<input required autoFocus placeholder="e.g. Sarah Chen" value={form.name} onChange={e=>F({...form,name:e.target.value})}/></label>
       <label>How do you know them?<input placeholder="Met at a friend's dinner" value={form.context} onChange={e=>F({...form,context:e.target.value})}/></label>
       <label>Tags<input placeholder="Friends, climbing, Berkeley" value={form.tags} onChange={e=>F({...form,tags:e.target.value})}/></label>
       <label>Things to remember<textarea rows={3} placeholder="Interests, family, plans…" value={form.note} onChange={e=>F({...form,note:e.target.value})}/></label>
       <label>Ask about next time<input placeholder="How did their interview go?" value={form.followUp} onChange={e=>F({...form,followUp:e.target.value})}/></label>
     </>:modal==="note"?<>
       <label>Person<select required value={note.contactId} onChange={e=>N({...note,contactId:e.target.value})}><option value="">Choose someone</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
       <label>Save as<select value={note.factType} onChange={e=>N({...note,factType:e.target.value as FactType})}><option value="profile">Profile fact — lasting detail</option><option value="timeline">Timeline event — dated update</option></select></label>
       <label>Date noted<input type="date" value={note.date} onChange={e=>N({...note,date:e.target.value})}/></label>
       <label>What should you remember?<textarea required autoFocus rows={5} placeholder={note.factType==="profile"?"Has a brother who lives in San Francisco…":"Visited his brother last weekend…"} value={note.body} onChange={e=>N({...note,body:e.target.value})}/></label>
     </>:<>
       <p className="muted">Just got home from a gathering? Capture a few details for everyone at once.</p>
       {batch.map((b,i)=><div className="batch-row" key={i}><select value={b.contactId} onChange={e=>B(batch.map((x,j)=>i===j?{...x,contactId:e.target.value}:x))}><option value="">Choose a person</option>{people.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select><textarea rows={2} placeholder="A detail worth remembering…" value={b.body} onChange={e=>B(batch.map((x,j)=>i===j?{...x,body:e.target.value}:x))}/></div>)}
       <button type="button" className="add-row" onClick={()=>B([...batch,{contactId:"",body:""}])}><Plus size={16}/> Add another person</button>
     </>}
     <button disabled={saving||modal==="batch"&&!batch.some(x=>x.contactId&&x.body.trim())} className="primary-btn submit">{saving?"Saving…":modal==="person"?"Save person":modal==="note"?"Save memory":"Save all notes"} <ArrowRight size={16}/></button>
   </form></div></div>}
 </div>
}
