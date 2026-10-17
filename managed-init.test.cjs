'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {ManagedRunner}=require('./managed.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'cantus-id-order-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const r=new ManagedRunner({root,guard:async()=>true});r.auth=()=>({});r.write=()=>{};return r;}
test('new Codex thread notifications before RPC continuation are buffered and verified',async t=>{
 const r=fixture(t),s=await r.create('codex'),sid='fixture-new-thread',calls=[];
 r.rpc=async(run,method)=>{calls.push(method);if(method==='thread/start'){r.frame(run,{method:'thread/status/changed',params:{threadId:sid,status:{type:'idle'}}});r.frame(run,{method:'thread/started',params:{thread:{id:sid}}});return {thread:{id:sid}};}return method==='turn/start'?{turn:{id:'turn1'}}:{};};
 const run={id:s.id,cwd:s.cwd,provider:'codex',approvals:new Map(),texts:new Map()};await r.start(run,'test');
 assert.equal(run.sid,sid);assert.equal(run.verifiedSession,true);assert.equal(run.earlyThreadFrames.length,0);assert.ok(calls.includes('turn/start'));
});
test('buffered wrong IDs never reach turn/start or become the saved session',async t=>{
 const r=fixture(t),s=await r.create('codex'),calls=[];
 r.rpc=async(run,method)=>{calls.push(method);if(method==='thread/start'){r.frame(run,{method:'thread/status/changed',params:{threadId:'other-thread'}});return {thread:{id:'right-thread'}};}return {};};
 await assert.rejects(r.start({id:s.id,cwd:s.cwd,provider:'codex'},'test'),/ID/);assert.equal(r.records.get(s.id).sid,null);assert.ok(!calls.includes('turn/start'));
});
test('resuming a thread still rejects another ID and buffering is bounded',async t=>{
 const r=fixture(t),s=await r.create('codex');
 assert.throws(()=>r.frame({provider:'codex',sid:'original'},{method:'thread/status/changed',params:{threadId:'other'}}),/different session/);
 const run={provider:'codex',sid:null,awaitingThread:true,earlyThreadFrames:[]};
 for(let i=0;i<100;i++)r.frame(run,{method:'thread/status/changed',params:{threadId:'new'}});
 assert.throws(()=>r.frame(run,{method:'thread/status/changed',params:{threadId:'new'}}),/過多/);
});
