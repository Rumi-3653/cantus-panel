'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createServer}=require('./server.cjs');
test('pair and receiver routes require same-origin JSON and token; reads never dispatch',async t=>{
 let writes=0,reads=0;const pair={snapshot:async()=>{reads++;return {scope:'pair',nodes:[],edges:[],base:['internal']};},mutate:async()=>{writes++;return {nodes:[],edges:[],base:['internal']};}},receiver={receive:async()=>{writes++;return {ok:true};},status:()=>({phase:'idle'})};
 const server=createServer({pair,receiver});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const call=(url,method='GET',body,headers={})=>new Promise((resolve,reject)=>{const r=http.request({hostname:'127.0.0.1',port:server.address().port,path:url,method,headers:{Host:'127.0.0.1:4589',...headers}},s=>{let raw='';s.on('data',p=>raw+=p);s.on('end',()=>resolve({status:s.statusCode,data:JSON.parse(raw)}));});r.on('error',reject);r.end(body);});
 const boot=await call('/api/bootstrap'),headers={Origin:'http://127.0.0.1:4589','Content-Type':'application/json','X-Cantus-Token':boot.data.csrf};assert.equal(boot.data.pair,true);
 assert.equal((await call('/api/pair')).data.base,undefined);assert.equal(reads,1);assert.equal(writes,0);
 for(const url of ['/api/pair','/api/dispatch']){assert.equal((await call(url,'POST','{}')).status,403);assert.equal((await call(url,'POST','{}',{...headers,Origin:'https://outside.example'})).status,403);assert.equal((await call(url,'POST','invalid',headers)).status,400);assert.equal((await call(url,'POST','[]',headers)).status,400);assert.equal((await call(url,'POST','{}',headers)).status,200);}
 assert.equal(writes,2);
});
