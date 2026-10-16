'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {HandoffRunner}=require('./handoff.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'cantus-handoff-unit-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const records=new Map(),runs=new Map(),calls=[];let count=0;
 const managed={records,guard:async()=>true,list:()=>[...records.values()].filter(r=>!r.hidden),capability:id=>({available:records.has(id),sourceSessionId:id+'-native',note:'fixture'}),
  create:async(provider,options={})=>{const id='panel_fixture_'+(++count),r={id,provider,cwd:options.cwd||root,hidden:options.hidden,rows:[]};records.set(id,r);return r;},
  status:id=>runs.get(id)||{busy:false,phase:'idle'},
  send:async({id,text,requestId})=>{calls.push({id,text,requestId});const r=records.get(id);r.rows.push({role:'user',text},{role:'assistant',text:'reply-'+r.provider});runs.set(id,{busy:false,phase:'completed',text:'reply-'+r.provider});return runs.get(id);},stop:async id=>{runs.set(id,{busy:false,phase:'stopped',text:'',error:'stopped'});}};
 const native={runner:{status:()=>({busy:false})},capability:async()=>({available:false})};
 const h=new HandoffRunner({managed,native,lookup:()=>null,root:path.join(root,'handoffs')});return {h,managed,calls,runs,root};
}
async function send(h,id,provider,text,requestId){await h.send({id,provider,text,requestId});const p=h.pending.get(id);if(p?.done)await p.done;}
test('Codex -> Claude -> Codex -> Claude preserves one ID and two child sessions across restart',async t=>{
 const {h,managed,calls}=fixture(t),s=await managed.create('codex');managed.records.get(s.id).rows.push({role:'user',text:'first-secret'},{role:'assistant',text:'first-reply'});
 await send(h,s.id,'claude','second','request_0001');const claude=h.records.get(s.id).members.claude;assert.equal(managed.records.get(claude).cwd,s.cwd);assert.match(calls[0].text,/first-secret/);
 await send(h,s.id,'codex','third','request_0002');assert.equal(calls[1].id,s.id);assert.match(calls[1].text,/second/);assert.doesNotMatch(calls[1].text,/first-secret/);
 const again=new HandoffRunner({managed,native:h.native,lookup:()=>null,root:h.root});await send(again,s.id,'claude','fourth','request_0003');assert.equal(calls[2].id,claude);assert.match(calls[2].text,/third/);assert.doesNotMatch(calls[2].text,/first-secret/);
 assert.equal(managed.records.size,2);assert.equal(again.list()[0].id,s.id);assert.equal(again.history(s.id).rows.length,8);assert.deepEqual(again.history(s.id).rows.filter(r=>r.role==='assistant').map(r=>r.provider),['codex','claude','codex','claude']);
 assert.equal(managed.list().length,1);await assert.rejects(again.send({id:s.id,provider:'claude',text:'duplicate',requestId:'request_0003'}));
});
test('busy, invalid provider, failed guard and unknown source never dispatch',async t=>{
 const {h,managed,calls,runs}=fixture(t),s=await managed.create('codex');
 await assert.rejects(h.send({id:s.id,provider:'other',text:'x',requestId:'request_0001'}));await assert.rejects(h.send({id:'unknown_id',provider:'claude',text:'x',requestId:'request_0001'}));
 runs.set(s.id,{busy:true});await assert.rejects(h.send({id:s.id,provider:'claude',text:'x',requestId:'request_0001'}));runs.clear();managed.guard=async()=>false;await assert.rejects(h.send({id:s.id,provider:'claude',text:'x',requestId:'request_0001'}));assert.equal(calls.length,0);
});
test('preparing reserves conversation and stop prevents any later dispatch',async t=>{
 const {h,managed,calls}=fixture(t),s=await managed.create('codex');let release;managed.guard=()=>new Promise(r=>release=r);
 const pending=h.send({id:s.id,provider:'claude',text:'x',requestId:'request_0001'});await assert.rejects(h.send({id:s.id,provider:'codex',text:'race',requestId:'request_0002'}));await h.stop(s.id);release(true);await assert.rejects(pending);assert.equal(calls.length,0);
});
test('failure keeps history, does not advance context cursor, and cannot auto replay after restart',async t=>{
 const {h,managed}=fixture(t),s=await managed.create('codex');managed.send=async()=>{throw Error('fixture unavailable');};
 await assert.rejects(h.send({id:s.id,provider:'claude',text:'keep me',requestId:'request_0001'}),/fixture unavailable/);assert.equal(h.status(s.id).phase,'failed');assert.equal(h.history(s.id).rows.at(-1).text,'keep me');assert.equal(h.records.get(s.id).seen.claude,undefined);
 const again=new HandoffRunner({managed,native:h.native,lookup:()=>null,root:h.root});await assert.rejects(again.send({id:s.id,provider:'claude',text:'keep me',requestId:'request_0001'}));
});
test('older history pages are preserved and stale page cursors are refused',async t=>{
 const {h,managed}=fixture(t),s=await managed.create('codex');s.rows=Array.from({length:250},(_,i)=>({role:'user',text:'row '+i}));managed.records.set(s.id,s);await h.init(s.id);
 const latest=h.history(s.id);assert.equal(latest.rows.length,120);assert.equal(latest.rows.at(-1).text,'row 249');const older=h.history(s.id,{before:latest.nextBefore,pageSignature:latest.pageSignature});assert.equal(older.rows.at(-1).text,'row 129');h.records.get(s.id).rows.push({role:'user',text:'new'});assert.throws(()=>h.history(s.id,{before:latest.nextBefore,pageSignature:latest.pageSignature}));
});
test('external original CLI additions are included on next switch and never leak to another conversation',async t=>{
 const {h,managed,calls}=fixture(t),a=await managed.create('codex'),b=await managed.create('codex');await send(h,a.id,'claude','A-private','request_0001');a.rows.push({role:'user',text:'outside-original'});
 await send(h,a.id,'claude','continue','request_0002');assert.match(calls[1].text,/outside-original/);await send(h,b.id,'claude','B-only','request_0003');assert.doesNotMatch(calls[2].text,/A-private|outside-original/);
});
test('long Chinese input is preserved and combined handoff stays below CLI byte limit',async t=>{
 const {h,managed,calls}=fixture(t),s=await managed.create('codex');s.rows.push({role:'assistant',text:'舊'.repeat(40000)});const input='新'.repeat(24000);
 await send(h,s.id,'claude',input,'request_0001');assert.ok(Buffer.byteLength(calls[0].text)<100000);assert.ok(calls[0].text.endsWith(input));assert.equal(h.history(s.id).rows.at(-2).text,input);assert.equal(h.history(s.id).rows[0].text.length,40000);
});
