import { readableConditionName } from './userVisibleText.js';
import { DEFAULT_PREDICTION_ERROR_ALARM_RANGE,formatPredictionErrorAlarmRange } from './predictionErrorAlarm.js';
import { currentPredictionErrorAlarm } from './s5PredictionErrorAlarm.js';
import { useEffect, useId, useRef } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { continuousSampleSegments } from './chartSegments.js';
import { completedPredictionValues } from './predictionSnapshot.js';
import { toDisplay, unitFor, formatEngineering } from './engineeringUnits.js';
import { observationDisplay } from './workbenchDisplay.js';
import './dashboard-metrics.css';

const metrics = [
  { id: 'S1', label: '轧制力', field: 'force' },
  { id: 'S2', label: '轧制力', field: 'force' },
  { id: 'S3', label: '轧制力', field: 'force' },
  { id: 'S4', label: '轧制力', field: 'force' },
];
const number = (value, digits = 1) => Number.isFinite(value)
  ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  : '—';
const standOf = (input, id) => input?.stands?.find(stand => stand.id === id);

// Same 25 inputs and order as server/model-service.mjs caseToModelValues.
// S4/S5 force, S5 front tension, exit thickness and the target are not counted.
function modelInputs(input) {
  const stands = ['S1', 'S2', 'S3', 'S4', 'S5'].map(id => standOf(input, id) || {});
  return [
    input?.entrySetThickness, input?.width, stands[0].entryThickness,
    ...stands.slice(0, 3).map(stand => stand.force),
    ...stands.slice(0, 4).map(stand => stand.bendingForce),
    ...stands.slice(0, 4).map(stand => stand.speed),
    ...stands.slice(0, 4).map(stand => stand.tension),
    ...stands.slice(0, 4).map(stand => stand.frontTension),
    stands[4].bendingForce, stands[4].speed, stands[4].tension,
  ];
}

function MetricProjection({ tension }) {
  const id='metric-projection-'+useId().replace(/:/g,'');
  return <svg className="metric-projection" viewBox="0 0 76 64" aria-hidden="true">
    <defs><linearGradient id={id} x1="0" y1="0" x2=".6" y2="1"><stop stopColor="#effbff" stopOpacity=".9"/><stop offset=".32" stopColor="var(--dm-chart)" stopOpacity=".7"/><stop offset="1" stopColor="var(--dm-chart)" stopOpacity=".15"/></linearGradient></defs>
    <ellipse cx="39" cy="55" rx="30" ry="5" fill="var(--dm-chart)" opacity=".08"/>
    <path d="M8 47 35 35 68 47 40 60Z" fill="var(--dm-chart)" fillOpacity=".05" stroke="var(--dm-chart)" strokeOpacity=".2"/>
    <g transform="rotate(-23 38 31)">
      <path d="M8 31H69" stroke="var(--dm-chart)" strokeWidth="4" opacity=".6"/>
      {[16,38].map(y=><g key={y}><path d={`M24 ${y-6}H55Q64 ${y-6} 64 ${y}T55 ${y+6}H24Z`} fill={`url(#${id})`} stroke="var(--dm-chart)" strokeWidth=".7"/><ellipse cx="24" cy={y} rx="8" ry="7" fill="#182932" stroke="var(--dm-chart)"/><ellipse cx="24" cy={y} rx="4" ry="3.5" fill={`url(#${id})`}/><path d={`M34 ${y-4}H54`} stroke="#edfbff" opacity=".5" strokeWidth=".7"/></g>)}
    </g>
    {tension?<path d="M4 34H18M4 34l5-4m-5 4 5 4M59 27H72m0 0-5-4m5 4-5 4" fill="none" stroke="var(--dm-chart)" strokeWidth="1.5"/>:<path d="M40 2v8m-4-4 4 4 4-4" fill="none" stroke="var(--dm-chart)" strokeWidth="1.5"/>}
  </svg>;
}

function MiniTrend({ frames, metric, currentValue }) {
  const gradientId = 'dm-trend-' + useId().replace(/:/g, '');
  const samples = Array.isArray(frames) ? frames : [];
  const valueOf = frame => standOf(frame?.input, metric.id)?.[metric.field];
  const values = samples.map(valueOf).filter(Number.isFinite);
  if (values.length < 2) return <div className="dm-trend-empty"><span className="dm-empty-grid"/><small>{metric.id==='S4'&&Number.isFinite(currentValue)?'当前工况 · 单点值':values.length === 1 ? '单点工况 · 等待序列' : '暂无采样序列'}</small></div>;
  const min = Math.min(...values), max = Math.max(...values);
  const padding = Math.max((max - min) * .2, Math.abs(max) * .002, .01);
  const lower = min - padding, extent = max - min + padding * 2;
  const times = samples.map(frame => frame.time);
  const useTime = times.every(Number.isFinite) && times.at(-1) > times[0];
  const point = frame => {
    const index = samples.indexOf(frame);
    const x = 1 + (useTime ? (frame.time - times[0]) / (times.at(-1) - times[0]) : index / Math.max(1, samples.length - 1)) * 218;
    const y = 43 - (valueOf(frame) - lower) / extent * 38;
    return [x, y];
  };
  return <svg className="dm-trend" viewBox="0 0 220 48" preserveAspectRatio="none" role="img" aria-label={metric.id + ' ' + metric.label + '，最近 ' + values.length + ' 个有效样本趋势'}>
    <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--dm-chart)" stopOpacity=".5"/><stop offset="100%" stopColor="var(--dm-chart)" stopOpacity=".035"/></linearGradient></defs>
    {[12, 28, 47].map(y => <path key={y} className="dm-trend-grid" d={'M0 ' + y + 'H220'}/>)}
    {continuousSampleSegments(samples, valueOf).map((segment, index) => {
      const points = segment.map(point);
      if (points.length === 1) return <circle key={index} cx={points[0][0]} cy={points[0][1]} r="1.8" className="dm-trend-dot"/>;
      const line = points.map(([x, y]) => x + ',' + y).join(' ');
      return <g key={index}>
        <polygon points={points[0][0] + ',47 ' + line + ' ' + points.at(-1)[0] + ',47'} fill={'url(#' + gradientId + ')'}/>
        <polyline className="dm-trend-line" points={line} vectorEffect="non-scaling-stroke"/>
      </g>;
    })}
  </svg>;
}

function MainPrediction({ predictionState, caseData, result, resultSample, modelStatus, dirty, pendingStreamProjection, inputDisplay, targetValue=null, optimizing=false, observationMatches = true, onOpenPredictionErrorAlarmRange, predictionErrorAlarmRange=DEFAULT_PREDICTION_ERROR_ALARM_RANGE, onOptimize }) {
  const cardRef = useRef(null), scrollContentRef = useRef(null);
  useEffect(() => {
    const card = cardRef.current;
    const scrollCardContent = event => {
      const content = scrollContentRef.current;
      if (!content || content.scrollHeight <= content.clientHeight
        || !event.deltaY || event.ctrlKey || event.metaKey) return;
      const distance = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? content.clientHeight : 1);
      content.scrollTop += distance;
      event.preventDefault();
    };
    card.addEventListener('wheel', scrollCardContent, { passive: false });
    return () => card.removeEventListener('wheel', scrollCardContent);
  }, []);
  const requestedTarget=Number.isFinite(targetValue)&&targetValue>0?targetValue:null;
  const blocked = inputDisplay?.predictionAllowed === false;
  const holding = !blocked && dirty && !!pendingStreamProjection;
  if (holding) {
    ({ caseData, result, sample:resultSample } = pendingStreamProjection);
    observationMatches = resultSample?.observedAvailable === true;
  }
  const displayDirty = dirty && !holding;
  const values = modelInputs(caseData);
  const present = values.filter(Number.isFinite).length;
  const completed = completedPredictionValues(result, caseData, resultSample);
  const value = !blocked && (holding || !displayDirty && predictionState === 'READY') ? completed.value : null;
  const target = requestedTarget;
  const isReady = modelStatus === true || modelStatus?.available === true
    || (modelStatus == null && result?.mode === 'formal');
  const isLoading = !isReady && (modelStatus?.status === 'CONNECTING'
    || modelStatus?.status === 'LOADING' || (modelStatus == null && result?.mode === 'pending'));
  const formal = result?.mode === 'formal' && value !== null;
  const modeLabel = blocked ? '预测暂停' : holding ? '正在更新' : formal ? 'QCDKR' : result?.mode === 'demo' ? '演示计算' : isLoading ? '模型加载中' : isReady ? '待预测' : '模型未就绪';
  const alarm=currentPredictionErrorAlarm({caseData,result,resultSample,dirty:displayDirty||blocked,observationMatches,holding,predictionState},predictionErrorAlarmRange);
  const matchingObserved=alarm.actualValue;
  const predictionError = alarm.predictionError;
  const observationText = observationDisplay(resultSample);
  const showSigned = raw => raw === null ? '—' : `${raw > 0 ? '+' : ''}${number(toDisplay('force', raw), 3)}`;
  const valueText = number(toDisplay('force', value), 3);
  return <section ref={cardRef} className={'dm-card dm-prediction dm-prediction-scrollable' + (formal ? ' dm-prediction-formal' : '')} aria-label="S5 轧制力主预测结果"
    data-display-snapshot-id={result?.snapshot_id} data-stream-update-pending={holding} data-target-value-source={target===null?'NONE':'USER_INPUT'}
    title={holding?'正在更新下一工况；显示最近已完成的完整预测快照':undefined}>
    <img className="s5-roll-illustration" src="/assets/s5-roll-illustration.png" alt="" aria-hidden="true"/>
    <div className="s5-main-heading"><h3><b>S5</b> 轧制力预测</h3><span className={'s5-main-mode' + (formal && !dirty ? ' is-ready' : '')} title={modelStatus?.reason}><i/>{modeLabel}</span></div>
    <div ref={scrollContentRef} className="s5-card-scroll-content">
    <div className="s5-main-readout">
      <div className="s5-model-readout"><span>{holding ? '上次预测 · 正在更新' : '预测值'}</span><strong className={'s5-main-value' + (valueText.length > 7 ? ' is-wide' : '')}>{valueText} <small className="dm-engineering-unit">t</small></strong></div>
      <div className="s5-main-comparison"><span title={observationText.tooltip + '；单位 t'}>实际值<b>{matchingObserved===null?'—':number(toDisplay('force',matchingObserved),3)+' t'}</b></span><span>目标值<b>{target===null?'—':number(toDisplay('force',target),3)+' t'}</b></span></div>
    </div>
    <div className="s5-main-detail"><span title="预测误差 = QCDKR 原始预测 − 当前实际值；单位 t">模型预测误差（预测 − 实际） <b>{predictionError===null?'—':showSigned(predictionError)+' t'}</b></span>{!displayDirty&&!blocked&&<span className={'s5-error-alarm is-'+alarm.status.toLowerCase()} role="status" data-alarm-state={alarm.status} title={'允许区间：'+formatPredictionErrorAlarmRange(predictionErrorAlarmRange)}>{alarm.label}</span>}{(displayDirty||blocked)&&<span className="s5-prediction-progress" role="status">{blocked?inputDisplay.pausedText:predictionState==='FAILED'?'当前工况预测暂未完成':'正在更新'}</span>}</div>
    {!displayDirty&&!blocked&&Number.isFinite(matchingObserved)&&Number.isFinite(target)&&<div className="s5-main-detail"><span title="正值表示实际轧制力高于目标，负值表示低于目标。">工况目标偏差（实际 − 目标） <b>{showSigned(matchingObserved-target)} t</b></span></div>}
    <div className="s5-main-actions"><button type="button" onClick={onOpenPredictionErrorAlarmRange}>预测误差报警区间</button><button type="button" className="s5-primary-action" onClick={onOptimize}>优化候选方案</button></div>
    </div>
  </section>;
}

export default function DashboardMetrics({ predictionState, caseData, result, resultSample, pendingStreamProjection, inputDisplay, targetValue=null, frames = [], selected, dirty = false, optimizing=false, observationMatches = true, onSelect, modelStatus, onOpenPredictionErrorAlarmRange, predictionErrorAlarmRange=DEFAULT_PREDICTION_ERROR_ALARM_RANGE, onOptimize, previewContent }) {
  return <div className="dm-metrics" aria-label="上游输入与 S5 主预测结果">
    {metrics.map(metric => {
      const value = standOf(caseData, metric.id)?.[metric.field];
      const available = Number.isFinite(value);
      const independent = metric.id === 'S4';
      const demo = resultSample?.source_type === 'DEMO' || caseData?.importProvenance?.source_type === 'DEMO';
      const detail = metric.id + ' ' + metric.label + ' ' + formatEngineering(metric.field, value, 3)
        + (demo ? '输入值。' : '');
      return <button key={metric.id} type="button"
        className={'dm-card dm-metric' + (independent ? ' dm-metric-independent' : '') + (selected === metric.id ? ' dm-selected' : '')}
        aria-label={'查看 ' + metric.id + ' ' + metric.label} aria-pressed={selected === metric.id}
        title={detail} onClick={() => onSelect?.(metric.id)}>
        <MetricProjection tension={metric.field === 'tension'}/>
        <span className="dm-metric-heading"><span><b>{metric.id}</b> {metric.label}</span></span>
        <span className="dm-value-row"><strong className="dm-metric-value">{number(toDisplay(metric.field, value), metric.field === 'force' ? 3 : 1)}</strong><small className="dm-engineering-unit">{unitFor(metric.field)}</small></span>
        <MiniTrend frames={frames} metric={metric} currentValue={value}/>
        <span className="dm-metric-foot"><span className={'dm-input-badge' + (!available ? ' dm-input-missing' : '')}><i/>{available ? demo ? '输入值' : '已录入' : '待录入'}</span></span>
      </button>;
    })}
    {previewContent||<MainPrediction predictionState={predictionState} caseData={caseData} result={result} resultSample={resultSample} pendingStreamProjection={pendingStreamProjection} inputDisplay={inputDisplay} targetValue={targetValue} modelStatus={modelStatus} dirty={dirty} optimizing={optimizing} observationMatches={observationMatches} onOpenPredictionErrorAlarmRange={onOpenPredictionErrorAlarmRange} predictionErrorAlarmRange={predictionErrorAlarmRange} onOptimize={onOptimize}/>}
  </div>;
}
export function ProcessSnapshot({ caseData, result, onEdit }) {
  const s5 = standOf(caseData, 'S5');
  const details = [
    { label: '工况', value: readableConditionName(caseData?.id) },
    { label: '钢种', value: caseData?.steelGrade || '—' },
    { label: '带钢宽度', value: number(caseData?.width, 0), unit: 'mm' },
    { label: 'S5 轧制速度', value: number(s5?.speed, 1), unit: 'm/min' },
    { label: 'S5 出口厚度', value: number(s5?.exitThickness, 3), unit: 'mm' },
  ];
  return <section className="dm-snapshot" aria-label="当前工况">
    <div className="dm-snapshot-heading"><h3>当前工况</h3><span>{result?.mode === 'formal' ? 'QCDKR 模型' : result?.mode === 'demo' ? '演示工况' : '工况参数'}</span><button type="button" onClick={onEdit} disabled={!onEdit}><SlidersHorizontal size={12}/>编辑参数</button></div>
    <div className="dm-snapshot-items">{details.map(item => <div className="dm-snapshot-item" key={item.label} title={item.title || item.label + '：' + item.value + (item.unit ? ' ' + item.unit : '')}><span>{item.label}</span><strong>{item.value}{item.unit && <small>{item.unit}</small>}</strong></div>)}</div>
  </section>;
}
