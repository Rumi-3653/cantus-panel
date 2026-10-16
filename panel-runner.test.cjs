'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {PanelRunner}=require('./panel-runner.cjs');
function run(){return {id:'test_session',provider:'codex',sid:'fixture',turnId:'turn1',busy:true,phase:'running',texts:new Map(),approvals:new Map(),pending:new Map()};}
test('stop translates provider-close races into stopped, not a failed turn',async()=>{
 const r=new PanelRunner({});const current=run();r.runs.set(current.id,current);
 r.rpc=async()=>r.fail(current,Object.assign(Error('connection closed'),{code:'provider'}));
 const result=await r.stop(current.id);assert.equal(result.phase,'stopped');assert.equal(result.busy,false);
});
test('stop does not hang when the provider never acknowledges interrupt',async()=>{
 const r=new PanelRunner({});const current=run();r.runs.set(current.id,current);r.rpc=()=>new Promise(()=>{});
 const at=Date.now(),result=await r.stop(current.id);assert.equal(result.phase,'stopped');assert.ok(Date.now()-at<5000);
});
test('unknown/finished sessions cannot interrupt any other process',async()=>{
 const r=new PanelRunner({});let called=0;r.rpc=()=>{called++;};assert.equal((await r.stop('unknown')).phase,'idle');
 const current=run();current.busy=false;r.runs.set(current.id,current);await r.stop(current.id);assert.equal(called,0);
});
test('explicit full access applies to Codex start/resume and each turn without global configuration writes',async()=>{
 const r=new PanelRunner({fullAccess:true});const current=run();const frames=[];r.write=(_r,frame)=>{frames.push(frame);r.pendingReply(current,frame.id,{},null);};current.nextRpc=1;
 for(const method of ['thread/start','thread/resume','turn/start'])await r.rpc(current,method,{threadId:'fixture',approvalPolicy:'untrusted'});
 for(const frame of frames)assert.equal(frame.params.approvalPolicy,'never');assert.equal(frames[0].params.sandbox,'danger-full-access');assert.equal(frames[1].params.sandbox,'danger-full-access');assert.deepEqual(frames[2].params.sandboxPolicy,{type:'dangerFullAccess'});
});
test('full access automatically answers Codex and Claude tool approval without UI clicks',()=>{
 for(const provider of ['codex','claude']){const r=new PanelRunner({fullAccess:true}),current=run(),frames=[];current.provider=provider;r.runs.set(current.id,current);r.write=(_r,frame)=>frames.push(frame);
 r.approval(current,42,provider==='claude'?'tool':'command',{},{input:{command:'fixture'}});assert.equal(current.approvals.size,0);assert.equal(current.phase,'running');assert.equal(provider==='claude'?frames[0].response.response.behavior:frames[0].result.decision,provider==='claude'?'allow':'accept');}
});
test('Claude full-access child receives bypassPermissions and does not alter parent arguments',()=>{
 let actual;const r=new PanelRunner({fullAccess:true,spawn:(_cmd,args)=>{actual=args;}}),args=['-p','--permission-prompt-tool','stdio','--permission-mode','manual'];r.spawn('/fixture/claude',args,{});assert.ok(actual.includes('bypassPermissions'));assert.ok(!actual.includes('manual'));assert.ok(args.includes('manual'));
});
