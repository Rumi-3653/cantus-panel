'use strict';
// Only IDs created by this panel can reach this runner. Provider protocols are
// shared with the tested native runner; original conversation files are not read.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PanelRunner}=require('./panel-runner.cjs');
const runtime=require('./runtime.cjs');
const fail=(message,status=400)=>Object.assign(Error(message),{code:'managed',status});
const ROOT=path.join(__dirname,'state','managed');
class ManagedRunner extends PanelRunner{
  constructor(options={}){
    super({env:{HUB_STORAGE_GUARD:runtime.guard},fullAccess:runtime.fullAccess,...options});
    this.history=ManagedRunner.prototype.history.bind(this);
    this.root=options.root||ROOT;this.records=new Map();
    if(fs.existsSync(this.root))for(const name of fs.readdirSync(this.root)){
      if(!/^panel_[a-f0-9-]{36}$/.test(name))continue;
      const file=path.join(this.root,name,'conversation.json');
      if(!fs.existsSync(file))continue;
      const record=JSON.parse(fs.readFileSync(file,'utf8'));
      if(record.id!==name||!['codex','claude'].includes(record.provider))throw fail('面板對話資料格式錯誤');
      this.records.set(record.id,record);
    }
  }
  save(record){
    const file=path.join(this.root,record.id,'conversation.json'),tmp=file+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify(record,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,file);
  }
  list(){return [...this.records.values()].filter(r=>!r.hidden).map(r=>({id:r.id,provider:r.provider,title:r.title,cwd:r.cwd,updatedAt:r.updatedAt,hasTranscript:true,managed:true,source:'面板獨立對話'}));}
  status(id){
    const status=super.status(id),r=this.records.get(id);
    if(!this.runs.has(id)&&r?.deliveries.length&&r.deliveries.at(-1).phase!=='completed')return {...status,phase:'failed',error:'上次回合未確認完成；請查看記錄。不會自動重送。',code:'interrupted'};
    return status;
  }
  history(id){const r=this.records.get(id);if(!r)throw fail('找不到面板對話',404);return {rows:r.rows.slice(-120),totalRows:r.rows.length,warnings:[],readOnly:false};}
  async create(provider,options={}){
    if(!['codex','claude'].includes(provider))throw fail('不支援的來源');
    if(!await this.guard())throw fail('Storage Guard 未通過，沒有建立對話',409);
    const id='panel_'+crypto.randomUUID(),cwd=options.cwd||path.join(this.root,id,'workspace');
    if(options.cwd&&(!path.isAbsolute(cwd)||!fs.statSync(cwd).isDirectory()))throw fail('工作目錄不可用');
    fs.mkdirSync(path.join(this.root,id),{recursive:true,mode:0o700});
    if(!options.cwd)fs.mkdirSync(cwd,{recursive:true,mode:0o700});
    const record={id,provider,cwd,hidden:options.hidden===true,title:'新的 '+(provider==='codex'?'Codex':'Claude')+' 對話',updatedAt:new Date().toISOString(),sid:null,rows:[],deliveries:[]};
    this.save(record);this.records.set(id,record);return {...record,managed:true,hasTranscript:true};
  }
  persist(run,phase){
    const r=this.records.get(run.id);if(!r)return;
    this.receipts.set(run.requestId,{linkId:run.id,phase});
    const old=r.deliveries.find(x=>x.requestId===run.requestId);
    if(old)old.phase=phase;else r.deliveries.push({requestId:run.requestId,phase});
    r.updatedAt=new Date().toISOString();this.save(r);
  }
  send(input){return this.withSelection(input,()=>this.sendManaged(input));}
  async sendManaged({id,text,requestId}){
    const r=this.records.get(id);
    if(!r)throw fail('找不到面板對話',404);
    if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>100000||typeof requestId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(requestId))throw fail('無效訊息');
    if(r.deliveries.some(d=>d.requestId===requestId)){
      if(this.runs.get(id)?.requestId===requestId)return this.status(id);
      throw fail('這筆訊息已提交；請查看記錄，不會自動重送。',409);
    }
    if(this.runs.get(id)?.busy)throw fail('這段對話仍在執行',409);
    const run={id,requestId,provider:r.provider,sid:r.sid,busy:true,phase:'preparing',texts:new Map(),approvals:new Map(),pending:new Map(),nextRpc:1,outBytes:0,cwd:r.cwd};
    this.runs.set(id,run);
    try{
      if(!await this.guard())throw fail('Storage Guard 未通過',409);
      this.alive(run);
      const env={...this.env};delete env.ANTHROPIC_API_KEY;delete env.ANTHROPIC_BASE_URL;delete env.CLAUDECODE;
      let command,args;
      if(r.provider==='codex'){
        const home=path.join(this.root,id,'codex');fs.mkdirSync(home,{recursive:true,mode:0o700});
        env.CODEX_HOME=home;env.CODEX_SQLITE_HOME=home;
        command=runtime.codexBin;args=['app-server','--listen','stdio://'];
      }else{
        // Official login stays in its existing location; this UUID and cwd are new.
        env.CLAUDE_CONFIG_DIR=runtime.claudeConfig;
        env.CLAUDE_CODE_TMPDIR=runtime.claudeTemp;
        env.CLAUDE_CODE_SDK_READS_SESSION_STATE='1';
        command=runtime.claudeBin;
        if(!r.sid){r.sid=crypto.randomUUID();run.sid=r.sid;run.newClaude=true;this.save(r);}
        args=[run.newClaude?'--session-id':'--resume',r.sid,'-p','--input-format','stream-json','--output-format','stream-json','--verbose','--permission-prompt-tool','stdio','--permission-prompts','host','--permission-mode','manual','--setting-sources','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--disable-slash-commands','--tools','Bash,Read,Write,Edit'];
      }
      this.persist(run,'preparing');
      r.rows.push({role:'user',text,at:new Date().toISOString()});
      if(r.rows.length===1)r.title=text.trim().slice(0,60);this.save(r);
      run.child=this.spawn(command,args,{cwd:r.cwd,env,stdio:['pipe','pipe','pipe']});
      this.attach(run);run.timer=setTimeout(()=>this.fail(run,fail('回合逾時',409)),this.timeout);run.timer.unref?.();
      run.boot=this.start(run,text).catch(e=>this.fail(run,e));return this.status(id);
    }catch(e){this.fail(run,e);throw e;}
  }
  auth(){
    const value=JSON.parse(fs.readFileSync(runtime.codexHome+'/auth.json','utf8'));
    if(!value.tokens?.access_token||!value.tokens?.account_id)throw fail('Codex 登入憑證不可用，請回原工具登入',409);
    return {accessToken:value.tokens.access_token,chatgptAccountId:value.tokens.account_id};
  }
  async start(run,text){
    const record=this.records.get(run.id);
    if(run.provider==='codex'){
      await this.rpc(run,'initialize',{clientInfo:{name:'cantus_panel',version:'0.3.0'},capabilities:{experimentalApi:true}});this.alive(run);
      this.write(run,{method:'initialized'});
      await this.rpc(run,'account/login/start',{type:'chatgptAuthTokens',...this.auth()});this.alive(run);
      const params={cwd:run.cwd,approvalPolicy:'untrusted',sandbox:'read-only'};
      // Notifications may arrive in the same stdout chunk as thread/start's reply,
      // before its Promise continuation has bound the newly assigned thread ID.
      run.awaitingThread=!run.sid;run.earlyThreadFrames=[];
      let result;
      try{result=await this.rpc(run,run.sid?'thread/resume':'thread/start',run.sid?{...params,threadId:run.sid}:params);}
      finally{run.awaitingThread=false;}
      this.alive(run);
      if(!result.thread?.id||run.sid&&result.thread.id!==run.sid)throw fail('對話 ID 不一致',409);
      for(const frame of run.earlyThreadFrames){const id=frame.params?.threadId||frame.params?.thread?.id;if(id!==result.thread.id)throw fail('對話 ID 不一致',409);}
      run.sid=result.thread.id;record.sid=run.sid;this.save(record);
      run.verifiedSession=true;
      for(const frame of run.earlyThreadFrames.splice(0))this.frame(run,frame);
      run.verifiedSession=true;run.phase='running';this.persist(run,'sending');run.turnRequested=true;run.earlyFrames=[];
      const started=await this.rpc(run,'turn/start',{threadId:run.sid,input:[{type:'text',text}]});
      if(!started.turn?.id)throw fail('沒有收到回合 ID',409);run.turnId=started.turn.id;
      for(const frame of run.earlyFrames.splice(0))this.frame(run,frame);
    }else{
      await this.rpc(run,'initialize',{hooks:null});this.alive(run);
      run.phase='running';this.persist(run,'sending');
      this.write(run,{type:'user',session_id:run.sid,parent_tool_use_id:null,message:{role:'user',content:text}});
    }
  }
  frame(run,value){
    if(!run.finished&&run.provider==='codex'&&run.awaitingThread&&!run.sid&&value.id==null&&value.method&&(value.params?.threadId||value.params?.thread?.id)){
      if(run.earlyThreadFrames.length>=100||Buffer.byteLength(JSON.stringify(run.earlyThreadFrames))+Buffer.byteLength(JSON.stringify(value))>2*1024*1024)throw fail('建立對話時收到過多通知',409);
      run.earlyThreadFrames.push(value);return;
    }
    if(run.provider==='codex'&&value.method==='account/chatgptAuthTokens/refresh'&&value.id!=null){
      try{this.write(run,{id:value.id,result:this.auth()});}catch{this.write(run,{id:value.id,error:{code:-32000,message:'Please sign in again in the original CLI.'}});}return;
    }
    super.frame(run,value);
  }
  async complete(run){
    if(!run.verifiedSession)throw fail('未確認對話 ID',409);
    const r=this.records.get(run.id);r.rows.push({role:'assistant',text:[...run.texts.values()].join('\n\n'),at:new Date().toISOString()});
    this.persist(run,'completed');run.historyUpdated=true;run.phase='completed';run.busy=false;run.finished=true;this.cleanup(run);
  }
  capability(id){const r=this.records.get(id);return r?{available:true,sourceSessionId:r.sid||'首次送出時建立',mode:'panel-owned',note:'面板獨立對話；敏感工具操作保留原生批准流程。'}:{available:false,note:'找不到面板對話'};}
  fail(run,error){
    if(run.finished)return;
    super.fail(run,error);
    const r=this.records.get(run.id);
    if(r){r.rows.push({role:'assistant',text:(this.status(run.id).text?this.status(run.id).text+'\n\n':'')+'［'+(run.phase==='stopped'?'已停止':'未完成')+'］'+run.error,at:new Date().toISOString()});this.save(r);}
  }
}
module.exports={ManagedRunner};
