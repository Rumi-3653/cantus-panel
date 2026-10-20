'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createNextServer}=require('./server-next.cjs'),{BoardStore}=require('./board-store.cjs');
const vm=require('node:vm'),crypto=require('node:crypto');
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
async function setup(t,policy={execution:true}){
 const calls=[],root=fs.mkdtempSync(path.join(os.tmpdir(),'cantus-next-test-'));let rejectSend=false;
 const upstream=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;calls.push({method:req.method,url:req.url,headers:req.headers,raw});res.setHeader('Content-Type','application/json');
  if(req.url==='/api/bootstrap')return res.end(JSON.stringify({csrf:'test-upstream-csrf',pair:true}));
  if(req.url.startsWith('/api/sessions'))return res.end(JSON.stringify({catalogVersion:'fixture',sessions:[{id:'original-a',title:'原對話',provider:'codex'}]}));
  if(req.url==='/api/live')return res.end(JSON.stringify({machines:[{id:'local',connected:true,coverage:'fixture',jobs:[{id:'external-777',pid:777,status:'unknown'}]}]}));
  if(req.url==='/api/lineage')return res.end(JSON.stringify({nodes:[{id:'original-a',handoffs:[]}],edges:[]}));
  if(rejectSend){res.statusCode=403;return res.end(JSON.stringify({error:'token changed'}));}
  return res.end(JSON.stringify({echo:raw?JSON.parse(raw):null}));
 });const backend=await listen(upstream),server=createNextServer({upstream:backend,dataRoot:root,guard:()=>{},...policy}),origin=await listen(server);
 t.after(async()=>{await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>upstream.close(r))]);fs.rmSync(root,{recursive:true,force:true});});
 const boot=await (await fetch(origin+'/api/bootstrap')).json();
 async function post(route,value,headers={}){return fetch(origin+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Cantus-Token':boot.csrf,...headers},body:JSON.stringify(value)});}
 return {origin,backend,root,calls,boot,post,server,reject:()=>{rejectSend=true;}};
}
test('公開版預設示範不讀取原有帳號；不能由新版建立、送出或控制 AI',async t=>{
 const f=await setup(t,{}),runtime=require('../runtime.cjs');assert.equal(runtime.demo,true);assert.equal(runtime.execution,false);
 const created=await f.server.advanced.create('codex');
 for(const route of ['/api/native/create','/api/native/send','/api/native/answer','/api/native/stop','/api/next/steer','/api/next/pause','/api/next/resume','/api/next/retry'])assert.equal((await f.post(route,{id:created.id,provider:'codex',text:'fictional',requestId:'fixture-only-id'},{'X-Cantus-Next-Desktop':'1'})).status,403,route);
 assert.equal((await (await fetch(f.origin+'/api/native/capability?id='+created.id)).json()).available,false);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,0);assert.equal(f.server.advanced.runs.size,0);
});
test('只讀模式同時鎖住 Task、關係、對話與進階控制',async t=>{
 const f=await setup(t,{execution:true,readOnly:true});
 for(const route of ['/api/next/board','/api/lineage','/api/native/create','/api/native/send','/api/next/steer','/api/next/pause','/api/next/resume','/api/next/retry'])assert.equal((await f.post(route,{action:'create',title:'fictional',revision:0})).status,423,route);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,0);assert.equal(f.server.advanced.records.size,0);
 assert.equal((await (await fetch(f.origin+'/api/next/board')).json()).tasks.length,0);
});
test('合併新版對話時取得完整目錄，避免把上游差異回覆當成空清單',async t=>{
 const f=await setup(t);await f.server.advanced.create('codex');
 const catalog=await (await fetch(f.origin+'/api/sessions?background=1&since=old-version')).json();
 assert.equal(catalog.sessions.length,2);const request=f.calls.find(c=>c.url.startsWith('/api/sessions'));
 assert.ok(request.url.includes('background=1'));assert.ok(!request.url.includes('since='));
});
test('新舊 CSRF 分離；原生回合只轉送一次且保留同一 requestId',async t=>{
 const f=await setup(t);assert.notEqual(f.boot.csrf,'test-upstream-csrf');assert.equal(f.boot.pair,false);
 const input={id:'original-a',text:'fixture only',requestId:'unchanged-request-id',revision:3};
 const response=await f.post('/api/native/send',input);assert.deepEqual((await response.json()).echo,input);
 const send=f.calls.filter(c=>c.url==='/api/native/send');assert.equal(send.length,1);assert.equal(send[0].headers['x-cantus-token'],'test-upstream-csrf');assert.equal(send[0].headers.origin,f.backend);
 f.reject();assert.equal((await f.post('/api/native/send',input)).status,403);assert.equal(f.calls.filter(c=>c.url==='/api/native/send').length,2);
});
test('拒絕外部來源、無 token、錯誤內容類型；不提供伺服器檔案',async t=>{
 const f=await setup(t);
 assert.equal((await f.post('/api/native/send',{}, {Origin:'https://example.com'})).status,403);
 assert.equal((await f.post('/api/native/send',{}, {'X-Cantus-Token':'wrong'})).status,403);
 assert.equal((await f.post('/api/native/send',{}, {'Content-Type':'text/plain'})).status,415);
 assert.equal((await fetch(f.origin+'/server-next.cjs')).status,404);
 assert.equal((await fetch(f.origin+'/data/lineage/graph.json')).status,404);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
});
test('任務板資料獨立、版本衝突保護及移動順序；不呼叫原後端寫入',async t=>{
 const f=await setup(t);let data=await (await f.post('/api/next/board',{action:'create',title:'A',revision:0})).json();
 data=await (await f.post('/api/next/board',{action:'create',title:'B',revision:data.revision})).json();const [a,b]=data.tasks;
 data=await (await f.post('/api/next/board',{action:'move',id:b.id,column:'backlog',before:a.id,revision:data.revision})).json();assert.deepEqual(data.tasks.map(t=>t.title),['B','A']);
 assert.equal((await f.post('/api/next/board',{action:'remove',id:a.id,revision:0})).status,409);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'board/board.json'))).tasks.length,2);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
});
test('Lineage 名稱與拆分只寫新版，原版及雲端的設定寫入被擋下',async t=>{
 const f=await setup(t);let value=await (await fetch(f.origin+'/api/lineage')).json();
 value=await (await f.post('/api/lineage',{action:'rename',id:'original-a',title:'新版名稱',revision:value.revision})).json();assert.equal(value.nodes[0].title,'新版名稱');
 const catalog=await (await fetch(f.origin+'/api/sessions')).json();assert.equal(catalog.sessions[0].title,'新版名稱');
 assert.equal((await f.post('/api/lineage',{action:'createTask',title:'stale',revision:0})).status,409);
 for(const route of ['/api/routing/settings','/api/m1/routing/settings','/api/pair/dispatch','/api/m1/lineage'])assert.equal((await f.post(route,{})).status,423,route);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
});
test('儲存防護失敗不覆寫資料，已有備份的中斷寫入可以恢復',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cantus-board-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new BoardStore(root);store.mutate({action:'create',title:'preserve',revision:0});const before=fs.readFileSync(path.join(root,'board.json'),'utf8');
 const guarded=new BoardStore(root,()=>{throw Error('Storage blocked');});assert.throws(()=>guarded.mutate({action:'create',title:'blocked',revision:1}),/Storage blocked/);assert.equal(fs.readFileSync(path.join(root,'board.json'),'utf8'),before);
 fs.writeFileSync(path.join(root,'board-revision-1.json'),before);assert.equal(store.mutate({action:'create',title:'resume',revision:1}).revision,2);
});
test('手機入口沿用原版腳本與樣式，桌面入口才載入新功能',()=>{
 const source=fs.readFileSync(path.join(__dirname,'edition-ui.js'),'utf8');
 function entry(mobile){const writes=[],changes=[];const document={body:{classList:{add:v=>changes.push(v)}},querySelector:()=>({set textContent(v){changes.push(v);}}),write:v=>writes.push(v)};vm.runInNewContext(source,{window:{},document,matchMedia:()=>({matches:mobile})});return {html:writes.join(''),changes};}
 const phone=entry(true);assert.equal(phone.changes.length,0);assert.ok(phone.html.includes('/platform-ui.js'));assert.ok(phone.html.includes('/native-ui.js'));assert.ok(phone.html.includes('/lineage-ui.js'));assert.ok(!phone.html.includes('next-ui.js'));assert.ok(!phone.html.includes('next.css'));assert.ok(!phone.html.includes('desktop-'));
 const desktop=entry(false);assert.ok(desktop.html.includes('desktop-lineage-ui.js'));assert.ok(desktop.html.includes('next-ui.js'));assert.ok(desktop.html.includes('next.css'));
});
test('隨附 CSS 及手機前端 14 個檔案維持去敏後基準雜湊',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/upstream-assets.json')));
 const names=['index.html','style.css','live.css','lineage.css','platform-ui.js','app.js','native-ui.js','lineage-ui.js','live-ui.js','conversation-tree.js','routing-rules.js','routing-ui.js','pair-ui.js','organize-ui.js'];
 for(const name of names){const expected=manifest.files.find(f=>f.kind==='source'&&f.path===name);assert.ok(expected,name);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',name))).digest('hex'),expected.sha256,name);}
});
test('桌面建立新版獨立對話；手機及既有對話保持原後端，不把進階指令轉送成停止',async t=>{
 const f=await setup(t);const created=await (await f.post('/api/native/create',{provider:'codex'},{'X-Cantus-Next-Desktop':'1'})).json();assert.equal(created.nextOwned,true);assert.ok(created.id.startsWith('panel_'));assert.equal(f.calls.filter(c=>c.url==='/api/native/create').length,0);
 const catalog=await (await fetch(f.origin+'/api/sessions')).json();assert.ok(catalog.sessions.some(s=>s.id===created.id&&s.nextOwned));const cap=await (await fetch(f.origin+'/api/native/capability?id='+created.id)).json();assert.equal(cap.advanced.steer,true);assert.equal(cap.switchable,false);const history=await (await fetch(f.origin+'/api/history?id='+created.id)).json();assert.equal(history.totalRows,0);
 const response=await f.post('/api/native/create',{provider:'codex'});assert.equal((await response.json()).echo.provider,'codex');assert.equal(f.calls.filter(c=>c.url==='/api/native/create').length,1);
 assert.equal((await f.post('/api/next/steer',{id:'original-a',text:'do not forward',requestId:'not-forwarded'})).status,409);assert.equal(f.calls.filter(c=>c.url.includes('steer')||c.url.includes('/stop')).length,0);
 assert.equal((await fetch(f.origin+'/api/next/run?id=original-a')).status,404);assert.equal((await f.post('/api/next/run',{})).status,405);
});
test('Live 加入新版真實回合；只對執行中同一 PID 去重，結束後不遮住重用 PID',async t=>{
 const f=await setup(t),runner=f.server.advanced,s=await runner.create('codex');const run={id:s.id,requestId:'fixture-request',provider:'codex',busy:true,phase:'running',texts:new Map(),approvals:new Map(),pending:new Map(),child:{pid:777}};runner.runs.set(s.id,run);runner.log(run);
 let snapshot=await (await fetch(f.origin+'/api/live')).json();assert.equal(snapshot.machines[0].jobs.length,1);assert.equal(snapshot.machines[0].jobs[0].status,'running');assert.equal(snapshot.machines[0].jobs[0].sessionId,s.id);
 run.busy=false;run.phase='completed';snapshot=await (await fetch(f.origin+'/api/live')).json();assert.equal(snapshot.machines[0].jobs.length,2);assert.equal(snapshot.machines[0].jobs.find(j=>j.sessionId===s.id).status,'ended');
});
