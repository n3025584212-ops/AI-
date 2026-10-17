// Candidate eligibility always uses the frozen DK-QKAR output. Alarm settings
// belong to runtime monitoring and must not participate in this module.
import { reportInputFingerprint } from './predictionSnapshot.js';
import { SEARCH_CONFIG } from './smartCandidateConfig.js';
import { SMART19_CONFIG,RANGE19_PROTOCOL } from './smart19Config.js';
import { FORMAL_INPUT_RANGE_AUDIT } from './formalInputRanges.js';
import { currentModelReferenceRanges } from './inputRangeDefaults.js';
export const CANDIDATE_EVALUATION_VERSION = 'actual-anchored-delta-v2';
export const ACTION_PREDICTION_IDENTITY_FIELDS = Object.freeze(['datasetIdentity','frameId','snapshotId','input25Hash','modelIdentity','modelHash','candidateConfigVersion','modelInputDomainVersion','formalHardLimitVersion']);
export const PROJECTION_IDENTITY_FIELDS = Object.freeze([...ACTION_PREDICTION_IDENTITY_FIELDS,'actualIdentity']);
export const STALE_CHECK_FIELDS = Object.freeze([...PROJECTION_IDENTITY_FIELDS,'targetIdentity','targetValue','searchMatchTolerance']);
export const SELECTED_PLAN_IDENTITY_FIELDS = STALE_CHECK_FIELDS;
export const MAX_REACHABILITY_IDENTITY_FIELDS = Object.freeze([...ACTION_PREDICTION_IDENTITY_FIELDS,'baselineSnapshotId','rangeAlgorithmVersion','rangeBankHash','rangeBankBudget']);
export function candidateDomainVersions(metadata={},customLimits={}) {
 return {modelInputDomainVersion:reportInputFingerprint({ranges:currentModelReferenceRanges(customLimits),
  units:metadata.feature_schema?.map(field=>[field.key,field.unit,field.unit_status])??null}),
  formalHardLimitVersion:reportInputFingerprint(Object.entries(FORMAL_INPUT_RANGE_AUDIT).filter(([,limit])=>limit.mapping_status==='CONFIRMED')
   .map(([key,limit])=>[key,limit.lower,limit.upper,limit.unit,limit.document.sha256]))};
}
export function candidateActionIdentity(input,prediction,{modelMetadata={},customLimits={}}={}) {
 const provenance=prediction?.inputContext?.importProvenance||input?.importProvenance||{},snapshot=prediction?.input_snapshot;
 const datasetIdentity=reportInputFingerprint({dataset:provenance.dataset_id??snapshot?.stream_id??provenance.stream_id??'SINGLE_CONDITION',
  version:provenance.dataset_version??provenance.stream_id??snapshot?.stream_id??'SINGLE_CONDITION'});
 const frameId=snapshot?.sample_id||provenance.sample_id||input?.id||'NO_FRAME',input25Hash=prediction?.input_hash??'NO_INPUT_HASH';
 // Candidate eligibility uses the condition's business identity. The signed
 // prediction snapshot UUID remains untouched for receipt/A-B verification.
 const snapshotId=reportInputFingerprint({datasetIdentity,frameId,input25Hash,inputVersion:snapshot?.input_version??provenance.input_version??0});
 return {datasetIdentity,frameId,snapshotId,input25Hash,
  modelIdentity:prediction?.model_version??'NO_MODEL',modelHash:prediction?.model_hash??'NO_MODEL_HASH',
  candidateConfigVersion:SMART19_CONFIG.version,...candidateDomainVersions(modelMetadata,customLimits)};
}
const identityMatches=(a,b,fields)=>!!a&&!!b&&fields.every(key=>a[key]!==undefined&&a[key]===b[key]&&(typeof a[key]==='string'||typeof a[key]==='number'));
export const actionPredictionCacheKey=identity=>JSON.stringify(ACTION_PREDICTION_IDENTITY_FIELDS.map(key=>identity[key]));
export const maxReachabilityCacheKey=identity=>JSON.stringify(MAX_REACHABILITY_IDENTITY_FIELDS.map(key=>identity[key]));
export const sameActionPredictionIdentity=(a,b)=>identityMatches(a,b,ACTION_PREDICTION_IDENTITY_FIELDS);
export const sameMaxReachabilityIdentity=(a,b)=>identityMatches(a,b,MAX_REACHABILITY_IDENTITY_FIELDS);
export function maxReachabilityIdentity(input,prediction,{modelMetadata={},customLimits={}}={}) {
 // A committed snapshot owns its model trials. Request receipts, Target and
 // Actual do not define a new baseline or a different model envelope.
 return {...candidateActionIdentity(input,prediction,{modelMetadata,customLimits}),baselineSnapshotId:prediction?.snapshot_id??'NO_SNAPSHOT',
  rangeAlgorithmVersion:RANGE19_PROTOCOL.version,rangeBankHash:RANGE19_PROTOCOL.bankHash,rangeBankBudget:RANGE19_PROTOCOL.bankBudget};
}
export function maxReachabilityBaselineIsCurrent(identity,current) {
 return !!current?.valid&&current.prediction_mode==='formal'
  &&identity?.baselineSnapshotId===current.snapshot_id&&identity?.input25Hash===current.input_hash
  &&identity?.modelHash===current.model_hash&&identity?.modelIdentity===current.model_version
  &&identity?.operation_scope?.session_id===current.operation_scope?.session_id;
}
export function maxReachabilityRangeMatches(range,identity,prediction) {
 if(range?.scope!=='MAX_REACHABILITY'||range.completed_level!==3||range.max_adjustment_percent!==15
  ||!sameMaxReachabilityIdentity(range.identity,identity)||!Number.isInteger(range.candidate_count)||range.candidate_count<1
  ||range.baseline_reference_count!==1||identity.baselineSnapshotId!==prediction?.snapshot_id
  ||identity.input25Hash!==prediction?.input_hash||identity.modelHash!==prediction?.model_hash||identity.modelIdentity!==prediction?.model_version)return false;
 const fields=['estimated_min','estimated_max','delta_min','delta_max'];
 if(!fields.every(key=>Number.isFinite(range[key]))||range.estimated_min>range.estimated_max||range.delta_min>range.delta_max)return false;
 const anchor=prediction?.value;
 return Number.isFinite(anchor)&&range.estimated_min<=anchor&&anchor<=range.estimated_max&&range.delta_min<=0&&range.delta_max>=0
  &&Math.abs(range.estimated_min-(anchor+range.delta_min))<1e-9
  &&Math.abs(range.estimated_max-(anchor+range.delta_max))<1e-9;
}
export function targetWithinMaxReachability(target,range) {
 return range?.scope==='MAX_REACHABILITY'&&range.completed_level===3&&range.candidate_count>0&&Number.isFinite(target)
  &&Number.isFinite(range.estimated_min)&&Number.isFinite(range.estimated_max)?target>=range.estimated_min&&target<=range.estimated_max:null;
}
export function matchedCandidateActual(prediction,observation=prediction?.observation) {
 return observation?.snapshot_id===prediction?.snapshot_id&&observation?.input_hash===prediction?.input_hash
  &&!!observation?.receipt&&Number.isFinite(observation?.value)?observation:null;
}
export function candidateSearchIdentity(input,prediction,{observation=prediction?.observation,targetValue=input?.target,searchMatchTolerance=3,modelMetadata={},customLimits={}}={}) {
 const actual=matchedCandidateActual(prediction,observation);
 const action=candidateActionIdentity(input,prediction,{modelMetadata,customLimits});
 return {...action,
  actualIdentity:actual?reportInputFingerprint({id:actual.observation_id,snapshot:actual.snapshot_id,hash:actual.input_hash,value:actual.value,receipt:actual.receipt}):'NO_ACTUAL',
  targetIdentity:reportInputFingerprint({datasetIdentity:action.datasetIdentity,frameId:action.frameId,snapshotId:action.snapshotId,targetValue}),targetValue,searchMatchTolerance};
}
export const sameProjectionIdentity=(a,b)=>identityMatches(a,b,PROJECTION_IDENTITY_FIELDS);
export const sameSelectedPlanIdentity=(a,b)=>!!a&&!!b&&SELECTED_PLAN_IDENTITY_FIELDS.every(key=>
 a[key]!==undefined&&a[key]===b[key]&&(typeof a[key]==='string'||typeof a[key]==='number'||key==='targetValue'&&a[key]===null));
export const sameCandidateSearchIdentity = (a,b) => !!a&&!!b&&STALE_CHECK_FIELDS.every(key=>
 a[key]!==undefined&&a[key]===b[key]&&(typeof a[key]==='string'||typeof a[key]==='number'||key==='targetValue'&&a[key]===null));
export const candidateSearchCacheKey = identity => JSON.stringify(STALE_CHECK_FIELDS.map(key=>identity[key]));
export function candidateReachableRangeMatches(range,identity,prediction,observation=prediction?.observation){
 const level=SEARCH_CONFIG.levels.find(item=>item.level===range?.completed_level);
 if(!level||range.max_adjustment_percent!==level.maxPercent||!sameCandidateSearchIdentity(range.identity,identity)
  ||!Number.isInteger(range.candidate_count)||range.candidate_count<0)return false;
 const values=['estimated_min','estimated_max','delta_min','delta_max'];
 if(range.candidate_count===0)return values.every(key=>range[key]===null);
 if(!values.every(key=>Number.isFinite(range[key]))||range.estimated_min>range.estimated_max||range.delta_min>range.delta_max)return false;
 const anchor=matchedCandidateActual(prediction,observation)?.value??prediction?.value;
 return Number.isFinite(anchor)&&Math.abs(range.estimated_min-(anchor+range.delta_min))<1e-9
  &&Math.abs(range.estimated_max-(anchor+range.delta_max))<1e-9;
}
export function candidatePredictionMatches(plan) {
  const raw = plan?.candidateRawPrediction ?? plan?.predictedValue;
  return Number.isFinite(raw) && raw === plan?.predictedValue && raw === plan?.candidate_prediction?.value
    && (plan.predictionErrorAdjustment ?? 0) === 0 && !Object.hasOwn(plan, 'candidateEvaluationValue')
    && (!plan.evaluation_version || plan.evaluation_version === CANDIDATE_EVALUATION_VERSION)
    && (!plan.search_identity?.evaluation_version || plan.search_identity.evaluation_version === CANDIDATE_EVALUATION_VERSION)
    && (plan.evaluation_version!==CANDIDATE_EVALUATION_VERSION || (
      Number.isFinite(plan.baseline_prediction)&&Number.isFinite(plan.estimated_candidate_s5)
      && Math.abs(plan.model_response_delta-(raw-plan.baseline_prediction))<1e-9
      && Math.abs(plan.estimated_candidate_s5-(plan.actual_anchored_mode?plan.actual_s5+plan.model_response_delta:raw))<1e-9
      && (plan.target_s5===null ? plan.estimated_target_gap===null&&plan.target_distance===null&&plan.candidate_target_gap===null :
        Number.isFinite(plan.target_s5)&&Number.isFinite(plan.target_distance)
        && Math.abs(plan.estimated_target_gap-(plan.estimated_candidate_s5-plan.target_s5))<1e-9
        && Math.abs(plan.target_distance-Math.abs(plan.estimated_target_gap))<1e-9)));
}
