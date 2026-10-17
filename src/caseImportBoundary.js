import { LEGACY_ENGINEERING_UNIT_SYSTEM, decodeUnitProfile, engineeringField, unitFor } from './engineeringUnits.js';
import { MODEL_FEATURES, summarizeModelInputs } from './modelInputs.js';
import { effectiveRangeProjection } from './effectiveRangeProjection.js';
import { readCSV } from './csv.js';

export class CaseImportError extends Error {
  constructor(code, stage, message, details = {}) {
    super(message);
    this.name = 'CaseImportError';
    this.code = code;
    this.stage = stage;
    this.category = code === 'TRUE_OUT_OF_RANGE' ? 'TRUE_OUT_OF_RANGE' : 'PARSER_SCHEMA_ERROR';
    Object.assign(this, details);
  }
}

// This exact legacy artifact was confirmed by the user to contain t, despite
// its engineering-v1 marker. No filename or numeric-magnitude inference.
const confirmedLegacyArtifacts = Object.freeze({
  '1a6b13fb8ab5a60d94afca5b3e73475041099c8bff27a7517df2616ae5f2f4e8': Object.freeze({
    adapter: 'USER_CONFIRMED_LEGACY_T_FILE_V1',
    forceUnit: 't',
    evidence: '用户按文件SHA-256确认force、target为t；原unitSystem标记保持不变',
  }),
});
const finite = value => typeof value === 'number' && Number.isFinite(value);
const numeric = text => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) && Number.isFinite(Number(text));
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

// A unit choice is an explicit per-file user decision, never a magnitude or
// filename heuristic. Known byte-confirmed legacy files retain their adapter.
export function legacyCsvUnitInspection(text, audit = {}) {
  if (confirmedLegacyArtifacts[audit.sourceSha256]) return null;
  const [rawHeaders = [], ...rows] = readCSV(text),headers=rawHeaders.map(value=>value.trim()),unitIndex=headers.indexOf('unitSystem');
  if(unitIndex<0)return null;
  const row=rows.find(cells=>cells[unitIndex]?.trim()===LEGACY_ENGINEERING_UNIT_SYSTEM);
  if(!row)return null;
  const index=headers.findIndex(field=>field==='force'||/^S[1-5]\.force$/.test(field));
  const raw=index>=0?row[index]?.trim():'';
  return {filename:audit.filename || '',declaredProfile:LEGACY_ENGINEERING_UNIT_SYSTEM,
    field:index>=0?headers[index]:'轧制力',rawValue:numeric(raw)?Number(raw):null,
    convertedValue:numeric(raw)?decodeUnitProfile('force',Number(raw),LEGACY_ENGINEERING_UNIT_SYSTEM):null};
}
export async function resolveLegacyCsvUnits(text,audit,choose) {
  const inspection=legacyCsvUnitInspection(text,audit);
  if(!inspection || !choose)return undefined;
  const unit=await choose(inspection);
  if(unit===null)throw new CaseImportError('IMPORT_CANCELLED','UNIT_CONFIRMATION','已取消导入，当前数据未改变。');
  if(!['t','MN'].includes(unit))throw new CaseImportError('UNIT_CONFIRMATION_REQUIRED','UNIT_CONFIRMATION','请明确确认文件原始轧制力单位为t或MN。');
  audit.confirmedLegacyForceUnit=unit;
  audit.unitDecisionSource='EXPLICIT_USER_CONFIRMATION';
  return unit;
}

export async function readImportFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > 8 * 1024 * 1024) throw new CaseImportError('FILE_SIZE', 'BYTES', '导入文件最多为8 MiB。');
  if (!bytes.byteLength) throw new CaseImportError('EMPTY_FILE', 'BYTES', '导入文件为空。');
  const sourceSha256 = hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)));
  let text, encoding;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); encoding = 'UTF-8'; }
  catch {
    if (file.name.toLowerCase().endsWith('.json')) throw new CaseImportError('ENCODING_ERROR', 'DECODE', 'JSON文件须使用UTF-8编码。');
    try { text = new TextDecoder('gb18030', { fatal: true }).decode(bytes); encoding = 'GB18030'; }
    catch { throw new CaseImportError('ENCODING_ERROR', 'DECODE', 'CSV编码无法读取，请使用UTF-8或GB18030/GBK兼容编码。'); }
  }
  if (text.includes('\uFFFD')) throw new CaseImportError('ENCODING_ERROR', 'DECODE', '文件含有无法解码的字符。');
  return { text, audit: { sourceSha256, encoding, filename: file.name, byteLength: bytes.byteLength, fields: [] } };
}

export function importFieldRole(stand, field) {
  const feature = MODEL_FEATURES.find(item => item.stand === stand && item.field === field);
  return { feature, role: feature ? 'CANONICAL_MODEL_INPUT' : field === 'target' ? 'TARGET'
    : stand === 'S5' && field === 'force' || field === 'observed' ? 'ACTUAL_CHANNEL' : 'ENGINEERING_CONTEXT' };
}

export function importNumber(raw, { stand = null, field, row, unitSystem, audit, optional = false }) {
  const text = raw?.trim(), source = stand ? `${stand}.${field}` : field;
  const { feature, role } = importFieldRole(stand, field);
  const confirmed = unitSystem === LEGACY_ENGINEERING_UNIT_SYSTEM ? audit?.confirmedLegacyForceUnit
    ? {forceUnit:audit.confirmedLegacyForceUnit,adapter:'EXPLICIT_USER_FORCE_UNIT'} : confirmedLegacyArtifacts[audit?.sourceSha256] : null;
  const force = engineeringField(field) === 'force';
  const sourceUnit = unitSystem === LEGACY_ENGINEERING_UNIT_SYSTEM && force ? confirmed?.forceUnit || 'MN' : unitFor(field);
  const trace = { RAW_TEXT: raw ?? null, PARSED_VALUE: null, SOURCE_FIELD: source, MAPPED_FIELD: feature?.key || source,
    ROLE: role, SOURCE_ROW: row, SOURCE_UNIT_SYSTEM: unitSystem, SOURCE_UNIT: sourceUnit,
    CONVERTED_VALUE: null, CONVERTED_UNIT: unitFor(field), VALID_RANGE: null, VALIDATION_RESULT: 'NOT_CHECKED', FAIL_STAGE: null,
    CONVERSION_RULE: confirmed && force ? confirmed.adapter + ': ' + sourceUnit + ' -> t' + (sourceUnit === 't' ? ' (identity)' : '') : sourceUnit + ' -> ' + unitFor(field) };
  audit?.fields.push(trace);
  const fail = (code, stage, message) => {
    trace.FAIL_STAGE = stage; trace.VALIDATION_RESULT = code;
    throw new CaseImportError(code, stage, `CSV 第${row}行 ${source}：${message}`, { field: source, row, audit });
  };
  if (raw === undefined) {
    if (optional) { trace.VALIDATION_RESULT = 'OPTIONAL_ABSENT'; return undefined; }
    return fail('FIELD_MAPPING_MISSING', 'SCHEMA_MAPPING', '字段不存在或映射缺失。');
  }
  if (text === '') {
    if (optional) { trace.VALIDATION_RESULT = 'OPTIONAL_ABSENT'; return undefined; }
    return fail('REQUIRED_VALUE_MISSING', 'NUMERIC_PARSE', feature ? '未填写必需的模型输入。' : '未填写必需的工况显示字段。');
  }
  if (!numeric(text)) return fail('NUMBER_PARSE_FAILED', 'NUMERIC_PARSE', '数字解析失败，须填写有限数值。');
  trace.PARSED_VALUE = Number(text);
  const value = !unitFor(field) || confirmed?.forceUnit === 't' && force ? trace.PARSED_VALUE : decodeUnitProfile(field, trace.PARSED_VALUE, unitSystem);
  trace.CONVERTED_VALUE = value;
  if (!finite(value)) return fail('UNIT_CONVERSION_FAILED', 'UNIT_MAPPING', '单位转换未得到有限数值。');
  trace.VALIDATION_RESULT = feature ? 'FINITE_CANONICAL_VALUE' : 'FINITE_NON_MODEL_VALUE';
  return value;
}

// Read the same effective bounds as input status, editing and candidate search.
// Actual, Target, S4 force and display geometry never become model inputs here.
export function processDisplayFieldIssues(input) {
  const fields = [['S4', 'force', 'S4 轧制力', false], ['S5', 'force', 'S5 实际轧制力', false], ['S5', 'frontTension', 'S5 前张力', false]];
  return fields.flatMap(([stand, field, label, required]) => {
    const value = input?.stands?.find(item => item.id === stand)?.[field];
    if (!required && (value == null || value === '')) return [];
    return finite(value) ? [] : [{ category: 'PARSER_SCHEMA_ERROR', code: 'PROCESS_DISPLAY_FIELD_INVALID',
      stage: 'PROCESS_CONTEXT_VALIDATION', field: `${stand}.${field}`, value: value ?? null,
      unit: unitFor(field), message: `${label}：${required ? '正式工况须填写有限数值' : '请填写有限数值或留空'}` }];
  });
}

export function validateCaseImport(input, table, limits = {}, audit) {
  const checked = summarizeModelInputs(input), issues = processDisplayFieldIssues(input), warnings = [];
  if (!Array.isArray(input?.stands) || input.stands.length !== 5 || input.stands.some((stand,index)=>stand?.id !== `S${index+1}`))
    issues.push({category:'PARSER_SCHEMA_ERROR',code:'STAND_MAPPING_ERROR',stage:'SCHEMA_MAPPING',message:'工况须包含按S1至S5排列的五个机架。'});
  for (const item of [...checked.missing, ...checked.invalid]) issues.push({ category: 'PARSER_SCHEMA_ERROR', code: 'CANONICAL_INPUT_INVALID',
    stage: 'CANONICAL_MAPPING', field: item.key, value: item.value ?? null, unit: unitFor(item.field), message: item.label + '：' + item.message });
  const projection = effectiveRangeProjection(input, table, limits);
  for (const range of projection.effectiveRanges) {
    const trace = audit?.fields.find(item => item.MAPPED_FIELD === range.parameter_id);
    if (trace) trace.VALID_RANGE = [range.effective_lower, range.effective_upper];
    if (!finite(range.current_value)) continue; // parsing errors cannot become range errors
    if (!finite(range.effective_lower) || !finite(range.effective_upper)) {
      warnings.push({ category: 'RANGE_WARNING', code: 'RANGE_UNAVAILABLE', stage: 'VALIDATOR', field: range.parameter_id, message: range.display_name + '：参考范围无法读取。' });
      continue;
    }
    const outside = range.current_value < range.effective_lower || range.current_value > range.effective_upper;
    if (trace) { trace.VALIDATION_RESULT = outside ? 'TRUE_OUT_OF_RANGE' : 'IN_RANGE'; trace.FAIL_STAGE = null; }
    if (outside) warnings.push({ category: 'TRUE_OUT_OF_RANGE', code: 'TRUE_OUT_OF_RANGE', stage: 'EFFECTIVE_RANGE_VALIDATION',
      field: range.parameter_id, value: range.current_value, unit: range.unit, min: range.effective_lower, max: range.effective_upper,
      source_row: trace?.SOURCE_ROW ?? null, message: `CSV 第${trace?.SOURCE_ROW ?? '?'}行 ${range.display_name} = ${range.current_value} ${range.unit}；有效范围 ${range.effective_lower}～${range.effective_upper} ${range.unit}` });
  }
  return { valid: !issues.length, canonicalDim: checked.total, finiteCount: checked.completeCount, issues, warnings,
    parserSchemaErrors: issues.filter(issue => issue.category === 'PARSER_SCHEMA_ERROR'),
    trueOutOfRange: warnings.filter(issue => issue.category === 'TRUE_OUT_OF_RANGE'), audit };
}

export function assertCaseImportValid(input, table, limits, audit) {
  const report = validateCaseImport(input, table, limits, audit);
  if (!report.valid) {
    const first = report.parserSchemaErrors[0] || report.trueOutOfRange[0];
    const label = report.parserSchemaErrors.length ? '解析 / schema错误' : '真实越界';
    throw new CaseImportError(first.code, first.stage, `${label}（${first.category}）：${report.issues.map(issue => issue.message).join('；')}`, { issues: report.issues, report, audit });
  }
  return report;
}
