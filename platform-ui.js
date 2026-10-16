/* Portable edition: no host inventory, tunnels, remote credentials or automatic discovery. */
window.cantusPlatform={mode:'local',host:'local',label:'本機工作區',generation:0,providers:['codex','claude'],authenticated:true,role:'editor',key:id=>'local:'+id,fetch:(url,options)=>fetch(url,options)};
document.addEventListener('DOMContentLoaded',async()=>{
 const box=el('div','platform-box'),label=el('p','native-note','本機工作區 · 未設定遠端連線');box.append(label);document.querySelector('.intro').after(box);
 try{
  const response=await fetch('/api/bootstrap');if(!response.ok)return;const boot=await response.json(),platform=window.cantusPlatform;
  if(boot.pair){const picker=el('select');picker.setAttribute('aria-label','平台');for(const [id,title]of [['local','M4 工作站'],['m1','M1 工作站']]){const option=el('option','',title);option.value=id;picker.append(option);}box.append(picker);
   platform.fetch=(url,options)=>fetch(platform.host==='m1'&&url!=='/api/bootstrap'?url.replace(/^\/api\//,'/api/m1/'):url,options);platform.key=id=>platform.host+':'+id;
   platform.activate=async target=>{if(!['local','m1'].includes(target))throw Error('未設定的工作區');platform.host=target;platform.mode=target==='m1'||boot.workspace?'cloud':'local';platform.label=target==='m1'?'M1 工作站':'M4 工作站';platform.providers=target==='m1'?['codex']:['codex','claude'];platform.generation++;request++;nativeSelection++;clearTimeout(nativePoll);selected=null;catalog={sessions:[],providers:[]};picker.value=target;label.textContent=platform.label;$('detail').replaceChildren(el('div','empty','請選擇會話。'));$('context').replaceChildren();document.dispatchEvent(new Event('cantus-platform-change'));window.cantusRouting?.reset();await load();};picker.onchange=()=>platform.activate(picker.value);
  }
  if(!boot.workspace?.authenticated)return;
  platform.mode='cloud';platform.role=boot.workspace.role;platform.label='已登入工作區';label.textContent=platform.label;
  document.dispatchEvent(new Event('cantus-platform-change'));
  const logout=el('button','lineage-secondary','登出工作區');box.append(logout);
  logout.onclick=async()=>{logout.disabled=true;try{const latest=await fetch('/api/bootstrap');if(!latest.ok)throw Error('請重新整理登入狀態');const {csrf}=await latest.json();const result=await fetch('/auth/logout',{method:'POST',headers:{'Content-Type':'application/json','X-Cantus-Token':csrf},body:'{}'});if(!result.ok)throw Error('登出失敗，請重試');platform.authenticated=false;document.dispatchEvent(new Event('cantus-login-expired'));location.assign('/login');}catch(e){toast(e.message);logout.disabled=false;}};
 }catch{ /* Local demo remains usable without the optional gateway. */ }
});
