/* Native continuation UI; all provider text is rendered as text, never HTML. */
const originalSelect=select,drafts=new Map(),pendingSends=new Map(),providerChoices=new Map();let nativePoll,csrfToken,nativeSelection=0;
const createBox=el('div','panel-create');
for(const provider of ['auto','codex','claude']){const button=el('button','nav',provider==='auto'?'＋ 新對話':'＋ 新 '+(provider==='codex'?'Codex':'Claude')+' 對話');button.dataset.provider=provider;button.hidden=provider!=='auto';button.onclick=async()=>{for(const b of createBox.querySelectorAll('button'))b.disabled=true;const oldBox=document.querySelector('.composer');if(oldBox){for(const c of oldBox.querySelectorAll('textarea,button'))c.disabled=true;oldBox.querySelector('.native-state').textContent='正在建立新對話…';}try{const target=provider==='auto'?(window.cantusRouting?.config?.defaultTarget?.provider||'claude'):provider;const s=await postNative('create',{provider:target});await load();await select(s);}catch(e){toast(e.message);const s=catalog.sessions.find(s=>s.id===selected);if(s)await select(s);}finally{for(const b of createBox.querySelectorAll('button'))b.disabled=false;}};createBox.append(button);}
document.querySelector('.sidebar').insertBefore(createBox,document.querySelector('.sources-label'));
async function postNative(action,body){
  csrfToken ||= (await api('/api/bootstrap')).csrf;
  if(window.cantusPlatform?.mode==='cloud'&&action==='send')body={...body,revision:Number(document.querySelector('.composer')?.dataset.labRevision)};
  const r=await (window.cantusPlatform?.fetch||fetch)('/api/native/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Cantus-Token':csrfToken},body:JSON.stringify(body)});
  const value=await r.json();if(!r.ok)throw Error(value.error||'送出失敗');return value;
}
select=async function(s){
  const generation=++nativeSelection;
  clearTimeout(nativePoll);
  await originalSelect(s);if(selected!==s.id||generation!==nativeSelection)return;
  const transcript=el('div','transcript-scroll');transcript.append(...$('detail').childNodes);$('detail').append(transcript);
  if(s.managed)transcript.querySelector('.eyebrow').textContent=s.provider.toUpperCase()+(s.shared?' / SHARED SESSION':' / PANEL SESSION');
  const box=el('section','composer'),label=el('label','',s.shared?'接著聊 · '+(window.cantusPlatform?.label||'目前工作區')+' 共用對話':s.handoff?'接著聊 · Codex / Claude 接續':s.managed?'接著聊 · 面板獨立對話':'接著聊 · 原生 session');
  const draftKey=window.cantusPlatform?.key(s.id)||s.id;
  const providerPicker=el('select','provider-picker');providerPicker.setAttribute('aria-label','回覆 AI');providerPicker.hidden=true;
  for(const p of window.cantusPlatform?.providers||['codex','claude']){const option=el('option','',p==='codex'?'Codex':'Claude');option.value=p;providerPicker.append(option);}providerPicker.value=providerChoices.get(draftKey)||s.provider;
  const note=el('p','native-note','正在確認原生續作…'),input=el('textarea');input.placeholder='接著這段對話說…';input.setAttribute('aria-label','續聊訊息');input.maxLength=24000;input.value=drafts.get(draftKey)||'';input.oninput=()=>{drafts.set(draftKey,input.value);previewRoute();};
  const routingNote=el('p','routing-chat-note');routingNote.hidden=true;let lastRoute=null;
  function previewRoute(){const config=window.cantusRouting?.config;if(providerPicker.value!=='auto'||!config){routingNote.hidden=true;return;}routingNote.hidden=false;const d=input.value.trim()?CantusRules.choose(config,input.value,lastRoute):lastRoute;routingNote.textContent=d?((d.provider==='codex'?'Codex':'Claude')+' · '+(d.model||'原工具設定')+' — '+d.ruleName+'；'+d.reason):'自動派工已開啟 · 輸入訊息即可預覽負責的 AI';}
  if(window.cantusRouting)window.cantusRouting.preview=()=>{if(box.isConnected)previewRoute();};
  const actions=el('div','composer-actions'),send=el('button','send-message','送出'),stop=el('button','stop-message','停止本回合'),state=el('span','native-state',''),live=el('div','native-response'),approvals=el('div','native-approvals');live.setAttribute('aria-live','polite');
  const liveMessage=el('article','message assistant live-message'),liveHead=el('div','message-head');
  liveHead.append(el('span','mini-avatar','C'),el('span','',s.provider==='codex'?'Codex':'Claude'));live.classList.add('message-body');liveMessage.append(liveHead,live);liveMessage.hidden=true;transcript.append(liveMessage);
  send.disabled=true;stop.hidden=true;actions.append(state,providerPicker,stop,send);label.append(input);box.append(note,label,routingNote,actions,approvals);$('detail').append(box);
  transcript.scrollTop=transcript.scrollHeight;
  let optimistic;
  function showPending(p){
    if(!p)return;
    const persisted=[...transcript.querySelectorAll('.message.user')].some(a=>a.dataset.sentAt&&a.dataset.sentAt>=p.at&&a.messageText===p.text);
    if(persisted)return;
    optimistic=messageArticle({role:'user',text:p.text,at:p.at},s);optimistic.dataset.requestId=p.requestId;
    optimistic.append(el('small','delivery-state',p.state));transcript.insertBefore(optimistic,liveMessage);transcript.scrollTop=transcript.scrollHeight;
  }
  showPending(pendingSends.get(draftKey));
  let available=false,busy=false,polling=false,sending=false,lastApproval='';
  const phases={idle:'',preparing:'正在接回原會話…',running:'回覆中…',approval:'等待你確認權限',completed:'已完成 · 原始記錄已更新',failed:'未完成',stopped:'已停止'};
  function renderStatus(v){
    if(v.routing){lastRoute={...v.routing,model:v.model||v.routing.model};previewRoute();}
    if(v.revision!==undefined)box.dataset.labRevision=String(v.revision);
    busy=v.busy;send.disabled=busy||!available;input.disabled=busy;providerPicker.disabled=busy;stop.hidden=!busy;
    liveHead.lastChild.textContent=(v.provider||providerPicker.value)==='codex'?'Codex':'Claude';
    state.textContent=v.error||phases[v.phase]||v.phase;
    if(v.phase==='completed'&&!v.historyUpdated)state.textContent='這則訊息先前已送出，請重新讀取記錄。';
    const nearBottom=transcript.scrollHeight-transcript.scrollTop-transcript.clientHeight<80;
    const liveText=v.phase==='completed'?'':v.text||'';renderMessageContent(live,liveText);liveMessage.hidden=!liveText;
    if(nearBottom&&!liveMessage.hidden)transcript.scrollTop=transcript.scrollHeight;
    const key=JSON.stringify(v.approvals);if(key!==lastApproval){lastApproval=key;approvals.replaceChildren();for(const a of v.approvals||[]){
      const card=el('div','approval'),title=el('strong','','需要你的批准：'+a.kind),details=el('pre','',JSON.stringify(a.detail,null,2)),yes=el('button','','允許這一次'),no=el('button','','拒絕');
      const answer=async allow=>{yes.disabled=no.disabled=true;try{renderStatus(await postNative('answer',{id:s.id,approvalId:a.id,allow}));}catch(e){state.textContent=e.message;}finally{yes.disabled=no.disabled=false;}};
      yes.onclick=()=>answer(true);no.onclick=()=>answer(false);card.append(title,details,no,yes);approvals.append(card);
    }}
  }
  async function poll(){
    if(selected!==s.id||generation!==nativeSelection||!box.isConnected||polling)return;polling=true;
    try{const requestedPending=pendingSends.get(draftKey)?.requestId,v=await api('/api/native/status?id='+encodeURIComponent(s.id));if(selected!==s.id||generation!==nativeSelection||!box.isConnected)return;
      const pending=pendingSends.get(draftKey);
      if(requestedPending!==pending?.requestId){nativePoll=setTimeout(poll,900);return;}
      if(pending&&pending.requestId!==v.requestId&&sending){nativePoll=setTimeout(poll,900);return;}
      if(pending&&pending.requestId===v.requestId&&!v.busy&&v.phase==='completed'){pendingSends.delete(draftKey);if(drafts.get(draftKey)===pending.text)drafts.delete(draftKey);await load(true);if(selected===s.id&&generation===nativeSelection)await select(catalog.sessions.find(x=>x.id===s.id)||s);}
      else{renderStatus(v);if(v.busy)nativePoll=setTimeout(poll,900);}
    }catch(e){state.textContent='連線中斷，未自動重送。'+e.message;nativePoll=setTimeout(poll,2500);}finally{polling=false;}
  }
  send.onclick=async()=>{
    if(busy||!available||!input.value.trim())return;
    const text=input.value,requestId=crypto.randomUUID();busy=true;sending=true;send.disabled=true;input.disabled=true;providerPicker.disabled=true;state.textContent='正在送出…';
    const pending={text,requestId,at:new Date().toISOString(),state:'正在送出…'};pendingSends.set(draftKey,pending);input.value='';drafts.delete(draftKey);showPending(pending);
    try{const v=await postNative('send',{id:s.id,text,requestId,...(!providerPicker.hidden?{provider:providerPicker.value}:{})});pending.state='已送出';if(optimistic)optimistic.querySelector('.delivery-state').textContent=pending.state;renderStatus(v);poll();}
    catch(e){pending.state='送出未確認；文字已保留，未自動重送';if(optimistic)optimistic.querySelector('.delivery-state').textContent=pending.state;state.textContent=e.message+'（未自動重送）';if(!input.value){input.value=text;drafts.set(draftKey,text);}busy=false;send.disabled=!available;input.disabled=false;providerPicker.disabled=false;}
    finally{sending=false;}
  };
  input.onkeydown=e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();send.click();}};
  stop.onclick=async()=>{stop.disabled=true;try{renderStatus(await postNative('stop',{id:s.id}));}catch(e){state.textContent=e.message;}finally{stop.disabled=false;}};
  let capabilityRequest=0;
  async function checkCapability(){const seq=++capabilityRequest,cap=await api('/api/native/capability?id='+encodeURIComponent(s.id)+'&provider='+providerPicker.value);if(selected!==s.id||generation!==nativeSelection||seq!==capabilityRequest)return;if(cap.routing&&!providerPicker.querySelector('option[value="auto"]')){const auto=el('option','','自動派工');auto.value='auto';providerPicker.prepend(auto);providerPicker.value=providerChoices.get(draftKey)||'auto';}available=cap.available;providerPicker.hidden=!cap.switchable;note.textContent=cap.note;send.disabled=busy||!available;input.disabled=busy||!available;if(cap.available)$('detail').querySelector('.pill').textContent=s.handoff?'跨 AI 接續':s.managed?'面板獨立對話':'可原生續聊';previewRoute();return cap;}
  providerPicker.onchange=async()=>{providerChoices.set(draftKey,providerPicker.value);send.disabled=true;available=false;try{await checkCapability();}catch(e){note.textContent=e.message;}};
  try{const cap=await checkCapability();if(cap?.available){$('context').append(el('label','','目前 AI 原生 Session ID'),el('p','',cap.sourceSessionId));}await poll();}catch(e){note.textContent=e.message;}
};
