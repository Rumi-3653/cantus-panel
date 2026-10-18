'use strict';
// Both listeners belong to this process; neither replaces an existing service.
const {createServer}=require('../server.cjs');
const {createNextServer,storageGuard}=require('./server-next.cjs');
const backendPort=Number(process.env.CANTUS_PANEL_PORT||4589);
const desktopPort=Number(process.env.CANTUS_NEXT_PORT||4591);
for(const port of [backendPort,desktopPort])if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid port');
if(backendPort===desktopPort)throw Error('Backend and desktop ports must differ');
storageGuard();
const backend=createServer();
backend.once('error',error=>{console.error('Backend listener: '+error.message);process.exitCode=1;});
backend.listen(backendPort,'127.0.0.1',()=>{
 const desktop=createNextServer({upstream:'http://127.0.0.1:'+backendPort});
 desktop.once('error',error=>{console.error('Desktop listener: '+error.message);backend.close();process.exitCode=1;});
 desktop.listen(desktopPort,'127.0.0.1',()=>console.log('Cantus desktop: http://127.0.0.1:'+desktopPort));
});
