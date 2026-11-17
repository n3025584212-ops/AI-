import { memo, Suspense, useEffect, useRef, useState } from 'react';
import { Activity, ArrowRight, Check, ChevronDown, ChevronUp, Expand, Layers3, Loader2, Maximize2, Minimize2, Minus, Plus, RotateCcw, SlidersHorizontal, X } from 'lucide-react';

import ProcessMatrix from './ProcessMatrix.jsx';
import { PredictionSummary, PredictionTrace, PredictionInfluence, usePredictionHistory } from './PredictionPanels.jsx';
import ThreeViewer from './threeViewerLazy.js';

const views = [['perspective', '透视'], ['front', '操作侧'], ['drive', '传动侧'], ['top', '俯视']];
const controls = [
  { key: 'speed', label: '轧制速度', step: 5, min: 0, max: 3000, decimals: 1 },
  { key: 'tension', label: '后张力', step: .5, min: 0, max: 200, decimals: 2 },
  { key: 'bendingForce', label: '弯辊力', step: 1, min: 0, max: 1000, decimals: 1 },
];

function NumericControl({ label, value, step = 1, min = 0, max = 10000, onChange, prefix = 'S5', compact = false }) {
  const bump = direction => {
    const current = Number(value);
    if (!Number.isFinite(current)) return;
    onChange?.(Math.round(Math.max(min, Math.min(max, current + direction * step)) * 10000) / 10000);
  };
  return <label className={`cockpit-number ${compact ? 'compact' : ''}`}>
    <span>{label}</span>
    <div className="cockpit-number-input">
      {!compact && <button type="button" aria-label={`减少 ${prefix} ${label}`} onClick={() => bump(-1)} disabled={!onChange}><Minus size={12} /></button>}
      <input type="number" aria-label={`${prefix} ${label}`} value={value ?? ''} step={step} min={min} max={max} disabled={!onChange} onChange={event => onChange?.(event.target.value === '' ? '' : Number(event.target.value))} />
      {!compact && <button type="button" aria-label={`增加 ${prefix} ${label}`} onClick={() => bump(1)} disabled={!onChange}><Plus size={12} /></button>}
    </div>
  </label>;
}

function ModelPanel({ full = false, workspace = false, caseData, predictionValue, result, dirty = false, autoStatus, errors = [], predictionState, selected = 'S5', setSelected, view = 'perspective', setView, explode = false, setExplode, showStrip = true, setShowStrip, onFieldChange, onCaseFieldChange, onTargetChange, onNavigate, resultCase, resultSample, lastUpdated, sessionKey, onReset }) {
  const [expanded, setExpanded] = useState(false);
  const focusMode = 'line';
  const [shellMode, setShellMode] = useState('transparent');
  const [showData, setShowData] = useState(true);
  const [focusRequest, setFocusRequest] = useState(null);
  const panelRef = useRef(null);
  const fullscreenEntered = useRef(false);
  const expandedRef = useRef(false);
  expandedRef.current = expanded;
  const s5 = caseData?.stands?.find(stand => stand.id === 'S5') || {};
  const liveResult = result || { value: predictionValue, target: caseData?.target, deviation: Number.isFinite(predictionValue) && caseData?.target ? (predictionValue - caseData.target) / caseData.target * 100 : 0 };
  const history = usePredictionHistory({ result: liveResult, resultCase: resultCase || caseData, resultSample, dirty, sessionKey });
  const selectParameter = driver => {
    const fields = { '轧制力': 'force', '轧制速度': 'speed', '后张力': 'tension', '前张力': 'frontTension', '弯辊力': 'bendingForce', '带钢宽度': 'width', '入口实际厚度': 'entryThickness', '入口设定厚度': 'entrySetThickness' };
    const label = driver.name.replace(/^S[1-5]\s+/, '');
    const field = driver.field || fields[label];
    if (!field) return;
    const stand = /^S[1-5]$/.test(driver.stand) ? driver.stand : '';
    if (stand) setSelected?.(stand);
    setShowData(true);
    setFocusRequest({ stand, field, revision: Date.now() });
  };
  const restore = async () => {
    setExpanded(false);
    if (window.dkqkarDesktop?.setSceneFullscreen) await window.dkqkarDesktop.setSceneFullscreen(false).catch(() => {});
    if (document.fullscreenElement === panelRef.current) await document.exitFullscreen().catch(() => {});
  };
  const toggleExpanded = async () => {
    if (expanded) { await restore(); return; }
    setExpanded(true);
    try {
      if (window.dkqkarDesktop?.setSceneFullscreen) await window.dkqkarDesktop.setSceneFullscreen(true);
      else await panelRef.current?.requestFullscreen?.();
    } catch { /* The fixed viewport remains available when native fullscreen is unavailable. */ }
  };
  useEffect(() => {
    const escape = event => { if (event.key === 'Escape') { setExpanded(false); window.dkqkarDesktop?.setSceneFullscreen?.(false).catch(() => {}); if (document.fullscreenElement === panelRef.current) document.exitFullscreen().catch(() => {}); } };
    const changed = () => {
      if (document.fullscreenElement === panelRef.current) fullscreenEntered.current = true;
      else if (fullscreenEntered.current) { fullscreenEntered.current = false; setExpanded(false); }
    };
    const unsubscribeNative = window.dkqkarDesktop?.onSceneFullscreenChanged?.(value => setExpanded(Boolean(value)));
    window.addEventListener('keydown', escape);
    document.addEventListener('fullscreenchange', changed);
    return () => { window.removeEventListener('keydown', escape); document.removeEventListener('fullscreenchange', changed); unsubscribeNative?.(); if (expandedRef.current) window.dkqkarDesktop?.setSceneFullscreen?.(false).catch(() => {}); };
  }, []);
  return <section ref={panelRef} className={`panel model-panel cockpit-panel prediction-workbench ${full ? 'model-full' : ''} ${workspace ? 'model-workspace' : ''} ${expanded ? 'scene-expanded' : ''} ${showData ? 'has-scene-data' : 'scene-data-hidden'}`} aria-label="S5 预测工作台">
    <PredictionSummary result={liveResult} resultCase={resultCase || caseData} resultSample={resultSample} caseData={caseData} dirty={dirty} errors={errors} autoStatus={autoStatus} predictionState={predictionState} onTargetChange={onTargetChange} lastUpdated={lastUpdated} />
    <div className="cockpit-toolbar">
      <div className="scene-identity"><span className="scene-line-mark"><Layers3 size={25} /></span><div><b>五机架冷轧机组</b></div></div>
      <div className="cockpit-segment shell-segment" role="group" aria-label="外壳显示">{[['solid', '实体'], ['transparent', '透壳'], ['hidden', '仅辊系']].map(([key, label]) => <button key={key} className={shellMode === key ? 'active' : ''} aria-pressed={shellMode === key} onClick={() => setShellMode(key)}>{label}</button>)}</div>
      <div className="scene-toolbar-actions"><button className={`scene-data-button ${showData ? 'active' : ''}`} aria-pressed={showData} onClick={() => setShowData(value => !value)}><SlidersHorizontal size={13} /><span>数据</span></button></div>
    </div>
    <div className="cockpit-stage">
      <div className="model-canvas"><Suspense fallback={<div className="model-loading"><Loader2 className="spin" size={18} />正在载入设备</div>}><ThreeViewer selectedStand={selected} onSelectStand={setSelected} view={view} explode={explode} showStrip={showStrip} compact={!full} expanded={expanded} focusMode={focusMode} shellMode={shellMode} motionPlaying={true} processSpeed={s5.speed} processData={caseData} hasDataOverlay={showData} /></Suspense></div>
      <div className="scene-view-selector"><select aria-label="三维观察视角" value={view} onChange={event => setView?.(event.target.value)}>{views.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><button title="辊系展开" aria-label="辊系展开" aria-pressed={explode} className={explode ? 'active' : ''} onClick={() => setExplode?.(!explode)}><Expand size={14} /></button></div>
      <aside hidden={!showData} className="scene-data-panel scene-data-left prediction-scene-analysis" aria-label="预测对比与变化">
        <PredictionTrace history={history} result={liveResult} resultCase={resultCase || caseData} resultSample={resultSample} dirty={dirty} />
      </aside>
      <aside hidden={!showData} className="scene-data-panel scene-data-right prediction-scene-analysis" aria-label="预测影响与参数调整">
        <PredictionInfluence result={liveResult} dirty={dirty} onSelectParameter={selectParameter} />
        <div className="prediction-quick-controls"><div className="quick-controls-heading">S5 调整</div>{controls.map(field => <NumericControl key={field.key} {...field} compact prefix="S5 快调" value={s5[field.key]} onChange={onFieldChange ? value => onFieldChange('S5', field.key, value) : undefined} />)}</div>
      </aside>
      <div className="scene-transport-status"><i className={Number(s5.speed) > 0 ? 'running' : ''} /><span>{!showStrip ? '带钢已隐藏' : Number(s5.speed) > 0 ? '带钢运行' : '带钢暂停'}</span><ArrowRight size={12} /><b>{'S1 → S5'}</b></div>
    </div>
    <div className="prediction-matrix-container" hidden={!showData}><ProcessMatrix caseData={caseData} selected={selected} onSelectStand={setSelected} onFieldChange={onFieldChange} onCaseFieldChange={onCaseFieldChange} dirty={dirty} errors={errors} focusRequest={focusRequest} /><button className="prediction-reset-case" title="恢复初始工况" aria-label="恢复初始工况" onClick={onReset}><RotateCcw size={12} /></button></div>
  </section>;
}

export default memo(ModelPanel);