'use strict';
// Transport is injected by the deployment. No addresses, credentials or tunnels here.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {LineageStore}=require('./lineage.cjs');
const fail=(message,status=400)=>Object.assign(Error(message),{status,code:'pair'});
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(id);
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value??null)).digest('hex');
function validate(input){
 if(!input||!validId(input.requestId)||typeof input.text!=='string'||!input.text.trim()||Buffer.byteLength(input.text)>24000||typeof input.cwd!=='string'||!path.isAbsolute(input.cwd)||input.cwd.length>4096||input.cwd.includes('\0'))throw fail('請填入任務與 M1 上的絕對工作目錄');
 return {requestId:input.requestId,text:input.text.trim(),cwd:input.cwd};
}
class Records{
 constructor(root,guard){this.root=root;this.guard=guard;}
 read(id){if(!validId(id))throw fail('無效派工編號');try{return JSON.parse(fs.readFileSync(path.join(this.root,id+'.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw fail('派工紀錄無法讀取，未重送',409);}}
 list(){if(!fs.existsSync(this.root))return [];return fs.readdirSync(this.root).filter(n=>n.endsWith('.json')).map(n=>this.read(n.slice(0,-5)));}
 save(record){if(!this.guard())throw fail('Storage Guard 未通過',409);fs.mkdirSync(this.root,{recursive:true,mode:0o700});const file=path.join(this.root,record.requestId+'.json'),tmp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(record)+'\n',{mode:0o600});fs.renameSync(tmp,file);return record;}
}
class DispatchReceiver{
 constructor({root,managed,guard=()=>true}){this.records=new Records(root,guard);this.managed=managed;this.pending=new Map();}
 status(id){const record=this.records.read(id);if(!record)throw fail('找不到派工收據',404);const session=record.sessionId?this.managed.list().find(s=>s.id===record.sessionId):null;let status={phase:record.phase,busy:this.pending.has(id),text:record.error||''};if(record.result)status=record.result;else if(session){status=this.managed.status(session.id);const delivery=this.managed.records?.get(session.id)?.deliveries.find(d=>d.requestId===id);if(delivery?.phase==='completed')status={phase:'completed',busy:false};else if(!status.busy&&status.phase==='idle')status={...status,phase:'unconfirmed',text:'執行結果未確認，不會自動重送'};if(status.phase==='completed'){status={...status,text:this.managed.history(session.id).rows.find(r=>r.role==='assistant')?.text||status.text||''};record.result={phase:'completed',busy:false,text:status.text};this.records.save(record);}}return {requestId:id,phase:record.phase,session:session?{id:session.id,provider:session.provider,title:session.title}:null,status};}
 async receive(raw){
  const input=validate(raw),hash=digest(input),old=this.records.read(input.requestId);
  if(old){if(old.hash!==hash)throw fail('同一派工編號不能改內容',409);if(this.pending.has(input.requestId))await this.pending.get(input.requestId);return this.status(input.requestId);}
  // Validate before reserving; a bad directory must never launch an AI process.
  let cwd;try{cwd=fs.realpathSync(input.cwd);if(!fs.statSync(cwd).isDirectory())throw Error();}catch{throw fail('M1 上找不到這個工作目錄，尚未派工');}
  const record={requestId:input.requestId,hash,phase:'preparing',createdAt:new Date().toISOString(),sessionId:null};this.records.save(record);
  const run=(async()=>{try{const session=await this.managed.create('codex',{cwd});record.sessionId=session.id;record.phase='created';this.records.save(record);await this.managed.send({id:session.id,text:input.text,requestId:input.requestId});record.phase='accepted';this.records.save(record);}catch(e){record.phase='unconfirmed';record.error=e.message;this.records.save(record);throw e;}})();
  this.pending.set(input.requestId,run);try{await run;return this.status(input.requestId);}finally{this.pending.delete(input.requestId);}
 }
}
class PairCoordinator{
 constructor({root,local,remote,guard=()=>true}){this.local=local;this.remote=remote;this.guard=guard;this.graph=new LineageStore({root:path.join(root,'graph'),guard});this.records=new Records(path.join(root,'dispatches'),guard);this.remoteCache=null;this.pending=new Map();}
 async snapshots(){const local=await this.local();let online=false;try{const value=await this.remote('/api/lineage');if(!Array.isArray(value.nodes)||!Array.isArray(value.edges))throw Error();this.remoteCache=value;online=true;}catch{}return {local,remote:this.remoteCache||{nodes:[],edges:[]},online};}
 async snapshot(){
  const views=await this.snapshots(),records=this.records.list();
  await Promise.all(records.filter(r=>!['completed','failed','stopped'].includes(r.receipt?.status?.phase)).slice(-20).map(async r=>{try{const receipt=await this.remote('/api/dispatch?requestId='+encodeURIComponent(r.requestId));if(digest(receipt)!==digest(r.receipt)){r.receipt=receipt;r.phase='received';this.records.save(r);}}catch{r.unavailable=true;}}));
  const mapped=new Map(records.filter(r=>r.receipt?.session).map(r=>[r.receipt.session.id,'dispatch_'+r.requestId]));
  const key=(host,id)=>host==='m1'&&mapped.has(id)?mapped.get(id):host+':'+id;
  const base=[],edges=[];
  for(const [host,view]of [['m4',views.local],['m1',views.remote]]){
   for(const n of view.nodes)base.push({...n,id:key(host,n.id),originalNodeId:n.id,sourceIsOrigin:n.isOrigin,machine:host==='m4'?'local':'m1',hostLabel:host==='m4'?'M4':'M1',platform:host==='m4'?'local':'cloud',unavailable:host==='m1'&&!views.online});
   for(const e of view.edges)edges.push({...e,id:host+':'+e.id,from:key(host,e.from),to:key(host,e.to),readonly:true,source:e.source+' · '+host.toUpperCase()});
  }
  for(const r of records){const id='dispatch_'+r.requestId,prior=base.find(n=>n.id===id),receipt=r.receipt,status=r.unavailable?{phase:'unconfirmed',text:'M1 目前離線；保留最後收據，不代表工作已停止。'}:receipt?.status||{phase:'unconfirmed',text:r.error||'結果未確認；不會自動重送。'};
   const node={...prior,id,title:prior?.title||r.title,provider:'codex',sessionId:receipt?.session?.id||null,machine:'m1',hostLabel:'M1',platform:'cloud',source:'M4 明確派給 M1 · '+r.requestId,handoffs:[],dispatch:{requestId:r.requestId,cwd:r.cwd,status},unavailable:!views.online};
   if(prior)Object.assign(prior,node);else base.push(node);
   edges.push({id:'dispatch-edge_'+r.requestId,type:'split',from:r.from,to:id,reason:r.title,source:'已確認的派工操作；不代表工作已驗收',createdAt:r.createdAt,readonly:true});
  }
  const overlay=this.graph.snapshot(base.map(n=>({...n,backgroundReason:''})),new Map()),map=new Map(base.map(n=>[n.id,n]));
  let nodes=overlay.nodes.map(n=>map.has(n.id)?{...n,...map.get(n.id),title:n.title,isOrigin:n.isOrigin||map.get(n.id).isOrigin}:{...n,machine:'local',hostLabel:'M4',platform:'local'});
  const allEdges=[...edges,...overlay.edges];for(const id of new Set(allEdges.flatMap(e=>[e.from,e.to])))if(!nodes.some(n=>n.id===id))nodes.push({id,title:'來源目前不可讀',missing:true,handoffs:[],machine:id.startsWith('m1:')?'m1':'local',hostLabel:id.startsWith('m1:')?'M1':'M4'});
  return {...overlay,nodes,edges:allEdges,scope:'pair',canDispatch:views.online,remoteOnline:views.online,note:views.online?'M4 與 M1 的同一張圖；Oracle 工作區保持獨立。派工只傳送你填寫的任務，不自動複製原對話或檔案。':'M1 目前離線；保留既有連線與收據，暫停新派工。',base};
 }
 async mutate(body){
  const view=await this.snapshot();if(body.action==='dispatch')return this.dispatch(body,view);
  if(!['createTask','addEdge','removeEdge','setOrigin','rename'].includes(body.action))throw fail('不支援的合圖操作');
  if(body.action==='removeEdge'&&view.edges.find(e=>e.id===body.id)?.readonly)throw fail('這是原主機關係或派工證據，不能從合圖移除',409);
  // Include source edges in validation, without copying them into the overlay store.
  if(body.action==='addEdge'){
   if(view.nodes.find(n=>n.id===body.to)?.isOrigin)throw fail('終點已設為起始來源；請先在其工作區取消標記',409);
   if(!view.remoteOnline&&[body.from,body.to].some(id=>view.nodes.find(n=>n.id===id)?.machine==='m1'))throw fail('M1 離線，無法確認關係',409);
   if(view.edges.some(e=>e.type===body.type&&e.from===body.from&&e.to===body.to))throw fail('這條關係已存在',409);
   if(body.type==='split'&&view.edges.some(e=>e.type==='split'&&e.to===body.to))throw fail('此子工作已有父工作',409);
   const queue=[body.to],seen=new Set();while(queue.length){const id=queue.pop();if(id===body.from)throw fail('這條關係會形成循環',409);if(seen.has(id))continue;seen.add(id);queue.push(...view.edges.filter(e=>e.type===body.type&&e.from===id).map(e=>e.to));}
  }
  if(body.action==='setOrigin'&&body.enabled&&view.edges.some(e=>e.to===body.id))throw fail('此工作已有來源或前置連線',409);
  this.graph.mutate(body,view.base,new Map());return this.snapshot();
 }
 async dispatch(raw,view){
  const input=validate(raw),hash=digest({...input,from:raw.from}),old=this.records.read(input.requestId);
  if(old){if(old.hash!==hash)throw fail('同一派工編號不能改內容',409);if(this.pending.has(input.requestId))await this.pending.get(input.requestId);return this.snapshot();}
  if(!view.remoteOnline)throw fail('M1 目前離線，尚未派工',503);
  const parent=view.nodes.find(n=>n.id===raw.from);if(!parent||parent.missing||parent.machine!=='local')throw fail('請從 M4 的工作派給 M1');
  if(raw.revision!==view.revision)throw fail('關係已更新，請重新讀取',409);
  if(this.records.list().length>=2000)throw fail('派工紀錄已達 2,000 筆上限，尚未派工');
  const record={...input,from:raw.from,hash,title:input.text.slice(0,100),phase:'submitting',createdAt:new Date().toISOString()};this.records.save(record);
  const run=(async()=>{try{record.receipt=await this.remote('/api/dispatch','POST',input);record.phase='received';}catch(e){record.phase='unconfirmed';record.error=e.message;}this.records.save(record);})();this.pending.set(input.requestId,run);try{await run;return await this.snapshot();}finally{this.pending.delete(input.requestId);}
 }
}
module.exports={DispatchReceiver,PairCoordinator,validate};
