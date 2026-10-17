'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {LineageStore}=require('../lineage.cjs'),{defaults}=require('../routing-rules.js');
const root=process.env.CANTUS_TEST_ASSETS||path.join(__dirname,'..');
for(const width of [390,320,768])test('mobile '+width+': full-screen navigation, drafts, send, queue, organize and workspace isolation',async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true}),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cantus-mobile-'));
 try{
  const context=await browser.newContext({viewport:{width,height:844},screen:{width,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'}),page=await context.newPage(),errors=[],sends=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
  const sessions=[{id:'panel_fixture001',title:'首頁設計討論',provider:'codex',managed:true,hasTranscript:true,updatedAt:'2026-10-17T00:00:00Z'},{id:'panel_fixture002',title:'文案整理',provider:'claude',managed:true,hasTranscript:true,updatedAt:'2026-10-17T00:00:00Z'}];
  const stores=new Map(),states=new Map();let created=0;
  const store=host=>{if(!stores.has(host))stores.set(host,new LineageStore({root:path.join(scratch,host),guard:()=>true}));return stores.get(host);};
  const state=(host,id)=>{const key=host+id;if(!states.has(key))states.set(key,{id,busy:false,phase:'idle',revision:0,approvals:[]});return states.get(key);};
  await page.route('**/*',async route=>{const r=route.request(),u=new URL(r.url()),p=u.pathname,send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
   if(p.startsWith('/api/')){let suffix=p.slice(5),host='local';if(['lab','m1','mda','arumwu'].includes(suffix.split('/')[0])){host=suffix.split('/')[0];suffix=suffix.slice(host.length+1);}
    const id=u.searchParams.get('id');
    if(suffix==='bootstrap')return send({csrf:'fixture',pair:false});
    if(suffix==='login')return send({user:'demo',role:'editor',token:'fixture-token'});if(suffix==='logout')return send({ok:true});
    if(suffix==='sessions')return send(store(host).catalog({sessions,providers:[]}));
    if(suffix==='history')return send({rows:Array.from({length:24},(_,i)=>({role:i%2?'assistant':'user',text:'這是隔離測試的第 '+i+' 則訊息。'.repeat(5),at:'2026-10-17T00:00:00Z'})),totalRows:30,hasMore:!u.searchParams.has('before'),pageStart:6,nextBefore:6,pageSignature:'fixture'});
    if(suffix==='native/capability')return send({available:true,switchable:true,routing:true,access:'full',sourceSessionId:'fixture',note:'測試權限說明：改檔和部署仍以使用者授權為準。'});
    if(suffix==='native/status')return send(state(host,id));
    if(suffix==='native/send'){const b=r.postDataJSON();sends.push({host,...b});assert.equal(state(host,b.id).busy,false);const v={...state(host,b.id),requestId:b.requestId,busy:true,phase:'running',revision:state(host,b.id).revision+1};states.set(host+b.id,v);return send(v);}
    if(suffix==='native/stop'){const b=r.postDataJSON(),v={...state(host,b.id),busy:false,phase:'stopped'};states.set(host+b.id,v);return send(v);}
    if(suffix==='native/create'){created++;const s={...sessions[0],id:'panel_created'+created,title:'新對話 '+created};sessions.unshift(s);return send(s);}
    if(suffix==='document')return send({content:'隔離共用文件',version:1,actor:'demo'});
    if(suffix==='lineage')return send(r.method()==='POST'?store(host).mutate(r.postDataJSON(),sessions,new Map()):store(host).snapshot(sessions,new Map()));
    if(suffix==='routing/settings')return send(defaults());if(suffix==='routing/models')return send({codex:{models:[],available:false},claude:{models:[],available:false}});
    if(suffix==='live')return send({machines:[{id:'local',name:'示範工作站',connected:true,observedAt:new Date().toISOString(),coverage:'隔離測試',jobs:[{id:'fixture-job',title:'整理文件',status:'running',source:'fixture',provider:'codex',readOnly:true,observedAt:new Date().toISOString()}]}]});
    return send({});
   }
   const file=p==='/'?'index.html':p.slice(1);if(!/^[a-z.-]+$/.test(file))return route.abort();const full=path.join(root,file);if(!fs.existsSync(full))return route.abort();return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(full)});
  });
  const screenshot=async name=>{if(process.env.CANTUS_MOBILE_EVIDENCE){fs.mkdirSync(process.env.CANTUS_MOBILE_EVIDENCE,{recursive:true});await page.screenshot({path:path.join(process.env.CANTUS_MOBILE_EVIDENCE,name+'-'+width+'.png')});}};
  const checkBox=async locator=>{const b=await locator.boundingBox();assert.ok(b&&b.x>=-1&&b.x+b.width<=width+1,JSON.stringify(b));return b;};
  const open=async title=>{await page.getByLabel('搜尋會話',{exact:true}).fill(title);await page.locator('.session').filter({hasText:title}).first().click();await page.getByLabel('續聊訊息',{exact:true}).waitFor();};
  await page.goto('https://fixture.example.test/');await page.locator('.mobile-nav').waitFor();await screenshot('list');
  assert.equal(await page.locator('#detail').isVisible(),false);const list=await checkBox(page.locator('.list-pane'));assert.ok(list.height>500,'list gets full usable height');
  await open('首頁設計討論');assert.equal(await page.locator('.list-pane').isVisible(),false);const input=page.getByLabel('續聊訊息',{exact:true});await input.fill('未送出的手機草稿');
  const transcript=await checkBox(page.locator('.transcript-scroll'));assert.ok(transcript.height>350,JSON.stringify(transcript));await checkBox(page.getByRole('button',{name:'送出',exact:true}));await screenshot('chat');
  const pickerBox=await checkBox(page.getByLabel('回覆 AI',{exact:true})),sendBox=await page.getByRole('button',{name:'送出',exact:true}).boundingBox(),composerBox=await page.locator('.composer').boundingBox();assert.equal(pickerBox.width,44);assert.ok(Math.abs(pickerBox.y-sendBox.y)<2,'AI picker and send share the inner toolbar');assert.ok(pickerBox.y>=composerBox.y&&pickerBox.y+pickerBox.height<=composerBox.y+composerBox.height);assert.equal(await page.locator('.native-state').isVisible(),false,'idle does not occupy a row');await page.getByLabel('回覆 AI',{exact:true}).selectOption('claude');assert.equal(await page.getByLabel('回覆 AI',{exact:true}).inputValue(),'claude');await page.locator('.mobile-route-icon .brand-claude').waitFor();await screenshot('claude-picker');await page.getByLabel('回覆 AI',{exact:true}).selectOption('codex');await page.locator('.mobile-route-icon .brand-codex').waitFor();await page.getByLabel('回覆 AI',{exact:true}).selectOption('auto');
  await page.getByRole('button',{name:'返回會話清單',exact:true}).click();await page.locator('.list-pane').waitFor();await open('首頁設計討論');assert.equal(await input.inputValue(),'未送出的手機草稿');
  await page.goBack();await page.locator('.list-pane').waitFor();await page.evaluate(()=>load(true));assert.equal(await page.locator('.app').getAttribute('data-mobile-view'),'list');await open('首頁設計討論');assert.equal(await input.inputValue(),'未送出的手機草稿');
  await page.locator('.transcript-scroll').evaluate(e=>e.scrollTop=0);assert.equal(await page.locator('.transcript-scroll').evaluate(e=>e.scrollTop),0);
  await page.getByRole('button',{name:'展開輸入選項',exact:true}).click();assert.match(await page.locator('.composer>.native-note').innerText(),/權限說明/);await page.getByRole('button',{name:'收合輸入選項',exact:true}).click();
  await input.fill('第一則手機訊息');await page.getByRole('button',{name:'送出',exact:true}).click();await page.getByRole('button',{name:'加入排隊',exact:true}).waitFor();assert.equal(sends.length,1);
  await input.fill('排隊但取消');await page.getByRole('button',{name:'加入排隊',exact:true}).click();await page.getByRole('button',{name:'取消排隊',exact:true}).click();assert.equal(await page.getByRole('button',{name:'取消排隊',exact:true}).count(),0);
  await input.fill('鍵盤仍可打字');await page.setViewportSize({width,height:460});await input.focus();await page.waitForTimeout(100);const send=await checkBox(page.getByRole('button',{name:'加入排隊',exact:true}));assert.ok(send.y>=0&&send.y+send.height<=460,JSON.stringify(send));await screenshot('keyboard');
  await page.setViewportSize({width,height:844});await page.getByRole('button',{name:'停止本回合',exact:true}).click();await page.getByRole('button',{name:'送出',exact:true}).waitFor();
  await page.getByRole('button',{name:'返回會話清單',exact:true}).click();await page.locator('.list-pane').waitFor();await page.getByLabel('搜尋會話',{exact:true}).fill('首頁設計討論');await page.getByRole('button',{name:'會話操作',exact:true}).first().click();await page.getByRole('menuitem',{name:'重新命名',exact:true}).click();await page.getByLabel('重新命名對話',{exact:true}).fill('手機已改名');await page.getByRole('button',{name:'儲存',exact:true}).click();await page.locator('.cantus-organize-dialog[open]').waitFor({state:'hidden'});await page.getByLabel('搜尋會話',{exact:true}).fill('');
  await page.getByRole('button',{name:'＋ 新增資料夾',exact:true}).click();await page.getByLabel('新增 Cantus 資料夾',{exact:true}).fill('手機分類');await page.getByRole('button',{name:'儲存',exact:true}).click();await page.locator('.cantus-organize-dialog[open]').waitFor({state:'hidden'});await page.waitForFunction(()=>!document.querySelector('.cantus-organize-dialog').open);await page.locator('.conversation-group-title').filter({hasText:'手機分類'}).waitFor();
  await open('手機已改名');await page.getByRole('button',{name:'對話資訊與操作',exact:true}).click();await page.getByRole('button',{name:'移動目前對話',exact:true}).click();await page.getByLabel('移至 Cantus 資料夾',{exact:true}).selectOption({label:'手機分類'});await page.getByRole('button',{name:'儲存',exact:true}).click();await page.locator('.cantus-organize-dialog[open]').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'工作關係',exact:true}).click();await page.locator('.lineage-heading').waitFor();await checkBox(page.locator('.lineage-graph'));await screenshot('lineage');
  await page.getByRole('button',{name:'工作動態',exact:true}).click();await page.locator('.live-job').waitFor();await checkBox(page.locator('.live-machine-row'));await screenshot('live');
  await page.getByRole('button',{name:'會話',exact:true}).click();await page.getByLabel('搜尋會話',{exact:true}).fill('');await page.getByRole('button',{name:'＋ 新對話',exact:true}).click();await page.getByLabel('續聊訊息',{exact:true}).waitFor();assert.equal(created,1);
  await page.getByRole('button',{name:'工作區與設定',exact:true}).click();await page.locator('.mobile-sheet[open]').waitFor();await screenshot('workspace');
  const picker=page.getByLabel('平台',{exact:true});if(await picker.count()){
   await picker.selectOption('cloud');await page.getByLabel('測試帳號',{exact:true}).fill('demo');await page.getByLabel('測試密碼',{exact:true}).fill('fixture');await page.locator('.lab-login button').click();await page.waitForFunction(()=>cantusPlatform.authenticated);await page.getByRole('button',{name:'關閉工作區與設定',exact:true}).click();await open('首頁設計討論');assert.equal(await input.inputValue(),'');await input.fill('僅限這台主機');await page.getByRole('button',{name:'工作區與設定',exact:true}).click();await picker.selectOption('local');await page.getByRole('button',{name:'關閉工作區與設定',exact:true}).click();await open('手機已改名');assert.equal(await input.inputValue(),'鍵盤仍可打字');
  }else await page.getByRole('button',{name:'關閉工作區與設定',exact:true}).click();
  await page.setViewportSize({width:844,height:390});await page.waitForTimeout(100);assert.equal(await page.locator('.mobile-nav').isVisible(),true);const landscapeSend=await page.getByRole('button',{name:'送出',exact:true}).boundingBox();assert.ok(landscapeSend&&landscapeSend.y>=0&&landscapeSend.y+landscapeSend.height<=390,JSON.stringify(landscapeSend));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await screenshot('landscape');
  await page.setViewportSize({width:1512,height:982});await page.locator('.app>.sidebar').waitFor();assert.equal(await page.locator('.app>.sidebar').count(),1);assert.equal(await page.locator('.app>.inspector').count(),1);assert.equal(await page.locator('.mobile-nav').isVisible(),false);assert.equal(await page.locator('.composer-actions .provider-picker').count(),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await context.close();
 }finally{await browser.close();fs.rmSync(scratch,{recursive:true,force:true});}
});
