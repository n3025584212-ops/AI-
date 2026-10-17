import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, Check, ChevronLeft, ChevronRight, Download, FileText, Filter, Loader2, RefreshCw, Search, X, Bot, Cpu, Database, Layers3, Settings2, Terminal, ScrollText } from 'lucide-react';
import { OperationsDialog, ServiceBadge, downloadOperationalFile, maintenanceStamp } from './MaintenanceWorkspace.jsx';
import './maintenance-workspace.css';
import './logs-workspace.css';
import LogDateTimeField from './LogDateTimeField.jsx';
import {LOG_PAGE_SIZE,defaultLogFilters,historicalLogFilters,logFilterError,logQuery,parseLocalLogTime,readLogPage,readAllLogRows} from './logQuery.js';
import { actualDisplayText } from './s5ActualDisplay.js';
import { AnalysisProgress,PredictionRecordValues,predictionRecordTime,predictionRecordStamp } from './AiAnalysisWorkspace.jsx';
import { useRetentionLease } from './useAiAnalysis.js';
import UserVisibleText from './UserVisibleText.jsx';
import { modelDisplayName, userVisibleText } from './userVisibleText.js';

const PAGE_SIZE = LOG_PAGE_SIZE;
const CATEGORIES = [['', '全部日志'], ['system', '系统日志'], ['model', '模型日志'], ['data', '数据接入日志'], ['event', '事件日志'], ['agent', 'AI 任务日志'], ['maintenance', '维护日志']];
const LEVELS = { info: '信息', warning: '警告', warn: '警告', error: '错误', critical: '严重', success: '成功' };
const EVENT_TYPES = { prediction_deviation: '预测偏差', missing_inputs: '输入缺失', input_out_of_range: '输入越界', parameter_change: '参数变化', data_delay: '数据延迟', prediction_service: '预测服务', model_error: '模型异常' };
const CATEGORY_NAMES = Object.fromEntries(CATEGORIES.filter(([key]) => key));
const categoryKey = value => ({ prediction: 'model', auth: 'system', ai: 'agent' })[value] || value;
const CATEGORY_ICONS = { system: Terminal, model: Cpu, data: Database, event: AlertTriangle, agent: Bot, maintenance: Settings2 };
function LogModuleIcon({ category, large = false }) {
  const key = categoryKey(category), Icon = CATEGORY_ICONS[key] || ScrollText;
  return <span aria-hidden="true" className={`log-module-icon module-${key || 'all'}${large ? ' is-large' : ''}`}>{large?<svg viewBox="0 0 64 64" width="52" height="52"><ellipse cx="32" cy="55" rx="24" ry="5" fill="currentColor" opacity=".08"/><path d="m8 40 26-12 23 14-26 13Z" fill="currentColor" opacity=".1"/><path d="m13 34 24-12 17 11-24 12Z" fill="#1c2d39" stroke="currentColor" strokeOpacity=".3"/><path d="m14 14 24-9 14 9v22l-24 11-14-9Z" fill="#182a35" stroke="currentColor" strokeWidth="1.3"/><path d="m14 14 14 10 24-10M28 24v23" fill="none" stroke="currentColor" opacity=".55"/><path d="m34 26 12-5m-12 11 12-5m-12 11 8-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="m17 17 19-8 11 7-19 8Z" fill="currentColor" opacity=".16"/></svg>:<Icon size={15}/>}</span>;
}
function shortTime(value) { return value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '—'; }
function stringValue(value) { return value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value); }
function Level({ value }) { const level = String(value || 'info').toLowerCase(); return <span className={`ops-log-level level-${level}`}><i/>{LEVELS[level] || '未分类'}</span>; }
function useRecords(api, endpoint, query, page, realtime = false) {
  const [data, setData] = useState({items:[],total:0}), [error,setError] = useState(''), [loading,setLoading] = useState(true);
  const generation=useRef(0),apiRef=useRef(api),inFlight=useRef(false);apiRef.current=api;
  const refresh=useCallback(async(quiet=false)=>{
    if(quiet===true&&inFlight.current)return;
    const current=++generation.current;inFlight.current=true;
    if(quiet!==true){setLoading(true);setError('');setData({items:[],total:0});}
    try {const result=await readLogPage(apiRef.current,endpoint,query,page);if(generation.current===current){setData(result);setError('');}}
    catch(failure){if(generation.current===current)setError(failure.message||'读取失败，请重试');}
    finally {if(generation.current===current){inFlight.current=false;setLoading(false);}}
  },[endpoint,query,page]);
  useEffect(()=>{void refresh();return()=>{generation.current+=1;};},[refresh]);
  useEffect(()=>{
    if(!realtime||page!==1)return;
    let stopped=false,timer;
    const tick=async()=>{await refresh(true);if(!stopped)timer=setTimeout(tick,3000);};
    timer=setTimeout(tick,3000);
    return()=>{stopped=true;clearTimeout(timer);};
  },[realtime,page,refresh]);
  return {data,error,loading,refresh};
}
function Pagination({page,total,onPage,selectedCount,loading=false}) {
 const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
 return <footer className="ops-log-pagination"><span>共 {total} 条 · 本页 {selectedCount??0} 条</span><div><button aria-label="上一页" disabled={loading||page<=1} onClick={()=>onPage(page-1)}><ChevronLeft size={15}/></button><span>{loading?'正在读取':`第 ${Math.min(page,pages)} / ${pages} 页`}</span><button aria-label="下一页" disabled={loading||page>=pages} onClick={()=>onPage(page+1)}><ChevronRight size={15}/></button></div></footer>;
}
function SearchFilters({ filters, setFilters, onSubmit, disabled, onLevelChange, events = false }) { return <form className="ops-log-filters" onSubmit={event => { event.preventDefault(); onSubmit(); }}><Filter size={15}/>{filters.scope!=='realtime'&&<><LogDateTimeField label="开始时间" value={filters.from} onChange={value=>setFilters(current=>({...current,from:value}))}/><LogDateTimeField label="结束时间" value={filters.to} onChange={value=>setFilters(current=>({...current,to:value}))}/></>}<label className="ops-log-select"><span>{events ? '严重程度' : '日志级别'}</span><select aria-label={events?"严重程度":"日志级别"} value={filters.level} onChange={event => onLevelChange ? onLevelChange(event.target.value) : setFilters(current => ({ ...current, level: event.target.value }))}><option value="">全部级别</option><option value="info">信息</option><option value="warning">警告</option><option value="error">错误</option><option value="critical">严重</option></select></label>{events && <label className="ops-log-select"><span>处理状态</span><select value={filters.state} onChange={event => setFilters(current => ({ ...current, state: event.target.value }))}><option value="">全部状态</option><option value="open">待确认</option><option value="acknowledged">已确认</option></select></label>}<label className="ops-log-search"><Search size={14}/><input aria-label={events ? '搜索事件' : '搜索日志'} placeholder="输入关键词…" value={filters.query} onChange={event => setFilters(current => ({ ...current, query: event.target.value }))}/></label><button className="maint-button primary" type="submit" disabled={disabled}>查询</button></form>; }
const initialFilters = { from: '', to: '', level: '', query: '', state: '' };
const buildQuery=logQuery;
// Filtering is repeated locally so an older server cannot quietly ignore a UI filter.
function filterRows(items, filters, events = false) { return items.filter(item => {
  const level = String(events ? item.severity : item.level).toLowerCase(), expected = filters.level;
  if (expected && level !== expected && !(expected === 'warning' && level === 'warn')) return false;
  if (events && filters.state && (item.acknowledgedAt ? 'acknowledged' : 'open') !== filters.state) return false;
  const time = new Date(item.createdAt).getTime();
  if (filters.from && (!Number.isFinite(time) || time < new Date(filters.from).getTime())) return false;
  if (filters.to && (!Number.isFinite(time) || time > parseLocalLogTime(filters.to).getTime()+59999)) return false;
  return !filters.query || JSON.stringify(item).toLowerCase().includes(filters.query.toLowerCase());
}); }
const isPredictionRecord=item=>item.category==='prediction'&&(Number.isFinite(item.details?.rawPrediction)||/S5\s*(?:轧制力)?预测已完成/.test(item.message||''));
function predictionRecordView(item,analysis) {
 const saved=analysis?.records?.find(row=>row.sourceLogId===item.id||row.sourceLogIds?.includes(item.id)),details=item.details||{};
 return {record:saved||details,range:saved?analysis.predictionErrorAlarmRangeSnapshot:details.predictionErrorAlarmRangeSnapshot||details.predictionErrorAlarmRange,
  modelVersion:details.modelVersion||saved?.modelVersion||item.modelVersion,details};
}
function Details({ selected, events = false, onClose, onAck, busy, error, onInspect,predictionRecordContext }) {
 if(!events&&isPredictionRecord(selected)) {
  const view=predictionRecordView(selected,predictionRecordContext),modelName=modelDisplayName(view.modelVersion);
  const technical=[['日志编号',selected.id],['snapshot_id',view.details.snapshot_id||selected.snapshot_id],['input_hash',view.details.input_hash||selected.input_hash],
   ['sampleId',view.details.sampleId||selected.sampleId],['modelVersion',view.modelVersion],['任务ID',selected.taskId||selected.runId||view.record.taskId],['模块',selected.category]];
  return <OperationsDialog title="预测记录详情" onClose={onClose} footer={<button className="maint-button" onClick={onClose}>关闭</button>}>
   <div className="ops-detail-title"><strong>S5轧制力预测已完成</strong></div>
   <section className="prediction-record-detail"><h4 className="ops-evidence-heading">预测结果</h4><PredictionRecordValues record={view.record} range={view.range}/>
    <h4 className="ops-evidence-heading">基本信息</h4><dl>
     {[['记录时间',predictionRecordStamp(selected.createdAt)],['模型',modelName],['记录类型','S5轧制力预测']].map(([label,value])=><div className="maint-fact" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
    <details className="prediction-record-technical" key={selected.id}><summary>查看技术信息</summary>
     <dl>{technical.map(([label,value])=><div className="maint-fact" key={label}><dt>{label}</dt><dd>{stringValue(value)}</dd></div>)}</dl>
     <h4 className="ops-evidence-heading">原始记录JSON</h4><pre className="maint-json">{JSON.stringify(selected,null,2)}</pre>
    </details>
   </section>{error&&<div className="maint-error" role="alert"><UserVisibleText value={error}/></div>}
  </OperationsDialog>;
 }
  const fields = events ? [['事件编号', selected.id], ['发生时间', maintenanceStamp(selected.createdAt)], ['事件类型', EVENT_TYPES[selected.type] || selected.type], ['关联规则', selected.ruleId], ['样本编号', selected.sampleId], ['处理状态', Boolean(selected.acknowledgedAt) ? '已确认' : '待确认'], ['检测状态', ({active:'事件已触发',resolved:'已恢复'})[selected.state] || selected.state]] : [['日志编号', selected.id], ['记录时间', maintenanceStamp(selected.createdAt)], ['所属模块', CATEGORY_NAMES[categoryKey(selected.category)] || selected.category], ['任务编号', selected.runId]];
  return <OperationsDialog data-event-id={events ? selected.id : undefined} title={events ? '异常事件详情' : '运行日志详情'} onClose={onClose} footer={<>{events && onInspect && <button className="maint-button" onClick={() => { onInspect(selected); onClose(); }}>让 AI 核查<ChevronRight size={14}/></button>}{events && !selected.acknowledgedAt && <button className="maint-button primary" disabled={busy} onClick={onAck}>{busy ? <Loader2 className="spin" size={15}/> : <Check size={15}/>}确认已查看</button>}<button className="maint-button" onClick={onClose}>关闭</button></>}>
    <div className="ops-detail-title"><Level value={events ? selected.severity : selected.level}/><strong>{userVisibleText(actualDisplayText(selected.title || selected.message))}</strong></div><dl>{fields.filter(([key, value]) => value && !['事件编号','关联规则','样本编号','日志编号','任务编号'].includes(key)).map(([key, value]) => <div className="maint-fact" key={key}><dt>{key}</dt><dd>{key==='事件类型'?(EVENT_TYPES[selected.type]||'其他事件'):key==='所属模块'?(CATEGORY_NAMES[categoryKey(selected.category)]||'其他日志'):userVisibleText(value)}</dd></div>)}</dl>{events && selected.message && <UserVisibleText value={actualDisplayText(selected.message)}/>}<details className="prediction-record-technical" key={selected.id}><summary>查看技术信息</summary><dl>{fields.filter(([,value])=>value).map(([key,value])=><div className="maint-fact" key={key}><dt>{key}</dt><dd>{stringValue(value)}</dd></div>)}</dl><pre className="maint-json">{JSON.stringify(selected,null,2)}</pre></details>{error && <div className="maint-error" role="alert"><UserVisibleText value={error}/></div>}{events && selected.acknowledgedAt && <p>确认时间：{maintenanceStamp(selected.acknowledgedAt)}</p>}
  </OperationsDialog>;
}

export function LogsWorkspace({ api, onNotify,analysisStatus,analysisError,onAnalysisHistory,onAnalyzeCurrent,focusLogId,onLogFocused,predictionRecordContext }) {
  const [initial]=useState(defaultLogFilters);
  const [category, setCategory] = useState(''), [filters, setFilters] = useState(initial), [applied, setApplied] = useState(initial), [page, setPage] = useState(1), [selected, setSelected] = useState(null), [filterError, setFilterError] = useState('');
  const { data, error, loading, refresh } = useRecords(api, '/logs', buildQuery(applied, category),page,applied.scope==='realtime');
  const retentionCheckedAt=analysisStatus?.retention?.checkedAt;
  useEffect(()=>{if(retentionCheckedAt)void refresh();},[retentionCheckedAt]);
  useRetentionLease(api,{type:'LOG_DETAIL',logIds:selected?[selected.id]:[],enabled:Boolean(selected)});
  useEffect(()=>{
    if(!focusLogId)return;
    let stopped=false;
    void api('/logs/detail?id='+encodeURIComponent(focusLogId)).then(item=>{if(!stopped)setSelected(item);}).catch(failure=>onNotify?.(failure.message));
    return()=>{stopped=true;};
  },[focusLogId]);
  const rows=filterRows(data.items,applied).filter(item=>!category||categoryKey(item.category)===category),visible=rows,currentPage=page;
  const [exporting,setExporting]=useState(false);
  useEffect(()=>{if(!loading&&!error&&page>Math.max(1,Math.ceil(data.total/PAGE_SIZE)))setPage(Math.max(1,Math.ceil(data.total/PAGE_SIZE)));},[data.total,loading,error,page]);
  const submit=()=>{const message=logFilterError(filters);if(message){setFilterError(message);return;}setFilterError('');setApplied({...filters});setPage(1);if(page===1&&JSON.stringify(applied)===JSON.stringify(filters))void refresh();};
  const exportRows=async()=>{
    let lease;setExporting(true);
    try {
      const items=filterRows(await readAllLogRows(api,'/logs',buildQuery(applied,category)),applied).filter(item=>!category||categoryKey(item.category)===category);
      try{lease=await api('/logs/retention-lease',{method:'POST',body:JSON.stringify({type:'LOG_EXPORT',logIds:items.map(row=>row.id)})});}catch{}
      downloadOperationalFile(`QCDKR-日志-${new Date().toISOString().slice(0,10)}.json`,{exportedAt:new Date().toISOString(),filters:{...applied,category},count:items.length,items});onNotify?.(`已导出 ${items.length} 条日志`);
    } catch(failure){setFilterError(failure.message||'日志导出失败，请重试。');}
    finally{setExporting(false);if(lease)setTimeout(()=>void api('/logs/retention-lease',{method:'POST',body:JSON.stringify({release:true,leaseId:lease.leaseId})}).catch(()=>{}),1000);}
  };
  return <section className="event-log-workspace logs-workspace" aria-label="运行日志"><header className="maint-page-heading"><div className="logs-heading-identity"><LogModuleIcon large/><div><h2>运行日志</h2></div></div><div><button className="maint-button" disabled={loading} onClick={refresh}>{loading ? <Loader2 className="spin" size={15}/> : <RefreshCw size={15}/>}刷新</button><button className="maint-button primary" disabled={loading || exporting || !!error || !data.total} onClick={exportRows}><Download size={15}/>{exporting?'导出中…':'导出日志'}</button></div></header>
    {analysisStatus&&<AnalysisProgress status={analysisStatus} error={analysisError} onHistory={onAnalysisHistory} onAnalyze={onAnalyzeCurrent}/>}
    <small className="ai-analysis-source">{applied.scope==='realtime'?'本次运行实时日志 · 首页每3秒刷新 · 每页20条；查看旧记录请切换历史查询。':'历史查询 · 每页20条；可选择起止时间，清空时间查看保留记录。日志保留最近30天。'}</small>
    <nav className="ops-log-tabs" aria-label="日志范围">{[['realtime','实时日志'],['history','历史查询']].map(([scope,label])=><button key={scope} aria-pressed={applied.scope===scope} className={applied.scope===scope?'is-active':''} onClick={()=>{const next=scope==='realtime'?defaultLogFilters():historicalLogFilters();setFilters(next);setApplied(next);setPage(1);setFilterError('');}}>{label}</button>)}</nav>
    <nav className="ops-log-tabs" aria-label="日志分类">{CATEGORIES.map(([value, label]) => <button key={value} aria-pressed={category === value} className={category === value ? 'is-active' : ''} onClick={() => { setCategory(value); setPage(1); }}><LogModuleIcon category={value}/><span>{label}</span></button>)}</nav>
    <SearchFilters filters={filters} setFilters={setFilters} onSubmit={submit} disabled={loading} onLevelChange={level => { setFilters(current => ({ ...current, level })); setApplied(current => ({ ...current, level })); setPage(1); }}/>{(error || filterError) && <div className="maint-error" role="alert"><UserVisibleText value={error || filterError}/><button onClick={refresh}>重试</button></div>}
    <div className="logs-query-summary" aria-live="polite"><span><i className={loading ? 'is-loading' : ''}/>{loading ? '正在读取' : applied.scope==='realtime'?'本次运行':'历史查询'}<strong>{data.total}</strong>条记录 · 本页 {rows.length} 条</span><div><span className="log-count-error">本页错误 / 严重 <b>{rows.filter(item => ['error','critical'].includes(String(item.level).toLowerCase())).length}</b></span><span className="log-count-warning">本页警告 <b>{rows.filter(item => ['warning','warn'].includes(String(item.level).toLowerCase())).length}</b></span><span>本页最新记录 <b>{rows.length ? shortTime(rows[0].createdAt) : '—'}</b></span></div></div>
    <div className="ops-log-table-wrap"><table className="ops-log-table"><thead>{visible.length>0&&visible.every(isPredictionRecord)?<tr><th>预测记录</th><th>操作</th></tr>:<tr><th>时间</th><th>级别</th><th>所属模块</th><th>日志内容</th><th>操作</th></tr>}</thead><tbody>{visible.map(item=>{
      if(isPredictionRecord(item)) {const view=predictionRecordView(item,predictionRecordContext);return <tr key={item.id} data-level={item.level} onDoubleClick={()=>setSelected(item)}>
        <td className="ops-log-message" colSpan={visible.every(isPredictionRecord)?1:4}><strong>S5轧制力预测 · {predictionRecordTime(item.createdAt)}</strong><PredictionRecordValues record={view.record} range={view.range}/></td>
        <td><button className="ops-log-link" onClick={()=>setSelected(item)}>查看详情<ChevronRight size={12}/></button></td>
      </tr>;}
      return <tr key={item.id} data-level={item.level} onDoubleClick={()=>setSelected(item)}><td><time title={maintenanceStamp(item.createdAt)}>{shortTime(item.createdAt)}</time><small>{new Date(item.createdAt).toLocaleDateString('zh-CN').replaceAll('/','-')}</small></td><td><Level value={item.level}/></td><td><span className="log-module-label"><LogModuleIcon category={item.category}/>{CATEGORY_NAMES[categoryKey(item.category)] || '其他日志'}</span></td><td className="ops-log-message"><UserVisibleText value={actualDisplayText(item.message)}/></td><td><button className="ops-log-link" onClick={()=>setSelected(item)}>查看详情<ChevronRight size={12}/></button></td></tr>;
    })}</tbody></table>{!visible.length && <div className="ops-log-empty">{loading ? <Loader2 className="spin" size={26}/> : <FileText size={30}/>}<strong>{loading ? '正在读取日志' : error ? '日志读取失败' : '没有匹配的日志'}</strong><p>{loading ? '请稍候' : error ? '点击刷新重新读取。' : '更改筛选条件，或在执行任务后刷新。'}</p>{!loading && Object.values(applied).some(Boolean) && <button className="maint-button" onClick={() => { const reset=applied.scope==='realtime'?defaultLogFilters():{...initialFilters,scope:'history'};setFilters(reset);setApplied(reset);setPage(1); }}>清除筛选</button>}</div>}</div><Pagination loading={loading} page={currentPage} total={data.total} selectedCount={visible.length} onPage={setPage}/>{selected && <Details selected={selected} predictionRecordContext={predictionRecordContext} onClose={() => {setSelected(null);onLogFocused?.();}}/>}
  </section>;
}
