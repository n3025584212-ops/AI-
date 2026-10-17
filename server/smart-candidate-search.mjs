import {randomUUID} from 'node:crypto';
import {MODEL_FEATURES,modelInputValues} from '../src/modelInputs.js';
import {convertUnit,sourceUnitFor} from '../src/engineeringUnits.js';
import {caseToModelValues,createCaseInputSnapshot} from './model-service.mjs';
import {validateDraftCandidate,draftBaselineIdentity} from '../src/draftState.js';
import {checkHistoricalRanges,sanitizeCustomLimits} from '../src/historicalRangeCheck.js';
import {FORMAL_INPUT_RANGE_AUDIT} from '../src/formalInputRanges.js';
import {currentModelReferenceRanges} from '../src/inputRangeDefaults.js';
import {reportInputFingerprint,deepFreeze} from '../src/predictionSnapshot.js';
import {SEARCH_CONFIG,actionStepsForLevel} from '../src/smartCandidateConfig.js';
import {CANDIDATE_EVALUATION_VERSION,STALE_CHECK_FIELDS,ACTION_PREDICTION_IDENTITY_FIELDS,MAX_REACHABILITY_IDENTITY_FIELDS,candidateSearchIdentity,candidateSearchCacheKey,sameCandidateSearchIdentity,matchedCandidateActual,
 actionPredictionCacheKey,maxReachabilityCacheKey,maxReachabilityIdentity,sameActionPredictionIdentity,sameMaxReachabilityIdentity} from '../src/candidatePrediction.js';
import {createActionPredictionCache} from './candidate-action-cache.mjs';
import {createSmart19CandidateSearch} from './smart19-search.mjs';
export {SEARCH_CONFIG} from '../src/smartCandidateConfig.js';
export const NUMERIC_GAP_EPSILON_MN=0.000001;
export const NUMERIC_GAP_EPSILON=convertUnit(NUMERIC_GAP_EPSILON_MN,'MN','t');
const clone=structuredClone,finite=Number.isFinite;
export class SearchError extends Error {
 constructor(code,message,status=400){super(message);this.code=code;this.status=status;}
}
// Metadata coverage is distinct from historical reference quantiles. No inferred
// margins or unit assumptions may turn an unavailable domain into a valid one.
export function projectModelInputDomain(metadata={},customLimits={}){
 const fields={},ranges=currentModelReferenceRanges(customLimits);
 for(const feature of MODEL_FEATURES){
  const bounds=ranges[feature.key],schema=metadata.feature_schema?.find(f=>f.key===feature.key);
  if(!Array.isArray(bounds)||bounds.length!==2||!bounds.every(finite)||bounds[0]>bounds[1]
   ||schema?.unit_status!=='confirmed'||schema.unit!==sourceUnitFor(feature.field))
   return {available:false,source:'UNAVAILABLE',fields:{},reason:'当前参考范围或正式模型单位未确认。'};
  fields[feature.key]={min:bounds[0],max:bounds[1],unit:schema.unit};
 }
 return {available:true,source:'CURRENT_EFFECTIVE_RANGE',modelHash:metadata.model_hash,modelIdentity:metadata.model_version,fields};
}
export function expandSearchActions(input,actions,{level=3}={}){
 if(!Array.isArray(actions)||!actions.length||actions.length>SEARCH_CONFIG.maxChangedActions)throw new SearchError('INVALID_CANDIDATE','调整动作数量无效。');
 const limit=SEARCH_CONFIG.levels.find(item=>item.level===level)?.maxPercent;
 if(!limit)throw new SearchError('INVALID_CANDIDATE','未知试算级别。');
 const seen=new Set(),changes=[],expanded=[];
 for(const selected of actions){
  const action=SEARCH_CONFIG.actions.find(a=>a.actionId===selected.action_id),delta=selected.action_delta_percent;
  if(!action||seen.has(action.actionId)||!Number.isInteger(delta)||Math.abs(delta)>limit)throw new SearchError('INVALID_CANDIDATE','动作或整数调整档位不在搜索范围内。');
  seen.add(action.actionId);
  if(delta===0)continue;
  const derived_field_values={};
  for(const key of action.affectedFields){
   const f=MODEL_FEATURES.find(f=>f.key===key),before=input.stands.find(s=>s.id===f.stand)?.[f.field],after=before*(1+delta/100);
   if(!finite(before)||before===0||!finite(after)||after===before)throw new SearchError('INVALID_CANDIDATE','候选值或相对调整基值无效。');
   changes.push({feature_key:key,stand:f.stand,field:f.field,before,after,relative_change_percent:delta});
   derived_field_values[key]=after;
  }
  expanded.push({action_id:action.actionId,action_delta_percent:delta,affected_fields:[...action.affectedFields],derived_field_values});
 }
 return {actions:expanded,changes};
}
export function validateSearchCandidate(input,changes,actions,{level=3}={}){
 const expected=expandSearchActions(input,actions,{level}),seen=new Set();
 if(actions.length!==expected.actions.length||!Array.isArray(changes)||changes.length!==expected.changes.length)throw new SearchError('INVALID_CANDIDATE','候选字段未完整展开搜索动作。');
 for(const change of changes){
  const match=expected.changes.find(c=>c.feature_key===change.feature_key);
  if(!match||seen.has(change.feature_key)||['stand','field','before','after','relative_change_percent'].some(key=>change[key]!==match[key]))throw new SearchError('INVALID_CANDIDATE','候选字段与搜索动作不一致。');
  seen.add(change.feature_key);
 }
 if(actions.some((a,i)=>(a.affected_fields&&JSON.stringify(a.affected_fields)!==JSON.stringify(expected.actions[i].affected_fields))
  ||(a.derived_field_values&&(Object.keys(a.derived_field_values).length!==expected.actions[i].affected_fields.length
   ||expected.actions[i].affected_fields.some(key=>a.derived_field_values[key]!==expected.actions[i].derived_field_values[key])))))throw new SearchError('INVALID_CANDIDATE','动作元数据与派生字段不一致。');
 const next=clone(input);
 changes.forEach(change=>{next.stands.find(s=>s.id===change.stand)[change.field]=change.after;});
 caseToModelValues(next);
 return next;
}
export function generateSearchCandidates(input,baseline,{rangeTable,customLimits={},searchRunId=null,level=1,modelDomain}={}){
 const candidates=[],seenInputs=new Map(),metadata={model_hash:baseline.model_hash,model_version:baseline.model_version};
 for(const steps of actionStepsForLevel(level)){
  const selected=SEARCH_CONFIG.actions.map((action,index)=>({action_id:action.actionId,action_delta_percent:steps[index]}));
  const enumeration_index=candidates.length;
  let next,actions,changes;
  try{
   ({actions,changes}=expandSearchActions(input,selected,{level}));
   next=clone(input);changes.forEach(change=>{next.stands.find(s=>s.id===change.stand)[change.field]=change.after;});
   caseToModelValues(next);
  }catch(error){if(!['INVALID_CANDIDATE','INVALID_INPUT'].includes(error.code))throw error;candidates.push({enumeration_index,action_steps_percent:steps,validation:'INVALID_CANDIDATE',reason:error.message});continue;}
  const input_key=JSON.stringify(caseToModelValues(next)),common={enumeration_index,action_steps_percent:steps,actions,changes,input:next,input_key,search_level:level};
  const rangeRows=checkHistoricalRanges(next,rangeTable,sanitizeCustomLimits(customLimits)).rows;
  const reference_warnings=rangeRows.filter(row=>row.status==='REVIEW_RECOMMENDED').map(row=>({feature_key:row.key,label:row.label,value:row.value,min:row.min,max:row.max,
   source:row.rangeSource,status:'OUT_OF_REFERENCE_RANGE_WARNING'}));
  // Validate the final complete vector, including every inherited input.
  const values=caseToModelValues(next);
  const domainChecks=MODEL_FEATURES.map((feature,index)=>{
   const key=feature.key,value=values[index],bound=modelDomain?.fields?.[key];
   return {feature_key:key,value,min:bound?.min??null,max:bound?.max??null,unit:bound?.unit??null,
    status:!modelDomain?.available||!bound?'UNAVAILABLE':value<bound.min?'BELOW_MODEL_INPUT_DOMAIN':value>bound.max?'ABOVE_MODEL_INPUT_DOMAIN':'IN_MODEL_INPUT_DOMAIN'};
  });
  const hardChecks=MODEL_FEATURES.filter(f=>!sanitizeCustomLimits(customLimits)[f.key]&&FORMAL_INPUT_RANGE_AUDIT[f.key]?.mapping_status==='CONFIRMED').map(f=>{
   const b=FORMAL_INPUT_RANGE_AUDIT[f.key],value=values[f.index];
   return {feature_key:f.key,value,lower:b.lower,upper:b.upper,document:b.document,
    valid:(!finite(b.lower)||value>=b.lower)&&(!finite(b.upper)||value<=b.upper)};
  });
  const extra={reference_warnings,model_domain_checks:domainChecks,formal_boundary_checks:hardChecks};
  if(domainChecks.some(c=>c.status==='UNAVAILABLE')){candidates.push({...common,...extra,validation:'MODEL_DOMAIN_UNAVAILABLE'});continue;}
  if(domainChecks.some(c=>c.status!=='IN_MODEL_INPUT_DOMAIN')){candidates.push({...common,...extra,validation:'OUT_OF_MODEL_INPUT_DOMAIN'});continue;}
  if(hardChecks.some(c=>!c.valid)){candidates.push({...common,...extra,validation:'OUT_OF_FORMAL_BOUNDARY'});continue;}
  if(seenInputs.has(input_key)){candidates.push({...common,...extra,validation:'DUPLICATE_INPUT',duplicate_of:seenInputs.get(input_key)});continue;}
  seenInputs.set(input_key,enumeration_index);
  if(!changes.length){candidates.push({...common,...extra,candidate_type:'UNCHANGED_BASELINE',validation:'UNCHANGED'});continue;}
  next=validateSearchCandidate(input,changes,actions,{level});
  const input_snapshot=createCaseInputSnapshot(next,metadata);
  const candidate={id:randomUUID(),title:'智能调整方案',candidate_source:'SMART_SEARCH',mode:'formal',...metadata,
   baseline_snapshot_id:baseline.snapshot_id,parent_snapshot_id:baseline.snapshot_id,target_snapshot_id:input_snapshot.snapshot_id,
   input_snapshot,changes,actions:deepFreeze(actions),readOnly:true,enumeration_index,action_steps_percent:steps,input_key,search_run_id:searchRunId,search_level:level};
  candidate.action_metadata_identity=deepFreeze({search_run_id:searchRunId,candidate_id:candidate.id,baseline_snapshot_id:baseline.snapshot_id,
   target_snapshot_id:input_snapshot.snapshot_id,search_configuration_version:SEARCH_CONFIG.version});
  validateDraftCandidate(candidate,baseline,baseline.input_snapshot,{...draftBaselineIdentity(baseline),valid:true});
  candidates.push({...candidate,...extra,input:next,validation:'VALID'});
 }
 return candidates;
}
export function candidateMetrics(candidate,baselineValue,target,actual=null){
 if(!finite(candidate.predictedValue)||!finite(baselineValue)||target!=null&&!finite(target))throw new SearchError('INVALID_PREDICTION','候选或当前工况预测无效。');
 const {candidateEvaluationValue,baselineEvaluationValue,predictionErrorAdjustment,prediction_error_adjustment,...rawCandidate}=candidate;
 const anchored=finite(actual),delta=candidate.predictedValue-baselineValue,estimate=anchored?actual+delta:candidate.predictedValue;
 const gap=finite(target)?estimate-target:null,distance=gap===null?null:Math.abs(gap),baselineGap=finite(target)?Math.abs((anchored?actual:baselineValue)-target):null;
 return {...rawCandidate,baselineValue,baseline_prediction:baselineValue,candidateRawPrediction:candidate.predictedValue,
  evaluation_version:CANDIDATE_EVALUATION_VERSION,calculation_mode:anchored?'ACTUAL_ANCHORED_MODE':'PRE_ADJUSTMENT_MODE',actual_anchored_mode:anchored,
  actual_s5:anchored?actual:null,target_s5:target,model_response_delta:delta,estimated_candidate_s5:estimate,estimated_target_gap:gap,target_distance:distance,
  model_prediction_error:anchored?baselineValue-actual:null,process_target_gap:anchored&&finite(target)?actual-target:null,
  process_target_tolerance:null,correction_required:'UNCLASSIFIED',process_target_status:'UNCLASSIFIED',
  baseline_target_gap:baselineGap,candidate_target_gap:distance,candidate_target_deviation:gap,changed_field_count:candidate.changes.length,
  changed_action_count:candidate.actions.length,action_count:candidate.actions.length,action_l1:candidate.actions.reduce((sum,a)=>sum+Math.abs(a.action_delta_percent),0),
  model_domain_status:'IN_MODEL_INPUT_DOMAIN',reference_range_status:candidate.reference_warnings?.length?'OUT_OF_REFERENCE_RANGE_WARNING':'IN_REFERENCE_RANGE',
  total_relative_change:candidate.actions.reduce((sum,a)=>sum+Math.abs(a.action_delta_percent),0),
  total_relative_change_action_based:candidate.actions.reduce((sum,a)=>sum+Math.abs(a.action_delta_percent),0),total_relative_change_method:SEARCH_CONFIG.totalRelativeChangeMethod,
  max_single_field_change:Math.max(...candidate.changes.map(c=>Math.abs(c.relative_change_percent))),
  reference_warning_count:candidate.reference_warnings?.length||0,candidate_improves_target:distance!==null&&distance<baselineGap};
}
const compare=(...keys)=>(a,b)=>{for(const key of keys){const delta=a[key]-b[key];if(delta)return delta;}return 0;};
export function selectSearchRepresentatives(rows,baselineGap,searchMatchTolerance=3){
 // Minimum adjustment means fewest actions; magnitude is not a ranking key.
 // Target ranking/qualification stays uncomputed; no synthetic target is used.
 if(baselineGap===null){
  const legal=rows.filter(r=>r.validation==='VALID'&&r.changed_action_count>0&&r.target_s5===null);
  const row=[...legal].sort(compare('changed_action_count','enumeration_index'))[0];
  return {result:row?'TARGET_NOT_SET':'NO_VALID_CANDIDATE',target_reached:null,nearest_reachable_prediction:null,best_discrete_gap:null,minimum_target_gap:null,search_match_count:0,improving_count:0,pareto:[],
   recommendations:row?[{...row,recommendation_labels:['TARGET_PRIORITY','MIN_ADJUSTMENT','BALANCED']}]:[],winners:row?{TARGET_PRIORITY:row.enumeration_index,MIN_ADJUSTMENT:row.enumeration_index,BALANCED:row.enumeration_index}:{}};
 }
 const valid=rows.filter(r=>r.validation==='VALID'&&r.changed_action_count>0&&finite(r.target_distance));
 const nearest=[...valid].sort(compare('target_distance','changed_action_count','total_relative_change','enumeration_index'))[0];
 // The stop threshold is not a process qualification/filter. Rank the same
 // complete legal pool for all three policies, using their frozen objectives.
 const matched=valid.filter(r=>r.target_distance<=searchMatchTolerance),pool=valid;
 const reach={nearest_reachable_prediction:nearest?.estimated_candidate_s5??null,best_discrete_gap:nearest?.target_distance??null,
  minimum_target_gap:nearest?.target_distance??null,search_match_count:matched.length,target_reached:!!matched.length};
 if(!pool.length)return {...reach,result:'NO_VALID_CANDIDATE',improving_count:0,pareto:[],recommendations:[],winners:{}};
 const axes=['target_distance','changed_action_count','total_relative_change'];
 const front=pool.filter(b=>!pool.some(a=>a!==b&&axes.every(k=>a[k]<=b[k])&&axes.some(k=>a[k]<b[k])));
 const bounds=axes.map(k=>[Math.min(...front.map(r=>r[k])),Math.max(...front.map(r=>r[k]))]);
 const pareto=front.map(row=>({...row,balanced_distance:Math.hypot(...axes.map((k,i)=>bounds[i][1]===bounds[i][0]?0:(row[k]-bounds[i][0])/(bounds[i][1]-bounds[i][0])))}));
 const winners={
  TARGET_PRIORITY:[...pool].sort(compare('target_distance','changed_action_count','total_relative_change','enumeration_index'))[0],
  MIN_ADJUSTMENT:[...pool].sort(compare('changed_action_count','target_distance','enumeration_index'))[0],
  BALANCED:[...pareto].sort(compare('balanced_distance','target_distance','changed_action_count','total_relative_change','enumeration_index'))[0]
 };
 const grouped=new Map();
 for(const [label,row] of Object.entries(winners)){
  if(!grouped.has(row.enumeration_index))grouped.set(row.enumeration_index,{...row,recommendation_labels:[]});
  grouped.get(row.enumeration_index).recommendation_labels.push(label);
  if(label==='BALANCED')grouped.get(row.enumeration_index).balanced_distance=row.balanced_distance;
 }
 return {...reach,result:matched.length?'SEARCH_TARGET_REACHED':'CLOSEST_LEGAL_CANDIDATES',improving_count:pool.filter(r=>r.candidate_improves_target).length,
  pareto:pareto.map(r=>r.enumeration_index),winners:Object.fromEntries(Object.entries(winners).map(([k,r])=>[k,r.enumeration_index])),recommendations:[...grouped.values()]};
}
export function searchRunIdentity(baseline,input,binding,targetValueT=input.target,searchMatchTolerance=3,observation=baseline.observation,modelMetadata={},customLimits={}){
 return {...clone(binding),...candidateSearchIdentity(input,baseline,{observation,targetValue:targetValueT,searchMatchTolerance,modelMetadata,customLimits}),
  baseline_snapshot_id:baseline.snapshot_id,baseline_input_hash:baseline.input_hash,baseline_prediction_identity:{
   snapshot_id:baseline.snapshot_id,input_hash:baseline.input_hash,receipt:baseline.receipt,model_hash:baseline.model_hash,model_version:baseline.model_version},
  target_identity:candidateSearchIdentity(input,baseline,{observation,targetValue:targetValueT,searchMatchTolerance,modelMetadata,customLimits}).targetIdentity,
  target_value:targetValueT,search_match_tolerance:searchMatchTolerance,evaluation_version:CANDIDATE_EVALUATION_VERSION,
  model_hash:baseline.model_hash,model_version:baseline.model_version,search_configuration_version:SEARCH_CONFIG.version};
}
const terminalMessage={CANCELLED:'已取消候选搜索。',STALE:'当前工况已变化，本次候选搜索已取消。',SUPERSEDED:'此搜索已被新搜索替代。',
 TIMEOUT:'候选搜索未在时间预算内完整完成。',FAILED:'候选搜索失败，请重试。'};
export function modelTrialEnvelope(baselinePrediction,trialPredictions) {
 if(!finite(baselinePrediction)||!trialPredictions.every(finite))throw new SearchError('INVALID_PREDICTION','智能试算范围包含无效预测。');
 const predictions=[baselinePrediction,...trialPredictions],deltas=predictions.map(value=>value-baselinePrediction);
 return {candidate_count:predictions.length,estimated_min:Math.min(...predictions),estimated_max:Math.max(...predictions),
  delta_min:Math.min(...deltas),delta_max:Math.max(...deltas),baseline_reference_count:1};
}
export function createSmartCandidateSearch(options){return createSmart19CandidateSearch(options);}
// Historical two-Action implementation remains available for isolated baselines.
// The product factory above always uses the two-stage 19-field optimizer.
export function createLegacyTwoActionSearch({evaluate,rangeTable,isCurrent,onComplete=()=>{},now=Date.now,timeBudgetMs=SEARCH_CONFIG.timeBudgetMs}){
 const runs=new Map(),latest=new Map(),candidateRuns=new Map();
 const maxReachabilityProjectionCache=new Map(),targetSelectionCache=new Map();
 const actionPredictionCache=createActionPredictionCache({evaluate,isActive:active,now});
 function stop(run,status){
  if(!['SEARCHING','COMPLETED'].includes(run.status))return;
  run.status=status;run.result=null;run.recommendations=[];run.audit=[];delete run.pareto;delete run.winners;
  delete run.max_reachable_range;run.message=terminalMessage[status];clearTimeout(run.timer);
 }
 function active(run){
  if(run.status!=='SEARCHING')return false;
  if(latest.get(run.owner_key)!==run.search_run_id){stop(run,'SUPERSEDED');return false;}
  if(now()-run.started_at_ms>=timeBudgetMs){stop(run,'TIMEOUT');return false;}
  if(!isCurrent(run)){stop(run,'STALE');return false;}return true;
 }
 function view(run){const {owner,owner_key,actor,audit,timer,...publicRun}=run;return clone(publicRun);}
 function owned(id,actor){const run=runs.get(id);if(!run||run.owner!==actor.id)throw new SearchError('SEARCH_NOT_FOUND','搜索不存在。',404);return run;}
 const rawKey=run=>run.owner+':'+run.identity.baselineSnapshotId+':'+actionPredictionCacheKey(run.identity);
 const projectionKey=run=>run.owner+':'+maxReachabilityCacheKey(run.identity);
 const selectionKey=run=>run.owner+':'+run.identity.baselineSnapshotId+':'+candidateSearchCacheKey(run.identity)+':'+run.identity.modelInputDomainVersion+':'+run.identity.formalHardLimitVersion+':'+run.constraint_identity;
 const boundedSet=(cache,key,value)=>{if(cache.size>=128&&!cache.has(key))cache.delete(cache.keys().next().value);cache.set(key,value);};
 function statisticsFor(pool,level){
  const legal=pool.filter(c=>c.validation==='VALID');
  return {level,total_candidate_count:pool.length,candidate_count:pool.length,evaluated_candidate_count:pool.length,
   unique_candidate_count:new Set(pool.filter(c=>c.input_key).map(c=>c.input_key)).size,legal_candidate_count:legal.length,
   valid_candidate_count:legal.length,unchanged_candidate_count:pool.filter(c=>c.validation==='UNCHANGED').length,
   domain_excluded_count:pool.filter(c=>c.validation==='OUT_OF_MODEL_INPUT_DOMAIN').length,
   formal_excluded_count:pool.filter(c=>c.validation==='OUT_OF_FORMAL_BOUNDARY').length,
   historical_warning_count:legal.filter(c=>c.reference_warnings.length).length,
   deduplicated_candidate_count:pool.filter(c=>c.validation==='DUPLICATE_INPUT').length,
   invalid_candidate_count:pool.filter(c=>c.validation==='INVALID_CANDIDATE').length};
 }
 function bounds(points){
  return {candidate_count:points.length,estimated_min:points.length?Math.min(...points.map(row=>row.estimate)):null,
   estimated_max:points.length?Math.max(...points.map(row=>row.estimate)):null,
   delta_min:points.length?Math.min(...points.map(row=>row.delta)):null,delta_max:points.length?Math.max(...points.map(row=>row.delta)):null};
 }
 async function completeLevel(run,entry,level,input,baseline,customLimits,modelDomain,maximum=false){
  const started=now(),selection=targetSelectionCache.get(selectionKey(run)),cached=!maximum&&selection?.get(level);
  if(cached){
   run.prediction_cache_total+=cached.rows.length;run.prediction_cache_hits+=cached.rows.length;run.cache_hit_count+=cached.rows.length;
   if(level===1)run.level1_cache_hit=true;
   return {...clone(cached),statistics:{...cached.statistics,inferred_candidate_count:0,inference_batches:0,reused_prediction_count:cached.rows.length,elapsed_ms:now()-started}};
  }
  const pool=generateSearchCandidates(input,baseline,{rangeTable,customLimits,searchRunId:run.search_run_id,level,modelDomain});
  const legal=pool.filter(c=>c.validation==='VALID'),before=run.dk_qkar_inference_count,batchesBefore=run.inference_batch_count;
  const tasks=await Promise.all(legal.map(candidate=>actionPredictionCache.request(entry,candidate,run)));
  if(!active(run))throw new SearchError('SEARCH_STOPPED','搜索身份已失效。');
  const actual=matchedCandidateActual(baseline,run.observation)?.value??null,anchor=actual??baseline.value;
  const points=legal.map((candidate,index)=>{const delta=tasks[index].prediction.value-baseline.value;return {estimate:anchor+delta,delta};});
  const statistics={...statisticsFor(pool,level),inferred_candidate_count:run.dk_qkar_inference_count-before,
   inference_batches:run.inference_batch_count-batchesBefore,reused_prediction_count:legal.length-(run.dk_qkar_inference_count-before),elapsed_ms:now()-started};
  // The signed 0% baseline is always an envelope reference, never a winner.
  if(level===3){
   const range={scope:'MAX_REACHABILITY',identity:Object.fromEntries(MAX_REACHABILITY_IDENTITY_FIELDS.map(key=>[key,run.identity[key]])),
    completed_level:3,max_adjustment_percent:15,...modelTrialEnvelope(baseline.value,tasks.map(task=>task.prediction.value)),
    valid_candidate_count:legal.length,domain_excluded_count:statistics.domain_excluded_count,
    formal_excluded_count:statistics.formal_excluded_count,historical_warning_count:statistics.historical_warning_count,model_domain_source:modelDomain.source};
   // Late or partial work can only fill signed raw cache, never publish a projection.
   boundedSet(maxReachabilityProjectionCache,projectionKey(run),clone(range));run.max_reachable_range=clone(range);
  }
  if(maximum||run.execution_path==='BACKGROUND_PREFETCH')return {rows:[],statistics};
  const rows=legal.map((candidate,index)=>{const {input,...plan}=candidate,prediction=tasks[index].prediction;
   return candidateMetrics({...plan,predictedValue:prediction.value,candidate_prediction:prediction},baseline.value,run.target_value,actual);});
  const reachable_range={identity:Object.fromEntries(STALE_CHECK_FIELDS.map(key=>[key,run.identity[key]])),
   completed_level:level,max_adjustment_percent:SEARCH_CONFIG.levels[level-1].maxPercent,...bounds(points)};
  const completed={rows,statistics,reachable_range};
  let levels=targetSelectionCache.get(selectionKey(run));if(!levels){levels=new Map();boundedSet(targetSelectionCache,selectionKey(run),levels);}
  levels.set(level,clone(completed));return completed;
 }
 const calculationSource=run=>run.dk_qkar_inference_count===0?(run.inflight_reuse_count?'部分缓存':'全部缓存'):run.prediction_cache_hits?'部分缓存':'实时计算';
 async function execute(run,input,baseline,customLimits,modelDomain){
  try{
   if(!active(run))return;
   if(!modelDomain.available)throw new SearchError('MODEL_DOMAIN_UNAVAILABLE',modelDomain.reason);
   caseToModelValues(input);
   const values=modelInputValues(input);
   if(run.execution_path!=='MAX_REACHABILITY_SCAN'&&MODEL_FEATURES.some(f=>!SEARCH_CONFIG.fields.includes(f.key)
    &&(values[f.index]<modelDomain.fields[f.key].min||values[f.index]>modelDomain.fields[f.key].max)))
    throw new SearchError('BASELINE_OUT_OF_MODEL_INPUT_DOMAIN','当前工况存在超出模型输入覆盖范围的字段，暂无法生成有效参数试算方案。');
   const entry=actionPredictionCache.entry(rawKey(run),Object.fromEntries(ACTION_PREDICTION_IDENTITY_FIELDS.map(key=>[key,run.identity[key]])));
   if(run.execution_path==='MAX_REACHABILITY_SCAN'){
    run.current_level=3;run.total_candidate_count=SEARCH_CONFIG.levels.at(-1).totalCandidates;run.message='19维智能试算中…';
    const cached=maxReachabilityProjectionCache.get(projectionKey(run));
    if(cached){run.max_reachable_range=clone(cached);run.projection_cache_hit=true;run.evaluated_candidate_count=SEARCH_CONFIG.levels.at(-1).totalCandidates;run.candidate_count=SEARCH_CONFIG.levels.at(-1).totalCandidates;}
    else {const completed=await completeLevel(run,entry,3,input,baseline,customLimits,modelDomain,true);if(!active(run))return;Object.assign(run,completed.statistics);run.level_statistics=[clone(completed.statistics)];}
    if(!active(run))return;
    run.status='COMPLETED';run.elapsed_ms=now()-run.started_at_ms;run.message='S5智能试算范围已更新。';run.recommendations=[];
    run.scan_statistics={total_tuples:SEARCH_CONFIG.levels.at(-1).totalCandidates,cache_hit_count:run.prediction_cache_hits,new_model_call_count:run.dk_qkar_inference_count,
     scan_duration_ms:run.elapsed_ms,inflight_reuse_count:run.inflight_reuse_count,projection_cache_hit:!!run.projection_cache_hit};
    clearTimeout(run.timer);return;
   }
   // Complete the target-neutral envelope first. Reuse the same signed trials
   // for the unchanged L1/L2/L3 selection and stop rules below.
   if(run.execution_path==='USER_INITIATED_SEARCH'){
    const cached=maxReachabilityProjectionCache.get(projectionKey(run));
    if(cached){run.max_reachable_range=clone(cached);run.projection_cache_hit=true;}
    else await completeLevel(run,entry,3,input,baseline,customLimits,modelDomain,true);
    if(!active(run))return;
   }
   const maxLevel=run.execution_path==='BACKGROUND_PREFETCH'||!finite(run.target_value)?1:3;
   for(let level=1;level<=maxLevel;level++){
    if(!active(run))return;
    run.current_level=level;run.message=level===1?'正在搜索候选方案…':'正在扩大试算范围…';
    run.total_candidate_count=SEARCH_CONFIG.levels[level-1].totalCandidates;
    const completed=await completeLevel(run,entry,level,input,baseline,customLimits,modelDomain);
    if(!active(run))return;
    if(run.execution_path==='BACKGROUND_PREFETCH'){
     Object.assign(run,completed.statistics);run.level_path.push(level);run.level_statistics.push(clone(completed.statistics));
     run.recommendations=[];run.status='COMPLETED';
     run.elapsed_ms=now()-run.started_at_ms;run.message='当前工况预热完成。';clearTimeout(run.timer);return;
    }
    const actual=matchedCandidateActual(baseline,run.observation)?.value??baseline.value;
    const selected=selectSearchRepresentatives(completed.rows,finite(run.target_value)?Math.abs(actual-run.target_value):null,run.search_match_tolerance);
    Object.assign(run,completed.statistics,selected,{current_level:level,reachable_range:clone(completed.reachable_range)});
    run.level_path.push(level);run.level_statistics.push(clone(completed.statistics));run.audit=completed.rows;
    if(!selected.target_reached&&level<maxLevel)run.recommendations=[];
    if(selected.target_reached||level===maxLevel){
     run.status='COMPLETED';run.elapsed_ms=now()-run.started_at_ms;
     run.message=!finite(run.target_value)?'候选方案已生成；未设置目标值。':selected.target_reached?'候选方案已生成。':'当前试算空间内未找到进入搜索停止阈值的方案，以下显示最接近目标的试算结果。';
     run.calculation_source=calculationSource(run);
     const search_details={level_path:clone(run.level_path),search_match_tolerance:run.search_match_tolerance,level1_cache_hit:run.level1_cache_hit,
      valid_candidate_count:run.valid_candidate_count,domain_excluded_count:run.domain_excluded_count,historical_warning_count:run.historical_warning_count,
      cache_hit_count:run.cache_hit_count,prediction_cache_hits:run.prediction_cache_hits,prediction_cache_total:run.prediction_cache_total,
      calculation_source:run.calculation_source,elapsed_ms:run.elapsed_ms,model_domain_source:modelDomain.source};
     run.recommendations=selected.recommendations.map(row=>{
      const id=randomUUID();
      return deepFreeze({...row,id,status:'A/B_READY',search_run_id:run.search_run_id,search_identity:clone(run.identity),search_details,
       cache_status:run.cache_hit_count?'REUSED':'COMPUTED',search_duration_ms:run.elapsed_ms,
       action_metadata_identity:{search_run_id:run.search_run_id,candidate_id:id,baseline_snapshot_id:baseline.snapshot_id,
        target_snapshot_id:row.target_snapshot_id,search_configuration_version:SEARCH_CONFIG.version},
       improvement:row.baseline_target_gap>NUMERIC_GAP_EPSILON?(row.baseline_target_gap-row.target_distance)/row.baseline_target_gap*100:0,
       risk:'模型复算',description:'基于真实当前工况及正式QCDKR模型响应的参数试算。'});
     });
     run.recommendations.forEach(plan=>candidateRuns.set(plan.id,run.search_run_id));onComplete(run.recommendations);clearTimeout(run.timer);return;
    }
   }
  }catch(error){if(active(run)){stop(run,'FAILED');run.message=error.message;run.error_code=error.code||'SEARCH_FAILED';}}
 }
 return {
  start({input,baseline,binding,customLimits={},actor,targetValueT=null,searchMatchTolerance=3,observation=baseline.observation,modelMetadata={},executionPath='USER_INITIATED_SEARCH'}){
   input=clone(input);baseline=clone(baseline);customLimits=clone(customLimits);
   const maximum=executionPath==='MAX_REACHABILITY_SCAN',prefetch=executionPath==='BACKGROUND_PREFETCH';
   if(targetValueT==null||targetValueT==='')targetValueT=null;
   if(!maximum&&!prefetch&&targetValueT!==null&&(!finite(targetValueT)||targetValueT<=0))throw new SearchError('INVALID_TARGET','目标值须为有效的正数，或留空。');
   if(!maximum&&(!finite(searchMatchTolerance)||searchMatchTolerance<1||searchMatchTolerance>10))throw new SearchError('TOLERANCE_REQUIRED','搜索停止阈值必须在1～10 t内。');
   if(!['USER_INITIATED_SEARCH','BACKGROUND_PREFETCH','MAX_REACHABILITY_SCAN'].includes(executionPath))throw new SearchError('INVALID_SEARCH_PATH','未知候选任务类型。');
   const identity={...searchRunIdentity(baseline,input,binding,targetValueT,searchMatchTolerance,observation,modelMetadata,customLimits),
    ...maxReachabilityIdentity(input,baseline,{observation,modelMetadata,customLimits})};
   const ownerKey=actor.id+':'+binding.operation_scope.session_id+':'+executionPath,previous=runs.get(latest.get(ownerKey));
   const constraintIdentity=reportInputFingerprint(sanitizeCustomLimits(customLimits));
   const matching=maximum?sameMaxReachabilityIdentity(previous?.identity,identity):prefetch?sameActionPredictionIdentity(previous?.identity,identity):sameCandidateSearchIdentity(previous?.identity,identity)
    &&sameActionPredictionIdentity(previous?.identity,identity);
   if(previous?.status==='SEARCHING'&&matching&&sameMaxReachabilityIdentity(previous.identity,identity)&&previous.constraint_identity===constraintIdentity)return view(previous);
   if(previous)stop(previous,'STALE');
   if(runs.size>=128){const old=[...runs].find(([,r])=>r.status!=='SEARCHING');if(old){runs.delete(old[0]);for(const [id,runId] of candidateRuns)if(runId===old[0])candidateRuns.delete(id);}}
   const domain=projectModelInputDomain(modelMetadata,customLimits);
   if(domain.available&&(domain.modelHash!==baseline.model_hash||domain.modelIdentity!==baseline.model_version))throw new SearchError('MODEL_DOMAIN_STALE','模型覆盖范围身份已变化。',409);
   const run={search_run_id:randomUUID(),identity,...identity,constraint_identity:constraintIdentity,actor,owner:actor.id,owner_key:ownerKey,status:'SEARCHING',execution_path:executionPath,observation:clone(observation),
    started_at_ms:now(),evaluated_candidate_count:0,total_candidate_count:SEARCH_CONFIG.levels[maximum?SEARCH_CONFIG.levels.length-1:0].totalCandidates,candidate_count:SEARCH_CONFIG.levels[maximum?SEARCH_CONFIG.levels.length-1:0].totalCandidates,current_level:maximum?3:1,level_path:[],level_statistics:[],
    dk_qkar_inference_count:0,inference_batch_count:0,cache_hit_count:0,prediction_cache_hits:0,prediction_cache_total:0,inflight_reuse_count:0,level1_cache_hit:false,
    result:null,recommendations:[],audit:[],message:maximum?'19维智能试算中…':'正在搜索候选方案…'};
   runs.set(run.search_run_id,run);latest.set(ownerKey,run.search_run_id);
   run.timer=setTimeout(()=>stop(run,'TIMEOUT'),timeBudgetMs);
   queueMicrotask(()=>void execute(run,input,baseline,sanitizeCustomLimits(customLimits),domain));return view(run);
  },
  get(id,actor){const run=owned(id,actor);if(run.status==='SEARCHING')active(run);else if(run.status==='COMPLETED'&&!isCurrent(run))stop(run,'STALE');return view(run);},
  cancel(id,actor){const run=owned(id,actor);stop(run,'CANCELLED');return view(run);},
  audit(id,actor){return clone(owned(id,actor).audit);},
  assertCandidateCurrent(reference,actor,required=false){
   const runId=candidateRuns.get(reference?.id);if(!runId){if(required)throw new SearchError('SEARCH_RESULT_STALE','搜索记录已过期，请重新搜索。',409);return;}
   const run=owned(runId,actor);
   if(run.execution_path!=='USER_INITIATED_SEARCH'||run.status!=='COMPLETED'||latest.get(run.owner_key)!==runId||!isCurrent(run)
    ||!sameCandidateSearchIdentity(reference.search_identity,run.identity)
    ||!run.recommendations.some(plan=>plan.id===reference.id&&plan.target_snapshot_id===reference.target_snapshot_id&&plan.baseline_snapshot_id===reference.baseline_snapshot_id))
    throw new SearchError('SEARCH_RESULT_STALE','工况或搜索已变化，请重新搜索。',409);
  },
  close(){for(const run of runs.values())stop(run,'CANCELLED');actionPredictionCache.close();runs.clear();latest.clear();candidateRuns.clear();maxReachabilityProjectionCache.clear();targetSelectionCache.clear();}
 };
}
