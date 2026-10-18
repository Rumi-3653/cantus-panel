/* Choose the original phone UI or additive desktop UI before the classic scripts run. */
(()=>{
 const mobile=matchMedia('(max-width:780px), (max-width:1024px) and (max-height:600px) and (pointer:coarse)').matches;
 window.CantusNextDesktop=!mobile;
 if(!mobile){document.body.classList.add('cantus-next');document.title='Weftelio · 眾聲並作';document.querySelector('.edition').textContent='DESKTOP';document.write('<link rel="stylesheet" href="/next.css">');}
 const files=[mobile?'platform-ui.js':'desktop-platform-ui.js','conversation-tree.js','app.js','routing-rules.js','routing-ui.js',mobile?'native-ui.js':'desktop-native-ui.js',mobile?'live-ui.js':'desktop-live-ui.js','pair-ui.js','organize-ui.js',...(mobile?['lineage-ui.js']:['next-model.js','tree-ui.js','desktop-lineage-ui.js','next-ui.js'])];
 document.write(files.map(name=>'<script src="/'+name+'"><\/script>').join(''));
})();
