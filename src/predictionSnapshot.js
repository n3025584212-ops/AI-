import { modelInputValues, FEATURE_KEYS } from './modelInputs.js';
export const SAMPLE_SOURCE_TYPES = Object.freeze({ demo: 'DEMO', import: 'CSV_REPLAY', manual: 'MANUAL', draft: 'HYPOTHETICAL_DRAFT', plc:'PLC_REALTIME' });

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const reportInputFingerprint = value => JSON.stringify(canonical(value));
export const deepFreeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
export const freezeReportPayload = payload => deepFreeze(structuredClone(payload));
export function engineeringContextForRequest(input) {
  const raw = input.engineering_context?.s4_rolling_force || { value: input.importProvenance?.source_type === 'DEMO' ? null : input.stands?.find(stand => stand.id === 'S4')?.force ?? null };
  const value = raw.value ?? null;
  return { s4_rolling_force: { value: Object.is(value, -0) ? 0 : value, unit: raw.unit ?? null, source: raw.source ?? 'unknown', timestamp: raw.timestamp ? new Date(raw.timestamp).toISOString() : null, quality: raw.quality ?? (value === null ? 'missing' : 'unknown') } };
}
export function predictionIdentity(prediction, observation = prediction?.observation) {
  return { snapshot_id: prediction?.snapshot_id ?? null, input_hash: prediction?.input_hash ?? null,
    model_hash: prediction?.model_hash ?? null, model_version: prediction?.model_version ?? null,
    prediction_mode: prediction?.mode ?? null, observation_id: observation?.observation_id ?? null };
}
export function sameIdentity(a, b) {
  return Boolean(a?.snapshot_id && b?.snapshot_id) && ['snapshot_id','input_hash','model_hash','model_version','prediction_mode','observation_id'].every(key => a[key] === b[key]);
}
export function currentRunMatches(run, current, diagnostics) {
  return Boolean(current?.valid && sameIdentity(run, current) && run.contextFingerprint === current.contextFingerprint
    && run.operation_scope?.revision === current.operation_scope?.revision
    && run.operation_scope?.session_id === current.operation_scope?.session_id
    && (run.answer_variant !== 'AI_EXPLAIN' || diagnostics === undefined
      || diagnostics?.status === 'VALID' && diagnostics.findings.some(finding=>finding.status === 'VALID'
        && finding.finding_id === run.diagnostic_finding_id && finding.receipt === run.diagnostic_finding_receipt)));
}
export function assertPredictionBinding(prediction, input, { input_snapshot, mode, model_hash, model_version } = {}) {
  const snapshot = prediction?.input_snapshot;
  const equal = (a,b) => reportInputFingerprint(a) === reportInputFingerprint(b);
  if (!snapshot?.snapshot_id || prediction.snapshot_id !== snapshot.snapshot_id || prediction.input_hash !== snapshot.input_hash
    || prediction.model_hash !== snapshot.model_hash || prediction.model_version !== snapshot.model_version
    || !equal(snapshot.feature_keys, FEATURE_KEYS) || !equal(snapshot.values, modelInputValues(input))
    || !equal(snapshot.canonical_25, Object.fromEntries(FEATURE_KEYS.map((key,index) => [key,snapshot.values[index]])))
    || !equal(snapshot.engineering_context, engineeringContextForRequest(input))
    || !equal(prediction.inputContext, input) || !prediction.receipt
    || (input_snapshot && !equal(snapshot,input_snapshot)) || (mode === 'formal' && prediction.mode !== 'formal')
    || (model_hash && model_hash !== prediction.model_hash) || (model_version && model_version !== prediction.model_version)
    || (prediction.mode === 'demo' && (prediction.model_hash !== null || prediction.model_version !== 'demo-linear-v1'))) throw new Error('预测与冻结请求、上下文或模型身份不一致');
  if (prediction.observation) assertObservationBinding(prediction.observation, snapshot);
  return prediction;
}
export function assertObservationBinding(observation, snapshot) {
  if (!observation?.observation_id || observation.snapshot_id !== snapshot?.snapshot_id || observation.input_hash !== snapshot.input_hash || !observation.receipt) throw new Error('实际值与快照身份不一致');
  return observation;
}
export async function verifyPredictionHashes(prediction) {
  const snapshot = prediction.input_snapshot;
  const hash = async value => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
  if (snapshot.input_hash !== await hash([snapshot.schema_version,snapshot.values])
    || snapshot.context_hash !== await hash(['dkqkar-engineering-context-v1',snapshot.engineering_context])) throw new Error('快照 hash 不一致');
}
export function rejectPlanApplication() { throw new Error('R2 候选方案只读，禁止应用或回填工况'); }
const SOURCE_MODES = Object.freeze({ DEMO: 'demo', CSV_REPLAY: 'import', MANUAL: 'manual', PUBLIC_DATA: 'manual', HYPOTHETICAL_DRAFT: 'manual',PLC_REALTIME:'plc' });
const SOURCE_LABELS = Object.freeze({ DEMO: '演示工况', CSV_REPLAY: 'CSV 文件工况', MANUAL: '手动工况', PUBLIC_DATA: '公开 CRD 数据样本', HYPOTHETICAL_DRAFT: '工况草案',PLC_REALTIME:'现场PLC实时工况', UNKNOWN: '来源未提供' });
const sourceDetails = evidence => Object.fromEntries(['sourceName','source_url','display_geometry_note','target_source'].filter(key => typeof evidence?.[key] === 'string').map(key => [key, evidence[key]]));
const validDate = value => {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

// Manual recalculation of an imported snapshot keeps its explicit provenance.
// Verified public-data replay keeps the same raw-row provenance too.
// Generated/demo and CSV frames supply their own observation channel instead.
export function resultSampleMetadata(frame) {
  const imported = (frame?.mode === 'manual' || frame?.mode==='plc' || frame?.historicalReplay === true) && frame?.input?.importProvenance;
  const evidence = imported || frame;
  const observed = evidence?.observedAvailable === false || !Number.isFinite(evidence?.observed) ? null : evidence.observed;
  const source = imported ? imported.source_type : frame?.originMode === 'demo' ? 'DEMO' : SAMPLE_SOURCE_TYPES[frame?.mode];
  return Object.freeze({
    source_type: Object.hasOwn(SOURCE_LABELS, source) ? source : 'UNKNOWN',
    transport: SAMPLE_SOURCE_TYPES[frame?.mode] || 'UNKNOWN',
    sample_timestamp: validDate(imported ? imported.sample_timestamp : frame?.timestamp ?? frame?.time),
    observed, observedAvailable: observed !== null,
    observedSource: typeof evidence?.observedSource === 'string' ? evidence.observedSource : '', ...sourceDetails(evidence),
  });
}

// The accepted observation owns its source and time; sample time stays separate.
export function withAcceptedObservation(sample, observation) {
  return freezeReportPayload({ ...sample, observed: observation.value,
    observedAvailable: observation.value !== null, observedSource: observation.source,
    observation_id: observation.observation_id, observation });
}

// Measurements belong to one set of model inputs. Changing those inputs clears
// the observation unless the same edit explicitly supplies a new S5 measurement.
// Target/labels/display-only edits retain the matched measurement.
export function withEditedSample(previous, next, previousSample, editedAt = Date.now()) {
  if (next === previous) return previous;
  const oldForce = previous?.stands?.find(stand => stand.id === 'S5')?.force;
  const force = next?.stands?.find(stand => stand.id === 'S5')?.force;
  const evidence = previous?.importProvenance || previousSample;
  const changedForce = force !== oldForce;
  const changedInputs = modelInputFingerprint(previous) !== modelInputFingerprint(next);
  const observed = changedForce ? Number.isFinite(force) ? force : null
    : changedInputs || evidence?.observedAvailable === false || !Number.isFinite(evidence?.observed) ? null : evidence.observed;
  return { ...next, importProvenance: {
    ...sourceDetails(evidence), source_type: evidence?.source_type === 'DEMO' && !changedForce ? 'DEMO' : 'MANUAL', transport: 'MANUAL', sample_timestamp: validDate(editedAt), observed,
    observedAvailable: observed !== null,
    observedSource: changedForce ? observed === null ? '尚未填写 S5 实际值' : '手动输入 S5.force' : changedInputs ? '模型输入已改变，当前工况尚无匹配实测值' : evidence?.observedSource || '未提供对应实际值',
  } };
}

export function assistantSampleContext(sample) {
  const source_type = Object.hasOwn(SOURCE_LABELS, sample?.source_type) ? sample.source_type : 'UNKNOWN';
  const observed = sample?.observedAvailable === false || !Number.isFinite(sample?.observed) ? null : sample.observed;
  return { source_type, transport: sample?.transport || source_type, dataMode: SOURCE_MODES[source_type] || 'unknown', dataSource: SOURCE_LABELS[source_type],
    sampleTime: validDate(sample?.sample_timestamp), observed, observedAvailable: observed !== null,
    observedSource: sample?.observedSource || '未提供对应实际值' };
}

export function completedPredictionValues(result, resultCase, resultSample) {
  const value = Number.isFinite(result?.value) ? result.value : null;
  const target = Number.isFinite(resultCase?.target) ? resultCase.target : Number.isFinite(result?.target) ? result.target : null;
  const evidence = resultSample ?? result;
  const observed = evidence?.observedAvailable === false || !Number.isFinite(evidence?.observed) ? null : evidence.observed;
  const delta = value !== null && target !== null ? value - target : null;
  return { value, target, observed, delta, percent: delta !== null && target !== 0 ? delta / target * 100 : null };
}
import { modelInputFingerprint } from './modelInputs.js';
