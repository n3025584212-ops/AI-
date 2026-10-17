import {reportInputFingerprint} from './predictionSnapshot.js';
import {candidateSearchIdentity,candidateSearchCacheKey,sameCandidateSearchIdentity,maxReachabilityIdentity,maxReachabilityCacheKey,
 sameMaxReachabilityIdentity,maxReachabilityRangeMatches,candidateActionIdentity,sameActionPredictionIdentity,candidateDomainVersions} from './candidatePrediction.js';
export const POLICY_LABELS=Object.freeze({LOW_DISTURBANCE:'调参最少',BALANCED:'折中',TARGET_APPROACH:'最优'});
export const POLICY_WINNERS=Object.freeze({LOW_DISTURBANCE:'MIN_ADJUSTMENT',BALANCED:'BALANCED',TARGET_APPROACH:'TARGET_PRIORITY'});
export const POLICY_BUTTON_LABELS=Object.freeze({LOW_DISTURBANCE:'调参最少',BALANCED:'折中方案',TARGET_APPROACH:'最优方案'});
export const policyForWinner=label=>Object.keys(POLICY_WINNERS).find(policy=>POLICY_WINNERS[policy]===label);
const identityFor=(frame,config)=>candidateSearchIdentity(frame.input,frame.result,{observation:frame.observation??frame.result?.observation,
 targetValue:config.target==null||config.target===''?null:config.target,searchMatchTolerance:config.searchMatchTolerance??3,modelMetadata:config.modelMetadata,customLimits:config.customLimits});
export function frameCandidateKey(frame,config){return candidateSearchCacheKey(identityFor(frame,config));}
export function candidateQuickStatus(projection){
 if(projection.activeRun?.status==='COMPLETED')return projection.selectedWinner?'已选择 · '+POLICY_LABELS[projection.selectedPolicy]:'3类方案 · 待选择';
 if(projection.status==='SEARCHING')return '自动搜索 · 搜索中';
 if(projection.status==='STALE')return '候选方案 · 已过期';
 if(['FAILED','TIMEOUT'].includes(projection.status))return '候选方案 · 生成失败';
 return '自动搜索 · 待生成';
}
// This remains the single policy owner. L1 preheat and the maximum scan never
// own selected winners. No revealed/future-frame search backlog is built.
export function createCandidatePolicyState({evaluateFrame,onChange=()=>{},cancelActive=()=>{},cancelReachability=()=>{},schedule=fn=>setTimeout(fn,0)}){
 let config=null,frames=[],cursor=0,selectedPolicy=null,closed=false,currentReady=false,epoch=0;
 let userJob=null,prefetchJob=null,prefetchIntent=null,prefetchScheduled=false,lastState={status:'IDLE'};
 let configuredKey=null,configFingerprint=null,acceptedKey=null;
 const cache=new Map(),prefetched=new Map(),maxRanges=new Map();
 let maxJob=null,maxEpoch=0,maxState={status:'IDLE'},configuredMaxKey=null,reselectRequested=false;
 const scanMetrics={started:0,cancelled:0,staleResults:0};
 const rawIdentityFor=(item,c)=>candidateActionIdentity(item.input,item.result,{modelMetadata:c.modelMetadata,customLimits:c.customLimits});
 const rawKeyFor=item=>JSON.stringify(rawIdentityFor(item,config));
 const maxIdentityFor=(item,c)=>maxReachabilityIdentity(item.input,item.result,{observation:item.observation??item.result?.observation,modelMetadata:c.modelMetadata,customLimits:c.customLimits});
 const frame=()=>frames[cursor],keyFor=item=>frameCandidateKey(item,config);
 const currentKey=()=>config&&frame()?keyFor(frame()):null;
 const winnerOf=entry=>selectedPolicy&&entry?.run?.recommendations.find(p=>p.recommendation_labels.includes(POLICY_WINNERS[selectedPolicy]));
 function projection(){
  const entry=currentReady&&config&&frame()&&acceptedKey===currentKey()?cache.get(currentKey()):null;
  const run=entry?.run&&sameCandidateSearchIdentity(entry.run.identity,identityFor(frame(),config))?entry.run:null;
  const searchState=userJob?userJob.state:run||lastState;
  const currentFrame=frame(),identity=currentReady&&currentFrame&&config?.sectionOpen?maxIdentityFor(currentFrame,config):null;
  const storedRange=identity?maxRanges.get(maxReachabilityCacheKey(identity)):null;
  const reachableRange=maxReachabilityRangeMatches(storedRange,identity,currentFrame?.result,currentFrame?.observation??currentFrame?.result?.observation)?storedRange:null;
  const series=frames.slice(0,cursor+1).map(item=>{
   const stored=config?cache.get(keyFor(item)):null;
   const bound=stored&&sameCandidateSearchIdentity(stored.run.identity,identityFor(item,config)),plan=bound&&winnerOf(stored);
   return {frame:item,key:config?keyFor(item):null,baselineSnapshotId:bound?stored.baseline.snapshot_id:null,
    baselinePrediction:bound?stored.baseline.value:null,policyPrediction:plan?plan.estimated_candidate_s5:null,
    searchStatus:bound?'READY':'NO_RUN',searchRunId:bound?stored.run.search_run_id:null};
  });
  const completed=series.filter(point=>point.searchStatus==='READY').length;
  return {status:userJob?'SEARCHING':run?'READY':lastState.status==='IDLE'?'NO_RUN':lastState.status,searchState,
   selectedPolicy,selectedWinner:run?winnerOf(entry)||null:null,activeRun:run||null,reachableRange,maxReachabilityState:maxJob?{status:'SEARCHING'}:maxState,scanMetrics:{...scanMetrics},series,seriesLength:series.filter(p=>Number.isFinite(p.policyPrediction)).length,
   backfillSearching:!!userJob,trendGeneration:{totalCount:series.length,processedCount:completed,pendingCount:series.length-completed,
    failedCount:0,missingCandidateCount:0,ready:!!selectedPolicy&&completed===series.length},
   prefetchCompleted:config&&frame()&&prefetched.has(rawKeyFor(frame()))?1:0,prefetchTotal:frame()?1:0,
   prefetchStatus:prefetchJob?'SEARCHING':'IDLE',prefetchIntent:prefetchIntent?.identity.frameId??null,cacheSize:cache.size,
   candidateIds:series.flatMap(point=>cache.get(point.key)?.run?.recommendations.map(p=>p.id)||[])};
 }
 const emit=()=>{if(!closed)onChange(projection());};
 const matchesJob=job=>!closed&&currentReady&&job.epoch===epoch&&sameCandidateSearchIdentity(job.identity,identityFor(frame(),config));
 const usable=()=>currentReady&&frame()?.result?.mode==='formal'&&(config?.target==null||config.target===''||Number.isFinite(config.target)&&config.target>0);
 function revoke(reason='STALE'){
  const invalidated={running:!!userJob,foreground:!!userJob||!!acceptedKey||lastState.status==='STALE'};
  epoch++;acceptedKey=null;selectedPolicy=null;cancelActive(reason);
  if(userJob){userJob=null;lastState={status:reason,recommendations:[],message:'当前工况已变化，本次候选搜索已取消。'};}
  prefetchIntent=null;
  return invalidated;
 }
 function revokeMaximum(reason='STALE'){
  maxEpoch++;maxState={status:'IDLE'};
  if(maxJob&&!maxJob.cancelled){maxJob.cancelled=true;scanMetrics.cancelled++;}
  cancelReachability(reason);
 }
 // Leaving the panel does not change its baseline. Let the one signed scan
 // finish and cache it; only a real baseline/domain change cancels its work.
 const matchesMaximum=job=>!closed&&currentReady&&job.epoch===maxEpoch&&sameMaxReachabilityIdentity(job.identity,maxIdentityFor(frame(),config));
 function requestMaximum(){
  if(closed||!currentReady||!config?.sectionOpen||frame()?.result?.mode!=='formal'||maxJob)return;
  const identity=maxIdentityFor(frame(),config),key=maxReachabilityCacheKey(identity);
  if(maxRanges.has(key)){maxState={status:'COMPLETED'};return;}
  if(maxState.status==='FAILED')return;
  const job={identity,key,epoch:maxEpoch,frame:structuredClone(frame()),config:structuredClone(config)};
  maxJob=job;scanMetrics.started++;emit();
  job.promise=(async()=>{
   try{
    const evaluated=await evaluateFrame(job.frame,{...job.config,executionPath:'MAX_REACHABILITY_SCAN'},()=>matchesMaximum(job),()=>{});
    if(!matchesMaximum(job)||maxJob!==job){scanMetrics.staleResults++;return;}
    if(evaluated.run.status!=='COMPLETED'||!maxReachabilityRangeMatches(evaluated.run.max_reachable_range,job.identity,job.frame.result,job.frame.observation??job.frame.result.observation))throw Error('智能试算范围未完整计算或身份不匹配。');
    maxRanges.set(key,evaluated.run.max_reachable_range);maxState={status:'COMPLETED'};
   }catch(error){if(matchesMaximum(job)&&maxJob===job)maxState={status:'FAILED',message:error.message};}
   finally{if(maxJob===job)maxJob=null;emit();requestMaximum();}
  })();
 }
 function requestPrefetch(){
  if(closed||!currentReady||frame()?.result?.mode!=='formal'||!config.demo||!config.idle||userJob||prefetched.has(rawKeyFor(frame())))return;
  prefetchIntent={frame:structuredClone(frame()),config:structuredClone(config),identity:rawIdentityFor(frame(),config)};
  if(prefetchScheduled)return;prefetchScheduled=true;
  schedule(()=>{prefetchScheduled=false;void pumpPrefetch();});
 }
 async function pumpPrefetch(){
  if(closed||prefetchJob||userJob||!prefetchIntent)return;
  const job=prefetchIntent;prefetchIntent=null;
  const current=()=>!closed&&currentReady&&sameActionPredictionIdentity(job.identity,rawIdentityFor(frame(),config));
  if(!current()||!config.idle)return;
  prefetchJob=job;emit();
  try{
   const evaluated=await evaluateFrame(job.frame,{...job.config,executionPath:'BACKGROUND_PREFETCH'},current,()=>{});
   if(evaluated.run.status==='COMPLETED'&&evaluated.run.current_level===1&&sameActionPredictionIdentity(evaluated.run.identity,job.identity)){
     if(current())prefetched.set(rawKeyFor(frame()),{});
   }
  }catch{/* Prefetch failure never replaces foreground state. */}
  finally{if(prefetchJob===job)prefetchJob=null;emit();if(prefetchIntent)void pumpPrefetch();}
 }
 function generate(){
  if(userJob)return userJob.promise;
  if(!usable()){lastState={status:'FAILED',message:'请先完成当前有效正式预测。',recommendations:[]};emit();return Promise.resolve(null);}
  const job={epoch,identity:identityFor(frame(),config),frame:structuredClone(frame()),config:structuredClone(config),
   state:{status:'SEARCHING',current_level:1,message:'正在搜索候选方案…',recommendations:[]}};
  userJob=job;lastState=job.state;emit();
  job.promise=(async()=>{
   try{
    const evaluated=await evaluateFrame(job.frame,{...job.config,executionPath:'USER_INITIATED_SEARCH'},()=>matchesJob(job)&&userJob===job,state=>{
     if(matchesJob(job)&&userJob===job){job.state={...state,recommendations:[]};emit();}
    });
    if(!matchesJob(job)||userJob!==job)return null;
    if(evaluated.run.status==='COMPLETED'){
     if(!sameCandidateSearchIdentity(evaluated.run.identity,job.identity))throw Error('候选结果身份已变化。');
     acceptedKey=candidateSearchCacheKey(job.identity);cache.set(acceptedKey,evaluated);lastState=evaluated.run;
    }else lastState=evaluated.run;
    return evaluated.run;
   }catch(error){if(matchesJob(job)&&userJob===job)lastState={status:'FAILED',message:error.message,recommendations:[]};return null;}
   finally{if(userJob===job)userJob=null;emit();requestPrefetch();}
  })();
  return job.promise;
 }
 return {
  configure(nextFrames,nextCursor,nextConfig,ready=true){
   nextConfig={...nextConfig,target:nextConfig.target==null||nextConfig.target===''?null:nextConfig.target};
   const nextFingerprint=reportInputFingerprint({target:nextConfig.target,searchMatchTolerance:nextConfig.searchMatchTolerance??3,
    modelHash:nextConfig.modelHash,modelVersion:nextConfig.modelVersion,...candidateDomainVersions(nextConfig.modelMetadata,nextConfig.customLimits),constraintVersion:nextConfig.constraintVersion,customLimits:nextConfig.customLimits});
   const nextFrame=nextFrames[Math.max(0,Math.min(nextCursor,nextFrames.length-1))];
   const nextKey=nextFrame?frameCandidateKey(nextFrame,nextConfig):null;
   const nextMaxKey=ready&&nextFrame?maxReachabilityCacheKey(maxIdentityFor(nextFrame,nextConfig)):null;
   const sameRaw=!!config&&!!frame()&&!!nextFrame&&sameActionPredictionIdentity(rawIdentityFor(frame(),config),rawIdentityFor(nextFrame,nextConfig));
   let retry=reselectRequested&&sameRaw;
   if(configuredKey!==null&&(configuredKey!==nextKey||configFingerprint!==nextFingerprint||currentReady&&!ready)){
    const invalidated=revoke('STALE');
    retry=retry||sameRaw&&invalidated.foreground;
    lastState=invalidated.foreground?{status:'STALE',message:invalidated.running||lastState.message==='当前工况已变化，本次候选搜索已取消。'?'当前工况已变化，本次候选搜索已取消。':'当前工况已变化，原候选方案已失效。',recommendations:[]}:{status:'IDLE'};
    // A target/tolerance/range change invalidates all old selected pools.
    if(configFingerprint!==nextFingerprint){cache.clear();if(!sameRaw)prefetched.clear();}
   }
   if(configuredMaxKey!==nextMaxKey||currentReady&&!ready)revokeMaximum();
   else if(!config?.sectionOpen&&nextConfig.sectionOpen&&maxState.status==='FAILED')maxState={status:'IDLE'};
   frames=nextFrames;cursor=Math.max(0,Math.min(nextCursor,frames.length-1));config=nextConfig;currentReady=ready;
   configuredKey=nextKey;configFingerprint=nextFingerprint;configuredMaxKey=nextMaxKey;reselectRequested=false;
   if(!ready)prefetchIntent=null;
   emit();requestMaximum();
   if(retry&&nextConfig.sectionOpen&&usable()){const expected=currentKey();schedule(()=>{if(currentKey()===expected&&config?.sectionOpen&&usable())void generate();});}
   else requestPrefetch();
  },
  baselineFor(item){const stored=config&&cache.get(keyFor(item));return stored&&sameCandidateSearchIdentity(stored.run.identity,identityFor(item,config))?stored.baseline:null;},
  select(policy){if(!POLICY_LABELS[policy])throw Error('未知候选策略。');selectedPolicy=policy;emit();},
  generate,
  regenerateRevealed(){if(!selectedPolicy||!usable())return false;cache.delete(currentKey());void generate();return true;},
  accept(item,run,baseline){if(!config||!sameCandidateSearchIdentity(run.identity,identityFor(item,config)))return false;acceptedKey=keyFor(item);cache.set(acceptedKey,{run,baseline});emit();return true;},
  cancel(reason='CANCELLED'){const invalidated=revoke(reason);reselectRequested=reason==='STALE'&&invalidated.foreground;lastState=reason==='STALE'&&!invalidated.foreground?{status:'IDLE'}:{status:reason,recommendations:[],message:reason==='STALE'?(invalidated.running||lastState.message==='当前工况已变化，本次候选搜索已取消。'?'当前工况已变化，本次候选搜索已取消。':'当前工况已变化，原候选方案已失效。'):'已取消候选搜索。'};emit();},
  invalidateSelection(){reselectRequested=!!userJob||!!acceptedKey;revoke();cache.clear();lastState={status:'IDLE'};emit();},
  clear(){revoke();revokeMaximum();reselectRequested=false;cache.clear();prefetched.clear();maxRanges.clear();lastState={status:'IDLE'};emit();},
  state:projection,close(){closed=true;revoke();revokeMaximum();}
 };
}
