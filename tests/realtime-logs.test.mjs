import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import {createLocalState} from '../server/local-state.mjs';
import {createMaintenance} from '../server/maintenance.mjs';
test('6000 historical rows remain readable but do not enter real-time totals',async()=>{
 const old=Array.from({length:6000},(_,id)=>({id:String(id),createdAt:'2026-10-12T00:00:00Z',level:'info',category:'system'}));
 const m=createMaintenance({state:{read:async()=>old}});
 assert.equal((await m.logs({scope:'realtime',limit:20})).total,0);
 assert.equal((await m.logs({limit:20})).total,6000);
 assert.equal(old.length,6000);
});
test('fresh-machine directory starts empty, then reflects only new persisted operations',async()=>{
 const dir=await mkdtemp(path.resolve('tmp/test-data/fresh-machine-'));
 const state=createLocalState(dir),m=createMaintenance({state});
 assert.equal((await m.logs({scope:'realtime',limit:20})).total,0);
 await m.log('system','info','日志专项验证启动');
 const first=await m.logs({scope:'realtime',limit:20});assert.equal(first.total,1);
 assert.equal(first.items[0].message,'日志专项验证启动');
 const bytes=await readFile(path.join(dir,'activity-log.json'));
 await new Promise(r=>setTimeout(r,5));
 const nextSession=createMaintenance({state});assert.equal((await nextSession.logs({scope:'realtime'})).total,0);
 assert.equal((await nextSession.logs({})).total,1);
 assert.deepEqual(await readFile(path.join(dir,'activity-log.json')),bytes);
});
