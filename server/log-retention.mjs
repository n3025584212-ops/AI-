import { randomUUID } from 'node:crypto';
import { unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { LOG_RETENTION_DAYS, AI_ANALYSIS_RETENTION_DAYS } from './ai-analysis-metrics.mjs';
import { StateError } from './local-state.mjs';

export const RETENTION_CHECK_INTERVAL_MS=24*60*60*1000;
export function retentionCutoff(clock=Date.now()) {const date=new Date(clock);date.setDate(date.getDate()-LOG_RETENTION_DAYS);return date.getTime();}
const timestamp=row=>{const value=row.createdAt??row.timestamp;return typeof value==='string'&&value.trim()?Date.parse(value):NaN;};
const storedBytes=rows=>Buffer.byteLength(JSON.stringify(rows,null,2)+'\n');
const failureReason=error=>String(error.message||error.code||'清理失败').slice(0,240);
export function createLogRetention({state,dataDir,maintenance,protectedReferences=async()=>({}),clock=Date.now,intervalMs=RETENTION_CHECK_INTERVAL_MS,removeFile=unlink}) {
 const leases=new Map();let timer=null,pending=null,lastResult=null;
 function pin(refs,{ttl=120000,actorId='internal'}={}) {
  const id=randomUUID();leases.set(id,{...refs,actorId,expiresAt:clock()+ttl});return {id,release:()=>leases.delete(id)};
 }
 function references() {
  const logIds=new Set(),analysisIds=new Set();
  for(const [id,item] of leases){if(item.expiresAt<=clock()){leases.delete(id);continue;}for(const value of item.logIds||[])logIds.add(value);for(const value of item.analysisIds||[])analysisIds.add(value);}
  return {logIds,analysisIds};
 }
 function fileFor(id) {
  if(!/^A-\d{4,12}$/.test(id))throw new StateError('分析记录文件身份无效。',500,'RETENTION_PATH_INVALID');
  const root=path.resolve(dataDir,'ai-analysis-records'),file=path.resolve(root,id+'.json');
  if(path.dirname(file)!==root)throw new StateError('清理目标超出分析记录目录。',500,'RETENTION_PATH_INVALID');
  return file;
 }
 async function cleanup() {
  if(pending)return pending;
  pending=(async()=>{
   const result={checkedAt:new Date(clock()).toISOString(),retentionDays:LOG_RETENTION_DAYS,analysisRetentionDays:AI_ANALYSIS_RETENTION_DAYS,
    cutoff:new Date(retentionCutoff(clock())).toISOString(),deletedLogs:0,deletedAnalyses:0,releasedBytes:0,invalidTimestampCount:0,failedCount:0,failures:[]};
   try{
    await state.mutate(async()=>{
     const active=await protectedReferences(),refs=references();
     for(const id of active.logIds||[])refs.logIds.add(id);for(const id of active.analysisIds||[])refs.analysisIds.add(id);
     const cutoff=retentionCutoff(clock()),activity=await state.read('activity-log.json',[]),events=await state.read('monitoring-events.json',[]);
     const all=new Map([...activity,...events].map(row=>[row.id,row])),index=await state.read('ai-analysis-records/index.json',[]),kept=[];
     // Protect entire reference sets for a report currently being viewed/exported/analyzed.
     for(const row of index)if(refs.analysisIds.has(row.analysisId))for(const id of row.sourceLogIds||[])refs.logIds.add(id);
     for(const row of index){
      const referenceExpired=(row.sourceLogIds||[]).some(id=>all.has(id)&&Number.isFinite(timestamp(all.get(id)))&&timestamp(all.get(id))<cutoff);
      const created=timestamp(row);
      if(!Number.isFinite(created)){result.invalidTimestampCount++;kept.push({...row,retentionIssue:'RETENTION_TIMESTAMP_INVALID'});for(const id of row.sourceLogIds||[])refs.logIds.add(id);continue;}
      if(!refs.analysisIds.has(row.analysisId)&&(created<cutoff||referenceExpired)){
       try{const file=fileFor(row.analysisId);let bytes=0;try{bytes=(await stat(file)).size;}catch(error){if(error.code!=='ENOENT')throw error;}
        try{await removeFile(file);}catch(error){if(error.code!=='ENOENT')throw error;}
        result.deletedAnalyses++;result.releasedBytes+=bytes;
       }catch(error){result.failedCount++;result.failures.push({code:error.code||'ANALYSIS_DELETE_FAILED',reason:failureReason(error),analysisId:row.analysisId});kept.push(row);for(const id of row.sourceLogIds||[])refs.logIds.add(id);}
      }else kept.push(row);
     }
     await state.write('ai-analysis-records/index.json',kept);
     const journal=await state.read('ai-analysis-records/state.json',null);
     if(journal){const ids=new Set(kept.map(row=>row.analysisId));journal.seen=Object.fromEntries(Object.entries(journal.seen||{}).filter(([,id])=>ids.has(id)));await state.write('ai-analysis-records/state.json',journal);}
     for(const [name,rows] of [['activity-log.json',activity],['monitoring-events.json',events]]){
      const next=[];let deleted=0;
      for(const row of rows){
       const time=timestamp(row);
       if(!Number.isFinite(time)){next.push({...row,retentionIssue:'RETENTION_TIMESTAMP_INVALID'});result.invalidTimestampCount++;}
       else if(time<cutoff&&!refs.logIds.has(row.id))deleted++;
       else next.push(row);
      }
      try{if(deleted||next.some(row=>row.retentionIssue))await state.write(name,next);
       result.deletedLogs+=deleted;result.releasedBytes+=Math.max(0,storedBytes(rows)-storedBytes(next));
      }catch(error){result.failedCount++;result.failures.push({code:error.code||'LOG_WRITE_FAILED',reason:failureReason(error),store:name});}
     }
    });
   }catch(error){result.failedCount++;result.failures.push({code:error.code||'RETENTION_CLEANUP_FAILED',reason:failureReason(error)});}
   result.releasedMb=Number((result.releasedBytes/1000000).toFixed(6));
   // One maintenance summary per pass, including invalid dates/failures; never one log per deleted row.
   await maintenance.log('maintenance',result.failedCount?'warning':'info',result.failedCount?'LOG_RETENTION_CLEANUP_FAILED':'日志自动清理完成',{
    retention:result,details:{retention:result},...(result.invalidTimestampCount?{code:'RETENTION_TIMESTAMP_INVALID'}:{})}).catch(()=>{});
   lastResult=result;return result;
  })().finally(()=>{pending=null;});return pending;
 }
 return {cleanup,pin,internalLease:refs=>pin(refs,{ttl:Number.MAX_SAFE_INTEGER}).release,
  createLease(input,actor){
   if(!['LOG_DETAIL','LOG_EXPORT','ANALYSIS','AI_ANSWER'].includes(input.type)||!Array.isArray(input.logIds||[])||!Array.isArray(input.analysisIds||[])
    ||(input.logIds||[]).length>10000||(input.analysisIds||[]).length>20
    ||[...(input.logIds||[]),...(input.analysisIds||[])].some(id=>typeof id!=='string'||id.length>100))throw new StateError('日志查看保护参数无效。');
   const held=pin({logIds:input.logIds||[],analysisIds:input.analysisIds||[]},{actorId:actor.id});return {leaseId:held.id,expiresInMs:120000};
  },
  releaseLease(id,actor){if(leases.get(id)?.actorId===actor.id)leases.delete(id);return {released:true};},
  start(){if(timer)return;void cleanup();timer=setInterval(()=>void cleanup(),intervalMs);timer.unref?.();},
  async close(){clearInterval(timer);timer=null;await pending;},status:()=>lastResult};
}
