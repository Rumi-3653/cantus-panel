'use strict';
const {spawn}=require('node:child_process');
const runtime=require('./runtime.cjs');
const CODEX=runtime.codexBin,CLAUDE=runtime.claudeBin;
// Initialization/model-list only: never start a thread or submit user content.
function probe(provider,{spawnImpl=spawn,timeout=15000,commands={codex:CODEX,claude:CLAUDE},environment,cwd=runtime.workRoot}={}){return new Promise((resolve,reject)=>{
 if(!runtime.execution)return reject(Error('模型查詢未啟用；尚未啟動任何 AI 程序'));
 const env=environment?{...environment}:{...process.env,CODEX_HOME:runtime.codexHome,CLAUDE_CONFIG_DIR:runtime.claudeConfig,CLAUDE_CODE_TMPDIR:runtime.claudeTemp};delete env.ANTHROPIC_API_KEY;delete env.ANTHROPIC_BASE_URL;delete env.CLAUDECODE;
 const args=provider==='codex'?['app-server','--listen','stdio://']:['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--setting-sources','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--tools',''];
 const child=spawnImpl(commands[provider],args,{cwd,env,stdio:['pipe','pipe','pipe']});let done=false,buffer='',bytes=0,data=[];
 const timer=setTimeout(()=>finish(Error('模型清單讀取逾時')),timeout);
 function finish(error,value){if(done)return;done=true;clearTimeout(timer);child.kill();error?reject(error):resolve(value);}
 function write(v){child.stdin.write(JSON.stringify(v)+'\n');}
 child.on('error',()=>finish(Error('無法啟動 '+provider+' 模型查詢')));child.on('exit',()=>finish(Error(provider+' 模型查詢已結束')));child.stderr.on('data',()=>{});
 child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>1024*1024)return finish(Error('模型清單超過上限'));buffer+=chunk;let end;
  while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let v;try{v=JSON.parse(line);}catch{continue;}
   if(provider==='codex'){
    if(v.error)return finish(Error('Codex 無法讀取模型清單'));
    if(v.id===1){write({method:'initialized'});write({id:2,method:'model/list',params:{limit:100,includeHidden:false}});}
    if(v.id===2){data.push(...(v.result?.data||[]));if(v.result?.nextCursor){write({id:2,method:'model/list',params:{limit:100,cursor:v.result.nextCursor,includeHidden:false}});continue;}
     return finish(null,data.filter(m=>!m.hidden).map(m=>({id:m.model||m.id,name:m.displayName||m.model||m.id,efforts:(m.supportedReasoningEfforts||[]).map(e=>e.reasoningEffort),defaultEffort:m.defaultReasoningEffort||'',isDefault:!!m.isDefault})));}
   }else if(v.type==='control_response'&&v.response?.request_id==='models'){
    if(v.response.subtype!=='success')return finish(Error('Claude 無法讀取模型清單'));
    return finish(null,(v.response.response?.models||[]).map(m=>({id:m.value,name:m.displayName||m.value,resolvedModel:m.resolvedModel,efforts:m.supportedEffortLevels||[],isDefault:m.value==='default'})));
   }
  }
 });
 write(provider==='codex'?{id:1,method:'initialize',params:{clientInfo:{name:'cantus_models',version:'0.3.3'},capabilities:{experimentalApi:true}}}:{type:'control_request',request_id:'models',request:{subtype:'initialize',hooks:null}});
});}
class ModelCatalog{
 constructor(probeImpl=probe){this.probe=probeImpl;this.cache=new Map();this.pending=new Map();}
 async get(provider,refresh=false){const saved=this.cache.get(provider);if(!refresh&&saved&&Date.now()-saved.time<600000)return saved.value;if(this.pending.has(provider))return this.pending.get(provider);
  const p=this.probe(provider).then(models=>{if(!models.length)throw Error('模型清單為空');const value={models,available:true,checkedAt:new Date().toISOString()};this.cache.set(provider,{time:Date.now(),value});return value;}).catch(e=>({models:saved?.value.models||[],available:false,error:e.message,checkedAt:saved?.value.checkedAt||null})).finally(()=>this.pending.delete(provider));this.pending.set(provider,p);return p;
 }
 async all(refresh=false){const [codex,claude]=await Promise.all(['codex','claude'].map(p=>this.get(p,refresh)));return {codex,claude};}
 async check(target){if(!target.model)return {ok:true};const catalog=await this.get(target.provider);if(!catalog.available)return {ok:false,reason:catalog.error};const model=catalog.models.find(m=>m.id===target.model);if(!model)return {ok:false,reason:'目前模型清單找不到 '+target.model};if(target.effort&&!model.efforts.includes(target.effort))return {ok:false,reason:'此模型不支援 '+target.effort+' 思考強度'};return {ok:true};}
}
module.exports={ModelCatalog,probe};
