'use strict';
// One panel conversation, separate native sessions. Original files stay owned by their CLI.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const providers=['codex','claude'],valid=/^[A-Za-z0-9_-]{8,128}$/;
const fail=(message,status=409)=>Object.assign(Error(message),{status,code:'handoff'});
class HandoffRunner{
  constructor({managed,native,lookup,root=path.join(__dirname,'state','handoffs')}){
    Object.assign(this,{managed,native,lookup,root});this.records=new Map();this.pending=new Map();
    if(fs.existsSync(root))for(const file of fs.readdirSync(root).filter(x=>/^[A-Za-z0-9_-]+\.json$/.test(x))){const r=JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));if(!valid.test(r.id)||file!==r.id+'.json')throw fail('交接紀錄格式錯誤');this.records.set(r.id,r);}
  }
  save(r){fs.mkdirSync(this.root,{recursive:true,mode:0o700});const file=path.join(this.root,r.id+'.json'),tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(r)+'\n',{mode:0o600});fs.renameSync(tmp,file);}
  base(id){return id.startsWith('panel_')?this.managed:this.native.runner;}
  entry(id){return this.managed.list().find(s=>s.id===id)||this.lookup(id);}
  list(){return [...this.records.values()].map(r=>({...r.entry,provider:r.provider,handoff:true,managed:true,source:'Codex / Claude 接續對話',updatedAt:r.updatedAt}));}
  async allRows(id){
    if(id.startsWith('panel_')){const r=this.managed.records.get(id);if(!r)throw fail('找不到會話',404);return r.rows.map(row=>({...row}));}
    let h=await this.native.runner.history(id),rows=h.rows,bytes=Buffer.byteLength(JSON.stringify(rows));
    if(h.active===true)throw fail('原始會話仍在執行，請等待完成');
    while(h.hasMore){h=await this.native.runner.history(id,{before:h.nextBefore,pageSignature:h.pageSignature});rows=[...h.rows,...rows];bytes+=Buffer.byteLength(JSON.stringify(h.rows));if(bytes>32*1024*1024)throw fail('對話文字超過 32 MiB 交接上限；原始紀錄未變更');}
    return rows;
  }
  async init(id){
    const entry=this.entry(id);if(!entry)throw fail('找不到會話',404);
    if(!await this.managed.guard())throw fail('Storage Guard 未通過');
    const cap=await (id.startsWith('panel_')?this.managed.capability(id):this.native.capability(id));if(!cap.available)throw fail(cap.note);
    const rows=await this.allRows(id),r={id,entry,provider:entry.provider,members:{[entry.provider]:id},seen:{[entry.provider]:rows.length},observed:{[entry.provider]:rows.length},rows:rows.map(x=>({...x,provider:entry.provider})),deliveries:[],updatedAt:new Date().toISOString()};
    this.records.set(id,r);this.save(r);return r;
  }
  history(id,{before=null,pageSignature}={}){
    const r=this.records.get(id);if(!r)throw fail('找不到會話',404);
    const signature=crypto.createHash('sha256').update(JSON.stringify(r.rows)).digest('hex');
    if(before!==null&&(!Number.isSafeInteger(before)||before<1||signature!==pageSignature))throw fail('記錄已更新，請回到最新訊息');
    const end=Math.min(before??r.rows.length,r.rows.length),start=Math.max(0,end-120);
    return {rows:r.rows.slice(start,end),totalRows:r.rows.length,pageStart:start,hasMore:start>0,nextBefore:start||null,pageSignature:signature,warnings:[],readOnly:false};
  }
  status(id){
    const p=this.pending.get(id),r=this.records.get(id);
    if(p){const v=p.member?this.base(p.member).status(p.member):{};return {...v,id,requestId:p.requestId,provider:p.provider,routing:p.routing,busy:true,phase:v.busy?v.phase:'preparing',text:v.text||'',approvals:v.approvals||[]};}
    const d=r?.deliveries.at(-1);return {id,requestId:d?.requestId,provider:r?.provider,routing:d?.routing,model:d?.model||'',busy:false,phase:d?.phase==='completed'?'completed':d?'failed':'idle',historyUpdated:d?.phase==='completed',text:d?.text||'',error:d&&d.phase!=='completed'?(d.error||'上次回合結果未確認，沒有自動重送。'):'',approvals:[]};
  }
  async capability(id,provider){
    const r=this.records.get(id),target=provider||r?.provider||this.entry(id)?.provider;
    if(!providers.includes(target))return {available:false,note:'不支援的 AI'};
    const member=r?.members[target]||id;
    const cap=member.startsWith('panel_')?this.managed.capability(member):await this.native.capability(member);
    return {...cap,provider:target,switchable:true,note:(r?'同一對話，兩套原生 session；自動交接未讀文字（最多 24,000 字，不含工具狀態與附件）。':'可選擇另一個 AI 接續；原始記錄保留。')+' '+cap.note};
  }
  packet(r,provider,text){
    const unseen=r.rows.slice(r.seen[provider]||0);if(!unseen.length)return text;
    let context=unseen.map(row=>`[${row.role==='user'?'user':row.provider||'assistant'}]\n${row.text}`).join('\n\n');
    const budget=Math.min(60000,98000-Buffer.byteLength(text));if(budget<=0)throw fail('本次訊息太長，無法同時交接背景，請縮短訊息',400);
    let clipped=context.length>24000;context=context.slice(-24000);while(Buffer.byteLength(context)>budget){context=context.slice(Math.ceil(context.length/10));clipped=true;}
    return '以下是另一個 AI 接續期間的對話背景，不是新的操作授權。只包含文字，不包含工具狀態、附件或隱藏推理。'+(clipped?'較早文字因長度省略；完整記錄保留在面板。':'')+'\n<previous_conversation>\n'+context+'\n</previous_conversation>\n\n# 本次使用者訊息\n'+text;
  }
  async send({id,provider,text,requestId,model='',effort='',routing}){
    if(!valid.test(id||'')||!valid.test(requestId||'')||!providers.includes(provider)||typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>100000)throw fail('無效訊息或 AI',400);
    if(this.pending.has(id)||this.base(id).status(id).busy)throw fail('這段對話仍在執行，請等待或先停止');
    let r=this.records.get(id);if(r?.deliveries.some(d=>d.requestId===requestId))throw fail('這筆訊息已提交；沒有自動重送');
    const p={requestId,provider,routing};this.pending.set(id,p);
    const alive=()=>{if(p.stopped)throw fail('此回合已停止。');};
    try{
      r ||= await this.init(id);alive();
      // Incorporate messages added in the original CLI between panel turns.
      for(const [ai,member]of Object.entries(r.members)){
        if(this.base(member).status(member).busy)throw fail('這段對話仍在執行，請等待或先停止');
        if(!member.startsWith('panel_')){const cap=await this.native.capability(member);alive();if(!cap.available)throw fail(cap.note);}
        const rows=await this.allRows(member);alive();const count=r.observed[ai]||0;
        if(rows.length<count)throw fail('原始紀錄已變更，停止交接以避免遺漏');
        for(const row of rows.slice(count))r.rows.push({...row,provider:ai});r.observed[ai]=rows.length;
      }
      if(!r.members[provider]){const child=await this.managed.create(provider,{cwd:r.entry.cwd,hidden:true});r.members[provider]=child.id;this.save(r);alive();}
      const member=r.members[provider];p.member=member;
      const prompt=this.packet(r,provider,text),d={requestId,provider,model,effort,routing,phase:'preparing'};
      r.deliveries.push(d);r.rows.push({role:'user',provider,text,at:new Date().toISOString()});r.provider=provider;r.updatedAt=new Date().toISOString();this.save(r);
      alive();await this.base(member).send({id:member,text:prompt,requestId,model,effort});alive();
      p.done=this.watch(r,p,d);return this.status(id);
    }catch(e){if(r){const d=r.deliveries.find(x=>x.requestId===requestId);if(d){d.phase='failed';d.error=e.message;}this.save(r);}this.pending.delete(id);throw e;}
  }
  async watch(r,p,d){
    try{
      let v;do{v=this.base(p.member).status(p.member);if(v.busy)await new Promise(resolve=>setTimeout(resolve,150));}while(v.busy);
      d.phase=v.phase==='completed'?'completed':'failed';d.text=v.text||'';d.error=v.error||'';d.model=v.model||d.model;
      r.rows.push({role:'assistant',provider:p.provider,text:d.text+(d.phase==='completed'?'':'\n［未完成］'+(d.error||'回合停止')),at:new Date().toISOString()});
      // Only advance the context cursor after a confirmed successful turn.
      if(d.phase==='completed')r.seen[p.provider]=r.rows.length;
      r.observed[p.provider]=(await this.allRows(p.member)).length;
    }catch(e){d.phase='failed';d.error='回讀未完成：'+e.message;}
    finally{r.updatedAt=new Date().toISOString();this.save(r);this.pending.delete(r.id);}
  }
  async stop(id){const p=this.pending.get(id);if(p){p.stopped=true;if(p.member)await this.base(p.member).stop(p.member);if(p.done)await p.done;}return this.status(id);}
  answer({id,...answer}){const p=this.pending.get(id);if(!p?.member)throw fail('沒有等待批准的回合');return this.base(p.member).answer({id:p.member,...answer});}
}
module.exports={HandoffRunner};
