'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {defaults,validate,choose}=require('./routing-rules.js'),{RoutingStore}=require('./routing.cjs'),{ModelCatalog}=require('./model-catalog.cjs'),{PanelRunner}=require('./panel-runner.cjs');
test('recommended rules route intent, preserve followups, respect order and ignore quoted code',()=>{
 const c=defaults();for(const text of ['規劃一個網站','先討論如何修復 bug','不要寫程式，只分析錯誤'])assert.equal(choose(c,text).provider,'claude');
 for(const text of ['幫我修好登入錯誤','執行測試','請實作這個功能','refactor this function'])assert.equal(choose(c,text).provider,'codex');
 assert.equal(choose(c,'翻譯這篇文章').provider,'claude');assert.equal(choose(c,'hello').provider,'claude');assert.equal(choose(c,'decode the word').provider,'claude');
 assert.equal(choose(c,'繼續',{ruleId:'coding'}).provider,'codex');assert.equal(choose(c,'繼續',null).provider,'claude');assert.equal(choose(c,'```fix code```\n你好').provider,'claude');
 c.rules[0].keywords=['錯誤'];c.rules[0].provider='claude';assert.equal(choose(c,'錯誤').provider,'claude');c.rules[0].enabled=false;assert.equal(choose(c,'錯誤').provider,'codex');
});
test('configuration validates all boundaries without arbitrary expressions or model flags',()=>{
 assert.deepEqual(validate(defaults()),defaults());for(const model of ['--danger','x; command','../file','x\nflag']){const c=defaults();c.defaultTarget.model=model;assert.throws(()=>validate(c));}
 for(const model of ['gpt-6.1-sol','opus[1m]','claude-sonnet-5-5']){const c=defaults();c.defaultTarget.model=model;assert.equal(validate(c).defaultTarget.model,model);}
 const c=defaults();c.rules.push(c.rules[0]);assert.throws(()=>validate(c));assert.throws(()=>validate({...defaults(),revision:-1}));assert.throws(()=>validate({...defaults(),rules:Array(13).fill(defaults().rules[0])}));
});
test('settings persist with backup and stale writers cannot overwrite another tab',t=>{
 const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'cantus-routing-unit-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new RoutingStore(path.join(root,'routing.json')),c=store.read();c.rules[0].provider='codex';const saved=store.save(c);assert.equal(saved.revision,1);assert.equal(new RoutingStore(store.file).read().rules[0].provider,'codex');assert.throws(()=>store.save(c),/另一個視窗/);store.save(saved);assert.ok(fs.existsSync(store.file+'.revision-1.bak'));if(process.platform!=='win32')assert.equal(fs.statSync(store.file).mode&0o777,0o600);
});
test('catalog checks model and effort before dispatch and reports unavailable without guessing',async()=>{
 let calls=0;const catalog=new ModelCatalog(async()=>{calls++;return [{id:'fixture',efforts:['low','high']}];});
 assert.ok((await catalog.check({provider:'codex',model:'fixture',effort:'high'})).ok);assert.equal((await catalog.check({provider:'codex',model:'fixture',effort:'ultra'})).ok,false);assert.equal((await catalog.check({provider:'codex',model:'other',effort:''})).ok,false);assert.equal(calls,1);
 const offline=new ModelCatalog(async()=>{throw Error('offline');});assert.equal((await offline.get('claude')).available,false);
});
test('per-run model/effort reach Codex RPC and Claude CLI without cross-request leakage',async()=>{
 const calls=[],r=new PanelRunner({spawn:(_cmd,args)=>{calls.push(args);}});
 const run={provider:'codex',nextRpc:1,pending:new Map(),selection:{model:'gpt-fixture',effort:'high'}};r.write=(_r,frame)=>{calls.push(frame);r.pendingReply(run,frame.id,{},null);};
 await r.rpc(run,'thread/resume',{threadId:'same'});await r.rpc(run,'turn/start',{threadId:'same',input:[]});assert.equal(calls[0].params.model,'gpt-fixture');assert.equal(calls[1].params.model,'gpt-fixture');assert.equal(calls[1].params.effort,'high');
 const args=['--input-format','stream-json'];await Promise.all(['model_A','model_B'].map((model,index)=>r.withSelection({model,effort:'low'},async()=>{await new Promise(resolve=>setTimeout(resolve,index*5));r.spawn('claude',args,{});})));assert.deepEqual(args,['--input-format','stream-json']);assert.ok(calls[2].includes('model_A'));assert.ok(calls[3].includes('model_B'));r.spawn('claude',args,{});assert.deepEqual(calls[4],args);
});
