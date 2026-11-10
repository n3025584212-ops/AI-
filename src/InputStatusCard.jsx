import { MODEL_INPUT_COUNT, summarizeModelInputs } from './modelInputs.js';
import HistoricalRangeCheck, { HistoricalRangeDetails } from './HistoricalRangeCheck.jsx';
import {PREDICTION_STATUS_TEXT} from './committedPredictionScheduler.js';
import { dashboardInputDisplay } from './workbenchDisplay.js';

export default function InputStatusCard({ caseData, modelStatus, result, dirty, inputSummary, historicalState, predictionState, onRetryPrediction, inputDisplay, stream }) {
  const summary = inputSummary || summarizeModelInputs(caseData);
  const display = inputDisplay || dashboardInputDisplay(summary, historicalState?.checked);
  const issues = [...summary.missing, ...summary.invalid];
  const modelReady = modelStatus?.available === true && modelStatus.mode !== 'demo';
  const completed = display.predictionAllowed && modelReady && !dirty && predictionState === 'READY' && result?.mode === 'formal' && Number.isFinite(result.value);
  // Keep only this prediction's readiness on the workbench; device and
  // service health live in Maintenance -> System status.
  const conditionReady = display.predictionAllowed && modelReady;
  const conditionLabel = conditionReady ? '工况可用于预测'
    : !display.complete ? '输入未完整'
    : !display.valid ? '输入数值无效'
    : !modelReady ? '模型未就绪'
    : '数据流暂停';
  const conditionTitle = [`输入完整性 ${display.readCount} / ${MODEL_INPUT_COUNT}`, `有限有效数值 ${display.validCount} / ${MODEL_INPUT_COUNT}`, !modelReady ? `模型：${modelStatus?.reason || '尚未就绪'}` : ''].filter(Boolean).join(' · ');
  const predictionText = !display.predictionAllowed ? display.pausedText
    : !modelReady ? '等待QCDKR正式模型就绪'
    : completed ? '当前工况预测 · 已更新' : predictionState === 'READY' ? '当前工况预测 · 正在更新'
    : predictionState ? PREDICTION_STATUS_TEXT[predictionState] : dirty ? PREDICTION_STATUS_TEXT.STALE
    : completed ? '当前正式预测已完成'
    : result?.mode === 'demo' ? '当前为演示预测 · 正式预测未完成' : '等待当前正式预测完成';
  return <section className="input-status-card" aria-label="当前工况" title="仅表示本次预测的输入与模型可用性；设备与服务健康请在维护设置中查看">
    <div className="status-row input-status-row"><h3>当前工况</h3>
    <div className="input-status-lines">
      {stream && <div className="input-stream-compact"><span>记录 {stream.recordIndex} / {stream.datasetCount}</span>{stream.mode!=='manual'&&stream.mode!=='plc'&&<button type="button" onClick={stream.toggle} aria-label={stream.running?'暂停数据流':'播放数据流'}>{stream.running?'暂停':'播放'}</button>}</div>}
      <p className={conditionReady ? 'input-status-normal' : 'input-status-issue'} title={conditionTitle}><span aria-hidden="true">{conditionReady ? '✓' : '✗'}</span>{conditionLabel}</p>
      {issues.length > 0 && <p className="input-status-issue">{issues[0].label} · {issues[0].message}{issues.length > 1 && <small>另有 {issues.length - 1} 项待修正</small>}</p>}
      <p title={predictionText} aria-label={predictionText}><span className={'prediction-state-dot' + (completed ? ' is-ready' : '')} aria-hidden="true"/>预测同步</p>
      {predictionState==='FAILED'&&<button type="button" onClick={onRetryPrediction}>重试</button>}
      <div className="input-range-inline">
        {historicalState ? <HistoricalRangeDetails {...historicalState}/> : <HistoricalRangeCheck caseData={caseData}/>}
      </div>
    </div>
    </div>
  </section>;
}
