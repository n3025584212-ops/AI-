import fs from 'node:fs/promises';
import path from 'node:path';
const out=path.resolve('tmp/coldroll-motion-r3');await fs.mkdir(path.join(out,'frames'),{recursive:true});
const target=(await(await fetch('http://127.0.0.1:9235/json/list')).json()).find(t=>t.type==='page');
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
let id=0;const pending=new Map(),errors=[];
ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(new Error(JSON.stringify(m.error))):p?.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.method==='Log.entryAdded'&&m.params.entry.level==='error')errors.push(m.params.entry.text);});
const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
await send('Page.enable');await send('Runtime.enable');await send('Log.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Emulation.setDeviceMetricsOverride',{width:960,height:1000,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:'http://127.0.0.1:5194/engineer-preview.html?motion=walk'});
let ready=false;for(let i=0;i<120;i++){const s=await evaluate('document.body?.dataset.engineer');if(s==='ready'){ready=true;break;}if(s==='error')throw new Error(await evaluate('document.body.innerText'));await new Promise(r=>setTimeout(r,500));}if(!ready)throw new Error('Walk preview timed out');
await evaluate(`(()=>{const p=window.__engineerPreview,c=p.character;p.renderer.setAnimationLoop(null);c.mixer.stopAllAction();c.active='Walk';c.play('Walk',{fade:0});c.actions.Walk.stopFading().setEffectiveWeight(1);})()`);
const report=await evaluate('window.__engineerPreview.report');report.samples=[];
if(!report.url.includes('-r3.glb'))throw new Error('Stale asset '+report.url);
const sample=async phase=>evaluate(`(()=>{const p=window.__engineerPreview,c=p.character;c.mixer.setTime(c.actions.Walk.getClip().duration*${phase});c.model.updateMatrixWorld(true);p.controls.update();p.renderer.render(p.scene,p.camera);const get=n=>{const b=c.model.getObjectByName(n);if(!b)return null;return b.getWorldPosition(b.position.clone()).toArray();};let finite=true;c.model.traverse(o=>{if(o.isBone)finite=finite&&o.matrixWorld.elements.every(Number.isFinite);});return{phase:${phase},leftHand:get('手首L'),rightHand:get('手首R'),leftAnkle:get('足首DL'),rightAnkle:get('足首DR'),finite};})()`);
for(let i=0;i<36;i++){
 const row=await sample(i/36);if(!row.finite||!row.leftHand||!row.rightHand)throw new Error('Invalid animated wrist');report.samples.push(row);
 const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(out,'frames',`walk_${String(i).padStart(3,'0')}.png`),Buffer.from(shot.data,'base64'));
 if(i%9===0)console.log('GAIT_PHASE',i/36,row.leftHand,row.rightHand);
}
report.loop=await sample(1);
const range=(key,axis)=>Math.max(...report.samples.map(x=>x[key][axis]))-Math.min(...report.samples.map(x=>x[key][axis]));
report.handTravelMeters={left:range('leftHand',2),right:range('rightHand',2)};
if(report.handTravelMeters.left<.2||report.handTravelMeters.right<.2)throw new Error('Arms still have insufficient fore/aft travel');
for(const [name,phase] of [['Idle',.33],['Point',.43],['Wave',.48]]){
 await evaluate(`(()=>{const p=window.__engineerPreview,c=p.character;c.mixer.stopAllAction();c.active=${JSON.stringify(name)};c.play(${JSON.stringify(name)},{fade:0});c.actions[${JSON.stringify(name)}].stopFading().setEffectiveWeight(1);c.mixer.setTime(c.actions[${JSON.stringify(name)}].getClip().duration*${phase});c.model.updateMatrixWorld(true);p.renderer.render(p.scene,p.camera);})()`);
 const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,`${name}.png`),Buffer.from(shot.data,'base64'));
}
report.pathMotion=await evaluate(`(()=>{const c=window.__engineerPreview.character;const start=c.position.clone(),target=start.clone();target.x+=2;c.walkTo(target);const speed=c.walkReferenceSpeed;for(let i=0;i<10;i++)c.update(.1);const travel=c.position.distanceTo(start);return{referenceMetersPerSecond:speed,cruiseMetersPerSecond:c.walkCruiseSpeed,walkTimeScale:c.actions.Walk.timeScale,travelInOneSecond:travel,state:c.state};})()`);
if(report.pathMotion.travelInOneSecond<.5)throw new Error('Inspection route does not advance');
report.errors=errors;await fs.writeFile(path.join(out,'walk-verification.json'),JSON.stringify(report,null,2));console.log('NATURAL_WALK_VERIFIED',JSON.stringify({url:report.url,handTravelMeters:report.handTravelMeters,pathMotion:report.pathMotion,errors}));ws.close();if(errors.length)process.exitCode=1;
