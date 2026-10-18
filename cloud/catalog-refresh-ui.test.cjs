'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
test('automatic catalog refresh adds a session without replacing the active composer or draft',async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
 try{const page=await browser.newPage(),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));let reads=0,added=false;
 const root=process.env.CANTUS_TEST_ASSETS||path.join(__dirname,'..'),session={id:'panel_refresh_original',title:'既有隔離會話',provider:'codex',managed:true,hasTranscript:true,updatedAt:'2026-10-18T00:00:00Z'};
 await page.route('http://refresh.test/**',async route=>{const req=route.request(),u=new URL(req.url()),p=u.pathname;
  const send=value=>route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
  if(req.method()!=='GET'){writes.push(p);return route.fulfill({status:403,body:'{}'});}
  if(p==='/api/bootstrap')return send({csrf:'fixture',pair:false});
  if(p==='/api/sessions'){reads++;return send({sessions:[session,...(added?[{...session,id:'panel_refresh_added',title:'新建自動出現'}]:[])],providers:[]});}
  if(p==='/api/history')return send({rows:[{role:'assistant',text:'既有對話保持不動'}],totalRows:1});
  if(p==='/api/native/capability')return send({available:true,switchable:true,sourceSessionId:'fixture'});
  if(p==='/api/native/status')return send({busy:false,phase:'idle',approvals:[]});
  if(p.startsWith('/api/'))return send({});
  const file=p==='/'?'index.html':p.slice(1);if(!/^[a-z.-]+$/.test(file)||!fs.existsSync(path.join(root,file)))return route.fulfill({status:404,body:''});
  return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(path.join(root,file))});
 });
 await page.goto('http://refresh.test/');await page.waitForFunction(()=>catalog.sessions.length===1);await page.evaluate(()=>select(catalog.sessions[0]));
 const input=page.getByRole('textbox',{name:'續聊訊息',exact:true});await input.fill('草稿不能消失');await page.evaluate(()=>{document.querySelector('.composer').dataset.retained='yes';});added=true;
 await page.waitForFunction(()=>catalog.sessions.some(s=>s.id==='panel_refresh_added'),{},{timeout:20000});
 assert.equal(await input.inputValue(),'草稿不能消失');assert.equal(await page.locator('.composer').getAttribute('data-retained'),'yes');assert.equal(await page.evaluate(()=>selected),'panel_refresh_original');assert.ok(reads>=2);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
