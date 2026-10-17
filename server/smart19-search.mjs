import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {MODEL_FEATURES} from '../src/modelInputs.js';
import {SMART19_CONFIG,RANGE19_PROTOCOL} from '../src/smart19Config.js';
import {FORMAL_INPUT_RANGE_AUDIT} from '../src/formalInputRanges.js';
import {sanitizeCustomLimits,checkHistoricalRanges} from '../src/historicalRangeCheck.js';
import {deepFreeze,reportInputFingerprint} from '../src/predictionSnapshot.js';
import {caseToModelValues} from './model-service.mjs';
import {validateDraftCandidate,draftBaselineIdentity} from '../src/draftState.js';
import {ACTION_PREDICTION_IDENTITY_FIELDS,MAX_REACHABILITY_IDENTITY_FIELDS,CANDIDATE_EVALUATION_VERSION,
 matchedCandidateActual,maxReachabilityCacheKey,actionPredictionCacheKey,candidateSearchCacheKey,sameCandidateSearchIdentity,
 sameMaxReachabilityIdentity,maxReachabilityIdentity} from '../src/candidatePrediction.js';
import {createActionPredictionCache} from './candidate-action-cache.mjs';
import {SearchError,projectModelInputDomain,searchRunIdentity,candidateMetrics,modelTrialEnvelope} from './smart-candidate-search.mjs';
import {Evaluator,keyOf,selectRepresentatives,runNsga} from './sparse19-nsga.mjs';
import {RawTrialCache,singleAxisTuples} from './sparse19-range.mjs';
import {coverageRange} from './sparse19-coverage.mjs';
const clone=structuredClone,zero=()=>Array(19).fill(0);
let bankPromise;
const bank=()=>bankPromise??=(async()=>{
 const bytes=await readFile(new URL('./range19-bank.json',import.meta.url));
 if(createHash('sha256').update(bytes).digest('hex')!==RANGE19_PROTOCOL.bankHash)throw new SearchError('RANGE_BANK_IDENTITY','范围候选库身份不一致。');
 const value=JSON.parse(bytes);if(value.tuples.length!==4096||value.sourceFramesUsedForGeneration!==0)throw new SearchError('RANGE_BANK_IDENTITY','范围候选库配置无效。');
 return value.tuples;
})();
function inputFor(base,vector){const input=clone(base);input.target=null;
 MODEL_FEATURES.slice(6).forEach(f=>{input.stands.find(s=>s.id===f.stand)[f.field]=vector[f.index];});return input;
}
function domainBounds(domain,customLimits){const custom=sanitizeCustomLimits(customLimits);
 return MODEL_FEATURES.map(f=>{const b=domain.fields[f.key],hard=FORMAL_INPUT_RANGE_AUDIT[f.key],bounds=[b.min,b.max];
  if(!custom[f.key]&&hard?.mapping_status==='CONFIRMED'){
   if(Number.isFinite(hard.lower))bounds[0]=Math.max(bounds[0],hard.lower);
   if(Number.isFinite(hard.upper))bounds[1]=Math.min(bounds[1],hard.upper);
  }return bounds;
 });
}
function publicEnvelope(range,p0,identity){return deepFreeze({scope:'MAX_REACHABILITY',identity:Object.fromEntries(MAX_REACHABILITY_IDENTITY_FIELDS.map(k=>[k,identity[k]])),
 completed_level:3,max_adjustment_percent:15,candidate_count:range.candidateCount,baseline_reference_count:1,
 estimated_min:range.predictionMin,estimated_max:range.predictionMax,delta_min:range.predictionMin-p0,delta_max:range.predictionMax-p0,
 range_algorithm_version:RANGE19_PROTOCOL.version,range_bank_hash:RANGE19_PROTOCOL.bankHash,range_bank_budget:RANGE19_PROTOCOL.bankBudget,
 range_is_explored:true,global_extrema_certified:false,low_key:range.lowKey,high_key:range.highKey});}
export function createSmart19CandidateSearch({evaluate,rangeTable,isCurrent,onComplete=()=>{},now=Date.now,timeBudgetMs=SMART19_CONFIG.timeBudgetMs}){
 const runs=new Map(),latest=new Map(),candidateRuns=new Map(),ranges=new Map();let closed=false;
 const ownerKey=r=>r.owner+':'+r.identity.operation_scope.session_id+':'+r.execution_path;
 const rawKey=r=>r.owner+':'+r.identity.baselineSnapshotId+':'+actionPredictionCacheKey(r.identity);
 const rangeKey=r=>r.owner+':'+maxReachabilityCacheKey(r.identity);
 const terminal={STALE:'当前工况已变化，本次候选搜索已取消。',CANCELLED:'已取消候选搜索。',TIMEOUT:'候选搜索未在时间预算内完整完成。',FAILED:'候选方案生成失败，请重试。'};
 function stop(run,status){if(!['SEARCHING','COMPLETED'].includes(run.status))return;run.status=status;run.recommendations=[];run.audit=[];
  run.message=terminal[status]||terminal.STALE;delete run.max_reachable_range;clearTimeout(run.timer);}
 function active(run){if(closed||run.status!=='SEARCHING')return false;
  if(now()-run.started_at_ms>=timeBudgetMs){if(run.internalLease)run.status='TIMEOUT';else stop(run,'TIMEOUT');return false;}
  if(!isCurrent(run)){if(run.internalLease)run.status='STALE';else stop(run,'STALE');return false;}
  if(!run.internalLease&&latest.get(ownerKey(run))!==run.search_run_id){stop(run,'STALE');return false;}return true;}
 const ensure=run=>{if(!active(run))throw new SearchError('SEARCH_STOPPED','当前试算身份已失效。');};
 const cache=createActionPredictionCache({evaluate,isActive:active,now,batchSize:SMART19_CONFIG.modelBatchSize,maxEntries:SMART19_CONFIG.maxCachedBaselines});
 const view=run=>{const {owner,actor,audit,timer,internalLease,...value}=run;return clone(value);};
 function owned(id,actor){const r=runs.get(id);if(!r||r.owner!==actor.id)throw new SearchError('SEARCH_NOT_FOUND','搜索不存在。',404);return r;}
 function workerFor(input,entry,run,base){return {async predictRows(vectors){ensure(run);
  const predictions=[];for(let offset=0;offset<vectors.length;offset+=SMART19_CONFIG.modelBatchSize){
   ensure(run);const slice=vectors.slice(offset,offset+SMART19_CONFIG.modelBatchSize);
   const tasks=await Promise.all(slice.map(vector=>{const tuple=vector.slice(6).map((n,j)=>base[j+6]===0?0:Math.round((n/base[j+6]-1)*100));
    return cache.request(entry,{action_steps_percent:tuple,input_key:JSON.stringify(vector),input:inputFor(input,vector)},run);
   }));ensure(run);predictions.push(...tasks.map(t=>t.prediction.value));
  }return predictions;
 }};}
 function cacheEntry(run){return cache.entry(rawKey(run),Object.fromEntries(ACTION_PREDICTION_IDENTITY_FIELDS.map(k=>[k,run.identity[k]])));}
 async function obtainRange(run,input,baseline,domain,customLimits){const key=rangeKey(run);let slot=ranges.get(key);
  if(slot?.result){run.projection_cache_hit=true;return slot.result;}
  if(slot){run.range_inflight_reused=true;return slot.promise;}
  // This lease belongs to the committed baseline, never a Target revision.
  const lease={...run,internalLease:true,execution_path:'MAX_REACHABILITY_SCAN',status:'SEARCHING',started_at_ms:now(),current_level:3,
   dk_qkar_inference_count:0,inference_batch_count:0,prediction_cache_hits:0,prediction_cache_total:0,cache_hit_count:0,inflight_reuse_count:0};
  slot={lease,result:null};ranges.set(key,slot);
  slot.promise=(async()=>{
   const base=caseToModelValues(input),bounds=domainBounds(domain,customLimits),entry=cacheEntry(run);
   const raw=new RawTrialCache(workerFor(input,entry,lease,base),{canonical25:base},baseline.value,bounds);
   const outcome=await coverageRange(raw,await bank(),RANGE19_PROTOCOL);ensure(lease);
   if(!outcome.stationary)throw new SearchError('RANGE_COVERAGE_UNFINISHED','范围端点精修未完成，请重新试算。');
   const envelope=publicEnvelope(outcome.range,baseline.value,run.identity);
   const result={raw,entry,envelope,outcome};slot.result=result;lease.status='COMPLETED';
   for(const field of ['dk_qkar_inference_count','inference_batch_count','prediction_cache_hits','prediction_cache_total','cache_hit_count','inflight_reuse_count'])run[field]+=lease[field];
   if(ranges.size>SMART19_CONFIG.maxCachedBaselines){for(const [oldKey,old] of ranges)if(oldKey!==key&&old.result){ranges.delete(oldKey);break;}}
   return result;
  })().catch(error=>{if(ranges.get(key)===slot)ranges.delete(key);lease.status='FAILED';throw error;});return slot.promise;
 }
 function planFor(row,index,run,input,baseline,entry,actual){
  const task=entry.actions.get(JSON.stringify(row.x)),prediction=task?.prediction;
  if(!prediction||task.state!=='READY')throw new SearchError('CANDIDATE_NOT_VERIFIED','候选缺少正式复算结果。');
  const changes=[],actions=[];
  row.x.forEach((p,j)=>{if(!p)return;const f=MODEL_FEATURES[j+6],before=input.stands.find(s=>s.id===f.stand)[f.field],after=before*(1+p/100);
   changes.push({feature_key:f.key,stand:f.stand,field:f.field,before,after,relative_change_percent:p});
   actions.push({action_id:SMART19_CONFIG.actions[j].actionId,action_delta_percent:p,affected_fields:[f.key],derived_field_values:{[f.key]:after}});
  });
  const reference_warnings=checkHistoricalRanges(prediction.inputContext,rangeTable,sanitizeCustomLimits(run.customLimits)).rows
   .filter(r=>r.status==='REVIEW_RECOMMENDED').map(r=>({feature_key:r.key,label:r.label,value:r.value,min:r.min,max:r.max,source:r.rangeSource,status:'OUT_OF_REFERENCE_RANGE_WARNING'}));
  const candidate={id:randomUUID(),title:'智能调整方案',candidate_source:'SMART_SEARCH',mode:'formal',model_hash:baseline.model_hash,model_version:baseline.model_version,
   baseline_snapshot_id:baseline.snapshot_id,parent_snapshot_id:baseline.snapshot_id,target_snapshot_id:prediction.snapshot_id,input_snapshot:clone(prediction.input_snapshot),
   changes,actions,readOnly:true,validation:'VALID',enumeration_index:index,search_level:3,search_run_id:run.search_run_id,action_steps_percent:row.x,
   candidate_prediction:clone(prediction),predictedValue:prediction.value,reference_warnings};
  candidate.action_metadata_identity={search_run_id:run.search_run_id,candidate_id:candidate.id,baseline_snapshot_id:baseline.snapshot_id,
   target_snapshot_id:candidate.target_snapshot_id,search_configuration_version:SMART19_CONFIG.version};
  validateDraftCandidate(candidate,baseline,baseline.input_snapshot,{...draftBaselineIdentity(baseline),valid:true});
  return {...candidateMetrics(candidate,baseline.value,run.target_value,actual),status:'A/B_READY',search_identity:clone(run.identity),
   risk:'模型复算',description:'基于真实当前工况及正式QCDKR模型响应的参数试算。'};
 }
 async function execute(run,input,baseline,customLimits,domain){try{
  ensure(run);if(!domain.available)throw new SearchError('MODEL_DOMAIN_UNAVAILABLE',domain.reason);
  const base=caseToModelValues(input),bounds=domainBounds(domain,customLimits),entry=cacheEntry(run);
  if(run.execution_path==='BACKGROUND_PREFETCH'){
   const raw=new RawTrialCache(workerFor(input,entry,run,base),{canonical25:base},baseline.value,bounds);
   await raw.evaluateTuples(singleAxisTuples(raw,[-2,2]));ensure(run);run.current_level=1;run.level_path=[1];
   run.total_candidate_count=run.evaluated_candidate_count=raw.cache.size;run.status='COMPLETED';run.message='当前工况预热完成。';return;
  }
  run.current_level=3;const context=await obtainRange(run,input,baseline,domain,customLimits);ensure(run);
  run.max_reachable_range=clone(context.envelope);run.range_stationary=context.outcome.stationary;
  if(run.execution_path==='MAX_REACHABILITY_SCAN'){
   run.total_candidate_count=run.evaluated_candidate_count=context.envelope.candidate_count;run.candidate_count=context.envelope.candidate_count;
   run.status='COMPLETED';run.message='S5智能试算范围已更新。';return;
  }
  const actual=matchedCandidateActual(baseline,run.observation)?.value??null;
  const evaluator=new Evaluator(workerFor(input,context.entry,run,base),{canonical25:base,actual},baseline.value,bounds,run.target_value);
  // Copy phase A rows. Phase B adds only to its own archive / signed trial cache.
  evaluator.cache=new Map(context.raw.rows().map(r=>[r.key,evaluator.makeRow(r.x,r.prediction,'RANGE_CACHE_REUSED')]));
  await evaluator.evaluateTuples(singleAxisTuples(evaluator,[-15,-10,-6,-2,-1,1,2,6,10,15]));ensure(run);
  let evolution=null;
  if(Number.isFinite(run.target_value)){
   const initial=selectRepresentatives(evaluator.rows(),SMART19_CONFIG.tolerance);
   const seeds=[zero(),initial.nearest.x,initial.minimum.x,initial.balanced.x,context.raw.cache.get(context.envelope.low_key).x,context.raw.cache.get(context.envelope.high_key).x,
    ...evaluator.rows().filter(r=>r.actionCount===1).sort((a,b)=>a.gap-b.gap).slice(0,4).map(r=>r.x)];
   // A small or zero-valued feasible space has fewer than 48 distinct points.
   // Its legal candidates are still returned rather than stalling population fill.
   const legalSteps=base.slice(6).map((_,j)=>Array.from({length:31},(_,k)=>k-15).filter(p=>{
    const value=base[j+6]*(1+p/100);return (p===0||base[j+6]!==0)&&Number.isFinite(value)&&value>=bounds[j+6][0]&&value<=bounds[j+6][1];
   }));
   const smallSpace=legalSteps.reduce((n,steps)=>Math.min(49,n*steps.length),1)<=48;
   if(smallSpace){let tuples=[[]];for(const steps of legalSteps)tuples=tuples.flatMap(x=>steps.map(p=>[...x,p]));
    await evaluator.evaluateTuples(tuples.filter(x=>evaluator.validateTuple(x)));
   }else evolution=await runNsga(evaluator,SMART19_CONFIG,seeds,SMART19_CONFIG.seed);
  }
  ensure(run);const rows=evaluator.rows().filter(r=>r.actionCount>0);
  const selected=Number.isFinite(run.target_value)?selectRepresentatives(rows,SMART19_CONFIG.tolerance):null;
  const fallback=[...rows].sort((a,b)=>a.actionCount-b.actionCount||a.key.localeCompare(b.key))[0];
  const choices=selected?{TARGET_PRIORITY:selected.nearest,MIN_ADJUSTMENT:selected.minimum,BALANCED:selected.balanced}
   :{TARGET_PRIORITY:fallback,MIN_ADJUSTMENT:fallback,BALANCED:fallback};
  const grouped=new Map();let index=0;run.winners={};
  for(const [label,row] of Object.entries(choices)){if(!row)continue;
   if(!grouped.has(row.key)){const plan=planFor(row,index++,run,input,baseline,context.entry,actual);plan.recommendation_labels=[];grouped.set(row.key,plan);}
   const plan=grouped.get(row.key);plan.recommendation_labels.push(label);run.winners[label]=plan.enumeration_index;
  }
  run.recommendations=[...grouped.values()].map(p=>deepFreeze(p));run.audit=clone(run.recommendations);
  run.level_path=[3];run.nsga=evolution;run.target_reached=selected?selected.matchedCount>0:null;
  run.result=!rows.length?'NO_VALID_CANDIDATE':!selected?'TARGET_NOT_SET':run.target_reached?'SEARCH_TARGET_REACHED':'CLOSEST_LEGAL_CANDIDATES';
  run.search_match_count=selected?.matchedCount??0;run.minimum_target_gap=selected?.nearest?.gap??null;run.pareto=selected?.pareto.map(r=>r.key)??[];
  run.total_candidate_count=run.evaluated_candidate_count=evaluator.cache.size;run.candidate_count=evaluator.cache.size;
  // Preserve the existing projection contract without extending the basic range.
  const anchor=actual??baseline.value,values=evaluator.rows().map(r=>anchor+r.prediction-baseline.value);
  run.reachable_range={identity:clone(run.identity),completed_level:3,max_adjustment_percent:15,candidate_count:values.length,
   estimated_min:Math.min(...values),estimated_max:Math.max(...values),delta_min:Math.min(...values)-anchor,delta_max:Math.max(...values)-anchor};
  run.status='COMPLETED';run.message=run.target_value===null?'候选方案已生成；未设置目标值。':run.target_reached?'候选方案已生成。':'当前试算空间内未找到足够接近目标的方案，已显示最接近目标的结果。';
  run.recommendations.forEach(p=>candidateRuns.set(p.id,run.search_run_id));onComplete(run.recommendations);
 }catch(error){if(active(run)){stop(run,'FAILED');run.error_code=error.code||'SEARCH_FAILED';run.message=error.message;}}
 finally{run.elapsed_ms=now()-run.started_at_ms;clearTimeout(run.timer);delete run.customLimits;}}
 return {
  start({input,baseline,binding,actor,customLimits={},targetValueT=null,searchMatchTolerance=3,observation=baseline.observation,modelMetadata={},executionPath='USER_INITIATED_SEARCH'}){
   if(closed)throw new SearchError('SEARCH_CLOSED','搜索服务已关闭。');input=clone(input);baseline=clone(baseline);customLimits=clone(customLimits);
   if(targetValueT==null||targetValueT==='')targetValueT=null;
   if(targetValueT!==null&&(!Number.isFinite(targetValueT)||targetValueT<=0))throw new SearchError('INVALID_TARGET','目标值须为有效的正数，或留空。');
   if(!['USER_INITIATED_SEARCH','MAX_REACHABILITY_SCAN','BACKGROUND_PREFETCH'].includes(executionPath))throw new SearchError('INVALID_SEARCH_PATH','未知候选任务类型。');
   const identity={...searchRunIdentity(baseline,input,binding,targetValueT,SMART19_CONFIG.tolerance,observation,modelMetadata,customLimits),
    ...maxReachabilityIdentity(input,baseline,{modelMetadata,customLimits}),search_configuration_version:SMART19_CONFIG.version};
   const previous=runs.get(latest.get(actor.id+':'+binding.operation_scope.session_id+':'+executionPath));
   const same=executionPath==='MAX_REACHABILITY_SCAN'?sameMaxReachabilityIdentity:sameCandidateSearchIdentity;
   if(previous?.status==='SEARCHING'&&same(previous.identity,identity))return view(previous);
   if(previous)stop(previous,'STALE');
   const domain=projectModelInputDomain(modelMetadata,customLimits);
   if(domain.available&&(domain.modelHash!==baseline.model_hash||domain.modelIdentity!==baseline.model_version))throw new SearchError('MODEL_DOMAIN_STALE','模型覆盖范围身份已变化。',409);
   const run={search_run_id:randomUUID(),identity,...identity,actor,owner:actor.id,execution_path:executionPath,algorithm:'SPARSE19_TWO_STAGE',
    status:'SEARCHING',started_at_ms:now(),current_level:executionPath==='BACKGROUND_PREFETCH'?1:3,level_path:[],level_statistics:[],
    dk_qkar_inference_count:0,inference_batch_count:0,prediction_cache_hits:0,prediction_cache_total:0,cache_hit_count:0,inflight_reuse_count:0,
    total_candidate_count:0,evaluated_candidate_count:0,candidate_count:0,recommendations:[],audit:[],customLimits,observation:clone(observation),
    message:executionPath==='MAX_REACHABILITY_SCAN'?'19维智能试算中…':'正在搜索候选方案…'};
   runs.set(run.search_run_id,run);latest.set(ownerKey(run),run.search_run_id);
   if(runs.size>128){for(const [id,r] of runs)if(r.status!=='SEARCHING'&&id!==run.search_run_id){runs.delete(id);break;}}
   run.timer=setTimeout(()=>stop(run,'TIMEOUT'),timeBudgetMs);queueMicrotask(()=>void execute(run,input,baseline,customLimits,domain));return view(run);
  },
  get(id,actor){const run=owned(id,actor);if(run.status==='SEARCHING')active(run);else if(run.status==='COMPLETED'&&!isCurrent(run))stop(run,'STALE');return view(run);},
  cancel(id,actor){const run=owned(id,actor);stop(run,'CANCELLED');return view(run);},
  audit(id,actor){return clone(owned(id,actor).audit);},
  assertCandidateCurrent(reference,actor,required=false){const id=candidateRuns.get(reference?.id);if(!id){if(required)throw new SearchError('SEARCH_RESULT_STALE','搜索记录已过期，请重新搜索。',409);return;}
   const run=owned(id,actor);if(run.status!=='COMPLETED'||latest.get(ownerKey(run))!==id||!isCurrent(run)
    ||!sameCandidateSearchIdentity(reference.search_identity,run.identity)||!run.recommendations.some(p=>p.id===reference.id&&p.target_snapshot_id===reference.target_snapshot_id&&p.baseline_snapshot_id===reference.baseline_snapshot_id))
    throw new SearchError('SEARCH_RESULT_STALE','工况或搜索已变化，请重新搜索。',409);
  },
  close(){closed=true;for(const r of runs.values())stop(r,'CANCELLED');for(const slot of ranges.values())slot.lease.status='CANCELLED';cache.close();ranges.clear();runs.clear();latest.clear();candidateRuns.clear();}
 };
}
