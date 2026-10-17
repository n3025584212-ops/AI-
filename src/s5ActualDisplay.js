import { reportInputFingerprint, engineeringContextForRequest } from './predictionSnapshot.js';
import { productDisplayText } from './productBrand.js';
import { modelInputFingerprint } from './modelInputs.js';

// Read-only display projection. Never synthesize a measurement from a target,
// prediction, previous record, or the generated demo channel.
export function recordActualValue(record = {}) {
  const input = record.input || record;
  const provenance = input.importProvenance || record.importProvenance;
  if (record.originMode === 'demo' || record.mode === 'demo' || provenance?.source_type === 'DEMO'
    || record.source_type === 'DEMO' || record.observedAvailable === false || provenance?.observedAvailable === false) return null;
  const explicit = provenance && (Object.hasOwn(provenance, 'observed') || Object.hasOwn(provenance, 'observedAvailable'));
  const value = explicit ? provenance.observed : Object.hasOwn(record, 'observed') ? record.observed
    : input.stands?.find(stand => stand.id === 'S5')?.force;
  return Number.isFinite(value) ? value : null;
}

export function currentActualValue({ caseData, result, resultSample, dirty = false, observationMatches = true }) {
  if (dirty || !observationMatches) return null;
  if (caseData?.importProvenance?.observedAvailable === false || resultSample?.observedAvailable === false
    || caseData?.importProvenance?.source_type === 'DEMO' || resultSample?.source_type === 'DEMO') return null;
  const observation = resultSample?.observation || result?.observation;
  const input = result?.inputContext;
  if (input && caseData && (input.id !== caseData.id || modelInputFingerprint(input) !== modelInputFingerprint(caseData)
    || reportInputFingerprint(engineeringContextForRequest(input)) !== reportInputFingerprint(engineeringContextForRequest(caseData)))) return null;
  if (observation) {
    if (!result?.snapshot_id || observation.snapshot_id !== result.snapshot_id || observation.input_hash !== result.input_hash
      || !observation.receipt || resultSample?.observation_id && resultSample.observation_id !== observation.observation_id) return null;
    return Number.isFinite(observation.value) ? observation.value : null;
  }
  // Unbound read-only fixtures/records use only the supplied current record.
  if (result?.snapshot_id) return null;
  return recordActualValue(resultSample || caseData);
}

export function trendActualValue(frame) {
  if (frame?.observedAvailable === false || frame?.originMode === 'demo' || frame?.mode === 'demo') return null;
  const observation = frame?.result?.observation;
  if (!observation) return frame?.result?.snapshot_id ? null : recordActualValue(frame);
  return currentActualValue({ caseData: frame.input, result: frame.result,
    resultSample: { observation, observation_id: observation.observation_id } });
}

export function trendActualAvailability(frames, sourceId) {
  const validActualPointCount = (frames || []).filter(frame => trendActualValue(frame) !== null).length;
  return { sourceId, validActualPointCount, available: validActualPointCount > 0 };
}

// Observation-only appends can retain the prediction snapshot. Reflect its
// newly accepted measurement in the matching chart row without rewriting the
// recorded frame or manufacturing a prediction/observation identity.
export function projectCurrentTrendActual(frames, current) {
  const { result, resultSample, caseData, dirty, observationMatches } = current;
  const observation = resultSample?.observation || result?.observation;
  if (dirty || observationMatches === false || !result?.snapshot_id || observation?.snapshot_id !== result.snapshot_id
    || observation.input_hash !== result.input_hash || !observation.receipt) return frames;
  const actual = currentActualValue(current);
  return frames.map(frame => frame.result?.snapshot_id === result.snapshot_id && frame.input?.id === caseData?.id
    ? { ...frame, input: caseData, observed: actual, observedAvailable: actual !== null,
      result: { ...frame.result, observation } } : frame);
}

// Frozen records and internal OBSERVATION identifiers stay unchanged. Apply
// terminology only at ordinary display/prompt boundaries, never to signed data.
export function actualDisplayText(text) {
  if (typeof text !== 'string') return text;
  return productDisplayText(text).replace(/(?:演示|历史|独立)\s*(S5\s*)?(?:观测值|实测值|观测|实测)/g, (_, stand) => (stand || '') + '实际值')
    .replace(/演示值|样本实测|实测值|观测值|观测|实测/g, '实际值')
    .replace(/实际值系统/g, '测量系统').replace(/实际值设备/g, '测量设备')
    .replace(/实际值源管理/g, '实际值来源管理').replace(/实际值缺失/g, '未提供实际值');
}

export function findingDisplayTitle(finding) {
  return ({ S5_PREDICTION_OBSERVATION_DIFFERENCE: 'S5预测与实际值差异',
    S5_OBSERVATION_MISSING: '当前工况未提供S5实际值' })[finding?.kind] || actualDisplayText(finding?.title);
}
