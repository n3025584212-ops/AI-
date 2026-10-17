import { readableConditionName } from './userVisibleText.js';
import UserVisibleText from './UserVisibleText.jsx';
import { toDisplay, fromDisplay, formatEngineering, unitFor } from './engineeringUnits.js';
import { lazy, Suspense, useEffect, useImperativeHandle, useId, useRef, useState } from 'react';
import { Activity, ChevronDown, Crosshair, Maximize2, Minimize2, Pause, Play, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import CommittedParameterEditor from './CommittedParameterEditor.jsx';
import SpatialData from './SpatialData.jsx';
import DashboardMetrics from './DashboardMetrics.jsx';
import InputStatusCard from './InputStatusCard.jsx';
import KeyParameterSummary from './KeyParameterSummary.jsx';
import { readKeyParameterFields, writeKeyParameterFields, selectKeyParameterField } from './keyParameterDisplay.js';
import { summarizeModelInputs } from './modelInputs.js';
import { useHistoricalRangeCheck } from './HistoricalRangeCheck.jsx';
import SmartFunctionActions from './SmartFunctionActions.jsx';
import CurrentFindings from './CurrentFindings.jsx';
import TargetReferenceSettings from './TargetReferenceSettings.jsx';
import PredictionErrorAlarmRange from './PredictionErrorAlarmRange.jsx';
import { DEFAULT_PREDICTION_ERROR_ALARM_RANGE } from './predictionErrorAlarm.js';
import { currentPredictionErrorAlarm } from './s5PredictionErrorAlarm.js';
import DashboardComparisons from './DashboardComparisons.jsx';
import { continuousSampleSegments } from './chartSegments.js';
import { observationDisplay, dashboardInputDisplay } from './workbenchDisplay.js';
import { trendActualValue, trendActualAvailability, projectCurrentTrendActual } from './s5ActualDisplay.js';
import { visibleReplayFrames } from './seededDemo.js';
import { baselineActualValue, projectWorkbenchTrend, processedComparisonFrames, comparisonPlaybackWindow } from './workbenchTrend.js';
import { PreviewEmpty, PreviewResult, PreviewPolicies, PreviewParameters, previewCandidateFor } from './WorkbenchPreview.jsx';
import { POLICY_LABELS } from './candidatePolicyState.js';
import { TARGET_METADATA } from './findingContract.js';
import './scene-menus.css';
const ThreeViewer = lazy(() => import('./ThreeViewer.jsx'));
const number = (v,d=1) => Number.isFinite(v) ? v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}) : '—';
const time = t => new Date(t).toLocaleTimeString('zh-CN',{hour12:false});
const colors = {predicted:'#91c9ff',observed:'#32b5ff',synthetic:'#a996da',policyPrediction:'#91dbc7',target:'#eabc43'};
const channelNames = {force:'轧制力',speed:'轧制速度',tension:'后张力',frontTension:'前张力',bendingForce:'弯辊力',entryThickness:'入口厚度',exitThickness:'出口厚度',temperature:'温度',width:'带钢宽度',entrySetThickness:'入口设定厚度'};
const upstreamChannel = {S1:'force',S2:'force',S3:'force',S4:'force',S5:'force'};
function niceStep(raw) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  for (const multiple of [1, 2, 2.5, 5, 10]) if (multiple * magnitude >= raw - 1e-12) return multiple * magnitude;
  return 10 * magnitude;
}

export function TimePlot({frames,keys:requestedKeys=['observed','predicted'],seriesActualAvailable,height=175,onInspect,selectedTime,channel,stand='S5',observedLabel='实际值',policyLabel='方案预测',predictedLabel='预测值',sequence=false,compact=false}) {
  const [hover,setHover]=useState(null);
  const fillId=useId().replaceAll(':','');
  const axisLabel=t=>{
    if(!sequence)return time(t);
    const closest=frames.reduce((best,frame)=>!best||Math.abs(frame.time-t)<Math.abs(best.time-t)?frame:best,null);
    return closest?'记录 '+(closest.displayRecordIndex??closest.sequence??frames.indexOf(closest)+1):'—';
  };
  const plotElement=useRef(null);
  const [plotSize,setPlotSize]=useState({width:780,height});
  const hasFrames=frames.length>0;
  const actualAvailable=seriesActualAvailable ?? trendActualAvailability(frames).available;
  const keys=requestedKeys;
  const valueOf=(frame,key)=>channel?frame.input.stands.find(s=>s.id===stand)?.[channel]:key==='observed'?(Object.hasOwn(frame,'displayActual')?frame.displayActual:trendActualValue(frame)):frame[key];
  const labels={observed:'实际值',predicted:predictedLabel,policyPrediction:policyLabel,target:'目标值'};
  useEffect(()=>{
    if(!plotElement.current)return;
    const update=()=>{
      const bounds=plotElement.current?.getBoundingClientRect();
      if(!bounds?.width||!bounds?.height)return;
      const next={width:Math.round(bounds.width),height:Math.round(bounds.height)};
      setPlotSize(previous=>previous.width===next.width&&previous.height===next.height?previous:next);
    };
    update();
    const observer=new ResizeObserver(update);
    observer.observe(plotElement.current);
    return()=>observer.disconnect();
  },[hasFrames,height]);
  if(!hasFrames)return <div className="time-plot-empty">等待当前工况完成计算…</div>;
  const sampleValue=f=>valueOf(f,'observed');
  const values=frames.flatMap(f=>keys.map(k=>valueOf(f,k))).filter(Number.isFinite);
  const lo=Math.min(...values),hi=Math.max(...values),pad=Math.max((hi-lo)*.18,1);
  let min=Number.isFinite(lo)?lo-pad:0,max=Number.isFinite(hi)?hi+pad:1;
  // Snap bounds to a round 3-step grid: a sliding live window otherwise
  // rescales on every sample, churning the axis labels and making the whole
  // curve breathe. The grid only moves when data leaves the padded range.
  if(Number.isFinite(lo)&&Number.isFinite(hi)){
    const step=niceStep((max-min)/3);
    min=Math.floor(min/step)*step;
    const steps=3*Math.max(1,Math.ceil((max-min-1e-9)/(3*step)));
    max=min+steps*step;
  }
  const t0=frames[0]?.time||0,t1=frames.at(-1)?.time||t0+1000;
  const singleTime=t1<=t0;
  const width=plotSize.width,chartHeight=plotSize.height,left=compact?10:width<300?36:52,right=width-18,plotWidth=Math.max(1,right-left);
  const x=f=>left+(singleTime ? 0.5 : (f.time-t0)/Math.max(1000,t1-t0))*plotWidth;
  const y=v=>chartHeight-25-(v-min)/(max-min)*(chartHeight-40);
  const ticks=singleTime?[.5]:width<360?[0,1]:width<600?[0,.5,1]:[0,.25,.5,.75,1];
  const inspected=frames[hover]||frames.find(f=>f.time===selectedTime)||frames.at(-1);
  const observedText=observationDisplay(inspected);
  const atMove=e=>{const bounds=e.currentTarget.getBoundingClientRect(),position=(e.clientX-bounds.left)/bounds.width*width;const target=t0+Math.max(0,Math.min(1,(position-left)/plotWidth))*(t1-t0);let nearest=0;frames.forEach((f,i)=>{if(Math.abs(f.time-target)<Math.abs(frames[nearest].time-target))nearest=i;});setHover(nearest);};
  return <div className="time-plot"><svg ref={plotElement} viewBox={'0 0 '+width+' '+chartHeight} preserveAspectRatio="none" role="img" aria-label={channel?stand+' '+channelNames[channel]+(sequence?'原表记录趋势':'时间趋势'):'S5 轧制力'+keys.map(key=>labels[key]).join('、')+(sequence?'原表记录趋势':'时间趋势')} onPointerMove={atMove} onPointerLeave={()=>setHover(null)} onClick={()=>inspected&&onInspect?.(inspected)}>
    <defs><linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={colors.observed} stopOpacity=".26"/><stop offset="100%" stopColor={colors.observed} stopOpacity=".015"/></linearGradient></defs>
    {ticks.map(r=><line key={'vertical-'+r} x1={left+plotWidth*r} x2={left+plotWidth*r} y1="10" y2={chartHeight-25} stroke="#24364b"/>)}
    {(channel||keys.includes('observed')?continuousSampleSegments(frames,sampleValue):[]).filter(segment=>segment.length>1).map((segment,index)=><polygon key={'fill-'+index} points={x(segment[0])+','+(chartHeight-25)+' '+segment.map(f=>x(f)+','+y(sampleValue(f))).join(' ')+' '+x(segment.at(-1))+','+(chartHeight-25)} fill={'url(#'+fillId+')'}/>)}
    {[0,1,2,3].map(i=>{const v=min+(max-min)*i/3;return <g key={i}><line x1={left} x2={right} y1={y(v)} y2={y(v)} stroke="#24364b"/>{!compact&&<text x={left-9} y={y(v)+4} textAnchor="end">{number(toDisplay(channel||'force',v),channel&&channel!=='force'?0:2)}</text>}</g>;})}
    {singleTime&&!channel&&keys.includes('target')&&Number.isFinite(frames[0].target)&&<line x1={left} x2={right} y1={y(frames[0].target)} y2={y(frames[0].target)} stroke={colors.target} strokeDasharray="6 5"/>}
    {keys.flatMap(key=>continuousSampleSegments(frames,f=>valueOf(f,key)).map((segment,index)=>segment.length===1?<circle key={key+'-'+index} data-series-key={key} cx={x(segment[0])} cy={y(valueOf(segment[0],key))} r="2.5" fill={channel?colors.observed:colors[key]}/>:<polyline key={key+'-'+index} data-series-key={key} points={segment.map(f=>x(f)+','+y(valueOf(f,key))).join(' ')} fill="none" stroke={channel?colors.observed:colors[key]} strokeWidth={key==='target'?1.2:key==='predicted'?1.5:1.7} strokeDasharray={key==='target'?'6 5':key==='predicted'?'4 3':undefined} vectorEffect="non-scaling-stroke"/>))}
    {ticks.map(r=><text key={r} x={left+plotWidth*r} y={chartHeight-5} textAnchor={r===0?'start':r===1?'end':'middle'}>{axisLabel(t0+(t1-t0)*r)}</text>)}
    {inspected&&<g><line x1={x(inspected)} x2={x(inspected)} y1="9" y2={chartHeight-24} stroke="#8394ac" strokeDasharray="3 4"/>{keys.filter(k=>k!=='target'&&Number.isFinite(valueOf(inspected,k))).map(k=><circle key={k} cx={x(inspected)} cy={y(valueOf(inspected,k))} r="3.5" fill={channel?colors.observed:colors[k]}/>)}</g>}
  </svg><div className="plot-readout"><time>{inspected?axisLabel(inspected.time):'等待数据'}</time>{channel?<span className="plot-range">区间 <b>{Number.isFinite(lo)?formatEngineering(channel,lo,2)+' – '+formatEngineering(channel,hi,2):'—'}</b></span>:keys.map(k=><span key={k} title={k==='observed'?observedText.tooltip:undefined} style={{color:colors[k]}}>{labels[k]} <b>{formatEngineering('force',valueOf(inspected,k),3)}</b></span>)}</div></div>;
}


function SceneChoice({ name, label, description, options, value, open, onOpen, onClose, onChange }) {
  const container=useRef(null), trigger=useRef(null), closeTimer=useRef(null), suppressFocus=useRef(false);
  const cancelClose=()=>{window.clearTimeout(closeTimer.current);closeTimer.current=null;};
  const show=()=>{cancelClose();onOpen();};
  const close=(restoreFocus=false)=>{
    cancelClose();onClose();
    if(restoreFocus){suppressFocus.current=true;trigger.current?.focus();suppressFocus.current=false;}
  };
  const scheduleClose=()=>{cancelClose();closeTimer.current=window.setTimeout(()=>onClose(),180);};
  useEffect(()=>()=>window.clearTimeout(closeTimer.current),[]);
  const keyboard=event=>{
    if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close(true);return;}
    if(!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();show();
    const target=event.target;
    requestAnimationFrame(()=>{
      const items=[...container.current.querySelectorAll('.scene-choice-menu button')];
      const current=items.indexOf(target), selected=Math.max(0,options.findIndex(([key])=>key===value));
      const next=event.key==='Home'?0:event.key==='End'?items.length-1:current<0?selected:(current+(['ArrowUp','ArrowLeft'].includes(event.key)?-1:1)+items.length)%items.length;
      items[next]?.focus();
    });
  };
  return <div className="scene-choice" ref={container}
    onPointerEnter={event=>{if(event.pointerType!=='touch')show();}}
    onPointerLeave={scheduleClose}
    onFocusCapture={()=>{cancelClose();if(!suppressFocus.current)onOpen();}}
    onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))close();}}
    onKeyDown={keyboard}>
    <button ref={trigger} type="button" className="scene-choice-trigger" onClick={show} aria-expanded={open} aria-controls={`scene-${name}-menu`}>{label}<ChevronDown size={12}/></button>
    {open&&<div className={`scene-choice-menu scene-${name}-menu`} id={`scene-${name}-menu`} role="group" aria-label={description}>
      {options.map(([key,title])=><button type="button" key={key} aria-pressed={value===key} onClick={()=>{onChange(key);close(true);}}>{title}</button>)}
    </div>}
  </div>;
}

export function PolicyTrendPlot({generation,...plotProps}) {
  const frames=generation?.pendingCount>0?processedComparisonFrames(plotProps.frames):plotProps.frames;
  return <>{!frames.length&&generation?.pendingCount>0?<div className="time-plot-empty">正在处理第一条对比结果…</div>:<TimePlot {...plotProps} frames={frames}/>} {generation?.pendingCount>0&&<small className="trend-generation-note" role="status">已处理 {generation.processedCount} / {generation.totalCount} 条工况 · 后台继续生成</small>}{generation&&(generation.failedCount>0||generation.missingCandidateCount>0)&&<small className="trend-generation-note" role="status">{generation.failedCount>0&&`${generation.failedCount}条工况方案生成失败；`}{generation.missingCandidateCount>0&&`${generation.missingCandidateCount}条工况没有合格方案；`}候选方案曲线保留断点。</small>}</>;
}

export function PolicyTrendPlayback({frames,generation,range=60,sequence=false,...plotProps}){
  const [cursor,setCursor]=useState(0),[dragging,setDragging]=useState(false);
  const processed=processedComparisonFrames(frames),max=Math.max(0,processed.length-1),position=Math.min(cursor,max);
  useEffect(()=>{if(cursor>max)setCursor(max);},[cursor,max]);
  useEffect(()=>{
    if(dragging||processed.length<2)return;
    const timer=setTimeout(()=>setCursor(value=>(value+1)%processed.length),750);
    return()=>clearTimeout(timer);
  },[cursor,processed.length,dragging]);
  const seek=value=>setCursor(Math.max(0,Math.min(max,Math.round(value)||0)));
  const visible=comparisonPlaybackWindow(processed,position,range,sequence);
  return <><PolicyTrendPlot {...plotProps} generation={generation} frames={visible} sequence={sequence} selectedTime={processed[position]?.time}
    onInspect={frame=>seek(processed.findIndex(item=>item.time===frame.time&&item.input.id===frame.input.id))}/>
    <div className="time-scrubber trend-playback-scrubber" data-playback="loop" data-playback-cursor={position} data-processed-frames={processed.length}>
      <span>{processed.length?'循环演示 · 可拖动定位':'等待第一条处理结果'}</span>
      <input aria-label="时间回放游标" aria-valuetext={processed.length?`已处理曲线 ${position+1} / ${processed.length}`:'等待处理结果'} type="range" min="0" max={max} value={position} disabled={!processed.length}
        onPointerDown={event=>{setDragging(true);event.currentTarget.setPointerCapture?.(event.pointerId);}} onPointerUp={()=>setDragging(false)} onPointerCancel={()=>setDragging(false)} onBlur={()=>setDragging(false)}
        onChange={event=>seek(Number(event.target.value))} style={{'--scrub':`${Math.round(100*position/Math.max(1,max))}%`}}/>
      <span>{processed.length?position+1:0} / {processed.length}</span>
    </div></>;
}

export default function LiveWorkspace({modelProps:p,currentDiagnostics,stream,onOptimize,onOpenDecisionSupport,onOpenTrialAssistant,onOpenDiagnosisAssistant,onOpenAB,guidedTrialStatus='等待试算指令',modelCandidateStatus='自动搜索 · 待生成',modelCandidateSearching=false,candidatePolicy={series:[]},workbenchViewMode='CURRENT',onViewModeChange,onSelectPolicy,onRegenerateTrend,optimizationTask,onReturnBaseline,onAsk,controlRef}) {
  const workspaceElement=useRef(null);
  const targetReferenceDialog=useRef(null);
  const predictionErrorAlarmDialog=useRef(null);
  const [predictionErrorAlarmEditorOpen,setPredictionErrorAlarmEditorOpen]=useState(false);
  const inputSummary=summarizeModelInputs(p.caseData);
  const historicalState=useHistoricalRangeCheck(p.caseData);
  const plcSource=stream.mode==='plc'||p.caseData.importProvenance?.source_type==='PLC_REALTIME';
  const plcStatus=plcSource?(p.industrialStatus||{}):null;
  const inputDisplay=dashboardInputDisplay(inputSummary,historicalState.checked,plcStatus);
  useEffect(()=>{p.onConstraintChange?.();},[JSON.stringify(historicalState.limits)]);
  const [visibleFields,setVisibleFields]=useState(()=>{try{return readKeyParameterFields(globalThis.localStorage);}catch{return readKeyParameterFields(null);}});
  const changeVisibleField=(key,selected)=>{
    const outcome=selectKeyParameterField(visibleFields,key,selected);
    if(outcome.ok){setVisibleFields(outcome.fields);try{writeKeyParameterFields(globalThis.localStorage,outcome.fields);}catch{/* Keep the preference for this visit when browser storage is unavailable. */}}
    return outcome;
  };
  const [matrix,setMatrix]=useState(false),[method,setMethod]=useState(false);
  const [annotations,setAnnotations]=useState(true),[scope,setScope]=useState('line'),[shell,setShell]=useState('solid'),[expanded,setExpanded]=useState(false);
  const [focusRequest,setFocusRequest]=useState(null),[cameraReset,setCameraReset]=useState(0);
  const [findingFocus,setFindingFocus]=useState(null),[pendingFindingFocus,setPendingFindingFocus]=useState(null);
  const focusReturnShell=useRef(null),measurementRequest=useRef(null),findingRef=useRef(null),pendingFindingRef=useRef(null),spatial=useRef(null),viewerControls=useRef();
  spatial.current={currentDiagnostics,dirty:p.dirty,scope};
  // This is an action check against App's accepted projection, not a second authenticity gate.
  const currentFinding=request=>{
    const current=spatial.current,diagnostics=current.currentDiagnostics;
    if(!request||current.dirty||diagnostics?.status!=='VALID'||diagnostics.identity?.snapshot_id!==request.snapshot_id||!TARGET_METADATA[request.target]?.locatable_3d)return null;
    return diagnostics.findings.find(f=>f.finding_id===request.finding_id&&f.receipt===request.finding_receipt&&f.snapshot_id===request.snapshot_id&&f.status==='VALID'&&f.targets.includes(request.target)&&(!request.targets||JSON.stringify(f.targets)===JSON.stringify(request.targets)))||null;
  };
  const clearFindingFocus=()=>{
    findingRef.current=null;pendingFindingRef.current=null;setFindingFocus(null);setPendingFindingFocus(null);viewerControls.current?.clearFindingFocus();
  };
  const clearMeasurementFocus=({resetCamera=false}={})=>{
    const hadFocus=measurementRequest.current!==null;
    measurementRequest.current=null;setFocusRequest(null);viewerControls.current?.clearMeasurementFocus();
    if(focusReturnShell.current!==null){setShell(focusReturnShell.current);focusReturnShell.current=null;}
    if(resetCamera&&hadFocus)setCameraReset(value=>value+1);
  };
  const resetCamera=()=>{clearMeasurementFocus();setCameraReset(value=>value+1);};
  const leaveMeasurementFocus=()=>clearMeasurementFocus({resetCamera:!findingRef.current});
  const showScope=next=>{clearFindingFocus();clearMeasurementFocus();setScope(next);setCameraReset(value=>value+1);if(next==='s5')p.setSelected('S5');};
  const applyFindingFocus=request=>{
    const finding=currentFinding(request),viewer=viewerControls.current;
    if(!finding||!viewer?.ready||viewer.sceneScope!==spatial.current.scope||(request.target!=='S5'&&viewer.sceneScope!=='line'))return false;
    clearMeasurementFocus();
    if(!viewer.focusStand(request.target))return false;
    const focus={finding_id:finding.finding_id,finding_receipt:finding.receipt,receipt:finding.receipt,snapshot_id:finding.snapshot_id,title:finding.title,target:request.target,targets:[...finding.targets]};
    findingRef.current=focus;pendingFindingRef.current=null;setFindingFocus(focus);setPendingFindingFocus(null);return true;
  };
  const locateFindingTarget=request=>{
    const finding=currentFinding(request);if(!finding)return;
    if(applyFindingFocus(request))return;
    clearFindingFocus();clearMeasurementFocus();
    const pending={...request,targets:[...finding.targets]};pendingFindingRef.current=pending;setPendingFindingFocus(pending);
    if(request.target!=='S5'&&spatial.current.scope==='s5')setScope('line');
  };
  const sceneReady=()=>{
    const pending=pendingFindingRef.current;
    if(pending){if(!currentFinding(pending)){clearFindingFocus();return;}applyFindingFocus(pending);}
    else if(findingRef.current&&currentFinding(findingRef.current)&&viewerControls.current?.findingFocusedStand!==findingRef.current.target)applyFindingFocus(findingRef.current);
  };
  useEffect(()=>{
    if((findingRef.current&&!currentFinding(findingRef.current))||(pendingFindingRef.current&&!currentFinding(pendingFindingRef.current)))clearFindingFocus();
  },[currentDiagnostics,p.dirty]);
  useEffect(()=>{if(pendingFindingFocus)sceneReady();},[scope,pendingFindingFocus]);
  const [anchors,setAnchors]=useState([]),[channel,setChannel]=useState('force'),[range,setRange]=useState(0);
  useEffect(()=>{setRange(0);},[plcSource,stream.sourceName,p.caseData.importProvenance?.stream_id]);
  const [viewMenuOpen,setViewMenuOpen]=useState(null);
  const viewMenu=useRef(null);
  useEffect(()=>{if(!viewMenuOpen)return;const close=e=>{if(!viewMenu.current?.contains(e.target))setViewMenuOpen(null);};window.addEventListener('pointerdown',close);return()=>window.removeEventListener('pointerdown',close);},[viewMenuOpen]);
  const [compactDashboard,setCompactDashboard]=useState(()=>window.matchMedia('(max-height: 980px) and (min-width: 980px)').matches);
  useEffect(()=>{const query=window.matchMedia('(max-height: 980px) and (min-width: 980px)');const update=()=>setCompactDashboard(query.matches);query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[]);
  const [publicContext,setPublicContext]=useState(null);
  useEffect(()=>{let active=true;fetch('/assets/crd-dashboard-context.json').then(r=>r.ok?r.json():null).then(data=>{if(active&&data?.schema===1&&Array.isArray(data.frames))setPublicContext(data);}).catch(()=>{});return()=>{active=false;};},[]);

  useEffect(()=>{window.dispatchEvent(new CustomEvent('dkqkar-scene-expanded',{detail:expanded}));window.dkqkarDesktop?.setSceneFullscreen?.(expanded)?.catch?.(()=>{});},[expanded]);
  useEffect(()=>{
    // 系统侧退出全屏（对话框、系统手势）时同步收起放大视图，避免标题栏与内容叠压。
    const off=window.dkqkarDesktop?.onSceneFullscreenChanged?.(flag=>{if(!flag)setExpanded(false);});
    return ()=>{try{off&&off();}catch{}};
  },[]);
  useEffect(()=>()=>{window.dispatchEvent(new CustomEvent('dkqkar-scene-expanded',{detail:false}));window.dkqkarDesktop?.setSceneFullscreen?.(false)?.catch?.(()=>{});},[]);
  useImperativeHandle(controlRef,()=>({locateFindingTarget,execute:async action=>{
    const choose=(values,value)=>{if(!values.includes(value))throw new Error('操作参数无效');return value;};
    const bool=value=>{if(typeof value!=='boolean')throw new Error('操作参数无效');return value;};
    switch(action.type){
      case 'focus-measurement': {
        const id=choose(['S1','S2','S3','S4','S5'],action.stand),measurement=choose(Object.keys(channelNames),action.measurement);
        clearFindingFocus();
        if(focusReturnShell.current===null)focusReturnShell.current=shell;
        p.setSelected(id);setScope('line');setShell('transparent');setAnnotations(true);setChannel(measurement);
        const request={stand:id,field:measurement,revision:Date.now()};measurementRequest.current=request;setFocusRequest(request);
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const deadline=Date.now()+15000;
        while((!viewerControls.current?.ready||viewerControls.current.sceneScope!=='line')&&measurementRequest.current===request&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
        if(measurementRequest.current!==request)throw new Error('空间定位已更新');
        if(!viewerControls.current?.ready)throw new Error('三维设备尚未就绪，定位未执行');
        const outcome=viewerControls.current.focusMeasurement(id,measurement);
        return `已定位并高亮 ${id} ${channelNames[measurement]}（${outcome.objectName}）`;
      }
      case 'select_stand': {const id=choose(['S1','S2','S3','S4','S5'],action.stand);if((findingRef.current||pendingFindingRef.current)?.target!==id)clearFindingFocus();leaveMeasurementFocus();setScope(id==='S5'?'s5':'line');p.setSelected(id);return '已定位 '+id;}
      case 'set_scope': showScope(choose(['line','s5'],action.scope));return action.scope==='s5'?'已切到 S5 主视图':'已显示完整五机架';
      case 'set_shell': setShell(choose(['solid','transparent','hidden'],action.mode));return {solid:'已显示实体外壳',transparent:'已切到透壳视图',hidden:'已隐藏外壳，显示辊系'}[action.mode];
      case 'set_view': choose(['perspective','front','top','drive'],action.view);resetCamera();p.setView(action.view);return '已切到'+{perspective:'透视',front:'操作侧',top:'俯视',drive:'传动侧'}[action.view]+'视角';
      case 'set_motion': bool(action.playing);return '模型动画保持自动播放';
      case 'set_stream': bool(action.playing);if(action.playing&&stream.mode==='manual')throw new Error('当前为手动工况，请先选择数据流');if(action.playing&&!stream.running)stream.toggle();if(!action.playing)stream.pause();return action.playing?'已播放数据流':'已暂停数据流';
      case 'set_fullscreen': setExpanded(bool(action.expanded));return action.expanded?'已全屏显示设备':'已退出全屏';
      case 'reset_camera': if(!viewerControls.current?.ready)throw new Error('模型正在载入，请稍后再试');resetCamera();return '视角已复位';
      case 'zoom': choose(['in','out'],action.direction);if(!viewerControls.current?.ready)throw new Error('模型正在载入，请稍后再试');viewerControls.current.zoom(action.direction);return action.direction==='in'?'已放大设备':'已缩小设备';
      case 'set_explode': p.setExplode(bool(action.expanded));return action.expanded?'已展开辊系':'已收起辊系';
      case 'set_inspector': return '测点面板已移除';
      case 'set_source': if(bool(action.open))p.onNavigate('data');return action.open?'已打开数据接入页面':'当前已在预测工作台';
      case 'set_matrix': setMatrix(bool(action.open));return action.open?'已打开全部参数':'已收起参数';
      default: throw new Error('这项操作还没有接入语音');
    }
  }}));
  const previousSelection=useRef(p.selected);
  useEffect(()=>{if(previousSelection.current!==p.selected){if((findingRef.current||pendingFindingRef.current)?.target!==p.selected)clearFindingFocus();if(focusRequest?.stand!==p.selected)setScope(p.selected==='S5'?'s5':'line');previousSelection.current=p.selected;}},[p.selected,focusRequest]);
  useEffect(()=>{const escape=e=>{if(e.key!=='Escape'||e.defaultPrevented||e.isComposing)return;if(viewMenuOpen){setViewMenuOpen(null);}else if(method){setMethod(false);}else if(matrix){setMatrix(false);}else if(expanded){setExpanded(false);}else return;e.preventDefault();e.stopImmediatePropagation();};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[method,matrix,expanded,viewMenuOpen]);
  const current=stream.frame, s5=p.caseData.stands[4], station=p.caseData.stands.find(s=>s.id===p.selected)||s5;
  const sceneData=p.caseData,sceneS5=sceneData.stands[4];
  const sceneFrame={...(current||{}),time:p.lastUpdated instanceof Date?p.lastUpdated.getTime():current?.time};
  const projectedAnchors=anchors.map(a=>{const metric=a.stand===p.selected?channel:upstreamChannel[a.stand];return {...a,...a.channels?.[metric],metric};});
  const selectedAnchor=projectedAnchors.find(a=>a.stand===p.selected);
  const currentResult=inputDisplay.predictionAllowed&&!p.dirty&&p.predictionState==='READY'&&p.currentPredictionBound!==false&&(!plcSource||plcStatus.frame?.frameId===sceneData.importProvenance?.sample_id)?p.result:{...p.result,value:null};
  const observedLabel='实际值'; // A historical curve may contain several observation sources.
  const displayFrames=projectCurrentTrendActual(stream.frames,{caseData:sceneData,result:currentResult,resultSample:p.resultSample,dirty:p.dirty,observationMatches:p.observationMatches}).map((frame,index)=>({...frame,displayRecordIndex:index+1}));
  const referenceIndex=publicContext?.model_hash===currentResult.model_hash&&p.resultSample?.source_type==='PUBLIC_DATA' ? publicContext.frames.findIndex(f=>f.input.id===sceneData.id&&JSON.stringify(f.input.stands)===JSON.stringify(sceneData.stands)&&f.input.target===sceneData.target&&f.input.width===sceneData.width&&f.input.entrySetThickness===sceneData.entrySetThickness) : -1;
  const sequence=stream.mode!=='manual'&&referenceIndex>=0;
  const trendSourceFrames=sequence?publicContext.frames.map((frame,index)=>({...frame,displayRecordIndex:index+1})):stream.mode==='manual'?displayFrames.filter(frame=>frame.input?.id===sceneData.id&&frame.input?.importProvenance?.source_type===sceneData.importProvenance?.source_type&&frame.input?.importProvenance?.sourceName===sceneData.importProvenance?.sourceName):displayFrames;
  const reached=sequence?trendSourceFrames.slice(0,referenceIndex+1):visibleReplayFrames(trendSourceFrames,stream.cursor);
  const recordAxis=!plcSource||current?.timestampAvailable===false||!Number.isFinite(current?.time);
  const plotRange=recordAxis?(range||Math.max(1,reached.length)):(range||60);
  const subset=recordAxis?reached.slice(-plotRange):reached.filter(f=>f.time<=(current?.time??Infinity)&&f.time>=(current?.time??0)-plotRange*1000);
  // A freshly advanced frame reaches the chart one render before its
  // prediction fills in; drawing that tail blanks the line end and readout
  // on every sample. Hold the unfinished tail back so each sample appears
  // together with its prediction in a single stable paint.
  let plotted=subset;
  {let end=subset.length;while(end>0&&!Number.isFinite(subset[end-1].predicted))end-=1;if(end>0&&end<subset.length)plotted=subset.slice(0,end);}
  const baselinePlotFrames=sequence?trendSourceFrames.slice(Math.max(0,referenceIndex-plotRange+1),referenceIndex+1):plotted;
  const planView=workbenchViewMode==='PREVIEW';
  const preview=previewCandidateFor(candidatePolicy,currentResult,p.dirty);
  const previewReady=planView&&!!preview;
  const previewCase=previewReady?structuredClone(p.caseData):p.caseData;
  if(previewReady)preview.changes.forEach(c=>{previewCase.stands.find(s=>s.id===c.stand)[c.field]=c.after;});
  const policyLabel=planView?(preview?.actual_anchored_mode?'方案调整后估计 · ':'方案预测 · ')+(POLICY_LABELS[candidatePolicy.selectedPolicy]||'未选择'):null;
  const trendProjection=planView&&candidatePolicy.selectedPolicy?projectWorkbenchTrend(baselinePlotFrames,{mode:workbenchViewMode,policyLabel,policySeries:candidatePolicy.series}):projectWorkbenchTrend(baselinePlotFrames);
  const loopComparison=planView&&!!candidatePolicy.selectedPolicy&&stream.mode!=='plc';
  const playbackProjection=loopComparison?projectWorkbenchTrend(candidatePolicy.series.map(point=>point.frame),{mode:'PREVIEW',policyLabel,policySeries:candidatePolicy.series}):null;
  const playbackKey=trendSourceFrames[0]?.input?.id+':'+candidatePolicy.selectedPolicy+':'+candidatePolicy.series[0]?.key;
  const plotFrames=trendProjection.frames,plotKeys=trendProjection.keys;
  const metricFrames=sequence?publicContext.frames.slice(0,referenceIndex+1):subset;
  const trendSourceId=sequence?'public:crd-dashboard-context:'+publicContext.model_hash:[stream.mode,stream.sourceName,trendSourceFrames[0]?.input?.id,trendSourceFrames[0]?.time].join(':');
  const validActualPointCount=reached.filter(frame=>baselineActualValue(frame)!==null).length;
  const actualSeries={sourceId:trendSourceId,validActualPointCount,available:validActualPointCount>0};
  const inspect=frame=>sequence&&!current?.historicalReplay?p.onLoadSample?.(frame.input):stream.seek(stream.frames.findIndex(f=>f.time===frame.time));
  const sourceLabel=plcSource?'PLC实时数据':'工业数据';
  const datasetCount=sequence?publicContext.frames.length:stream.frames.length||1;
  const recordIndex=sequence?referenceIndex+1:stream.frames.length?stream.cursor+1:1;
  const select=id=>{if((findingRef.current||pendingFindingRef.current)?.target!==id)clearFindingFocus();leaveMeasurementFocus();p.setSelected(id);setChannel(upstreamChannel[id]||'force');};
  const visibleFindingFocus=currentFinding(findingFocus)?findingFocus:null;
  const displayDiagnostics=currentDiagnostics?{...currentDiagnostics,status:currentResult.value===null?'WAITING':currentDiagnostics.status,findings:currentResult.value===null?[]:currentDiagnostics.findings?.filter(f=>!f.kind.includes('TARGET'))||[]}:currentDiagnostics;
  const availableFindings=displayDiagnostics?.status==='VALID'&&!p.dirty?displayDiagnostics.findings:[];
  const relatedStands=[...new Set(availableFindings.flatMap(finding=>finding.targets).filter(target=>TARGET_METADATA[target]?.locatable_3d))];
  const associatedStand=visibleFindingFocus?.target || (relatedStands.includes(p.selected)?p.selected:relatedStands.length===1?relatedStands.at(0):null);
  const openSection=(selector,{expand=false}={})=>{
    const element=workspaceElement.current?.querySelector(selector);if(!element)return;
    if(expand){const details=element.tagName==='DETAILS'?element:element.querySelector('details');if(details)details.open=true;}
    element.scrollIntoView?.({behavior:'smooth',block:'start'});
  };
  const openTargetReference=()=>{if(!targetReferenceDialog.current?.open)targetReferenceDialog.current?.showModal();};
  const openPredictionErrorAlarmRange=()=>{if(!predictionErrorAlarmDialog.current?.open){setPredictionErrorAlarmEditorOpen(true);predictionErrorAlarmDialog.current?.showModal();}};
  const currentAlarm=currentPredictionErrorAlarm({...p,result:currentResult,dirty:p.dirty||!inputDisplay.predictionAllowed},p.predictionErrorAlarmRange??DEFAULT_PREDICTION_ERROR_ALARM_RANGE);
  const openDiagnosis=()=>{
    if(availableFindings.length===1){const [finding]=availableFindings;(onOpenDiagnosisAssistant || p.onDiagnoseFinding)?.(finding.finding_id);}
    else openSection('.current-findings',{expand:true});
  };
  const openLocation=()=>{
    openSection('.twin-scene');
    const finding=associatedStand&&(availableFindings.find(item=>item.finding_id===visibleFindingFocus?.finding_id&&item.targets.includes(associatedStand)) || availableFindings.find(item=>item.targets.includes(associatedStand)));
    const request=finding&&{finding_id:finding.finding_id,finding_receipt:finding.receipt,snapshot_id:finding.snapshot_id,target:associatedStand};
    if(request&&currentFinding(request))locateFindingTarget(request);
    else showScope('line');
  };
  return <div ref={workspaceElement} className={`live-workspace dashboard-workspace ${expanded?'live-expanded':''}`} data-stream-cursor={stream.cursor} data-stream-count={stream.frames.length}>
    <div className="stream-bar"><div className={`source-chip ${stream.running?'is-running':''}`}><i/>数据来源：{sourceLabel}</div><button onClick={()=>p.onNavigate('data')}>数据接入</button><div className="stream-spacer"/><span>当前记录：{recordIndex} / {datasetCount}</span>{plcSource&&!inputDisplay.predictionAllowed&&<span role="status">{inputDisplay.communicationStopped?'通讯已断开 · 数据已停止更新 · 实时预测暂停':'数据未完成有效检查 · 实时预测暂停'}</span>}{plcSource&&current?.timestampAvailable!==false&&Number.isFinite(current?.time)&&<time>{time(current.time)}</time>}{stream.mode!=='manual'&&stream.mode!=='plc'&&<><button onClick={stream.toggle} aria-label={stream.running?'暂停数据流':'播放数据流'}>{stream.running?<Pause size={14}/>:<Play size={14}/>} {stream.running?'暂停':'播放'}</button></>}</div>
    {planView&&<PreviewPolicies onReturn={onReturnBaseline} policy={candidatePolicy.selectedPolicy} onSelect={onSelectPolicy} disabled={!candidatePolicy.activeRun?.recommendations?.length||p.dirty}/>}
    <InputStatusCard caseData={p.caseData} modelStatus={p.modelStatus} result={currentResult} dirty={p.dirty} inputSummary={inputSummary} historicalState={historicalState} inputDisplay={inputDisplay} predictionState={p.predictionState} onRetryPrediction={p.onRetryPrediction}/>
    <DashboardMetrics previewContent={planView?(previewReady?<PreviewResult plan={preview} caseData={p.caseData} result={currentResult} resultSample={p.resultSample} observationMatches={p.observationMatches}/>:<PreviewEmpty stale={candidatePolicy.status==='STALE'||p.dirty&&!!candidatePolicy.selectedPolicy} noQualified={candidatePolicy.activeRun?.result==='NO_QUALIFIED_CANDIDATE'} onOptimize={onOptimize}/>):null} predictionState={p.predictionState} inputDisplay={inputDisplay} targetValue={p.dashboardTargetValue} targetReference={p.targetReference} caseData={sceneData} result={currentResult} resultSample={p.resultSample} pendingStreamProjection={p.pendingStreamProjection} observationMatches={p.observationMatches} frames={metricFrames} selected={p.selected} dirty={p.dirty} optimizing={modelCandidateSearching} modelStatus={p.modelStatus} onSelect={select} onOpenPredictionErrorAlarmRange={openPredictionErrorAlarmRange} predictionErrorAlarmRange={p.predictionErrorAlarmRange??DEFAULT_PREDICTION_ERROR_ALARM_RANGE} onOptimize={onOptimize}/>
    <SmartFunctionActions inputSummary={inputSummary} historicalSummary={historicalState.checked} diagnosisStatus={currentDiagnostics?.status} diagnosisCount={availableFindings.length} associatedStand={associatedStand} trialStatus={guidedTrialStatus} modelCandidateStatus={modelCandidateStatus} modelCandidateSearching={modelCandidateSearching} diagnosisBusy={p.diagnosisBusy} onScreening={()=>openSection('.input-status-card',{expand:true})} onDiagnosis={openDiagnosis} onLocation={openLocation} onTrial={onOpenTrialAssistant} onAB={onOpenAB || onOpenDecisionSupport}/>
    <CurrentFindings diagnostics={displayDiagnostics} alarm={currentAlarm} inputDisplay={inputDisplay} predictionState={p.predictionState} modelStatus={p.modelStatus} plcStatus={plcStatus} onLocateFindingTarget={locateFindingTarget} onDiagnoseFinding={p.onDiagnoseFinding} diagnosingFindingId={p.diagnosingFindingId} diagnosisBusy={p.diagnosisBusy}/>
    <div className="dashboard-grid"><div className="dashboard-primary">
    <div className="live-main">
      <section className="twin-scene">
        <div className="twin-heading"><div><h2 title={sceneData.importProvenance?.display_geometry_note}>五机架冷轧机组</h2></div><div className="scene-tools"><button className={scope==='line'&&!focusRequest?'active':''} onClick={()=>showScope('line')}>整线</button><button className={scope==='s5'&&!focusRequest?'active':''} onClick={()=>showScope('s5')}>S5 局部</button><div className="scene-view-control" ref={viewMenu}>
          <SceneChoice name="view" label="视角" description="观察方向" options={[["perspective","斜视"],["front","操作侧"],["drive","传动侧"],["top","俯视"]]} value={p.view} open={viewMenuOpen==='view'} onOpen={()=>setViewMenuOpen('view')} onClose={()=>setViewMenuOpen(current=>current==='view'?null:current)} onChange={value=>{resetCamera();p.setView(value);}}/>
          <SceneChoice name="shell" label="外壳" description="外壳显示" options={[["solid","实体"],["transparent","透壳"]]} value={shell} open={viewMenuOpen==='shell'} onOpen={()=>setViewMenuOpen('shell')} onClose={()=>setViewMenuOpen(current=>current==='shell'?null:current)} onChange={setShell}/>
          </div><button onClick={()=>setExpanded(v=>!v)} aria-label={expanded?'退出全屏3D':'全屏查看3D'}>{expanded?<Minimize2 size={15}/>:<Maximize2 size={15}/>}</button></div></div>
        <div className="twin-canvas"><Suspense fallback={<div className="live-loading">正在载入完整五机架设备…</div>}><ThreeViewer onResetCamera={resetCamera} onSceneReady={sceneReady} cameraReset={cameraReset} controlsRef={viewerControls} selectedStand={p.selected} onSelectStand={select} view={p.view} explode={p.explode} showStrip={true} compact={false} expanded={expanded} focusMode={scope} shellMode={shell} motionPlaying={true} processSpeed={sceneS5.speed} processData={sceneData} hasDataOverlay={false} annotationInsets={{top:expanded?90:compactDashboard?38:55,bottom:expanded?50:compactDashboard?32:42,left:24,right:24}} onAnchorsChange={setAnchors}/></Suspense>
          {annotations&&<SpatialData anchors={projectedAnchors} selected={p.selected} scope={scope} expanded={expanded} caseData={sceneData} result={currentResult} frames={metricFrames} frame={sceneFrame} onSelect={select}/>}
          {expanded&&(!planView||candidatePolicy.selectedPolicy)&&<div className="holo-chart"><div className="holo-chart-head"><b>S5 预测曲线</b><span>{recordAxis?'工业数据 · 记录顺序':inputDisplay.predictionAllowed?'PLC实时采集':'实时预测暂停'}</span></div><PolicyTrendPlot generation={planView?candidatePolicy.trendGeneration:null} frames={plotFrames} seriesActualAvailable={actualSeries.available} keys={plotKeys} policyLabel={policyLabel} predictedLabel={trendProjection.predictedLabel} height={110} observedLabel={observedLabel} sequence={recordAxis} selectedTime={sequence?publicContext.frames[referenceIndex]?.time:current?.time}/></div>}
          <div className="twin-bottom"><button onClick={()=>setAnnotations(v=>!v)} aria-pressed={annotations}>机架标识</button><span>{sceneS5.speed>0?'钢带输送 · 辊面转动':'钢带静止 · 当前速度为零'}</span><span style={{visibility:p.dirty?'visible':'hidden'}}>{p.predictionState==='FAILED'?'当前工况预测暂未完成':'当前工况预测更新中'}</span></div>
        </div>
        <div className="station-strip">{p.caseData.stands.map(st=><button key={st.id} className={`${st.id===p.selected?'selected':''} ${st.id==='S5'?'is-s5':''}`} onClick={()=>{select(st.id);setScope(st.id==='S5'?'s5':'line');}}><i/><b>{st.id}</b><span>{st.id==='S5'?'轧制力预测':'工况参数'}</span></button>)}<button className="matrix-toggle" onClick={()=>setMatrix(v=>!v)} aria-expanded={matrix}><SlidersHorizontal size={14}/>{matrix?'收起参数':'全部参数'}</button></div>
      </section>
      
    </div>
    <section className="s5-trend" data-view-mode={workbenchViewMode} data-policy={planView?candidatePolicy.selectedPolicy||'NONE':'NONE'} data-policy-series-length={planView?candidatePolicy.seriesLength||0:0} data-policy-pending-count={planView?candidatePolicy.trendGeneration?.pendingCount||0:0} data-trend-source-id={actualSeries.sourceId} data-valid-actual-point-count={actualSeries.validActualPointCount} data-series-actual-available={actualSeries.available}><div className="trend-body"><div className="trend-heading"><b><Activity size={15}/> S5轧制力 / t</b>{(!planView||candidatePolicy.selectedPolicy)&&<span className="trend-legend">{(!planView||trendProjection.keys.includes('observed'))&&<><i style={{background:colors.observed}}/>实际值 </>}<i style={{background:colors.predicted}}/>{trendProjection.predictedLabel} {planView&&<><i style={{background:colors.policyPrediction}}/>{policyLabel} </>}</span>}{planView&&candidatePolicy.selectedPolicy&&onRegenerateTrend&&<button className="trend-regenerate" aria-label="重新生成方案对比曲线" title="按已播放工况生成实际值、原预测和方案调整后估计；缺少实际值时显示原预测和方案预测" disabled={p.dirty||candidatePolicy.trendGeneration?.pendingCount>0} onClick={onRegenerateTrend}><RotateCcw size={12}/>重新生成方案对比曲线</button>}<select aria-label={recordAxis?"趋势记录范围":"趋势时间范围"} value={recordAxis?range:range||60} onChange={e=>setRange(Number(e.target.value))}>{recordAxis?<><option value="0">当前数据批次</option>{datasetCount>30&&<option value="30">最近 30 条</option>}</>:<><option value="30">最近 30 秒</option><option value="60">最近 1 分钟</option><option value="300">最近 5 分钟</option><option value="600">最近 10 分钟</option></>}</select></div>{planView&&!candidatePolicy.selectedPolicy?<PreviewEmpty stale={candidatePolicy.status==='STALE'||p.dirty&&!!candidatePolicy.selectedPolicy} noQualified={candidatePolicy.activeRun?.result==='NO_QUALIFIED_CANDIDATE'} onOptimize={onOptimize}/>:loopComparison?<PolicyTrendPlayback key={playbackKey} generation={candidatePolicy.trendGeneration} frames={playbackProjection.frames} range={range||playbackProjection.frames.length} sequence={recordAxis} seriesActualAvailable={actualSeries.available} keys={playbackProjection.keys} policyLabel={policyLabel} predictedLabel={playbackProjection.predictedLabel} observedLabel={observedLabel}/>:<PolicyTrendPlot generation={planView?candidatePolicy.trendGeneration:null} frames={plotFrames} seriesActualAvailable={actualSeries.available} keys={plotKeys} policyLabel={policyLabel} predictedLabel={trendProjection.predictedLabel} observedLabel={observedLabel} sequence={recordAxis} selectedTime={sequence?publicContext.frames[referenceIndex]?.time:current?.time} onInspect={inspect}/>} {!loopComparison&&<div className="time-scrubber"><span>{recordAxis?'播放进度 · '+(stream.running?'跟随记录':'可拖动定位'):'实时采集记录 · 可拖动查看'}</span><input aria-label="时间回放游标" type="range" min="0" max={Math.max(0,stream.frame?.seededDemo?stream.revealedCursor:(sequence?publicContext.frames.length:stream.frames.length)-1)} value={sequence?referenceIndex:stream.cursor} onChange={e=>sequence&&!current?.historicalReplay?p.onLoadSample?.(publicContext.frames[Number(e.target.value)].input):stream.seek(Number(e.target.value))} style={{'--scrub':`${Math.round(100*(sequence?referenceIndex:stream.cursor)/Math.max(1,(sequence?publicContext.frames.length:stream.frames.length)-1))}%`}}/><span>{sequence?referenceIndex+1:stream.frames.length?stream.cursor+1:0} / {sequence?publicContext.frames.length:stream.frames.length}</span></div>}</div></section>
    <DashboardComparisons caseData={sceneData} result={currentResult} resultSample={p.resultSample} pendingStreamProjection={!plcSource&&inputDisplay.predictionAllowed?p.pendingStreamProjection:null} observationMatches={p.observationMatches} frames={plotFrames} cases={p.cases||[]} onHistory={()=>p.onNavigate('saved-data')} onOptimize={onOptimize} onAsk={onAsk} dirty={p.dirty} secondaryPanel={<KeyParameterSummary preview={previewReady} caseData={previewCase} checked={historicalState.checked} visibleFields={visibleFields} dirty={p.dirty} onEdit={()=>setMatrix(true)}/>}/>
    </div></div>
    {previewReady&&<PreviewParameters caseData={p.caseData} plan={preview}/>}
    <dialog ref={predictionErrorAlarmDialog} className="target-reference-dialog prediction-error-range-dialog" aria-label="预测误差报警区间" onClose={()=>setPredictionErrorAlarmEditorOpen(false)} aria-modal="true" data-escape-layer="modal" onKeyDown={event=>{if(event.key==='Escape')event.stopPropagation();}}>
      {predictionErrorAlarmEditorOpen&&<PredictionErrorAlarmRange value={p.predictionErrorAlarmRange??DEFAULT_PREDICTION_ERROR_ALARM_RANGE} alarm={currentAlarm} onChange={p.onPredictionErrorAlarmRangeChange} onClose={()=>predictionErrorAlarmDialog.current?.close()}/>}
    </dialog>
    <dialog ref={targetReferenceDialog} className="target-reference-dialog" aria-label="目标偏差值设置" aria-modal="true" data-escape-layer="modal" onKeyDown={event=>{if(event.key==='Escape')event.stopPropagation();}}>
      <header><h2>目标偏差值</h2><button type="button" aria-label="关闭目标偏差值设置" onClick={()=>targetReferenceDialog.current?.close()}><X size={18}/></button></header>
      <TargetReferenceSettings preference={p.targetReference} projection={p.currentTargetReference} onChange={p.onTargetReferenceChange}/>
    </dialog>
    {matrix&&!planView&&<div className="live-matrix parameter-drawer" role="dialog" aria-label="参数编辑"><div className="dashboard-drawer-heading"><div><b>参数编辑</b><span>25 维正式输入 · 应用后自动预测</span></div><button onClick={()=>setMatrix(false)} aria-label="关闭全部参数"><X size={18}/></button></div><CommittedParameterEditor layout="vertical" onApply={p.onApplyParameters} onEditDirty={p.onEditDirty} onBeginEdit={p.onBeginEdit} caseData={p.caseData} selected={p.selected} onSelectStand={p.setSelected} onFieldChange={p.onFieldChange} onCaseFieldChange={p.onCaseFieldChange} dirty={p.dirty} errors={p.errors} focusRequest={focusRequest} visibleFields={visibleFields} onVisibleFieldChange={changeVisibleField} historicalChecked={historicalState.checked}/></div>}
    {p.errors.length>0&&<div className="live-error"><UserVisibleText value={p.errors[0]}/></div>}
    {method&&!p.dirty&&<section className="prediction-method"><div><b>{currentResult.mode==='formal'?'QCDKR 模型预测':'本次演示预测'}</b><button onClick={()=>setMethod(false)} aria-label="关闭预测依据"><X size={15}/></button></div><p>{readableConditionName(p.resultCase.id)} · S5 预测 {formatEngineering('force',currentResult.value,3)}</p><p>{currentResult.sensitivityMethod||currentResult.sensitivityLabel}</p><div className="method-drivers">{currentResult.drivers.slice(0,3).map(d=><button key={d.name} onClick={()=>{if(/^S[1-5]$/.test(d.stand))select(d.stand);}}>{d.name}<b>{number(d.value,1)}{currentResult.mode==='formal'?'':'%'}</b></button>)}</div><button onClick={()=>onAsk('解释当前预测结果和主要影响参数')}>让 DK 工艺 Agent 解释当前样本</button></section>}
  </div>;
}
