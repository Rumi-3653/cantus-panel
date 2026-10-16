'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {PairCoordinator,DispatchReceiver}=require('./pair.cjs'),{LineageStore}=require('./lineage.cjs'),{build}=require('./conversation-tree.js');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'cantus-pair-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let creates=0,sends=0;const sessions=[],statuses=new Map(),managed={list:()=>sessions,create:async(provider,{cwd})=>{creates++;const s={id:'panel_fixture_'+creates,provider,cwd,title:'M1 子工作'};sessions.push(s);return s;},send:async input=>{sends++;statuses.set(input.id,{phase:'completed',busy:false,text:'測試完成'});},status:id=>statuses.get(id)||{phase:'idle',busy:false},history:()=>({rows:[{role:'assistant',text:'測試完成'}]})};const receiver=new DispatchReceiver({root:path.join(root,'receiver'),managed});return {root,managed,receiver,count:()=>({creates,sends})};}
const graph=()=>({revision:0,nodes:[{id:'same-id',title:'本機工作',sessionId:'same-id',provider:'codex',handoffs:[]}],edges:[]});
test('pair graph namespaces identical IDs; offline does not mean completion; source edges remain untouched',async t=>{
 const f=fixture(t);let online=true;const local=graph(),remote=graph();remote.nodes[0].title='遠端工作';const pair=new PairCoordinator({root:path.join(f.root,'pair'),local:async()=>local,remote:async()=>{if(!online)throw Error();return remote;}});
 let view=await pair.snapshot();assert.deepEqual(view.nodes.map(n=>n.id),['m4:same-id','m1:same-id']);assert.equal(view.canDispatch,true);
 view=await pair.mutate({action:'addEdge',revision:0,type:'dependency',from:'m4:same-id',to:'m1:same-id'});assert.equal(view.edges.length,1);assert.equal(local.edges.length,0);assert.equal(remote.edges.length,0);
 await assert.rejects(pair.mutate({action:'addEdge',revision:1,type:'dependency',from:'m1:same-id',to:'m4:same-id'}),/循環/);
 online=false;view=await pair.snapshot();assert.equal(view.canDispatch,false);assert.equal(view.nodes.find(n=>n.machine==='m1').unavailable,true);assert.equal(view.edges.length,1);
 await assert.rejects(pair.mutate({action:'dispatch',revision:1,from:'m4:same-id',requestId:'fixture-offline',text:'不要送出',cwd:f.root}),/離線/);assert.deepEqual(f.count(),{creates:0,sends:0});
});
test('receiver validates directory, deduplicates concurrent POST, and never replays after restart',async t=>{
 const f=fixture(t),input={requestId:'fixture-dispatch-1',text:'只收到這份任務',cwd:f.root};
 await assert.rejects(f.receiver.receive({...input,cwd:path.join(f.root,'missing')}),/找不到/);assert.equal(f.count().creates,0);
 await Promise.all([f.receiver.receive(input),f.receiver.receive(input)]);assert.deepEqual(f.count(),{creates:1,sends:1});
 const restarted=new DispatchReceiver({root:path.join(f.root,'receiver'),managed:f.managed});assert.equal((await restarted.receive(input)).status.phase,'completed');assert.deepEqual(f.count(),{creates:1,sends:1});
 await assert.rejects(restarted.receive({...input,text:'另一份任務'}),/不能改內容/);
 const receipt=JSON.parse(fs.readFileSync(path.join(f.root,'receiver',input.requestId+'.json'),'utf8'));assert.equal(receipt.phase,'accepted');assert.equal('text' in receipt,false);
});
test('coordinator reconciles lost POST response via receipt only, preserves parent edge and isolates machines',async t=>{
 const f=fixture(t);let post=0;const remote=async(url,method,body)=>{if(url==='/api/lineage')return {...graph(),nodes:[...graph().nodes,...f.managed.list().map(s=>({...s,sessionId:s.id,handoffs:[]}))]};if(method==='POST'){post++;await f.receiver.receive(body);throw Error('模擬回覆遺失');}return f.receiver.status(new URL(url,'http://fixture').searchParams.get('requestId'));};
 const pair=new PairCoordinator({root:path.join(f.root,'pair'),local:async()=>graph(),remote}),input={action:'dispatch',requestId:'fixture-dispatch-2',from:'m4:same-id',revision:0,text:'驗證工作',cwd:f.root};
 let view=await pair.mutate(input);const child=view.nodes.find(n=>n.dispatch);assert.equal(child.machine,'m1');assert.equal(child.sessionId,'panel_fixture_1');assert.equal(child.dispatch.status.phase,'completed');assert.equal(view.edges.find(e=>e.to===child.id).from,'m4:same-id');assert.equal(view.nodes.filter(n=>n.sessionId==='panel_fixture_1').length,1);
 const restarted=new PairCoordinator({root:path.join(f.root,'pair'),local:async()=>graph(),remote});view=await restarted.mutate(input);assert.equal(post,1);assert.deepEqual(f.count(),{creates:1,sends:1});assert.equal(view.nodes.find(n=>n.dispatch).dispatch.status.text,'測試完成');
 await assert.rejects(pair.mutate({...input,requestId:'fixture-dispatch-3',from:'m1:same-id'}),/從 M4/);
});
test('Cantus aliases and folders survive reload without changing originals or native grouping',t=>{
 const f=fixture(t),root=path.join(f.root,'labels'),store=new LineageStore({root,guard:()=>true}),sessions=[{id:'fixture-session',title:'原始標題',provider:'codex',hasTranscript:true}],original=JSON.stringify(sessions);
 let view=store.mutate({action:'rename',revision:0,id:sessions[0].id,title:'Cantus 名稱'},sessions,new Map());assert.equal(view.nodes[0].title,'Cantus 名稱');
 view=store.mutate({action:'createFolder',revision:1,title:'我的資料夾'},sessions,new Map());const folder=view.folders[0];assert.equal(build(sessions,{folders:view.folders})[0].count,0);
 store.mutate({action:'moveFolder',revision:2,id:sessions[0].id,folderId:folder.id},sessions,new Map());const fresh=new LineageStore({root,guard:()=>true}),display=fresh.catalog({sessions});assert.equal(display.sessions[0].originalTitle,'原始標題');assert.equal(display.sessions[0].title,'Cantus 名稱');assert.equal(build(display.sessions,{folders:display.cantusFolders})[0].cantusFolderId,folder.id);assert.equal(JSON.stringify(sessions),original);
 assert.throws(()=>fresh.mutate({action:'rename',revision:3,id:sessions[0].id,title:' '},sessions,new Map()),/1–300/);assert.throws(()=>fresh.mutate({action:'moveFolder',revision:3,id:'foreign',folderId:folder.id},sessions,new Map()),/找不到/);
 fresh.mutate({action:'renameFolder',revision:3,id:folder.id,title:'整理好的工作'},sessions,new Map());assert.equal(fresh.catalog({sessions}).sessions[0].cantusFolder.name,'整理好的工作');
 fresh.mutate({action:'moveFolder',revision:4,id:sessions[0].id,folderId:null},sessions,new Map());assert.equal(build(fresh.names(sessions))[0].kind,'unclassified');assert.equal(JSON.stringify(sessions),original);
 const hidden=[{id:'fixture-hidden',provider:'codex',managed:true,title:'This is an isolated Cantus engineering test.'}];fresh.mutate({action:'rename',revision:5,id:hidden[0].id,title:'測試也能改名'},hidden,new Map());assert.equal(fresh.names(hidden)[0].title,'測試也能改名');
});
