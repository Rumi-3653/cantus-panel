'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createServer}=require('./server.cjs'),demo=require('./demo.cjs');
test('normal sessions reads rescan after 15 seconds without manual refresh',async t=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const read=()=>new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port:server.address().port,path:'/api/sessions',headers:{Host:'127.0.0.1:4589'}},r=>{let text='';r.on('data',x=>text+=x);r.on('end',()=>resolve(JSON.parse(text)));}).on('error',reject);});
 const before=await read(),row={...demo.sessions[0],id:'demo_auto_refresh',title:'新的隔離會話'};demo.sessions.push(row);
 t.after(()=>{demo.sessions.splice(demo.sessions.indexOf(row),1);});
 assert.equal((await read()).sessions.length,before.sessions.length);
 const now=Date.now;Date.now=()=>now()+16000;t.after(()=>{Date.now=now;});
 const after=await read();assert.ok(after.sessions.some(s=>s.id===row.id));assert.equal(after.sessions.length,before.sessions.length+1);
});
