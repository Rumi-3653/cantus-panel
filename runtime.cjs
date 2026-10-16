'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const stateRoot=path.join(__dirname,'state'),file=path.join(__dirname,'config','local.json');
let config={};try{config=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('Cannot read local configuration');}
const demo=process.env.CANTUS_MODE!=='local',execution=!demo&&process.env.CANTUS_ENABLE_EXECUTION==='1';
function configured(name,fallback){const value=config[name];if(value!==undefined&&(typeof value!=='string'||!path.isAbsolute(value)))throw Error(name+' must be an absolute path');return value||fallback;}
const empty=name=>path.join(stateRoot,'unconfigured',name);
module.exports={demo,execution,stateRoot,fullAccess:false,
 exporter:path.join(__dirname,'vendor','session-exporter','lib'),
 codexHome:configured('codexHome',empty('codex')),
 claudeConfig:configured('claudeConfig',empty('claude')),
 claudeDesktop:configured('claudeDesktop',empty('claude-desktop')),
 claudeTemp:path.join(stateRoot,'temp'),workRoot:configured('workRoot',stateRoot),
 codexBin:configured('codexBin',empty('codex-cli')),claudeBin:configured('claudeBin',empty('claude-cli')),
 guard:configured('storageGuard',''),
 checkGuard(){return !config.storageGuard||execFileSync(config.storageGuard,[],{encoding:'utf8',timeout:10000,maxBuffer:4096}).includes('STATUS=OK');},
};
if(execution&&(!config.codexHome&&!config.claudeConfig))throw Error('Explicit source configuration is required before execution');
