// Order and exact source spelling match server/prediction-contract.mjs FEATURES.
const definitions = [
  ['Entry set thickness', '入口设定厚度', null, 'entrySetThickness'], ['width', '带钢宽度', null, 'width'], ['Entry actual thickness', 'S1 入口实际厚度', 'S1', 'entryThickness'],
  ...[1, 2, 3].map(n => [`S${n}${n === 3 ? '' : ' '}rolling forces`, `S${n} 轧制力`, `S${n}`, 'force']),
  ...[1, 2, 3, 4].map(n => [`S${n} bending force`, `S${n} 弯辊力`, `S${n}`, 'bendingForce']),
  ...[1, 2, 3, 4].map(n => [`S${n} rolling speed`, `S${n} 轧制速度`, `S${n}`, 'speed']),
  ...[1, 2, 3, 4].map(n => [`S${n} back tension`, `S${n} 后张力`, `S${n}`, 'tension']),
  ...[1, 2, 3, 4].map(n => [`S${n} front tension`, `S${n} 前张力`, `S${n}`, 'frontTension']),
  ['S5 bending force', 'S5 弯辊力', 'S5', 'bendingForce'], ['S5 rolling speed', 'S5 轧制速度', 'S5', 'speed'], ['S5 back tension', 'S5 后张力', 'S5', 'tension'],
];
export const MODEL_FEATURES = Object.freeze(definitions.map(([key, label, stand, field], index) => Object.freeze({ key, label, stand, stand_id: stand, field, index })));
export const FEATURE_KEYS = Object.freeze(MODEL_FEATURES.map(feature => feature.key));
export const MODEL_INPUT_COUNT = 25;
const finite = value => typeof value === 'number' && Number.isFinite(value);
export function isModelInput(standId, field) { return MODEL_FEATURES.some(feature => feature.stand === standId && feature.field === field); }
export function isCaseModelInput(field) { return isModelInput(null, field); }
export function modelInputValues(input) {
  const stands = Array.isArray(input?.stands) ? input.stands : [];
  return MODEL_FEATURES.map(feature => feature.stand ? stands.find(stand => stand?.id === feature.stand)?.[feature.field] : input?.[feature.field]);
}
export function modelInputFeatures(input) { const values = modelInputValues(input); return Object.fromEntries(FEATURE_KEYS.map((key, index) => [key, values[index]])); }
/** Value dependency key, not a sample identity or cryptographic authenticity claim. */
export function modelInputFingerprint(input) {
  return JSON.stringify(modelInputValues(input).map(value => finite(value) ? Object.is(value, -0) ? 0 : value : [typeof value, String(value)]));
}
export function featureReferenceRange(referenceRanges, key) {
  const candidate = referenceRanges?.[key];
  const range = Array.isArray(candidate) ? candidate : candidate && [candidate.min, candidate.max];
  return range?.length === 2 && range.every(finite) && range[1] >= range[0] ? range : null;
}
/** Validate only actual model inputs. Optional display fields never block prediction. */
export function summarizeModelInputs(input, { referenceRanges } = {}) {
  const values = modelInputValues(input);
  const missing = [], invalid = [], outOfRange = [];
  let checkedRangeCount = 0;
  MODEL_FEATURES.forEach((feature, index) => {
    const value = values[index];
    if (value === undefined || value === null || value === '') missing.push({ ...feature, value, message: '未填写' });
    else if (!finite(value)) invalid.push({ ...feature, value, message: '需要有限数值' });
    const range = featureReferenceRange(referenceRanges, feature.key);
    if (finite(value) && range) {
      checkedRangeCount += 1;
      if (value < range[0] || value > range[1]) outOfRange.push({ ...feature, value, range: [...range], minimum: range[0], maximum: range[1] });
    }
  });
  const completeCount = values.filter(finite).length;
  const valid = completeCount === MODEL_INPUT_COUNT;
  const rangeStatus = outOfRange.length ? 'OUT_OF_RANGE' : checkedRangeCount === 0 ? 'UNKNOWN' : checkedRangeCount === MODEL_INPUT_COUNT ? 'IN_RANGE' : 'PARTIAL';
  return { valid, status: valid ? 'VERIFIED' : 'BLOCKED', values, total: MODEL_INPUT_COUNT, completeCount, present: completeCount,
    completeness: completeCount / MODEL_INPUT_COUNT, completenessPercent: completeCount / MODEL_INPUT_COUNT * 100,
    missing, invalid, outOfRange, outOfRangeCount: outOfRange.length, checkedRangeCount, rangeStatus,
    rangeSource: checkedRangeCount ? '冻结模型训练样本范围' : '未提供参考范围',
    issues: [...missing, ...invalid].map(item => ({ field: item.key, message: item.message })),
  };
}
