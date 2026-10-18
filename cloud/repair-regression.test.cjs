const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
test('mobile reading, explicit source AI, visible picker, draft retention, automatic unblock',async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
 try{const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),errors=[],writes=[];let available=false,reads=0;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const r=route.request(),p=new URL(r.url()).pathname;let v={};
 if(p.startsWith('/api/')){if(r.method()!=='GET')writes.push(p);if(p==='/api/bootstrap')v={csrf:'fixture'};if(p==='/api/sessions')v={sessions:[{id:'fixture',title:'Original project conversation',provider:'codex',sourceProvider:'codex',activeProvider:'claude',handoff:true,managed:true,projectId:'original',projectName:'Original',projectSource:'desktop-group',hasTranscript:true}],providers:[]};if(p==='/api/history')v={rows:[{role:'assistant',provider:'claude',text:'History remains readable.'}],totalRows:1};if(p==='/api/native/capability'){reads++;v={available,switchable:true,routing:true,note:available?'ready':'source busy'};}if(p==='/api/native/status')v={busy:false,phase:'idle',approvals:[]};return route.fulfill({contentType:'application/json',body:JSON.stringify(v)});}
 const f=path.join(__dirname,'..',p==='/'?'index.html':p.slice(1));return route.fulfill({status:fs.existsSync(f)?200:404,contentType:f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html',body:fs.existsSync(f)?fs.readFileSync(f):''});});
 await page.goto('http://cantus.test/');await page.locator('.session').click();
 await page.getByText('History remains readable.',{exact:true}).waitFor();const picker=page.getByLabel('回覆 AI',{exact:true}),input=page.getByLabel('續聊訊息',{exact:true}),send=page.getByRole('button',{name:'送出',exact:true});
 await picker.waitFor();assert.equal(await picker.inputValue(),'codex');assert.equal(await picker.evaluate(e=>getComputedStyle(e).opacity),'1');await input.fill('Keep this draft');assert.equal(await send.isEnabled(),false);
 available=true;await page.waitForFunction(()=>!document.querySelector('.send-message').disabled,{timeout:8000});assert.ok(reads>=2);assert.equal(await input.inputValue(),'Keep this draft');
 await picker.selectOption('claude');await page.locator('.routing-chat-note:visible').waitFor();assert.match(await page.locator('.routing-chat-note').textContent(),/不會把回覆寫進原 AI/);await picker.selectOption('codex');
 for(const width of [320,390,1512,390]){await page.setViewportSize({width,height:844});await picker.waitFor({state:'visible'});const r=await picker.boundingBox();assert.ok(r&&r.width>=90&&r.x+r.width<=width);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await page.getByRole('button',{name:'返回會話清單'}).click();await page.locator('.session').click();assert.equal(await input.inputValue(),'Keep this draft');assert.equal(await picker.inputValue(),'codex');
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 }finally{await browser.close();}
});
