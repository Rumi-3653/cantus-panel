/* Settings follow the selected platform; credentials never enter this form. */
(()=>{
 let saved=null,draft=null,models={},dirty=false,loading=false;
 const dialog=el('dialog','routing-dialog');dialog.setAttribute('aria-labelledby','routing-title');
 const heading=el('div','routing-heading'),intro=el('div'),eyebrow=el('p','eyebrow','YOUR DISPATCH RULES'),title=el('h2','','我的派工規則');title.id='routing-title';
 intro.append(eyebrow,title);const close=el('button','routing-close','關閉');heading.append(intro,close);
 const description=el('p','routing-description','設定一次，平常直接聊天。由上往下比對關鍵字；先符合的規則負責，未符合時使用一般對話設定。');
 const scope=el('p','routing-scope','這台 Mac 的派工設定 · 不改動原工具的全域設定'),status=el('p','routing-status');status.setAttribute('role','status');
 const content=el('div','routing-content'),footer=el('div','routing-footer'),save=el('button','send-message','儲存規則'),restore=el('button','','載入推薦規則'),refresh=el('button','','重新取得模型');
 footer.append(restore,refresh,save);dialog.append(heading,description,scope,status,content,footer);document.body.append(dialog);
 const open=el('button','routing-open','⚙︎');open.type='button';open.title='派工設定';open.setAttribute('aria-label','派工設定');open.setAttribute('aria-haspopup','dialog');document.querySelector('.sidebar-bottom p').append(open);
 const mark=()=>{dirty=true;status.textContent='尚未儲存；儲存後從下一次送出開始生效。';};
 const currentKey=()=>window.cantusPlatform?.key('routing')||'local';
 async function json(url,options){const key=currentKey(),generation=window.cantusPlatform?.generation,r=await (window.cantusPlatform?.fetch||fetch)(url,options),v=await r.json();if(key!==currentKey()||generation!==window.cantusPlatform?.generation)throw Error('平台已切換，已略過舊設定');if(!r.ok)throw Error(v.error||'設定讀取失敗');return v;}
 async function read(){saved=await json('/api/routing/settings');window.cantusRouting?.preview?.();return saved;}
 window.cantusRouting={get config(){return saved;},read,reset(){saved=null;draft=null;models={};dirty=false;dialog.close();}};
 function label(text,input){const l=el('label','routing-field',text);l.append(input);return l;}
 function option(select,value,name){const o=el('option','',name);o.value=value;select.append(o);}
 function targetFields(target,prefix){
  const fields=el('div','routing-target'),provider=el('select'),model=el('select'),effort=el('select');
  for(const p of window.cantusPlatform?.providers||['claude','codex'])option(provider,p,p==='claude'?'Claude':'Codex');provider.value=target.provider;
  for(const [input,name]of [[provider,'負責 AI'],[model,'模型'],[effort,'思考強度']])input.setAttribute('aria-label',prefix+' · '+name);
  function updateEffort(){effort.replaceChildren();option(effort,'','模型預設');const m=models[target.provider]?.models.find(m=>m.id===target.model);for(const e of m?.efforts||[])option(effort,e,e);if(target.effort&&![...effort.options].some(o=>o.value===target.effort))option(effort,target.effort,target.effort+'（需重新確認）');effort.value=target.effort;effort.disabled=!target.model||!m?.efforts.length;}
  function updateModels(){model.replaceChildren();option(model,'','沿用原工具設定');for(const m of models[target.provider]?.models||[])option(model,m.id,m.name);if(target.model&&![...model.options].some(o=>o.value===target.model))option(model,target.model,target.model+'（需重新確認）');model.value=target.model;updateEffort();}
  provider.onchange=()=>{target.provider=provider.value;target.model=target.effort='';updateModels();mark();};
  model.onchange=()=>{target.model=model.value;target.effort='';updateEffort();mark();};effort.onchange=()=>{target.effort=effort.value;mark();};updateModels();
  fields.append(label('負責 AI',provider),label('模型',model),label('思考強度',effort));return fields;
 }
 function render(){
  content.replaceChildren();if(!draft)return;
  const enabled=el('input');enabled.type='checkbox';enabled.checked=draft.enabled;enabled.onchange=()=>{draft.enabled=enabled.checked;mark();};const toggle=el('label','routing-toggle');toggle.append(enabled,document.createTextNode('聊天預設自動派工'));content.append(toggle);
  draft.rules.forEach((rule,index)=>{
   const card=el('section','routing-rule'),bar=el('div','routing-rule-heading'),number=el('span','routing-number',String(index+1).padStart(2,'0')),name=el('input');name.value=rule.name;name.maxLength=40;name.setAttribute('aria-label','規則 '+(index+1)+' 名稱');name.oninput=()=>{rule.name=name.value;mark();};
   const on=el('input');on.type='checkbox';on.checked=rule.enabled;on.setAttribute('aria-label','啟用 '+rule.name);on.onchange=()=>{rule.enabled=on.checked;mark();};
   const up=el('button','','↑'),down=el('button','','↓'),remove=el('button','','移除');up.setAttribute('aria-label','上移 '+rule.name);down.setAttribute('aria-label','下移 '+rule.name);remove.setAttribute('aria-label','移除 '+rule.name);up.disabled=index===0;down.disabled=index===draft.rules.length-1;
   up.onclick=()=>{[draft.rules[index-1],draft.rules[index]]=[rule,draft.rules[index-1]];mark();render();};down.onclick=()=>{[draft.rules[index+1],draft.rules[index]]=[rule,draft.rules[index+1]];mark();render();};remove.onclick=()=>{draft.rules.splice(index,1);mark();render();};bar.append(number,on,name,up,down,remove);
   const details=el('details','routing-advanced'),summary=el('summary','','關鍵字與備援'),keywords=el('input');keywords.value=rule.keywords.join('、');keywords.maxLength=1500;keywords.setAttribute('aria-label',rule.name+' · 關鍵字');keywords.oninput=()=>{rule.keywords=keywords.value.split(/[、,，\n]/).map(x=>x.trim()).filter(Boolean);mark();};
   const fallback=el('input');fallback.type='checkbox';fallback.checked=!!rule.fallback;fallback.setAttribute('aria-label',rule.name+' · 啟用備援');const fallbackToggle=el('label','routing-toggle');fallbackToggle.append(fallback,document.createTextNode('主模型在送出前不可用時，使用備援'));
   const fallbackFields=el('div');const drawFallback=()=>{fallbackFields.replaceChildren();if(rule.fallback)fallbackFields.append(targetFields(rule.fallback,rule.name+'備援'));};fallback.onchange=()=>{const providers=window.cantusPlatform?.providers||['claude','codex'];rule.fallback=fallback.checked?{provider:providers.find(p=>p!==rule.provider)||rule.provider,model:'',effort:''}:null;drawFallback();mark();};drawFallback();
   details.append(summary,label('符合任一關鍵字（用頓號分隔）',keywords),fallbackToggle,fallbackFields);card.append(bar,targetFields(rule,rule.name),details);content.append(card);
  });
  const add=el('button','routing-add','＋ 新增派工規則');add.disabled=draft.rules.length>=12;add.onclick=()=>{draft.rules.push({id:'rule_'+crypto.randomUUID().slice(0,8),name:'自訂任務',enabled:true,keywords:[],provider:draft.defaultTarget.provider,model:'',effort:'',fallback:null});mark();render();};content.append(add);
  const general=el('section','routing-rule'),generalTitle=el('h3','','沒有符合規則時');general.append(generalTitle,targetFields(draft.defaultTarget,'一般對話'),el('p','routing-hint','簡短的「繼續」「照做」會承接上一個成功回合的任務規則。原工具設定＝不指定模型；實際模型以執行端為準。'));content.append(general);
  const preview=el('section','routing-preview'),input=el('textarea'),result=el('p','routing-result','輸入一句話，看看會交給誰。');input.rows=2;input.placeholder='例如：幫我修好登入錯誤';input.setAttribute('aria-label','試派工訊息');input.maxLength=24000;result.setAttribute('aria-live','polite');
  input.oninput=()=>{const d=CantusRules.choose(draft,input.value);result.textContent=(d.provider==='codex'?'Codex':'Claude')+' · '+(d.model||'沿用原工具設定')+' — '+d.ruleName+'；'+d.reason;};preview.append(el('h3','','試派工'),el('p','routing-hint','使用畫面上的規則試算，不呼叫 AI、不送出訊息。'),input,result);content.append(preview);
  content.append(el('p','routing-hint','備援只處理送出前的模型檢查失敗。送出後失敗或結果不明，一律停止、不自動重送。派工不代表批准公開、部署或其他外部操作。'));
 }
 async function loadModels(force=false){models=await json('/api/routing/models'+(force?'?refresh=1':''));if(!dialog.open)return;render();const warnings=Object.entries(models).filter(([,v])=>!v.available).map(([p,v])=>p+'：'+v.error);status.textContent=warnings.length?warnings.join('；'):dirty?'有尚未儲存的變更。':'模型清單已讀取；儲存後從下一次送出開始生效。';}
 open.onclick=async()=>{if(loading)return;const cloud=window.cantusPlatform?.mode==='cloud';if(cloud&&!window.cantusPlatform.authenticated){toast('請先登入 '+window.cantusPlatform.label+' 雲端工作區。');return;}scope.textContent=cloud?window.cantusPlatform.label+' 共用派工設定 · 僅影響這台雲端，不改動這台 Mac':'這台 Mac 的派工設定 · 不改動原工具的全域設定';dialog.showModal();status.textContent='讀取設定中…';loading=true;save.disabled=true;
  try{await read();draft=structuredClone(saved);dirty=false;render();save.disabled=cloud&&window.cantusPlatform.role!=='editor';await loadModels();}catch(e){status.textContent=e.message;}finally{loading=false;}
 };
 function closeDialog(){if(dirty&&!window.confirm('有尚未儲存的派工設定。確定關閉並捨棄？'))return;dialog.close();dirty=false;}
 close.onclick=closeDialog;dialog.addEventListener('cancel',e=>{e.preventDefault();closeDialog();});
 refresh.onclick=async()=>{refresh.disabled=true;status.textContent='重新取得模型中…';try{await loadModels(true);}catch(e){status.textContent=e.message;}finally{refresh.disabled=false;}};
 restore.onclick=()=>{draft={...CantusRules.defaults(),revision:saved.revision};const providers=window.cantusPlatform?.providers;if(providers?.length===1)for(const target of [draft.defaultTarget,...draft.rules])target.provider=providers[0];mark();render();};
 save.onclick=async()=>{save.disabled=true;try{const config=CantusRules.validate(draft),boot=await json('/api/bootstrap');saved=await json('/api/routing/settings',{method:'POST',headers:{'Content-Type':'application/json','X-Cantus-Token':boot.csrf},body:JSON.stringify(config)});draft.revision=saved.revision;dirty=false;status.textContent='已儲存 · 從下一次送出開始生效';window.cantusRouting.preview?.();}catch(e){status.textContent=e.message;}finally{save.disabled=window.cantusPlatform?.mode==='cloud'&&window.cantusPlatform.role!=='editor';}};
 read().catch(()=>{});
})();
