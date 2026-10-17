import { MODEL_FEATURES, summarizeModelInputs } from './modelInputs.js';
import { ENGINEERING_UNIT_SYSTEM, LEGACY_ENGINEERING_UNIT_SYSTEM, RAW_UNIT_SYSTEM, engineeringField, toDisplay, decodeUnitProfile, supportedUnitProfile } from './engineeringUnits.js';
import { readCSV, csvCell, csvText } from './csv.js';
import { DEFAULT_CASE, predict, validateCase } from './domain.js';

/** Local data sources only. None of these modes is a connected sensor stream. */
export const TELEMETRY_SOURCES = Object.freeze({
  demo: '可复现演示数据',
  manual: '手动输入',
  import: 'CSV 时间序列回放',
});
export const DEMO_START_TIME = '2026-09-26T00:00:00.000Z';
export const DEMO_SAMPLE_INTERVAL_MS = 1000;

const STAND_FIELDS = ['entryThickness', 'exitThickness', 'force', 'tension', 'frontTension', 'bendingForce', 'speed', 'temperature'];
const OPTIONAL_FIELDS = new Set(['entrySetThickness', 'frontTension', 'bendingForce', 'temperature']);
const CASE_FIELDS = ['id', 'steelGrade', 'width', 'entrySetThickness', 'target'];
const TEXT_FIELDS = new Set(['id', 'steelGrade']);
const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const round = (value) => Number(value.toFixed(4));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function assertCase(input, prefix = '') {
  const errors = validateCase(input);
  if (errors.length) throw new Error(`${prefix}${errors.join('；')}`);
}

/** Accept Unix milliseconds or ISO date-times with an explicit timezone. */
function parseTime(value) {
  if (value instanceof Date) value = value.getTime();
  if (typeof value === 'string') {
    value = value.trim();
    if (/^[+-]?\d+$/.test(value)) value = Number(value);
    else {
      const parts = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
      if (!parts) throw new Error('timestamp 须为带时区的 ISO 时间或 Unix 毫秒数。');
      const [, year, month, day, hour, minute, second] = parts.map((part, index) => index > 0 && index < 7 ? Number(part) : part);
      const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
      if (month < 1 || month > 12 || day < 1 || day > days || hour > 23 || minute > 59 || second > 59) {
        throw new Error('timestamp 包含无效日期或时间。');
      }
      value = Date.parse(value.replace(' ', 'T'));
    }
  }
  if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) {
    throw new Error('timestamp 必须是有效的毫秒时间。');
  }
  return value;
}

function makeFrame(input, timestamp, mode, index = 0, metadata = {}, options = {}) {
  if(options.calculate===false || options.result?.mode==='formal') { const validation=summarizeModelInputs(input);if(!validation.valid)throw new Error('25 维输入尚未齐全'); } else assertCase(input);
  const time = parseTime(timestamp);
  const snapshot = structuredClone(input);
  const result = options.result ? structuredClone(options.result) : options.calculate === false ? null : predict(snapshot);
  const draft = snapshot.importProvenance?.source_type === 'HYPOTHETICAL_DRAFT';
  return {
    timestamp: new Date(time).toISOString(), time, index, mode,
    source: draft ? '工况草案' : TELEMETRY_SOURCES[mode], sourceLabel: draft ? '工况草案' : TELEMETRY_SOURCES[mode],
    isLive: false,
    input: snapshot, result,
    // S5 force is an independent input channel, never synthesized from result.value.
    observed: snapshot.stands[4].force,
    observedSource: draft ? '草案尚无实际观测' : mode === 'demo' ? '演示工况 S5.force' : '手动输入 S5.force',
    predicted: result?.value ?? null,
    target: snapshot.target,
    ...metadata,
  };
}

/** Commit one complete manual input snapshot; callers choose when to append it. */
export function createManualFrame(input, timestamp = Date.now(), options = {}) {
  return makeFrame(input, timestamp, 'manual', 0, {}, options);
}

// A fixed-seed oscillator produces continuous signals without mutable RNG state.
// Advancing, seeking, or replaying the same frame always gives the same values.
function seededPhase(channel) {
  let state = (0x5d4b514b ^ Math.imul(channel + 1, 2654435761)) >>> 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) / 4294967296 * Math.PI * 2;
}

function signal(seconds, channel, delay) {
  const phase = seededPhase(channel);
  const evaluate = (t) => (Math.sin(t / 11 + phase) * .72 + Math.sin(t / 4.9 + phase * .63) * .28);
  return (evaluate(seconds - delay) - evaluate(-delay)) * .5;
}

/** One 1-second sample of visibly changing, explicitly simulated line conditions. */
export function createDemoFrame(baseCase = DEFAULT_CASE, index = 0, startTime = DEMO_START_TIME, options = {}) {
  assertCase(baseCase);
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('演示帧序号须为非负整数。');
  const input = structuredClone(baseCase);
  const running = input.stands.some((stand) => stand.speed > 0);
  if (running) input.stands.forEach((stand, standIndex) => {
    const delay = standIndex * 2.3;
    const load = signal(index, 1, delay);
    const local = signal(index, standIndex + 5, delay);
    stand.force = round(clamp(stand.force * (1 + .075 * load + .012 * local), 1, 10000));
    stand.speed = round(clamp(stand.speed * (1 + .035 * signal(index, 2, delay)), 0, 3000));
    stand.tension = round(clamp(stand.tension * (1 + .07 * signal(index, 3, delay)), 0, 200));
    if (stand.frontTension !== undefined) stand.frontTension = round(clamp(stand.frontTension * (1 + .055 * signal(index, 3, delay + 1)), 0, 200));
    if (stand.bendingForce !== undefined) stand.bendingForce = round(clamp(stand.bendingForce * (1 + .04 * local), 0, 1000));
  });
  const timestamp = parseTime(startTime) + index * DEMO_SAMPLE_INTERVAL_MS;
  // New simulated samples use the frame's DEMO provenance, never the public
  // observation from the baseline. Manual edits then use the completed sample.
  delete input.importProvenance;
  return makeFrame(input, timestamp, 'demo', index, { originMode: 'demo', seed: 'DKQKAR-2026' }, options);
}

// Optional time-series metadata is not a model input. Validate supplied values
// while leaving absent display, Target and Actual fields empty.
function telemetryCaseErrors(input) {
  const missing=value=>value==null||typeof value==='string'&&!value.trim();
  const errors=[];
  if(!Array.isArray(input?.stands)||input.stands.length!==5||input.stands.some((s,i)=>s?.id!==`S${i+1}`))errors.push('工况须包含按S1至S5排列的五个机架。');
  if(!missing(input?.target)&&!Number.isFinite(input.target))errors.push('目标 S5 轧制力（t）必须是有限数值。');
  const labels={entryThickness:'入口厚度（mm）',exitThickness:'出口厚度（mm）',force:'轧制力（t）',tension:'后张力（t）',
    speed:'速度（m/min）',bendingForce:'弯辊力（kN）',frontTension:'前张力（t）',temperature:'展示温度（℃）'};
  for(const stand of input?.stands||[])for(const field of STAND_FIELDS){
    if(!missing(stand[field])&&!Number.isFinite(stand[field]))errors.push(`${stand.id} ${labels[field]}必须是有限数值。`);
  }
  const complete=summarizeModelInputs(input);
  return [...complete.missing,...complete.invalid].map(item=>item.label+'：'+item.message)
    .concat(errors);
}

function fieldAddress(column) {
  if (CASE_FIELDS.includes(column)) return { field: column, stand: null };
  const match = /^(S[1-5])\.([A-Za-z]+)$/.exec(column);
  return match && STAND_FIELDS.includes(match[2]) ? { field: match[2], stand: Number(match[1][1]) - 1 } : null;
}

/**
 * Import complete model inputs from the file only. Optional empty cells retain
 * no value. sourceMode preserves
 * the provenance of exported demo/manual data when it is imported again.
 */
export function parseTelemetryCSV(text, baseCase = DEFAULT_CASE, options = {}) {
  const rows = readCSV(text);
  if (rows.length < 2) throw new Error('CSV 须包含表头和至少一条时间数据。');
  const headers = rows[0].map((header) => header.trim());
  if (!headers.includes('timestamp')) throw new Error('这是单工况 CSV，请使用“导入单工况 CSV”入口。时序 CSV 须有 timestamp 时间列。');
  if (new Set(headers).size !== headers.length) throw new Error('CSV 表头列名重复。');
  for (const header of headers) {
    if (!['timestamp', 'sourceMode', 'observedAvailable', 'observed', 'observedSource', 'unitSystem'].includes(header) && !fieldAddress(header)) throw new Error(`未知 CSV 列：${header || '空列名'}。`);
  }
  const requiredColumns=MODEL_FEATURES.map(feature=>feature.stand?`${feature.stand}.${feature.field}`:feature.field);
  const missingColumns=requiredColumns.filter(column=>!headers.includes(column));
  if(missingColumns.length)throw new Error('CSV 25 维输入列缺失：'+missingColumns.join('、')+'。');
  let previousTime = -Infinity;
  return rows.slice(1).map((cells, index) => {
    const prefix = `CSV 第 ${index + 2} 行：`;
    if (cells.length !== headers.length) throw new Error(`${prefix}列数须与表头一致。`);
    const time = (() => { try { return parseTime(cells[headers.indexOf('timestamp')]); } catch (error) { throw new Error(prefix + error.message); } })();
    if (time <= previousTime) throw new Error(`${prefix}timestamp 须严格递增，不能重复或倒序。`);
    previousTime = time;
    // No current-case field or previous-frame value supplies missing CSV data.
    const input = {id:'',steelGrade:'',target:null,stands:Array.from({length:5},(_,i)=>({id:`S${i+1}`,force:null}))};
    const unitIndex=headers.indexOf('unitSystem');
    const unitSystem=unitIndex<0?RAW_UNIT_SYSTEM:cells[unitIndex].trim();
    if (!supportedUnitProfile(unitSystem)) throw new Error(prefix+'unitSystem 须为 canonical-engineering-v2、raw-v1 或明确标记的旧版 engineering-v1。');
    if(options.legacyForceUnit!==undefined&&!['t','MN'].includes(options.legacyForceUnit))throw new Error('原始轧制力单位须为t或MN。');
    const decode=(field,value)=>unitSystem===LEGACY_ENGINEERING_UNIT_SYSTEM&&options.legacyForceUnit==='t'&&engineeringField(field)==='force'
      ? value:decodeUnitProfile(field,value,unitSystem);
    const sourceIndex = headers.indexOf('sourceMode');
    const originMode = sourceIndex < 0 ? 'import' : cells[sourceIndex].trim();
    if (!Object.hasOwn(TELEMETRY_SOURCES, originMode)) throw new Error(`${prefix}sourceMode 须为 demo、manual 或 import。`);
    headers.forEach((header, columnIndex) => {
      const address = fieldAddress(header);
      if (!address) return;
      const value = cells[columnIndex].trim();
      const target = address.stand === null ? input : input.stands[address.stand];
      if (TEXT_FIELDS.has(header)) target[address.field] = csvText(value);
      else if (!value && !requiredColumns.includes(header)) target[address.field]=null;
      else if (!NUMERIC.test(value) || !Number.isFinite(Number(value))) throw new Error(`${prefix}${header} 必须填写有限数值。`);
      else target[address.field] = decode(address.field,Number(value));
    });
    const validation=summarizeModelInputs(input);
    if(!validation.valid)throw new Error(prefix+'25 维输入无效：'+validation.issues.map(item=>item.field+' '+item.message).join('；'));
    const errors=telemetryCaseErrors(input);
    if(errors.length)throw new Error(prefix+errors.join('；'));
    const importedFields = headers.filter((header) => fieldAddress(header));
    const source = originMode === 'import' ? TELEMETRY_SOURCES.import : `CSV 回放 · ${TELEMETRY_SOURCES[originMode]}`;
    const availableIndex = headers.indexOf('observedAvailable');
    const availability = availableIndex < 0 ? '' : cells[availableIndex].trim();
    if (availability && !['0', '1'].includes(availability)) throw new Error(`${prefix}observedAvailable 须为 0 或 1。`);
    const observedIndex=headers.indexOf('observed'), observedText=observedIndex<0?null:cells[observedIndex].trim();
    if(observedText && (!NUMERIC.test(observedText)||!Number.isFinite(Number(observedText))))throw new Error(prefix+'observed 必须填写有限数值。');
    // The supplied S5 force cell owns the actual channel, including an empty
    // cell. Legacy observation-only files keep their independent channel.
    const hasS5Force=headers.includes('S5.force');
    const measured=hasS5Force?input.stands[4].force:observedText?decode('force',Number(observedText)):null;
    const observedAvailable=Number.isFinite(measured)&&(hasS5Force||availability!== '0');
    if(!hasS5Force&&availability==='1'&&!Number.isFinite(measured))throw new Error(prefix+'实际值标记存在时须提供实际值。');
    const observedSourceIndex=headers.indexOf('observedSource');
    const suppliedSource=observedSourceIndex>=0?csvText(cells[observedSourceIndex]):'';
    const observedSource=suppliedSource || (observedAvailable?`${source} ${hasS5Force?'S5.force':'observed'}`:'CSV 未提供对应实际值');
    return makeFrame(input, time, 'import', index, { source, sourceLabel: source, originMode, importedFields, observedSource, observedAvailable, observed: observedAvailable?measured:null,
      ...(unitSystem===LEGACY_ENGINEERING_UNIT_SYSTEM&&options.legacyForceUnit?{importUnitDecision:{declaredProfile:unitSystem,forceUnit:options.legacyForceUnit,source:'EXPLICIT_USER_CONFIRMATION'}}:{}) }, {...options,calculate:false,result:null});
  });
}

/** Export complete inputs, timestamp and source provenance; predictions recalculate on import. */
export function framesToCSV(frames, options = {}) {
  const formalTemplate = options?.mode === 'FORMAL_TIMESERIES_TEMPLATE';
  if (!formalTemplate && (!Array.isArray(frames) || !frames.length)) throw new Error('请先产生或导入时间序列数据。');
  const columns = ['timestamp', ...(!formalTemplate ? ['sourceMode'] : []), 'observedAvailable', 'observed', 'observedSource', 'unitSystem', ...CASE_FIELDS, ...Array.from({ length: 5 }, (_, index) => STAND_FIELDS.map((field) => `S${index + 1}.${field}`)).flat()];
  if (formalTemplate) return '\uFEFF' + [columns.join(',')].join('\r\n');
  let previousTime = -Infinity;
  const rows = frames.map((frame, index) => {
    const errors = telemetryCaseErrors(frame.input);
    if (errors.length) throw new Error(`第 ${index + 1} 帧：${errors.join('；')}`);
    const timestampAvailable = frame.timestampAvailable !== false;
    const time = parseTime(timestampAvailable ? frame.timestamp : frame.time);
    if (time <= previousTime) throw new Error('导出时间序列须严格递增。');
    previousTime = time;
    const originMode = frame.originMode ?? frame.mode;
    if (!Object.hasOwn(TELEMETRY_SOURCES, originMode)) throw new Error('导出帧缺少有效的数据来源。');
    return columns.map((column) => {
      if (column === 'timestamp') return timestampAvailable ? new Date(time).toISOString() : '';
      if (column === 'sourceMode') return originMode;
      if (column === 'unitSystem') return ENGINEERING_UNIT_SYSTEM;
      if (column === 'observedAvailable') return !Number.isFinite(frame.observed) || frame.observedAvailable === false ? 0 : 1;
      if (column === 'observed') return frame.observedAvailable===false?null:toDisplay('force',frame.observed);
      if (column === 'observedSource') return frame.observedSource || '';
      if (column === 'S5.force' && originMode !== 'demo') return frame.observedAvailable === false ? null : toDisplay('force', frame.observed);
      const { stand, field } = fieldAddress(column);
      const value=(stand === null ? frame.input : frame.input.stands[stand])[field];
      return TEXT_FIELDS.has(field)?value:toDisplay(field,value);
    }).map(csvCell).join(',');
  });
  return '\uFEFF' + [columns.join(','), ...rows].join('\r\n');
}

/** Header-only formal schema template, independent of current inputs and results. */
export function timeseriesTemplateCSV() {
  return framesToCSV([], { mode: 'FORMAL_TIMESERIES_TEMPLATE' });
}
