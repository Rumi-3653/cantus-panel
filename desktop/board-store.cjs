'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const columns=['backlog','active','review','done'];
const fail=(message,status=400)=>Object.assign(Error(message),{status});
function details(input){
 const value={};
 for(const [key,max] of [['title',300],['description',12000],['assignee',100]])if(key in input){if(typeof input[key]!=='string'||input[key].length>max||key==='title'&&!input[key].trim())throw fail('任務欄位長度或格式無效。');value[key]=input[key].trim();}
 if('priority' in input){if(!['none','low','medium','high','urgent'].includes(input.priority))throw fail('優先度無效。');value.priority=input.priority;}
 if('labels' in input){if(!Array.isArray(input.labels)||input.labels.length>12||input.labels.some(x=>typeof x!=='string'||!x.trim()||x.length>40))throw fail('最多 12 個標籤，每個 40 字。');value.labels=[...new Set(input.labels.map(x=>x.trim()))];}
 return value;
}
class BoardStore{
 constructor(root,guard=()=>{}){this.root=root;this.guard=guard;}
 read(){try{const value=JSON.parse(fs.readFileSync(path.join(this.root,'board.json'),'utf8'));if(value.version!==1||!Number.isSafeInteger(value.revision)||!Array.isArray(value.tasks))throw Error('Invalid board');return value;}catch(error){if(error.code==='ENOENT')return {version:1,revision:0,tasks:[]};throw fail('任務板資料無法讀取，未覆寫原檔。',409);}}
 mutate(input){const data=this.read();if(input.revision!==data.revision)throw fail('任務板已更新，請重新讀取再操作。',409);const now=new Date().toISOString();
  if(input.action==='create'){
   const title=typeof input.title==='string'?input.title.trim():'';if(!title||title.length>300)throw fail('請輸入 1–300 字的任務名稱。');if(data.tasks.length>=2000)throw fail('任務板已達 2,000 筆。');
   const reference=input.reference;if(reference&&(!['local','cloud'].includes(reference.platform)||typeof reference.sessionId!=='string'||reference.sessionId.length>200||!['local','m1'].includes(reference.machine)))throw fail('對話來源無效。');
   if(reference&&data.tasks.some(t=>t.reference?.sessionId===reference.sessionId&&t.reference.machine===reference.machine))throw fail('這段對話已在任務板內。',409);
   data.tasks.push({id:'next_'+crypto.randomUUID(),title,column:'backlog',priority:'none',labels:[],assignee:'',description:'',...details(input),createdAt:now,updatedAt:now,...(reference?{reference:{sessionId:reference.sessionId,platform:reference.platform,machine:reference.machine}}:{})});
  }else{
   const task=data.tasks.find(t=>t.id===input.id);if(!task)throw fail('找不到這項任務。',404);
   if(input.action==='move'){
    if(!columns.includes(input.column))throw fail('任務狀態無效。');
    const before=input.before?data.tasks.find(t=>t.id===input.before):null;if(input.before&&(!before||before.column!==input.column||before.id===task.id))throw fail('插入位置已更新，請重新讀取。',409);
    data.tasks=data.tasks.filter(t=>t!==task);task.column=input.column;task.updatedAt=now;const index=before?data.tasks.indexOf(before):data.tasks.length;data.tasks.splice(index,0,task);
   }else if(input.action==='update'){Object.assign(task,details(input));if('column' in input){if(!columns.includes(input.column))throw fail('任務狀態無效。');task.column=input.column;}task.updatedAt=now;
   }else if(input.action==='remove')data.tasks=data.tasks.filter(t=>t!==task);
   else throw fail('不支援這個任務操作。');
  }
  this.guard();fs.mkdirSync(this.root,{recursive:true,mode:0o700});const file=path.join(this.root,'board.json');const backup=path.join(this.root,'board-revision-'+data.revision+'.json');if(fs.existsSync(file)&&!fs.existsSync(backup))fs.copyFileSync(file,backup,fs.constants.COPYFILE_EXCL);
  data.revision++;const temp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(data)+'\n',{mode:0o600});fs.renameSync(temp,file);return data;
 }
}
module.exports={BoardStore,columns};
