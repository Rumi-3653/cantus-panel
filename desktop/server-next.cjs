'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {BoardStore}=require('./board-store.cjs');
const {LineageStore}=require('../lineage.cjs');
const {AdvancedRunner}=require('./advanced-runner.cjs');
const VERSION=require('../package.json').version;
const runtime=require('../runtime.cjs');
function storageGuard(){if(!runtime.checkGuard())throw Error('Storage Guard did not return STATUS=OK.');}
function createNextServer({upstream='http://127.0.0.1:'+(process.env.CANTUS_PANEL_PORT||4589),dataRoot=path.join(__dirname,'..','state','desktop'),guard=storageGuard,advancedRunner,execution=runtime.execution,readOnly=process.env.CANTUS_PANEL_READ_ONLY==='1'}={}){
 const base=new URL(upstream);if(base.hostname!=='127.0.0.1'||base.protocol!=='http:')throw Error('Backend must be loopback HTTP');
 const token=crypto.randomBytes(32).toString('hex'),board=new BoardStore(path.join(dataRoot,'board'),guard),lineage=new LineageStore({root:path.join(dataRoot,'lineage'),guard:()=>{guard();return true;}});let backendToken;
 const runner=advancedRunner||new AdvancedRunner({root:path.join(dataRoot,'conversations'),guard:()=>{guard();return true;}});
 const legacyIndex=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
 const desktopIndex=legacyIndex.replace(/<script src="[^"]+"><\/script>/g,'').replace('</body>','<script src="/edition-ui.js"></script></body>');
 const publicFiles=new Map([...legacyIndex.matchAll(/(?:src|href)="\/([^"?#]+\.(?:js|css))"/g)].map(m=>['/'+m[1],path.join(__dirname,'..',m[1])]));
 for(const name of ['next-ui.js','next-model.js','tree-ui.js','next.css','edition-ui.js','desktop-platform-ui.js','desktop-native-ui.js','desktop-lineage-ui.js','desktop-live-ui.js'])publicFiles.set('/'+name,path.join(__dirname,name));
 const server=http.createServer(async(req,res)=>{
  const origin='http://127.0.0.1:'+server.address().port;
  const send=(status,value,type='application/json; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});res.end(Buffer.isBuffer(value)?value:type.startsWith('application/json')?JSON.stringify(value):value);};
  try{
   if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')return send(403,{error:'拒絕非本機來源。'});
   const url=new URL(req.url,origin);const mutation=req.method!=='GET';let raw;
   if(!['GET','POST'].includes(req.method))return send(405,{error:'不支援這個方法。'});
   if(mutation){
    if(req.headers.origin!==origin||req.headers['x-cantus-token']!==token)return send(403,{error:'頁面已更新，請重新整理後再操作。'});
    if(req.headers['content-type']?.split(';')[0]!=='application/json')return send(415,{error:'需要 JSON。'});
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>128*1024)return send(413,{error:'內容太長。'});chunks.push(chunk);}raw=Buffer.concat(chunks);
   }
   if(url.pathname==='/api/next/health')return send(200,{version:VERSION,edition:'isolated',upstream:base.origin});
   if(mutation&&readOnly)return send(423,{error:'面板目前只供瀏覽。'});
   if(url.pathname==='/api/next/board'){
    const body=mutation?parse(raw):null;return send(200,body?board.mutate(body):board.read());
   }
   if(mutation&&/^\/api\/(?:native\/|next\/(?:steer|pause|resume|retry)$)/.test(url.pathname)&&!execution)return send(403,{error:runtime.demo?'示範模式使用虛構資料，不會啟動 AI。':'執行功能尚未啟用，請完成設定並明確啟用。'});
   const input=mutation&&/^\/api\/(?:native\/|next\/(?:steer|pause|resume|retry))/.test(url.pathname)?parse(raw):null;
   const ownedId=input?.id||url.searchParams.get('id');
   if(url.pathname==='/api/native/create'&&req.headers['x-cantus-next-desktop']==='1')return send(200,await runner.create(input.provider));
   if(url.pathname==='/api/next/run'){if(mutation)return send(405,{error:'請使用 GET。'});return send(200,runner.runHistory(ownedId));}
   if(/^\/api\/next\/(?:steer|pause|resume|retry)$/.test(url.pathname)){
    if(!mutation)return send(405,{error:'請使用 POST。'});if(!runner.owns(ownedId))return send(409,{error:'此對話由原版執行；進階控制適用新版建立的獨立對話。'});
    return send(200,url.pathname.endsWith('/pause')?await runner.pause(ownedId):await runner[url.pathname.split('/').at(-1)](input));
   }
   if(runner.owns(ownedId)){
    if(url.pathname==='/api/history')return send(200,runner.history(ownedId));
    if(url.pathname==='/api/native/capability')return send(200,execution&&!readOnly?runner.capability(ownedId):{available:false,note:'執行功能尚未啟用。'});
    if(url.pathname==='/api/native/status')return send(200,runner.status(ownedId));
    if(mutation&&url.pathname==='/api/native/send')return send(200,await runner.send(input));
    if(mutation&&url.pathname==='/api/native/answer')return send(200,runner.answer(input));
    if(mutation&&url.pathname==='/api/native/stop')return send(200,await runner.stop(ownedId));
   }
   if(url.pathname==='/api/lineage'){
    const response=await fetch(new URL('/api/sessions?background=1',base),{signal:AbortSignal.timeout(20000)});const catalog=await response.json();if(!response.ok)return send(response.status,catalog);
    const sessions=[...(catalog.sessions||[]),...runner.list()];const value=mutation?lineage.mutate(parse(raw),sessions,new Map()):lineage.snapshot(sessions,new Map());
    if(!mutation){try{const old=await fetch(new URL('/api/lineage',base),{signal:AbortSignal.timeout(20000)});if(old.ok){const source=new Map((await old.json()).nodes.map(n=>[n.id,n]));for(const node of value.nodes)node.handoffs=source.get(node.id)?.handoffs||[];}}catch{}}
    value.note='工作拆分與依賴保存在獨立改版；對話仍來自原工具。任務驗收未知，收合不更動關係。';return send(200,value);
   }
   if(mutation&&/^\/api\/(?:m1\/)?(?:routing\/settings|pair(?:\/.*)?)$/.test(url.pathname))return send(423,{error:'派工與跨主機設定由原版管理；獨立改版只讀取現有設定。'});
   if(mutation&&/^\/api\/m1\/lineage$/.test(url.pathname))return send(423,{error:'雲端關係圖目前只供讀取；新版不修改原主機的關係。'});
   if(url.pathname==='/api/bootstrap'){
    const response=await fetch(new URL('/api/bootstrap',base),{signal:AbortSignal.timeout(10000)});const value=await response.json();if(!response.ok)return send(response.status,value);backendToken=value.csrf;return send(200,{...value,csrf:token,pair:false,nextEdition:true});
   }
   if(url.pathname.startsWith('/api/')){
    if(mutation&&!backendToken){const r=await fetch(new URL('/api/bootstrap',base),{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('原後端暫時無法連線。');backendToken=(await r.json()).csrf;}
    const headers={};for(const [key,value] of Object.entries(req.headers))if(!['host','origin','connection','content-length','accept-encoding','transfer-encoding'].includes(key)&&!key.startsWith('sec-fetch-'))headers[key]=value;
    headers.host=base.host;headers.origin=base.origin;if(mutation)headers['x-cantus-token']=backendToken;
    const response=await fetch(new URL(url.pathname+(url.pathname==='/api/sessions'?(()=>{const query=new URLSearchParams(url.search);query.delete('since');return '?'+query;})():url.search),base),{method:req.method,headers,...(mutation?{body:raw}:{}),signal:AbortSignal.timeout(60000)});
    if(response.status===403&&mutation)backendToken=undefined;
    if(!mutation&&url.pathname==='/api/sessions'&&response.ok){const catalog=await response.json(),owned=runner.list();catalog.sessions=[...(catalog.sessions||[]),...owned];for(const p of catalog.providers||[])p.count+=owned.filter(s=>s.provider===p.provider).length;const value=lineage.catalog(catalog);value.catalogVersion=(catalog.catalogVersion||'source')+':next:'+lineage.read().revision+':'+owned.map(s=>s.updatedAt).join(',');return send(200,value);}
    if(!mutation&&url.pathname==='/api/live'&&response.ok){const value=await response.json(),local=value.machines?.find(m=>m.id==='local');if(local){const at=new Date().toISOString();for(const s of runner.list()){const status=runner.status(s.id);if(status.phase==='idle')continue;const pid=runner.runs.get(s.id)?.child?.pid;if(status.busy&&pid)local.jobs=local.jobs.filter(j=>j.pid!==pid);local.jobs.push({pid:status.busy?pid:null,id:'next:'+s.id,machine:'local',platform:'local',sessionId:s.id,title:s.title,provider:s.provider,cwd:s.cwd,updatedAt:s.updatedAt,source:'Weftelio 獨立對話',status:status.approvals?.length||status.phase==='paused'?'waiting':status.busy?'running':status.phase==='completed'?'ended':'unknown',observedAt:at,reason:'新版原生回合收據；完成不等於驗收。',readOnly:false});}local.coverage+=' 包含新版獨立對話回合。';}return send(200,value);}
    return send(response.status,Buffer.from(await response.arrayBuffer()),response.headers.get('content-type')||'application/json; charset=utf-8');
   }
   if(mutation)return send(405,{error:'不支援這個方法。'});
   if(url.pathname==='/')return send(200,desktopIndex,'text/html; charset=utf-8');
   const file=publicFiles.get(url.pathname);if(file){const type=file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.png')?'image/png':'text/javascript; charset=utf-8';return send(200,fs.readFileSync(file),type);}
   return send(404,{error:'找不到頁面。'});
  }catch(error){return send(error.status||502,{error:error.message||'暫時無法讀取；未自動重送。'});}
 });
 // JSON proxy responses are already serialized bytes. Do not serialize them twice.
 function parse(buffer){try{const value=JSON.parse(buffer.toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw Object.assign(Error('無效 JSON。'),{status:400});}}
 server.advanced=runner;return server;
}
if(require.main===module){storageGuard();const port=Number(process.env.CANTUS_NEXT_PORT||4591);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid port');createNextServer().listen(port,'127.0.0.1',()=>console.log('Weftelio desktop http://127.0.0.1:'+port));}
module.exports={createNextServer,storageGuard};
