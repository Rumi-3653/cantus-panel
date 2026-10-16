'use strict';
const {DatabaseSync}=require('node:sqlite');
const crypto=require('node:crypto');
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
class LabStore{
  constructor(file){
    this.db=new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS users(name TEXT PRIMARY KEY, salt TEXT NOT NULL, digest TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS tokens(digest TEXT PRIMARY KEY,user TEXT NOT NULL REFERENCES users(name),expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(n INTEGER PRIMARY KEY,at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,resource TEXT NOT NULL,result INTEGER NOT NULL);
    `);
  }
  addUser(name,password,role='editor'){
    if(!/^[a-z][a-z0-9-]{2,31}$/.test(name)||typeof password!=='string'||password.length<20||!['editor','viewer'].includes(role))throw fail('無效測試帳號');
    const salt=crypto.randomBytes(16).toString('hex'),digest=crypto.scryptSync(password,salt,32).toString('hex');
    this.db.prepare('INSERT INTO users(name,salt,digest,role) VALUES(?,?,?,?)').run(name,salt,digest,role);
  }
  async login(name,password){
    if(typeof name!=='string'||name.length>32||typeof password!=='string'||password.length>256)throw fail('登入失敗',401);
    const u=this.db.prepare('SELECT * FROM users WHERE name=?').get(name);
    const digest=await new Promise((resolve,reject)=>crypto.scrypt(password,u?.salt||'cantus-dummy-salt',32,(e,b)=>e?reject(e):resolve(b)));
    if(!u?.active||!crypto.timingSafeEqual(digest,Buffer.from(u.digest,'hex')))throw fail('登入失敗',401);
    const token=crypto.randomBytes(32).toString('base64url');
    this.db.prepare('DELETE FROM tokens WHERE expires<?').run(Date.now());
    this.db.prepare('INSERT INTO tokens VALUES(?,?,?)').run(hash(token),u.name,Date.now()+8*3600000);
    return {token,user:u.name,role:u.role,platform:'workspace'};
  }
  auth(token){
    if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw fail('請先登入 工作區',401);
    const u=this.db.prepare('SELECT users.name,users.role FROM tokens JOIN users ON users.name=tokens.user WHERE tokens.digest=? AND tokens.expires>? AND users.active=1').get(hash(token),Date.now());
    if(!u)throw fail('登入已失效',401);return u;
  }
  logout(token){this.db.prepare('DELETE FROM tokens WHERE digest=?').run(hash(token));}
  audit(actor,action,resource,result){this.db.prepare('INSERT INTO audit(at,actor,action,resource,result) VALUES(?,?,?,?,?)').run(new Date().toISOString(),actor,action,resource||'',result);}
  close(){this.db.close();}
}
module.exports={LabStore,fail,hash};
