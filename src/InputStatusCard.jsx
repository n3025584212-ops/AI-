import { MODEL_INPUT_COUNT, summarizeModelInputs } from './modelInputs.js';
import HistoricalRangeCheck, { HistoricalRangeDetails } from './HistoricalRangeCheck.jsx';
import {PREDICTION_STATUS_TEXT} from './committedPredictionScheduler.js';
import { dashboardInputDisplay } from './workbenchDisplay.js';

export default function InputStatusCard({ caseData, modelStatus, result, dirty, inputSummary, historicalState, predictionState, onRetryPrediction, inputDisplay }) {
  const summary = inputSummary || summarizeModelInputs(caseData);
  const display = inputDisplay || dashboardInputDisplay(summary, historicalState?.checked);
  const issues = [...summary.missing, ...summary.invalid];
  const modelReady = modelStatus?.available === true && modelStatus.mode !== 'demo';
  const completed = display.predictionAllowed && modelReady && !dirty && predictionState === 'READY' && result?.mode === 'formal' && Number.isFinite(result.value);
  const predictionText = !display.predictionAllowed ? display.pausedText
    : !modelReady ? '等待QCDKR正式模型就绪'
    : completed ? '当前工况预测 · 已更新' : predictionState === 'READY' ? '当前工况预测 · 正在更新'
    : predictionState ? PREDICTION_STATUS_TEXT[predictionState] : dirty ? PREDICTION_STATUS_TEXT.STALE
    : completed ? '当前正式预测已完成'
    : result?.mode === 'demo' ? '当前为演示预测 · 正式预测未完成' : '等待当前正式预测完成';
  return <section className="input-status-card" aria-label="输入状态">
    <div className="status-row input-status-row"><h3>输入状态</h3>
    <div className="input-status-lines">
      <p className={display.complete ? 'input-status-normal' : 'input-status-issue'}><span aria-hidden="true">{display.complete ? '✓' : '✗'}</span>输入完整性 · {display.readCount} / {MODEL_INPUT_COUNT} 项已读取</p>
      <p className={display.valid ? 'input-status-normal' : 'input-status-issue'}><span aria-hidden="true">{display.valid ? '✓' : '⚠'}</span>有限数值检查 · {display.validCount} / {MODEL_INPUT_COUNT} 项有效</p>
      {issues.length > 0 && <p className="input-status-issue">{issues[0].label} · {issues[0].message}{issues.length > 1 && <small>另有 {issues.length - 1} 项待修正</small>}</p>}
      <p className={display.predictionAllowed && modelReady ? 'input-status-normal' : ''} title={modelReady ? undefined : modelStatus?.reason}><span aria-hidden="true">{display.predictionAllowed && modelReady ? '✓' : '○'}</span>QCDKR正式模型 · {!display.predictionAllowed ? '暂停，等待完整有效工况' : modelReady ? '可计算' : '尚未就绪'}</p>
      <p className={completed ? 'input-status-normal' : ''}><span aria-hidden="true">{completed ? '✓' : '○'}</span>{predictionText}</p>
      {predictionState==='FAILED'&&<button type="button" onClick={onRetryPrediction}>重试</button>}
    </div>
    </div>
    {historicalState ? <HistoricalRangeDetails {...historicalState}/> : <HistoricalRangeCheck caseData={caseData}/>}
  </section>;
}
