'use strict';
// The owner supplies an existing local forwarding port in ignored configuration.
// This module cannot create SSH connections or discover machines.
const http=require('node:http');
function createTransport({port,serverPort=4589}){
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Explicit peer forwarding port required');
 function request(url,method='GET',body,token){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:url,method,headers:{Host:'127.0.0.1:'+serverPort,...(method==='POST'?{Origin:'http://127.0.0.1:'+serverPort,'Content-Type':'application/json','X-Cantus-Token':token}:{})}},res=>{let bytes=0,parts=[];res.on('data',p=>{bytes+=p.length;if(bytes>8*1024*1024)req.destroy(Error('Peer response too large'));else parts.push(p);});res.on('end',()=>{try{const value=JSON.parse(Buffer.concat(parts));if(res.statusCode!==200)reject(Object.assign(Error(value.error||'Peer unavailable'),{status:res.statusCode}));else resolve(value);}catch(e){reject(e);}});});req.setTimeout(40000,()=>req.destroy(Error('Peer timeout; request was not replayed')));req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});}
 return async(url,method='GET',body)=>{let token;if(method==='POST')token=(await request('/api/bootstrap')).csrf;return request(url,method,body,token);};
}
module.exports={createTransport};
