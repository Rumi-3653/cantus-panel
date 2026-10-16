'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {build,project}=require('./conversation-tree.js');
const s=(id,extra={})=>({id,provider:'claude',title:id,source:'Claude Desktop',projectId:'alpha',projectName:'範例專案 Alpha',projectSource:'desktop-group',updatedAt:'2026-10-01',...extra});
const flatten=nodes=>nodes.flatMap(n=>[n.session.id,...flatten(n.children)]);
test('Codex native project order, empty projects and identical Claude names remain distinct',()=>{
 const projects=[{id:'empty',provider:'codex',name:'小短片',projectSource:'desktop-group',projectOrder:0,defaultExpanded:true},{id:'alpha',provider:'codex',name:'範例專案 Alpha',projectSource:'desktop-group',projectOrder:1,defaultExpanded:true}];
 const rows=[s('claude'),s('codex-old',{provider:'codex',projectRecency:1}),s('codex-new',{provider:'codex',projectRecency:2})];
 const g=build(rows,{projects});assert.deepEqual(g.map(g=>g.key),['native:codex:empty','native:codex:alpha','native:claude:alpha']);assert.equal(g[0].count,0);assert.equal(g[0].defaultExpanded,true);assert.deepEqual(g[1].roots.map(n=>n.session.id),['codex-new','codex-old']);assert.equal(g.reduce((n,g)=>n+g.count,0),3);
 assert.deepEqual(build(rows,{projects,query:'小短片'}).map(g=>g.key),['native:codex:empty']);assert.equal(build(rows,{projects,query:'不存在'}).length,0);
});
test('unassigned folders are contained under unclassified instead of flooding the project list',()=>{
 const g=build([s('native'),s('folder',{projectSource:'cwd',cwd:'/work/project'}),s('home',{projectSource:'cwd',cwd:'/home/fixture'}),s('other-folder',{projectSource:'cwd',cwd:'/work/other'})]);assert.deepEqual(g.map(x=>x.name),['範例專案 Alpha','未分類']);assert.equal(g[1].count,3);assert.equal(g[1].subgroups.length,2);assert.equal(g[1].roots.length,1);assert.equal(g.reduce((v,x)=>v+x.count,0),4);
});
test('native projects group first; explicit branches nest and sort by latest subtree activity',()=>{
 const rows=[s('parent'),s('child',{parentId:'parent',parentRelation:'fork',updatedAt:'2026-10-17'}),s('other',{updatedAt:'2026-10-16'}),s('unrelated',{title:'parent child'})];const original=JSON.stringify(rows),g=build(rows);
 assert.equal(g.length,1);assert.equal(g[0].name,'範例專案 Alpha');assert.deepEqual(g[0].roots.map(n=>n.session.id),['parent','other','unrelated']);assert.equal(g[0].roots[0].children[0].session.id,'child');assert.equal(g[0].count,4);assert.equal(JSON.stringify(rows),original);
});
test('unclassified, archived and explicit background sources remain separate and no title guessing',()=>{
 const rows=[s('home',{projectSource:'cwd',projectName:'fixture',cwd:'/home/fixture'}),s('blank',{projectId:'',projectName:'',projectSource:''}),s('test',{managed:true,title:'Isolated Cantus local connection test. Remember marker'}),s('agent',{backgroundReason:'子代理'}),s('archived',{archived:true}),s('real',{title:'修正測試失敗，做程式審查'})];const g=build(rows);
 assert.deepEqual(g.map(x=>x.name),['範例專案 Alpha','未分類','已封存','背景／測試']);assert.deepEqual(flatten(g.find(x=>x.kind==='background').roots),['test','agent']);assert.equal(g.find(x=>x.kind==='project').roots[0].session.id,'real');
 assert.notEqual(project(s('a',{projectId:'one'})).key,project(s('b',{projectId:'two'})).key);
});
test('search retains parent path, while provider, project, missing-parent and cycle boundaries never lose rows',()=>{
 const rows=[s('p'),s('c',{parentId:'p',title:'找這個分支'}),s('other')];const g=build(rows,{query:'找這個'});assert.deepEqual(flatten(g[0].roots),['p','c']);assert.equal(g[0].roots[0].match,false);
 for(const rows of [[s('a',{parentId:'b'}),s('b',{parentId:'a'})],[s('a',{parentId:'missing'})],[s('a',{parentId:'b'}),s('b',{provider:'codex'})],[s('a',{parentId:'b'}),s('b',{projectId:'elsewhere'})]]){const all=build(rows).flatMap(g=>flatten(g.roots));assert.equal(all.length,rows.length);assert.equal(new Set(all).size,rows.length);}
 const deep=Array.from({length:100},(_,i)=>s('deep'+i,{parentId:i?'deep'+(i-1):''}));assert.equal(build(deep).flatMap(g=>flatten(g.roots)).length,100);
});
