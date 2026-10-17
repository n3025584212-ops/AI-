import test from 'node:test';
import {sourceUnitFor} from '../src/engineeringUnits.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SCHEMA_VERSION, FEATURE_KEYS, FEATURE_SCHEMA, PREDICTION_TARGET,
  validatePredictionInput, projectPredictionInput, createInputSnapshot, createResultSnapshot,
  PredictionContractError,
} from '../server/prediction-contract.mjs';

const values = () => Array.from({ length: 25 }, (_, index) => index + 0.5);
const input = () => Object.fromEntries(FEATURE_KEYS.map((key, index) => [key, values()[index]]));
const metadata = () => ({ sample_id: 'sample-01', stream_id: 'manual-session', input_version: 1, source_type: 'manual' });
const code = (result, expected) => result.issues.some(item => item.code === expected);

test('canonical schema matches supplied Python FEATURES without importing or executing the predictor', async () => {
  const source = await readFile(new URL('../server/model-definition/dkqkar_v5s2_model.py', import.meta.url), 'utf8');
  const declaration = source.match(/^FEATURES = \[([\s\S]*?)^\]/m);
  assert.ok(declaration);
  const expected = [...declaration[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  assert.equal(expected.length, 25);
  assert.deepEqual(FEATURE_KEYS, expected);
  assert.equal(FEATURE_KEYS[5], 'S3rolling forces');
  assert.ok(!FEATURE_KEYS.includes(PREDICTION_TARGET));
  assert.equal(SCHEMA_VERSION, 'dkqkar-v5s2-input-v1');
});

test('raw projection isolates UI/target/actual fields; formal canonical rejects extras', () => {
  const first = validatePredictionInput(input());
  const shuffled = Object.fromEntries(Object.entries(input()).reverse());
  Object.assign(shuffled, { target: 100, actual: 999, 'S5 rolling forces': 222, temperature: 30 });
  const second = projectPredictionInput(shuffled);
  assert.equal(validatePredictionInput(shuffled).status, 'BLOCKED');
  assert.deepEqual(validatePredictionInput(Object.fromEntries(Object.entries(input()).reverse())).values, first.values);
  assert.equal(validatePredictionInput(second.features).status, 'VERIFIED');
  assert.equal(first.scope, 'input_contract');
  assert.equal(first.status, 'VERIFIED');
  assert.deepEqual(first.values, values());
  assert.deepEqual(second.values, first.values);
  assert.deepEqual(Object.keys(second.features), FEATURE_KEYS);
  assert.equal(first.range_status, 'UNKNOWN');
  assert.equal(first.model_ready, undefined);
});

test('source-confirmed canonical engineering units are shared and frozen contract ranges stay absent', () => {
  assert.deepEqual(FEATURE_SCHEMA.filter(item => item.unit === 'mm').map(item => item.index), [0, 1, 2]);
  for (const feature of FEATURE_SCHEMA.slice(3)) {
    assert.equal(feature.unit, sourceUnitFor(feature.key));
    assert.equal(feature.unit_status, 'confirmed');
  }
  assert.ok(FEATURE_SCHEMA.every(item => item.reference_range === null));
  assert.equal(FEATURE_SCHEMA[5].stand_id, 'S3');
  assert.equal(FEATURE_SCHEMA[1].stand_id, null);
  assert.ok(Object.isFrozen(FEATURE_SCHEMA[0]));
});

test('arrays require exactly 25 present finite numbers, without coercion', () => {
  assert.equal(validatePredictionInput(values()).status, 'VERIFIED');
  assert.ok(code(validatePredictionInput(values().slice(1)), 'INPUT_DIMENSION'));
  assert.ok(code(validatePredictionInput([...values(), 100]), 'INPUT_DIMENSION'));
  const hole = values(); delete hole[5];
  assert.ok(code(validatePredictionInput(hole), 'MISSING_FEATURE'));
  for (const invalid of [true, false, null, '1', '', new Number(1), {}, []]) {
    const sample = values(); sample[3] = invalid;
    assert.ok(code(validatePredictionInput(sample), 'INVALID_TYPE'));
  }
  for (const invalid of [NaN, Infinity, -Infinity]) {
    const sample = values(); sample[3] = invalid;
    assert.ok(code(validatePredictionInput(sample), 'NON_FINITE'));
  }
});

test('missing own fields do not use defaults or inherited properties', () => {
  const sample = input(); delete sample[FEATURE_KEYS[0]];
  const result = validatePredictionInput(sample);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.values, null);
  assert.ok(code(result, 'MISSING_FEATURE'));
  assert.ok(code(validatePredictionInput(Object.create(input())), 'INVALID_INPUT'));
  for (const invalid of [null, true, 1, '1', undefined]) assert.ok(code(validatePredictionInput(invalid), 'INVALID_INPUT'));
});

test('explicit mappings normalize arbitrary column order and reject duplicate source/destination', () => {
  const row = Object.fromEntries(values().map((value, index) => [`column-${index}`, value]));
  const mapping = FEATURE_KEYS.map((feature, index) => ({ source: `column-${index}`, feature })).reverse();
  assert.deepEqual(projectPredictionInput(row, { mapping }).values, values());
  assert.equal(validatePredictionInput(row, { mapping }).status, 'BLOCKED');
  const duplicateFeature = mapping.map(entry => ({ ...entry })); duplicateFeature[0].feature = duplicateFeature[1].feature;
  assert.ok(code(projectPredictionInput(row, { mapping: duplicateFeature }), 'DUPLICATE_FEATURE'));
  const duplicateSource = mapping.map(entry => ({ ...entry })); duplicateSource[0].source = duplicateSource[1].source;
  assert.ok(code(projectPredictionInput(row, { mapping: duplicateSource }), 'DUPLICATE_SOURCE'));
  assert.ok(code(projectPredictionInput(row, { mapping: {} }), 'INVALID_MAPPING'));
  assert.ok(code(projectPredictionInput(row, { mapping: mapping.slice(1) }), 'INVALID_MAPPING'));
  assert.ok(code(projectPredictionInput(values(), { mapping }), 'INVALID_MAPPING'));
});

test('S4 force, target and observed S5 values cannot be explicitly mapped into any model feature', () => {
  for (const source of ['S4 rolling forces', 'S4.force', 'target', 'actual', 'y_true', 'y_pred', 'S5 rolling forces', 'S5.force', '目标值', '实际值']) {
    const mapping = FEATURE_KEYS.map(feature => ({ source: feature, feature }));
    mapping[0].source = source;
    const result = projectPredictionInput({ ...input(), [source]: 2 }, { mapping });
    assert.equal(result.status, 'BLOCKED');
    assert.ok(code(result, 'TARGET_LEAKAGE'), source);
  }
  const canonicalMapping = FEATURE_KEYS.map(feature => ({ source: feature, feature }));
  assert.equal(projectPredictionInput(input(), { mapping: canonicalMapping }).status, 'VERIFIED');
  const targetMapping = canonicalMapping.map(entry => ({ ...entry })); targetMapping[0].feature = PREDICTION_TARGET;
  assert.ok(code(projectPredictionInput(input(), { mapping: targetMapping }), 'UNKNOWN_FEATURE'));
});

test('stable SHA-256 depends on canonical values, not targets, mapping order, or sample identity', () => {
  const original = createInputSnapshot(input(), metadata());
  const enriched = { ...Object.fromEntries(Object.entries(input()).reverse()), target: 1, actual: 900 };
  assert.throws(() => createInputSnapshot(enriched, metadata()), PredictionContractError);
  const other = createInputSnapshot(projectPredictionInput(enriched).features, { ...metadata(), sample_id: 'sample-02', input_version: 2 });
  assert.match(original.input_hash, /^[a-f0-9]{64}$/);
  // Independent Python hashlib + compact JSON reference, computed without model execution.
  assert.equal(original.input_hash, 'f42218dac0d7f7e352140e267fd8c58d3824624d3c7fa16e7e7923196b641448');
  assert.equal(original.input_hash, other.input_hash);
  assert.notEqual(original.sample_id, other.sample_id);
  assert.notEqual(original.input_version, other.input_version);
  const modified = input(); modified.width += 1;
  assert.notEqual(original.input_hash, createInputSnapshot(modified, metadata()).input_hash);
  const negativeZero = values(); negativeZero[1] = -0;
  const positiveZero = values(); positiveZero[1] = 0;
  assert.equal(createInputSnapshot(negativeZero, metadata()).input_hash, createInputSnapshot(positiveZero, metadata()).input_hash);
});

test('snapshots own deeply frozen data and preserve absent model identity as null', () => {
  const sample = input(); const meta = metadata();
  const snapshot = createInputSnapshot(sample, meta);
  sample.width = 999; meta.sample_id = 'changed';
  assert.equal(snapshot.features.width, 1.5);
  assert.equal(snapshot.sample_id, 'sample-01');
  assert.equal(snapshot.model_hash, null);
  assert.equal(snapshot.model_version, null);
  assert.equal(snapshot.sample_timestamp, null);
  assert.throws(() => { snapshot.values[0] = 1; }, TypeError);
  assert.throws(() => { snapshot.features.width = 1; }, TypeError);
  assert.throws(() => { snapshot.units[0].unit = 'cm'; }, TypeError);
  assert.equal(snapshot.target, undefined);
  assert.equal(snapshot.actual, undefined);
});

test('snapshot metadata requires explicit source/stream/sample/version and valid optional identities', () => {
  for (const field of ['sample_id', 'stream_id', 'source_type', 'input_version']) {
    const meta = metadata(); delete meta[field];
    assert.throws(() => createInputSnapshot(input(), meta), PredictionContractError);
  }
  for (const invalid of [true, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createInputSnapshot(input(), { ...metadata(), input_version: invalid }), PredictionContractError);
  }
  for (const invalid of ['bad-hash', true, 123]) {
    assert.throws(() => createInputSnapshot(input(), { ...metadata(), model_hash: invalid }), PredictionContractError);
  }
  const snapshot = createInputSnapshot(input(), { ...metadata(), model_version: 'supplied-identity', model_hash: 'A'.repeat(64) });
  assert.equal(snapshot.model_hash, 'a'.repeat(64));
  assert.equal(snapshot.model_verified, undefined);
});

test('source timestamps retain actual time, require timezone, and reject invalid calendar dates', () => {
  const snapshot = createInputSnapshot(input(), { ...metadata(), sample_timestamp: '2026-09-26T18:30:00+08:00' });
  assert.equal(snapshot.sample_timestamp, '2026-09-26T10:30:00.000Z');
  for (const invalid of ['2026-02-30T01:00:00Z', '2026-09-26T01:00:00', '2026-13-01T01:00:00Z', '2026-09-26T24:00:00Z', true, 0]) {
    assert.throws(() => createInputSnapshot(input(), { ...metadata(), sample_timestamp: invalid }), PredictionContractError);
  }
});

test('blocked results bind the exact immutable snapshot without producing a prediction', () => {
  const snapshot = createInputSnapshot(input(), metadata());
  const data = { reasons: ['FROZEN_MODEL_MISSING'] };
  const result = createResultSnapshot(snapshot, { status: 'BLOCKED', source: 'model-readiness', data });
  data.reasons.push('caller mutation');
  assert.equal(result.input_snapshot, snapshot);
  assert.deepEqual(result.data.reasons, ['FROZEN_MODEL_MISSING']);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.data.value, undefined);
  assert.match(result.result_id, /^[0-9a-f-]{36}$/);
  assert.throws(() => result.data.reasons.push('mutation'), TypeError);
  assert.throws(() => createResultSnapshot(structuredClone(snapshot), { status: 'BLOCKED', source: 'check' }), PredictionContractError);
});

test('results reject invalid states, non-finite values, cycles, and non-JSON payloads', () => {
  const snapshot = createInputSnapshot(input(), metadata());
  const cyclic = {}; cyclic.self = cyclic;
  for (const data of [Infinity, NaN, { value: undefined }, { value: 1n }, cyclic, new Date()]) {
    assert.throws(() => createResultSnapshot(snapshot, { status: 'BLOCKED', source: 'check', data }), PredictionContractError);
  }
  assert.throws(() => createResultSnapshot(snapshot, { status: 'faked', source: 'check' }), PredictionContractError);
  assert.throws(() => createResultSnapshot(snapshot, { status: 'BLOCKED' }), PredictionContractError);
});
