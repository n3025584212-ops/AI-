import { actualDisplayText } from './s5ActualDisplay.js';
import { MODEL_INPUT_COUNT } from './modelInputs.js';
// Display text only: no input, matching, range or prediction calculations.
export const REFERENCE_RANGE_NOTICE = '仅表示已检查输入未超出参考范围，不代表工艺正常或安全。';

// Project the existing read/validation results; never infer unread fields from
// a failed range check or treat a retained PLC snapshot as live data.
export function dashboardInputDisplay(summary, checked, plcStatus = null) {
  const plc = plcStatus !== null;
  const count = value => Number.isInteger(value) && value >= 0 ? Math.min(value, MODEL_INPUT_COUNT) : 0;
  const readCount = plc ? count(plcStatus.readCount) : MODEL_INPUT_COUNT - (summary?.missing?.length ?? MODEL_INPUT_COUNT);
  const finiteCount = count(summary?.completeCount);
  const validCount = plc ? Math.min(readCount, count(plcStatus.validCount), finiteCount) : finiteCount;
  const complete = readCount === MODEL_INPUT_COUNT;
  const valid = complete && validCount === MODEL_INPUT_COUNT && summary?.valid === true;
  const live = !plc || plcStatus.realtimeReady === true && (plcStatus.dataQuality ?? plcStatus.quality) === 'GOOD';
  return {readCount, validCount, complete, valid, predictionAllowed: valid && live,
    communicationStopped: plc && ['STALE','DISCONNECTED'].includes(plcStatus.dataQuality ?? plcStatus.quality),
    pausedText: '暂停，等待完整有效工况'};
}

export function dataSourceDisplayName(value) {
  return ['演示数据', '可复现演示数据', '演示工况'].includes(value) ? '工业数据'
    : typeof value === 'string' ? value.replaceAll('当前分析工况','当前工况').replaceAll('工况草案','方案工况') : value;
}

export function modelStateDisplay(modelStatus, dirty = false) {
  const status = String(modelStatus?.status || '').toUpperCase();
  const ready = !['BLOCKED', 'FAILED', 'ERROR'].includes(status)
    && (status === 'READY' || modelStatus?.available === true);
  const label = status === 'CONNECTING' ? '预测服务连接中' : status === 'LOADING' ? '预测服务加载中'
    // Keep the service label stable; pending state is shown by the small
    // sync indicator on the prediction cards, not by swapping this text.
    : ready ? '预测服务已就绪' : '预测服务未就绪';
  return { ready, label, reason: modelStatus?.reason || '' };
}

export function observationDisplay(sample = {}) {
  const evidence = sample?.input?.importProvenance || sample?.importProvenance || sample || {};
  const sourceType = sample?.originMode === 'demo' ? 'DEMO' : evidence.source_type
    || ({ demo: 'DEMO', import: 'CSV_REPLAY', manual: 'MANUAL' })[sample?.mode] || 'UNKNOWN';
  const sourceLabel = ({ PUBLIC_DATA: '公开样本', CSV_REPLAY: '回放', MANUAL: '录入', DEMO: '工业数据', HYPOTHETICAL_DRAFT: '方案工况' })[sourceType] || '未知来源';
  const sourceText = evidence.observedSource || evidence.observation?.source || '';
  // Display translation only; keep frozen draft provenance and matching intact.
  const source = actualDisplayText(sourceText);
  const measured = sourceType !== 'DEMO' && evidence.observation?.quality === 'measured'
    && typeof source === 'string' && source.trim() !== '' && source !== 'unknown';
  const label = '实际值';
  return { label, sourceLabel, caption: `${label} · ${sourceLabel}`,
    tooltip: `${label} · ${sourceLabel}；${source || '实际值来源未确认'}${measured ? '；有明确测量依据' : '；未确认测量依据'}`,
    errorLabel: '预测－实际值',
    errorTooltip: `${sourceType === 'DEMO' ? '演示预测' : '模型预测'} − ${label}，单位 t${measured ? '' : '；仅表示差值，不宣称真实预测误差'}` };
}

export function referenceRangeDisplay(check) {
  const label = check.outOfRangeCount ? `${check.outOfRangeCount} 项超出参考范围`
    : !check.checkedRangeCount || check.rangeStatus === 'UNKNOWN' ? '参考范围尚未载入'
      : check.rangeStatus === 'PARTIAL' ? `部分已检查 · ${check.checkedRangeCount} 项在参考范围内`
        : '参考范围内';
  return { label, tooltip: REFERENCE_RANGE_NOTICE };
}
