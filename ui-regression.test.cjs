'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const events={},frames=[];
 class Element{
  constructor(tag='div',cls='',text=''){this.tag=tag;this.className=cls;this.textContent=text;this.children=[];this.style={};this.dataset={};this.value='';this.classList={add(){},remove(){},toggle(){}};}
  append(...nodes){this.children.push(...nodes);} prepend(...nodes){this.children.unshift(...nodes);} replaceChildren(...nodes){this.children=nodes;} after(node){this.sibling=node;}
  setAttribute(k,v){this[k]=v;} addEventListener(){} getBoundingClientRect(){return {top:42,right:1000,width:this.className==='frame-creature-parade'?154:900};}
  querySelector(selector){return this.children.find(n=>n.className?.split(' ').includes(selector.slice(1)))||null;}
 }
 const nodes=Object.fromEntries(['app','work','live','lineage','intro'].map(x=>[x,new Element('div',x)])),body=new Element();
 const document={body,hidden:false,querySelector:s=>nodes[s.slice(1)],querySelectorAll:()=>[],createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag),addEventListener:(name,fn)=>events[name]=fn,dispatchEvent:e=>events[e.type]?.(e)};
 const platform={mode:'cloud',host:'fixture-a',label:'示範 A',authenticated:true,role:'editor'},motion={matches:false,addEventListener(){}};
 const ctx={document,window:{cantusPlatform:platform,addEventListener(){}},el:(...args)=>new Element(...args),$:id=>nodes[id],toast(){},fetch:async()=>({ok:true,json:async()=>({csrf:'fixture'})}),ResizeObserver:class{observe(){} disconnect(){}},requestAnimationFrame:fn=>(frames.push(fn),frames.length),cancelAnimationFrame(){},matchMedia:()=>motion,performance:{now:()=>1000},Event:class{constructor(type){this.type=type;}},location:{assign:url=>ctx.destination=url}};
 vm.createContext(ctx);return {ctx,nodes,events,platform,motion,frames,body};
}
const flush=()=>new Promise(r=>setImmediate(r));
const graph=title=>({revision:1,note:'虛構資料',edges:[],nodes:[{id:'fixture-session',title,source:'fixture',provider:'codex',handoffs:[]}]});
test('Lineage uses current workspace and discards old reads and pending writes',async()=>{
 const f=fixture();let releaseRead,releaseBootstrap;const calls=[];
 f.platform.fetch=async(url,options)=>{calls.push({host:f.platform.host,method:options?.method||'GET'});return {ok:true,json:async()=>graph(f.platform.label)};};
 vm.runInContext(fs.readFileSync('lineage-ui.js','utf8'),f.ctx);f.nodes.lineage.onclick();await flush();
 const root=f.nodes.app.children[0],left=root.children[0],find=(node,cls)=>node.children.find(x=>x.className===cls);
 assert.equal(find(left,'lineage-items').children[0].children[0].textContent,'示範 A');
 f.platform.fetch=()=>new Promise(r=>releaseRead=r);f.nodes.lineage.onclick();
 f.platform.host='fixture-b';f.platform.label='示範 B';f.platform.fetch=async(_url,options)=>{calls.push({host:f.platform.host,method:options?.method||'GET'});return {ok:true,json:async()=>graph('示範 B')};};f.events['cantus-platform-change']();await flush();
 releaseRead({ok:true,json:async()=>graph('過期 A')});await flush();assert.equal(find(left,'lineage-items').children[0].children[0].textContent,'示範 B');
 f.ctx.fetch=()=>new Promise(r=>releaseBootstrap=r);const form=find(left,'lineage-create');form.children[0].value='不能跨工作區';const pending=form.onsubmit({preventDefault(){}});
 f.platform.host='fixture-c';f.events['cantus-platform-change']();await flush();releaseBootstrap({json:async()=>({csrf:'fixture'})});await pending;assert.equal(calls.filter(c=>c.method==='POST').length,0);
 f.ctx.fetch=async()=>({json:async()=>({csrf:'fixture'})});const current=find(left,'lineage-create');current.children[0].value='本工作區';await current.onsubmit({preventDefault(){}});assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal(calls.at(-1).host,'fixture-c');
 f.platform.role='viewer';f.events['cantus-platform-change']();await flush();assert.equal(find(left,'lineage-create').children[1].disabled,true);
 f.platform.authenticated=false;f.events['cantus-login-expired']();assert.match(root.children[1].children[1].textContent,/請先登入/);
});
test('four decorative animals animate and respect reduced motion',()=>{
 const f=fixture(),source=fs.readFileSync('app.js','utf8');vm.runInContext(source.slice(source.indexOf('// Decorative companions')),f.ctx);
 const track=f.body.children[0],parade=track.children[0];assert.equal(track['aria-hidden'],'true');assert.equal(parade.children.length,4);const first=parade.style.transform;f.frames[0](2000);assert.notEqual(parade.style.transform,first);
 const still=fixture();still.motion.matches=true;vm.runInContext(source.slice(source.indexOf('// Decorative companions')),still.ctx);assert.equal(still.frames.length,0);assert.ok(still.body.children[0].children[0].children.every(n=>n.style.transform==='translateY(0px) scaleX(1)'));
});
test('gateway shows one workspace logout and local demo shows none',async()=>{
 for(const authenticated of [false,true]){const f=fixture(),calls=[];f.ctx.fetch=async(url,options)=>{calls.push([url,options]);return {ok:true,json:async()=>({csrf:'fixture',workspace:authenticated?{authenticated:true,role:'viewer'}:undefined})};};vm.runInContext(fs.readFileSync('platform-ui.js','utf8'),f.ctx);await f.events.DOMContentLoaded();const box=f.nodes.intro.sibling;assert.equal(box.children.length,authenticated?2:1);if(authenticated){assert.equal(box.children[1].textContent,'登出工作區');await box.children[1].onclick();assert.equal(f.ctx.destination,'/login');assert.equal(calls.at(-1)[0],'/auth/logout');assert.equal(calls.at(-1)[1].headers['X-Cantus-Token'],'fixture');}}
});
