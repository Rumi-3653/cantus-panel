/* Live is a read-only projection. Work DOM stays mounted, including drafts. */
(()=>{
 const app=document.querySelector('.app'),root=el('section','live-view'),machines=el('aside','live-machines'),board=el('section','live-board'),inspector=el('aside','live-inspector');
 root.hidden=true;root.append(machines,board,inspector);app.append(root);
 let active=false,data=null,chosen=null,machine='all',fetching=false,error='',lastSuccess=0,lastAttempt=0;const expanded=new Set();
 const labels={running:'執行中',waiting:'等你處理',ended:'最近結束',unknown:'未知'};
 const time=x=>x?new Date(x).toLocaleString('zh-TW'):'尚未確認';
 const stale=m=>{const age=Date.now()-Date.parse(m.observedAt);return !m.connected||!Number.isFinite(age)||age>20000||age< -5000;};
 function showDetail(job,m){inspector.replaceChildren(el('p','eyebrow',job.provider||'AI'),el('h2','',job.title),el('p','live-status',stale(m)?'未知 · 資料已過期':labels[job.status]));
  for(const [label,value]of [['所在機器',m.name],['來源',job.source],['工作位置',job.cwd||'無法確認'],['最後確認',time(job.observedAt)],['觀察依據',job.reason],['操作範圍',job.readOnly?'僅觀察，不提供停止、改派或批准。':'回到原對話使用既有操作；觀察不等於驗收。']])inspector.append(el('h4','',label),el('p','',value));
  if(job.sessionId&&!job.readOnly){const back=el('button','send-message','回到對話');back.onclick=()=>window.cantusOpenWork({...job,machine:m.id});inspector.append(back);}
 }
 function render(){if(!active)return;const scroll=board.scrollTop;machines.replaceChildren(el('p','eyebrow','MACHINES'),el('h2','','機器'));const all=el('button','live-machine'+(machine==='all'?' active':''),'全部機器');all.onclick=()=>{machine='all';render();};machines.append(all);
  for(const m of data?.machines||[]){const b=el('button','live-machine'+(machine===m.id?' active':''));b.append(el('strong','',m.name),el('small','',stale(m)?'未知 · 無最新觀察':'觀察連線正常 · '+m.jobs.length+' 筆'));b.onclick=()=>{machine=m.id;render();};machines.append(b);}
  board.replaceChildren();const header=el('div','live-heading'),refresh=el('button','icon-btn','↻');refresh.setAttribute('aria-label','重新讀取 Live');refresh.disabled=fetching;refresh.onclick=loadLive;header.append(el('h1','','Live 工作動態'),refresh);board.append(header,el('p','native-note',error||('最後讀取 '+time(lastSuccess||null)+' · 20 秒未更新即標未知')));
  const headings=el('div','live-grid live-head');headings.append(el('span','','機器'));for(const v of Object.values(labels))headings.append(el('strong','',v));board.append(headings);let selectedJob=null,selectedMachine=null;
  for(const m of data?.machines||[]){if(machine!=='all'&&machine!==m.id)continue;const row=el('div','live-grid live-machine-row');row.append(el('strong','live-machine-name',m.name));for(const state of Object.keys(labels)){const col=el('div','live-lane'),jobs=m.jobs.filter(j=>(stale(m)?'unknown':j.status)===state),key=m.id+':'+state;for(const job of expanded.has(key)?jobs:jobs.slice(0,3)){const b=el('button','live-job'+(chosen===job.id?' selected':''));b.dataset.jobId=job.id;b.append(el('small','',job.source),el('strong','',job.title),el('span','',labels[state]));b.onclick=async()=>{chosen=job.id;if(job.sessionId||job.nativeSessionId){if(await window.cantusOpenWork({...job,machine:m.id}))return;}render();};col.append(b);}if(jobs.length>3){const more=el('button','live-more',expanded.has(key)?'收合':'另 '+(jobs.length-3)+' 筆');more.onclick=()=>{expanded.has(key)?expanded.delete(key):expanded.add(key);render();};col.append(more);}const match=jobs.find(j=>j.id===chosen);if(match){selectedJob=match;selectedMachine=m;}if(!col.childNodes.length)col.append(el('span','live-dash','—'));row.append(col);}board.append(row,el('p','live-coverage',m.coverage+(m.truncated?' 已達 200 筆上限，清單不完整。':'')));}
  if(!data)board.append(el('p','empty',fetching?'正在唯讀觀察各機器…':'暫無可確認的資料。'));
  if(selectedJob)showDetail(selectedJob,selectedMachine);else inspector.replaceChildren(el('p','eyebrow','OBSERVATION'),el('h2','','工作詳情'),el('p','','選取卡片查看來源與最後確認時間。'),el('p','native-note','外部程序存在不代表任務正在執行。未知不是閒置，回合結束不是驗收完成。'));board.scrollTop=scroll;
 }
 async function cloudJobs(snapshot){
  const platform=window.cantusPlatform,host=platform?.host||'local',m=snapshot.machines.find(m=>m.id===host);if(!m)return;
  m.coverage+=' 面板工作明細僅在目前登入這台主機時讀取。';
  if(platform?.mode!=='cloud'||!platform.authenticated)return;const gen=platform.generation;
  try{const r=await platform.fetch('/api/sessions');if(!r.ok)throw Error();const c=await r.json(),q=c.sessions.slice(0,100),jobs=[];
   await Promise.all(Array.from({length:6},async()=>{while(q.length){const s=q.shift(),r=await platform.fetch('/api/native/status?id='+encodeURIComponent(s.id));if(!r.ok)throw Error();const v=await r.json();if(v.phase==='idle'||!v.busy&&Date.now()-Date.parse(s.updatedAt)>86400000)continue;const status=v.approvals?.length?'waiting':v.busy?'running':v.phase==='completed'?'ended':'unknown';jobs.push({id:host+':panel:'+s.id,machine:host,platform:'cloud',sessionId:s.id,title:(s.title||'未命名工作').slice(0,100),provider:s.provider,source:(platform.label||'目前工作區')+' 面板執行紀錄',status,observedAt:new Date().toISOString(),reason:'登入帳號可讀的執行紀錄；回合結束不是驗收。',readOnly:false});}}));
   if(gen!==platform.generation||platform.mode!=='cloud'||!platform.authenticated)return;m.jobs.push(...jobs);if(c.sessions.length>100)m.coverage+=' 面板明細上限 100 筆，並非完整清單。';
  }catch{m.coverage+=' 面板明細讀取失敗，狀態未知。';}
 }
 async function loadLive(){if(fetching)return;fetching=true;lastAttempt=Date.now();render();try{const r=await fetch('/api/live',{signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Live 觀察暫時無法讀取');const snapshot=await r.json();await cloudJobs(snapshot);data=snapshot;lastSuccess=Date.now();error='';}catch(e){error=e.message+'；保留上次資料，逾時標未知。';}finally{fetching=false;render();}}
 function leave(){active=false;root.hidden=true;app.classList.remove('live-mode');document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active',b.id==='work'));}
 $('live').onclick=()=>{active=true;root.hidden=false;app.classList.add('live-mode');document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active',b.id==='live'));render();loadLive();};
 window.cantusLive={leave};
 const work=$('work').onclick;$('work').onclick=()=>{leave();work?.();};
 document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',leave));
 let platformGeneration=window.cantusPlatform?.generation;
 document.addEventListener('cantus-platform-change',()=>{platformGeneration=window.cantusPlatform?.generation;if(data)for(const m of data.machines)m.jobs=m.jobs.filter(j=>j.platform!=='cloud');render();});
 setInterval(()=>{if(platformGeneration!==window.cantusPlatform?.generation){platformGeneration=window.cantusPlatform?.generation;if(data)for(const m of data.machines)m.jobs=m.jobs.filter(j=>j.platform!=='cloud');}if(active){render();if(!document.hidden&&Date.now()-lastAttempt>=5000)loadLive();}},1000);
})();
