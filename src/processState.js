import { readCSV, assertCSVHeaders, csvCell, csvText } from './csv.js';
import { ENGINEERING_UNIT_SYSTEM, RAW_UNIT_SYSTEM, encodeUnitProfile, supportedUnitProfile, unitFor } from './engineeringUnits.js';
import { CaseImportError, importNumber, readImportFile, resolveLegacyCsvUnits } from './caseImportBoundary.js';
import { isModelInput } from './modelInputs.js';
export function updateStandField(caseData, standId, field, value) {
  const index = caseData.stands.findIndex(stand => stand.id === standId);
  if (index < 0) return caseData;
  const stands = caseData.stands.map(stand => ({ ...stand }));
  stands[index][field] = value;
  if (field === 'exitThickness' && index < stands.length - 1) stands[index + 1].entryThickness = value;
  if (field === 'entryThickness' && index > 0) stands[index - 1].exitThickness = value;
  return { ...caseData, stands };
}

export const CSV_FIELDS = ['entryThickness', 'exitThickness', 'force', 'tension', 'frontTension', 'bendingForce', 'speed'];
const OPTIONAL_CSV_FIELDS = ['temperature'];
const CASE_CSV_FIELDS = ['caseId', 'steelGrade', 'width', 'entrySetThickness', 'target'];
const SOURCE_DETAIL_FIELDS = ['sourceName', 'source_url', 'display_geometry_note', 'target_source'];
const PROVENANCE_FIELDS = ['source_type', 'sample_timestamp', 'observedAvailable', 'observed', 'observedSource', ...SOURCE_DETAIL_FIELDS];
const SOURCE_TYPES = new Set(['DEMO', 'MANUAL', 'CSV_REPLAY', 'PUBLIC_DATA', 'HYPOTHETICAL_DRAFT', 'UNKNOWN']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function sourceTimestamp(value) {
  if (value === undefined || value === null || value === '') return null;
  const parts = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  const [, year, month, day, hour, minute, second] = parts || [];
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (!parts || !Number.isFinite(Date.parse(value)) || Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > days || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) throw new Error('sample_timestamp 须为有效的带时区 ISO 时间。');
  return new Date(value).toISOString();
}
function provenance(input, meta, defaultSource) {
  const source_type = meta.source_type ?? defaultSource;
  if (!SOURCE_TYPES.has(source_type)) throw new Error('source_type 须为 DEMO、MANUAL、CSV_REPLAY、PUBLIC_DATA、HYPOTHETICAL_DRAFT 或 UNKNOWN。');
  if (own(meta, 'observedAvailable') && typeof meta.observedAvailable !== 'boolean') throw new Error('observedAvailable 必须为布尔值。');
  const explicit = own(meta, 'observed') || own(meta, 'observedAvailable');
  const observed = meta.observedAvailable === false ? null : explicit ? meta.observed : input.stands?.find(stand => stand.id === 'S5')?.force;
  if (observed !== null && observed !== undefined && (typeof observed !== 'number' || !Number.isFinite(observed))) throw new Error('实际值必须为有限数值或明确缺失。');
  if (meta.observedAvailable === true && !Number.isFinite(observed)) throw new Error('实际值标记为存在时须同时提供 observed。');
  const available = Number.isFinite(observed);
  return {
    source_type, sample_timestamp: sourceTimestamp(meta.sample_timestamp),
    ...Object.fromEntries(SOURCE_DETAIL_FIELDS.filter(key => typeof meta[key] === 'string' && meta[key]).map(key => [key, meta[key]])),
    observedAvailable: available, observed: available ? observed : null,
    observedSource: typeof meta.observedSource === 'string' ? meta.observedSource : available ? '工况输入 S5.force' : '未提供对应实际值',
  };
}

/** CSV declares its unit profile. Current exports and JSON use canonical values;
 * legacy engineering-v1 force values convert once on import. */
export function caseToCSV(input, metadata = {}) {
  const columns = ['id', ...CSV_FIELDS, ...OPTIONAL_CSV_FIELDS, ...CASE_CSV_FIELDS, ...PROVENANCE_FIELDS, 'unitSystem'];
  if (metadata.mode === 'FORMAL_SINGLE_CONDITION_TEMPLATE') return '\uFEFF' + columns.join(',');
  const context = provenance(input, { ...(input.importProvenance || {}), ...metadata }, 'MANUAL');
  const unitSystem = metadata.unitSystem ?? ENGINEERING_UNIT_SYSTEM;
  if (!supportedUnitProfile(unitSystem)) throw new Error('不支持的 CSV 单位方案。');
  const encode = (field, value) => unitFor(field) && typeof value === 'number' ? encodeUnitProfile(field, value, unitSystem) : value;
  const rows = input.stands.map(stand => columns.map(field => {
    if (field === 'unitSystem') return unitSystem;
    if (field === 'caseId') return input.id;
    if (CASE_CSV_FIELDS.includes(field)) return encode(field, input[field]);
    if (field === 'observedAvailable') return context.observedAvailable ? 1 : 0;
    if (PROVENANCE_FIELDS.includes(field)) return encode(field, context[field]);
    if (stand.id === 'S5' && field === 'force' && context.source_type !== 'DEMO') return encode(field, context.observedAvailable ? context.observed : null);
    return encode(field, stand[field]);
  }).map(csvCell).join(','));
  return '\uFEFF' + [columns.join(','), ...rows].join('\r\n');
}

export function singleConditionTemplateCSV() {
  return caseToCSV(null, { mode: 'FORMAL_SINGLE_CONDITION_TEMPLATE' });
}

export function parseCaseImport(text, filename, currentCase, options = {}) {
  try { return parseCaseText(text, filename, currentCase, options); }
  catch (error) {
    if (error instanceof CaseImportError) throw error;
    throw new CaseImportError('CSV_SCHEMA_ERROR', 'CSV_PARSER_OR_SCHEMA', error.message, { audit: options.audit });
  }
}

export async function parseCaseFile(file, currentCase, {chooseLegacyUnits} = {}) {
  const { text, audit } = await readImportFile(file);
  if(!file.name.toLowerCase().endsWith('.json'))await resolveLegacyCsvUnits(text,audit,chooseLegacyUnits);
  const input = parseCaseImport(text, file.name, currentCase, { audit, requireCanonicalSource: true });
  return { input, audit };
}

function parseCaseText(text, filename, currentCase, options) {
  if (filename.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
    const input = parsed.input || parsed.caseData || parsed;
    const report = parsed.report;
    const externalMeta = parsed.meta || report?.meta;
    if (!externalMeta && !input.importProvenance) return input;
    const meta = { ...(input.importProvenance || {}), ...(externalMeta || {}) };
    if (report?.summary && !own(meta, 'observed')) meta.observed = report.summary.observed;
    if (report?.summary && !own(meta, 'observedAvailable')) meta.observedAvailable = report.summary.observedAvailable;
    if (!meta.source_type && report?.meta?.dataSource) meta.source_type = report.meta.dataSource;
    return { ...input, importProvenance: provenance(input, meta, 'UNKNOWN') };
  }
  const rows = readCSV(text);
  const headers = (rows.shift() || []).map(value => value.trim());
  if (headers.includes('timestamp') || headers.some(field => /^S[1-5]\./.test(field))) throw new Error('这是时序 CSV，请使用“导入时序 CSV”入口。');
  assertCSVHeaders(headers, ['id', ...CSV_FIELDS, ...OPTIONAL_CSV_FIELDS, ...CASE_CSV_FIELDS, ...PROVENANCE_FIELDS, 'unitSystem']);
  const requiredColumns = ['id', 'entryThickness', 'force', 'tension', 'frontTension', 'bendingForce', 'speed'];
  const missingColumns = requiredColumns.filter(key => !headers.includes(key));
  if (missingColumns.length) throw new CaseImportError('FIELD_MAPPING_MISSING', 'SCHEMA_MAPPING', 'CSV列名缺失：' + missingColumns.join('、'), { audit: options.audit });
  if (!rows.length) throw new Error('CSV 须包含五机架数据。');
  const records = rows.map((cells, rowIndex) => {
    if (cells.length !== headers.length) throw new Error(`CSV 第 ${rowIndex + 2} 行列数与表头不一致。`);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
  });
  if (records.length !== 5 || records.some((record, index) => record.id.trim() !== `S${index + 1}`)) throw new CaseImportError('STAND_MAPPING_ERROR', 'SCHEMA_MAPPING', 'CSV须包含按S1至S5排列的五条机架记录。', { audit: options.audit });
  const globalFields = [...CASE_CSV_FIELDS, ...PROVENANCE_FIELDS, 'unitSystem'].filter(field => headers.includes(field));
  for (const field of globalFields) if (records.some(record => record[field] !== records[0][field])) throw new Error(`CSV 的 ${field} 在五机架行中必须一致。`);
  const unitSystem = headers.includes('unitSystem') ? records[0].unitSystem.trim() : RAW_UNIT_SYSTEM;
  if (!supportedUnitProfile(unitSystem)) throw new CaseImportError('UNSUPPORTED_UNIT_PROFILE', 'SCHEMA_ADAPTER', '旧模板版本或单位方案不受支持，请使用新版模板；支持canonical-engineering-v2、raw-v1及engineering-v1兼容器。', { audit: options.audit });
  const audit = options.audit || { fields: [] };
  audit.declaredUnitSystem = unitSystem;
  const incoming = structuredClone(currentCase);
  delete incoming.importProvenance;
  incoming.stands = records.map((record, rowIndex) => Object.fromEntries(['id', ...CSV_FIELDS, ...OPTIONAL_CSV_FIELDS.filter(field => headers.includes(field))].map(key => {
    const stand = record.id.trim();
    if (key === 'id') return [key, csvText(stand)];
    const value = importNumber(record[key], { stand, field: key, row: rowIndex + 2, unitSystem, audit,
      optional: !isModelInput(stand, key) });
    return [key, stand === 'S5' && ['force', 'frontTension'].includes(key) ? value ?? null : value];
  })));
  const first = records[0];
  incoming.id = headers.includes('caseId') ? csvText(first.caseId) : 'IMP-' + Date.now().toString().slice(-6);
  if (headers.includes('steelGrade')) incoming.steelGrade = csvText(first.steelGrade);
  for (const field of ['width', 'entrySetThickness', 'target'].filter(field => headers.includes(field))) {
    incoming[field] = importNumber(first[field], { field, row: 2, unitSystem, audit, optional: field === 'target' });
  }
  if (options.requireCanonicalSource) for (const field of ['width', 'entrySetThickness'].filter(field => !headers.includes(field))) {
    incoming[field] = importNumber(undefined, { field, row: 2, unitSystem, audit });
  }
  if (options.requireCanonicalSource && !headers.includes('target')) delete incoming.target;
  const meta = {};
  if (headers.includes('source_type') && first.source_type.trim()) meta.source_type = first.source_type.trim();
  if (headers.includes('sample_timestamp')) meta.sample_timestamp = first.sample_timestamp.trim();
  if (headers.includes('observedSource')) meta.observedSource = csvText(first.observedSource);
  for (const key of SOURCE_DETAIL_FIELDS) if (headers.includes(key)) meta[key] = csvText(first[key]);
  if (headers.includes('observedAvailable')) {
    const available = first.observedAvailable.trim();
    if (available && !['0', '1'].includes(available)) throw new Error('CSV observedAvailable 须为 0 或 1。');
    if (available) meta.observedAvailable = available === '1';
  }
  if (headers.includes('observed')) {
    meta.observed = importNumber(first.observed, { field: 'observed', row: 2, unitSystem, audit, optional: true }) ?? null;
  }
  // The formal single-condition force cell supplies the actual channel. It
  // cannot inherit a previous actual or an obsolete availability flag.
  if (meta.source_type !== 'DEMO') {
    if (Number.isFinite(incoming.stands[4].force) && meta.observedAvailable !== true) meta.observedSource = 'CSV S5.force';
    meta.observed = incoming.stands[4].force;
    meta.observedAvailable = Number.isFinite(meta.observed);
  }
  incoming.importProvenance = provenance(incoming, meta, 'CSV_REPLAY');
  if(audit.unitDecisionSource)incoming.importProvenance.importUnitDecision={declaredProfile:unitSystem,forceUnit:audit.confirmedLegacyForceUnit,source:audit.unitDecisionSource};
  return incoming;
}
