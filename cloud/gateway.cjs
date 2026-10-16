'use strict';
// Optional single-workspace HTTPS entry. No tunnels or machine inventory.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {LabStore,fail}=require('../lab/store.cjs');
const assets=new Set(['index.html','app.js','style.css','native-ui.js','conversation-tree.js','platform-ui.js','routing-rules.js','routing-ui.js','live-ui.js','live.css','lineage-ui.js','lineage.css']);
const read=new Set(['sessions','history','native/capability','native/status','routing/settings','routing/models','live','lineage']);
const write=new Set(['native/create','native/send','native/answer','native/stop','routing/settings','routing/preview','lineage']);
async function body(req){let parts=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>131072)throw fail('請求太大',413);parts.push(chunk);}return Buffer.concat(parts);}
function request(port,url,method,data,headers){return new Promise((resolve,reject)=>{
 const r=http.request({hostname:'127.0.0.1',port,path:url,method,headers},s=>{const chunks=[];let size=0;s.on('data',p=>{size+=p.length;if(size>16777216)r.destroy(Error('response limit'));else chunks.push(p);});s.on('end',()=>resolve({status:s.statusCode,body:Buffer.concat(chunks)}));s.on('error',reject);});r.setTimeout(45000,()=>r.destroy(Error('timeout')));r.on('error',reject);r.end(data);
});}
function createGateway({store,domain,port=4589,upstream=request}={}){
 if(!store||!domain||!/^([a-z0-9-]+\.)+[a-z0-9-]+(?::\d+)?$/i.test(domain))throw Error('Explicit authentication store and public hostname required');
 const origin='https://'+domain,key=crypto.randomBytes(32),csrf=t=>crypto.createHmac('sha256',key).update(t).digest('hex');let attempts=[],pending=0;
 const server=http.createServer(async(req,res)=>{
  const send=(status,value,type='application/json; charset=utf-8',extra={})=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Strict-Transport-Security':'max-age=31536000','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",...extra});res.end(Buffer.isBuffer(value)||typeof value==='string'?value:JSON.stringify(value));};
  try{
   if(req.headers.host!==domain||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')throw fail('拒絕非本站請求',403);
   const url=new URL(req.url,origin),p=url.pathname;
   if(!['GET','POST'].includes(req.method))throw fail('不支援此方法',405);
   if(req.method==='POST'&&(req.headers.origin!==origin||req.headers['content-type']?.split(';')[0]!=='application/json'))throw fail('需要本站 JSON 請求',403);
   if(req.method==='GET'&&['/login','/login.js','/login.css'].includes(p)){const file=p==='/login'?'login.html':p.slice(1);return send(200,fs.readFileSync(path.join(__dirname,file)),file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');}
   if(p==='/auth/login'&&req.method==='POST'){
    attempts=attempts.filter(t=>t>Date.now()-60000);if(attempts.length>=10||pending>=2)throw fail('登入過於頻繁，請稍後重試',429);attempts.push(Date.now());pending++;
    try{let input;try{input=JSON.parse(await body(req));}catch{throw fail('無效登入資料');}const v=await store.login(input?.user,input?.password);return send(200,{ok:true},'application/json',{'Set-Cookie':'__Host-cantus='+v.token+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800'});}finally{pending--;}
   }
   const cookies=(req.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith('__Host-cantus=')),token=cookies.length===1?cookies[0].slice(14):'';
   let user;try{user=store.auth(token);}catch{if(p==='/'&&req.method==='GET')return send(303,'','text/plain',{Location:'/login'});throw fail('請重新登入',401);}
   if(req.method==='POST'&&(req.headers['x-cantus-token']!==csrf(token)||(p!=='/auth/logout'&&user.role!=='editor')))throw fail('拒絕未授權操作',403);
   if(p==='/auth/logout'&&req.method==='POST'){store.logout(token);return send(200,{ok:true},'application/json',{'Set-Cookie':'__Host-cantus=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});}
   if(p==='/api/bootstrap'&&req.method==='GET')return send(200,{csrf:csrf(token),routing:true,workspace:{authenticated:true,role:user.role}});
   const file=p==='/'?'index.html':p.slice(1);if(req.method==='GET'&&assets.has(file))return send(200,fs.readFileSync(path.join(__dirname,'..',file)),file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');
   if(!p.startsWith('/api/')||!(req.method==='GET'?read:write).has(p.slice(5)))throw fail('找不到功能',404);
   const data=req.method==='POST'?await body(req):undefined,headers={Host:'127.0.0.1:'+port,'Content-Type':'application/json'};
   if(req.method==='POST'){const boot=await upstream(port,'/api/bootstrap','GET',undefined,headers);if(boot.status!==200)throw Error('upstream unavailable');headers.Origin='http://127.0.0.1:'+port;headers['X-Cantus-Token']=JSON.parse(boot.body).csrf;}
   const result=await upstream(port,p+url.search,req.method,data,headers);if(req.method==='POST')store.audit(user.name,p,'',result.status);return send(result.status,result.body);
  }catch(e){send(e.status||503,{error:e.status?e.message:'工作區暫時無法連線；沒有自動重送。'});}
 });server.requestTimeout=15000;server.headersTimeout=10000;return server;
}
if(require.main===module){process.umask(0o077);const root=path.join(__dirname,'..','state','gateway');fs.mkdirSync(root,{recursive:true});createGateway({domain:process.env.CANTUS_PUBLIC_HOST,port:Number(process.env.CANTUS_PANEL_PORT||4589),store:new LabStore(path.join(root,'auth.sqlite'))}).listen(Number(process.env.CANTUS_GATEWAY_PORT||4588),'127.0.0.1');}
module.exports={createGateway};
