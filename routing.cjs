'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {defaults,validate,choose}=require('./routing-rules.js');
class RoutingStore{
 constructor(file=path.join(__dirname,'state','routing.json')){this.file=file;this.read();}
 read(){return fs.existsSync(this.file)?validate(JSON.parse(fs.readFileSync(this.file,'utf8'))):defaults();}
 save(value){const config=validate(value),old=this.read();if(config.revision!==old.revision)throw Object.assign(Error('設定已被另一個視窗更新，請重新載入後再儲存。'),{status:409,code:'routing'});
  fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});
  if(fs.existsSync(this.file))fs.copyFileSync(this.file,this.file+'.revision-'+old.revision+'.bak',fs.constants.COPYFILE_EXCL);
  config.revision++;const tmp=this.file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(config,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,this.file);return config;
 }
 choose(text,previous,manual){return choose(this.read(),text,previous,manual);}
}
module.exports={RoutingStore};
