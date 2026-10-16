'use strict';
const fs=require('node:fs'),path=require('node:path');
const runtime=require('./runtime.cjs');
const {sourcesFor,messageFor}=require(runtime.exporter);
const {PanelRunner}=require('./panel-runner.cjs');
const {nativeCommand}=require(runtime.exporter+'/session-link-runner');
const sourceOptions={env:{},codexHome:runtime.codexHome,codexSqliteHome:runtime.codexHome,claudeProjectsDir:runtime.claudeConfig+'/projects',claudeDesktopDir:runtime.claudeDesktop,language:'zh-TW'};
const failure=(code,message,status=409)=>Object.assign(Error(message),{code,status});
function createNative(lookup,options={}){
  const env={...process.env,HUB_STORAGE_GUARD:runtime.guard,HUB_CLAUDE_DESKTOP_DIR:runtime.claudeDesktop,AI_SESSION_CODEX_BIN:runtime.codexBin,AI_SESSION_CLAUDE_BIN:runtime.claudeBin};
  // Always resolve opaque catalog IDs on the server. Never accept paths, CLI flags or native IDs from HTTP.
  async function resolve(id){
    const entry=lookup(id);if(!entry)throw failure('missing','找不到這個會話',404);
    if(!entry.hasTranscript)throw failure('unsupported','只有索引，不能原生續作');
    const source=sourcesFor(sourceOptions)[entry.provider];
    await source.discover();
    return {entry,source};
  }
  async function history(id,options={}){const {source}=await resolve(id);return source.read(id,{page:true,...options});}
  async function referenceFor(id){
    const {entry,source}=await resolve(id),ref=await source.referenceFor(id),h=await source.read(id,{page:true});
    if(h.active!==false)throw failure('busy',h.active?'原會話仍在執行，請等它結束。':'無法確認原會話已閒置，暫不送出。');
    if(entry.isSubagent||['subagent','guardian_review'].includes(entry.threadSource)||entry.agentPath?.startsWith('/root/'))throw failure('unsupported','子代理會話不開放直接續作');
    const command=nativeCommand(entry.provider,ref,env);
    if(!path.isAbsolute(command))throw failure('cli','找不到原 App 的 CLI，未改用其他模型或工具。');
    fs.accessSync(command,fs.constants.X_OK);
    return ref;
  }
  const runner=new PanelRunner({referenceFor,history,env,largeHistory:true,fullAccess:runtime.fullAccess,receiptsFile:path.join(__dirname,'state','deliveries.json'),message:messageFor,...options});
  async function capability(id){
    try{const ref=await referenceFor(id);return {available:true,sourceSessionId:ref.sourceSessionId,mode:'native-resume',note:'寫回同一原生 session；占用時不搶鎖，工具操作保留原生批准流程。'};}
    catch(e){return {available:false,code:e.code||'source',note:messageFor(e.code,e.message)};}
  }
  return {runner,capability};
}
module.exports={createNative};
