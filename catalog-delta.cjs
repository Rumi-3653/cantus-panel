'use strict';
const {createHash}=require('node:crypto');
// Two bounded snapshots per visibility scope; never shared across hosts/accounts.
class CatalogDelta{
 constructor(){this.scopes=new Map();}
 reply(value,since=''){
  const {sessions,scannedAt,catalogVersion:ignored,...meta}=value;
  const rows=new Map(sessions.map(row=>[row.id,{row,wire:JSON.stringify(row)}]));
  const wire=JSON.stringify(meta)+'\n'+[...rows.values()].map(x=>x.wire).join('\n');
  const version=createHash('sha256').update(wire).digest('hex'),scope=String(value.includeBackground===true);
  let snapshots=this.scopes.get(scope);if(!snapshots)this.scopes.set(scope,snapshots=new Map());
  const previous=snapshots.get(since),order=[...rows.keys()];
  if(!snapshots.has(version)){snapshots.set(version,{rows,order});while(snapshots.size>2)snapshots.delete(snapshots.keys().next().value);}
  if(previous&&since===version)return {catalogVersion:version,notModified:true,scannedAt};
  if(!previous)return {...value,catalogVersion:version};
  const changed=[...rows].filter(([id,x])=>previous.rows.get(id)?.wire!==x.wire).map(([,x])=>x.row);
  const removed=[...previous.rows.keys()].filter(id=>!rows.has(id));
  const reordered=order.length!==previous.order.length||order.some((id,i)=>id!==previous.order[i]);
  const delta={...meta,scannedAt,catalogVersion:version,delta:true,sessions:changed,removed,...(reordered?{order}:{})};
  return Buffer.byteLength(JSON.stringify(delta))<Buffer.byteLength(wire)?delta:{...value,catalogVersion:version};
 }
}
module.exports={CatalogDelta};
