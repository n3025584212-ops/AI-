import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {root,configureProjectEnv} from './project-env.mjs';
configureProjectEnv();
if(!fs.existsSync(path.join(root,'dist/index.html'))){
  const built=spawnSync(process.execPath,[path.join(root,'scripts/build.mjs')],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
  if(built.status!==0)process.exit(built.status||1);
}
const tests=fs.readdirSync(path.join(root,'tests')).filter(x=>/\.test\.m?js$/.test(x)).sort().map(x=>path.join(root,'tests',x));
const result=spawnSync(process.execPath,['--test','--test-concurrency=1',...tests],{cwd:root,env:{...process.env,TZ:'Asia/Shanghai'},encoding:'utf8',windowsHide:true,maxBuffer:20*1024*1024});
fs.mkdirSync(path.join(root,'verification'),{recursive:true});fs.writeFileSync(path.join(root,'verification/TEST_RESULTS.txt'),(result.stdout||'')+(result.stderr||''));
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exitCode=result.status??1;
