'use strict';
// Only panel-owned state is displayed. No SSH, network scans or process inventory.
function panelJobs({sessions,managed,native,handoff}){
 const entries=new Map([...sessions,...managed.list(),...handoff.list()].map(s=>[s.id,s]));
 const jobs=[];for(const [id,s]of entries){const runner=handoff.records.has(id)?handoff:id.startsWith('panel_')?managed:native.runner,v=runner.status(id);if(!v.busy&&!v.approvals?.length)continue;jobs.push({id:'local:'+id,machine:'local',sessionId:id,title:s.title,provider:s.provider,status:v.approvals?.length?'waiting':'running',source:'面板執行紀錄',readOnly:false,observedAt:new Date().toISOString(),reason:'僅呈現此面板執行器回報，不推測其他程序。'});}return jobs;
}
function createLive({panel=()=>[]}={}){return async()=>({observedAt:new Date().toISOString(),staleAfterMs:20000,machines:[{id:'local',name:'本機工作區',connected:true,observedAt:new Date().toISOString(),coverage:'只有面板工作；未接入外部主機或程序觀察。',jobs:panel()}]});}
module.exports={panelJobs,createLive};
