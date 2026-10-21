'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {splitProjection,execution}=require('./next-model.js');
const node=id=>({id,title:id});
test('拆分樹保留完整分支、收合只影響畫面，依賴及交接不當成子工作',()=>{
 const data={nodes:['a','b','c','d','other'].map(node),edges:[{type:'split',from:'a',to:'b'},{type:'split',from:'b',to:'c'},{type:'split',from:'a',to:'d'},{type:'dependency',from:'a',to:'other'},{type:'handoff',from:'a',to:'other'}]};
 const before=JSON.stringify(data),open=splitProjection(data,'c'),folded=splitProjection(data,'c',new Set(['b']));
 assert.equal(open.root.node.id,'a');assert.equal(open.total,4);assert.equal(open.shown,4);assert.equal(open.maxDepth,2);
 assert.equal(folded.total,4);assert.equal(folded.shown,3);assert.equal(folded.truncated,false);assert.equal(JSON.stringify(data),before);
});
test('未知資料不補猜執行狀態，缺失來源及歷史循環仍可安全呈現',()=>{
 assert.equal(execution({status:'completed'}).phase,'unknown');assert.equal(execution({dispatch:{status:{phase:'completed'}}}).label,'本回合完成（未驗收）');
 const projection=splitProjection({nodes:['a','b'].map(node),edges:[{type:'split',from:'a',to:'b'},{type:'split',from:'b',to:'a'},{type:'split',from:'missing',to:'a'}]},'a');
 assert.equal(projection.total,2);assert.equal(projection.shown,2);assert.equal(projection.warnings.length,2);
 assert.equal(splitProjection({nodes:[],edges:[]}).root,null);
});
test('大型拆分樹顯示有上限，完整工作總數仍正確',()=>{
 const nodes=Array.from({length:5000},(_,i)=>node(String(i))),edges=nodes.slice(1).map((n,i)=>({type:'split',from:String(i),to:n.id}));
 const projection=splitProjection({nodes,edges},'4999');assert.equal(projection.total,5000);assert.equal(projection.shown,160);assert.equal(projection.truncated,true);
});
