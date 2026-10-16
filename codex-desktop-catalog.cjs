'use strict';
// Read-only projection of Codex Desktop's saved projects. No source writes,
// title-based classification, new project IDs, or cross-machine state copies.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const text=(v,max=4096)=>typeof v==='string'&&v.length<=max?v:'';
const object=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const normalize=v=>text(v).replace(/\\/g,'/').replace(/\/+$/,'');
function readState(root){
 const file=path.join(root,'.codex-global-state.json');
 try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>16*1024*1024)throw Error('invalid state file');const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{return JSON.parse(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd);}}
 catch(e){if(e.code==='ENOENT')return {};throw e;}
}
function readThreads(root){
 const file=path.join(root,'state_5.sqlite');
 if(!fs.existsSync(file))return [];
 const pending=['-wal','-journal'].some(s=>fs.existsSync(file+s)&&fs.statSync(file+s).size>0);
 const database=pending?file:require('node:url').pathToFileURL(file).href+'?mode=ro&immutable=1';
 const columns=new Set(JSON.parse(execFileSync('/usr/bin/sqlite3',['-readonly','-json',database,'PRAGMA table_info(threads)'],{encoding:'utf8',timeout:5000})).map(c=>c.name));
 const wanted=['id','name','title','cwd','project_id','thread_source','agent_path','archived','recency_at_ms','updated_at_ms','updated_at'];
 const fields=wanted.filter(k=>columns.has(k)).map(k=>['archived','recency_at_ms','updated_at_ms','updated_at'].includes(k)?k:`substr(${k},1,4096) AS ${k}`);
 return JSON.parse(execFileSync('/usr/bin/sqlite3',['-readonly','-json',database,`SELECT ${fields.join(',')} FROM threads LIMIT 20000`],{encoding:'utf8',maxBuffer:32*1024*1024,timeout:5000})||'[]');
}
// Codex's saved-root tie break: a single-root project first, then primary
// root, then the older project, then descending ID. Exact roots only.
function prefer(a,b,root){
 if((a.rootPaths.length===1)!==(b.rootPaths.length===1))return a.rootPaths.length===1;
 const primary=normalize(a.rootPaths[0])===root,other=normalize(b.rootPaths[0])===root;
 return primary!==other?primary:a.createdAt!==b.createdAt?a.createdAt<b.createdAt:a.id.localeCompare(b.id)>0;
}
function projectCatalog(state,threads,root){
 const saved=object(state['local-projects']),order=Array.isArray(state['project-order'])?state['project-order']:[];
 const ids=[...new Set([...order,...Object.keys(saved)])];
 const projects=ids.flatMap(id=>{const p=object(saved[id]);return p.id===id&&text(p.name,2000)&&Array.isArray(p.rootPaths)?[{id,provider:'codex',name:p.name,projectSource:'desktop-group',projectOrder:ids.indexOf(id),defaultExpanded:true,rootPaths:p.rootPaths.filter(x=>text(x)),createdAt:Number(p.createdAt)||0}]:[];});
 const byId=new Map(projects.map(p=>[p.id,p])),byRoot=new Map();
 for(const p of projects)for(const raw of p.rootPaths){const r=normalize(raw),old=byRoot.get(r);if(r&&(!old||prefer(p,old,r)))byRoot.set(r,p);}
 const assignment=object(state['thread-project-assignments']),projectless=new Set(Array.isArray(state['projectless-thread-ids'])?state['projectless-thread-ids']:[]),hosts=object(state['thread-project-membership-host-ids']);
 const migrations=object(state['app-server-project-id-by-legacy-project-id-by-host']),serverIds=object(migrations['local:'+root]),legacyIds=new Map(Object.entries(serverIds).map(([old,current])=>[current,old]));
 const atom=object(state['electron-persisted-atom-state']),manual=object(atom['flat-project-sidebar-preferences-v1']).chatSortMode==='manual',orders=object(state['sidebar-project-thread-orders']);
 const mapped=new Map();
 for(const t of threads){
  if(!text(t.id,160))continue;
  const a=assignment[t.id];let p,via='unassigned';
  if(hosts[t.id]&&hosts[t.id]!=='local'){/* This machine must not claim a remote membership. */}
  else if(a!==undefined){if(a?.projectKind==='local'){p=byId.get(a.projectId);via='saved-assignment';}}
  else if(projectless.has(t.id)){/* Explicitly projectless overrides any root match. */}
  else if(t.project_id){p=byId.get(legacyIds.get(t.project_id)||t.project_id);via='native-project-id';}
  else{p=byRoot.get(normalize(t.cwd));via='saved-root';}
  const m={title:text(t.name,2000)||text(t.title),threadSource:text(t.thread_source,80),agentPath:text(t.agent_path),archived:!!t.archived,projectId:p?.id||'',projectName:p?.name||'',projectSource:p?'desktop-group':'unassigned',projectMembershipSource:p?via:'unassigned',projectOrder:p?.projectOrder};
  if(p){const list=Array.isArray(orders[p.id]?.threadIds)?orders[p.id].threadIds:[],at=manual?list.indexOf(t.id):-1;m.projectThreadOrder=at<0?null:at;m.projectRecency=Number(t.recency_at_ms)||Number(t.updated_at_ms)||Number(t.updated_at)*1000||0;}
  mapped.set('codex_'+crypto.createHash('sha256').update(root+'\0'+t.id).digest('hex'),m);
 }
 return {projects:projects.map(({rootPaths,createdAt,...p})=>p),mapped};
}
function enrichCodexDesktop(sessions,root){
 const warnings=[];let state={},threads=[];
 try{state=readState(root);}catch{warnings.push('Codex 原始專案設定暫時無法安全讀取；未推測分類。');}
 try{threads=readThreads(root);}catch{warnings.push('Codex 原始對話分類暫時無法讀取；保留歷史索引。');}
 const {projects,mapped}=projectCatalog(state,threads,root);
 for(const row of sessions){if(row.provider!=='codex')continue;const m=mapped.get(row.id);if(m){if(m.title)row.title=m.title;for(const key of ['threadSource','agentPath'])if(m[key])row[key]=m[key];for(const key of ['archived','projectId','projectName','projectSource','projectMembershipSource','projectOrder','projectThreadOrder','projectRecency'])row[key]=m[key];}}
 return {projects,warnings};
}
module.exports={enrichCodexDesktop,projectCatalog,readState,readThreads};
