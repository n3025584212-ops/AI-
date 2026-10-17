import {SEARCH_CONFIG} from './smartCandidateConfig.js';
import {SMART19_CONFIG} from './smart19Config.js';
import {hasCurrentActionMetadata} from './candidatePresentation.js';
import {candidatePredictionMatches,candidateReachableRangeMatches,CANDIDATE_EVALUATION_VERSION,candidateSearchIdentity,sameCandidateSearchIdentity,
 maxReachabilityIdentity,sameMaxReachabilityIdentity,maxReachabilityRangeMatches,candidateActionIdentity,sameActionPredictionIdentity} from './candidatePrediction.js';
export function createSmartCandidateClient(request,{wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),pollMs=100}={}){
 let active=null;
 const discard=job=>{if(job.runId&&!job.cancelSent){job.cancelSent=true;void request('/candidate-search/'+job.runId+'/cancel',{method:'POST',body:'{}'}).catch(()=>{});}};
 const cancel=(reason='CANCELLED')=>{
  const job=active;if(!job)return;job.reason=reason;discard(job);job.controller.abort();active=null;
  clearTimeout(job.timer);
  job.onState({status:reason,recommendations:[],message:reason==='STALE'?'当前工况已变化，本次候选搜索已取消。':'已取消候选搜索。'});
 };
 function search({input,prediction,input_snapshot,observation=prediction.observation,operation_scope,customLimits,targetValueT=input.target,searchMatchTolerance=3,
  executionPath='USER_INITIATED_SEARCH',modelMetadata={},current,onState=()=>{}}){
  const maximum=executionPath==='MAX_REACHABILITY_SCAN',prefetch=executionPath==='BACKGROUND_PREFETCH';
  const expected=maximum?maxReachabilityIdentity(input,prediction,{observation,modelMetadata,customLimits}):prefetch?candidateActionIdentity(input,prediction,{modelMetadata,customLimits}):candidateSearchIdentity(input,prediction,{observation,targetValue:targetValueT,searchMatchTolerance,modelMetadata,customLimits});
  const sameIdentity=maximum?sameMaxReachabilityIdentity:prefetch?sameActionPredictionIdentity:sameCandidateSearchIdentity;
  if(active&&!active.reason&&sameIdentity(active.identity,expected)&&active.executionPath===executionPath)return active.promise;
  cancel('STALE');
  const job={identity:expected,executionPath,controller:new AbortController(),runId:null,reason:null,onState};active=job;
  // The server already bounds the scan. Bound its transport as well, including
  // the initial POST, so an obsolete/unresponsive job cannot block the next frame.
  if(maximum)job.timer=setTimeout(()=>{job.timedOut=true;job.controller.abort();},SMART19_CONFIG.timeBudgetMs+pollMs);
  const isCurrent=()=>active===job&&!job.reason&&current();
  const stopped=()=>({status:job.reason||'STALE',recommendations:[],message:'当前工况已变化，本次候选搜索已取消。'});
  const identityMatches=run=>sameIdentity(run.identity,expected)
   &&run.execution_path===executionPath&&run.search_run_id===job.runId
   &&(maximum?run.identity?.baselineSnapshotId===prediction.snapshot_id&&run.identity?.input25Hash===prediction.input_hash
    &&run.identity?.modelHash===prediction.model_hash&&run.identity?.modelIdentity===prediction.model_version
    :run.identity?.baseline_prediction_identity?.receipt===prediction.receipt)
   &&run.identity?.evaluation_version===CANDIDATE_EVALUATION_VERSION
   &&run.identity?.operation_scope?.session_id===operation_scope.session_id&&(maximum||run.identity?.operation_scope?.revision===operation_scope.revision);
  job.promise=(async()=>{
   onState({status:'SEARCHING',current_level:maximum?3:1,execution_path:executionPath,message:maximum?'智能试算中…':'正在搜索候选方案…',recommendations:[]});
   try{
    let run=await request('/candidate-search',{method:'POST',...(maximum?{signal:job.controller.signal}:{}),body:JSON.stringify({input,prediction,input_snapshot,observation,operation_scope,customLimits,targetValueT,searchMatchTolerance,executionPath})});
    job.runId=run.search_run_id;
    if(!isCurrent()){discard(job);return stopped();}
    if(!job.runId)throw new Error('搜索服务未返回搜索身份。');
    while(true){
     if(!isCurrent()||!identityMatches(run)){cancel('STALE');discard(job);return stopped();}
     if(!maximum&&!prefetch&&run.reachable_range&&(!run.level_path?.includes(run.reachable_range.completed_level)
      ||!candidateReachableRangeMatches(run.reachable_range,expected,prediction,observation)))throw new Error('候选可达范围未完整计算或身份不匹配。');
     if(run.status!=='SEARCHING')break;
     onState({...run,recommendations:[]});await wait(pollMs);
     if(!isCurrent()){discard(job);return stopped();}
     run=await request('/candidate-search/'+job.runId,{signal:job.controller.signal});
    }
    if(run.status==='COMPLETED'){
     const sparse=run.algorithm==='SPARSE19_TWO_STAGE';
     const count=sparse?run.total_candidate_count:SEARCH_CONFIG.levels.find(item=>item.level===run.current_level)?.totalCandidates;
     if(!count||run.evaluated_candidate_count!==count||run.total_candidate_count!==count
      ||!Number.isInteger(count)||!Array.isArray(run.level_path)||!maximum&&!sparse&&(run.level_path.some((level,index)=>level!==index+1)||run.level_path.length!==run.current_level)
      ||sparse&&(run.identity?.candidateConfigVersion!==SMART19_CONFIG.version||run.identity?.search_configuration_version!==SMART19_CONFIG.version||run.current_level!==(prefetch?1:3)
       ||run.nsga&&(run.nsga.population!==SMART19_CONFIG.population||run.nsga.generations>SMART19_CONFIG.generations))
      ||maximum&&(run.current_level!==3||run.recommendations.length!==0||!maxReachabilityRangeMatches(run.max_reachable_range,expected,prediction,observation))
      ||executionPath==='BACKGROUND_PREFETCH'&&run.current_level!==1
      ||run.recommendations.length>3||new Set(run.recommendations.map(plan=>plan.id)).size!==run.recommendations.length
      ||run.recommendations.some(plan=>!hasCurrentActionMetadata(plan)||plan.search_run_id!==run.search_run_id||plan.status!=='A/B_READY'
       ||!sameCandidateSearchIdentity(plan.search_identity,expected)||plan.baseline_snapshot_id!==prediction.snapshot_id
       ||plan.candidate_prediction?.mode!=='formal'||!plan.candidate_prediction.receipt||!candidatePredictionMatches(plan)))throw new Error('搜索结果不完整或身份不匹配。');
    }
    onState(run);return run;
   }catch(error){
    if(job.reason||!current()){discard(job);return stopped();}
    if(job.timedOut)error=new Error('智能试算范围计算超时，请重新进入方案页重试。');
    discard(job);onState({status:'FAILED',message:error.message,recommendations:[]});throw error;
   }finally{clearTimeout(job.timer);if(active===job)active=null;}
  })();
  return job.promise;
 }
 return {search,cancel};
}
