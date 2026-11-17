import { summarizeModelInputs } from './modelInputs.js';
import { sha256Hex } from './sha256.js';

export const HISTORICAL_REPLAY_URL = '/assets/crd-dashboard-context.json';
export const HISTORICAL_REPLAY_SOURCE = '工业数据';
const SOURCE_SHA256 = '4ef1f84db39f55cd5b12674d25de0735d98d05a47c83fe1a47335a086bbfde4f';
const ASSET_SHA256 = '838ff44b483133bb49e87b6a65ef80142ee014e911d0d0708de46bdc905e01a6';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

// The bundled sequence has been compared row by row with the frozen workbook.
// These are playback records, not synthetic Demo frames or prediction results.
export function prepareHistoricalReplay(asset, modelHash) {
  if (asset?.schema !== 1 || asset.axis !== 'source-row' || asset.source_sha256 !== SOURCE_SHA256
    || !Array.isArray(asset.frames) || !asset.frames.length)
    fail('HISTORICAL_SOURCE_INVALID', '工业数据来源核验失败。');
  if (!modelHash || asset.model_hash !== modelHash)
    fail('HISTORICAL_MODEL_MISMATCH', '工业数据与当前模型身份不一致。');
  const seen = new Set();
  const frames = asset.frames.map(row => {
    const input = structuredClone(row.input), evidence = input?.importProvenance;
    if (!Number.isInteger(row.sequence) || seen.has(row.sequence) || input?.id !== 'CRD-' + row.sequence
      || evidence?.source_type !== 'PUBLIC_DATA' || !summarizeModelInputs(input).valid)
      fail('HISTORICAL_ROW_INVALID', '工业数据记录或正式输入不完整。');
    seen.add(row.sequence);
    const actual = evidence.observed;
    const missing = actual === null || actual === undefined;
    if ((!missing && (!Number.isFinite(actual) || evidence.observedAvailable === false))
      || (!missing && (actual !== row.observed || actual !== input.stands.find(stand => stand.id === 'S5')?.force))
      || (missing && (row.observed != null || input.stands.find(stand => stand.id === 'S5')?.force != null))
      || (!missing && !evidence.observedSource?.includes('S5 rolling forces')))
      fail('ACTUAL_INVALID', '历史记录的 S5 实际值无效或与原表行不一致。');
    return {
      input, time: row.sequence * 1000, sequence: row.sequence, axis: 'source-row',
      mode: 'import', originMode: 'import', historicalReplay: true, timestampAvailable: false,
      observed: missing ? null : actual, observedAvailable: !missing,
      observedSource: evidence.observedSource || '', target: input.target,
      // Each current row is calculated by the existing formal prediction flow.
      predicted: null,
    };
  });
  if (frames.some((frame, index) => index > 0 && frame.sequence <= frames[index - 1].sequence))
    fail('HISTORICAL_ORDER_INVALID', '工业数据记录顺序无效。');
  return { frames, sourceName: HISTORICAL_REPLAY_SOURCE, sourceId: 'public:crd:' + asset.source_sha256 };
}

export async function loadHistoricalReplay({ modelHash, signal, fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(HISTORICAL_REPLAY_URL, { signal });
  if (!response.ok) fail('HISTORICAL_SOURCE_UNAVAILABLE', '工业数据暂不可用，请刷新重试。');
  const text = await response.text();
  const digest = await sha256Hex(text);
  if (digest !== ASSET_SHA256) fail('HISTORICAL_SOURCE_INVALID', '工业数据文件完整性核验失败。');
  return prepareHistoricalReplay(JSON.parse(text), modelHash);
}
