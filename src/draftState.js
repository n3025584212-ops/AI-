import { modelInputValues, FEATURE_KEYS, MODEL_FEATURES } from './modelInputs.js';
import { engineeringContextForRequest, reportInputFingerprint, freezeReportPayload, assertPredictionBinding, assertObservationBinding } from './predictionSnapshot.js';
import { candidateABReady } from './candidatePresentation.js';

const equal = (a, b) => reportInputFingerprint(a) === reportInputFingerprint(b);
const fail = (message, code = 'PLAN_STALE') => { const error = new Error(message); error.code = code; throw error; };
export const DRAFT_SOURCE_TYPE = 'HYPOTHETICAL_DRAFT';
export const DRAFT_STATUSES = Object.freeze(['LOADED', 'PREDICTING', 'PREDICTED', 'BASELINE_STALE', 'PROMOTED', 'DISCARDED']);

export function draftBaselineIdentity(prediction) {
  return { snapshot_id: prediction?.snapshot_id, input_hash: prediction?.input_hash,
    model_hash: prediction?.model_hash, model_version: prediction?.model_version,
    prediction_mode: prediction?.mode, contextFingerprint: reportInputFingerprint(prediction?.inputContext) };
}

// Observations and transport revisions can advance while the condition stays A.
export function validateDraftBaseline(draft, binding, { requireValid = true } = {}) {
  if (!draft || !draft.baseline_identity || (requireValid && !binding?.valid)) return false;
  return ['snapshot_id', 'input_hash', 'model_hash', 'model_version', 'prediction_mode', 'contextFingerprint']
    .every(key => draft.baseline_identity[key] === binding?.[key]);
}

export function validateDraftCandidate(plan, prediction, snapshot, binding) {
  if (!binding?.valid || prediction?.mode !== 'formal' || plan?.mode !== 'formal') fail('PLAN_STALE：仅当前有效正式候选可载入草案。');
  try { assertPredictionBinding(prediction, prediction.inputContext, { input_snapshot: snapshot, mode: 'formal' }); }
  catch { fail('PLAN_STALE：当前冻结预测绑定不一致。'); }
  const identity = draftBaselineIdentity(prediction);
  if (!validateDraftBaseline({ baseline_identity: identity }, binding)
    || plan.baseline_snapshot_id !== snapshot.snapshot_id || plan.parent_snapshot_id !== snapshot.snapshot_id
    || plan.model_hash !== prediction.model_hash || plan.model_version !== prediction.model_version
    || plan.mode !== prediction.mode) fail('PLAN_STALE：候选与当前基线或模型不一致。');
  const preview = plan.input_snapshot;
  if (!preview?.snapshot_id || !plan.id || preview.snapshot_id !== plan.target_snapshot_id || preview.snapshot_id === snapshot.snapshot_id
    || preview.schema_version !== snapshot.schema_version || preview.target !== snapshot.target
    || preview.model_hash !== prediction.model_hash || preview.model_version !== prediction.model_version
    || !equal(preview.feature_keys, FEATURE_KEYS) || !Array.isArray(plan.changes) || !plan.changes.length) fail('PLAN_STALE：候选预览身份不一致。');
  const input = structuredClone(prediction.inputContext), seen = new Set();
  for (const change of plan.changes) {
    const feature=MODEL_FEATURES.find(item=>item.stand===change.stand&&item.field===change.field);
    const stand = feature?.stand ? input.stands.find(item => item.id === feature.stand) : feature ? input : null, key = `${change.stand}.${change.field}`;
    if (!stand || !feature
      || !Number.isFinite(change.before) || !Number.isFinite(change.after) || stand[change.field] !== change.before
      || seen.has(key) || change.after === change.before) fail('PLAN_STALE：候选调整前值或字段不一致。');
    seen.add(key); stand[change.field] = change.after;
  }
  const values = modelInputValues(input);
  if (!equal(preview.values, values) || !equal(preview.canonical_25, Object.fromEntries(FEATURE_KEYS.map((key, index) => [key, values[index]])))
    || !equal(preview.engineering_context, engineeringContextForRequest(input))) fail('PLAN_STALE：候选输入或工程上下文不一致。');
  return input;
}

export function createDraft(plan, prediction, snapshot, binding, { draftId = globalThis.crypto.randomUUID(), createdAt = new Date().toISOString() } = {}) {
  const input = validateDraftCandidate(plan, prediction, snapshot, binding);
  input.engineering_context = engineeringContextForRequest(input);
  // The hypothetical input retains process parameters, never A's S5 label.
  for (const key of ['observation', 'observed', 'observedAvailable', 'observedSource', 'measured', 'isMeasured']) delete input[key];
  const s5 = input.stands.find(stand => stand.id === 'S5');
  s5.force = null;
  for (const key of ['observation', 'observed', 'actual', 'measured', 'isMeasured', 'observedSource', 'observedAvailable']) delete s5[key];
  input.importProvenance = { source_type: DRAFT_SOURCE_TYPE, sourceName: '工况草案', sample_timestamp: null,
    observed: null, observedAvailable: false, observedSource: '草案尚无实际观测' };
  return freezeReportPayload({ draft_id: draftId, source_plan_id: plan.id, baseline_snapshot_id: snapshot.snapshot_id,
    candidate_preview_snapshot_id: plan.target_snapshot_id, created_at: createdAt, input, status: 'LOADED',
    prediction: null, snapshot: null, source_mode: 'formal', changes: plan.changes,
    ...(plan.candidate_source === 'SMART_SEARCH' && candidateABReady(plan, null, true)
      ? { verified_candidate_prediction: plan.candidate_prediction } : {}),
    baseline_identity: draftBaselineIdentity(prediction), baseline_prediction: prediction, error: null });
}

export function acceptDraftPrediction(draft, prediction) {
  if (draft?.status !== 'PREDICTING') fail('草案请求已失效。', 'DRAFT_STALE');
  assertPredictionBinding(prediction, draft.input, { mode: 'formal', model_hash: draft.baseline_identity.model_hash, model_version: draft.baseline_identity.model_version });
  assertObservationBinding(prediction.observation, prediction.input_snapshot);
  const verifiedReuse = draft.verified_candidate_prediction
    && equal(prediction, draft.verified_candidate_prediction)
    && prediction.snapshot_id === draft.candidate_preview_snapshot_id;
  if (prediction.snapshot_id === draft.baseline_snapshot_id || prediction.snapshot_id === draft.candidate_preview_snapshot_id && !verifiedReuse
    || prediction.input_snapshot.source_type !== DRAFT_SOURCE_TYPE
    || prediction.observation.value !== null || prediction.observation.quality !== 'missing') fail('草案预测须为新的正式快照，且没有基线实际值。', 'DRAFT_IDENTITY_MISMATCH');
  return freezeReportPayload({ ...draft, prediction, snapshot: prediction.input_snapshot, status: 'PREDICTED', error: null });
}

export function promotionRetry(draft, binding) {
  if (draft?.status !== 'PREDICTED' || !validateDraftBaseline(draft, binding)) fail('草案或基线已失效，禁止采用。', 'DRAFT_STALE');
  const accepted = acceptDraftPrediction({ ...draft, status: 'PREDICTING' }, draft.prediction);
  if (!equal(accepted.snapshot, draft.snapshot)) fail('草案快照不一致。', 'DRAFT_IDENTITY_MISMATCH');
  return freezeReportPayload({ input_snapshot: draft.snapshot, prediction: draft.prediction, observation: draft.prediction.observation, draft_id: draft.draft_id });
}

export function promotedDraft(draft, prediction, promotedAt = new Date().toISOString()) {
  if (prediction.snapshot_id !== draft.prediction?.snapshot_id || !equal(prediction.input_snapshot, draft.snapshot)
    || !equal(prediction.observation, draft.prediction.observation)) fail('采用过程不得产生第三个快照或替换实际值。', 'DRAFT_IDENTITY_MISMATCH');
  return freezeReportPayload({ ...draft, status: 'PROMOTED', promotion: { draft_id: draft.draft_id, source_plan_id: draft.source_plan_id,
    baseline_snapshot_id: draft.baseline_snapshot_id, candidate_preview_snapshot_id: draft.candidate_preview_snapshot_id,
    promoted_snapshot_id: prediction.snapshot_id, promoted_at: promotedAt } });
}

export const discardedDraft = draft => draft ? freezeReportPayload({ ...draft, status: 'DISCARDED' }) : null;
