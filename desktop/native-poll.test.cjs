'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Exercise the actual polling callback with HTTP/DOM effects replaced by counters.
const source=fs.readFileSync(path.join(__dirname,'desktop-native-ui.js'),'utf8');
const callback=source.slice(source.indexOf('  async function poll(){'),source.indexOf('  send.onclick=async()=>{'));
async function poll(status,controlRequestId,lastStatus={}){
 const calls={refresh:0,select:0,render:0,timer:0};
 const context={calls,controlRequestId,lastStatus,available:true,
  selected:'fixture',s:{id:'fixture'},generation:1,nativeSelection:1,box:{isConnected:true},polling:false,sending:false,draftKey:'local:fixture',pendingSends:new Map(),messageQueues:new Map(),catalog:{sessions:[]},
  api:async()=>status,load:async()=>calls.refresh++,select:async()=>calls.select++,renderStatus:()=>calls.render++,
  setTimeout:()=>++calls.timer,clearTimeout:()=>{},checkCapability:async()=>{},state:{},showPending:()=>{},friendlyNativeError:String};
 await vm.runInNewContext(callback+';poll();',context);return calls;
}
test('idle status without a request ID preserves the current conversation and buttons',async()=>{
 assert.deepEqual(await poll({phase:'idle',busy:false}),{refresh:0,select:0,render:1,timer:0});
});
test('only a confirmed terminal control or active owned turn refreshes history',async()=>{
 assert.equal((await poll({requestId:'same',phase:'completed',busy:false},'same')).refresh,1);
 assert.equal((await poll({requestId:'same',phase:'running',busy:true},'same')).refresh,0);
 assert.equal((await poll({requestId:'other',phase:'completed',busy:false},'same')).refresh,0);
 assert.equal((await poll({requestId:'owned',phase:'paused',busy:false,advanced:{}},undefined,{requestId:'owned',busy:true})).refresh,1);
});
