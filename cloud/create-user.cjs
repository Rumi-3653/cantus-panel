'use strict';
// Read JSON from stdin, never accept a password in process arguments.
const fs=require('node:fs'),path=require('node:path'),{LabStore}=require('../lab/store.cjs');
process.umask(0o077);
async function main(){let raw='';for await(const chunk of process.stdin){raw+=chunk;if(Buffer.byteLength(raw)>4096)throw Error('Input too large');}const input=JSON.parse(raw),root=path.join(__dirname,'..','state','gateway');fs.mkdirSync(root,{recursive:true});const store=new LabStore(path.join(root,'auth.sqlite'));try{store.addUser(input.user,input.password,input.role||'editor');console.log('Account created.');}finally{store.close();}}
main().catch(()=>{console.error('Could not create account. Check input and existing account.');process.exitCode=1;});
