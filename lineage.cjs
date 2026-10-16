'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const {backgroundReason}=require('./catalog.cjs');
const fail=(message,status=400)=>Object.assign(Error(message),{status,code:'lineage'});
const clean=(v,max)=>typeof v==='string'&&v.trim()&&v.trim().length<=max?v.trim():null;
class LineageStore{
 constructor({root=path.join(__dirname,'state','lineage'),guard=()=>require('./runtime.cjs').checkGuard()}={}){this.root=root;this.guard=guard;}
 read(){try{const d=JSON.parse(fs.readFileSync(path.join(this.root,'graph.json'),'utf8'));if(d.version!==1||!Number.isSafeInteger(d.revision)||!Array.isArray(d.tasks)||!Array.isArray(d.edges)||(d.origins!==undefined&&(!Array.isArray(d.origins)||d.origins.some(id=>typeof id!=='string'))))throw Error();return d;}catch(e){if(e.code==='ENOENT')return {version:1,revision:0,tasks:[],edges:[]};throw fail('工作關係資料無法讀取，未覆寫原檔',409);}}
 snapshot(sessions,handoffs){
  const data=this.read(),origins=data.origins||[],members=new Set([...handoffs.values()].flatMap(r=>Object.values(r.members).filter(id=>id!==r.id))),map=new Map(sessions.filter(s=>!members.has(s.id)).map(s=>[s.id,s]));
  for(const r of handoffs.values())map.set(r.id,{...r.entry,id:r.id,handoff:true});
  const referenced=new Set([...data.edges.flatMap(e=>[e.from,e.to]),...origins]);
  const nodes=[...map.values()].filter(s=>!backgroundReason(s)||referenced.has(s.id)).map(s=>({id:s.id,title:(s.title||s.projectName||'未命名工作').slice(0,300),sessionId:s.id,provider:s.provider,source:s.source||'原始對話',status:'unknown',handoffs:[]}));
  nodes.push(...data.tasks.map(t=>({...t,status:'unknown',source:'手動建立的工作',handoffs:[]})));
  for(const n of nodes){const r=handoffs.get(n.id);if(!r)continue;let previous=r.entry.provider;n.handoffs=(r.deliveries||[]).flatMap((d,index)=>{const from=previous;previous=d.provider;if(from===d.provider)return [];return [{from,to:d.provider,phase:d.phase,sequence:index+1,requestId:d.requestId,evidence:'state/handoffs/'+r.id+'.json · deliveries['+index+']'}];});}
  const known=new Set(nodes.map(n=>n.id));for(const id of referenced)if(!known.has(id))nodes.push({id,title:'來源已不可讀 · '+id.slice(0,22),status:'unknown',missing:true,source:'既有關係保留；無法確認對話',handoffs:[]});
  for(const n of nodes)n.isOrigin=origins.includes(n.id);
  return {revision:data.revision,nodes,edges:data.edges,scope:'local',note:'只呈現本機面板的明確紀錄與手動關係。工作是否完成尚無驗收資料，均標未知；依賴不會自動執行或解鎖。'};
 }
 mutate(body,sessions,handoffs){
  const data=this.read();if(body.revision!==data.revision)throw fail('關係已更新，請重新讀取後再操作',409);
  const now=new Date().toISOString();data.origins ||= [];
  if(body.action==='createTask'){const title=clean(body.title,300);if(!title)throw fail('請輸入 1–300 字的工作名稱');if(data.tasks.length>=2000)throw fail('手動工作已達 2,000 筆上限');data.tasks.push({id:'work_'+crypto.randomUUID(),title,createdAt:now});}
  else if(body.action==='setOrigin'){
   if(typeof body.enabled!=='boolean')throw fail('起始來源標記無效');
   const node=this.snapshot(sessions,handoffs).nodes.find(n=>n.id===body.id);if(!node||node.missing)throw fail('找不到工作，請重新讀取');
   if(body.enabled&&data.edges.some(e=>e.to===body.id))throw fail('此工作已有來源或前置連線；連線已保留，不能同時設為起始來源',409);
   data.origins=data.origins.filter(id=>id!==body.id);if(body.enabled)data.origins.push(body.id);
  }else if(body.action==='addEdge'){
   if(!['split','dependency'].includes(body.type))throw fail('只能手動建立拆分或依賴');
   const reason=body.reason===undefined?'':clean(body.reason,2000);if(reason===null)throw fail('連線原因最多 2,000 字，或省略此欄位');
   const nodes=new Map(this.snapshot(sessions,handoffs).nodes.map(n=>[n.id,n]));
   if(!nodes.has(body.from)||!nodes.has(body.to)||nodes.get(body.from).missing||nodes.get(body.to).missing)throw fail('找不到工作，請重新讀取');
   if(body.from===body.to)throw fail('工作不能連到自己');
   if(data.origins.includes(body.to))throw fail('終點已設為起始來源，請先取消起始標記再加入前置連線',409);
   if(data.edges.some(e=>e.from===body.from&&e.to===body.to&&e.type===body.type))throw fail('這條關係已存在',409);
   if(body.type==='split'&&data.edges.some(e=>e.to===body.to&&e.type==='split'))throw fail('此子工作已有父工作，請先移除原拆分關係',409);
   // Each relation has its own meaning. Check cycles within that meaning only.
   const visited=new Set(),queue=[body.to];while(queue.length){const id=queue.pop();if(id===body.from)throw fail('這條關係會形成循環',409);if(visited.has(id))continue;visited.add(id);queue.push(...data.edges.filter(e=>e.type===body.type&&e.from===id).map(e=>e.to));}
   if(data.edges.length>=5000)throw fail('關係已達 5,000 筆上限');
   data.edges.push({id:'edge_'+crypto.randomUUID(),type:body.type,from:body.from,to:body.to,reason,createdAt:now,source:'使用者手動建立'});
  }else if(body.action==='removeEdge'){if(!data.edges.some(e=>e.id===body.id))throw fail('找不到這條關係',404);data.edges=data.edges.filter(e=>e.id!==body.id);}
  else throw fail('不支援的關係操作');
  if(!this.guard())throw fail('Storage Guard 未通過，未儲存',409);
  fs.mkdirSync(this.root,{recursive:true,mode:0o700});const file=path.join(this.root,'graph.json');if(fs.existsSync(file)){const backup=path.join(this.root,'revision-'+data.revision+'.json');if(!fs.existsSync(backup))fs.copyFileSync(file,backup,fs.constants.COPYFILE_EXCL);}
  data.revision++;const tmp=path.join(this.root,'graph-'+crypto.randomUUID()+'.tmp');fs.writeFileSync(tmp,JSON.stringify(data)+'\n',{mode:0o600});fs.renameSync(tmp,file);
  return this.snapshot(sessions,handoffs);
 }
}
module.exports={LineageStore};
