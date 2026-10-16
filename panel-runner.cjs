'use strict';
const {SessionLinkRunner}=require(require('./runtime.cjs').exporter+'/session-link-runner');
const {AsyncLocalStorage}=require('node:async_hooks');
// Keep the shared exporter untouched. A stop acknowledgement must not keep an
// HTTP request waiting when a provider closes its stream before replying.
class PanelRunner extends SessionLinkRunner{
  constructor(options={}){
    super(options);this.fullAccess=options.fullAccess===true;this.selectionContext=new AsyncLocalStorage();
    const nativeSpawn=this.spawn;this.spawn=(command,args,options)=>{
      const selection=this.selectionContext.getStore();
      if(selection&&args.includes('--input-format')){args=[...args];if(selection.model)args.push('--model',selection.model);if(selection.effort)args.push('--effort',selection.effort);}
      return nativeSpawn(command,args,options);
    };
    if(this.fullAccess){const spawn=this.spawn;this.spawn=(command,args,options)=>{
      if(args.includes('--permission-prompt-tool')){args=[...args];const i=args.indexOf('--permission-mode');if(i>=0)args.splice(i,2);args.push('--permission-mode','bypassPermissions');}
      return spawn(command,args,options);
    };}
  }
  withSelection(input,fn){return this.selectionContext.run({model:input.model||'',effort:input.effort||''},fn);}
  send(input){return this.withSelection(input,()=>super.send(input));}
  attach(run){run.selection=this.selectionContext.getStore();return super.attach(run);}
  status(id){const v=super.status(id),run=this.runs.get(id);return {...v,provider:run?.provider,model:run?.actualModel||run?.selection?.model||'',effort:run?.selection?.effort||''};}
  frame(run,value){if(run.provider==='claude'&&value.type==='system'&&value.subtype==='init'&&value.model)run.actualModel=value.model;return super.frame(run,value);}
  rpc(run,method,params){
    const selection=run.selection||this.selectionContext.getStore();
    if(run.provider==='codex'&&selection){
      if(['thread/start','thread/resume','turn/start'].includes(method)&&selection.model)params={...params,model:selection.model};
      if(method==='turn/start'&&selection.effort)params={...params,effort:selection.effort};
    }
    if(this.fullAccess&&run.provider==='codex'&&['thread/start','thread/resume'].includes(method))params={...params,approvalPolicy:'never',sandbox:'danger-full-access'};
    if(this.fullAccess&&run.provider==='codex'&&method==='turn/start')params={...params,approvalPolicy:'never',sandboxPolicy:{type:'dangerFullAccess'}};
    return super.rpc(run,method,params).then(result=>{if(run.provider==='codex'&&['thread/start','thread/resume'].includes(method)&&result.model)run.actualModel=result.model;return result;});
  }
  approval(run,nativeId,kind,detail,original){
    super.approval(run,nativeId,kind,detail,original);
    if(this.fullAccess){const item=[...run.approvals.values()].find(a=>a.nativeId===nativeId);this.answer({id:run.id,approvalId:item.token,allow:true});}
  }
  async stop(id){
    const run=this.runs.get(id);if(!run?.busy)return this.status(id);
    run.stopRequested=true;let timer;
    try{
      const interrupt=run.provider==='codex'&&run.turnId?this.rpc(run,'turn/interrupt',{threadId:run.sid,turnId:run.turnId}):run.provider==='claude'&&run.child?this.rpc(run,'interrupt',{}):Promise.resolve();
      await Promise.race([interrupt,new Promise(resolve=>{timer=setTimeout(resolve,3000);})]);
    }catch{/* Only our child may be terminated; never kill by provider name. */}
    finally{clearTimeout(timer);}
    this.fail(run,Object.assign(Error('此回合已停止。'),{code:'stopped'}));return this.status(id);
  }
  fail(run,error){super.fail(run,run.stopRequested?Object.assign(Error('此回合已停止。'),{code:'stopped'}):error);}
}
module.exports={PanelRunner};
