const {test}=require('node:test'),assert=require('node:assert/strict');
const {presentCatalog}=require('./catalog.cjs');
const {HandoffRunner}=require('./handoff.cjs');
test('large catalog keeps every ID and original title while bounding display payload',()=>{
 const sessions=Array.from({length:10000},(_,i)=>({id:'fixture_'+i,provider:'codex',title:'文'.repeat(4096)}));
 const result=presentCatalog({sessions,providers:[]},[],true);
 assert.equal(result.sessions.length,10000);assert.equal(sessions[0].title.length,4096);assert.equal(result.sessions[0].title.length,300);
 assert.ok(Buffer.byteLength(JSON.stringify(result))<16*1024*1024);
});
test('handoff remains in original project and provider after another AI replies',()=>{
 const r=Object.create(HandoffRunner.prototype);r.records=new Map([['fixture',{id:'fixture',entry:{id:'fixture',provider:'codex',projectId:'project',projectName:'Original',projectSource:'desktop-group'},provider:'claude'}]]);
 const s=r.list()[0];assert.equal(s.provider,'codex');assert.equal(s.sourceProvider,'codex');assert.equal(s.activeProvider,'claude');
 const groups=require('./conversation-tree.js').build([s],{projects:[{id:'project',name:'Original',provider:'codex',projectSource:'desktop-group'}]});assert.equal(groups.length,1);assert.equal(groups[0].count,1);
});
