import { RANGE_CHECK_FIELDS, rangeCheckValues } from './inputRangeFields.js';
import { FROZEN_DEMO_RANGE_STATS } from './frozenDemoRangeStats.js';
import { sourceUnitFor } from './engineeringUnits.js';
import { defaultEffectiveInputRange } from './formalInputRanges.js';

export const CUSTOM_LIMITS_KEY = 'dkqkar.range-check.custom-limits.v1';
export const RANGE_EXPLANATION = '该提示仅表示当前值超出有效范围，不代表参数错误，也不代表其已被确认是当前S5预测差异的原因。';
export const RANGE_LIMITS_CHANGED_EVENT = 'qcdkr:input-range-limits-changed';
const notifyLimitsChanged = () => { if (typeof globalThis.dispatchEvent === 'function') globalThis.dispatchEvent(new Event(RANGE_LIMITS_CHANGED_EVENT)); };
const knownFields = new Set(RANGE_CHECK_FIELDS.map(feature => feature.key));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const numeric = value => typeof value === 'string' && value.trim() !== '' ? Number(value) : typeof value === 'number' ? value : NaN;

export function parseCustomLimit(minimum, maximum) {
  const min = numeric(minimum), max = numeric(maximum);
  return finite(min) && finite(max) && min < max ? {min,max} : null;
}
export function sanitizeCustomLimits(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, limit]) => knownFields.has(key)
    && finite(limit?.min) && finite(limit?.max) && limit.min < limit.max).map(([key,limit])=>[key,{min:limit.min,max:limit.max}]));
}
export function readCustomLimits(storage) {
  try { return sanitizeCustomLimits(JSON.parse(storage?.getItem(CUSTOM_LIMITS_KEY) || '{}')); }
  catch { return {}; }
}
// Only this display preference key is touched. Failed writes keep the old state.
export function saveCustomLimit(storage, current, key, minimum, maximum) {
  const limit = parseCustomLimit(minimum, maximum);
  if (!knownFields.has(key) || !limit) return {ok:false,error:'请输入合法范围'};
  const next = {...sanitizeCustomLimits(current), [key]:limit};
  try { storage.setItem(CUSTOM_LIMITS_KEY, JSON.stringify(next)); notifyLimitsChanged(); return {ok:true,limits:next}; }
  catch { return {ok:false,error:'无法保存本地范围，请检查浏览器存储权限'}; }
}
export function resetCustomLimit(storage, current, key) {
  const next = sanitizeCustomLimits(current);
  delete next[key];
  try { storage.setItem(CUSTOM_LIMITS_KEY, JSON.stringify(next)); notifyLimitsChanged(); return {ok:true,limits:next}; }
  catch { return {ok:false,error:'无法保存本地范围，请检查浏览器存储权限'}; }
}
export function resetAllCustomLimits(storage, confirm) {
  if (!confirm('将清除所有自定义范围，是否继续？')) return {ok:false,canceled:true};
  try { storage.removeItem(CUSTOM_LIMITS_KEY); notifyLimitsChanged(); return {ok:true,limits:{}}; }
  catch { return {ok:false,error:'无法清除本地范围，请检查浏览器存储权限'}; }
}

export function checkHistoricalRanges(caseData, _legacyTable, custom = {}) {
  const values = rangeCheckValues(caseData), limits = sanitizeCustomLimits(custom);
  const rows = RANGE_CHECK_FIELDS.map(feature => {
    const history = FROZEN_DEMO_RANGE_STATS.fields[feature.key], override = limits[feature.key], value = values[feature.key];
    const effective = defaultEffectiveInputRange(feature);
    const min = override?.min ?? effective.min, max = override?.max ?? effective.max;
    const status = !finite(value) ? 'NOT_CHECKED' : !finite(min) || !finite(max) || min > max ? 'INSUFFICIENT_HISTORY'
      : value < min || value > max ? 'REVIEW_RECOMMENDED' : 'NORMAL';
    return {...feature, value, history, override, min, max, status, unit:sourceUnitFor(feature.field),
      defaultLower:effective.min,defaultUpper:effective.max,
      defaultLowerSource:effective.lowerSource,defaultUpperSource:effective.upperSource,
      lowerSource:override?'USER_CUSTOM':effective.lowerSource,
      upperSource:override?'USER_CUSTOM':effective.upperSource,
      rangeSource:override?'USER_CUSTOM':effective.rangeSource,
      formalMapping:effective.formalMapping,
      source:override ? '用户自定义范围' : '默认输入参考范围'};
  });
  const count = status => rows.filter(row=>row.status===status).length;
  const normalCount=count('NORMAL'), reviewCount=count('REVIEW_RECOMMENDED'),
    insufficientCount=count('INSUFFICIENT_HISTORY'), degenerateCount=count('DEGENERATE'), notCheckedCount=count('NOT_CHECKED');
  const uncheckedCount = insufficientCount+degenerateCount+notCheckedCount;
  const summary = `${rows.length}项 · 范围内 ${normalCount} · 超出当前参考范围 ${reviewCount} · 缺失/不可检查 ${uncheckedCount}`;
  return {rows, normalCount,reviewCount,insufficientCount,degenerateCount,notCheckedCount,summary,
    // Review rows first; both groups preserve the canonical field order.
    sortedRows:[...rows.filter(row=>row.status==='REVIEW_RECOMMENDED'),...rows.filter(row=>row.status!=='REVIEW_RECOMMENDED')]};
}
