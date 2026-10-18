'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
test('lost send response reconciles the same request without a second POST or clearing a new draft',async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
 try{
  const page=await browser.newPage(),errors=[];let sent=0,requestId='',phase='idle';page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const req=route.request(),p=new URL(req.url()).pathname;let data={};
   if(p.startsWith('/api/')){
    if(p==='/api/sessions')data={sessions:[{id:'fixture',provider:'codex',title:'Fixture',hasTranscript:true,projectId:'fixture-project',projectName:'Fixture project',projectSource:'desktop-group'}],providers:[]};
    if(p==='/api/history')data={rows:[{role:'assistant',text:'Original history'}],totalRows:1};
    if(p==='/api/bootstrap')data={csrf:'fixture'};
    if(p==='/api/native/capability')data={available:true,switchable:true,routing:true,note:'fixture'};
    if(p==='/api/native/send'){sent++;requestId=req.postDataJSON().requestId;phase='preparing';return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'upstream timeout'})});}
    if(p==='/api/native/status')data={requestId,busy:phase==='preparing'||phase==='running',phase,approvals:[]};
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   }
   const f=path.join(process.env.CANTUS_TEST_ASSETS||path.join(__dirname,'..'),p==='/'?'index.html':p.slice(1));return route.fulfill({status:fs.existsSync(f)?200:404,contentType:f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html',body:fs.existsSync(f)?fs.readFileSync(f):''});
  });
  await page.goto('https://cantus.test/');await page.locator('.session').click();const input=page.getByLabel('續聊訊息',{exact:true});await input.fill('First request');await page.getByRole('button',{name:'送出',exact:true}).click();
  await page.getByRole('button',{name:'加入排隊',exact:true}).waitFor();assert.equal(sent,1);assert.equal(await input.inputValue(),'');assert.match(await page.locator('.delivery-state').innerText(),/已接收/);
  await input.fill('New unsent draft');phase='running';await page.waitForFunction(()=>document.querySelector('.native-state').textContent.includes('回覆中'));
  phase='completed';await page.waitForFunction(()=>document.querySelector('.delivery-state')===null);assert.equal(await input.inputValue(),'New unsent draft');assert.equal(sent,1);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
