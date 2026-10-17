import { currentActualValue, trendActualValue } from './s5ActualDisplay.js';
import { monitorData } from './dataMonitoring.js';
import { formatEngineering } from './engineeringUnits.js';
import './agent-status.css';
import { dataSourceDisplayName, REFERENCE_RANGE_NOTICE } from './workbenchDisplay.js';
import { currentModelReferenceRanges } from './inputRangeDefaults.js';
import { readCustomLimits } from './historicalRangeCheck.js';

export default function GlobalProcessStatus({input,result,sample,dirty,modelStatus,stream}) {
  const single=stream.mode==='manual';
  const monitoring=monitorData({mode:single?'single':'timeseries',input,frames:stream.frames,currentIndex:stream.cursor,referenceRanges:currentModelReferenceRanges(readCustomLimits(globalThis.localStorage))});
  const validation=monitoring.validation, drift=monitoring.drift;
  const observed=currentActualValue({caseData:input,result,resultSample:sample,dirty});
  const pairs=single?[]:stream.frames.slice(0,stream.cursor+1).filter(frame=>frame.result?.mode==='formal'&&Number.isFinite(frame.predicted)&&trendActualValue(frame)!==null);
  const mae=pairs.length?pairs.reduce((sum,frame)=>sum+Math.abs(frame.predicted-trendActualValue(frame)),0)/pairs.length:null;
  const performance=dirty?'等待本次预测':single?observed===null?'未提供实际值':`误差 ${formatEngineering('force',result.value-observed,3)}`:mae===null?'等待实际值':`MAE ${formatEngineering('force',mae,3)} · ${pairs.length} 点`;
  const source=dataSourceDisplayName(single?(sample?.source_type==='PUBLIC_DATA'?'公开 CRD 样本':sample?.source_type==='CSV_REPLAY'?'CSV 单工况':sample?.source_type==='DEMO'?'演示工况':'手动工况'):stream.sourceName);
  const details=validation.outOfRange.map(feature=>`${feature.label} ${formatEngineering(feature.field,feature.value)}，范围 ${formatEngineering(feature.field,feature.minimum)}–${formatEngineering(feature.field,feature.maximum)}`).join('\n');
  return <><section className="global-process-status" aria-label="全局工艺状态">
    <div><small>当前数据模式</small><strong className="source-mode">{single?'单工况':'时序'}{stream.mode==='demo'?' · 工业数据':''}</strong></div>
    <div title={[...validation.missing,...validation.invalid].map(x=>x.label).join('、')}><small>模型输入完整度</small><strong className={validation.valid?'status-good':'status-warning'}>{validation.completeCount} / 25</strong></div>
    <div title={(details||validation.rangeSource)+'；'+REFERENCE_RANGE_NOTICE}><small>越界检查</small><strong className={validation.outOfRangeCount?'status-warning':''}>{validation.outOfRangeCount?`${validation.outOfRangeCount} 项越界`:validation.rangeStatus==='UNKNOWN'?'参考范围待载入':validation.rangeStatus==='PARTIAL'?'部分范围已检查':'参考范围内'}</strong></div>
    <div title={modelStatus.reason}><small>模型状态</small><strong className={modelStatus.available?'status-good':'status-warning'}>{dirty&&modelStatus.available?'计算中':modelStatus.available?'已就绪':modelStatus.status==='BLOCKED'?'未就绪':'连接中'}</strong></div>
    <div title={source}><small>数据源</small><strong>{source}</strong></div>
    <div title={single?'预测误差 = 模型预测 − 匹配实际值':'仅统计已经回放、完成正式预测且有实际值的样本'}><small>预测表现</small><strong>{performance}</strong></div>
    <div title={result.drivers?.slice(0,3).map(x=>x.name).join('、')}><small>敏感因素</small><strong>{dirty?'待更新':result.drivers?.[0]?.name||'尚未计算'}</strong></div>
    {!single&&<div title={drift.reason}><small>输入漂移</small><strong className={drift.status==='DRIFT_DETECTED'?'status-warning':''}>{drift.status==='INSUFFICIENT_DATA'?'样本积累中':drift.status==='DRIFT_DETECTED'?`${drift.driftedCount} 项变化`:'未见漂移'}</strong></div>}
  </section>{!single&&<details className="global-drift-details"><summary>漂移监测 · {drift.reason}</summary><p>{drift.method}{drift.windows?.reference?`；基准第 ${drift.windows.reference.startIndex+1}–${drift.windows.reference.endIndex+1} 条，当前第 ${drift.windows.current.startIndex+1}–${drift.windows.current.endIndex+1} 条。`:''}</p><ul>{drift.features.filter(x=>x.drifted).map(x=><li key={x.key}>{x.label}：{formatEngineering(x.field,x.referenceMean)} → {formatEngineering(x.field,x.currentMean)}</li>)}</ul></details>}</>;
}
