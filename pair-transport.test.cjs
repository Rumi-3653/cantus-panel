'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createTransport}=require('./pair-transport.cjs');
test('configured loopback transport uses peer CSRF and never accepts a caller-selected host',async t=>{
 const calls=[],server=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;calls.push({url:req.url,method:req.method,host:req.headers.host,origin:req.headers.origin,token:req.headers['x-cantus-token'],raw});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/api/bootstrap'?{csrf:'fixture-token'}:{ok:true}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 assert.throws(()=>createTransport({port:0}),/port/);assert.throws(()=>createTransport({port:'4592'}),/port/);
 const remote=createTransport({port:server.address().port});assert.equal((await remote('/api/dispatch','POST',{requestId:'fixture-only'})).ok,true);assert.equal(calls.length,2);assert.equal(calls[0].url,'/api/bootstrap');assert.equal(calls[1].host,'127.0.0.1:4589');assert.equal(calls[1].origin,'http://127.0.0.1:4589');assert.equal(calls[1].token,'fixture-token');assert.deepEqual(JSON.parse(calls[1].raw),{requestId:'fixture-only'});
});
