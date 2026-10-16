'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createServer}=require('./server.cjs'),{createGateway}=require('./cloud/gateway.cjs'),{LabStore}=require('./lab/store.cjs');
function request(server,url,method='GET',data,headers={}){return new Promise((resolve,reject)=>{const r=http.request({host:'127.0.0.1',port:server.address().port,path:url,method,headers:{Host:'127.0.0.1:4589',...headers}},s=>{let text='';s.on('data',p=>text+=p);s.on('end',()=>resolve({status:s.statusCode,text,headers:s.headers}));});r.on('error',reject);r.end(data);});}
async function start(server,t){await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return server;}
test('default mode is disconnected; synthetic catalog works; execution is blocked',async t=>{
 const server=await start(createServer(),t),runtime=require('./runtime.cjs');assert.equal(runtime.demo,true);assert.equal(runtime.execution,false);
 const list=await request(server,'/api/sessions');assert.equal(list.status,200);const data=JSON.parse(list.text);assert.equal(data.sessions.length,10);assert.ok(data.sessions.every(s=>s.id.startsWith('demo_')&&!s.cwd));
 const history=await request(server,'/api/history?id=demo_codex_0&provider=codex');assert.equal(history.status,200);assert.match(history.text,/虛構/);
 assert.equal((await request(server,'/api/native/create','POST','{}')).status,403);
 assert.equal((await request(server,'/api/sessions','GET',undefined,{Host:'outside.example'})).status,403);
 assert.equal(JSON.parse((await request(server,'/api/native/capability?id=demo_codex_0')).text).available,false);
 const models=JSON.parse((await request(server,'/api/routing/models')).text);assert.equal(models.codex.available,false);assert.equal(models.claude.available,false);
 const live=JSON.parse((await request(server,'/api/live')).text);assert.equal(live.machines.length,1);assert.deepEqual(live.machines[0].jobs,[]);
 assert.equal((await request(server,'/api/pair')).status,404);assert.equal((await request(server,'/api/dispatch','POST','{}')).status,404);assert.equal((await request(server,'/api/m1/sessions')).status,404);
});
test('gateway requires authentication, enforces same origin, and returns only configured upstream',async t=>{
 const store=new LabStore(':memory:');t.after(()=>store.close());const password='fictional-fixture-only-'+Date.now();store.addUser('demo-editor',password);
 let calls=0;const gateway=await start(createGateway({store,domain:'panel.example.test',upstream:async()=>{calls++;return {status:200,body:Buffer.from('{}')};}}),t);
 const headers={Host:'panel.example.test',Origin:'https://panel.example.test','Content-Type':'application/json'};
 assert.equal((await request(gateway,'/','GET',undefined,headers)).status,303);
 assert.equal((await request(gateway,'/api/sessions','GET',undefined,headers)).status,401);assert.equal(calls,0);
 assert.equal((await request(gateway,'/login','GET',undefined,headers)).status,200);
 assert.equal((await request(gateway,'/auth/login','POST','{}',{...headers,Origin:'https://other.example.test'})).status,403);
 const login=await request(gateway,'/auth/login','POST',JSON.stringify({user:'demo-editor',password}),headers);assert.equal(login.status,200);const cookie=login.headers['set-cookie'][0];assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
 const auth={...headers,Cookie:cookie.split(';')[0]},boot=JSON.parse((await request(gateway,'/api/bootstrap','GET',undefined,auth)).text);
 assert.deepEqual(boot.workspace,{authenticated:true,role:'editor'});
 assert.equal((await request(gateway,'/api/sessions','GET',undefined,auth)).status,200);assert.equal(calls,2);
 assert.equal((await request(gateway,'/api/native/create','POST','{}',auth)).status,403);
 assert.equal((await request(gateway,'/auth/logout','POST','{}',{...auth,'X-Cantus-Token':boot.csrf})).status,200);
 assert.equal((await request(gateway,'/api/sessions','GET',undefined,auth)).status,401);
});
test('viewer can read Lineage and logout but cannot modify relations',async t=>{
 const store=new LabStore(':memory:');t.after(()=>store.close());const password='fictional-viewer-only-'+Date.now();store.addUser('demo-viewer',password,'viewer');
 let writes=0;const server=await start(createGateway({store,domain:'panel.example.test',upstream:async(_port,_url,method)=>{if(method==='POST')writes++;return {status:200,body:Buffer.from('{}')};}}),t);
 const headers={Host:'panel.example.test',Origin:'https://panel.example.test','Content-Type':'application/json'};
 const login=await request(server,'/auth/login','POST',JSON.stringify({user:'demo-viewer',password}),headers),auth={...headers,Cookie:login.headers['set-cookie'][0].split(';')[0]};
 const boot=JSON.parse((await request(server,'/api/bootstrap','GET',undefined,auth)).text);assert.equal(boot.workspace.role,'viewer');auth['X-Cantus-Token']=boot.csrf;
 assert.equal((await request(server,'/api/lineage','GET',undefined,auth)).status,200);assert.equal((await request(server,'/api/lineage','POST','{}',auth)).status,403);assert.equal(writes,0);
 assert.equal((await request(server,'/auth/logout','POST','{}',auth)).status,200);assert.equal((await request(server,'/api/lineage','GET',undefined,auth)).status,401);
});
