import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {root,configureProjectEnv} from './project-env.mjs';
configureProjectEnv();
const mode=process.argv[2]||'start',children=[];
function child(exe,args){const x=spawn(exe,args,{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});children.push(x);x.on('error',e=>{console.error(e.message);shutdown(1);});x.on('exit',code=>shutdown(code||0));return x;}
let stopping=false;function shutdown(code){if(stopping)return;stopping=true;for(const x of children)if(x.exitCode===null)x.kill('SIGTERM');process.exitCode=code;}
for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>shutdown(0));
if(mode==='dev'){
  child(process.execPath,[path.join(root,'scripts/serve.mjs')]);
  child(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(process.env.QCDKR_FRONTEND_PORT||5190),'--strictPort']);
}else if(mode==='app'){
  if(!fs.existsSync(path.join(root,'dist/index.html')))throw Error('Run qcdkr.cmd build before app.');
  child(path.join(root,'node_modules/electron/dist/electron.exe'),[root]);
}else if(mode==='start'||mode==='serve'){
  if(!fs.existsSync(path.join(root,'dist/index.html'))){const b=spawnSync(process.execPath,[path.join(root,'scripts/build.mjs')],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});if(b.status!==0)process.exit(b.status||1);}
  child(process.execPath,[path.join(root,'scripts/serve.mjs')]);
}else throw Error('Unknown mode: '+mode);
