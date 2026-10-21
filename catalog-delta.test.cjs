'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {CatalogDelta}=require('./catalog-delta.cjs');
const fixture=()=>({sessions:Array.from({length:5690},(_,i)=>({id:String(i),title:'Fixture '+i,provider:'codex',padding:'x'.repeat(500)})),providers:[],includeBackground:true,scannedAt:'first'});
test('unchanged catalog is tiny; changed, deleted, reordered and added rows remain exact',()=>{
 const service=new CatalogDelta(),value=fixture(),first=service.reply(value),next={...value,scannedAt:'second'};
 const unchanged=service.reply(next,first.catalogVersion);assert.equal(unchanged.notModified,true);assert.ok(JSON.stringify(unchanged).length<200);
 next.sessions=[{...value.sessions[1],title:'Renamed'},...value.sessions.slice(2),{id:'new',title:'New'}];
 const delta=service.reply(next,first.catalogVersion);assert.equal(delta.delta,true);assert.equal(delta.sessions.length,2);assert.deepEqual(delta.removed,['0']);
 const map=new Map(first.sessions.map(s=>[s.id,s]));for(const id of delta.removed)map.delete(id);for(const s of delta.sessions)map.set(s.id,s);assert.deepEqual(delta.order.map(id=>map.get(id)),next.sessions);
 assert.ok(Buffer.byteLength(JSON.stringify(delta))<Buffer.byteLength(JSON.stringify(first))/20);
});
test('metadata changes are delivered; unknown baselines and visibility scopes receive full catalog',()=>{
 const service=new CatalogDelta(),value=fixture(),first=service.reply(value);
 const changed=service.reply({...value,cantusFolders:[{id:'folder',name:'Folder'}]},first.catalogVersion);assert.equal(changed.delta,true);assert.equal(changed.sessions.length,0);assert.equal(changed.cantusFolders[0].name,'Folder');
 assert.equal(service.reply(value,'f'.repeat(64)).sessions.length,5690);
 const hidden=service.reply({...value,includeBackground:false,sessions:[]},first.catalogVersion);assert.equal(hidden.notModified,undefined);assert.equal(hidden.delta,undefined);assert.deepEqual(hidden.sessions,[]);
});
