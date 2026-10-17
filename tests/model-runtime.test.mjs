import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';
import {root,configureProjectEnv} from '../scripts/project-env.mjs';
import {checkRuntime} from '../scripts/check-runtime.mjs';
import {createPredictionService} from '../server/model-service.mjs';
configureProjectEnv();
test('independent Python, locked Node dependencies and complete local LLM resources',()=>{assert.equal(checkRuntime().status,'PASS');});
test('copied runtime performs actual frozen-model prediction with no host Python',async()=>{
 const dataDir=await fs.mkdtemp(path.join(root,'tmp/test-data/model-'));
 const service=createPredictionService({dataDir,modelBaseDir:path.join(root,'models')});
 try{
  const status=await service.status();assert.equal(status.status,'READY',status.reason);
  const example=JSON.parse(await fs.readFile(path.join(root,'models/example-case.json'),'utf8'));
  const expected=JSON.parse(await fs.readFile(path.join(root,'models/example-source-row.json'),'utf8')).model_prediction;
  const actual=await service.predict(example,{mode:'formal'});
  assert.equal(actual.mode,'formal');assert.ok(Math.abs(actual.value-expected)<1e-6,`${actual.value} != ${expected}`);
  assert.equal(actual.model_hash,status.model_hash);
 }finally{service.close();}
});
