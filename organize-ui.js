/* Weftelio-only labels and virtual folders. Never rename or move source files. */
(()=>{
 const editable=()=>window.cantusPlatform?.mode!=='cloud'||window.cantusPlatform.authenticated&&window.cantusPlatform.role==='editor';
 const menu=el('div','cantus-context-menu');menu.hidden=true;menu.setAttribute('role','menu');document.body.append(menu);
 const dialog=el('dialog','cantus-organize-dialog'),form=el('form'),heading=el('h2'),field=el('div'),note=el('p','native-note'),error=el('p','organize-error'),actions=el('div','composer-actions'),cancel=el('button','','取消'),save=el('button','send-message','儲存');cancel.type='button';save.type='submit';actions.append(cancel,save);form.append(heading,field,note,error,actions);dialog.append(form);document.body.append(dialog);
 cancel.onclick=()=>dialog.close();dialog.addEventListener('cancel',()=>{menu.hidden=true;});
 const closeMenu=()=>{menu.hidden=true;};document.addEventListener('click',closeMenu);document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();});
 document.addEventListener('cantus-platform-change',()=>{closeMenu();dialog.close();});document.addEventListener('cantus-login-expired',()=>{closeMenu();dialog.close();});
 async function edit({title,value='',action,id,folderId,endpoint,requester,onSaved}){
  if(!editable())return;const platform=window.cantusPlatform,generation=platform?.generation,request=requester||((url,options)=>(platform?.fetch||fetch)(url,options));
  heading.textContent=title;field.replaceChildren();note.textContent='只修改 Weftelio 顯示與分類，原始對話、專案及檔案不變。';error.textContent='';save.disabled=true;dialog.showModal();
  let graph,input;
  try{const response=await request(endpoint||'/api/lineage');graph=await response.json();if(!response.ok)throw Error(graph.error);if(generation!==platform?.generation||!dialog.open)return;
   if(action==='moveFolder'){input=el('select');const original=el('option','','原始分類（不放入 Weftelio 資料夾）');original.value='';input.append(original);for(const f of graph.folders||[]){const option=el('option','',f.name);option.value=f.id;input.append(option);}input.value=folderId||'';}
   else{input=el('input');input.value=value;input.maxLength=action==='rename'?300:100;input.required=true;}
   input.setAttribute('aria-label',title);field.append(input);save.disabled=false;input.focus();input.select?.();
  }catch(e){error.textContent=e.message;return;}
  form.onsubmit=async e=>{e.preventDefault();if(save.disabled)return;if(generation!==platform?.generation){dialog.close();return;}if(action!=='moveFolder'&&!input.value.trim()){error.textContent='名稱不能留白';input.focus();return;}save.disabled=true;error.textContent='';
   try{const b=await fetch('/api/bootstrap');if(!b.ok)throw Error('請重新整理登入狀態');const {csrf}=await b.json();if(generation!==platform?.generation||!dialog.open)return;
    const response=await request(endpoint||'/api/lineage',{method:'POST',headers:{'Content-Type':'application/json','X-Cantus-Token':csrf},body:JSON.stringify({action,id,revision:graph.revision,...(action==='moveFolder'?{folderId:input.value||null}:{title:input.value.trim()})})}),result=await response.json();if(!response.ok)throw Error(result.error||'儲存失敗');
    if(generation!==platform?.generation)return;dialog.close();await onSaved?.();await load();const current=catalog.sessions.find(s=>s.id===selected);if(current){const h=document.querySelector('.detail-title');if(h)h.textContent=name(current);}document.dispatchEvent(new Event('cantus-display-change'));toast('已儲存；原始資料未變更。');
   }catch(e){error.textContent=e.message+'；輸入仍保留。';}finally{save.disabled=false;}
  };
 }
 function show(e,choices){e.preventDefault();e.stopPropagation();menu.replaceChildren();for(const [label,run]of choices){const button=el('button','',label);button.type='button';button.setAttribute('role','menuitem');button.onclick=()=>{closeMenu();run();};menu.append(button);}menu.hidden=false;menu.style.left=Math.min(e.clientX,innerWidth-190)+'px';menu.style.top=Math.min(e.clientY,innerHeight-menu.offsetHeight-8)+'px';menu.firstChild?.focus();}
 document.addEventListener('contextmenu',e=>{
  if(!editable())return;const row=e.target.closest('.conversation-item'),group=e.target.closest('.conversation-group');
  if(row){const session=catalog.sessions.find(s=>s.id===row.dataset.sessionId);if(!session)return;show(e,[['重新命名',()=>edit({title:'重新命名對話',value:name(session),action:'rename',id:session.id})],['移至資料夾',()=>edit({title:'移至 Weftelio 資料夾',action:'moveFolder',id:session.id,folderId:session.cantusFolder?.id})]]);}
  else if(group?.dataset.cantusFolderId){const folder=catalog.cantusFolders?.find(f=>f.id===group.dataset.cantusFolderId);if(folder)show(e,[['重新命名',()=>edit({title:'重新命名資料夾',value:folder.name,action:'renameFolder',id:folder.id})]]);}
 });
 const add=el('button','new-cantus-folder','＋ 新增資料夾');add.type='button';add.onclick=()=>edit({title:'新增 Weftelio 資料夾',action:'createFolder'});document.querySelector('.list-pane .search').after(add);
 const update=()=>{add.disabled=!editable();};document.addEventListener('cantus-platform-change',update);document.addEventListener('cantus-login-expired',update);update();
 window.CantusOrganize={edit,show,editable};
 // Reuse existing actions; compact controls never create a second dispatch path.
 {
 const heading=document.querySelector('.list-pane .pane-heading'),search=document.querySelector('.list-pane .search'),input=search?.querySelector('input'),create=document.querySelector('.panel-create');
 if(heading&&input&&create){
  const icon=(button,label,paths)=>{button.title=label;button.setAttribute('aria-label',label);button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+paths+'</svg>';};
  const tools=el('div','list-tools'),toggle=el('button','icon-btn');toggle.type='button';
  icon(toggle,'搜尋會話、專案','<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>');
  search.id='conversation-search';toggle.setAttribute('aria-controls',search.id);
  const expand=open=>{search.hidden=!open;toggle.setAttribute('aria-expanded',String(open));};
  expand(Boolean(input.value));toggle.onclick=()=>{expand(search.hidden);if(!search.hidden)input.focus();};
  input.addEventListener('keydown',e=>{if(e.key==='Escape'){input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));expand(false);toggle.focus();}});
  const newChat=create.querySelector('button[data-provider="auto"]');
  icon(newChat,'新對話','<path d="M14 4H5a2 2 0 0 0-2 2v13l4-3h12a2 2 0 0 0 2-2v-4M18 2v6m-3-3h6"/>');
  icon(add,'新增資料夾','<path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z M12 10v7m-3-3.5h6"/>');
  create.classList.add('compact-create');tools.append(toggle,heading.querySelector('#refresh'),create,add);heading.append(tools);heading.classList.add('compact-heading');
 }
 }
})();
