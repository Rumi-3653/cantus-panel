/* Display-only grouping. Never writes to a source or creates work dependencies. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CantusConversations=api;})(globalThis,function(){
 function background(s){
  if(s.backgroundReason)return s.backgroundReason;
  if((s.managed||s.shared)&&/^(?:Isolated continuity test\.|Isolated Cantus (?:web engineering|local connection) test\.|Isolated UI permission test\.|This is an isolated Cantus engineering test\.)/.test(s.title||''))return '隔離驗證對話';
  return '';
 }
 function project(s){
  if(s.cantusFolder)return {key:'cantus:'+s.cantusFolder.id,name:s.cantusFolder.name,kind:'project',source:'Weftelio 資料夾 · 原始資料不變',cantusFolderId:s.cantusFolder.id,order:-1};
  if(background(s))return {key:'background',name:'背景／測試',kind:'background',order:Infinity};
  if(s.archived)return {key:'archived',name:'已封存',kind:'archived',order:Infinity};
  if(s.projectSource==='desktop-group'||s.projectId&&s.projectName&&!s.projectSource&&s.source==='Claude Desktop')return {key:'native:'+s.provider+':'+s.projectId,name:s.projectName,kind:'project',provider:s.provider,source:'原工具專案',order:Number.isFinite(s.projectOrder)?s.projectOrder:Infinity};
  // A working folder is evidence of a folder, not of a client or inferred project.
  const cwd=(s.cwd||'').replace(/\/+$/,'');
  if(cwd&&cwd.startsWith('/')&&!/^\/(?:Users\/[^/]+|home\/[^/]+|root|tmp|private\/tmp)$/.test(cwd)&&!s.managed&&!s.shared)return {key:'folder:'+cwd,name:cwd.split('/').pop(),kind:'folder',source:'工作資料夾，尚無原工具專案分類',path:cwd,order:Infinity};
  if(s.projectId&&s.projectSource!=='unassigned'&&s.projectSource!=='cwd')return {key:'native:'+s.provider+':'+s.projectId,name:s.projectName||s.projectId,kind:'project',source:'原工具專案',order:Infinity};
  return {key:'unclassified',name:'未分類',kind:'unclassified',order:Infinity};
 }
 function build(sessions,{query='',projects=[],folders:virtualFolders=[]}={}){
  const q=query.trim().toLowerCase(),items=new Map(),groups=new Map();
  for(const f of virtualFolders){const key='cantus:'+f.id;groups.set(key,{key,name:f.name,kind:'project',cantusFolderId:f.id,source:'Weftelio 資料夾 · 原始資料不變',order:-1,defaultExpanded:true,explicit:true,roots:[],count:0,newest:''});}
  for(const p of projects){if(p.provider!=='codex'||p.projectSource!=='desktop-group'||!p.id)continue;const key='native:codex:'+p.id;groups.set(key,{key,name:p.name,kind:'project',provider:'codex',source:'Codex 原始專案',order:Number.isFinite(p.projectOrder)?p.projectOrder:Infinity,defaultExpanded:p.defaultExpanded===true,explicit:true,roots:[],count:0,newest:''});}
  for(const s of sessions){if(!s||typeof s.id!=='string'||items.has(s.id))continue;const p=project(s);if(!groups.has(p.key))groups.set(p.key,{...p,roots:[],count:0,newest:''});items.set(s.id,{session:s,group:p.key,children:[],parent:null,relation:s.parentRelation||'branch'});}
  for(const n of items.values()){const parent=items.get(n.session.parentId);if(parent&&parent!==n&&parent.group===n.group&&parent.session.provider===n.session.provider)n.parent=parent;}
  // Reject cycles and excessive nesting without dropping any source session.
  for(const n of items.values()){const seen=new Set([n]);let p=n.parent,depth=0;while(p){if(seen.has(p)||++depth>24){n.parent=null;break;}seen.add(p);p=p.parent;}}
  for(const n of items.values()){if(n.parent)n.parent.children.push(n);else groups.get(n.group).roots.push(n);}
  const stamp=s=>typeof s.updatedAt==='string'?s.updatedAt:'';
  function visit(n){n.children=n.children.map(visit).filter(Boolean);n.newest=stamp(n.session);for(const c of n.children)if(c.newest>n.newest)n.newest=c.newest;n.children.sort(compare);n.match=!q||[n.session.title,n.session.cantusFolder?.name,n.session.cwd,n.session.projectName,n.session.source,background(n.session)].join(' ').toLowerCase().includes(q);return n.match||n.children.length?n:null;}
  function compare(a,b){if(a.session.provider==='codex'&&b.session.provider==='codex'&&a.session.projectSource==='desktop-group'&&b.session.projectSource==='desktop-group'){const x=a.session.projectThreadOrder??Infinity,y=b.session.projectThreadOrder??Infinity;if(x!==y)return x-y;if(a.session.projectRecency!==undefined&&b.session.projectRecency!==undefined)return b.session.projectRecency-a.session.projectRecency;}return b.newest.localeCompare(a.newest);}
  function count(n){return 1+n.children.reduce((v,c)=>v+count(c),0);}
  for(const g of groups.values()){g.roots=g.roots.map(visit).filter(Boolean).sort(compare);g.count=g.roots.reduce((v,n)=>v+count(n),0);g.newest=g.roots[0]?.newest||'';}
  const rank={project:0,folder:1,unclassified:1,archived:2,background:3};
  const sorted=[...groups.values()].filter(g=>g.count||g.explicit&&(!q||g.name.toLowerCase().includes(q))).sort((a,b)=>rank[a.kind]-rank[b.kind]||(a.provider===b.provider?0:a.provider==='codex'?-1:b.provider==='codex'?1:0)||(a.order-b.order)||b.newest.localeCompare(a.newest)||a.name.localeCompare(b.name));
  const folders=sorted.filter(g=>g.kind==='folder'),result=sorted.filter(g=>g.kind!=='folder');
  if(folders.length){let unknown=result.find(g=>g.kind==='unclassified');if(!unknown){unknown={key:'unclassified',name:'未分類',kind:'unclassified',roots:[],count:0,newest:''};result.push(unknown);}unknown.subgroups=folders;unknown.count+=folders.reduce((v,g)=>v+g.count,0);if(folders[0].newest>unknown.newest)unknown.newest=folders[0].newest;}
  return result.sort((a,b)=>rank[a.kind]-rank[b.kind]);
 }
 return {build,project,background};
});
