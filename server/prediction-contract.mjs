import { createHash, randomUUID } from 'node:crypto';
import { sourceUnitFor } from '../src/engineeringUnits.js';

/** Input contract only: this module does not load, train, or run a predictor. */
export const SCHEMA_VERSION = 'dkqkar-v5s2-input-v1';
export const PREDICTION_TARGET = 'S5 rolling forces';

const definitions = [
  ['Entry set thickness', '入口设定厚度', 'S1', 'mm'],
  ['width', '带钢宽度', null, 'mm'],
  ['Entry actual thickness', '入口实际厚度', 'S1', 'mm'],
  ['S1 rolling forces', 'S1 轧制力', 'S1'],
  ['S2 rolling forces', 'S2 轧制力', 'S2'],
  ['S3rolling forces', 'S3 轧制力', 'S3'],
  ['S1 bending force', 'S1 弯辊力', 'S1'],
  ['S2 bending force', 'S2 弯辊力', 'S2'],
  ['S3 bending force', 'S3 弯辊力', 'S3'],
  ['S4 bending force', 'S4 弯辊力', 'S4'],
  ['S1 rolling speed', 'S1 轧制速度', 'S1'],
  ['S2 rolling speed', 'S2 轧制速度', 'S2'],
  ['S3 rolling speed', 'S3 轧制速度', 'S3'],
  ['S4 rolling speed', 'S4 轧制速度', 'S4'],
  ['S1 back tension', 'S1 后张力', 'S1'],
  ['S2 back tension', 'S2 后张力', 'S2'],
  ['S3 back tension', 'S3 后张力', 'S3'],
  ['S4 back tension', 'S4 后张力', 'S4'],
  ['S1 front tension', 'S1 前张力', 'S1'],
  ['S2 front tension', 'S2 前张力', 'S2'],
  ['S3 front tension', 'S3 前张力', 'S3'],
  ['S4 front tension', 'S4 前张力', 'S4'],
  ['S5 bending force', 'S5 弯辊力', 'S5'],
  ['S5 rolling speed', 'S5 轧制速度', 'S5'],
  ['S5 back tension', 'S5 后张力', 'S5'],
];

// Exact spelling and order come from dkqkar_v5s2_model.py FEATURES, including
// "S3rolling forces". Units reuse the confirmed source engineering metadata.
// Frozen-model reference ranges are absent; no range is invented from UI limits.
export const FEATURE_SCHEMA = Object.freeze(definitions.map(([key, label, stand_id, unit], index) => Object.freeze({
  index, key, label, stand_id, unit: sourceUnitFor(key),
  unit_status: 'confirmed',
  unit_source: 'field-source-engineering-units',
  reference_range: null,
})));
export const FEATURE_KEYS = Object.freeze(FEATURE_SCHEMA.map(feature => feature.key));
const featureSet = new Set(FEATURE_KEYS);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const issue = (code, field, message) => ({ code, field, message });
const issuedSnapshots = new WeakSet();
const snapshotBindings = new Map();

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function forbiddenSource(source) {
  if (featureSet.has(source)) return false;
  const normalized = source.toLowerCase().replace(/[\s_.\-\[\]]/g, '');
  return /^(target|actual|observed|ytrue|ypred|prediction|s[45]rollingforce|s[45]force)/.test(normalized)
    || ['目标', '目标值', '实际值', '真实值', 's4轧制力', 's5轧制力', '目标s5轧制力'].includes(normalized);
}

/**
 * Strict formal boundary: exactly the canonical keys or 25 numeric entries.
 * Raw rows with extra context must first use projectPredictionInput().
 */
export function validatePredictionInput(input, options = {}) {
  return validateInput(input, options, false);
}

/**
 * Raw-source projection, kept distinct from strict canonical validation.
 * Custom column mapping is an array of { source, feature }; never an object,
 * so duplicate destinations can be detected before normalization.
 * Extra raw fields are ignored. CSV parsing must reject duplicate headers
 * before constructing the input object; overwritten JSON keys are unrecoverable.
 */
export function projectPredictionInput(input, options = {}) {
  return validateInput(input, options, true);
}

function validateInput(input, { mapping } = {}, raw = false) {
  const issues = [];
  let values = [];
  if (!raw && mapping !== undefined) issues.push(issue('INVALID_MAPPING', 'mapping', '正式 canonical 入口不能进行来源映射，请先投影原始数据。'));
  if (Array.isArray(input)) {
    if (mapping !== undefined) issues.push(issue('INVALID_MAPPING', 'mapping', '数组必须已经按 canonical 25 维顺序排列，不能再映射。'));
    if (input.length !== FEATURE_KEYS.length) issues.push(issue('INPUT_DIMENSION', 'input', '输入数组长度必须恰为 25。'));
    values = FEATURE_KEYS.map((_, index) => own(input, index) ? input[index] : undefined);
    for (const key of Reflect.ownKeys(input)) {
      if (key !== 'length' && !FEATURE_KEYS.some((_, index) => String(index) === key)) issues.push(issue('EXTRA_FEATURE', String(key), '正式数组不能附带工程或观测字段。'));
    }
  } else if (record(input)) {
    if (!raw) for (const key of Reflect.ownKeys(input)) {
      if (!featureSet.has(key)) issues.push(issue('EXTRA_FEATURE', String(key), '正式 canonical 对象只能包含模型的 25 个字段。'));
    }
    let sources = new Map(FEATURE_KEYS.map(key => [key, key]));
    if (mapping !== undefined) {
      sources = new Map();
      const seenSources = new Set();
      if (!Array.isArray(mapping) || mapping.length !== FEATURE_KEYS.length) {
        issues.push(issue('INVALID_MAPPING', 'mapping', '映射必须包含恰好 25 项 source/feature。'));
      }
      if (Array.isArray(mapping)) for (const entry of mapping) {
        if (!record(entry) || typeof entry.source !== 'string' || !entry.source.trim() || typeof entry.feature !== 'string') {
          issues.push(issue('INVALID_MAPPING', 'mapping', '映射项须包含非空 source 和 canonical feature。'));
          continue;
        }
        if (!featureSet.has(entry.feature)) {
          issues.push(issue('UNKNOWN_FEATURE', entry.feature, '映射目标不属于模型的 25 维输入。'));
          continue;
        }
        if (sources.has(entry.feature)) issues.push(issue('DUPLICATE_FEATURE', entry.feature, '同一模型字段不能重复映射。'));
        if (seenSources.has(entry.source)) issues.push(issue('DUPLICATE_SOURCE', entry.source, '同一来源列不能映射到多个模型字段。'));
        if (forbiddenSource(entry.source)) issues.push(issue('TARGET_LEAKAGE', entry.source, '目标、实际 S5 值及预测结果不能映射到模型输入。'));
        seenSources.add(entry.source);
        sources.set(entry.feature, entry.source);
      }
    }
    values = FEATURE_KEYS.map(key => {
      const source = sources.get(key);
      return source !== undefined && own(input, source) ? input[source] : undefined;
    });
  } else {
    issues.push(issue('INVALID_INPUT', 'input', '输入须为字段对象或 25 维数组。'));
  }
  if (values.length) values.forEach((value, index) => {
    if (value === undefined) issues.push(issue('MISSING_FEATURE', FEATURE_KEYS[index], '缺少模型输入字段。'));
    else if (typeof value !== 'number') issues.push(issue('INVALID_TYPE', FEATURE_KEYS[index], '输入必须是 number，不接受布尔值、字符串或 null。'));
    else if (!Number.isFinite(value)) issues.push(issue('NON_FINITE', FEATURE_KEYS[index], '输入不能是 NaN 或 Infinity。'));
  });
  const valid = issues.length === 0;
  // Normalize negative zero, which JSON and the predictor treat numerically as 0.
  const normalized = valid ? values.map(value => Object.is(value, -0) ? 0 : value) : null;
  return freeze({
    status: valid ? 'VERIFIED' : 'BLOCKED', scope: 'input_contract',
    schema_version: SCHEMA_VERSION,
    values: normalized,
    features: valid ? Object.fromEntries(FEATURE_KEYS.map((key, index) => [key, normalized[index]])) : null,
    issues,
    range_status: 'UNKNOWN',
    range_reason: '冻结模型的参考范围元数据尚未提供。',
  });
}

export class PredictionContractError extends Error {
  constructor(issues) {
    super(issues.map(item => item.message).join('；'));
    this.name = 'PredictionContractError';
    this.code = 'PREDICTION_CONTRACT_INVALID';
    this.issues = freeze(issues);
  }
}

function requireText(value, field, nullable = false) {
  if (nullable && (value === undefined || value === null)) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\r\n\0]/.test(value)) {
    throw new PredictionContractError([issue('INVALID_METADATA', field, `${field} 须为非空短文本。`)]);
  }
  return value;
}

function timestamp(value, field, nullable = false) {
  if (nullable && (value === undefined || value === null)) return null;
  if (typeof value !== 'string') throw new PredictionContractError([issue('INVALID_TIMESTAMP', field, `${field} 须为带时区的 ISO 时间。`)]);
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  const milliseconds = Date.parse(value);
  const [, year, month, day, hour, minute, second] = parts ?? [];
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (!parts || !Number.isFinite(milliseconds) || Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > days || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
    throw new PredictionContractError([issue('INVALID_TIMESTAMP', field, `${field} 须为有效的带时区 ISO 时间。`)]);
  }
  return new Date(milliseconds).toISOString();
}

/** A value identity, not model authenticity or result freshness verification. */
function inputHash(values) {
  return createHash('sha256').update(JSON.stringify([SCHEMA_VERSION, values]), 'utf8').digest('hex');
}

// Measurements keep the supplied evidence. A numeric display field alone does
// not establish a measured source, physical unit, timestamp, or good quality.
function measurement(data = {}) {
  if (!record(data)) throw new PredictionContractError([issue('INVALID_CONTEXT', 'measurement', '工程量须为明确的字段对象。')]);
  const allowed = new Set(['value', 'unit', 'source', 'timestamp', 'quality']);
  if (Reflect.ownKeys(data).some(key => !allowed.has(key))) throw new PredictionContractError([issue('INVALID_CONTEXT', 'measurement', '工程量含未定义字段。')]);
  const value = data.value ?? null;
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw new PredictionContractError([issue('INVALID_CONTEXT', 'value', '工程量须为有限 number 或 null。')]);
  const quality = data.quality ?? (value === null ? 'missing' : 'unknown');
  if (!['missing', 'unknown', 'measured', 'estimated', 'invalid'].includes(quality)
    || (value === null && quality !== 'missing') || (value !== null && quality === 'missing')) {
    throw new PredictionContractError([issue('INVALID_CONTEXT', 'quality', '数值与质量/缺失状态不一致。')]);
  }
  return { value: Object.is(value, -0) ? 0 : value,
    unit: requireText(data.unit, 'unit', true), source: requireText(data.source ?? 'unknown', 'source'),
    timestamp: timestamp(data.timestamp, 'timestamp', true), quality };
}

export function normalizeEngineeringContext(context = {}) {
  if (!record(context) || Reflect.ownKeys(context).some(key => key !== 's4_rolling_force')) throw new PredictionContractError([issue('INVALID_CONTEXT', 'engineering_context', '本轮工程上下文只容纳 S4 rolling force。')]);
  return freeze({ s4_rolling_force: measurement(context.s4_rolling_force) });
}

function contextHash(context) {
  return createHash('sha256').update(JSON.stringify(['dkqkar-engineering-context-v1', context]), 'utf8').digest('hex');
}

function registerSnapshot(snapshot) {
  const binding = createHash('sha256').update(JSON.stringify(snapshot), 'utf8').digest('hex');
  const existing = snapshotBindings.get(snapshot.snapshot_id);
  if (existing !== undefined && existing !== binding) throw new PredictionContractError([issue('SNAPSHOT_ID_CONFLICT', 'snapshot_id', '同一 snapshot_id 不能绑定不同内容；编辑须创建新快照。')]);
  snapshotBindings.set(snapshot.snapshot_id, binding);
  issuedSnapshots.add(snapshot);
  return snapshot;
}

/**
 * sample/stream/version provenance remains caller supplied. Only this factory
 * creates snapshot_id; restoration preserves it. Identical values and metadata
 * may belong to different new instances, independently of input_hash.
 * A supplied model hash records identity only: it is not an expected-hash check.
 */
export function createInputSnapshot(input, metadata, options = {}) {
  const validated = validatePredictionInput(input, options);
  if (validated.status !== 'VERIFIED') throw new PredictionContractError([...validated.issues]);
  return registerSnapshot(buildInputSnapshot(validated, metadata, normalizeEngineeringContext(options.engineering_context), randomUUID()));
}

function buildInputSnapshot(validated, metadata, context, snapshotId) {
  if (!record(metadata)) throw new PredictionContractError([issue('INVALID_METADATA', 'metadata', '输入来源与版本元数据必填。')]);
  if (!Number.isSafeInteger(metadata.input_version) || metadata.input_version < 0) {
    throw new PredictionContractError([issue('INVALID_METADATA', 'input_version', 'input_version 须为非负安全整数。')]);
  }
  let modelHash = metadata.model_hash ?? null;
  if (modelHash !== null && (typeof modelHash !== 'string' || !/^[a-fA-F0-9]{64}$/.test(modelHash))) {
    throw new PredictionContractError([issue('INVALID_MODEL_HASH', 'model_hash', 'model_hash 须为 SHA-256 十六进制值或 null。')]);
  }
  modelHash = modelHash?.toLowerCase() ?? null;
  const snapshot = freeze({
    snapshot_id: snapshotId,
    sample_id: requireText(metadata.sample_id, 'sample_id'),
    stream_id: requireText(metadata.stream_id, 'stream_id'),
    input_version: metadata.input_version,
    input_hash: inputHash(validated.values),
    source_type: requireText(metadata.source_type, 'source_type'),
    sample_timestamp: timestamp(metadata.sample_timestamp, 'sample_timestamp', true),
    model_version: requireText(metadata.model_version, 'model_version', true),
    model_hash: modelHash,
    schema_version: SCHEMA_VERSION,
    feature_keys: [...FEATURE_KEYS],
    values: [...validated.values],
    features: { ...validated.features },
    canonical_25: { ...validated.features },
    engineering_context: context,
    context_hash: contextHash(context),
    range_status: validated.range_status,
    units: FEATURE_SCHEMA.map(({ key, unit, unit_status }) => ({ key, unit, unit_status })),
  });
  return snapshot;
}

/** Rehydrate a saved/retried snapshot without creating a new condition instance.
 * Hash consistency is checked; this is not cross-process source authentication.
 */
export function restoreInputSnapshot(saved, { trustedRecord = false } = {}) {
  if (issuedSnapshots.has(saved)) return saved;
  if (!record(saved) || typeof saved.snapshot_id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(saved.snapshot_id)) throw new PredictionContractError([issue('INVALID_SNAPSHOT', 'snapshot_id', '须提供本模块保存的快照身份。')]);
  // Content hashes prove consistency, not issuance. Cross-process restoration
  // requires a record authenticated by the service before calling this helper.
  if (!snapshotBindings.has(saved.snapshot_id) && !trustedRecord) throw new PredictionContractError([issue('UNISSUED_SNAPSHOT', 'snapshot_id', '未知快照身份；须从可信服务端记录恢复。')]);
  const checked = validatePredictionInput(saved.canonical_25);
  if (checked.status !== 'VERIFIED') throw new PredictionContractError([...checked.issues]);
  const restored = buildInputSnapshot(checked, saved, normalizeEngineeringContext(saved.engineering_context), saved.snapshot_id);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(Object.keys(saved).sort(), Object.keys(restored).sort())
    || Object.keys(restored).some(key => key === 'canonical_25' || key === 'features'
      ? validatePredictionInput(saved[key]).status !== 'VERIFIED' || !same(validatePredictionInput(saved[key]).values, checked.values)
      : !same(saved[key], restored[key]))) {
    throw new PredictionContractError([issue('INVALID_SNAPSHOT', 'snapshot', '保存的快照字段、hash 或内容不一致。')]);
  }
  return registerSnapshot(restored);
}

/** S5 actual arrives as an independent immutable record, never a snapshot edit.
 * Reusing/serializing a record preserves observation_id; each call appends one.
 */
export function createObservation(snapshot, data = {}) {
  const bound = restoreInputSnapshot(snapshot);
  return freeze({ observation_id: randomUUID(), snapshot_id: bound.snapshot_id,
    input_hash: bound.input_hash, quantity: PREDICTION_TARGET, ...measurement(data) });
}

function cloneResultData(value, depth = 0, budget = { remaining: 10000 }, seen = new WeakSet()) {
  if (--budget.remaining < 0 || depth > 20) throw new PredictionContractError([issue('RESULT_LIMIT', 'data', '结果超过快照深度或条目限制。')]);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if ((!record(value) && !Array.isArray(value)) || seen.has(value)) throw new PredictionContractError([issue('INVALID_RESULT', 'data', '结果须为有限数值的 JSON 数据，不能循环引用。')]);
  seen.add(value);
  const result = Array.isArray(value)
    ? Array.from(value, item => cloneResultData(item, depth + 1, budget, seen))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneResultData(item, depth + 1, budget, seen)]));
  seen.delete(value);
  return result;
}

/** Bind caller-produced results; this helper performs no calculation. */
export function createResultSnapshot(snapshot, result) {
  if (!issuedSnapshots.has(snapshot)) throw new PredictionContractError([issue('INVALID_SNAPSHOT', 'snapshot', '须使用本模块创建的不可变输入快照。')]);
  if (!record(result) || !['SUCCESS', 'FAILED', 'BLOCKED', 'NOT_EVALUABLE'].includes(result.status)) {
    throw new PredictionContractError([issue('INVALID_RESULT', 'status', '结果须包含明确的计算状态。')]);
  }
  return freeze({
    result_id: result.result_id === undefined ? randomUUID() : requireText(result.result_id, 'result_id'),
    input_snapshot: snapshot,
    computed_at: timestamp(result.computed_at ?? new Date().toISOString(), 'computed_at'),
    source: requireText(result.source, 'source'),
    status: result.status,
    data: cloneResultData(result.data ?? null),
  });
}
