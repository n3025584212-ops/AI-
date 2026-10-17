import React,{useEffect,useState} from 'react';
import { OperationsDialog,maintenanceStamp } from './MaintenanceWorkspace.jsx';
import { formatPredictionErrorAlarmRange,formatSignedError,predictionErrorAlarm,validatePredictionErrorAlarmRange } from './predictionErrorAlarm.js';
import { useRetentionLease } from './useAiAnalysis.js';
import './ai-analysis.css';
import UserVisibleText from './UserVisibleText.jsx';

export const ANALYSIS_STATUS_LABELS={OPEN:'接收中',CLOSED:'已关闭',ANALYZING:'分析中',READY:'已生成',AI_FAILED:'AI分析未完成',INTERRUPTED:'批次中断',NOT_REQUESTED:'未生成',PENDING:'等待分析'};
export const ANALYSIS_OVERALL_LABELS={NORMAL:'正常',ATTENTION:'需关注',SEVERE:'严重'};
const number=value=>Number.isFinite(value)?value.toFixed(3):'—';
const percent=value=>Number.isFinite(value)?(value*100).toFixed(1)+'%':'—';

export const predictionRecordTime=value=>value&&Number.isFinite(new Date(value).getTime())?new Date(value).toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
export const predictionRecordStamp=value=>value&&Number.isFinite(new Date(value).getTime())?new Date(value).toLocaleString('zh-CN',{hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
export function PredictionRecordValues({record,range}) {
 const bounds=validatePredictionErrorAlarmRange(range),alarm=bounds?predictionErrorAlarm(record.rawPrediction,record.actualValue,bounds):null;
 const paired=Number.isFinite(record.rawPrediction)&&Number.isFinite(record.actualValue);
 const deviation=paired?formatSignedError(record.rawPrediction-record.actualValue)+' t':'—';
 const signed=value=>(value>0?'+':'')+String(value);
 const allowed=bounds?(bounds.lowerBound===-bounds.upperBound?'±'+String(bounds.upperBound)+' t':signed(bounds.lowerBound)+' t ～ '+signed(bounds.upperBound)+' t'):'未记录';
 const status=!Number.isFinite(record.actualValue)?'无法判断 / 暂无实际值':!Number.isFinite(record.rawPrediction)?'无法判断 / 暂无预测值':!alarm?'无法判断 / 未记录允许偏差':alarm.status==='NORMAL'?'正常':'超出允许偏差';
 return <div className="prediction-record-values">
  <p>预测值：{Number.isFinite(record.rawPrediction)?number(record.rawPrediction)+' t':'—'}</p>
  <p>实际值：{Number.isFinite(record.actualValue)?number(record.actualValue)+' t':'—'}</p>
  <p>预测偏差：{deviation}</p><p>状态：{status}</p><p>允许偏差：{allowed}</p>
 </div>;
}

export function AnalysisProgress({status,error,onHistory,onAnalyze}) {
 const current=status.current,latest=status.latest;
 return <section className="ai-analysis-progress" aria-label="AI运行分析">
  <div><strong>AI运行分析</strong><span>AI分析进度 <b>{current?.recordCount??0} / 20</b></span><small>当前批次 {current?.batchId?'已接收记录':'待接收'}</small></div>
  <div><span>最近分析 {latest?'#'+latest.analysisId:'暂无'}</span>{latest&&<small>{ANALYSIS_OVERALL_LABELS[latest.overallStatus]} · {ANALYSIS_STATUS_LABELS[latest.analysisStatus]}</small>}
   {latest&&<button className="maint-button" onClick={()=>onHistory(latest.analysisId)}>查看</button>}
   <button className="maint-button" onClick={()=>onHistory()}>AI分析记录</button>
   <button className="maint-button" disabled={!current?.recordCount} onClick={onAnalyze}>分析当前记录</button>
  </div>{error&&<div role="status"><UserVisibleText value={error}/></div>}
  <details className="prediction-record-technical"><summary>查看技术信息</summary><pre className="maint-json">{JSON.stringify(status,null,2)}</pre></details>
 </section>;
}

export function AnalysisReport({record,onViewLog,onRetry}) {
 const metrics=record.metrics||{},partial=record.analysisType!=='FULL_BATCH';
 return <div className="ai-analysis-report" data-analysis-id={record.analysisId}>
  <p className="ai-analysis-binding">#{record.analysisId} · {maintenanceStamp(record.createdAt)} · {record.recordCount}条
   · {ANALYSIS_STATUS_LABELS[record.analysisStatus]||ANALYSIS_STATUS_LABELS[record.batchStatus]}</p>
  {partial&&<p className="ai-analysis-note">未完成批次 · 当前样本数：{record.recordCount} · 标准批次大小：20</p>}
  {record.analysisStatus==='AI_FAILED'&&<p className="ai-analysis-note">运行统计已生成，AI原因分析暂未完成。<button className="maint-button" onClick={()=>onRetry(record.analysisId)}>重新生成AI分析</button></p>}
  {record.analysisStatus==='NOT_REQUESTED'&&<p className="ai-analysis-note">该未完成批次已保留，尚未生成AI原因分析。<button className="maint-button" onClick={()=>onRetry(record.analysisId)}>分析该未完成批次</button></p>}
  <section><h4>运行摘要</h4><dl className="ai-analysis-metrics">
   {[['本批记录数',record.recordCount],['预测成功数',metrics.SUCCESS_COUNT],['预测失败数',metrics.FAIL_COUNT],['有实际值',metrics.ACTUAL_AVAILABLE_COUNT],['无实际值',metrics.ACTUAL_MISSING_COUNT],
    ['输入越界数量',metrics.INPUT_OUT_OF_RANGE_COUNT],['预测误差报警',metrics.ALARM_COUNT],['平均推理耗时',number(metrics.AVERAGE_INFERENCE_TIME)+' ms'],['最大推理耗时',number(metrics.MAX_INFERENCE_TIME)+' ms']].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value??'—'}</dd></div>)}
  </dl></section>
  <section><h4>误差总结</h4><dl className="ai-analysis-metrics">
   {[['平均预测偏差',formatSignedError(metrics.ME)+' t'],['平均绝对偏差',number(metrics.MAE)+' t'],['均方根误差',number(metrics.RMSE)+' t'],['最大绝对误差',number(metrics.MAX_ABS_ERROR)+' t'],
    ['最小误差',formatSignedError(metrics.MIN_ERROR)+' t'],['最大误差',formatSignedError(metrics.MAX_ERROR)+' t'],['正误差数量',metrics.POSITIVE_ERROR_COUNT],['负误差数量',metrics.NEGATIVE_ERROR_COUNT],
    ['区间内数量',metrics.IN_RANGE_COUNT],['区间外数量',metrics.OUT_OF_RANGE_COUNT],['区间内比例',percent(metrics.IN_RANGE_RATE)]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value??'—'}</dd></div>)}
   </dl><p>有效实际值：{metrics.ACTUAL_AVAILABLE_COUNT??0} / {record.recordCount}</p>
   <p>报警区间：{record.predictionErrorAlarmRangeSnapshot?formatPredictionErrorAlarmRange(record.predictionErrorAlarmRangeSnapshot):'尚未冻结'}</p>
  </section>
  <section><h4>异常/报警</h4>{record.alarms?.length?record.alarms.map((item,index)=><p key={index}>S5轧制力预测：预测值 {number(item.rawPrediction)} t，实际值 {number(item.actualValue)} t，预测偏差 {formatSignedError(item.predictionError)} t。
   {item.errorCode==='LOW_ERROR_ALARM'?'低于下限':'超过上限'} {number(item.exceedance)} t。<button className="ops-log-link" onClick={()=>onViewLog(item.sourceLogId)}>查看详情</button></p>):<p>未检测到预测误差报警。</p>}
   {record.warnings?.map(row=><div key={row.id}>警告：<UserVisibleText value={row.message}/></div>)}{record.failures?.map(row=><div key={row.id}>失败：<UserVisibleText value={row.message}/></div>)}
  </section>
  <section><h4>日志事实</h4>{record.logFacts?.length?record.logFacts.map((item,index)=><div key={index}><UserVisibleText value={item.message}/>{item.count}条 <button className="ops-log-link" onClick={()=>onViewLog(item.sourceLogIds[0])}>查看详情</button></div>):<p>当前尚无聚合日志事实。</p>}</section>
  <section><h4>可能原因</h4><p className="ai-analysis-source">以下属于AI推断。</p>{record.possibleCauses?.length?record.possibleCauses.map((item,index)=><UserVisibleText key={index} value={item.text}/>):<p>AI原因分析尚未完成。</p>}</section>
  <section><h4>影响范围</h4><UserVisibleText value={record.impactScope||'当前仅确认本批已保存记录，不推断设备或其它批次的生产影响。'}/></section>
  <section><h4>建议处理</h4><p className="ai-analysis-source">以下属于AI建议，未执行任何修改。</p>{record.recommendations?.length?record.recommendations.map((item,index)=><UserVisibleText key={index} value={item.text}/>):<p>可核对报警记录的真实输入、实际值来源与对应原始日志。</p>}</section>
  <section><h4>预测记录</h4>{record.records?.map(row=><article className="prediction-record-entry" key={row.recordKey}>
   <strong>S5轧制力预测 · {predictionRecordTime(row.timestamp)}</strong>
   <PredictionRecordValues record={row} range={record.predictionErrorAlarmRangeSnapshot}/>
   <button className="ops-log-link" onClick={()=>onViewLog(row.sourceLogId)}>查看详情</button>
  </article>)}</section>
  <section><h4>最终状态</h4><p>{ANALYSIS_OVERALL_LABELS[record.overallStatus]||'等待统计'} · {ANALYSIS_STATUS_LABELS[record.analysisStatus]||'尚未生成'}</p></section>
  <details className="prediction-record-technical"><summary>查看技术信息</summary><pre className="maint-json">{JSON.stringify(record,null,2)}</pre></details>
 </div>;
}

export default function AiAnalysisWorkspace({api,initialId,initialFilters={},onClose,onOpen,onViewLog,onAnalyze}) {
 const [rows,setRows]=useState([]),[record,setRecord]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const [filters,setFilters]=useState({from:'',to:'',batchId:'',datasetId:'',overallStatus:'',localDate:''});
 useRetentionLease(api,{analysisIds:record?[record.analysisId]:[],logIds:record?.sourceLogIds||[],enabled:Boolean(record)});
 const load=async(queryFilters=filters)=>{setLoading(true);try{
  const params=new URLSearchParams(Object.fromEntries(Object.entries(queryFilters).filter(([,value])=>value).map(([key,value])=>[key,['from','to'].includes(key)?new Date(value).toISOString():value])));
  const value=await api('/ai-analysis/records?'+params);setRows(value.items||[]);setError('');
 }catch(failure){setError(failure.message);}finally{setLoading(false);}};
 const open=async id=>{setLoading(true);try{const value=await api('/ai-analysis/records/'+id);setRecord(value);onOpen(value);setError('');}catch(failure){setError(failure.message);}finally{setLoading(false);}};
 const initialQueryKey=JSON.stringify(initialFilters);
 useEffect(()=>{const next={from:'',to:'',batchId:'',datasetId:'',overallStatus:'',localDate:'',...initialFilters};setFilters(next);void load(next);if(initialId)void open(initialId);else setRecord(null);},[initialId,initialQueryKey]);
 useEffect(()=>{if(!record||!['PENDING','ANALYZING'].includes(record.analysisStatus))return;const timer=setInterval(()=>void open(record.analysisId),2000);return()=>clearInterval(timer);},[record?.analysisId,record?.analysisStatus]);
 const retry=async id=>{try{await onAnalyze(id);await open(id);}catch(failure){setError(failure.message);}};
 return <OperationsDialog title={record?'AI运行分析 · #'+record.analysisId:'AI分析记录'} onClose={onClose}
  footer={<>{record&&<button className="maint-button" onClick={()=>{setRecord(null);void load();}}>返回分析记录</button>}<button className="maint-button" onClick={onClose}>关闭</button></>}>
  {error&&<div className="maint-error" role="alert"><UserVisibleText value={error}/></div>}
  {record?<AnalysisReport record={record} onViewLog={onViewLog} onRetry={retry}/>:<>
   <p className="ai-analysis-source">分析记录保留：最近30天 · 时间口径：应用本地时间</p>
   <form className="ai-analysis-filters" onSubmit={event=>{event.preventDefault();void load();}}>
    {[['from','开始时间'],['to','结束时间']].map(([key,label])=><label key={key}>{label}<input aria-label={'分析'+label} type="datetime-local" value={filters[key]} onChange={event=>setFilters(previous=>({...previous,[key]:event.target.value}))}/></label>)}
    <details className="prediction-record-technical"><summary>查看技术信息</summary>{[['datasetId','数据集标识'],['batchId','批次标识']].map(([key,label])=><label key={key}>{label}<input aria-label={'分析'+label} type="text" value={filters[key]} onChange={event=>setFilters(previous=>({...previous,[key]:event.target.value}))}/></label>)}</details>
    <label>状态<select aria-label="分析状态" value={filters.overallStatus} onChange={event=>setFilters(previous=>({...previous,overallStatus:event.target.value}))}><option value="">全部</option>{Object.entries(ANALYSIS_OVERALL_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    <label>本地日期<select aria-label="分析本地日期" value={filters.localDate} onChange={event=>setFilters(previous=>({...previous,localDate:event.target.value}))}><option value="">全部</option><option>今天</option><option>昨天</option></select></label>
    <button className="maint-button" disabled={loading}>查询</button>
   </form>
   <div className="ai-analysis-history">{rows.map(row=><article key={row.analysisId}>
    <div><strong>#{row.analysisId}</strong><time>{maintenanceStamp(row.createdAt)}</time><span>{row.recordCount}条</span><span>{ANALYSIS_OVERALL_LABELS[row.overallStatus]||ANALYSIS_STATUS_LABELS[row.batchStatus]}</span></div>
    <div><span>平均绝对偏差：{number(row.MAE)} t</span><span>报警：{row.alarmCount??'—'}</span><span>{ANALYSIS_STATUS_LABELS[row.analysisStatus]||'未生成'}</span><button className="maint-button" onClick={()=>void open(row.analysisId)}>查看详情</button></div>
   </article>)}</div>{!rows.length&&<p>{loading?'正在读取分析记录…':'暂无匹配的分析记录。'}</p>}
  </>}
 </OperationsDialog>;
}
