'use strict';
// Original app pixel coordinates and shared sine walk; decoration never reads the form.
const creatures=[
 {grid:[13,11],body:[[2,2,2,2],[8,2,2,2],[2,4,8,5],[0,6,2,2],[3,9,2,2],[7,9,2,2]],eyes:[[4,5,1,1],[7,5,1,1]],phase:0},
 {grid:[12,11],body:[[3,1,6,2],[2,3,8,6],[3,9,2,2],[7,9,2,2]],eyes:[[4,4,1,1],[7,4,1,1],[5,6,2,1]],phase:1.4},
 {grid:[13,11],body:[[3,0,2,4],[8,0,2,4],[2,4,9,5],[3,9,2,2],[8,9,2,2]],eyes:[[4,5,1,1],[8,5,1,1]],phase:2.8},
 {grid:[13,10],body:[[1,1,2,3],[10,1,2,3],[1,3,11,5],[2,8,2,2],[9,8,2,2],[12,4,1,2]],eyes:[[3,4,1,1],[7,4,1,1]],phase:4.2},
];
const parade=document.querySelector('.creature-parade'),track=document.querySelector('.parade-track'),motion=matchMedia('(prefers-reduced-motion: reduce)'),svgNS='http://www.w3.org/2000/svg';
const sprites=creatures.map((c,index)=>{const svg=document.createElementNS(svgNS,'svg');svg.setAttribute('class','creature');svg.setAttribute('viewBox',`0 0 ${c.grid[0]} ${c.grid[1]}`);svg.setAttribute('width',c.grid[0]*2.4);svg.setAttribute('height',c.grid[1]*2.4);svg.setAttribute('shape-rendering','crispEdges');for(const [name,pixels]of [['body',c.body],['eyes',c.eyes]])for(const [x,y,width,height]of pixels){const rect=document.createElementNS(svgNS,'rect');for(const [k,v]of Object.entries({x,y,width,height,class:name}))rect.setAttribute(k,v);svg.append(rect);}
 // Each sprite owns its cheeks and touch timeout; no form or chat state is read.
 const cheeks=document.createElementNS(svgNS,'g');cheeks.setAttribute('class','blush');
 const positions=[[[3,6],[8,6]],[[3,5],[8,5]],[[3,6],[9,6]],[[2,5],[8,5]]][index];
 for(const [x,y]of positions){const rect=document.createElementNS(svgNS,'rect');for(const [k,v]of Object.entries({x,y,width:2,height:1}))rect.setAttribute(k,v);cheeks.append(rect);}svg.append(cheeks);
 const hit=document.createElementNS(svgNS,'rect');for(const [k,v]of Object.entries({width:c.grid[0],height:c.grid[1],fill:'transparent','pointer-events':'all'}))hit.setAttribute(k,v);svg.append(hit);
 let blushTimer;const clearBlush=()=>{clearTimeout(blushTimer);svg.classList.remove('is-blushing');};
 svg.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'){clearTimeout(blushTimer);svg.classList.add('is-blushing');}});
 svg.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse')clearBlush();});
 svg.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse'){clearTimeout(blushTimer);svg.classList.add('is-blushing');blushTimer=setTimeout(clearBlush,1200);}});
 svg.addEventListener('pointercancel',clearBlush);
 parade.append(svg);return svg;});
let animation;
function draw(now=0){const time=motion.matches?0:now/1000,travel=Math.min(track.clientWidth*.3,(track.clientWidth-164)/2),facing=Math.cos(time*.21)<0?-1:1;parade.style.transform=`translateX(${Math.sin(time*.21)*travel}px)`;sprites.forEach((svg,i)=>{const bob=motion.matches?0:Math.abs(Math.sin(time*1.6+creatures[i].phase))*1.6;svg.style.transform=`translateY(${-bob}px) scaleX(${facing})`;});if(!motion.matches&&!document.hidden)animation=requestAnimationFrame(draw);}
function resetAnimation(){cancelAnimationFrame(animation);draw(performance.now());}
motion.addEventListener('change',resetAnimation);document.addEventListener('visibilitychange',resetAnimation);window.addEventListener('resize',resetAnimation);resetAnimation();
document.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,b=f.querySelector('button'),s=document.querySelector('#status');b.disabled=true;s.textContent='登入中…';try{const r=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:f.elements.user.value,password:f.elements.password.value})});if(!r.ok)throw Error((await r.json()).error);f.elements.password.value='';location.assign('/');}catch(e){s.textContent=e.message;}finally{b.disabled=false;}};
