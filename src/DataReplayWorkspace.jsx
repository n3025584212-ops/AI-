import { readableConditionName } from './userVisibleText.js';
import { trendActualValue, trendActualAvailability } from './s5ActualDisplay.js';
import { observationDisplay, referenceRangeDisplay } from './workbenchDisplay.js';
import { useEffect, useRef, useState } from 'react';
import { Activity, Archive, ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, CircleAlert, Database, Download, FileText, Layers3, MoreHorizontal, Play, ShieldCheck, SlidersHorizontal, Upload, WandSparkles, X } from 'lucide-react';
import CommittedParameterEditor from './CommittedParameterEditor.jsx';
import { HistoryWorkspace } from './OperationsPages.jsx';
import { formatEngineering } from './engineeringUnits.js';
import { modelInputFingerprint, summarizeModelInputs } from './modelInputs.js';
import { engineeringContextForRequest, reportInputFingerprint } from './predictionSnapshot.js';
import './data-access.css';
import { currentModelReferenceRanges } from './inputRangeDefaults.js';
import { HistoricalRangeDetails, useHistoricalRangeCheck } from './HistoricalRangeCheck.jsx';
import { searchStateDisplay, recentSearchDisplay, searchConfigDisplay } from './maintenanceStatusProjection.js';
import { SEARCH_CONFIG } from './smartCandidateConfig.js';

// 上一次真正算完的 S5 预测值。改参数/等模型期间继续显示它，
// 新结果到达时整块替换——界面不会退回"计算中"这种空态。
const lastCompletedPrediction = { value: null, at: 0 };
import { readCustomLimits } from './historicalRangeCheck.js';
import { readImportFile, resolveLegacyCsvUnits } from './caseImportBoundary.js';

const finiteNumber = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const stamp = frame => frame.timestampAvailable === false || frame.input?.importProvenance?.timestampAvailable === false
  ? '未提供时间戳'
  : Number.isFinite(frame.time) ? new Date(frame.time).toLocaleString('zh-CN', { hour12: false }) : '未提供时间戳';
const closeMenu = event => event.currentTarget.closest('details')?.removeAttribute('open');

function DataProjectionMark({ complete, total, running }) {
  return <svg className="data-projection-mark" viewBox="0 0 112 82" role="img" aria-label={`五机架数据层，${complete} / ${total} 项模型输入已完整${running ? '，数据持续更新' : ''}`}>
    <ellipse cx="48" cy="71" rx="34" ry="7" fill="#000" opacity=".28"/>
    <path d="M11 64 48 45 87 64 49 81Z" fill="#4c7d96" opacity=".05"/>
    {[4,3,2,1,0].map(index => <g key={index} transform={`translate(0 ${index*9})`}>
      <path d="M18 22 49 8 80 22 49 37Z" fill={index===0?'#7fd0e8':'#2d4a5e'} stroke={index===0?'#aee6f7':'#5d8aa4'} strokeWidth=".7"/>
      <path d="M18 22 49 37 49 42 18 27Z" fill={index===0?'#2f7fa0':'#1b3444'}/>
      <path d="M49 37 80 22 80 27 49 42Z" fill={index===0?'#25607e':'#142836'}/>
      <path d="m29 23 18 8m-11-12 20 9m-12-13 18 8" stroke={index===0?'#2e7396':'#6d97b0'} strokeWidth="1" opacity=".6"/>
      <circle cx="72" cy="28" r="1.4" fill={index < Math.ceil(complete/5)?'#d5f1fd':'#5d7c92'}/>
    </g>)}
    <path d="M79 53h12l10-6" fill="none" stroke="#827caf" strokeWidth="1.4"/>
    <path d="m92 43 9-4 9 4-9 5Z" fill="#baafd8"/><path d="m92 43 9 5v6l-9-5Z" fill="#6a608b"/><path d="m101 48 9-5v6l-9 5Z" fill="#8f7fae"/>
    <circle className={running?'data-projection-live':''} cx="86" cy="61" r="2.2" fill="#dbb677"/>
  </svg>;
}

/** 25 项模型输入的完成度环：比进度条更直观地表达“缺几项”。 */
function InputRing({ complete, total }) {
  const radius = 15.5, circumference = 2 * Math.PI * radius, ratio = total ? complete / total : 0;
  return <svg className="data-ring" viewBox="0 0 40 40" role="img" aria-label={`模型输入完整度 ${complete} / ${total}`}>
    <circle className="data-ring-track" cx="20" cy="20" r={radius}/>
    <circle className="data-ring-value" cx="20" cy="20" r={radius} data-complete={complete === total}
      strokeDasharray={`${circumference * ratio} ${circumference}`} transform="rotate(-90 20 20)"/>
    <text x="20" y="20" textAnchor="middle" dominantBaseline="central">{Math.round(ratio * 100)}<tspan>%</tspan></text>
  </svg>;
}

/** 已载入记录里 S5 预测的走势，游标位置跟着当前记录走。 */
function PredictionSparkline({ frames, cursor }) {
  const points = frames.map((frame, index) => ({ index, value: finiteNumber(frame.predicted) })).filter(point => point.value !== null);
  const shown = points.slice(-60);
  const values = shown.map(point => point.value);
  if (values.length < 2) return <div className="data-spark is-empty"><span>暂无预测趋势</span></div>;
  const minimum = Math.min(...values), maximum = Math.max(...values), span = maximum - minimum || 1;
  const step = 100 / (shown.length - 1);
  const y = value => 3 + (1 - (value - minimum) / span) * 24;
  const line = shown.map((point, index) => `${index ? 'L' : 'M'}${(index * step).toFixed(2)} ${y(point.value).toFixed(2)}`).join('');
  const cursorIndex = shown.findIndex(point => point.index === cursor);
  return <div className="data-spark">
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <path className="data-spark-area" d={`${line}L100 32L0 32Z`}/>
      <path className="data-spark-line" d={line} vectorEffect="non-scaling-stroke"/>
    </svg>
    {cursorIndex >= 0 && <i className="data-spark-cursor" style={{ left: `${cursorIndex * step}%`, top: `${y(shown[cursorIndex].value) / 32 * 100}%` }}/>}
  </div>;
}

/** 五机架出口厚度落差：一眼看出各道次压下是否均匀。 */
function ThicknessChain({ stands }) {
  const entry = finiteNumber(stands[0]?.entryThickness) ?? finiteNumber(stands[0]?.exitThickness);
  const points = [entry, ...stands.map(stand => finiteNumber(stand.exitThickness))];
  const values = points.filter(value => value !== null);
  if (values.length < 2) return <div className="data-chain is-empty"><span>待载入工况</span></div>;
  const maximum = Math.max(...values), minimum = Math.min(...values), span = maximum - minimum || 1;
  const step = 100 / (points.length - 1);
  const y = value => 4 + (1 - (value - minimum) / span) * 23;
  let line = '', started = false;
  points.forEach((value, index) => {
    if (value === null) { started = false; return; }
    line += `${started ? 'L' : 'M'}${(index * step).toFixed(2)} ${y(value).toFixed(2)}`;
    started = true;
  });
  return <div className="data-chain" title="入口与 S1—S5 出口厚度">
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <path className="data-chain-area" d={`${line}L100 30L0 30Z`}/>
      <path className="data-chain-line" d={line} vectorEffect="non-scaling-stroke"/>
    </svg>
    {points.map((value, index) => value === null ? null
      : <i key={index} className={index === points.length - 1 ? 'is-last' : ''} style={{ left: `${index * step}%`, top: `${y(value) / 30 * 100}%` }}/>)}
  </div>;
}

/** 预测值与目标值的靶心条：差值方向和幅度不用再心算。 */
function TargetBullet({ value, target }) {
  const scale = Math.max(value ?? 0, target ?? 0) * 1.12 || 1;
  return <div className="data-bullet" role="img" aria-label={`预测 ${value}，目标 ${target}`}>
    <span className="data-bullet-fill" style={{ width: `${Math.min(100, value / scale * 100)}%` }} data-side={value >= target ? 'over' : 'under'}/>
    <i className="data-bullet-target" style={{ left: `${Math.min(100, target / scale * 100)}%` }}/>
  </div>;
}

export function DataWorkspace({ stream, caseData, modelProps, cases = [], result, onSave, onLoad, onDelete, tab = 'current', onTabChange, onImport, onTemplate, onNotify, onNavigate, onReplayHistorical, onResolveImportUnits, searchState = null, mostRecentCompletedSearch = null, onOpenSolutions }) {
  const file = useRef(null), matrix = useRef(null);
  useEffect(() => {
    const handler = event => {
      const stand = String(event.detail?.stand || '').toUpperCase();
      if (!/^S[1-5]$/.test(stand)) return;
      onTabChange?.('current');
      window.setTimeout(() => {
        matrix.current?.querySelector(`[data-stand="${stand}"]`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      }, 160);
    };
    window.addEventListener('qcdkr:stand-selected', handler);
    return () => window.removeEventListener('qcdkr:stand-selected', handler);
  }, []);
  const [importing, setImporting] = useState(false), [importError, setImportError] = useState('');
  const smartSearch = searchStateDisplay(searchState), smartConfig = searchConfigDisplay(SEARCH_CONFIG);
  const [rangeOpen, setRangeOpen] = useState(false);
  const historical = useHistoricalRangeCheck(caseData);
  useEffect(() => {
    document.body.classList.toggle('range-check-open', rangeOpen);
    return () => document.body.classList.remove('range-check-open');
  }, [rangeOpen]);
  const check = summarizeModelInputs(caseData, { referenceRanges: currentModelReferenceRanges(readCustomLimits(globalThis.localStorage)) });
  const inputErrors = [...check.missing, ...check.invalid].map(item => `${item.label}：${item.message}`);
  const frozenInput = result?.inputContext || modelProps.resultCase;
  const resultCurrent = frozenInput && modelInputFingerprint(caseData) === modelInputFingerprint(frozenInput)
    && reportInputFingerprint(engineeringContextForRequest(caseData)) === reportInputFingerprint(engineeringContextForRequest(frozenInput));
  // 上一次"算完"的结果留在屏幕上，等新结果回来再整体替换；
  // 中间只挂一个"更新中"标记，不把数字清空成"计算中"。
  const livePrediction = check.valid && !modelProps.predictionPending && !modelProps.dirty && resultCurrent ? finiteNumber(result?.value) : null;
  if (livePrediction !== null) lastCompletedPrediction.value = livePrediction;
  // 页面是在回放中途切进来的：此时 dirty=true，拿不到 livePrediction，但服务端
  // 已有上一帧的正式结果。用 result 兜底，否则 KPI 会一直停在"结果待更新"。
  else if (result?.mode === 'formal' && finiteNumber(result.value)) lastCompletedPrediction.value = result.value;
  const predictionStale = livePrediction == null && lastCompletedPrediction.value !== null && check.valid;
  const predictionValue = livePrediction !== null ? livePrediction : (predictionStale ? lastCompletedPrediction.value : null);
  const predictionLabel = !check.valid ? '输入待修正'
    : predictionValue != null ? formatEngineering('force', predictionValue, 3)
    : modelProps.predictionPending ? '计算中…' : '结果待更新';
  const targetValue = finiteNumber(caseData?.target);
  const delta = predictionValue != null && targetValue ? predictionValue - targetValue : null;
  const deltaPercent = delta != null && targetValue ? delta / targetValue * 100 : null;
  const modelReady = modelProps.modelStatus?.available === true && modelProps.modelStatus?.mode !== 'demo';
  const formalPredictionReady = result?.mode === 'formal' && Number.isFinite(result?.value) && !modelProps.dirty && !modelProps.predictionPending;
  const inputStatusChecks = [
    { ok: check.valid, label: `输入完整性 · ${check.completeCount} / ${check.total} 项已读取` },
    { ok: check.invalid.length === 0, label: `有限数值检查 · ${check.total} / ${check.total} 项有效` },
    { ok: modelReady, label: `QCDKR 正式模型 · ${modelReady ? '可计算' : '未就绪'}` },
    { ok: formalPredictionReady, label: `当前工况预测 · ${formalPredictionReady ? '已更新' : modelProps.predictionPending ? '计算中' : '待更新'}` },
  ];
  const actualSeries = trendActualAvailability(stream.frames, stream.sourceName);
  const observationLabel = '实际值';
  const recordCount = stream.frames.length;
  // Import/manual entry points own this identity; record count only indicates loaded data.
  const datasetType = stream.mode === 'manual' ? 'SINGLE_CONDITION' : ['demo', 'import'].includes(stream.mode) ? 'TIMESERIES' : null;
  const hasData = recordCount > 0 || check.completeCount > 0;
  const mode = !hasData ? '数据未载入' : datasetType === 'TIMESERIES' ? '时序数据' : datasetType === 'SINGLE_CONDITION' ? '单工况数据' : '数据已载入';
  const sourceName = '工业数据';
  const rangeDisplay = referenceRangeDisplay(check);
  // 卡片只有一百多像素宽，说明行只写一个结论；把「完整度 + 范围 + 提示」拼起来再省略号，
  // 读者只能看到「输入已完整 · …」这种半句话（2026-11-16 观感修正）。
  const rangeNote = check.outOfRangeCount ? `${check.outOfRangeCount} 项超出范围`
    : !check.checkedRangeCount || check.rangeStatus === 'UNKNOWN' ? '范围未载入'
      : check.rangeStatus === 'PARTIAL' ? `${check.checkedRangeCount} 项已核范围`
        : '参考范围内';
  const entryThickness = finiteNumber(caseData?.stands?.[0]?.entryThickness) ?? finiteNumber(caseData?.entrySetThickness);
  const exitThickness = finiteNumber(caseData?.stands?.[caseData.stands.length - 1]?.exitThickness);
  const reduction = entryThickness && exitThickness != null ? (entryThickness - exitThickness) / entryThickness * 100 : null;
  const lastStamp = stream.frame && stamp(stream.frame) !== '未提供时间戳' ? stamp(stream.frame) : '';
  const load = async event => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setImporting(true); setImportError('');
    try {
      const { text, audit } = await readImportFile(selected);
      const legacyForceUnit = await resolveLegacyCsvUnits(text, audit, onResolveImportUnits);
      stream.loadCSV(text, selected.name, caseData, { legacyForceUnit });
      onNotify('已载入 ' + selected.name + '，可在时序记录中查看');
      onTabChange?.('series');
    } catch (error) { setImportError(error.message); onNotify('导入失败：' + error.message); }
    finally { setImporting(false); event.target.value = ''; }
  };
  const edit = () => {
    modelProps.onBeginEdit();
    onTabChange('current');
    requestAnimationFrame(() => {
      const collapsed = matrix.current?.querySelector('.pm-collapse[aria-expanded="false"]');
      collapsed?.click();
      requestAnimationFrame(() => matrix.current?.querySelector('[data-stand="S5"][data-field="speed"]')?.focus({ preventScroll: true }));
    });
  };
  const download = template => {
    try { stream.download(template); setImportError(''); }
    catch (error) { setImportError(error.message); onNotify((template ? '时序模板下载失败：' : '导出失败：') + error.message); }
  };
  const openFrame = index => { stream.seek(index); onNavigate('overview'); };
  const replayHistorical = async () => {
    setImporting(true); setImportError('');
    try { if (await onReplayHistorical?.()) { onNavigate('overview'); onNotify('已载入工业数据'); } }
    finally { setImporting(false); }
  };
  return <section className="data-workspace reference-page data-access" aria-label="数据接入工作区">
    <header className="reference-page-heading data-access-heading">
      <div className="data-access-title">
        <DataProjectionMark complete={check.completeCount} total={check.total} running={stream.running}/>
        <div>
          <h1>数据接入</h1>
          <p className="data-access-sub">
            <span className="data-access-mode" data-running={stream.running}><i/>{mode}</span>
            <span>来源 <b>{sourceName}</b></span>
            <span>工况 <b title={readableConditionName(caseData.id)}>{readableConditionName(caseData.id)}</b></span>
            {lastStamp && <span className="data-access-last">采样 <b>{lastStamp}</b></span>}
          </p>
        </div>
      </div>
      <div className="data-access-heading-actions">
        <details className="data-smart-menu">
          <summary className="data-btn" aria-label="智能调整方案"><WandSparkles size={14}/>智能调整方案<ChevronDown size={12}/></summary>
          <div className="data-menu-pop is-smart" role="menu">
            <header className="data-smart-head"><b>智能调整方案</b><span className={`data-smart-state is-${smartSearch.tone}`}>{smartSearch.label}</span></header>
            {smartConfig ? <dl className="data-smart-grid">
              <div><dt>调节动作</dt><dd>{smartConfig.actions.length} 项</dd></div>
              <div><dt>关联模型输入</dt><dd>{smartConfig.fields.length} 项</dd></div>
              <div><dt>候选配置</dt><dd>最多 {smartConfig.totalCandidates} 个</dd></div>
              <div><dt>最大联合调整</dt><dd>{smartConfig.maxChangedActions} 项</dd></div>
            </dl> : <p className="data-smart-empty">搜索配置待载入。</p>}
            <div className="data-smart-row"><span>当前搜索状态</span><b>{smartSearch.label}</b></div>
            <div className="data-smart-row"><span>最近搜索</span><b>{recentSearchDisplay(mostRecentCompletedSearch, searchState)}</b></div>
            <details className="data-smart-config"><summary>查看搜索配置</summary>
              <p>调节动作：{smartConfig ? smartConfig.actions.map(action => action.displayName).join('、') : '—'}</p>
              <p>关联输入：{smartConfig ? smartConfig.fields.map(field => field.label).join('、') : '—'}</p>
              <p>调节范围：{Math.min(...SEARCH_CONFIG.actionLevelsPercent)}% ~ {Math.max(...SEARCH_CONFIG.actionLevelsPercent)}%</p>
            </details>
            <button type="button" className="data-smart-enter" disabled={!onOpenSolutions} onClick={() => onOpenSolutions?.()}>进入方案<ArrowRight size={12}/></button>
          </div>
        </details>
        <details className="data-import-menu">
          <summary className="data-btn is-primary" aria-label="导入数据"><Upload size={14}/>导入数据<ChevronDown size={12}/></summary>
          <div className="data-menu-pop" role="menu">
            <button type="button" role="menuitem" onClick={event => { closeMenu(event); onImport(); }}><Layers3 size={14}/><span><b>单工况 CSV / JSON</b><small>导入一条完整工况并立即计算</small></span></button>
            <button type="button" role="menuitem" disabled={importing} onClick={event => { closeMenu(event); file.current?.click(); }}><Activity size={14}/><span><b>时序 CSV</b><small>{importing ? '正在导入…' : '载入多条采样记录用于回放'}</small></span></button>
          </div>
        </details>
        <button className="data-btn" aria-pressed={rangeOpen} onClick={() => setRangeOpen(value => !value)} title="查看 25 维输入的参考范围，并按字段自定义"><ShieldCheck size={14}/>工况范围检查</button>
        <button className="data-btn" onClick={() => onNavigate('overview')}>预测工作台<ArrowRight size={15}/></button>
      </div>
    </header>
    <input hidden type="file" accept=".csv" ref={file} onChange={load} aria-label="导入时序文件"/>

    <div className="data-split" hidden={rangeOpen}><div className="data-col-left"><div className="data-kpi-band" aria-label="数据概览">
      <article className="data-kpi" data-tone={check.valid ? 'ok' : 'warn'}>
        <InputRing complete={check.completeCount} total={check.total}/>
        <div className="data-kpi-body">
          <span className="data-kpi-label" title="模型输入完整度">输入完整度</span>
          <strong className="data-kpi-value">{check.completeCount}<small>/ {check.total}</small></strong>
          <span className="data-kpi-note" title={inputErrors.length ? `${inputErrors.length} 项待补全或修正 · ${rangeDisplay.label}` : `输入已完整 · ${rangeDisplay.label}`}>{inputErrors.length ? `${inputErrors.length} 项待补全` : rangeNote}</span>
        </div>
      </article>
      <article className="data-kpi" data-focus={predictionValue != null} data-tone={delta == null ? 'idle' : Math.abs(deltaPercent) <= 5 ? 'ok' : 'warn'}>
        <div className="data-kpi-body is-wide">
          <span className="data-kpi-label">当前 S5 预测 {targetValue != null && <em>目标 {targetValue.toFixed(3)} t</em>}{predictionStale && <em className="is-stale" title="显示的是上一次完成的计算，新结果到达后自动替换">更新中</em>}</span>
          <strong className="data-kpi-value is-number">{predictionValue != null ? <>{predictionValue.toFixed(3)}<small>t</small></> : predictionLabel}</strong>
          {predictionValue != null && targetValue != null ? <>
            <TargetBullet value={predictionValue} target={targetValue}/>
            <span className="data-kpi-note">{delta >= 0 ? '高于目标' : '低于目标'}{' '}
              <em data-side={delta >= 0 ? 'over' : 'under'}>{deltaPercent >= 0 ? '+' : ''}{deltaPercent.toFixed(1)}%</em></span>
          </> : predictionValue != null ? <>
            <div className="data-bullet is-empty" aria-hidden="true"/>
            <span className="data-kpi-note">未设置 S5 目标</span>
          </> : <span className="data-kpi-note">{!check.valid ? '先补齐缺失输入' : modelProps.predictionPending ? '正在计算…' : modelProps.dirty ? '等待首个预测结果' : '应用参数后自动计算'}</span>}
        </div>
      </article>
      <article className="data-kpi data-kpi-records" data-tone={recordCount ? 'ok' : 'idle'}>
        <div className="data-kpi-body is-wide">
          <span className="data-kpi-label">已载入记录 <em>{recordCount ? `${stream.cursor + 1}/${recordCount}` : '空'}</em></span>
          <strong className="data-kpi-value">{recordCount}<small>条</small></strong>
          <span className="data-kpi-note">{recordCount ? (stream.running ? '播放中' : '已暂停') : '导入时序后显示走势'}</span>
          <PredictionSparkline frames={stream.frames} cursor={stream.cursor}/>
        </div>
      </article>
      <article className="data-kpi" data-tone={reduction != null ? 'ok' : 'idle'}>
        <div className="data-kpi-body is-wide">
          <span className="data-kpi-label">五机架压下</span>
          <strong className="data-kpi-value is-number">{entryThickness != null ? entryThickness.toFixed(3) : '—'}<small>→</small>{exitThickness != null ? exitThickness.toFixed(3) : '—'}<small>mm</small></strong>
          <span className="data-kpi-note">{reduction != null ? `总压下率 ${reduction.toFixed(1)}%` : '待载入工况'}</span>
          <ThicknessChain stands={caseData?.stands || []}/>
        </div>
      </article>
    </div>

    {importError && <div className="data-access-error" role="alert"><CircleAlert size={15}/>{importError}</div>}

    <div className="data-stand-snap" aria-label="五机架快照">
      <div className="data-stand-head"><span>机架快照</span><small>入口 → 出口 / 轧制力</small></div>
      {(caseData?.stands||[]).map(stand=><div className="data-stand-row" key={stand.id}><b>{stand.id}</b><span>{Number(stand.entryThickness).toFixed(3)} → {Number(stand.exitThickness).toFixed(3)} mm</span><em>{Number(stand.force).toFixed(0)} t</em><i style={{width:`${Math.min(100,Number(stand.force)/1200*100)}%`}}/></div>)}
    </div>
    </div><div className="data-col-right"><div className="data-access-tabs is-right" role="tablist" aria-label="数据内容">{[['current','当前工况',null,Layers3],['series','时序记录',recordCount,Activity],['saved','已保存工况',cases.length,Archive]].map(([id,label,count,Icon]) => <button key={id} id={'data-tab-'+id} data-tab={id} role="tab" aria-selected={tab===id} aria-controls={'data-panel-'+id} onClick={() => onTabChange(id)}><Icon size={14}/>{label}{count!==null && <small>{count}</small>}</button>)}</div>    <div className="data-access-bar is-right">
      <div className="data-access-tools">
        <button className="data-btn" onClick={edit}><SlidersHorizontal size={14}/>编辑当前工况</button>
        <button className="data-btn" data-tone="save" onClick={onSave} title={modelProps.dirty ? '预测更新中，完成后可保存' : '保存当前工况'}><Archive size={14}/>保存当前工况</button>
        <details className="data-more">
          <summary className="data-btn is-icon" aria-label="更多数据操作" title="更多数据操作"><MoreHorizontal size={16}/></summary>
          <div className="data-menu-pop is-right" role="menu">
            <button type="button" role="menuitem" onClick={event => { download(true); closeMenu(event); }}><Download size={14}/><span><b>下载时序模板</b><small>按当前记录格式生成 CSV</small></span></button>
            <button type="button" role="menuitem" disabled={!stream.frames.length} onClick={event => { download(false); closeMenu(event); }}><Download size={14}/><span><b>导出时序记录</b><small>{stream.frames.length ? `共 ${stream.frames.length} 条` : '暂无可导出的记录'}</small></span></button>
            <button type="button" role="menuitem" onClick={event => { onTemplate(); closeMenu(event); }}><Download size={14}/><span><b>下载单工况模板</b><small>用于手工填报一条工况</small></span></button>
            {!stream.frame?.historicalReplay && <button type="button" role="menuitem" disabled={importing || !modelProps.modelStatus?.available} onClick={event => { replayHistorical(); closeMenu(event); }}><Play size={14}/><span><b>切回工业数据</b><small>恢复内置演示数据流</small></span></button>}
          </div>
        </details>
      </div>
    </div>
<div className={'data-access-body data-access-'+tab} id={'data-panel-'+tab} role="tabpanel" aria-labelledby={'data-tab-'+tab}>
      {tab === 'current' && <>
        {!!inputErrors.length && <ul className="data-access-issues">{inputErrors.map((text,index) => <li key={index}>{text}</li>)}</ul>}
        {!!check.outOfRange.length && <details className="data-access-range"><summary>查看超出参考范围的 {check.outOfRange.length} 项参数</summary><ul>{check.outOfRange.map(item => <li key={item.key}>{item.label} {formatEngineering(item.field,item.value)}，参考范围 {formatEngineering(item.field,item.minimum)}—{formatEngineering(item.field,item.maximum)}</li>)}</ul></details>}
        <div ref={matrix}><CommittedParameterEditor groupedHeader onApply={modelProps.onApplyParameters} onEditDirty={modelProps.onEditDirty} onBeginEdit={modelProps.onBeginEdit} discardTimeseriesCount={stream.mode!=='manual'&&stream.frames.length>1?stream.frames.length:0} caseData={caseData} selected={modelProps.selected} onSelectStand={modelProps.setSelected} onFieldChange={modelProps.onFieldChange} onCaseFieldChange={modelProps.onCaseFieldChange} dirty={modelProps.dirty} errors={modelProps.errors}/></div>
        <div className="data-access-current-result"><span>当前 S5 预测 <strong>{predictionLabel}</strong></span><span>目标 <strong data-empty={targetValue == null}>{targetValue != null ? formatEngineering('force',caseData.target,3) : '未设置'}</strong></span><button onClick={() => onTabChange('series')}>查看数据记录<ArrowRight size={13}/></button></div>
      </>}
      {tab === 'series' && <>
        <div className="data-access-record-heading"><span>{recordCount ? `当前工况 第 ${stream.cursor+1} / ${recordCount} 条` : '尚未载入记录'}</span><small>选择记录可在预测工作台中查看机组与计算结果</small><button type="button" className="data-record-back" onClick={() => onTabChange('current')}><ArrowLeft size={13}/>返回参数</button></div>
        <div className="data-access-table-scroll"><table className="data-access-table" aria-label="已载入的时序记录"><thead><tr><th>序号</th><th>工况</th><th>采样时间</th><th>S5 预测 / t</th>{actualSeries.available&&<th>{observationLabel} / t</th>}<th>输入完整度</th><th>操作</th></tr></thead><tbody>{stream.frames.map((frame,index) => { const validation=summarizeModelInputs(frame.input); const ratio=validation.completeCount/validation.total*100; return <tr key={index} className={index===stream.cursor?'is-current':''}><td>{index+1}</td><td title={readableConditionName(frame.input?.id)}>{readableConditionName(frame.input?.id)}</td><td>{stamp(frame)}</td><td>{formatEngineering('force',frame.predicted,3)}</td>{actualSeries.available&&<td title={trendActualValue(frame)!==null?observationDisplay(frame).tooltip:undefined}>{trendActualValue(frame)!==null?formatEngineering('force',trendActualValue(frame),3):''}</td>}<td><span className="data-mini-meter" data-full={validation.completeCount===validation.total}><i style={{width:`${ratio}%`}}/></span>{validation.completeCount} / {validation.total}</td><td><button aria-label={`查看第 ${index+1} 条记录`} onClick={() => openFrame(index)}>查看<ArrowRight size={12}/></button></td></tr>; })}{!stream.frames.length && <tr><td colSpan={actualSeries.available?7:6} className="data-access-empty">导入时序 CSV 或运行工业数据流后，记录会显示在这里。</td></tr>}</tbody></table></div>
      </>}
      {tab === 'saved' && <HistoryWorkspace cases={cases} caseData={caseData} resultCase={modelProps.resultCase} result={result} dirty={modelProps.dirty} onSave={onSave} onLoad={onLoad} onDelete={onDelete} onBack={() => onTabChange('current')}/>}
    </div>
    <footer className="data-access-foot"><FileText size={14}/><span>模板单位：轧制力 t · 总张力 t；弯辊力 kN · 厚度与宽度 mm。保留模板中的单位标识列，导入时自动换算。</span></footer>
  </div></div>
    {rangeOpen && <section className="data-range-view" aria-label="输入状态与工况范围检查">
      <div className="data-range-status" role="status">
        <b>输入状态</b>
        {inputStatusChecks.map(item => <span key={item.label} data-ok={item.ok}><i aria-hidden="true">{item.ok ? '✓' : '✗'}</i>{item.label}</span>)}
        <button type="button" className="data-range-close" onClick={() => setRangeOpen(false)}>收起<X size={14}/></button>
      </div>
      <HistoricalRangeDetails {...historical} expanded/>
    </section>}
  </section>;
}
