import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';
import {root,configureProjectEnv} from '../scripts/project-env.mjs';
import {startServer} from '../server/index.mjs';
configureProjectEnv();
test('built frontend and real prediction API run with isolated project data',async()=>{
 const dataDir=await fs.mkdtemp(path.join(root,'tmp/test-data/http-'));
 const server=await startServer({port:0,dataDir,distDir:path.join(root,'dist'),requireLogin:false});
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const health=await fetch(base+'/api/health').then(r=>r.json());assert.equal(health.version,'1.1.0');assert.equal(health.ok,true);
  const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(await page.text(),/type="module"/);
  const input=JSON.parse(await fs.readFile(path.join(root,'models/example-case.json'),'utf8'));
  const expected=JSON.parse(await fs.readFile(path.join(root,'models/example-source-row.json'),'utf8')).model_prediction;
  const response=await fetch(base+'/api/predict',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input,mode:'formal'})});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.mode,'formal');assert.ok(Math.abs(result.value-expected)<1e-6);
  const stored=JSON.parse(await fs.readFile(path.join(dataDir,'activity-log.json'),'utf8'));assert.ok(stored.some(x=>x.message.includes('预测')));
 }finally{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
