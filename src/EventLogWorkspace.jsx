import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bot, Check, ChevronLeft, ChevronRight, Cpu, Database, Download, FileText, Loader2, RefreshCw, Search, Settings2, Terminal, ScrollText } from 'lucide-react';
import { OperationsDialog, downloadOperationalFile, maintenanceStamp } from './MaintenanceWorkspace.jsx';
import './maintenance-workspace.css';
import './logs-workspace.css';
import LogDateTimeField from './LogDateTimeField.jsx';
import { LOG_PAGE_SIZE, defaultLogFilters, historicalLogFilters, logFilterError, logQuery, parseLocalLogTime, readLogPage, readAllLogRows } from './logQuery.js';
import { actualDisplayText } from './s5ActualDisplay.js';
import { AnalysisProgress, PredictionRecordValues, predictionRecordStamp } from './AiAnalysisWorkspace.jsx';
import { useRetentionLease } from './useAiAnalysis.js';
import UserVisibleText from './UserVisibleText.jsx';
import { modelDisplayName, userVisibleText } from './userVisibleText.js';
import { LevelFilterChips, LogsInsightPanel } from './LogsInsightPanel.jsx';
import { buildLogInsight, isPredictionRecord, logAlarmRange, logCategoryKey, normalizeLogLevel } from './logsInsight.js';
import { predictionErrorAlarm, validatePredictionErrorAlarmRange } from './predictionErrorAlarm.js';

const PAGE_SIZE = LOG_PAGE_SIZE;
const CATEGORIES = [['', '全部日志'], ['system', '系统日志'], ['model', '模型日志'], ['data', '数据接入日志'], ['event', '事件日志'], ['agent', 'AI 任务日志'], ['maintenance', '维护日志']];
const LEVELS = { info: '信息', warning: '警告', warn: '警告', error: '错误', critical: '严重', success: '成功' };
const EVENT_TYPES = { prediction_deviation: '预测偏差', missing_inputs: '输入缺失', input_out_of_range: '输入越界', parameter_change: '参数变化', data_delay: '数据延迟', prediction_service: '预测服务', model_error: '模型异常' };
const CATEGORY_NAMES = Object.fromEntries(CATEGORIES.filter(([key]) => key));
const CATEGORY_ICONS = { system: Terminal, model: Cpu, data: Database, event: AlertTriangle, agent: Bot, maintenance: Settings2, other: ScrollText };
const SHORT_CATEGORY_NAMES = { system: '系统', model: '模型', data: '数据', event: '事件', agent: 'AI', maintenance: '维护', other: '其他' };
const INSIGHT_SAMPLE = 1000;
const INSIGHT_INTERVAL = 20000;
const INSIGHT_STORAGE_KEY = 'qcdkar.logs.insight-collapsed';
const LEVEL_KEYS = ['info', 'success', 'warning', 'error', 'critical'];

function LogModuleIcon({ category, large = false }) {
  const key = logCategoryKey(category), Icon = CATEGORY_ICONS[key] || ScrollText;
  return <span aria-hidden="true" className={`log-module-icon module-${key || 'all'}${large ? ' is-large' : ''}`}>{large?<svg viewBox="0 0 64 64" width="52" height="52"><ellipse cx="32" cy="55" rx="24" ry="5" fill="currentColor" opacity=".08"/><path d="m8 40 26-12 23 14-26 13Z" fill="currentColor" opacity=".1"/><path d="m13 34 24-12 17 11-24 12Z" fill="#1c2d39" stroke="currentColor" strokeOpacity=".3"/><path d="m14 14 24-9 14 9v22l-24 11-14-9Z" fill="#182a35" stroke="currentColor" strokeWidth="1.3"/><path d="m14 14 14 10 24-10M28 24v23" fill="none" stroke="currentColor" opacity=".55"/><path d="m34 26 12-5m-12 11 12-5m-12 11 8-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="m17 17 19-8 11 7-19 8Z" fill="currentColor" opacity=".16"/></svg>:<Icon size={15}/>}</span>;
}
function shortTime(value) { return value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '—'; }
function stringValue(value) { return value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value); }
function Level({ value }) { const level = normalizeLogLevel(value); return <span className={`ops-log-level level-${level}`}><i/>{LEVELS[level] || '未分类'}</span>; }
function dayKey(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}` : '未知日期'; }
function dayLabel(key) {
  if (key === '未知日期') return key;
  const date = new Date(`${key}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return key;
  return `${key} · ${date.toLocaleDateString('zh-CN', { weekday: 'long' })}`;
}

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

// The overview reads a bounded sample (newest 1000 rows of the current scope)
// and refreshes slower than the list, so the 3-second poll stays small.
function useLogInsight(api, query) {
  const [state, setState] = useState({ items: [], total: 0, loading: true, error: '', updatedAt: null });
  const generation = useRef(0), apiRef = useRef(api); apiRef.current = api;
  const load = useCallback(async (quiet = false) => {
    const current = ++generation.current;
    if (!quiet) setState(previous => ({ ...previous, loading: true, error: '' }));
    try {
      const params = new URLSearchParams(query);
      params.set('limit', String(INSIGHT_SAMPLE)); params.set('offset', '0');
      const result = await apiRef.current(`/logs?${params}`);
      if (generation.current !== current) return;
      if (!Array.isArray(result?.items)) throw new Error('日志概览读取无效，请重试。');
      setState({ items: result.items, total: Number.isSafeInteger(result.total) ? result.total : result.items.length, loading: false, error: '', updatedAt: Date.now() });
    } catch (failure) {
      if (generation.current === current) setState(previous => ({ ...previous, loading: false, error: failure.message || '日志概览读取失败' }));
    }
  }, [query]);
  useEffect(() => { void load(); return () => { generation.current += 1; }; }, [load]);
  useEffect(() => { const timer = setInterval(() => void load(true), INSIGHT_INTERVAL); return () => clearInterval(timer); }, [load]);
  return { ...state, reload: load };
}

// One tiny request per category keeps the pills honest: each number is exactly
// what the list shows after clicking that pill with the filters in force.
function useCategoryCounts(api, query) {
  const [counts, setCounts] = useState({});
  const apiRef = useRef(api); apiRef.current = api;
  useEffect(() => {
    let stopped = false;
    const run = async () => {
      const pairs = await Promise.all(CATEGORIES.map(async ([key]) => {
        const params = new URLSearchParams(query);
        params.set('limit', '1'); params.set('offset', '0');
        if (key) params.set('category', key);
        try {
          const result = await apiRef.current(`/logs?${params}`);
          return [key || 'all', Number.isSafeInteger(result?.total) ? result.total : null];
        } catch { return [key || 'all', null]; }
      }));
      if (!stopped) setCounts(Object.fromEntries(pairs));
    };
    void run();
    const timer = setInterval(run, INSIGHT_INTERVAL);
    return () => { stopped = true; clearInterval(timer); };
  }, [query]);
  return counts;
}

// Level counts cover the whole scope (the chart sample only holds the newest
// records), so a chip never says "0 错误" while the filtered list shows errors.
function useLevelCounts(api, query) {
  const [counts, setCounts] = useState({});
  const apiRef = useRef(api); apiRef.current = api;
  useEffect(() => {
    let stopped = false;
    const run = async () => {
      const pairs = await Promise.all(LEVEL_KEYS.map(async level => {
        const params = new URLSearchParams(query);
        params.set('limit', '1'); params.set('offset', '0'); params.set('level', level);
        try {
          const result = await apiRef.current(`/logs?${params}`);
          return [level, Number.isSafeInteger(result?.total) ? result.total : null];
        } catch { return [level, null]; }
      }));
      if (!stopped) setCounts(Object.fromEntries(pairs));
    };
    void run();
    const timer = setInterval(run, INSIGHT_INTERVAL);
    return () => { stopped = true; clearInterval(timer); };
  }, [query]);
  return counts;
}

function Pagination({page,total,onPage,selectedCount,loading=false}) {
 const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
 return <footer className="ops-log-pagination"><span>共 <b>{total}</b> 条 · 本页 {selectedCount??0} 条</span><div><button aria-label="上一页" disabled={loading||page<=1} onClick={()=>onPage(page-1)}><ChevronLeft size={15}/></button><span>{loading?'正在读取':`第 ${Math.min(page,pages)} / ${pages} 页`}</span><button aria-label="下一页" disabled={loading||page>=pages} onClick={()=>onPage(page+1)}><ChevronRight size={15}/></button></div></footer>;
}

const initialFilters = { from: '', to: '', level: '', query: '', state: '' };
const buildQuery = logQuery;
// Filtering is repeated locally so an older server cannot quietly ignore a UI filter.
function filterRows(items, filters, events = false) { return items.filter(item => {
  const level = normalizeLogLevel(events ? item.severity : item.level), expected = normalizeLogLevel(filters.level);
  if (expected && level !== expected) return false;
  if (events && filters.state && (item.acknowledgedAt ? 'acknowledged' : 'open') !== filters.state) return false;
  const time = new Date(item.createdAt).getTime();
  if (filters.from && (!Number.isFinite(time) || time < new Date(filters.from).getTime())) return false;
  if (filters.to && (!Number.isFinite(time) || time > parseLocalLogTime(filters.to).getTime()+59999)) return false;
  return !filters.query || JSON.stringify(item).toLowerCase().includes(filters.query.toLowerCase());
}); }

function predictionRecordView(item, analysis) {
 const saved=analysis?.records?.find(row=>row.sourceLogId===item.id||row.sourceLogIds?.includes(item.id)),details=item.details||{};
 return {record:saved||details,range:saved?analysis.predictionErrorAlarmRangeSnapshot:details.predictionErrorAlarmRangeSnapshot||details.predictionErrorAlarmRange,
  modelVersion:details.modelVersion||saved?.modelVersion||item.modelVersion,details};
}

// A compact tolerance meter: the band is the allowed deviation, the dot is the
// measured one. Values outside the band sit on the edge and turn red instead of
// disappearing off-scale.
function PredictionGauge({ deviation, range }) {
  const lower = range.lowerBound, upper = range.upperBound;
  const span = Math.max(Math.abs(lower), Math.abs(upper), Math.abs(deviation), 1) * 1.12;
  const position = value => Math.min(98, Math.max(2, 50 + (value / span) * 50));
  const breach = deviation < lower || deviation > upper;
  return <span className={`logs-gauge${breach ? ' is-breach' : ''}`} title={`允许偏差 ${lower} ～ ${upper} t · 本次 ${deviation > 0 ? '+' : ''}${deviation.toFixed(3)} t`}>
    <svg viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">
      <rect x={position(lower)} y="3.5" width={Math.max(1, position(upper) - position(lower))} height="5" className="logs-gauge-band"/>
      <line x1="50" x2="50" y1="1" y2="11" className="logs-gauge-zero"/>
    </svg>
    <i style={{ left: `${position(deviation)}%` }} />
  </span>;
}

function LogRow({ item, onOpen, predictionRecordContext, striped = false }) {
  const level = normalizeLogLevel(item.level);
  const time = new Date(item.createdAt);
  const valid = Number.isFinite(time.getTime());
  const timeCell = <td className="logs-cell-time">{valid ? <time>{shortTime(item.createdAt)}</time> : <time>—</time>}</td>;
  // Only non-info levels earn a pill; a column of "信息" on every row is noise.
  const levelPill = level !== 'info' ? <span className={`logs-level-pill level-${level}`}>{LEVELS[level] || level}</span> : null;
  const actionCell = <td className="logs-cell-action"><button type="button" className="logs-detail" onClick={() => onOpen(item)}>详情<ChevronRight size={13}/></button></td>;
  const rowProps = { className: `logs-row${striped ? ' is-striped' : ''}`, 'data-level': level, 'data-stripe': striped ? '1' : '0', onDoubleClick: () => onOpen(item) };

  if (isPredictionRecord(item)) {
    const view = predictionRecordView(item, predictionRecordContext);
    const record = view.record || {};
    const range = validatePredictionErrorAlarmRange(view.range) || logAlarmRange(item.details || {});
    const paired = Number.isFinite(record.rawPrediction) && Number.isFinite(record.actualValue);
    const deviation = paired ? record.rawPrediction - record.actualValue : null;
    const alarm = predictionErrorAlarm(record.rawPrediction, record.actualValue, range);
    const breach = alarm.status === 'HIGH_ERROR_ALARM' || alarm.status === 'LOW_ERROR_ALARM';
    const detail = [item.model, Number.isFinite(item.durationMs) ? `推理 ${item.durationMs} ms` : ''].filter(Boolean).join(' · ');
    return <tr {...rowProps} className={`${rowProps.className}${breach ? ' is-breach' : ''}`}>
      {timeCell}
      <td className="logs-cell-main"><div className="logs-main">{levelPill}<span className="logs-tag tag-model">预测</span><strong className="logs-title">S5 轧制力预测</strong>{detail && <span className="logs-sub">{detail}</span>}</div></td>
      <td className="logs-cell-metrics"><div className="logs-metrics"><PredictionRecordValues compact record={record} range={range}/>{deviation === null ? null : <PredictionGauge deviation={deviation} range={range}/>}</div></td>
      {actionCell}
    </tr>;
  }

  return <tr {...rowProps}>
    {timeCell}
    <td className="logs-cell-main"><div className="logs-main">{levelPill}<span className={`logs-tag tag-${logCategoryKey(item.category)}`}>{SHORT_CATEGORY_NAMES[logCategoryKey(item.category)] || '其他'}</span><span className="logs-text" title={stringValue(actualDisplayText(item.message))}><UserVisibleText value={actualDisplayText(item.message)}/></span></div></td>
    <td className="logs-cell-metrics"><div className="logs-metrics"><span className="logs-metrics-none">—</span></div></td>
    {actionCell}
  </tr>;
}

function Details({ selected, events = false, onClose, onAck, busy, error, onInspect, predictionRecordContext }) {
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
  const fields = events ? [['事件编号', selected.id], ['发生时间', maintenanceStamp(selected.createdAt)], ['事件类型', EVENT_TYPES[selected.type] || selected.type], ['关联规则', selected.ruleId], ['样本编号', selected.sampleId], ['处理状态', Boolean(selected.acknowledgedAt) ? '已确认' : '待确认'], ['检测状态', ({active:'事件已触发',resolved:'已恢复'})[selected.state] || selected.state]] : [['日志编号', selected.id], ['记录时间', maintenanceStamp(selected.createdAt)], ['所属模块', CATEGORY_NAMES[logCategoryKey(selected.category)] || selected.category], ['任务编号', selected.runId]];
  return <OperationsDialog data-event-id={events ? selected.id : undefined} title={events ? '异常事件详情' : '运行日志详情'} onClose={onClose} footer={<>{events && onInspect && <button className="maint-button" onClick={() => { onInspect(selected); onClose(); }}>让 AI 核查<ChevronRight size={14}/></button>}{events && !selected.acknowledgedAt && <button className="maint-button primary" disabled={busy} onClick={onAck}>{busy ? <Loader2 className="spin" size={15}/> : <Check size={15}/>}确认已查看</button>}<button className="maint-button" onClick={onClose}>关闭</button></>}>
    <div className="ops-detail-title"><Level value={events ? selected.severity : selected.level}/><strong>{userVisibleText(actualDisplayText(selected.title || selected.message))}</strong></div><dl>{fields.filter(([key, value]) => value && !['事件编号','关联规则','样本编号','日志编号','任务编号'].includes(key)).map(([key, value]) => <div className="maint-fact" key={key}><dt>{key}</dt><dd>{key==='事件类型'?(EVENT_TYPES[selected.type]||'其他事件'):key==='所属模块'?(CATEGORY_NAMES[logCategoryKey(selected.category)]||'其他日志'):userVisibleText(value)}</dd></div>)}</dl>{events && selected.message && <UserVisibleText value={actualDisplayText(selected.message)}/>}<details className="prediction-record-technical" key={selected.id}><summary>查看技术信息</summary><dl>{fields.filter(([,value])=>value).map(([key,value])=><div className="maint-fact" key={key}><dt>{key}</dt><dd>{stringValue(value)}</dd></div>)}</dl><pre className="maint-json">{JSON.stringify(selected,null,2)}</pre></details>{error && <div className="maint-error" role="alert"><UserVisibleText value={error}/></div>}{events && selected.acknowledgedAt && <p>确认时间：{maintenanceStamp(selected.acknowledgedAt)}</p>}
  </OperationsDialog>;
}

export function LogsWorkspace({ api, onNotify, onNavigate, analysisStatus, analysisError, onAnalysisHistory, onAnalyzeCurrent, focusLogId, onLogFocused, predictionRecordContext }) {
  const [initial] = useState(defaultLogFilters);
  const [twinStand,setTwinStand]=useState(null);
  useEffect(()=>{
    const handler=event=>{const stand=String(event.detail?.stand||'').toUpperCase();if(/^S[1-5]$/.test(stand))setTwinStand(stand);};
    window.addEventListener('qcdkr:stand-selected',handler);
    return()=>window.removeEventListener('qcdkr:stand-selected',handler);
  },[]);
  const [category, setCategory] = useState('');
  const [filters, setFilters] = useState(initial);
  const [applied, setApplied] = useState(initial);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [filterError, setFilterError] = useState('');
  const [exporting, setExporting] = useState(false);
  // On short screens the log stream matters more than the overview, so the
  // panel starts collapsed there; an explicit toggle is remembered.
  const [collapsed, setCollapsed] = useState(() => {
    try { const saved = localStorage.getItem(INSIGHT_STORAGE_KEY); if (saved !== null) return saved === '1'; } catch {}
    return typeof window !== 'undefined' && window.innerHeight < 820;
  });

  const { data, error, loading, refresh } = useRecords(api, '/logs', buildQuery(applied, category), page, applied.scope === 'realtime');
  const insightQuery = buildQuery({ scope: applied.scope, from: applied.from, to: applied.to, level: '', query: '', state: '' }, '');
  const insightState = useLogInsight(api, insightQuery);
  const counts = useCategoryCounts(api, buildQuery(applied, ''));
  const levelCounts = useLevelCounts(api, buildQuery({ ...applied, level: '' }, ''));
  const insight = useMemo(() => {
    const sample = buildLogInsight(insightState.items, { maxPoints: 60 });
    const exactLevels = LEVEL_KEYS.every(key => Number.isInteger(levelCounts[key]))
      ? Object.fromEntries(LEVEL_KEYS.map(key => [key, levelCounts[key]])) : null;
    return { ...sample, levels: exactLevels || sample.levels, sampleSize: sample.total,
      total: Number.isInteger(counts.all) ? counts.all : (insightState.total || sample.total) };
  }, [insightState.items, insightState.total, counts.all, levelCounts]);

  const retentionCheckedAt = analysisStatus?.retention?.checkedAt;
  useEffect(() => { if (retentionCheckedAt) void refresh(); }, [retentionCheckedAt]);
  useRetentionLease(api, { type: 'LOG_DETAIL', logIds: selected ? [selected.id] : [], enabled: Boolean(selected) });
  useEffect(() => {
    if (!focusLogId) return undefined;
    let stopped = false;
    void api('/logs/detail?id=' + encodeURIComponent(focusLogId)).then(item => { if (!stopped) setSelected(item); }).catch(failure => onNotify?.(failure.message));
    return () => { stopped = true; };
  }, [focusLogId]);

  const rows = filterRows(data.items, applied).filter(item => !category || logCategoryKey(item.category) === category);
  const visible = rows;
  const currentPage = page;
  useEffect(() => { if (!loading && !error && page > Math.max(1, Math.ceil(data.total / PAGE_SIZE))) setPage(Math.max(1, Math.ceil(data.total / PAGE_SIZE))); }, [data.total, loading, error, page]);

  const submit = () => {
    const message = logFilterError(filters);
    if (message) { setFilterError(message); return; }
    setFilterError(''); setApplied({ ...filters }); setPage(1);
    if (page === 1 && JSON.stringify(applied) === JSON.stringify(filters)) void refresh();
  };
  const changeScope = scope => {
    const next = scope === 'realtime' ? defaultLogFilters() : historicalLogFilters();
    setFilters(next); setApplied(next); setPage(1); setFilterError(''); setCategory('');
  };
  const changeLevel = level => {
    setFilters(current => ({ ...current, level }));
    setApplied(current => ({ ...current, level }));
    setPage(1);
  };
  const toggleInsight = () => setCollapsed(value => { const next = !value; try { localStorage.setItem(INSIGHT_STORAGE_KEY, next ? '1' : '0'); } catch {} return next; });

  const exportRows = async () => {
    let lease; setExporting(true);
    try {
      const items = filterRows(await readAllLogRows(api, '/logs', buildQuery(applied, category)), applied).filter(item => !category || logCategoryKey(item.category) === category);
      try { lease = await api('/logs/retention-lease', { method: 'POST', body: JSON.stringify({ type: 'LOG_EXPORT', logIds: items.map(row => row.id) }) }); } catch {}
      downloadOperationalFile(`QCDKR-日志-${new Date().toISOString().slice(0,10)}.json`, { exportedAt: new Date().toISOString(), filters: { ...applied, category }, count: items.length, items });
      onNotify?.(`已导出 ${items.length} 条日志`);
    } catch (failure) { setFilterError(failure.message || '日志导出失败，请重试。'); }
    finally { setExporting(false); if (lease) setTimeout(() => void api('/logs/retention-lease', { method: 'POST', body: JSON.stringify({ release: true, leaseId: lease.leaseId }) }).catch(() => {}), 1000); }
  };

  // Day separators are only worth a row when the date actually changes; the
  // stripe index keeps alternating rows readable even when a day row intervenes.
  const streamRows = useMemo(() => {
    const output = []; let previous = ''; let index = 0;
    for (const item of visible) {
      const key = dayKey(item.createdAt);
      if (key !== previous) { output.push({ type: 'day', key }); previous = key; }
      output.push({ type: 'row', key: item.id, item, striped: index % 2 === 1 });
      index += 1;
    }
    return output;
  }, [visible]);

  const errorsOnPage = visible.filter(item => ['error', 'critical'].includes(normalizeLogLevel(item.level))).length;
  const warningsOnPage = visible.filter(item => normalizeLogLevel(item.level) === 'warning').length;
  const scopeLabel = applied.scope === 'realtime' ? '本次运行' : '历史范围';

  return <section className="event-log-workspace logs-workspace" aria-label="运行日志">
    <div className="logs-col logs-col-left">
    <header className="logs-head">
      <div className="logs-heading-identity">
        <LogModuleIcon large/>
        <div>
          <h2>运行日志</h2>
          <p>{scopeLabel} · 共 {data.total} 条记录 · {applied.scope === 'realtime' ? '每 3 秒自动刷新' : `查询 ${applied.from || '不限'} 至 ${applied.to || '不限'}`}</p>
        </div>
      </div>
      <div className="logs-actions">
        {twinStand&&<button className="maint-button" onClick={()=>onNavigate?.('overview')}>3D 选中 {twinStand}</button>}
        <button className="maint-button" disabled={loading} onClick={refresh}>{loading ? <Loader2 className="spin" size={15}/> : <RefreshCw size={15}/>}刷新</button>
        <button className="maint-button primary" disabled={loading || exporting || !!error || !data.total} onClick={exportRows}><Download size={15}/>{exporting ? '导出中…' : '导出日志'}</button>
      </div>
    </header>

    {analysisStatus && <div className="logs-analysis"><AnalysisProgress status={analysisStatus} error={analysisError} onHistory={onAnalysisHistory} onAnalyze={onAnalyzeCurrent}/></div>}

    <LogsInsightPanel insight={insight} loading={insightState.loading} error={insightState.error}
      level={applied.level} onLevelChange={changeLevel} scopeLabel={scopeLabel}
      collapsed={collapsed} onToggle={toggleInsight}/>

    <div className="logs-dist" aria-label="日志分类分布">
      <div className="logs-dist-head"><span>分类分布</span><small>{applied.scope === 'realtime' ? '本次运行' : '当前范围'}</small></div>
      {CATEGORIES.filter(([value]) => value).map(([value, label]) => {
        const count = counts[value] || 0, pct = data.total ? Math.round(count / data.total * 100) : 0;
        return <div className="logs-dist-row" key={value}><span>{label}</span><i><b style={{width:`${pct}%`}}/></i><em>{count}</em></div>;
      })}
    </div>

    <div className="logs-controls">
      <div className="logs-toolbar">
        <div className="logs-scope" role="group" aria-label="日志范围">
          {[['realtime', '实时日志'], ['history', '历史查询']].map(([scope, label]) =>
            <button key={scope} type="button" aria-pressed={applied.scope === scope} className={applied.scope === scope ? 'is-active' : ''} onClick={() => changeScope(scope)}>{label}</button>)}
        </div>
        <form className="logs-search" onSubmit={event => { event.preventDefault(); submit(); }}>
          <Search size={14}/>
          <input aria-label="搜索日志" placeholder="搜索日志内容、编号或参数…" value={filters.query} onChange={event => setFilters(current => ({ ...current, query: event.target.value }))}/>
          <button type="submit" className="maint-button primary" disabled={loading}>查询</button>
        </form>
        {applied.scope !== 'realtime' && <div className="logs-range">
          <LogDateTimeField label="开始" value={filters.from} onChange={value => setFilters(current => ({ ...current, from: value }))}/>
          <span aria-hidden="true">—</span>
          <LogDateTimeField label="结束" value={filters.to} onChange={value => setFilters(current => ({ ...current, to: value }))}/>
        </div>}
        <div className="logs-sync" aria-live="polite"><i className={loading ? 'is-loading' : ''}/>{loading ? '正在读取' : applied.scope === 'realtime' ? '已同步' : '查询完成'}</div>
      </div>

      <div className="logs-filters">
        <div className="logs-category" role="group" aria-label="日志分类">
          <span className="logs-category-label">分类</span>
          {CATEGORIES.map(([value, label]) => {
            const count = value ? counts[value] : counts.all;
            return <button key={value || 'all'} type="button" aria-pressed={category === value}
              className={`${category === value ? 'is-active ' : ''}${count === 0 ? 'is-zero' : ''}`.trim()}
              onClick={() => { setCategory(value); setPage(1); }}>
              {label}<b>{Number.isInteger(count) ? count : '—'}</b>
            </button>;
          })}
        </div>
        <div className="logs-levels" role="group" aria-label="日志级别">
          <span className="logs-category-label">级别</span>
          <LevelFilterChips levels={insight.levels} level={applied.level} onLevelChange={changeLevel}/>
        </div>
      </div>
    </div>

    {(error || filterError) && <div className="maint-error" role="alert"><UserVisibleText value={error || filterError}/><button onClick={refresh}>重试</button></div>}
    </div>
    <div className="logs-col logs-col-right">
    <section className="logs-stream" aria-label="日志流">
      <header className="logs-stream-head">
        <span className="logs-stream-title">日志流</span>
        <span>本页 {visible.length} 条</span>
        <span className={errorsOnPage ? 'is-danger' : ''}>错误/严重 <b>{errorsOnPage}</b></span>
        <span className={warningsOnPage ? 'is-warning' : ''}>警告 <b>{warningsOnPage}</b></span>
        <span>最新记录 <b>{rows.length ? shortTime(rows[0].createdAt) : '—'}</b></span>
      </header>

      <div className="ops-log-table-wrap">
        <table className="ops-log-table logs-table">
          <colgroup><col className="col-time"/><col className="col-content"/><col className="col-metrics"/><col className="col-action"/></colgroup>
          <thead><tr><th>时间</th><th>内容</th><th className="is-right">预测 / 实际 / 偏差</th><th className="is-right">操作</th></tr></thead>
          <tbody>
            {streamRows.map(entry => entry.type === 'day'
              ? <tr className="logs-day" key={`day-${entry.key}`}><td colSpan={4}>{dayLabel(entry.key)}</td></tr>
              : <LogRow key={entry.key} item={entry.item} onOpen={setSelected} predictionRecordContext={predictionRecordContext} striped={entry.striped}/>)}
          </tbody>
        </table>
        {!visible.length && <div className="ops-log-empty">{loading ? <Loader2 className="spin" size={26}/> : <FileText size={30}/>}<strong>{loading ? '正在读取日志' : error ? '日志读取失败' : '没有匹配的日志'}</strong><p>{loading ? '请稍候' : error ? '点击刷新重新读取。' : '更改筛选条件，或在执行任务后刷新。'}</p>{!loading && Object.values(applied).some(Boolean) && <button className="maint-button" onClick={() => { const reset = applied.scope === 'realtime' ? defaultLogFilters() : { ...initialFilters, scope: 'history' }; setFilters(reset); setApplied(reset); setPage(1); setCategory(''); }}>清除筛选</button>}</div>}
      </div>
      <Pagination loading={loading} page={currentPage} total={data.total} selectedCount={visible.length} onPage={setPage}/>
    </section>
    </div>
    {selected && <Details selected={selected} predictionRecordContext={predictionRecordContext} onClose={() => { setSelected(null); onLogFocused?.(); }}/>}
  </section>;
}
