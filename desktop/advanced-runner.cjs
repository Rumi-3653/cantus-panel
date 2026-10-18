'use strict';
// New conversations only. Existing source sessions remain under the original server's writer.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {ManagedRunner}=require('../managed.cjs');
const fail=(message,status=409)=>Object.assign(Error(message),{status});
const now=()=>new Date().toISOString(),clip=v=>typeof v==='string'?v.slice(0,65536):JSON.stringify(v??null).slice(0,65536);
class AdvancedRunner extends ManagedRunner{
 constructor(options={}){
  super({...options,fullAccess:false});this.traces=new Map();this.flushers=new Map();
  const spawn=this.spawn,sqliteRoot=options.sqliteRoot||process.env.CANTUS_NEXT_SQLITE_ROOT||path.join(__dirname,'..','state','desktop','runtime');
  this.spawn=(command,args,opts)=>{if(args.includes('app-server')){const id=path.basename(path.dirname(opts.env.CODEX_HOME)),root=path.join(sqliteRoot,id);fs.mkdirSync(root,{recursive:true,mode:0o700});opts={...opts,env:{...opts.env,CODEX_SQLITE_HOME:root}};}return spawn(command,args,opts);};
 }
 owns(id){return this.records.has(id);}
 list(){return super.list().map(s=>({...s,nextOwned:true,source:'新版獨立對話'}));}
 async create(provider,options){return {...await super.create(provider,options),nextOwned:true};}
 traceFile(id){return path.join(this.root,id,'runs.json');}
 trace(id){if(!this.owns(id))throw fail('此對話由原版執行；請從新版建立獨立對話。',404);if(!this.traces.has(id)){const file=this.traceFile(id);this.traces.set(id,fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{version:1,runs:[]});}const data=this.traces.get(id);let prior=this.records.get(id).deliveries.length<=data.runs.length?{}:null;for(const row of data.runs){if(row.provider!=='codex')continue;const total=row.usage?.total;if(!total)continue;const baseline=row.usageBaseline??prior;if(baseline){const entries=Object.entries(total);if(entries.every(([key,n])=>Number.isFinite(n)&&n>=(baseline[key]||0))){row.usageBaseline=baseline;row.turnUsage=Object.fromEntries(entries.map(([key,n])=>[key,n-(baseline[key]||0)]));}else delete row.turnUsage;}prior=total;}return data;}
 flush(id){clearTimeout(this.flushers.get(id));this.flushers.delete(id);const file=this.traceFile(id),temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(this.trace(id))+'\n',{mode:0o600});fs.renameSync(temp,file);}
 changed(id,immediate=false){if(immediate)return this.flush(id);if(!this.flushers.has(id)){const timer=setTimeout(()=>{try{this.flush(id);}catch{const run=this.runs.get(id);if(run)this.fail(run,Object.assign(Error('無法保存執行紀錄，已停止新版回合。'),{code:'storage'}));}},200);timer.unref?.();this.flushers.set(id,timer);}}
 log(run){const data=this.trace(run.id);let row=data.runs.find(r=>r.requestId===run.requestId);if(!row){const prior=[...data.runs].reverse().find(r=>r.usage?.total);row={requestId:run.requestId,provider:run.provider,startedAt:now(),phase:run.phase,steps:[],instructions:[],controls:[],...(run.provider==='codex'?{usageBaseline:prior?.usage.total||{}}:{})};data.runs.push(row);if(data.runs.length>100)data.runs.shift();}return row;}
 persist(run,phase){super.persist(run,phase);const row=this.log(run);row.phase=run.phase;row.turnId=run.turnId||row.turnId;row.model=run.actualModel||run.selection?.model||row.model;row.updatedAt=now();this.changed(run.id,true);}
 async sendManaged(input){const last=this.trace(input.id).runs.at(-1);if(last?.phase==='paused'&&!input.resume)throw fail('此回合已暫停，請按「繼續執行」。');return super.sendManaged(input);}
 capability(id){const r=this.records.get(id);return r?{available:true,sourceSessionId:r.sid||'首次送出時建立',mode:'next-owned',switchable:false,routing:false,advanced:{steps:true,pause:true,resume:true,retry:true,steer:r.provider==='codex',usage:true},note:'新版獨立對話；工具權限逐次確認。暫停會中斷本回合，繼續時沿用同一對話開新回合。'}:{available:false,note:'找不到新版對話'};}
 status(id){const value=super.status(id);if(!this.owns(id))return value;const row=this.trace(id).runs.at(-1);if(row&&!this.runs.has(id))Object.assign(value,{phase:['preparing','running','approval','sending','pausing'].includes(row.phase)?'failed':row.phase,requestId:row.requestId,provider:row.provider,model:row.model,historyUpdated:true,error:['preparing','running','approval','sending','pausing'].includes(row.phase)?'服務重啟前的回合未確認完成，沒有自動重送。':''});return {...value,advanced:this.capability(id).advanced,startedAt:row?.startedAt,endedAt:row?.endedAt,trace:row||null};}
 runHistory(id){return {...this.trace(id),capability:this.capability(id),status:this.status(id)};}
 step(run,item,complete=false,at){
  const row=this.log(run);let step=row.steps.find(s=>s.id===item.id);if(!step){if(row.steps.length>=2000)throw fail('單回合步驟超過上限。');step={id:item.id,type:item.type,startedAt:at||now(),status:'inProgress'};row.steps.push(step);}
  // Reasoning content is private; retain only the lifecycle of this item.
  for(const key of ['command','cwd','text','tool','server','query','aggregatedOutput','exitCode','durationMs','arguments','result','changes','error','contentItems','phase'])if(item[key]!=null&&item.type!=='reasoning')step[key]=typeof item[key]==='number'?item[key]:clip(item[key]);
  step.status=item.status|| (complete?'completed':step.status);if(complete)step.endedAt=at||now();
  if(item.type==='userMessage')for(const note of row.instructions)if((item.clientId&&item.clientId===note.id)||(item.content||[]).some(c=>c.type==='text'&&c.text===note.text)){note.state='received';note.itemId=item.id;note.receivedAt=now();}
  this.changed(run.id);
 }
 frame(run,value){
  if(run.finished)return;
  if(run.provider==='codex'){
   const p=value.params||{},scoped=/^(item\/|turn\/|thread\/tokenUsage)/.test(value.method||'');
   if(scoped&&run.sid&&p.threadId&&p.threadId!==run.sid)throw fail('收到其他對話的事件，已停止。');
   if(scoped&&run.turnId&&(p.turnId||p.turn?.id)===run.turnId){
    if(['item/started','item/completed'].includes(value.method)&&p.item?.id)this.step(run,p.item,value.method==='item/completed',Number.isFinite(value.method==='item/started'?p.startedAtMs:p.completedAtMs)?new Date(value.method==='item/started'?p.startedAtMs:p.completedAtMs).toISOString():undefined);
    if(value.method==='item/commandExecution/outputDelta'){const step=this.log(run).steps.find(s=>s.id===p.itemId);if(step){step.aggregatedOutput=((step.aggregatedOutput||'')+String(p.delta||'')).slice(-65536);this.changed(run.id);}}
    if(value.method==='turn/plan/updated'){this.log(run).plan=p.plan;this.changed(run.id);}
    if(value.method==='thread/tokenUsage/updated'){this.log(run).usage=p.tokenUsage;this.changed(run.id);}
    if(value.method==='turn/completed'&&run.pauseRequested){if(p.turn?.status==='interrupted'){run.result=true;run.paused=true;run.child.stdin.end();return;}run.pauseRequested=false;}
   }
  }else if(!value.session_id||value.session_id===run.sid){
   if(value.type==='control_response'&&run.pauseRequested&&String(value.response?.request_id)===run.pauseRpcId&&value.response?.subtype==='success'){run.pauseAcknowledged=true;this.log(run).controls.push({action:'pause_acknowledged',at:now()});}
   if(value.type==='assistant')for(const item of value.message?.content||[]){if(item.type==='tool_use')this.step(run,{id:item.id,type:'toolCall',tool:item.name,arguments:item.input});}
   if(value.type==='user')for(const item of value.message?.content||[])if(item.type==='tool_result')this.step(run,{id:item.tool_use_id,type:'toolCall',result:item.content,status:item.is_error?'failed':'completed'},true);
   if(value.type==='result'){const row=this.log(run);row.usage=value.usage||null;if(Number.isFinite(value.total_cost_usd))row.costUSD=value.total_cost_usd;this.changed(run.id);if(run.pauseRequested&&run.pauseAcknowledged&&['aborted_tools','aborted_streaming','interrupted'].includes(value.terminal_reason)){run.paused=true;run.claudePauseConfirmed=true;run.result=true;run.claudeResultReceived=true;run.claudeTurnInProgress=false;row.controls.push({action:'pause_confirmed',terminalReason:value.terminal_reason,at:now()});this.finishClaude(run);return;}if(run.pauseRequested&&!value.is_error)run.pauseRequested=false;}
  }else throw fail('收到其他對話的事件，已停止。');
  return super.frame(run,value);
 }
 async complete(run){
  if(!run.verifiedSession)throw fail('未確認對話，無法完成回合。');
  if(run.provider==='claude'&&run.paused&&(!run.pauseAcknowledged||!run.claudePauseConfirmed||run.claudeState!=='idle'||run.claudeTasks?.size||run.approvals.size))throw fail('原工具尚未確認暫停完成。');
  const record=this.records.get(run.id),text=[...run.texts.values()].join('\n\n');if(text)record.rows.push({role:'assistant',text,at:now()});run.phase=run.paused?'paused':'completed';run.historyUpdated=true;
  const row=this.log(run);row.phase=run.phase;row.endedAt=now();row.model=run.actualModel||run.selection?.model;for(const step of row.steps)if(step.status==='inProgress'){step.status=run.paused?'interrupted':'unknown';step.endedAt=now();}this.persist(run,run.phase);run.busy=false;run.finished=true;this.cleanup(run);
 }
 fail(run,error){if(!run.finished&&!run.stopRequested&&run.provider==='claude'&&run.claudePauseConfirmed&&run.paused&&run.closed&&run.child?.exitCode===1&&run.claudeState==='idle'&&!run.claudeTasks?.size&&!run.approvals.size&&error.code==='provider')return this.complete(run).catch(e=>{run.claudePauseConfirmed=false;this.fail(run,e);});try{super.fail(run,error);}catch{run.error='紀錄保存失敗；回合已停止，請核對記錄。';run.code='storage';}if(!this.owns(run.id))return;const row=this.log(run);row.phase=run.phase;row.error=run.error;row.endedAt=now();for(const step of row.steps)if(step.status==='inProgress'){step.status=run.phase==='stopped'?'interrupted':'failed';step.endedAt=now();}try{this.changed(run.id,true);}catch{clearTimeout(this.flushers.get(run.id));this.flushers.delete(run.id);run.error='紀錄保存失敗；回合已停止，請核對記錄。';run.code='storage';}}
 approval(run,...args){super.approval(run,...args);this.log(run).phase=run.phase;this.changed(run.id,true);}
 answer(input){const value=super.answer(input),run=this.runs.get(input.id);this.log(run).controls.push({action:input.allow?'approved':'declined',at:now()});this.log(run).phase=run.phase;this.changed(run.id,true);return value;}
 async steer({id,text,requestId}){
  const run=this.runs.get(id);if(!run?.busy||!run.turnId||run.provider!=='codex'||run.pauseRequested)throw fail('目前沒有可插話的 Codex 回合。');
  if(typeof text!=='string'||!text.trim()||text.length>24000||!/^[A-Za-z0-9_-]{8,128}$/.test(requestId||''))throw fail('插話內容無效。',400);
  const row=this.log(run),old=row.instructions.find(n=>n.id===requestId);if(old){if(old.state==='unconfirmed')throw fail('前次插話結果未確認；沒有重新送出。');return this.status(id);}
  const note={id:requestId,text,state:'submitting',at:now()};row.instructions.push(note);this.changed(id,true);
  try{const reply=await this.rpc(run,'turn/steer',{threadId:run.sid,expectedTurnId:run.turnId,input:[{type:'text',text}],clientUserMessageId:requestId});if(reply.turnId!==run.turnId)throw fail('插話回合不一致。');if(note.state==='submitting')note.state='accepted';note.acceptedAt=now();const record=this.records.get(id);record.rows.push({role:'user',text,at:now(),steering:true});this.save(record);}catch(error){note.state='unconfirmed';note.error=error.message;throw error;}finally{this.changed(id,true);}return this.status(id);
 }
 async pause(id){
  const run=this.runs.get(id);if(!run?.busy||run.finished||run.pauseRequested)throw fail('目前沒有可暫停的回合。');if(run.provider==='codex'&&!run.turnId)throw fail('正在建立回合，請稍候。');
  run.pauseRequested=true;run.phase='pausing';const row=this.log(run);row.phase=run.phase;row.controls.push({action:'pause_requested',at:now()});this.changed(id,true);
  if(run.provider==='claude'){run.pauseRpcId=String(run.nextRpc);run.pauseAcknowledged=false;}
  try{await this.rpc(run,run.provider==='codex'?'turn/interrupt':'interrupt',run.provider==='codex'?{threadId:run.sid,turnId:run.turnId}:{});}catch(error){if(!run.finished&&!run.paused){run.pauseRequested=false;run.phase=run.approvals.size?'approval':'running';row.phase=run.phase;this.changed(id,true);throw error;}}return this.status(id);
 }
 async stop(id){const row=this.trace(id).runs.at(-1),run=this.runs.get(id);if(row?.phase==='paused'&&!run?.busy){row.phase='stopped';row.controls.push({action:'stop_paused',at:now()});if(run)run.phase='stopped';const record=this.records.get(id),delivery=record.deliveries.find(d=>d.requestId===row.requestId);if(delivery)delivery.phase='stopped';this.save(record);this.changed(id,true);return this.status(id);}return super.stop(id);}
 async resume({id,requestId}){const row=this.trace(id).runs.at(-1);if(row?.phase!=='paused')throw fail('這段對話目前沒有暫停回合。');const value=await this.send({id,requestId,resume:true,text:'繼續剛剛暫停的工作。先確認上一步是否已完成，再從未完成的部分繼續；不要重複已完成的操作。',model:row.model});this.log(this.runs.get(id)).resumes=row.requestId;this.changed(id,true);return value;}
 async retry({id,runId,stepId,requestId}){if(this.runs.get(id)?.busy)throw fail('請等目前回合結束再重試。');const row=this.trace(id).runs.find(r=>r.requestId===runId),step=row?.steps.find(s=>s.id===stepId);if(!step||!['failed','declined','interrupted'].includes(step.status))throw fail('這個步驟沒有可重試的失敗紀錄。');const value=await this.send({id,requestId,resume:true,text:'請重新處理這個未完成步驟。先檢查現況與前次副作用，再決定是否重試。不可假設前次完全沒有執行。\n'+JSON.stringify({type:step.type,command:step.command,tool:step.tool,arguments:step.arguments,error:step.error,result:step.result}).slice(0,16000),model:row.model});this.log(this.runs.get(id)).retryOf={runId,stepId};this.changed(id,true);return value;}
}
module.exports={AdvancedRunner};
