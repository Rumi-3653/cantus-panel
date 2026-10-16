/* Shared deterministic routing: editable words, first match, no extra model call. */
((root,factory)=>{if(typeof module==='object'&&module.exports)module.exports=factory();else root.CantusRules=factory();})(globalThis,()=>{
 const target=provider=>({provider,model:'',effort:''});
 const rule=(id,name,keywords,provider)=>({id,name,keywords,enabled:true,...target(provider),fallback:null});
 function defaults(){return {version:1,revision:0,enabled:true,defaultTarget:target('claude'),rules:[
  rule('planning','需求與規劃',['需求','規劃','方案','架構','先討論','不要寫程式','不寫程式','不要修改','只分析','plan','brainstorm'],'claude'),
  rule('writing','文案與整理',['文案','潤稿','翻譯','摘要','整理成','文章','信件','copywriting','translate','summarize'],'claude'),
  rule('debug','修錯',['修錯','修復','修好','除錯','錯誤','bug','debug','fix'],'codex'),
  rule('testing','測試與驗證',['測試','驗證','test','verify','驗收'],'codex'),
  rule('coding','程式與實作',['寫程式','實作','修改程式','重構','開發','寫個','做一個','做成','功能','implement','refactor','code'],'codex')
 ]};}
 const normalize=s=>s.normalize('NFKC').toLocaleLowerCase();
 function validate(input){
  const bad=message=>{throw Object.assign(Error(message),{status:400,code:'routing'});};
  if(!input||input.version!==1||!Number.isSafeInteger(input.revision)||input.revision<0||typeof input.enabled!=='boolean'||!Array.isArray(input.rules)||input.rules.length>12)bad('派工設定格式不正確（最多 12 條規則）');
  function checkTarget(t){if(!t||!['codex','claude'].includes(t.provider)||typeof t.model!=='string'||t.model.length>100||t.model&&!/^[a-zA-Z0-9][a-zA-Z0-9._:[\]-]*$/.test(t.model)||typeof t.effort!=='string'||!['','none','minimal','low','medium','high','xhigh','max','ultra'].includes(t.effort)||!t.model&&t.effort)bad('AI、模型或思考強度不正確');return {provider:t.provider,model:t.model,effort:t.effort};}
  const ids=new Set();return {version:1,revision:input.revision,enabled:input.enabled,defaultTarget:checkTarget(input.defaultTarget),rules:input.rules.map(r=>{
   if(!r||typeof r.id!=='string'||!/^[a-z0-9_-]{1,40}$/.test(r.id)||ids.has(r.id)||typeof r.name!=='string'||!r.name.trim()||r.name.length>40||typeof r.enabled!=='boolean'||!Array.isArray(r.keywords)||r.keywords.length>30||r.keywords.some(k=>typeof k!=='string'||!k.trim()||k.length>50))bad('規則名稱、關鍵字或識別碼不正確');
   ids.add(r.id);return {id:r.id,name:r.name.trim(),enabled:r.enabled,keywords:[...new Set(r.keywords.map(k=>k.trim()))],...checkTarget(r),fallback:r.fallback?checkTarget(r.fallback):null};
  })};
 }
 function choose(config,text,previous=null,manual=null){
  if(manual)return {...target(manual),ruleId:null,ruleName:'手動指定',reason:'本回合手動指定 AI',fallback:null};
  if(!config.enabled)return {...config.defaultTarget,ruleId:null,ruleName:'預設 AI',reason:'自動派工已關閉',fallback:null};
  const clean=normalize(String(text).replace(/```[\s\S]*?```/g,'').replace(/^>.*$/gm,''));
  for(const r of config.rules){if(!r.enabled)continue;const matched=r.keywords.find(k=>{const word=normalize(k);return /^[a-z0-9 _-]+$/.test(word)?new RegExp('(?:^|[^a-z0-9])'+word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:$|[^a-z0-9])').test(clean):clean.includes(word);});if(matched)return {...r,ruleId:r.id,ruleName:r.name,reason:'符合「'+matched+'」'};}
  if(/^(繼續|好|好的|可以|照做|接著做|完成它|continue|go ahead|yes)[。！!\s]*$/i.test(clean.trim())&&previous){const r=config.rules.find(r=>r.id===previous.ruleId&&r.enabled);if(r)return {...r,ruleId:r.id,ruleName:r.name,reason:'承接上一回合的任務'};}
  return {...config.defaultTarget,ruleId:null,ruleName:'一般對話',reason:'未符合特定規則，使用預設 AI',fallback:null};
 }
 return {defaults,validate,choose};
});
