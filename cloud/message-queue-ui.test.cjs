'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const portable=!fs.existsSync(path.join(__dirname,'assets'));
for(const provider of ['codex','claude'])test(provider+': busy composer queues FIFO, keeps drafts, cancels, isolates hosts and pauses uncertain deliveries',async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],sent=[];
 page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
 const id='panel_fixture001',second='panel_fixture002',sessions=[id,second].map((id,i)=>({id,title:'Queue fixture '+i,provider,managed:true,hasTranscript:true,updatedAt:'2026-01-01T00:00:00Z'}));
 const statuses={local:{id,requestId:'previous001',busy:true,phase:'running',revision:1,approvals:[]},m1:{id,requestId:'m1previous001',busy:true,phase:'running',revision:1,approvals:[]},lab:{id,requestId:'labprevious001',busy:true,phase:'running',revision:5,approvals:[]}};
 let rejectNext=false;
 await page.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url()),p=u.pathname,send=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  if(p.startsWith('/api/')){
   let suffix=p.slice(5),host='local';if(['m1','lab'].includes(suffix.split('/')[0])){host=suffix.split('/')[0];suffix=suffix.slice(host.length+1);}
   if(suffix==='bootstrap')return send({csrf:'fixture'});
   if(suffix==='login')return send({token:'synthetic-token',role:'editor',user:'demo'});
   if(suffix==='logout')return send({ok:true});
   if(suffix==='document')return send({content:'',version:1});
   if(suffix==='sessions')return send({sessions,providers:[]});
   if(suffix==='history')return send({rows:[{role:'user',text:'Isolated synthetic fixture'}],totalRows:1});
   if(suffix==='native/capability')return send({available:true,switchable:true,note:'fixture'});
   if(suffix==='native/status')return send(u.searchParams.get('id')===second?{id:second,busy:false,phase:'idle'}:statuses[host]);
   if(suffix==='native/send'){
    const body=req.postDataJSON();sent.push({host,...body});
    if(host==='lab'){assert.equal(req.headers().authorization,'Bearer synthetic-token');assert.equal(body.revision,statuses.lab.revision);}
    if(rejectNext){rejectNext=false;return send({error:'Synthetic unknown delivery'},502);}
    assert.equal(statuses[host].busy,false,'must not submit while busy');
    statuses[host]={id,requestId:body.requestId,busy:true,phase:'running',revision:statuses[host].revision+1,approvals:[]};return send(statuses[host]);
   }
   if(suffix==='native/stop'){statuses[host]={...statuses[host],busy:false,phase:'stopped'};return send(statuses[host]);}
   if(suffix==='routing/settings')return send({version:1,revision:1,enabled:false,rules:[],defaultTarget:{provider:'codex'}});
   if(suffix==='live')return send({machines:[]});
   if(suffix==='lineage')return send({nodes:[],edges:[]});
   return send({});
  }
  const file=p==='/'?'index.html':p.slice(1);if(!/^[a-z.-]+$/.test(file))return route.abort();
  const full=path.join(__dirname,portable||file==='native-ui.js'?'..':'assets',file);if(!fs.existsSync(full))return route.abort();
  return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(full)});
 });
 const open=async()=>{await page.locator('.conversation-group').first().waitFor();for(const summary of await page.locator('.conversation-group:not([open]) > summary').all())await summary.click();await page.locator('.session').filter({hasText:'Queue fixture 0'}).click();await page.getByRole('button',{name:'加入排隊',exact:true}).waitFor();};
 const queue=async text=>{await page.getByLabel('續聊訊息',{exact:true}).fill(text);await page.getByRole('button',{name:'加入排隊',exact:true}).click();};
 const complete=host=>statuses[host]={...statuses[host],busy:false,phase:'completed',historyUpdated:true,revision:statuses[host].revision+1};
 try{
  await page.goto('https://panel.example.test/');await open();
  assert.equal(await page.getByLabel('續聊訊息',{exact:true}).isEnabled(),true);
  await queue('first queued');await queue('cancel this');await page.getByLabel('待送訊息').locator('.approval').filter({hasText:'cancel this'}).getByRole('button').click();
  await queue('second queued');await page.getByLabel('續聊訊息',{exact:true}).fill('first queued');
  await page.waitForTimeout(1100);assert.equal(sent.length,0);complete('local');
  await page.waitForFunction(()=>[...pendingSends.values()].some(p=>p.text==='first queued'&&p.state==='已送出'));assert.equal(sent[0].text,'first queued');assert.equal(await page.getByLabel('續聊訊息',{exact:true}).inputValue(),'first queued');
  complete('local');await page.waitForFunction(()=>[...pendingSends.values()].some(p=>p.text==='second queued'&&p.state==='已送出'));
  assert.deepEqual(sent.map(x=>x.text),['first queued','second queued']);
  assert.equal(await page.getByLabel('續聊訊息',{exact:true}).inputValue(),'first queued');
  await queue('background same host');await page.locator('.session').filter({hasText:'Queue fixture 1'}).click();complete('local');
  await page.waitForFunction(()=>[...pendingSends.values()].some(p=>p.text==='background same host'&&p.state==='已送出'));assert.equal(sent.at(-1).host,'local');
  if(!portable&&provider==='codex'){await open();await queue('pinned original host');await page.getByLabel('平台',{exact:true}).selectOption('m1');complete('local');
  await page.waitForFunction(()=>[...pendingSends.values()].some(p=>p.text==='pinned original host'&&p.state==='已送出'));assert.equal(sent.at(-1).host,'local');
  await open();await queue('m1 queue');await page.getByLabel('平台',{exact:true}).selectOption('local');complete('m1');
  await page.waitForFunction(()=>[...pendingSends.values()].some(p=>p.text==='m1 queue'&&p.state==='已送出'));assert.equal(sent.at(-1).host,'m1');}
  await open();await queue('must pause on failed');statuses.local={...statuses.local,busy:false,phase:'failed'};
  await page.getByLabel('待送訊息').getByText('上一回合未正常完成，排隊已暫停。',{exact:true}).waitFor();const n=sent.length;
  await page.waitForTimeout(1100);assert.equal(sent.length,n);await page.getByRole('button',{name:'繼續排隊',exact:true}).click();
  await page.waitForFunction(()=>[...pendingSends.values()].some(p=>p.text==='must pause on failed'&&p.state==='已送出'));
  await queue('reload survives');page.once('dialog',d=>d.accept());await page.reload();await open();
  await page.getByLabel('待送訊息').getByText('重新整理後已暫停，請確認後繼續。',{exact:true}).waitFor();complete('local');await page.waitForTimeout(1100);assert.equal(sent.length,n+1);
  rejectNext=true;await page.getByRole('button',{name:'繼續排隊',exact:true}).click();
  await page.getByLabel('待送訊息').getByText(/送出未確認；未自動重送/).waitFor();await page.waitForTimeout(1800);assert.equal(sent.length,n+2);
  assert.equal(await page.getByRole('button',{name:'繼續排隊',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'移除待確認項目',exact:true}).isEnabled(),true);
  assert.ok(sent.filter(x=>x.host==='local').every(x=>x.provider===provider));
  const out=path.join(__dirname,'../evidence/message-queue-20261017');fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,provider+'-queue-unknown-paused.png')});
  if(!portable&&provider==='codex'){await page.getByLabel('平台',{exact:true}).selectOption('cloud');await page.getByLabel('測試帳號',{exact:true}).fill('demo');await page.getByLabel('測試密碼',{exact:true}).fill('synthetic');await page.getByRole('button',{name:'登入工作區',exact:true}).click();await open();
  await queue('cloud fresh revision');complete('lab');await page.waitForFunction(()=>[...pendingSends.values()].some(p=>p.text==='cloud fresh revision'&&p.state==='已送出'));assert.equal(sent.at(-1).revision,6);
  await queue('logout must pause');await page.getByRole('button',{name:'登出工作區',exact:true}).click();complete('lab');const afterLogout=sent.length;
  await page.waitForFunction(()=>[...messageQueues.values()].some(q=>q.reason==='登入或權限已變更，請重新登入後繼續排隊。'));await page.waitForTimeout(1000);assert.equal(sent.length,afterLogout);}
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
