import fs from 'node:fs/promises';
import path from 'node:path';
const out=path.resolve('tmp/coldroll-web-import');
await fs.mkdir(out,{recursive:true});
const targets=await (await fetch('http://127.0.0.1:9234/json/list')).json();
const target=targets.find(t=>t.type==='page');
if(!target)throw new Error('No isolated browser test page');
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
let id=0;const pending=new Map(),errors=[];
socket.addEventListener('message',event=>{
 const message=JSON.parse(event.data);
 if(message.id){const p=pending.get(message.id);if(p){pending.delete(message.id);message.error?p.reject(new Error(JSON.stringify(message.error))):p.resolve(message.result);}}
 if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
 if(message.method==='Log.entryAdded'&&message.params.entry.level==='error')errors.push(message.params.entry.text);
});
const send=(method,params={})=>new Promise((resolve,reject)=>{const current=++id;pending.set(current,{resolve,reject});socket.send(JSON.stringify({id:current,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
await send('Runtime.enable');await send('Page.enable');await send('Log.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Emulation.setDeviceMetricsOverride',{width:1200,height:1000,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:'http://127.0.0.1:5194/engineer-preview.html'});
let ready=false;
for(let i=0;i<120;i++){
 const state=await evaluate('document.body?.dataset.engineer');
 if(state==='ready'){ready=true;break;}
 if(state==='error')throw new Error(await evaluate('document.body.innerText'));
 await new Promise(r=>setTimeout(r,500));
}
if(!ready)throw new Error('Preview did not load within 60 seconds: '+errors.join('\n'));
await new Promise(r=>setTimeout(r,1000));
await evaluate('window.__engineerPreview.renderer.setAnimationLoop(null)');
const report=await evaluate('window.__engineerPreview.report');report.poses={};
for(const name of report.clips){
 const stats=await evaluate(`(()=>{const p=window.__engineerPreview,c=p.character;c.mixer.stopAllAction();c.play(${JSON.stringify(name)},{fade:0});c.actions[${JSON.stringify(name)}].stopFading().setEffectiveWeight(1);c.mixer.setTime(c.actions[${JSON.stringify(name)}].getClip().duration*.42);c.model.updateMatrixWorld(true);let bones=0,meshes=0,finite=true;const points=[];c.model.traverse(o=>{if(o.isBone){bones++;finite=finite&&o.matrixWorld.elements.every(Number.isFinite);}if(o.isMesh){meshes++;if(o.isSkinnedMesh){o.computeBoundingBox();const b=o.boundingBox;finite=finite&&[...b.min,...b.max].every(Number.isFinite);points.push({name:o.name,min:b.min.toArray(),max:b.max.toArray()});}}});p.renderer.render(p.scene,p.camera);return{bones,meshes,finite,bounds:points,duration:c.actions[${JSON.stringify(name)}].getClip().duration};})()`);
 if(!stats.finite)throw new Error('Nonfinite geometry in '+name);
 report.poses[name]=stats;
 const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(out,`${name}.png`),Buffer.from(shot.data,'base64'));
 console.log('WEB_CLIP_OK',name,stats.bones,stats.meshes,stats.duration);
}
report.face=await evaluate(`(()=>{const p=window.__engineerPreview,c=p.character;c.mixer.stopAllAction();c.play('Idle',{fade:0});c.mixer.setTime(0);let count=0,names=[];c.model.traverse(o=>{if(o.morphTargetDictionary){names=Object.keys(o.morphTargetDictionary);const i=o.morphTargetDictionary['まばたき'];if(i!==undefined){o.morphTargetInfluences[i]=1;count++;}}});p.renderer.render(p.scene,p.camera);return{blinkMeshes:count,morphNames:names};})()`);
const faceShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(out,'Blink.png'),Buffer.from(faceShot.data,'base64'));
report.errors=errors;
await fs.writeFile(path.join(out,'browser-verification.json'),JSON.stringify(report,null,2));
console.log('WEB_IMPORT_VERIFIED',JSON.stringify({url:report.url,skins:report.skins,morphTargets:report.morphTargets,clips:report.clips,blinkMeshes:report.face.blinkMeshes,errors}));
socket.close();
if(errors.length)process.exitCode=1;
