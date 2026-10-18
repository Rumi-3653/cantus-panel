(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CantusNextModel=factory();})(typeof window==='undefined'?this:window,function(){
 const phases={idle:'本面板尚無執行收據',preparing:'正在準備',running:'執行中',approval:'需要你的確認',completed:'本回合完成（未驗收）',failed:'執行失敗',stopped:'已停止',pausing:'正在暫停',paused:'已暫停',unconfirmed:'結果待確認'};
 function execution(node){const phase=node.dispatch?.status?.phase;return phase?{phase,label:phases[phase]||'執行狀態未知'}:{phase:'unknown',label:'執行狀態未知'};}
 function splitProjection(data,chosen,collapsed=new Set(),limit=160){
  const nodes=new Map(data.nodes.map(n=>[n.id,n])),children=new Map(),parent=new Map(),warnings=[];
  for(const edge of data.edges){if(edge.type!=='split')continue;if(!nodes.has(edge.from)||!nodes.has(edge.to)){warnings.push('拆分關係的來源缺失');continue;}if(edge.from===edge.to){warnings.push('略過自連的呈現');continue;}if(parent.has(edge.to)){if(parent.get(edge.to)!==edge.from)warnings.push('同一工作有多個拆分來源；保留第一個呈現');continue;}parent.set(edge.to,edge.from);const list=children.get(edge.from)||[];list.push(edge.to);children.set(edge.from,list);}
  let id=nodes.has(chosen)?chosen:data.nodes[0]?.id;if(!id)return {root:null,total:0,shown:0,truncated:false,warnings};const seen=new Set();
  while(parent.has(id)&&!seen.has(id)){seen.add(id);id=parent.get(id);}if(seen.has(id))warnings.push('拆分關係含循環；僅顯示已知節點一次');
  const root={node:nodes.get(id),children:[],depth:0,folded:collapsed.has(id)},visited=new Set([id]),stack=[root];let total=1,shown=1,maxDepth=0;
  while(stack.length){const current=stack.pop();const ids=children.get(current.node.id)||[];current.childCount=ids.length;
   for(const childId of ids){if(visited.has(childId))continue;visited.add(childId);total++;const item={node:nodes.get(childId),children:[],depth:current.depth+1,folded:collapsed.has(childId)};
    if(!current.hidden&&!current.folded&&shown<limit){current.children.push(item);shown++;maxDepth=Math.max(maxDepth,item.depth);}else item.hidden=true;
    stack.push(item);
   }
  }
  return {root,total,shown,maxDepth,truncated:shown<total&&shown>=limit,warnings};
 }
 return {phases,execution,splitProjection};
});
