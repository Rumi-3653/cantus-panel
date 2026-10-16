/* Explicit user dispatch only; displaying the graph never starts an AI turn. */
window.cantusDispatchToM1=(node,revision,onDone)=>{
 const generation=window.cantusPlatform?.generation,requestId=crypto.randomUUID(),dialog=el('dialog','pair-dispatch-dialog'),form=el('form'),task=el('textarea'),cwd=el('input'),error=el('p','organize-error'),submit=el('button','send-message','確認派給 M1'),cancel=el('button','','取消');
 const label=(text,input)=>{const n=el('label','',text);input.setAttribute('aria-label',text);n.append(input);return n;};
 task.required=true;task.maxLength=24000;cwd.required=true;cwd.placeholder='M1 上已存在的絕對路徑';submit.type='submit';cancel.type='button';cancel.onclick=()=>dialog.close();
 form.append(el('h2','','派給 M1'),el('p','native-note','來源：'+node.title),label('交給 M1 的任務',task),label('M1 工作目錄',cwd),el('p','native-note','只傳送這裡填寫的任務，不複製原對話或檔案。將以 M1 的 Codex 建立子工作；原生權限確認仍保留。'),error,cancel,submit);dialog.append(form);document.body.append(dialog);
 const stop=()=>dialog.close();document.addEventListener('cantus-platform-change',stop);dialog.addEventListener('close',()=>{document.removeEventListener('cantus-platform-change',stop);dialog.remove();});dialog.showModal();task.focus();
 form.onsubmit=async e=>{e.preventDefault();if(submit.disabled||!task.value.trim()||!cwd.value.trim())return;if(generation!==window.cantusPlatform?.generation)return dialog.close();submit.disabled=true;error.textContent='正在提交；請勿重複派工…';
  try{const b=await fetch('/api/bootstrap');if(!b.ok)throw Error('請重新整理登入狀態');const {csrf}=await b.json();if(generation!==window.cantusPlatform?.generation||!dialog.open)return;
   const r=await fetch('/api/pair',{method:'POST',headers:{'Content-Type':'application/json','X-Cantus-Token':csrf},body:JSON.stringify({action:'dispatch',revision,from:node.id,requestId,text:task.value,cwd:cwd.value.trim()})}),data=await r.json();if(!r.ok)throw Error(data.error||'送出結果未確認');
   if(generation!==window.cantusPlatform?.generation)return;const child=data.nodes.find(n=>n.dispatch?.requestId===requestId);dialog.close();onDone(data,child?.id);toast(child?.dispatch?.status?.phase==='unconfirmed'?'派工結果待確認；收據已保留，不會自動重送。':'派工收據已建立；請查看 M1 子工作的執行狀態。');
  }catch(e){error.textContent=e.message+'。請關閉後重新讀取關係圖確認收據；不會自動重送。';}
 };
};
