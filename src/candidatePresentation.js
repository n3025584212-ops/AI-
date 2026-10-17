import { SEARCH_CONFIG } from './smartCandidateConfig.js';
import { SMART19_CONFIG } from './smart19Config.js';
import { candidatePredictionMatches } from './candidatePrediction.js';

// Check Server-generated metadata; never infer actions from a field change list.
export function hasCurrentActionMetadata(plan) {
 const identity=plan?.action_metadata_identity,actions=plan?.actions,changes=plan?.changes;
 const config=identity?.search_configuration_version===SMART19_CONFIG.version?SMART19_CONFIG:SEARCH_CONFIG;
 if(!identity||identity.search_configuration_version!==config.version||!plan.search_run_id
  ||identity.search_run_id!==plan.search_run_id||identity.candidate_id!==plan.id
  ||identity.baseline_snapshot_id!==plan.baseline_snapshot_id||identity.target_snapshot_id!==plan.target_snapshot_id
  ||!Array.isArray(actions)||!actions.length||actions.length>config.maxChangedActions
  ||!Array.isArray(changes)||new Set(actions.map(a=>a.action_id)).size!==actions.length)return false;
 let total=0;const fields=[];
 for(const action of actions){
  const definition=config.actions.find(a=>a.actionId===action.action_id),delta=action.action_delta_percent;
  if(!definition||delta===0||!Number.isInteger(delta)||!config.actionLevelsPercent.includes(delta)||Math.abs(delta)>(config.levels.find(item=>item.level===plan.search_level)?.maxPercent??15)
   ||JSON.stringify(action.affected_fields)!==JSON.stringify(definition.affectedFields)
   ||!action.derived_field_values||Object.keys(action.derived_field_values).length!==definition.affectedFields.length)return false;
  total+=Math.abs(delta);
  for(const key of definition.affectedFields){
   const change=changes.find(c=>c.feature_key===key);
   if(!change||!Number.isFinite(change.before)||change.before===0||!Number.isFinite(change.after)
    ||change.relative_change_percent!==delta||change.after!==change.before*(1+delta/100)
    ||action.derived_field_values[key]!==change.after)return false;
   fields.push(key);
  }
 }
 return changes.length===fields.length&&new Set(changes.map(c=>c.feature_key)).size===fields.length
  &&plan.changed_action_count===actions.length&&plan.changed_field_count===fields.length
  &&plan.total_relative_change===total&&plan.total_relative_change_action_based===total
  &&plan.total_relative_change_method===config.totalRelativeChangeMethod;
}

// Display projection for the two existing creation paths. The user factory
// already records candidate_source; accepted optimize results are built-in.
// This does not add fields to registered Candidates or signed snapshots.
export const candidateDisplaySource = plan => plan?.candidate_source==='USER_SPECIFIED_TRIAL' ? 'USER_SPECIFIED_TRIAL' : 'BUILT_IN_CANDIDATE_SEARCH';
export const candidateExplanationKey = plan => plan?.id && plan?.baseline_snapshot_id && plan?.target_snapshot_id
  ? JSON.stringify([candidateDisplaySource(plan),plan.id,plan.baseline_snapshot_id,plan.target_snapshot_id,...(plan.candidate_source==='SMART_SEARCH'?[plan.search_run_id]:[])]) : null;
export const mergeCandidateSources = (existing,incoming,source) => [...existing.filter(plan=>candidateDisplaySource(plan)!==source),...incoming];
export const candidateSourceLabel = plan => candidateDisplaySource(plan)==='USER_SPECIFIED_TRIAL' ? '用户指定' : `AI智能搜索 · ${plan.title}`;
export const SEARCH_LABELS = Object.freeze({MIN_ADJUSTMENT:'调参最少',BALANCED:'折中',TARGET_PRIORITY:'最优'});
export const SEARCH_DESCRIPTIONS = Object.freeze({MIN_ADJUSTMENT:'调整项数最少',BALANCED:'Pareto 前沿 · 归一化理想点距离',TARGET_PRIORITY:'距离目标最近 · 调整较少'});
export const candidateRecommendationLabels = plan => (plan?.recommendation_labels || []).map(label=>SEARCH_LABELS[label]).filter(Boolean);
export const candidateABReady = (plan,draft,valid) => plan?.candidate_source==='SMART_SEARCH'
  ? Boolean(valid && hasCurrentActionMetadata(plan) && [SMART19_CONFIG.version,SEARCH_CONFIG.version].includes(plan.search_identity?.search_configuration_version)
    && plan.status==='A/B_READY' && plan.search_run_id && plan.search_identity?.baseline_snapshot_id===plan.baseline_snapshot_id
    && plan.candidate_prediction?.mode==='formal' && plan.candidate_prediction.receipt
    && plan.candidate_prediction.model_hash===plan.model_hash && plan.candidate_prediction.model_version===plan.model_version
    && candidatePredictionMatches(plan) && (Number.isFinite(plan.candidate_target_gap)||plan.target_s5===null&&plan.candidate_target_gap===null))
  : Boolean(valid && plan && draft?.status==='PREDICTED'
  && draft.source_plan_id===plan.id && draft.candidate_preview_snapshot_id===plan.target_snapshot_id
  && draft.baseline_snapshot_id===plan.baseline_snapshot_id && draft.prediction?.mode==='formal'
  && draft.prediction.model_hash===plan.model_hash && draft.prediction.model_version===plan.model_version);
