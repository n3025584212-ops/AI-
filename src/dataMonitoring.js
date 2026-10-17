import { MODEL_FEATURES, modelInputValues, summarizeModelInputs } from './modelInputs.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const deviation = (values, average) => Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(1, values.length - 1));
const frameInput = frame => frame?.input ?? frame?.caseData ?? frame;
export const DRIFT_METHOD = '相邻不重叠窗口均值差 / 基准窗口样本标准差';

/** Descriptive input drift only. Windows end at the current replay position;
 * future samples and S5 labels never participate. This is not model accuracy. */
export function monitorData({ mode = 'single', input, frames = [], currentIndex, referenceRanges,
  minimumWindow = 10, windowSize = 20, driftThreshold = 1 } = {}) {
  const validation = {...summarizeModelInputs(input, { referenceRanges }),
    rangeSource:referenceRanges ? '当前参考范围：用户自定义 / 默认输入参考范围' : '未提供参考范围'};
  const result = { validation, completeness: validation, outOfRange: validation.outOfRange, drift: null };
  if (!['time-series', 'timeseries', 'timeSeries', 'series'].includes(mode)) {
    result.drift = { enabled: false, status: 'DISABLED', reason: '单工况仅检查输入完整度与越界。', features: [], driftedCount: 0 };
    return result;
  }
  const minimum = Math.max(2, Math.trunc(minimumWindow) || 10);
  const desired = Math.max(minimum, Math.trunc(windowSize) || 20);
  const end = Number.isInteger(currentIndex) ? Math.max(-1, Math.min(currentIndex, frames.length - 1)) : frames.length - 1;
  const seen = frames.slice(0, end + 1).map((frame, index) => ({ index, values: modelInputValues(frameInput(frame)) }));
  const size = Math.min(desired, Math.floor(seen.length / 2));
  const currentWindow = seen.slice(-size || seen.length);
  const referenceWindow = seen.slice(Math.max(0, seen.length - 2 * size), seen.length - size);
  const windows = { reference: referenceWindow.length ? { startIndex: referenceWindow[0].index, endIndex: referenceWindow.at(-1).index, count: referenceWindow.length } : null,
    current: currentWindow.length ? { startIndex: currentWindow[0].index, endIndex: currentWindow.at(-1).index, count: currentWindow.length } : null };
  if (size < minimum || [...referenceWindow, ...currentWindow].some(row => !row.values.every(finite))) {
    result.drift = { enabled: true, status: 'INSUFFICIENT_DATA', reason: size < minimum ? `至少需要 ${minimum * 2} 条已到达的完整样本，基准与当前窗口各 ${minimum} 条。` : '窗口内存在不完整的 25 维样本。',
      seenCount: seen.length, minimumSamples: minimum * 2, windows, features: [], driftedCount: 0, method: DRIFT_METHOD };
    return result;
  }
  const features = MODEL_FEATURES.map((feature, index) => {
    const referenceValues = referenceWindow.map(row => row.values[index]), currentValues = currentWindow.map(row => row.values[index]);
    const referenceMean = mean(referenceValues), currentMean = mean(currentValues), referenceStd = deviation(referenceValues, referenceMean);
    const meanShift = currentMean - referenceMean;
    const constantBaseline = referenceStd <= Number.EPSILON * Math.max(1, Math.abs(referenceMean));
    const changedConstant = constantBaseline && Math.abs(meanShift) > Number.EPSILON * Math.max(1, Math.abs(referenceMean)) * 10;
    const score = constantBaseline ? changedConstant ? null : 0 : Math.abs(meanShift) / referenceStd;
    return { ...feature, referenceMean, currentMean, referenceStd, meanShift, score, constantBaseline,
      drifted: changedConstant || (!constantBaseline && score >= driftThreshold) };
  });
  const driftedCount = features.filter(feature => feature.drifted).length;
  result.drift = { enabled: true, status: driftedCount ? 'DRIFT_DETECTED' : 'STABLE', seenCount: seen.length, windows,
    features, driftedCount, threshold: driftThreshold, method: DRIFT_METHOD,
    reason: driftedCount ? `${driftedCount} 个模型输入的窗口均值发生变化。` : '当前与基准窗口未触发均值漂移阈值。',
    note: '输入窗口比较；不作为模型预测误差或生产异常结论。' };
  return result;
}
