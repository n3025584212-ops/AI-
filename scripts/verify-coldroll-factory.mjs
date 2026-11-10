import fs from 'node:fs/promises';
const info=await(await fetch('http://127.0.0.1:9234/json/new?http://127.0.0.1:5194/',{method:'PUT'})).json();
const ws=new WebSocket(info.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map(),errors=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(new Error(JSON.stringify(m.error))):p?.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1500,height:1050,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:'http://127.0.0.1:5194/'});
let submitted=false,ready=false,status={};
for(let i=0;i<180;i++){
 status=await evaluate(`(()=>({setup:document.body.innerText.includes('首次使用，请设置'),login:Boolean(document.querySelector('form[aria-label="账户登录"]')),loginReady:Array.from(document.querySelectorAll('form input')).filter(x=>x.type!=='checkbox').every(x=>x.value),character:Array.from(document.querySelectorAll('[data-character]')).map(x=>x.dataset.character),pet:Array.from(document.querySelectorAll('[data-avatar]')).map(x=>x.dataset.avatar),engine:Boolean(window.__qcdkr3d)}))()`);
 if(status.setup)break;
 if(status.login&&status.loginReady&&!submitted){await evaluate(`document.querySelector('form[aria-label="账户登录"]').requestSubmit()`);submitted=true;console.log('LOCAL_SOFTWARE_LOGIN_SUBMITTED');}
 if(status.character.includes('ready')){ready=true;break;}
 if(i%20===0)console.log('FACTORY_LOADING',JSON.stringify(status));
 await new Promise(r=>setTimeout(r,500));
}
const report={ready,status,errors};
if(ready){report.engine=await evaluate(`(()=>{const d=window.__qcdkr3d;const e=d.engine;return{keys:Object.keys(d),actorReady:Boolean(document.querySelector('[data-character="ready"]')),dispatchAvailable:typeof e?.inspectStand==='function',asset:document.querySelector('[data-avatar]')?.dataset.avatar};})()`);}
const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile('tmp/coldroll-web-import/Factory.png',Buffer.from(shot.data,'base64'));await fs.writeFile('tmp/coldroll-web-import/factory-verification.json',JSON.stringify(report,null,2));console.log('FACTORY_IMPORT_CHECK',JSON.stringify(report));ws.close();if(!ready)process.exitCode=1;
