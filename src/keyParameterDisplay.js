import { MODEL_FEATURES } from './modelInputs.js';

// This list selects display preferences from the existing contract, never defines inputs.
export const KEY_PARAMETER_LIMIT = 6;
export const KEY_PARAMETER_PREFERENCE_KEY = 'dkqkar.ui.key-parameters.v1';
export const DEFAULT_KEY_PARAMETER_FIELDS = Object.freeze([
  [null, 'entrySetThickness'], [null, 'width'], ['S4', 'frontTension'],
  ['S5', 'tension'], ['S5', 'speed'], ['S5', 'bendingForce'],
].map(([stand, field]) => MODEL_FEATURES.find(feature => feature.stand === stand && feature.field === field).key));

export function sanitizeKeyParameterFields(value) {
  if (!Array.isArray(value)) return [...DEFAULT_KEY_PARAMETER_FIELDS];
  return [...new Set(value)].filter(key => MODEL_FEATURES.some(feature => feature.key === key)).slice(0, KEY_PARAMETER_LIMIT);
}
export function readKeyParameterFields(storage) {
  try { return sanitizeKeyParameterFields(JSON.parse(storage?.getItem(KEY_PARAMETER_PREFERENCE_KEY) ?? 'null')); }
  catch { return [...DEFAULT_KEY_PARAMETER_FIELDS]; }
}
export function writeKeyParameterFields(storage, fields) {
  try { storage.setItem(KEY_PARAMETER_PREFERENCE_KEY, JSON.stringify(sanitizeKeyParameterFields(fields))); return true; }
  catch { return false; }
}
export function selectKeyParameterField(current, key, selected) {
  const fields = sanitizeKeyParameterFields(current);
  if (!MODEL_FEATURES.some(feature => feature.key === key)) return {ok:false, error:'请选择正式输入字段'};
  if (selected && !fields.includes(key) && fields.length >= KEY_PARAMETER_LIMIT) return {ok:false, error:'首页最多显示6项，请先取消一项'};
  return {ok:true, fields:selected ? [...new Set([...fields,key])] : fields.filter(value => value !== key)};
}
// Only translates existing classifications. No bounds or range calculations live here.
export function keyParameterRangeLabel(row) {
  switch (row?.status) {
    case 'NORMAL': return {text:'有效范围内', tone:'normal'};
    case 'REVIEW_RECOMMENDED': return {text:'超出有效范围', tone:'warning'};
    case 'NOT_CHECKED': return {text:'待补全', tone:'neutral'};
    case 'DEGENERATE': return {text:'范围固定', tone:'neutral'};
    default: return {text:'无可用范围', tone:'neutral'};
  }
}
