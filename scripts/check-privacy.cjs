'use strict';
// A source hygiene gate, not a guarantee that arbitrary content is non-sensitive.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..');
let files;try{files=(process.argv.includes('--files-stdin')?fs.readFileSync(0,'utf8'):execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'})).split('\0').filter(Boolean);}catch{console.error('Run in an initialized repository.');process.exit(1);}
const forbidden=/(^|\/)(?:state|logs|evidence|backups|scratch|node_modules|\.env[^/]*)(?:\/|$)|\.(?:sqlite\w*|db|jsonl|pem|key|p12|pfx|har|log|bak)$|(?:^|\/)(?:auth|credentials|cookies|local)\.json$/i;
const rules=[['personal absolute path',/\/(?:Users|Volumes)\/[A-Za-z0-9\u0080-\uffff_-]+/],['private network address',/\b(?:10\.\d+|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d+\.\d+\b/],['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['credential-like value',/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16})\b/]];
const problems=[];for(const file of files){if(forbidden.test(file))problems.push(file+': operational file');const full=path.join(root,file),s=fs.lstatSync(full);if(s.isSymbolicLink()){problems.push(file+': symlink');continue;}if(/\.(png|webp|jpg)$/.test(file))continue;if(s.size>2*1024*1024){problems.push(file+': unexpected large file');continue;}const text=fs.readFileSync(full,'utf8');for(const [label,re]of rules)if(re.test(text))problems.push(file+': '+label);}
if(problems.length){console.error(problems.join('\n'));process.exitCode=1;}else console.log('Source privacy gate passed: '+files.length+' tracked files.');
