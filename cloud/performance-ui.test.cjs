'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {CatalogDelta}=require('../catalog-delta.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
test('delta refresh preserves unchanged rows, collapsed groups and drafts; composer appears before slow history',async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],reads=[],writes=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
  const sessions=Array.from({length:1000},(_,i)=>({id:'fixture_'+i,title:'Fixture '+i,provider:'codex',hasTranscript:true,...(i<8?{projectId:'project',projectName:'Original',projectSource:'desktop-group'}:{})}));
  let value={sessions,providers:[],includeBackground:true},releaseHistory,historyRequested=false,capabilityRequested=false;
  const historyGate=new Promise(resolve=>releaseHistory=resolve),deltas=new CatalogDelta();
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),p=url.pathname;let data={};
   if(p.startsWith('/api/')){
    if(req.method()!=='GET')writes.push(p);
    if(p==='/api/sessions'){data=deltas.reply(value,url.searchParams.get('since'));reads.push({since:url.searchParams.get('since'),bytes:Buffer.byteLength(JSON.stringify(data)),delta:!!data.delta,notModified:!!data.notModified});}
    if(p==='/api/history'){historyRequested=true;await historyGate;data={rows:Array.from({length:120},(_,i)=>({role:'assistant',text:'Message '+i+'\n'+('searchable content '.repeat(80))})),totalRows:120};}
    if(p==='/api/native/capability'){capabilityRequested=true;data={available:true,switchable:true,routing:true,note:'fixture'};}
    if(p==='/api/native/status')data={busy:false,phase:'idle',approvals:[]};
    if(p==='/api/bootstrap')data={csrf:'fixture'};
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   }
   const f=path.join(process.env.CANTUS_TEST_ASSETS||path.join(__dirname,'..'),p==='/'?'index.html':p.slice(1));return route.fulfill({status:fs.existsSync(f)?200:404,contentType:f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html',body:fs.existsSync(f)?fs.readFileSync(f):''});
  });
  await page.goto('https://performance.test/');await page.locator('.session').first().waitFor();assert.ok(await page.locator('.session').count()<20,'collapsed unclassified rows are not built');
  await page.locator('.session').filter({hasText:/^Fixture 0Codex/}).click();const input=page.getByLabel('續聊訊息',{exact:true}),send=page.getByRole('button',{name:'送出',exact:true});await input.waitFor();await input.fill('Draft before history');
  assert.equal(historyRequested,true);assert.equal(await send.isEnabled(),false);await page.waitForFunction(()=>document.querySelector('.composer>.native-note')?.textContent==='fixture');assert.equal(capabilityRequested,true);
  releaseHistory();await page.waitForFunction(()=>!document.querySelector('.send-message').disabled);assert.equal(await input.inputValue(),'Draft before history');
  await page.evaluate(()=>{window.retainedRow=document.querySelector('[data-session-id="fixture_1"]');window.retainedButton=window.retainedRow.querySelector('.session');document.querySelector('.transcript-scroll').scrollTop=100;window.transcriptPosition=document.querySelector('.transcript-scroll').scrollTop;});
  value={...value,sessions:sessions.map(s=>s.id==='fixture_2'?{...s,title:'Renamed fixture'}:s)};await page.evaluate(()=>load());
  assert.equal(await page.evaluate(()=>retainedRow===document.querySelector('[data-session-id="fixture_1"]')&&retainedButton===retainedRow.querySelector('.session')),true);
  assert.equal(await page.locator('[data-session-id="fixture_2"] h3').innerText(),'Renamed fixture');assert.equal(await input.inputValue(),'Draft before history');assert.equal(reads.at(-1).delta,true);assert.ok(reads.at(-1).bytes<reads[0].bytes/10);
  await page.evaluate(()=>load());assert.equal(reads.at(-1).notModified,true);assert.ok(reads.at(-1).bytes<200);
  assert.equal(await page.locator('.transcript-scroll .message').first().evaluate(e=>getComputedStyle(e).contentVisibility),'auto');
  assert.equal(await page.locator('.transcript-scroll .message:not(.live-message)').count(),120);assert.equal(await page.evaluate(()=>document.querySelector('.transcript-scroll').scrollTop===transcriptPosition),true);
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);console.log(JSON.stringify({initialCatalogBytes:reads[0].bytes,changedCatalogBytes:reads.at(-2).bytes,unchangedCatalogBytes:reads.at(-1).bytes,retainedRows:true,composerBeforeHistory:true}));
 }finally{await browser.close();}
});
