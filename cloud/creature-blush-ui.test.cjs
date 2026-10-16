'use strict';
// Optional browser regression: set CANTUS_PLAYWRIGHT_PATH and CANTUS_CHROME_PATH.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.CANTUS_PLAYWRIGHT_PATH||'playwright');
const root=process.env.CANTUS_TEST_ROOT||path.join(__dirname,'..');
for(const surface of ['login','inside'])test(surface+' four independent blush reactions preserve inputs and motion',async()=>{
 const browser=await chromium.launch({...(process.env.CANTUS_CHROME_PATH?{executablePath:process.env.CANTUS_CHROME_PATH}:{}),headless:true});
 try{for(const touch of [false,true]){
  const context=await browser.newContext({viewport:{width:touch?390:1440,height:900},hasTouch:touch,reducedMotion:'reduce',deviceScaleFactor:2});
  const page=await context.newPage(),errors=[];let writes=0;page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const req=route.request(),p=new URL(req.url()).pathname;
   if(req.method()!=='GET'){writes++;return route.fulfill({status:403,body:'{}'});}
   if(p.startsWith('/api/'))return route.fulfill({contentType:'application/json',body:JSON.stringify({sessions:[],providers:[]})});
   const file=p==='/login'?'cloud/login.html':p.startsWith('/login.')?'cloud'+p:p==='/'?'index.html':p.slice(1);
   if(!/^[a-z./-]+$/.test(file)||file.includes('..')||!fs.existsSync(path.join(root,file)))return route.abort();
   let body=fs.readFileSync(path.join(root,file),'utf8');if(file==='index.html')body=body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace('</body>','<script src="/conversation-tree.js"></script><script src="/app.js"></script></body>');
   return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body});
  });
  await page.goto('https://fixture.example.test/'+(surface==='login'?'login':''));
  const selector=surface==='login'?'.creature':'.frame-creature',sprites=page.locator(selector);await sprites.first().waitFor();assert.equal(await sprites.count(),4);
  const input=surface==='login'?page.getByLabel('帳號',{exact:true}):page.locator('#search');await input.fill('保留輸入');
  const flags=()=>sprites.evaluateAll(es=>es.map(e=>e.classList.contains('is-blushing')));
  for(let i=0;i<4;i++){
   if(touch)await sprites.nth(i).tap();else{const b=await sprites.nth(i).boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);}
   assert.deepEqual(await flags(),[0,1,2,3].map(n=>n===i));
   assert.equal(await sprites.nth(i).locator('.blush').evaluate(e=>getComputedStyle(e).opacity),'1');
   assert.equal(await sprites.nth(i).locator('.blush rect').count(),2);
   if(process.env.CANTUS_BLUSH_EVIDENCE&&i===2){fs.mkdirSync(process.env.CANTUS_BLUSH_EVIDENCE,{recursive:true});await page.screenshot({path:path.join(process.env.CANTUS_BLUSH_EVIDENCE,surface+(touch?'-touch':'-mouse')+'.png')});}
   if(touch)await page.waitForFunction(s=>![...document.querySelectorAll(s)].some(e=>e.classList.contains('is-blushing')),selector);else await page.mouse.move(1,899);
   assert.deepEqual(await flags(),[false,false,false,false]);
  }
  // A cancelled touch must not leave a permanently red face.
  await sprites.first().dispatchEvent('pointerdown',{pointerType:'touch'});await sprites.first().dispatchEvent('pointercancel',{pointerType:'touch'});assert.deepEqual(await flags(),[false,false,false,false]);
  assert.equal(await input.inputValue(),'保留輸入');assert.equal(writes,0);assert.deepEqual(errors,[]);
  await page.emulateMedia({reducedMotion:'no-preference'});const parade=page.locator(surface==='login'?'.creature-parade':'.frame-creature-parade'),before=await parade.getAttribute('style');await page.waitForFunction(({selector,before})=>document.querySelector(selector).getAttribute('style')!==before,{selector:surface==='login'?'.creature-parade':'.frame-creature-parade',before});
  await context.close();
 }}finally{await browser.close();}
});
