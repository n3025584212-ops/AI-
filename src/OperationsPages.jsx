import { isTechnicalLabel, readableConditionName, userVisibleText } from './userVisibleText.js';
import UserVisibleText from './UserVisibleText.jsx';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, ChevronRight, GitCompareArrows, History, Loader2, Plus, RotateCcw, Search, SlidersHorizontal, Trash2, ArrowLeft } from 'lucide-react';
import { toDisplay, fromDisplay, unitFor, formatEngineering } from './engineeringUnits.js';
import { modelInputFingerprint, summarizeModelInputs } from './modelInputs.js';
import { engineeringContextForRequest, reportInputFingerprint } from './predictionSnapshot.js';
import {candidateDisplaySource,candidateExplanationKey,candidateSourceLabel,candidateRecommendationLabels,candidateABReady,hasCurrentActionMetadata,SEARCH_LABELS,SEARCH_DESCRIPTIONS} from './candidatePresentation.js';
import {SEARCH_CONFIG} from './smartCandidateConfig.js';
import {SMART19_CONFIG} from './smart19Config.js';
import {targetWithinMaxReachability} from './candidatePrediction.js';
import {targetReferenceProjection,targetReferenceStatusLabel,targetReferenceSourceLabel} from './targetReference.js';
import {MODEL_FEATURES} from './modelInputs.js';
import { PreviewParameters, PreviewPolicies } from './WorkbenchPreview.jsx';
import { POLICY_BUTTON_LABELS } from './candidatePolicyState.js';
import { currentPredictionErrorAlarm } from './s5PredictionErrorAlarm.js';
import { DEFAULT_PREDICTION_ERROR_ALARM_RANGE } from './predictionErrorAlarm.js';
import './operations.css';
import './operations-polish.css';

const FIELD_NAMES = {
  width: '带钢宽度', entrySetThickness: '入口设定厚度', target: 'S5 目标',
  entryThickness: '入口厚度', exitThickness: '出口厚度', force: '轧制力',
  tension: '后张力', frontTension: '前张力', bendingForce: '弯辊力', speed: '轧制速度', temperature: '温度',
};
const STAND_FIELDS = ['entryThickness', 'exitThickness', 'force', 'tension', 'frontTension', 'bendingForce', 'speed', 'temperature'];
const format = (value, digits = 2) => Number.isFinite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—';
const signed = value => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${format(value)}` : '—';
const fieldUnit = unitFor;
const force = (value, digits = 3) => formatEngineering('force', value, digits);
const signedForce = value => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${force(value)}` : '—';
const signedField = (field, value) => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${format(toDisplay(field, value), 3)}` : '—';
const stamp = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '时间未记录';

function ValueComparison({ items, label = 'S5 轧制力对比' }) {
  const numeric = items.filter(item => Number.isFinite(item.value));
  const chartRef = useRef(null);
  const [chartWidth, setChartWidth] = useState(652);
  useEffect(() => {
    if (!chartRef.current) return;
    const update = () => setChartWidth(Math.max(360, Math.round(chartRef.current.getBoundingClientRect().width)));
    const observer = new ResizeObserver(update);
    observer.observe(chartRef.current); update();
    return () => observer.disconnect();
  }, [numeric.length]);
  if (!numeric.length) return <div className="ops-inline-empty">尚无可比较的计算结果。</div>;
  const values = numeric.map(item => item.value);
  const padding = Math.max((Math.max(...values) - Math.min(...values)) * .25, 4);
  const lower = Math.max(0, Math.min(...values) - padding);
  const upper = Math.max(...values) + padding;
  const plotLeft = 104, plotWidth = chartWidth - 188;
  const x = value => plotLeft + (value - lower) / Math.max(upper - lower, 1) * plotWidth;
  const height = items.length * 44 + 36;
  return <svg ref={chartRef} className="ops-value-chart" style={{ height }} viewBox={`0 0 ${chartWidth} ${height}`} role="img" aria-label={`${label}；${numeric.map(item => `${item.label} ${force(item.value)}`).join('，')}`}>
    {[0, 1, 2, 3, 4].map(index => {
      const position = plotLeft + index / 4 * plotWidth;
      return <g key={index}><line x1={position} x2={position} y1="10" y2={height - 29} className="ops-chart-grid" /><text x={position} y={height - 9} textAnchor="middle" className="ops-chart-axis">{format(toDisplay('force', lower + index / 4 * (upper - lower)), 2)}</text></g>;
    })}
    {items.map((item, index) => <g key={item.label}>
      <text x="4" y={index * 44 + 30} className="ops-chart-label">{item.label}</text>
      {Number.isFinite(item.value) && <><line x1={plotLeft} x2={x(item.value)} y1={index * 44 + 26} y2={index * 44 + 26} stroke={item.color} strokeWidth="3" opacity=".42" /><circle cx={x(item.value)} cy={index * 44 + 26} r="4.5" fill={item.color} /><text x={chartWidth - 3} y={index * 44 + 30} textAnchor="end" fill={item.color} className="ops-chart-value">{force(item.value)}</text></>}
    </g>)}
  </svg>;
}

function ChangeTable({ rows, leftLabel = '当前值', rightLabel = '方案值', empty = '没有参数差异。', showUnits = true }) {
  return <div className="ops-table-scroll"><table className="ops-change-table"><thead><tr><th>对象 / 参数</th><th>{leftLabel}</th><th>{rightLabel}</th><th>变化量</th></tr></thead><tbody>
    {rows.map((row, index) => <tr key={`${row.stand}-${row.field}-${index}`}><td><span className="ops-object">{row.stand || '全线'}</span>{FIELD_NAMES[row.field] || row.field}<small>{fieldUnit(row.field)}</small></td><td>{typeof row.before === 'string' ? row.before : format(toDisplay(row.field, row.before), 3)}</td><td className="ops-input-color">{typeof row.after === 'string' ? row.after : format(toDisplay(row.field, row.after), 3)}</td><td className={row.delta > 0 ? 'ops-prediction-color' : row.delta < 0 ? 'ops-input-color' : ''}>{signedField(row.field, row.delta)}</td></tr>)}
    {!rows.length && <tr><td colSpan="4" className="ops-table-empty">{empty}</td></tr>}
  </tbody></table></div>;
}

const reachableRangeTitle=()=> 'AI试算范围';
const roundedForce=value=>String(Math.sign(value)*Math.round(Math.abs(value))||0);
const roundedSignedForce=value=>{const rounded=Math.sign(value)*Math.round(Math.abs(value))||0;return `${rounded>0?'+':''}${rounded}`;};
function S5ReachableRange({range,state,actualAvailable,target,predictionReady}){
 const completed=range?.scope==='MAX_REACHABILITY'&&range.completed_level===3&&range.max_adjustment_percent===15;
 const pendingText=state?.status==='FAILED'?'智能试算未完成，请重新进入方案页重试。':state?.status==='TIMEOUT'?'方案搜索超时，请重试或减小目标偏差。':state?.status==='SEARCHING'||predictionReady?'智能试算中…':'等待当前正式预测就绪';
 const targetWithin=completed?targetWithinMaxReachability(target,range):null;
 return <section className="s5-trial-reachable-range" aria-label="AI试算范围"><h3>{reachableRangeTitle()} <span className="s5-envelope-info" tabIndex="0" aria-label="范围说明" title="基于当前工况下19维参数联合智能试算及QCDKR验证结果生成。这是固定规则下已探索的预测区间，不代表数学全局极值；范围内目标也不保证存在足够接近目标的方案，请以方案预计目标偏差为准。">ⓘ</span></h3><dl>
   <div><dt>智能试算</dt><dd>{!completed?<span role="status">{pendingText}</span>:range.candidate_count===0?'暂无合法候选结果':`约 ${roundedForce(range.estimated_min)} ～ ${roundedForce(range.estimated_max)} t`}</dd></div>
   <div><dt>预计变化范围</dt><dd>{!completed?<span role="status">{pendingText}</span>:range.candidate_count===0?'—':`${roundedSignedForce(range.delta_min)} ～ ${roundedSignedForce(range.delta_max)} t`}</dd></div>
   {targetWithin!==null&&<div><dt>当前目标</dt><dd>{targetWithin?'位于AI试算范围内':'超出AI试算范围'}</dd></div>}
  </dl>
  {targetWithin===false&&<p className="micro-note" role="status">当前目标位于AI试算范围之外，可继续尝试智能寻优。</p>}
  {!actualAvailable&&<p className="micro-note">当前无匹配实际值，范围仍按当前QCDKR预测及合法试算预测计算。</p>}
 </section>;
}

function SmartSolutionResults({plans,selected,caseData,result,modelMonitor,targetReference,searchState,reachableRange,activeSearchRunId,selectedPolicy,onSelectPolicy,canLoadDraft,busy,onLoadDraft,onSelectCandidate,onExplainCandidate,
 previewPolicy,explanationByCandidateIdentity,explanationBusy,onCancelReview,onCloseReview}){
 const [explanationOpen,setExplanationOpen]=useState(false);
 const order=['TARGET_PRIORITY','MIN_ADJUSTMENT','BALANCED'];
 const labels=plan=>order.filter(label=>plan.recommendation_labels.includes(label));
 const candidates=[...plans].sort((a,b)=>Math.min(...labels(a).map(label=>order.indexOf(label)))-Math.min(...labels(b).map(label=>order.indexOf(label))));
 const key=candidateExplanationKey(selected),explanation=explanationByCandidateIdentity[key]||{status:'idle'};
 const current=plan=>plan.search_run_id===activeSearchRunId&&candidateABReady(plan,null,canLoadDraft);
 const view=async plan=>{
  onSelectCandidate?.(candidateExplanationKey(plan));await onLoadDraft?.(plan,effectivePolicy);requestAnimationFrame(()=>document.querySelector('[aria-label="方案工况"]')?.scrollIntoView?.({block:'nearest'}));
 };
 const effectivePolicy=previewPolicy||selectedPolicy||Object.keys({TARGET_APPROACH:1,LOW_DISTURBANCE:1,BALANCED:1}).find(policy=>selected?.recommendation_labels?.includes(({TARGET_APPROACH:'TARGET_PRIORITY',LOW_DISTURBANCE:'MIN_ADJUSTMENT',BALANCED:'BALANCED'})[policy]));
 return <><div className="smart-solution-grid smart-selected-solution" aria-label="当前候选方案详情">
  {(selected?[selected]:[]).map(plan=>{
   const own=explanationByCandidateIdentity[candidateExplanationKey(plan)]||{status:'idle'};
   const actionBased=hasCurrentActionMetadata(plan);
   const actionConfig=plan.action_metadata_identity?.search_configuration_version===SMART19_CONFIG.version?SMART19_CONFIG:SEARCH_CONFIG;
   return <article className="smart-solution-card" key={candidateExplanationKey(plan)} data-search-run-id={plan.search_run_id} data-candidate-id={plan.id} data-candidate-status={plan.status}>
    <small>AI智能搜索{current(plan)?'':' · 搜索前方案（历史，只读）'}</small>
    <div className="smart-solution-titles"><h3>{POLICY_BUTTON_LABELS[effectivePolicy]}</h3><p>{Number.isFinite(plan.target_s5)?{TARGET_APPROACH:'距离目标最近 · 调整较少',LOW_DISTURBANCE:'调整项数最少',BALANCED:'兼顾目标偏差与调整项数'}[effectivePolicy]:'未设置目标值 · 展示调整项数最少的合法试算'}</p></div>
    {effectivePolicy==='TARGET_APPROACH'&&(searchState.target_reached===false||targetWithinMaxReachability(plan.target_s5,reachableRange)===false)&&<p className="micro-note">最接近目标</p>}
    <dl><div><dt>{actionBased?'调整动作':'历史字段调整'}</dt><dd>{actionBased?plan.changed_action_count:plan.changed_field_count} 项</dd></div><div><dt>{actionBased?'总调整幅度':'历史字段幅度'}</dt><dd>{plan.total_relative_change}%</dd></div>
     <div><dt>关联模型输入</dt><dd>{plan.changed_field_count} 项</dd></div>
     {actionBased&&plan.actions.map(action=><div key={action.action_id}><dt>{actionConfig.actions.find(a=>a.actionId===action.action_id).displayName}</dt><dd>{action.action_delta_percent>0?'+':''}{action.action_delta_percent}%</dd></div>)}
    </dl>
    <dl className="s5-trial-result">{plan.actual_anchored_mode?<><div><dt>当前实际值</dt><dd>{force(plan.actual_s5)}</dd></div><div><dt>模型预计变化</dt><dd>{signedForce(plan.model_response_delta)}</dd></div><div><dt title="基于当前实际值与模型预测变化量计算">调整后估计值</dt><dd>{force(plan.estimated_candidate_s5)}</dd></div></>:<><div><dt>当前模型预测</dt><dd>{force(plan.baseline_prediction)}</dd></div><div><dt>方案预测值</dt><dd>{force(plan.predictedValue)}</dd></div></>}<div><dt>目标值</dt><dd>{force(plan.target_s5)}</dd></div><div><dt>预计目标偏差</dt><dd>{signedForce(plan.estimated_target_gap)}</dd></div></dl>
    {!plan.actual_anchored_mode&&<p className="micro-note">预调试算 · 当前无匹配实际值</p>}
    <details className="s5-trial-model-basis"><summary>查看模型计算依据</summary><dl><div><dt>当前QCDKR预测</dt><dd>{force(plan.baseline_prediction)}</dd></div>{plan.actual_anchored_mode&&<><div><dt>当前实际值</dt><dd>{force(plan.actual_s5)}</dd></div><div><dt>模型预测误差（预测 − 实际）</dt><dd>{signedForce(plan.model_prediction_error)}</dd></div></>}<div><dt>候选QCDKR预测</dt><dd>{force(plan.predictedValue)}</dd></div><div><dt>模型预计变化</dt><dd>{signedForce(plan.model_response_delta)}</dd></div><div><dt>{plan.actual_anchored_mode?'调整后估计值':'方案预测值'}</dt><dd>{force(plan.estimated_candidate_s5)}</dd></div><div><dt>计算模式</dt><dd>{plan.actual_anchored_mode?'实际值锚定试算':'预调试算'}</dd></div></dl><p className="micro-note">{plan.actual_anchored_mode?'调整后估计值基于当前实际值与QCDKR对参数变化的模型响应计算，用于参数试算，不代表现场实施后的实测结果或保证值。':'当前无匹配实际值，使用QCDKR方案预测进行预调试算。'}</p></details>
    {plan.reference_warning_count>0&&<p className="smart-reference-warning">{plan.reference_warning_count} 项超出参考范围</p>}
    <PreviewParameters caseData={caseData} plan={plan}/>
    <div className="smart-solution-actions"><button className="ops-button ops-primary" disabled={!current(plan)||!!busy||!onSelectPolicy} onClick={()=>{onSelectCandidate?.(candidateExplanationKey(plan));onSelectPolicy?.(effectivePolicy,plan);}}>应用方案</button>
     <button className="ops-button" disabled={!current(plan)||!!busy} onClick={()=>view(plan)}>方案对比</button>
     <button className="ops-button" disabled={!current(plan)||explanationBusy||own.status==='requesting'||!onExplainCandidate} onClick={()=>{setExplanationOpen(true);onSelectCandidate?.(candidateExplanationKey(plan));onExplainCandidate?.(plan);}}>DK AI 解读</button></div>
    {explanationBusy&&own.status!=='requesting'&&<p className="smart-other-review" role="status">另一方案正在解读…</p>}
   </article>;
  })}
 </div>{explanationOpen&&selected&&<section className="ops-ai-explanation" aria-label="候选方案解读"><div className="smart-review-header"><h3>DK AI方案解读</h3>
  <button className="ops-button" onClick={()=>{onCloseReview?.();setExplanationOpen(false);}}>关闭解读</button>{explanation.status==='requesting'&&<button className="ops-button" onClick={onCancelReview}>取消解读</button>}</div>
  {explanation.facts?.length>0&&<dl>{explanation.facts.filter(fact=>!isTechnicalLabel(fact.label)).map(fact=><div key={fact.label}><dt>{userVisibleText(fact.label)}</dt><dd><UserVisibleText value={fact.value}/></dd></div>)}</dl>}
  <div role="status">{explanation.status==='ready'?<UserVisibleText value={explanation.text}/>:explanation.status==='stale_reference'?'参考值已变化，请重新解读。':explanation.status==='requesting'?'正在解读此候选方案…':'DK AI方案解读当前不可用。'}</div>
  {explanation.boundary&&<UserVisibleText value={explanation.boundary}/>}
  <details className="prediction-record-technical"><summary>查看技术信息</summary><pre>{JSON.stringify(explanation,null,2)}</pre></details>
 </section>}</>;
}

export function OptimizationWorkspace({ caseData, result, resultSample, observationMatches=true, predictionErrorAlarmRange=DEFAULT_PREDICTION_ERROR_ALARM_RANGE, predictionState, plans = [], busy, predictionReady=true, onReturnCurrent, onTargetChange, onTargetEditDirty, onGenerate, onGeneratePresets, searchState={status:'IDLE'}, activeSearchRunId, selectedPolicy,onSelectPolicy,policySearching=false,policySeriesLength=0,optimizationTask,prefetchCompleted=0,prefetchTotal=0,reachableRange=null,maxReachabilityState={status:'IDLE'},targetReference, onCloseSearch, onCancelReview, onCloseReview, onCancelSearch, onLoadDraft, draft, canLoadDraft = false,
  explanationByCandidateIdentity = {}, explanationBusy = false, selectedCandidateIdentity, candidateIdentityKey = candidateExplanationKey, onExplainCandidate, onSelectCandidate }) {
  const [selectedId, setSelectedId] = useState(null);
  const [previewPolicy,setPreviewPolicy]=useState(null);
  const storedTarget=optimizationTask ? optimizationTask.targetValueT : caseData?.importProvenance?.target_source==='USER_INPUT' ? caseData.target : null;
  const currentTarget=storedTarget==null||storedTarget===''?null:storedTarget;
  const [targetEdit,setTargetEdit]=useState(currentTarget);
  useEffect(()=>setTargetEdit(currentTarget),[currentTarget]);
  useEffect(()=>{onTargetEditDirty?.((targetEdit===''?null:targetEdit)!==currentTarget);},[targetEdit,currentTarget]);
  useEffect(()=>()=>onTargetEditDirty?.(false),[]);
  const selected = plans.find(plan=>(previewPolicy||selectedPolicy)&&plan.recommendation_labels?.includes(({LOW_DISTURBANCE:'MIN_ADJUSTMENT',BALANCED:'BALANCED',TARGET_APPROACH:'TARGET_PRIORITY'})[previewPolicy||selectedPolicy])) || plans.find(plan => candidateIdentityKey(plan) === selectedCandidateIdentity) || plans.find(plan => candidateIdentityKey(plan) === selectedId) || plans[0];
  const explanationKey=candidateIdentityKey(selected),explanation=explanationByCandidateIdentity[explanationKey] || {status:'idle'};
  useEffect(()=>{onSelectCandidate?.(explanationKey);},[explanationKey]);
  const baselineCase = caseData;
  const baseline = result?.value;
  const formal = result?.mode === 'formal' && selected?.mode === 'formal';
  const isLoaded = plan => Boolean(plan?.target_snapshot_id && draft?.candidate_preview_snapshot_id === plan.target_snapshot_id && draft.source_plan_id === plan.id && draft.baseline_snapshot_id === plan.baseline_snapshot_id && !['DISCARDED','BASELINE_STALE'].includes(draft.status));
  const loaded = isLoaded(selected);
  const smart = selected?.candidate_source==='SMART_SEARCH',searching=searchState.status==='SEARCHING';
  const smartPlans=plans.filter(plan=>plan.candidate_source==='SMART_SEARCH');
  const effectivePreviewPolicy=previewPolicy||selectedPolicy||['TARGET_APPROACH','LOW_DISTURBANCE','BALANCED'].find(policy=>selected?.recommendation_labels?.includes(({LOW_DISTURBANCE:'MIN_ADJUSTMENT',BALANCED:'BALANCED',TARGET_APPROACH:'TARGET_PRIORITY'})[policy]));
  const previewCurrent=plan=>plan.search_run_id===activeSearchRunId&&candidateABReady(plan,null,canLoadDraft);
  const selectPreview=policy=>{const plan=smartPlans.find(plan=>plan.recommendation_labels.includes(({LOW_DISTURBANCE:'MIN_ADJUSTMENT',BALANCED:'BALANCED',TARGET_APPROACH:'TARGET_PRIORITY'})[policy]));if(plan&&previewCurrent(plan)){setPreviewPolicy(policy);onSelectCandidate?.(candidateIdentityKey(plan));}};
  const legacyPlans=plans.some(plan=>plan.candidate_source!=='SMART_SEARCH');
  const showSmart=smartPlans.length>0||searchState.status!=='IDLE'||(!!optimizationTask&&!legacyPlans);
  const emptySearch=searchState.status==='COMPLETED'&&searchState.result==='NO_VALID_CANDIDATE';
  const searchMessage = ({FAILED:'候选方案生成失败，请重试。',TIMEOUT:'方案生成超时，请重试或减小目标偏差。',TIMED_OUT:'方案生成超时，请重试。',CANCELLED:'已取消本次试算。',STALE:'当前工况已变化，请重新生成方案。'})[searchState.status] || (searchState.status==='COMPLETED'&&smartPlans.length ? searchState.result==='CLOSEST_LEGAL_CANDIDATES'||searchState.target_reached===false ? '当前试算空间内未找到足够接近目标的方案，已显示最接近目标的结果。' : '候选方案已生成。' : null);
  const abReady = candidateABReady(selected,draft,canLoadDraft);
  const target = Number.isFinite(currentTarget) ? currentTarget : null;
  const modelMonitor = currentPredictionErrorAlarm({caseData,result,resultSample,observationMatches,predictionState,dirty:!predictionReady},predictionErrorAlarmRange);
  const actualAvailable=Number.isFinite(modelMonitor.actualValue);
  const conditionTargetDeviation = Number.isFinite(modelMonitor.actualValue) && Number.isFinite(target) ? modelMonitor.actualValue-target : null;
  const modelMonitorLabel = {NORMAL:'正常',LOW_ERROR_ALARM:'低于误差下限',HIGH_ERROR_ALARM:'高于误差上限'}[modelMonitor.status] || (modelMonitor.reason==='ACTUAL_MISSING'?'暂无实际值，无法判断':'等待当前预测');
  const baselineError = Number.isFinite(baseline) && Number.isFinite(target) ? Math.abs(baseline - target) : null;
  const candidateError = Number.isFinite(selected?.predictedValue) && Number.isFinite(target) ? Math.abs(selected.predictedValue - target) : null;
  const rows = (selected?.changes || []).map(change => ({ ...change, delta: change.after - change.before }));
  const stale = selected && rows.some(row => {
    const actual = row.stand ? baselineCase?.stands?.find(stand => stand.id === row.stand)?.[row.field] : baselineCase?.[row.field];
    return !Number.isFinite(actual) || Math.abs(actual - row.before) > .00011;
  });
  return <section className="operations-workspace ops-optimization" aria-label="工艺优化工作区">
    {showSmart?<PreviewPolicies onReturn={onReturnCurrent} policy={smartPlans.some(previewCurrent)?effectivePreviewPolicy:null} onSelect={selectPreview} disabled={searching||searchState.status==='STALE'||!smartPlans.some(previewCurrent)}/>:onReturnCurrent&&<div className="candidate-preview-navigation"><button type="button" className="candidate-preview-return" onClick={onReturnCurrent}>← 返回当前工况</button></div>}
    <header className="ops-toolbar"><div className="ops-tool-title"><SlidersHorizontal size={19}/><div><h2>⑤优化候选方案</h2></div></div>
      <div className="ops-toolbar-actions">{<button className="ops-button ops-primary" onClick={onGenerate} disabled={!!busy||searching||!predictionReady}>
        {busy==='optimize'||searching?<Loader2 className="spin" size={15}/>:<Search size={15}/>} {!predictionReady?'等待当前工况预测完成':busy==='optimize'||searching?'搜索中…':'生成候选方案'}
      </button>}{searching&&<button className="ops-button" onClick={onCancelSearch}>取消</button>}</div>
    </header>
    {searching&&<p className="smart-search-status" role="status">正在搜索候选方案…</p>}
    {!searching&&!emptySearch&&searchMessage&&<div className="smart-search-status" role="status">{searchMessage}</div>}
    
    <div className="ops-baseline-strip s5-trial-baseline"><div><span>{actualAvailable?'当前实际值':'当前模型预测'}</span><strong className="ops-input-color">{force(actualAvailable?modelMonitor.actualValue:modelMonitor.rawPrediction)}</strong>{!actualAvailable&&<small>预调试算 · 当前无匹配实际值</small>}</div>
      <label><span>目标 S5 轧制力 / t</span><input aria-label="优化目标载荷" type="number" min="0" step="0.01" placeholder="—" value={toDisplay('target',targetEdit) ?? ''} onChange={event=>{const next=event.target.value===''?null:fromDisplay('target',Number(event.target.value));setTargetEdit(next);if(next===null)onTargetChange?.(null);}}/><button type="button" className="ops-button" disabled={!Number.isFinite(targetEdit)||targetEdit<=0||targetEdit===target} onClick={()=>onTargetChange?.(targetEdit)}>应用目标</button><small>优化目标独立于当前工况；变更后重新生成候选</small></label>
      {actualAvailable&&<div><span title="正值表示实际轧制力高于目标，负值表示低于目标。">工况目标偏差（实际 − 目标）</span><strong className="ops-target-color">{signedForce(conditionTargetDeviation)}</strong></div>}<div className="s5-trial-condition"><span>当前工况</span><strong>{readableConditionName(caseData?.id).replace(/^工况-(?=\d)/,'工况')}</strong><small>{caseData?.steelGrade} · {format(caseData?.width,0)} mm</small></div>
    </div>
    {showSmart&&<S5ReachableRange range={reachableRange} state={maxReachabilityState} actualAvailable={actualAvailable} target={target} predictionReady={predictionReady}/>}
    <div className="s5-trial-model-baseline" aria-label="模型基线"><strong>模型基线</strong><span>QCDKR预测：{force(modelMonitor.rawPrediction)}</span><span>模型预测误差（预测 − 实际）：{signedForce(modelMonitor.predictionError)}</span><span>模型误差监测：{modelMonitorLabel}</span></div>
    {showSmart?<div className="smart-results-workspace">
     {emptySearch?<div className="smart-search-empty" role="status"><h3>当前工况暂无可用调整方案</h3><dl><div><dt>目标值</dt><dd>{force(target)}</dd></div></dl><details className="s5-trial-model-basis"><summary>查看模型计算依据</summary><dl><div><dt>当前最近可达预测</dt><dd>{force(searchState.nearest_reachable_prediction)}</dd></div><div><dt>最小模型目标偏差</dt><dd>{force(searchState.minimum_target_gap)}</dd></div></dl></details><button className="ops-button" onClick={()=>document.querySelector('[aria-label="优化目标载荷"]')?.focus()}>调整目标值</button></div>
      :searching?<div className="smart-search-pending">正在完成本次搜索，旧方案不作为当前结果。</div>
      :searchState.status==='STALE'?null:smartPlans.length>0?<SmartSolutionResults {...{selected,caseData,result,modelMonitor,targetReference,searchState,reachableRange,activeSearchRunId,selectedPolicy,onSelectPolicy,canLoadDraft,busy,onLoadDraft,onSelectCandidate,onExplainCandidate,explanationByCandidateIdentity,explanationBusy,onCancelReview,onCloseReview}} previewPolicy={effectivePreviewPolicy} plans={smartPlans}/>:null}
     {plans.some(plan=>plan.candidate_source==='USER_SPECIFIED_TRIAL')&&<OptimizationWorkspace {...{caseData,result,resultSample,observationMatches,predictionErrorAlarmRange,predictionState,predictionReady,busy,onTargetChange,onGenerate,onGeneratePresets,onLoadDraft,draft,canLoadDraft,explanationByCandidateIdentity,explanationBusy,selectedCandidateIdentity,candidateIdentityKey,onExplainCandidate,onSelectCandidate}} plans={plans.filter(plan=>plan.candidate_source==='USER_SPECIFIED_TRIAL')}/>}
    </div>:<div className="ops-optimization-body"><aside className="ops-candidate-rail"><div className="ops-section-title"><h3>调整方案</h3><span>{plans.length} 项</span></div>
      {plans.length?<div className="ops-candidate-list">{plans.map((plan,index)=><button key={candidateIdentityKey(plan)}
        className={'ops-candidate '+(candidateIdentityKey(selected)===candidateIdentityKey(plan)?'is-selected':'')}
        aria-pressed={candidateIdentityKey(selected)===candidateIdentityKey(plan)} onClick={()=>{setSelectedId(candidateIdentityKey(plan));onSelectCandidate?.(candidateIdentityKey(plan));}}>
        <span className="ops-candidate-number">{String(index+1).padStart(2,'0')}</span><span className="ops-candidate-content">
          <small className="ops-candidate-source">[{plan.candidate_source==='SMART_SEARCH'?'AI智能搜索':candidateSourceLabel(plan)}]</small>
          <span className="smart-winner-labels">{candidateRecommendationLabels(plan).map(label=><b key={label}>{label}</b>)}</span>
          <strong>{plan.title}</strong><small>{hasCurrentActionMetadata(plan)?`${plan.changed_action_count} 项动作 · ${plan.changed_field_count} 项关联输入`:`${plan.changes?.length || 0} 项参数`} · {isLoaded(plan)?'方案已载入':'未载入方案'}</small>
          {plan.candidate_source==='SMART_SEARCH'&&<span className="smart-candidate-adjustments">{plan.changes.map(change=><small key={change.feature_key}>
            {MODEL_FEATURES.find(f=>f.key===change.feature_key)?.label}：{formatEngineering(change.field,change.before,3)} → {formatEngineering(change.field,change.after,3)} ({change.relative_change_percent>0?'+':''}{change.relative_change_percent}%)
          </small>)}</span>}
          <span><b>{force(plan.predictedValue)}</b><em>与目标相差 {force(plan.candidate_target_gap ?? (Number.isFinite(target)?Math.abs(plan.predictedValue-target):null))}</em></span>
          {plan.candidate_improves_target&&<small className="ops-input-color">相对基线更接近目标 · 总调整 {plan.total_relative_change}%</small>}
          {plan.reference_warning_count>0&&<small className="smart-reference-warning">{plan.reference_warning_count} 项超出参考范围</small>}
        </span><ChevronRight size={14}/>
      </button>)}</div>:<div className="ops-rail-empty"><GitCompareArrows size={24}/><strong>{searchState.result==='NO_IMPROVING_CANDIDATE'?'当前搜索范围内未找到优于基线的调整方案。':'尚未生成方案'}</strong><p>可直接生成参数试算方案；目标值可选。</p></div>}
    </aside>
    <div className="ops-comparison-workspace"><div className="ops-section-title"><h3>{selected?selected.title:'当前值与目标'}</h3>{stale&&<span>参数已变化，请重新搜索</span>}</div>
      <ValueComparison items={[{label:'调整前',value:baseline,color:'#8ecbbd'},...(selected?[{label:'调整后',value:selected.predictedValue,color:'#78c9eb'}]:[]),{label:'目标',value:target,color:'#d9b88b'}]}/>
      {selected?<><div className="smart-winner-labels">{candidateRecommendationLabels(selected).map(label=><b key={label}>{label}</b>)}</div>
        <div className="ops-result-summary"><span>与目标相差 <b>{force(baselineError)}</b><ArrowRight size={15}/><b className="ops-prediction-color">{force(candidateError)}</b></span>
          <span>减少 <b className="ops-input-color">{force(baselineError!==null&&candidateError!==null?baselineError-candidateError:null)}</b></span><span>{hasCurrentActionMetadata(selected)?`${selected.changed_action_count} 项动作 · ${rows.length} 项关联输入`:`${rows.length} 项调整`}</span>
          {smart&&<span>总相对调整 {selected.total_relative_change}%</span>}
        </div><div className="ops-section-title ops-changes-heading"><h3>参数调整</h3></div><ChangeTable rows={rows} leftLabel="调整前" rightLabel="调整后"/>
        {smart&&<p className="micro-note">目标逼近优先比较与目标的差值；低扰动优先减少动作数及总动作幅度；综合权衡从Pareto候选中比较归一化距离。</p>}
        {selected.reference_warnings?.length>0&&<ul className="smart-reference-warning">{selected.reference_warnings.map(w=><li key={w.feature_key}>{w.label} 超出{w.source==='USER_CUSTOM_OVERRIDE'?'用户自定义':'历史'}参考范围，仅作提示。</li>)}</ul>}
        <div className="ops-plan-explanation"><UserVisibleText value={selected.description}/></div>
        <div className="ops-apply-bar"><span>{stale?'参数已变化，请重新生成方案。':''}</span>{formal&&onLoadDraft?<button className="ops-button ops-primary" disabled={!canLoadDraft||!!busy||stale}
          onClick={async()=>{if(!loaded)await onLoadDraft(selected,effectivePreviewPolicy);requestAnimationFrame(()=>document.querySelector('[aria-label="方案工况"]')?.scrollIntoView?.({block:'nearest'}));}}>
          <ArrowRight size={15}/>{smart?'方案对比':loaded?'方案已载入':'载入为方案工况'}
        </button>:<span>{selected.mode==='demo'?'DEMO · 只读候选':'只读候选方案'}</span>}</div>
        <section className="ops-ai-explanation" aria-label="候选方案解读"><h3>DK AI方案解读</h3>
          {explanation.facts?.length>0&&<div><h4>方案事实</h4><dl>{explanation.facts.filter(fact=>!isTechnicalLabel(fact.label)).map(fact=><div key={fact.label}><dt>{userVisibleText(fact.label)}</dt><dd><UserVisibleText value={fact.value}/></dd></div>)}</dl></div>}
          <button className="ops-button" onClick={()=>onExplainCandidate?.(selected)} disabled={!formal||stale||!canLoadDraft||(smart&&!abReady)||explanationBusy||explanation.status==='requesting'||!onExplainCandidate}>
            {explanation.status==='requesting'?'解读中…':smart?'DK AI解读':'DK AI解读此方案'}
          </button><div role="status">{explanation.status==='ready'?<UserVisibleText value={explanation.text}/>:explanation.status==='unavailable'?'DK AI方案解读当前不可用。':explanation.status==='requesting'?'正在解读此候选方案…':smart&&!abReady?'请先进入方案对比，并执行方案预测。':'点击后解读当前候选，不会自动試算或采用。'}</div>
          <h4>证据边界</h4><UserVisibleText value={explanation.boundary||'候选仅表示本次模型对输入变化的响应，不证明参数是物理根因、方案最优或现场一定改善。最终采用由用户决定。'}/><details className="prediction-record-technical"><summary>查看技术信息</summary><pre>{JSON.stringify(explanation,null,2)}</pre></details>
        </section>
      </>:null}
    </div></div>}
  </section>;
}

export function DraftWorkspace({draft,currentPrediction,currentObservation,baselineValid,promoting=false,busy='',onPredict,onPromote,onDiscard,candidatePlans=[],displaySelection}) {
  if(!draft)return null;
  const labels={LOADED:'方案已载入',PREDICTING:'方案预测中',PREDICTED:'方案预测已完成',BASELINE_STALE:'当前工况已更新',PROMOTED:'已采用为当前工况',DISCARDED:'方案已放弃'};
  const terminal=['PROMOTED','DISCARDED'].includes(draft.status),isCurrentBaseline=currentPrediction?.snapshot_id===draft.baseline_snapshot_id;
  const baseline=isCurrentBaseline?currentPrediction:draft.baseline_prediction,baselineObservation=isCurrentBaseline?currentObservation:baseline?.observation;
  const prediction=draft.prediction,observation=prediction?.observation;
  const sourcePlan=candidatePlans.find(plan=>plan.id===draft.source_plan_id&&plan.baseline_snapshot_id===draft.baseline_snapshot_id&&plan.target_snapshot_id===draft.candidate_preview_snapshot_id);
  const policyKinds={TARGET_APPROACH:'TARGET_PRIORITY',LOW_DISTURBANCE:'MIN_ADJUSTMENT',BALANCED:'BALANCED'};
  const displayedPolicy=displaySelection?.draftId===draft.draft_id?displaySelection.policy:null;
  const confirmedPolicy=sourcePlan?.recommendation_labels?.includes(policyKinds[displayedPolicy])?displayedPolicy:Object.keys(policyKinds).find(policy=>sourcePlan?.recommendation_labels?.length===1&&sourcePlan.recommendation_labels[0]===policyKinds[policy]);
  const planName=POLICY_BUTTON_LABELS[confirmedPolicy]||sourcePlan?.title||'方案工况';
  const hasCandidateTarget=sourcePlan && Object.hasOwn(sourcePlan,'target_s5');
  const baselineTarget=hasCandidateTarget?sourcePlan.target_s5:baseline?.inputContext?.target;
  const draftTarget=hasCandidateTarget?sourcePlan.target_s5:draft.input?.target;
  const baselineDeviation=Number.isFinite(baseline?.value)&&Number.isFinite(baselineTarget)?baseline.value-baselineTarget:null;
  const draftDeviation=Number.isFinite(prediction?.value)&&Number.isFinite(draftTarget)?prediction.value-draftTarget:null;
  return <section className="operations-workspace" aria-label="方案工况" data-draft-id={draft.draft_id} data-draft-status={draft.status}>
    <header className="ops-toolbar"><div className="ops-tool-title"><SlidersHorizontal size={19}/><div><h2>方案工况</h2><span>{labels[draft.status]}</span></div></div><div className="ops-toolbar-actions">
      {!terminal&&<><button className="ops-button" onClick={onPredict} disabled={draft.status!=='LOADED'||!baselineValid||promoting}>执行方案预测</button><button className="ops-button ops-primary" onClick={onPromote} disabled={draft.status!=='PREDICTED'||!baselineValid||promoting||!!busy}>采用为当前工况</button><button className="ops-button" onClick={onDiscard} disabled={promoting}>放弃方案</button></>}
    </div></header>
    <p className="micro-note">方案可生成 QCDKR预测，不会因此产生实际值。只改变软件内部后续分析对象，不代表设备控制或生产参数执行。</p>
    {!terminal&&<><table className="ops-ab-table"><thead><tr><th>对比项</th><th>当前工况</th><th>方案工况</th></tr></thead><tbody>
      <tr><th>工况状态</th><td>{isCurrentBaseline?'当前工况':'原始工况（已过期）'}</td><td>{userVisibleText(planName)} · {draft.status==='BASELINE_STALE'?'已过期':'待应用'}</td></tr>
      <tr className="ops-ab-prediction"><th>S5 预测</th><td>{force(baseline?.value)}</td><td>{force(prediction?.value)}</td></tr>
      <tr><th>与目标偏差</th><td>{signedForce(baselineDeviation)}</td><td>{signedForce(draftDeviation)}</td></tr>
      <tr><th>S5 实际值</th><td>{force(baselineObservation?.value)}</td><td>{observation?.value==null?'方案工况未提供实际值':force(observation.value)}</td></tr>
    </tbody></table><ChangeTable rows={draft.changes.map(change=>({...change,delta:change.after-change.before}))} leftLabel="调整前" rightLabel="方案值"/>
    </>}
    <details className="micro-note"><summary>查看技术信息</summary><p>当前工况快照：{baseline?.snapshot_id||draft.baseline_snapshot_id||'—'}</p><p>方案工况快照：{draft.snapshot?.snapshot_id||'尚未预测'}</p><p>候选预览：{draft.candidate_preview_snapshot_id}；来源计划：{draft.source_plan_id}。</p><p>QCDKR模型复算 · {baseline?.model_version || '—'}</p><p>SHA-256：{baseline?.model_hash || '—'}</p></details>
    {draft.error&&<div role="status"><UserVisibleText value={draft.error}/></div>}
  </section>;
}

function caseDifferences(first, second) {
  if (!first || !second) return [];
  const rows = [];
  const add = (stand, field, before, after) => {
    if (before === after || (Number.isFinite(before) && Number.isFinite(after) && Math.abs(before - after) < .000001)) return;
    rows.push({ stand, field, before, after, delta: Number.isFinite(before) && Number.isFinite(after) ? after - before : null });
  };
  for (const field of ['width', 'entrySetThickness', 'target']) add('全线', field, first[field], second[field]);
  if (first.steelGrade !== second.steelGrade) rows.push({ stand: '全线', field: '钢种', before: first.steelGrade || '—', after: second.steelGrade || '—', delta: null });
  for (const firstStand of first.stands || []) {
    const secondStand = second.stands?.find(stand => stand.id === firstStand.id);
    for (const field of STAND_FIELDS) add(firstStand.id, field, firstStand[field], secondStand?.[field]);
  }
  return rows;
}

export function HistoryWorkspace({ cases = [], caseData, resultCase, result, dirty = false, onSave, onLoad, onDelete, onBack }) {
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [showDifferences, setShowDifferences] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const chosen = selectedIds.map(id => cases.find(item => item.id === id)).filter(Boolean);
  const list = useMemo(() => cases.filter(item => `${item.name || ''} ${item.id || ''} ${item.input?.id || ''} ${item.input?.steelGrade || ''}`.toLowerCase().includes(query.trim().toLowerCase())), [cases, query]);
  const first = chosen[0];
  const frozenInput = result?.inputContext || resultCase;
  const currentResultStale = dirty || !summarizeModelInputs(caseData).valid || !frozenInput
    || modelInputFingerprint(caseData) !== modelInputFingerprint(frozenInput)
    || reportInputFingerprint(engineeringContextForRequest(caseData)) !== reportInputFingerprint(engineeringContextForRequest(frozenInput));
  const second = chosen[1] || { name: currentResultStale ? '上次结果 / 当前结果待更新' : '当前工况', input: frozenInput, prediction: currentResultStale ? null : result };
  const differences = useMemo(() => caseDifferences(first?.input, second?.input), [first?.input, second?.input]);
  const difference = Number.isFinite(first?.prediction?.value) && Number.isFinite(second?.prediction?.value) ? second.prediction.value - first.prediction.value : null;
  const toggle = id => setSelectedIds(previous => {
    const valid = previous.filter(value => cases.some(item => item.id === value));
    return valid.includes(id) ? valid.filter(value => value !== id) : valid.length < 2 ? [...valid, id] : valid;
  });
  return <section className="operations-workspace ops-history" aria-label="已保存工况工作区"><header className="ops-toolbar"><div className="ops-tool-title"><History size={19}/><div><h2>工况记录</h2></div></div>{onBack&&<button className="ops-button" onClick={onBack} style={{marginLeft:'auto'}}><ArrowLeft size={15}/>返回参数</button>}<button className="ops-button ops-primary" onClick={onSave}><ArrowDownToLine size={15}/>保存当前工况</button></header>
    <div className="ops-history-filter"><label className="ops-search"><Search size={15}/><input aria-label="搜索已保存工况" placeholder="搜索编号或钢种" value={query} onChange={event => setQuery(event.target.value)}/></label><span>{list.length} 条记录</span><span className="ops-compare-count">已选 {chosen.length} / 2</span>{chosen.length > 0 && <button className="ops-text-button" onClick={() => setSelectedIds([])}>清空选择</button>}</div>
    {cases.length ? <div className="ops-history-list ops-table-scroll"><table><thead><tr><th>比较</th><th>工况 / 钢种</th><th>保存时间</th><th>S5 预测</th><th>目标</th><th>操作</th></tr></thead><tbody>{list.map(item => <tr key={item.id} className={selectedIds.includes(item.id) ? 'is-selected' : ''}><td><input type="checkbox" aria-label={`对比 ${readableConditionName(item.name || item.id)}`} checked={selectedIds.includes(item.id)} disabled={!selectedIds.includes(item.id) && chosen.length >= 2} onChange={() => toggle(item.id)}/></td><td><strong>{readableConditionName(item.name || item.input?.id || item.id)}</strong><small>{item.input?.steelGrade || '钢种未记录'} · {format(item.input?.width, 0)} mm</small><details className="prediction-record-technical"><summary>查看技术信息</summary><pre>{JSON.stringify(item,null,2)}</pre></details></td><td><time>{stamp(item.createdAt)}</time></td><td className="ops-prediction-color">{force(item.prediction?.value)}</td><td className="ops-target-color">{force(item.input?.target)}</td><td><div className="ops-row-actions"><button className="ops-text-button" onClick={() => onLoad?.(item)} disabled={!item.input}>载入<ArrowRight size={12}/></button>{deletingId === item.id ? <><button className="ops-text-button ops-delete" onClick={() => { onDelete?.(item); setDeletingId(null); }}>确认删除</button><button className="ops-text-button" onClick={() => setDeletingId(null)}>取消</button></> : <button className="ops-icon-button" aria-label={`删除 ${readableConditionName(item.name || item.id)}`} onClick={() => setDeletingId(item.id)}><Trash2 size={14}/></button>}</div></td></tr>)}{!list.length && <tr><td colSpan="6" className="ops-table-empty">没有匹配“{query}”的记录。<button className="ops-text-button" onClick={() => setQuery('')}>清除搜索</button></td></tr>}</tbody></table></div> : <div className="ops-history-empty"><History size={28}/><div><h3>还没有保存的工况</h3><p>保存当前 {readableConditionName(caseData?.id)}，保留工况输入、S5 计算结果和保存时间，之后即可恢复或逐项比较。</p><button className="ops-button" onClick={onSave}><Plus size={14}/>保存当前工况</button></div><div className="ops-empty-preview"><span>{currentResultStale ? '当前结果待更新' : '当前 S5 预测'}</span><strong>{force(currentResultStale ? null : result?.value)}</strong><small>目标 {force(caseData?.target)} · {caseData?.steelGrade}</small></div></div>}
    <div className="ops-history-comparison"><div className="ops-section-title"><h3><GitCompareArrows size={16}/>参数与结果对比</h3><span>{chosen.length === 1 ? '已选记录 → 当前工况' : chosen.length === 2 ? '按勾选顺序：A → B' : '选一条与当前比较，选两条互相比较'}</span></div>{first ? <><div className="ops-comparison-identity"><div><span>A</span><strong>{readableConditionName(first.name || first.input?.id)}</strong><small>{stamp(first.createdAt)}</small></div><ArrowRight size={17}/><div><span>B</span><strong>{readableConditionName(second.name || second.input?.id)}</strong><small>{chosen.length === 2 ? stamp(second.createdAt) : currentResultStale ? '上次工况输入 · 当前结果待更新' : '当前预测对应输入'}</small></div><div className="ops-comparison-delta"><small>S5 预测差值 B − A</small><strong className="ops-prediction-color">{signedForce(difference)}</strong></div></div><div className="ops-history-detail"><div><ValueComparison label="已保存工况 S5 对比" items={[{ label: 'A 预测', value: first.prediction?.value, color: '#8ecbbd' }, { label: 'B 预测', value: second.prediction?.value, color: '#78c9eb' }, { label: 'A 目标', value: first.input?.target, color: '#d9b88b' }, ...(first.input?.target !== second.input?.target ? [{ label: 'B 目标', value: second.input?.target, color: '#b9abc9' }] : [])]}/><p className="ops-chart-caption">已保存工况对比，非现场连续采样。</p></div><div><button className="ops-difference-toggle" aria-expanded={showDifferences} onClick={() => setShowDifferences(value => !value)}><ChevronRight size={14} className={showDifferences ? 'is-expanded' : ''}/><strong>{differences.length} 项输入发生变化</strong><span>{showDifferences ? '收起' : '展开'}</span></button>{showDifferences && <ChangeTable rows={differences} leftLabel="A" rightLabel="B" empty="两份工况的参数一致。"/>}</div></div></> : <div className="ops-comparison-placeholder"><span className="ops-selection-example">A</span><span>勾选工况后，在这里核对 S5 差值和具体变更字段。</span><span className="ops-selection-example">B</span></div>}</div>
  </section>;
}
