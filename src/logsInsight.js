import { DEFAULT_PREDICTION_ERROR_ALARM_RANGE, predictionErrorAlarm, validatePredictionErrorAlarmRange } from './predictionErrorAlarm.js';

const LEVEL_ALIASES = { warn: 'warning' };
export const LOG_LEVEL_LABELS = { info: '信息', success: '成功', warning: '警告', error: '错误', critical: '严重' };
export const LOG_LEVEL_TONES = { info: '#5b8098', success: '#4ed7a6', warning: '#e6b263', error: '#ee8487', critical: '#f16167' };

export function normalizeLogLevel(value) {
  const level = String(value || 'info').toLowerCase();
  return LEVEL_ALIASES[level] || level;
}
export const logCategoryKey = value => ({ prediction: 'model', auth: 'system', ai: 'agent' })[value] || value || 'other';
export const logTime = item => {
  const time = Date.parse(item?.createdAt);
  return Number.isFinite(time) ? time : null;
};
export function isPredictionRecord(item) {
  return item?.category === 'prediction'
    && (Number.isFinite(item.details?.rawPrediction) || /S5\s*(?:轧制力)?预测已完成/.test(item.message || ''));
}
export function logAlarmRange(details) {
  return validatePredictionErrorAlarmRange(details?.predictionErrorAlarmRangeSnapshot)
    || validatePredictionErrorAlarmRange(details?.predictionErrorAlarmRange)
    || DEFAULT_PREDICTION_ERROR_ALARM_RANGE;
}

// Buckets every record into whole minutes so the density strip is stable even
// when the newest record moves between refreshes.
function densityBins(minuteCounts, endTime, size = 30) {
  if (endTime === null) return { bins: [], peak: 0, start: null, end: null };
  const endMinute = Math.floor(endTime / 60000) * 60000;
  const bins = [];
  let peak = 0;
  for (let index = size - 1; index >= 0; index -= 1) {
    const minute = endMinute - index * 60000;
    const count = minuteCounts.get(Math.floor(minute / 60000)) || 0;
    peak = Math.max(peak, count);
    bins.push({ minute, count });
  }
  return { bins, peak, start: bins[0].minute, end: endMinute + 59999 };
}

/**
 * Builds every number the log overview needs from one sample of records.
 * Only observed fields are used: no deviation is synthesised for a record that
 * has no actual value, and each point is judged against its own snapshot range.
 */
export function buildLogInsight(items = [], { maxPoints = 72, densitySize = 30 } = {}) {
  const levels = { info: 0, success: 0, warning: 0, error: 0, critical: 0 };
  const categories = {};
  const minuteCounts = new Map();
  const predictions = [];
  let latestAt = null;

  for (const item of items) {
    const level = normalizeLogLevel(item?.level);
    levels[level] = (levels[level] || 0) + 1;
    const category = logCategoryKey(item?.category);
    categories[category] = (categories[category] || 0) + 1;
    const time = logTime(item);
    if (time !== null) {
      if (latestAt === null || time > latestAt) latestAt = time;
      const minute = Math.floor(time / 60000);
      minuteCounts.set(minute, (minuteCounts.get(minute) || 0) + 1);
    }
    if (!isPredictionRecord(item)) continue;
    const details = item.details || {};
    const rawPrediction = Number.isFinite(details.rawPrediction) ? details.rawPrediction : null;
    if (rawPrediction === null) continue;
    const actualValue = Number.isFinite(details.actualValue) ? details.actualValue : null;
    const range = logAlarmRange(details);
    const alarm = actualValue === null ? null : predictionErrorAlarm(rawPrediction, actualValue, range);
    predictions.push({
      id: item.id, time, rawPrediction, actualValue, range,
      deviation: actualValue === null ? null : rawPrediction - actualValue,
      inRange: alarm ? alarm.status === 'NORMAL' : null, exceedance: alarm?.exceedance ?? 0,
    });
  }

  predictions.sort((left, right) => (left.time ?? 0) - (right.time ?? 0));
  const paired = predictions.filter(point => point.deviation !== null);
  const normal = paired.filter(point => point.inRange === true);
  const breaches = paired.filter(point => point.inRange === false);
  const absolute = paired.map(point => Math.abs(point.deviation));
  const worst = paired.reduce((max, point) => (!max || Math.abs(point.deviation) > Math.abs(max.deviation) ? point : max), null);
  const points = paired.slice(-maxPoints);
  const range = points.length ? points[points.length - 1].range : DEFAULT_PREDICTION_ERROR_ALARM_RANGE;

  return {
    total: items.length,
    latestAt,
    levels,
    categories,
    predictions: {
      sampled: predictions.length,
      paired: paired.length,
      normal: normal.length,
      breaches: breaches.length,
      passRate: paired.length ? normal.length / paired.length : null,
      meanAbs: absolute.length ? absolute.reduce((sum, value) => sum + value, 0) / absolute.length : null,
      maxAbs: absolute.length ? Math.max(...absolute) : null,
      worst,
      points,
      range,
    },
    density: densityBins(minuteCounts, latestAt, densitySize),
  };
}
