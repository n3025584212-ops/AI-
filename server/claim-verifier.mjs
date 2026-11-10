import { unitFor } from '../src/engineeringUnits.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const issue = (code, message, claim) => ({ code, message, claim_id: claim?.id || null });
const own = (value, key) => value !== null && typeof value === 'object' && Object.hasOwn(value, key);
const getResult = (results, ref) => results instanceof Map ? results.get(ref) : own(results, ref) ? results[ref] : undefined;
const goodStatuses = new Set(['verified', 'success', 'completed', 'VERIFIED', 'VALID', 'READY']);

/** Resolve an RFC 6901 pointer without inherited/prototype traversal. */
export function resolveFactPointer(value, pointer) {
  if (pointer === '') return { found: true, value };
  if (typeof pointer !== 'string' || !pointer.startsWith('/') || /~(?![01])/u.test(pointer)) return { found: false };
  for (const part of pointer.slice(1).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (['__proto__', 'prototype', 'constructor'].includes(key) || !own(value, key)) return { found: false };
    value = value[key];
  }
  return { found: true, value };
}
function identity(result) {
  const data = object(result?.data) ? result.data : result;
  return result?.identity || data?.identity || data?.prediction || data || {};
}
function snapshot(result) { const binding = identity(result); return binding.snapshot_id || binding.target_snapshot_id || null; }
function observation(result) {
  const data = object(result?.data) ? result.data : result;
  return data?.observation || data?.prediction?.observation || null;
}
function fail(issues, claim) { return { verified: false, fact: null, issues: issues.map(item => issue(item[0], item[1], claim)) }; }

/**
 * Consistency verification against SERVER-OWNED tool results. It does not
 * authenticate client-supplied JSON, prove physical accuracy or certify prose.
 * Cryptographic model/evidence authentication stays in freezeContext/store.
 */
export function verifyClaim(claim, { results, currentSnapshotId, resultUnits = {} } = {}) {
  if (!object(claim) || !object(claim.source) || typeof claim.source.result_ref !== 'string') return fail([['FACT_SOURCE_REQUIRED', '关键事实必须引用真实工具结果。']], claim);
  const result = getResult(results, claim.source.result_ref);
  if (!result) return fail([['FACT_SOURCE_MISSING', '引用的工具结果不存在。']], claim);
  if (result.status !== undefined && !goodStatuses.has(result.status)) return fail([['FACT_SOURCE_PENDING', '失败、待执行或待核对的结果不能声明为已完成事实。']], claim);
  const actual = resolveFactPointer(result, claim.source.path);
  if (!actual.found) return fail([['FACT_PATH_MISSING', '引用字段不存在。']], claim);
  const boundSnapshot = snapshot(result);
  if (claim.snapshot_id && claim.snapshot_id !== boundSnapshot) return fail([['FACT_SNAPSHOT_MISMATCH', '事实与其来源工况不一致。']], claim);
  if (claim.source.snapshot_id && claim.source.snapshot_id !== boundSnapshot) return fail([['FACT_SNAPSHOT_MISMATCH', '来源引用与真实结果工况不一致。']], claim);
  const scope = claim.scope || 'current';
  if (scope === 'current' && (!currentSnapshotId || !boundSnapshot || boundSnapshot !== currentSnapshotId)) return fail([['FACT_NOT_CURRENT', '该事实没有绑定当前工况。']], claim);
  if (!['current', 'historical', 'configuration'].includes(scope)) return fail([['FACT_SCOPE_INVALID', '事实范围无效。']], claim);
  if (claim.kind === 'causal' || claim.kind === 'root_cause') return fail([['CAUSAL_EVIDENCE_REQUIRED', '模型响应或相关性不能升级为已证实的物理根因。']], claim);
  if (claim.kind === 'numeric' || claim.kind === 'model_response') {
    if (!finite(claim.value) || !finite(actual.value)) return fail([['FACT_NON_FINITE', '关键数值必须来自有限数值结果。']], claim);
    let expectedValue = actual.value;
    if (claim.derivation !== undefined) {
      const operands = claim.derivation?.operands;
      if (claim.metric !== 'prediction_error' || claim.derivation.operation !== 'subtract' || !Array.isArray(operands) || operands.length !== 2
          || operands.some(operand => operand.result_ref !== claim.source.result_ref || typeof operand.path !== 'string')
          || !['/value', '/prediction/value', '/data/value', '/data/prediction/value'].includes(operands[0].path)
          || claim.source.path !== operands[0].path || operands[1].path !== operands[0].path.replace(/\/value$/u, '/observation/value')) return fail([['FACT_DERIVATION_INVALID', '派生误差必须明确引用同一预测结果和实际值。']], claim);
      const values = operands.map(operand => resolveFactPointer(result, operand.path));
      if (values.some(value => !value.found || !finite(value.value))) return fail([['FACT_DERIVATION_INVALID', '派生误差缺少有效操作数。']], claim);
      expectedValue = values[0].value - values[1].value;
    }
    if (claim.value !== expectedValue) return fail([['FACT_VALUE_MISMATCH', '关键数值与工具原始结果不一致。']], claim);
    let actualUnit;
    if (claim.source.unit_path) actualUnit = resolveFactPointer(result, claim.source.unit_path).value;
    else actualUnit = getResult(resultUnits, claim.source.result_ref)?.[claim.source.path] || result.unit || result.data?.unit;
    if (typeof claim.unit !== 'string' || !claim.unit || typeof actualUnit !== 'string' || claim.unit !== actualUnit) return fail([['FACT_UNIT_MISMATCH', '数值单位必须由结果字段或服务端单位合同明确提供。']], claim);
    if (claim.metric === 'prediction_error' || /(?:predictionError|prediction_error|observed_error)/u.test(claim.source.path)) {
      const measured = observation(result);
      if (!finite(measured?.value) || measured.quality === 'missing' || measured.quality === 'invalid' || measured.snapshot_id !== boundSnapshot || measured.unit !== claim.unit) return fail([['OBSERVATION_REQUIRED', '没有绑定同一工况和单位的实际值时不能声明预测误差。']], claim);
      if (claim.observation_id && claim.observation_id !== measured.observation_id) return fail([['OBSERVATION_MISMATCH', '误差引用的实测记录不一致。']], claim);
      const data = object(result.data) ? result.data : result, prediction = data.prediction || data;
      if (!finite(prediction.value) || claim.value !== prediction.value - measured.value) return fail([['FACT_ERROR_MISMATCH', '预测误差必须等于该预测值减去配对实际值。']], claim);
    }
  } else if (claim.kind === 'status') {
    if (!['string', 'boolean'].includes(typeof claim.value) || claim.value !== actual.value) return fail([['FACT_VALUE_MISMATCH', '状态声明与真实回执不一致。']], claim);
  } else if (claim.kind === 'excerpt') {
    if (typeof claim.value !== 'string' || !claim.value || typeof actual.value !== 'string' || !actual.value.includes(claim.value)) return fail([['FACT_EXCERPT_MISMATCH', '引用原文必须真实存在于工具返回的片段中。']], claim);
  } else return fail([['FACT_KIND_INVALID', '未注册的事实类型。']], claim);
  return { verified: true, fact: { ...structuredClone(claim), snapshot_id: boundSnapshot, scope, verification_level: 'tool_result_consistency', ...(claim.kind === 'model_response' ? { interpretation: 'model_response_not_physical_causality' } : {}) }, issues: [] };
}

export function verifyClaims(claims, context) {
  if (!Array.isArray(claims)) return { verified: false, facts: [], issues: [issue('FACTS_INVALID', '事实列表格式无效。')] };
  const checked = claims.map(claim => verifyClaim(claim, context));
  return { verified: checked.every(item => item.verified), facts: checked.flatMap(item => item.fact ? [item.fact] : []), issues: checked.flatMap(item => item.issues) };
}

function numericFact({ id, metric, value, unit, resultRef, path, snapshotId, currentSnapshotId, observationId, interpretation }) {
  if (!finite(value) || !unit || !snapshotId) return null;
  const labels = { s5_prediction: 'S5模型预测', s5_observed: '同工况实际值', prediction_error: '预测与实际值之差', current_prediction: '当前工况预测', reference_prediction: '对比工况预测', prediction_difference: '两工况预测差' };
  return { id, kind: interpretation ? 'model_response' : 'numeric', metric, label: labels[metric] || (interpretation ? '模型参数响应' : metric), value, unit, snapshot_id: snapshotId,
    ...(observationId ? { observation_id: observationId } : {}), scope: snapshotId === currentSnapshotId ? 'current' : 'historical',
    source: { result_ref: resultRef, path, snapshot_id: snapshotId }, verification_level: 'tool_result_consistency',
    ...(interpretation ? { interpretation } : {}) };
}

/** Extract only computed S5 facts. No measurement -> no error, even if a stale
 * display.predictionError is present. This is not an accuracy certification. */
export function buildPredictionFacts({ prediction, observation: measured = prediction?.observation, currentSnapshotId, resultRef = 'prediction', prefix = '' } = {}) {
  if (!object(prediction) || prediction.mode !== 'formal' || !prediction.snapshot_id || !finite(prediction.value)
      || !prediction.model_version || !/^[a-f0-9]{64}$/u.test(prediction.model_hash || '') || !prediction.receipt) return [];
  const make = (metric, value, path, extra = {}) => numericFact({ id: `${resultRef}:${metric}`, metric, value, unit: unitFor('force'), resultRef, path: `${prefix}${path}`, snapshotId: prediction.snapshot_id, currentSnapshotId, ...extra });
  const facts = [make('s5_prediction', prediction.value, '/value')];
  const original = prediction.observation;
  const sameSource = original && ['observation_id', 'snapshot_id', 'value', 'unit'].every(key => original[key] === measured?.[key]);
  if (sameSource && finite(measured?.value) && measured.quality !== 'missing' && measured.quality !== 'invalid' && measured.snapshot_id === prediction.snapshot_id && measured.unit === unitFor('force') && measured.observation_id) {
    // A derived value references both operands. It is recomputed here rather
    // than accepting a display field or a language-model generated number.
    facts.push(make('s5_observed', measured.value, '/observation/value', { observationId: measured.observation_id }));
    const error = make('prediction_error', prediction.value - measured.value, '/value', { observationId: measured.observation_id });
    error.derivation = { operation: 'subtract', operands: [{ result_ref: resultRef, path: `${prefix}/value` }, { result_ref: resultRef, path: `${prefix}/observation/value` }] };
    facts.push(error);
  }
  return facts.filter(Boolean);
}

/** The action ID is selected by the server registry, not by LLM prose. */
export function factsFromToolResult(actionId, data, { resultRef = actionId, currentSnapshotId } = {}) {
  if (!object(data) || data.error || data.status && !goodStatuses.has(data.status)) return [];
  const envelope = object(data.data) ? data.data : data, prefix = envelope === data ? '' : '/data';
  if (['predict', 'prediction.predict_s5', 'trial.predict'].includes(actionId)) {
    const prediction = envelope.prediction || envelope;
    return buildPredictionFacts({ prediction, observation: envelope.observation || prediction.observation, currentSnapshotId, resultRef, prefix: `${prefix}${envelope.prediction ? '/prediction' : ''}` });
  }
  const binding = identity(data), snapshotId = binding.snapshot_id || binding.target_snapshot_id;
  const rows = [];
  const add = (metric, value, path, unit, interpretation) => { const fact = numericFact({ id: `${resultRef}:${metric}`, metric, value, unit, resultRef, path: `${prefix}${path}`, snapshotId, currentSnapshotId, interpretation }); if (fact) rows.push(fact); };
  if (actionId === 'compare' || actionId === 'analysis.compare_segments') {
    add('current_prediction', envelope.currentT, '/currentT', 't'); add('reference_prediction', envelope.referenceT, '/referenceT', 't'); add('prediction_difference', envelope.deltaT, '/deltaT', 't');
  }
  if (actionId === 'analyze' || actionId === 'analysis.sensitivity') {
    (envelope.drivers || []).forEach((driver, index) => add(`model_response_${index}`, driver.contribution, `/drivers/${index}/contribution`, 't', 'model_response_not_physical_causality'));
  }
  return rows;
}
