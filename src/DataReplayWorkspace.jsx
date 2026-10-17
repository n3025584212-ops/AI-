import { readableConditionName } from './userVisibleText.js';
import { trendActualValue, trendActualAvailability } from './s5ActualDisplay.js';
import { observationDisplay, referenceRangeDisplay } from './workbenchDisplay.js';
import { useRef, useState } from 'react';
import { Activity, Archive, ArrowRight, CheckCircle2, CircleAlert, Download, FileText, Layers3, Play, SlidersHorizontal, Upload } from 'lucide-react';
import CommittedParameterEditor from './CommittedParameterEditor.jsx';
import { HistoryWorkspace } from './OperationsPages.jsx';
import { formatEngineering } from './engineeringUnits.js';
import { modelInputFingerprint, summarizeModelInputs } from './modelInputs.js';
import { engineeringContextForRequest, reportInputFingerprint } from './predictionSnapshot.js';
import './data-access.css';
import { currentModelReferenceRanges } from './inputRangeDefaults.js';
import { readCustomLimits } from './historicalRangeCheck.js';
import { readImportFile, resolveLegacyCsvUnits } from './caseImportBoundary.js';

const stamp = frame => frame.timestampAvailable === false || frame.input?.importProvenance?.timestampAvailable === false
  ? '未提供时间戳'
  : Number.isFinite(frame.time) ? new Date(frame.time).toLocaleString('zh-CN', { hour12: false }) : '未提供时间戳';

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

export function DataWorkspace({ stream, caseData, modelProps, cases = [], result, onSave, onLoad, onDelete, tab = 'current', onTabChange, onImport, onTemplate, onNotify, onNavigate, onReplayHistorical, onResolveImportUnits }) {
  const file = useRef(null), matrix = useRef(null);
  const [importing, setImporting] = useState(false), [importError, setImportError] = useState('');
  const check = summarizeModelInputs(caseData, { referenceRanges: currentModelReferenceRanges(readCustomLimits(globalThis.localStorage)) });
  const inputErrors = [...check.missing, ...check.invalid].map(item => `${item.label}：${item.message}`);
  const frozenInput = result?.inputContext || modelProps.resultCase;
  const resultCurrent = frozenInput && modelInputFingerprint(caseData) === modelInputFingerprint(frozenInput)
    && reportInputFingerprint(engineeringContextForRequest(caseData)) === reportInputFingerprint(engineeringContextForRequest(frozenInput));
  const predictionLabel = !check.valid ? '输入待修正' : modelProps.predictionPending ? '计算中…'
    : modelProps.dirty || !resultCurrent ? '结果待更新' : formatEngineering('force', result?.value, 3);
  const actualSeries=trendActualAvailability(stream.frames,stream.sourceName);
  const observationLabel='实际值';
  const recordCount = stream.frames.length;
  // Import/manual entry points own this identity; record count only indicates loaded data.
  const datasetType = stream.mode === 'manual' ? 'SINGLE_CONDITION' : ['demo', 'import'].includes(stream.mode) ? 'TIMESERIES' : null;
  const hasData = recordCount > 0 || check.completeCount > 0;
  const mode = !hasData ? '数据未载入' : datasetType === 'TIMESERIES' ? '时序数据' : datasetType === 'SINGLE_CONDITION' ? '单工况数据' : '数据已载入';
  const playbackLabel = hasData && datasetType === 'TIMESERIES' ? stream.running ? '时序播放中' : '时序播放已暂停' : '时序数据未载入';
  const sourceName = '工业数据';
  const load = async event => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setImporting(true); setImportError('');
    try {
      const { text, audit } = await readImportFile(selected);
      const legacyForceUnit = await resolveLegacyCsvUnits(text,audit,onResolveImportUnits);
      stream.loadCSV(text, selected.name, caseData, {legacyForceUnit});
      onNotify('已载入 ' + selected.name + '，正在预测工作台中计算');
      onNavigate('overview');
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
    setImporting(true);setImportError('');
    try { if(await onReplayHistorical?.()){onNavigate('overview');onNotify('已载入工业数据');} }
    finally {setImporting(false);}
  };
  return <section className="data-workspace reference-page data-access" aria-label="数据接入工作区">
    <header className="reference-page-heading data-access-heading"><div className="data-access-title"><DataProjectionMark complete={check.completeCount} total={check.total} running={stream.running}/><h1>数据接入</h1></div><button className="data-action" onClick={() => onNavigate('overview')}>预测工作台<ArrowRight size={15}/></button></header>
    <input hidden type="file" accept=".csv" ref={file} onChange={load} aria-label="导入时序文件"/>
    <div className="data-access-source"><span className="data-access-mode" data-running={stream.running}><i/>{mode}</span><span>当前来源 <strong title={stream.sourceName || sourceName}>{sourceName}</strong></span><span>工况 <strong title={readableConditionName(caseData.id)}>{readableConditionName(caseData.id)}</strong></span><span>已载入 <strong>{recordCount} 条记录</strong></span></div>
    <div className="data-access-actions" aria-label="数据操作">
      <div className="data-action-group data-action-current"><b><Layers3 size={13}/>单工况</b><button className="data-action is-primary" onClick={onImport}><Upload size={14}/>导入 CSV / JSON</button><button className="data-action" onClick={edit}><SlidersHorizontal size={14}/>编辑当前工况</button><button className="data-action" onClick={onTemplate}><Download size={14}/>下载单工况模板</button><button className="data-action" onClick={onSave} disabled={modelProps.dirty} data-action-tone="saved"><Archive size={14}/>保存当前工况</button></div>
      <div className="data-action-group data-action-series"><b><Activity size={13}/>时序</b><button className="data-action is-primary" onClick={() => file.current?.click()} disabled={importing}><Upload size={14}/>{importing ? '正在导入…' : '导入时序 CSV'}</button><button className="data-action" onClick={() => download(true)}><Download size={14}/>下载时序模板</button><span className="data-demo-active"><i/>{playbackLabel}</span>{!stream.frame?.historicalReplay && <button className="data-action" onClick={replayHistorical} disabled={importing||!modelProps.modelStatus?.available}><Play size={14}/>切回工业数据</button>}<button className="data-action" onClick={() => download(false)} disabled={!stream.frames.length}><Download size={14}/>导出时序记录</button></div>
    </div>
    {importError && <div className="data-access-error" role="alert"><CircleAlert size={15}/>{importError}</div>}
    <div className="data-access-tabs" role="tablist" aria-label="数据内容">{[['current','当前工况',null,Layers3],['series','时序记录',recordCount,Activity],['saved','已保存工况',cases.length,Archive]].map(([id,label,count,Icon]) => <button key={id} id={'data-tab-'+id} data-tab={id} role="tab" aria-selected={tab===id} aria-controls={'data-panel-'+id} onClick={() => onTabChange(id)}><Icon size={15}/>{label}{count!==null && <small>{count}</small>}</button>)}</div>
    <div className={'data-access-body data-access-'+tab} id={'data-panel-'+tab} role="tabpanel" aria-labelledby={'data-tab-'+tab}>
      {tab === 'current' && <>
        <div className="data-access-check" role="status">{check.valid ? <CheckCircle2 size={16}/> : <CircleAlert size={16}/>}<strong>模型输入 {check.completeCount} / {check.total}</strong><span className="data-completeness-strip" aria-hidden="true">{Array.from({length:check.total},(_,index)=><i key={index} className={index<check.completeCount?'is-complete':''}/>)}</span><span>{inputErrors.length ? `${inputErrors.length} 项待补全或修正` : '输入已完整'}</span><span title={referenceRangeDisplay(check).tooltip}>{referenceRangeDisplay(check).label}</span><small>应用参数后自动计算</small></div>
        {!!inputErrors.length && <ul className="data-access-issues">{inputErrors.map((text,index) => <li key={index}>{text}</li>)}</ul>}
        {!!check.outOfRange.length && <details className="data-access-range"><summary>查看超出参考范围的 {check.outOfRange.length} 项参数</summary><ul>{check.outOfRange.map(item => <li key={item.key}>{item.label} {formatEngineering(item.field,item.value)}，参考范围 {formatEngineering(item.field,item.minimum)}—{formatEngineering(item.field,item.maximum)}</li>)}</ul></details>}
        <div ref={matrix}><CommittedParameterEditor onApply={modelProps.onApplyParameters} onEditDirty={modelProps.onEditDirty} onBeginEdit={modelProps.onBeginEdit} caseData={caseData} selected={modelProps.selected} onSelectStand={modelProps.setSelected} onFieldChange={modelProps.onFieldChange} onCaseFieldChange={modelProps.onCaseFieldChange} dirty={modelProps.dirty} errors={modelProps.errors}/></div>
        <div className="data-access-current-result"><span>当前 S5 预测 <strong>{predictionLabel}</strong></span><span>目标 <strong>{formatEngineering('force',caseData.target,3)}</strong></span><span>当前已载入 {recordCount} 条记录</span><button onClick={() => onTabChange('series')}>查看数据记录<ArrowRight size={13}/></button></div>
      </>}
      {tab === 'series' && <>
        <div className="data-access-record-heading"><span>{recordCount ? `当前工况 第 ${stream.cursor+1} / ${recordCount} 条` : '尚未载入记录'}</span><small>选择记录可在预测工作台中查看机组与计算结果</small></div>
        <div className="data-access-table-scroll"><table className="data-access-table" aria-label="已载入的时序记录"><thead><tr><th>序号</th><th>工况</th><th>采样时间</th><th>S5 预测 / t</th>{actualSeries.available&&<th>{observationLabel} / t</th>}<th>输入完整度</th><th>操作</th></tr></thead><tbody>{stream.frames.map((frame,index) => { const validation=summarizeModelInputs(frame.input); return <tr key={index} className={index===stream.cursor?'is-current':''}><td>{index+1}</td><td title={readableConditionName(frame.input?.id)}>{readableConditionName(frame.input?.id)}</td><td>{stamp(frame)}</td><td>{formatEngineering('force',frame.predicted,3)}</td>{actualSeries.available&&<td title={trendActualValue(frame)!==null?observationDisplay(frame).tooltip:undefined}>{trendActualValue(frame)!==null?formatEngineering('force',trendActualValue(frame),3):''}</td>}<td>{validation.completeCount} / {validation.total}</td><td><button aria-label={`查看第 ${index+1} 条记录`} onClick={() => openFrame(index)}>查看<ArrowRight size={12}/></button></td></tr>; })}{!stream.frames.length && <tr><td colSpan={actualSeries.available?7:6} className="data-access-empty">导入时序 CSV 或运行工业数据流后，记录会显示在这里。</td></tr>}</tbody></table></div>
      </>}
      <details className="prediction-record-technical"><summary>查看技术信息</summary><pre className="maint-json">{JSON.stringify({sourceName:stream.sourceName,currentCondition:caseData.id,records:stream.frames.map(frame=>({sampleId:frame.input?.id,importProvenance:frame.input?.importProvenance}))},null,2)}</pre></details>
      {tab === 'saved' && <HistoryWorkspace cases={cases} caseData={caseData} resultCase={modelProps.resultCase} result={result} dirty={modelProps.dirty} onSave={onSave} onLoad={onLoad} onDelete={onDelete}/>}
    </div>
    <footer className="data-access-foot"><FileText size={14}/><span>模板单位：轧制力 t · 总张力 t；弯辊力 kN · 厚度与宽度 mm。保留模板中的单位标识列，导入时自动换算。</span></footer>
  </section>;
}
