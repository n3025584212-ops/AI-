import { RANGE_CHECK_FIELDS } from './inputRangeFields.js';
import { FROZEN_DEMO_RANGE_STATS } from './frozenDemoRangeStats.js';
import { sourceUnitFor } from './engineeringUnits.js';

export const FORMAL_RANGE_DOCUMENT = Object.freeze({
  name: '冷轧作业部 1#酸轧机组技术规程',
  sha256: 'c1fe80edc33c34ad3bb7be1bb245e914f57e01c6a588f3756c3b7bc27e32f3c4',
  revision: '1.0', approved: '2025-07-17',
});
export const S5_SPEED_OPERATING_GUIDANCE = Object.freeze({
  type: 'ADVISORY_OPERATING_GUIDANCE', page: 45,
  statement: '成品厚度≤0.35mm时S5速度尽量不低于90m/min；>0.35mm时尽量不低于48m/min',
});
export const MODEL_WIDTH_SEMANTIC = 'NOT_CONFIRMED';
// User-confirmed reference values; neither training ranges nor mechanical limits.
const DEFAULT_REFERENCE_BOUNDS = Object.freeze({
  entrySetThickness: Object.freeze([1.5,6]),
  width: Object.freeze([700,1650]),
  entryThickness: Object.freeze([1.5,6]),
  force: Object.freeze([0,2800]),
  bendingForce: Object.freeze([0,650]),
  speed: Object.freeze([0,2000]),
  tension: Object.freeze([0,100]),
  frontTension: Object.freeze([0,100]),
});
export const INPUT_REFERENCE_RANGE_DEFINITION = Object.freeze({
  name: '默认输入参考范围', revision: 'UPDATE_INPUT_REFERENCE_RANGES_ONLY_V1',
  type: 'INPUT_REFERENCE_RANGE', source: 'USER_CONFIRMED_DEFAULTS',
});
// Keep the existing consumers, including Candidate, on this one range config.
export const FORMAL_INPUT_RANGE_AUDIT = Object.freeze(Object.fromEntries(RANGE_CHECK_FIELDS.map(feature => {
  const [lower,upper] = DEFAULT_REFERENCE_BOUNDS[feature.field];
  const boundary = Object.freeze({ mapping_status:'CONFIRMED', limit_type:'INPUT_REFERENCE_RANGE',
    unit:sourceUnitFor(feature.field), lower,upper, pdfLower:null,pdfUpper:null,pdfUnit:null,
    document:INPUT_REFERENCE_RANGE_DEFINITION, source:'USER_CONFIRMED_DEFAULTS',
    statement:'用户确认的默认输入参考范围；不代表模型训练范围或设备绝对安全边界',
  });
  return [feature.key,boundary];
})));
const finite = value => typeof value === 'number' && Number.isFinite(value);
export function pdfExactRange(feature,boundary) {
  if (boundary?.mapping_status !== 'CONFIRMED' || boundary.limit_type !== 'ABSOLUTE_INPUT_BOUNDARY'
    || boundary.unit !== sourceUnitFor(feature.field)) return null;
  const { lower,upper } = boundary;
  if (lower != null && !finite(lower) || upper != null && !finite(upper) || lower == null && upper == null
    || lower != null && upper != null && lower > upper) return null;
  return { min:lower,max:upper,boundary };
}
export function defaultEffectiveInputRange(feature) {
  const boundary = FORMAL_INPUT_RANGE_AUDIT[feature.key];
  return { min:boundary.lower, max:boundary.upper,
    lowerSource:'DEFAULT_INPUT_REFERENCE', upperSource:'DEFAULT_INPUT_REFERENCE',
    rangeSource:'DEFAULT_INPUT_REFERENCE', formalMapping:boundary, pdfExact:null,
    demoStats:FROZEN_DEMO_RANGE_STATS.fields[feature.key], defaultLower:boundary.lower, defaultUpper:boundary.upper };
}
export const rangeBoundSourceLabel = source => ({
  DEFAULT_INPUT_REFERENCE:'默认输入参考范围',
  PDF:'PDF规程原始边界', FROZEN_60_DEMO:'冻结60条Demo范围按跨度外扩10%', USER_CUSTOM:'用户自定义范围', NONE:'无可用边界',
})[source] || '来源待确认';
export function effectiveRangeSourceLabel(range) {
  if (range.range_source === 'USER_CUSTOM') return '用户自定义范围';
  return '默认输入参考范围';
}
