import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {root,configureProjectEnv} from './project-env.mjs';
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function checkRuntime(projectRoot=root){
  const runtime=path.join(projectRoot,'model-runtime'),python=path.join(runtime,'python.exe');
  const manifest=JSON.parse(fs.readFileSync(path.join(runtime,'runtime-manifest.json'),'utf8'));
  if(manifest.requirementsSha256!==digest(path.join(projectRoot,'requirements-model.txt')))throw Error('Bundled Python requirements hash differs.');
  const probe=spawnSync(python,['-I','-c',"import json,sys,struct,importlib.metadata as m,numpy,pandas,scipy,sklearn,openpyxl;print(json.dumps({'python':sys.version.split()[0],'bits':struct.calcsize('P')*8,'prefix':sys.prefix,'libraries':{n:m.version(n) for n in ['numpy','pandas','scikit-learn','openpyxl','scipy','joblib']}}))"],{encoding:'utf8',windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  if(probe.status!==0)throw Error(probe.stderr||probe.error?.message||'Bundled Python probe failed.');
  const info=JSON.parse(probe.stdout.trim());
  if(!info.python.startsWith('3.12.')||info.bits!==64||path.resolve(info.prefix).toLowerCase()!==runtime.toLowerCase())throw Error('Model Python is not the independent bundled CPython 3.12 x64.');
  for(const [name,version]of Object.entries(manifest.libraries))if(info.libraries[name]!==version)throw Error('Python dependency mismatch: '+name);
  const config=JSON.parse(fs.readFileSync(path.join(projectRoot,'models/model-config.json'),'utf8'));
  if(digest(path.join(projectRoot,'models',config.modelPath))!==config.expectedSha256)throw Error('Frozen prediction model checksum mismatch.');
  const llm=path.join(projectRoot,'data/local-llm');
  if(!fs.existsSync(path.join(llm,'runtime/ollama.exe')))throw Error('Ollama executable missing.');
  const llmManifest=JSON.parse(fs.readFileSync(path.join(llm,'models/manifests/registry.ollama.ai/library/qwen3.5/4b'),'utf8'));
  const blobs=[llmManifest.config,...llmManifest.layers].map(x=>({path:path.join(llm,'models/blobs',x.digest.replace(':','-')),bytes:x.size,digest:x.digest}));
  for(const blob of blobs)if(!fs.existsSync(blob.path)||fs.statSync(blob.path).size!==blob.bytes)throw Error('LLM blob missing or incomplete: '+blob.digest);
  const pkg=JSON.parse(fs.readFileSync(path.join(projectRoot,'package.json'),'utf8')),lock=JSON.parse(fs.readFileSync(path.join(projectRoot,'package-lock.json'),'utf8'));
  const nodeDependencies=[];
  for(const name of Object.keys({...pkg.dependencies,...pkg.devDependencies})){const installed=JSON.parse(fs.readFileSync(path.join(projectRoot,'node_modules',name,'package.json'),'utf8')).version,locked=lock.packages['node_modules/'+name].version;if(installed!==locked)throw Error('Node dependency differs from lock: '+name);nodeDependencies.push({name,version:installed});}
  const result={status:'PASS',python:info,modelSha256:config.expectedSha256,llmModel:'qwen3.5:4b',llmBlobs:blobs.map(x=>({digest:x.digest,bytes:x.bytes})),node:process.version,nodeDependencies};
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  configureProjectEnv();const result=checkRuntime();
  if(process.argv.includes('--deep')){
    result.llmDigestChecks=[];
    for(const blob of result.llmBlobs){
      const sha=createHash('sha256');for await(const chunk of fs.createReadStream(path.join(root,'data/local-llm/models/blobs',blob.digest.replace(':','-'))))sha.update(chunk);
      const actual=sha.digest('hex');if(actual!==blob.digest.split(':')[1])throw Error('LLM blob checksum mismatch: '+blob.digest);
      result.llmDigestChecks.push({digest:blob.digest,status:'PASS'});
    }
  }
  fs.mkdirSync(path.join(root,'verification'),{recursive:true});fs.writeFileSync(path.join(root,'verification',process.argv.includes('--deep')?'RUNTIME_DEEP_VERIFY.json':'RUNTIME_VERIFY.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}
