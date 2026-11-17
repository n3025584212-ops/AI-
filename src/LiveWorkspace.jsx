import { readableConditionName } from './userVisibleText.js';
import { parseVoiceCommand } from './voiceCommands.js';
import UserVisibleText from './UserVisibleText.jsx';
import { toDisplay, fromDisplay, formatEngineering, unitFor } from './engineeringUnits.js';
import { Suspense, useEffect, useImperativeHandle, useId, useLayoutEffect, useRef, useState } from 'react';
import { Activity, Box, ChevronDown, Crosshair, Footprints, LayoutDashboard, Maximize2, Minimize2, Pause, Play, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import CommittedParameterEditor from './CommittedParameterEditor.jsx';
import SpatialData from './SpatialData.jsx';
import DashboardMetrics from './DashboardMetrics.jsx';
import KeyParameterSummary from './KeyParameterSummary.jsx';
import { readKeyParameterFields, writeKeyParameterFields, selectKeyParameterField } from './keyParameterDisplay.js';
import { summarizeModelInputs } from './modelInputs.js';
import { useHistoricalRangeCheck } from './HistoricalRangeCheck.jsx';
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
import './immersive-3d.css';
import ThreeViewer from './threeViewerLazy.js';
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
  const width=plotSize.width,chartHeight=plotSize.height,left=compact?38:width<300?36:52,right=width-18,plotWidth=Math.max(1,right-left);
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
    {[0,1,2].map(i=>{const n=2,v=min+(max-min)*i/n;return <g key={i}><line x1={left} x2={right} y1={y(v)} y2={y(v)} stroke="#24364b"/>{!compact&&<text x={left-9} y={y(v)+4} textAnchor="end">{number(toDisplay(channel||'force',v),channel&&channel!=='force'?0:2)}</text>}</g>;})}
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

export default function LiveWorkspace({modelProps:p,currentDiagnostics,stream,onOptimize,onOpenDecisionSupport,onOpenTrialAssistant,onOpenDiagnosisAssistant,onOpenAB,guidedTrialStatus='等待试算指令',modelCandidateStatus='自动搜索 · 待生成',modelCandidateSearching=false,candidatePolicy={series:[]},workbenchViewMode='CURRENT',onViewModeChange,onSelectPolicy,onRegenerateTrend,optimizationTask,onReturnBaseline,onAsk,engineerReply='',controlRef}) {
  const workspaceElement=useRef(null);
  const targetReferenceDialog=useRef(null);
  const predictionErrorAlarmDialog=useRef(null);
  const [predictionErrorAlarmEditorOpen,setPredictionErrorAlarmEditorOpen]=useState(false);
  const inputSummary=summarizeModelInputs(p.caseData);
  // 流程条稳定器：数据流每 ~2s 刷新一次，dirty / PREDICTING 在两次刷新之间来回翻转，
  // 直接绑到流程条上就是“待更新↔完整、更新中↔完成”每秒闪一次。状态需持续 2.5s
  // 才真正切换，短促的批次刷新不改变显示；用户真的改了参数或预测卡住时才会变。
  const flowBusyRaw=Boolean(p.dirty)||p.predictionState!=='READY';
  const [flowBusy,setFlowBusy]=useState(flowBusyRaw);
  useEffect(()=>{const timer=setTimeout(()=>setFlowBusy(flowBusyRaw),2500);return()=>clearTimeout(timer);},[flowBusyRaw]);
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
  // 3D 主视图：桌面宽屏默认直接进全屏三维（开放世界视角），数据视图可一键切回。
  const [immersive,setImmersive]=useState(()=>typeof window!=='undefined'&&window.innerWidth>=1180);
  const [engineerStatus,setEngineerStatus]=useState('待命');
  const [engineerDockOpen,setEngineerDockOpen]=useState(false);
  const [engineerInput,setEngineerInput]=useState('');
  const [autoSpeak,setAutoSpeak]=useState(true);
  const engineerReplySeen=useRef(engineerReply||'');
  const selectRef=useRef(null);
  // 3D 主视图是唯一工作台形态：宽屏恒为三维，窄屏（<1180）仍自动降级到数据视图作为兜底。
  useEffect(()=>{
    const onResize=()=>{if(window.innerWidth<1180)setImmersive(false);};
    window.addEventListener('resize',onResize);
    return()=>window.removeEventListener('resize',onResize);
  },[]);
  const [annotations,setAnnotations]=useState(true),[scope,setScope]=useState('line'),[shell,setShell]=useState('solid'),[expanded,setExpanded]=useState(false);
  const [walkMode,setWalkMode]=useState(false);
  useEffect(()=>{if(!expanded&&walkMode)setWalkMode(false);},[expanded,walkMode]);
  const [lighting,setLighting]=useState('workshop');
  const [sceneCmd,setSceneCmd]=useState('');
  const [leftDockCollapsed,setLeftDockCollapsed]=useState(false);
  const [cmdFeedback,setCmdFeedback]=useState('');
  const cmdFeedbackTimer=useRef(0);
  const submitSceneCommandRef=useRef(()=>{});
  // 场景指令直通（对标机房片语音巡检的文本通道）：本地解析→即时执行，问题类转助手。
  const submitSceneCommand=()=>{
    const text=sceneCmd.trim();if(!text)return;
    setSceneCmd('');
    const parsed=parseVoiceCommand(text);
    if(parsed.kind==='commands'){
      const lines=[];
      for(const action of parsed.actions){
        try{
          if(action.type==='select_stand'){
            select(action.stand);
            if(viewerControls.current?.dispatchToStand?.(action.stand))lines.push(`数字人已前往 ${action.stand}`);
            else lines.push(`已定位 ${action.stand}`);
          }else{
            const msg=viewerControls.current?.execute?.(action);
            if(msg)lines.push(msg);
          }
        }catch(error){lines.push(error.message||'执行失败');}
      }
      setCmdFeedback(lines.join('；')||'已执行');
    }else if(parsed.kind==='question'){
      onAsk?.(text);setCmdFeedback('已转助手分析');
    }else{
      setCmdFeedback(parsed.message||'这条指令还不支持');
    }
    clearTimeout(cmdFeedbackTimer.current);
    cmdFeedbackTimer.current=setTimeout(()=>setCmdFeedback(''),5000);
  };
  submitSceneCommandRef.current=submitSceneCommand;
  // 真实 Enter 会被 document 捕获层的焦点陷阱提前截走（App.jsx focusFirst），
  // 这里挂 window 捕获层抢在它前面；中文输入法组合中（keyCode 229）不触发提交。
  useEffect(()=>{
    const onKey=e=>{
      const t=e.target;
      if(!(t instanceof HTMLInputElement&&t.classList.contains('scene-cmd')))return;
      if(e.key!=='Enter'||e.isComposing||e.keyCode===229)return;
      e.preventDefault();e.stopPropagation();
      submitSceneCommandRef.current();
    };
    window.addEventListener('keydown',onKey,true);
    return()=>window.removeEventListener('keydown',onKey,true);
  },[]);
  const [focusRequest,setFocusRequest]=useState(null),[cameraReset,setCameraReset]=useState(0);
  const [findingFocus,setFindingFocus]=useState(null),[pendingFindingFocus,setPendingFindingFocus]=useState(null);
  const focusReturnShell=useRef(null),measurementRequest=useRef(null),findingRef=useRef(null),pendingFindingRef=useRef(null),pendingInspectRef=useRef(null),spatial=useRef(null),viewerControls=useRef();
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
  const showScope=()=>{clearFindingFocus();clearMeasurementFocus();setScope('line');setCameraReset(value=>value+1);};
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
    if(pendingInspectRef.current){
      const stand=pendingInspectRef.current;
      pendingInspectRef.current=null;
      if(viewerControls.current?.inspectStand?.(stand))setEngineerStatus(`前往 ${stand} 巡检…`);
    }
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
  // The camera must frame the part of the canvas the HUD leaves visible. These
  // insets used to be fixed 166/218px, which crushed the scene on short or
  // scaled displays; measure the real DOM instead.
  const [hudInsets,setHudInsets]=useState(null);
  const hudInsetsRef=useRef(null);
  useLayoutEffect(()=>{
    const root=workspaceElement.current;
    if(!root) return;
    let frame=0;
    const measure=()=>{
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        const canvas=root.querySelector('.twin-canvas');
        if(!canvas) return;
        const cr=canvas.getBoundingClientRect();
        if(cr.width<2||cr.height<2) return;
        const box=selector=>{
          const el=root.querySelector(selector);
          if(!el) return null;
          const r=el.getBoundingClientRect();
          if(r.width<1||r.height<1) return null;
          return {top:r.top-cr.top,bottom:cr.bottom-r.bottom,left:r.left-cr.left,right:cr.right-r.right,width:r.width,height:r.height};
        };
        let top=0,bottom=0,left=24,right=24;
        if(expanded){
          const rail=box('.spatial-card-rail'),heading=box('.twin-heading'),holo=box('.holo-chart');
          top=Math.max(rail?rail.top+rail.height:0,heading?heading.top+heading.height:0,72)+8;
          bottom=Math.max(holo?holo.height+holo.bottom:0,40)+8;
        } else if(immersive){
          // 沉浸式下顶部只剩右上角一张 S5 浮动卡，不再按整行 HUD 高度压场景：
          // 只留 12px 安全边距，让三维铺到画面顶部，避免上方空出一条天空带。
          const trend=box('.s5-trend'),comparisons=box('.dc-comparisons');
          // 72px 是机架顶部数据牌需要的最低头部空间；再小牌会被顶出画面。
          top=120;
          bottom=Math.max(trend?trend.height+trend.bottom:0,comparisons?comparisons.height+comparisons.bottom:0,40)+8;
          right=120;
        } else {
          top=compactDashboard?38:55;
          bottom=compactDashboard?32:42;
        }
        top=Math.max(0,Math.min(top,Math.max(0,cr.height-160)));
        bottom=Math.max(0,Math.min(bottom,Math.max(0,cr.height-160)));
        if(top+bottom>cr.height-120){
          const scale=Math.max(0,(cr.height-120)/Math.max(top+bottom,1));
          top*=scale; bottom*=scale;
        }
        right=Math.max(0,Math.min(right,Math.max(0,cr.width-160)));
        left=Math.max(0,Math.min(left,Math.max(0,cr.width-right-160)));
        const next={top:Math.round(top),bottom:Math.round(bottom),left:Math.round(left),right:Math.round(right)};
        const prev=hudInsetsRef.current;
        if(!prev||['top','bottom','left','right'].some(key=>Math.abs(prev[key]-next[key])>1)){
          hudInsetsRef.current=next; setHudInsets(next);
        }
      });
    };
    const observer=new ResizeObserver(measure);
    observer.observe(root);
    root.querySelectorAll('.dm-metrics,.s5-trend,.dc-comparisons,.twin-heading,.spatial-card-rail,.holo-chart,.engineer-dock,.dashboard-grid,.twin-canvas').forEach(el=>observer.observe(el));
    const mutations=new MutationObserver(measure);
    mutations.observe(root,{childList:true,subtree:true});
    window.addEventListener('resize',measure);
    measure();
    return ()=>{cancelAnimationFrame(frame);observer.disconnect();mutations.disconnect();window.removeEventListener('resize',measure);};
  },[expanded,immersive,compactDashboard,annotations]);
  const [publicContext,setPublicContext]=useState(null);
  useEffect(()=>{let active=true;fetch('/assets/crd-dashboard-context.json').then(r=>r.ok?r.json():null).then(data=>{if(active&&data?.schema===1&&Array.isArray(data.frames))setPublicContext(data);}).catch(()=>{});return()=>{active=false;};},[]);

  useEffect(()=>{window.dispatchEvent(new CustomEvent('dkqkar-scene-expanded',{detail:expanded}));window.dkqkarDesktop?.setSceneFullscreen?.(expanded)?.catch?.(()=>{});},[expanded]);
  useEffect(()=>{
    // 系统侧退出全屏（对话框、系统手势）时同步收起放大视图，避免标题栏与内容叠压。
    const off=window.dkqkarDesktop?.onSceneFullscreenChanged?.(flag=>{if(!flag)setExpanded(false);});
    return ()=>{try{off&&off();}catch{}};
  },[]);
  useEffect(()=>()=>{window.dispatchEvent(new CustomEvent('dkqkar-scene-expanded',{detail:false}));window.dkqkarDesktop?.setSceneFullscreen?.(false)?.catch?.(()=>{});},[]);
  useImperativeHandle(controlRef,()=>({locateFindingTarget,getState:()=>{const host=workspaceElement.current?.querySelector('.three-host');return {selectedStand:p.selected,view:p.view,shell,lighting,scope,expanded,walkMode,explode:p.explode,matrixOpen:matrix,streamRunning:stream.running,streamMode:stream.mode,streamCursor:stream.cursor,streamCount:stream.frames.length,sceneReady:!!viewerControls.current?.ready,cameraReset,camera:host?.dataset.camera||null,lightingRendered:host?.dataset.lighting||null,shellOpacity:host?.dataset.shellOpacity||null,visibleStands:host?.dataset.visibleStands||null,highlightedStand:host?.dataset.highlightedStand||null,highlightedMeasurement:host?.dataset.highlightedMeasurement||null,motionPlaying:true};},execute:async action=>{
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
      case 'select_stand': {const id=choose(['S1','S2','S3','S4','S5'],action.stand);if((findingRef.current||pendingFindingRef.current)?.target!==id)clearFindingFocus();leaveMeasurementFocus();setScope('line');p.setSelected(id);return '已定位 '+id;}
      case 'set_scope': {choose(['line','s5'],action.scope);showScope();if(action.scope==='s5'){p.setSelected('S5');viewerControls.current?.focusStand('S5');}return action.scope==='s5'?'已在整线中定位 S5':'已显示完整五机架';}
      case 'set_shell': setShell(choose(['solid','transparent','hidden'],action.mode));return {solid:'已显示实体外壳',transparent:'已切到透壳视图',hidden:'已隐藏外壳，显示辊系'}[action.mode];
      case 'set_lighting': setLighting(choose(['workshop','inspection'],action.mode));return action.mode==='inspection'?'已切换明亮检视灯光':'已切换车间灯光';
      case 'set_walk': setWalkMode(action.on);if(action.on)setExpanded(true);else setExpanded(false);return action.on?'已进入巡视模式，WASD 移动、左键旋转、滚轮缩放':'已退出巡视模式';
      case 'set_view': choose(['hall','perspective','front','top','drive'],action.view);resetCamera();p.setView(action.view);return '已切到'+{perspective:'透视',front:'操作侧',top:'俯视',drive:'传动侧'}[action.view]+'视角';
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
  useEffect(()=>{if(previousSelection.current!==p.selected){if((findingRef.current||pendingFindingRef.current)?.target!==p.selected)clearFindingFocus();if(focusRequest?.stand!==p.selected)setScope('line');previousSelection.current=p.selected;}},[p.selected,focusRequest]);
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
  selectRef.current=select;
  const inspectFromAI=stand=>{
    if(!/^S[1-5]$/.test(stand))return;
    selectRef.current?.(stand);setScope('line');
    if(!viewerControls.current?.inspectStand?.(stand)) pendingInspectRef.current=stand;
    setEngineerStatus(`前往 ${stand} 巡检…`);
  };
  const engineerSpeak=text=>{
    if(!text)return;
    setEngineerStatus('播报中…');
    Promise.resolve(viewerControls.current?.speak?.(text))
      .then(ok=>setEngineerStatus(ok?'待命':'文字已就绪（语音不可用）'))
      .catch(()=>setEngineerStatus('待命'));
  };
  const dispatchEngineer=input=>{
    const text=String(input||'').trim();if(!text)return;
    const upper=text.toUpperCase();
    const stand=(upper.match(/S[1-5]/)||[])[0]||null;
    if(/你是谁|自我介绍|介绍自己|名字/.test(text)){
      setEngineerStatus('自我介绍…');
      engineerSpeak('我是 B 版现场工程师，负责五机架巡检、操作辅助和工艺汇报。');
      return;
    }
    if(stand){
      inspectFromAI(stand);
      const s=sceneData.stands.find(item=>item.id===stand)||sceneS5;
      engineerSpeak(`${stand} 机架，当前轧制力 ${number(s.force,1)} 吨。工程师 B 正在前往巡检。`);
      return;
    }
    if(/汇报|工况|状态|情况|播报/.test(text)){ engineerBroadcast(); return; }
    if(/偏差|异常|最大|最不稳/.test(text)){
      const stands=sceneData.stands.slice(0,4);
      const mean=stands.reduce((sum,item)=>sum+(Number(item.force)||0),0)/Math.max(1,stands.length);
      const worst=stands.reduce((best,item)=>Math.abs((Number(item.force)||0)-mean)>Math.abs((Number(best.force)||0)-mean)?item:best,stands[0]);
      engineerSpeak(`${worst.id} 机架当前偏离平均轧制力最大，建议优先巡检该机架。`);
      return;
    }
    setEngineerStatus('交给 DK AI…');
    onAsk?.(text);
  };
  const engineerReport=()=>{
    setEngineerStatus('DK AI 分析中…');
    onAsk?.('请结合当前工况，给出五机架巡检重点和下一步建议。');
  };
  const engineerBroadcast=()=>{
    const stand=sceneData.stands.find(s=>s.id===p.selected)||sceneS5;
    engineerSpeak(`${p.selected} 机架，当前轧制力 ${number(stand.force,1)} 吨，S5 预测 ${number(currentResult.value,1)} 吨。现场工程师 B 巡检正常。`);
  };
  useEffect(()=>{
    const handler=event=>{
      const stand=String(event.detail?.stand||'').toUpperCase();
      if(!/^S[1-5]$/.test(stand))return;
      delete globalThis.__qcdkrInspectRequest;
      inspectFromAI(stand);
    };
    // 从其它页面点“定位机架”时，工位可能还没挂载；接住最近 8 秒内的请求。
    const pending=globalThis.__qcdkrInspectRequest;
    if(pending&&Date.now()-pending.at<8000){
      delete globalThis.__qcdkrInspectRequest;
      inspectFromAI(String(pending.stand||'').toUpperCase());
    }
    window.addEventListener('qcdkr:inspect',handler);
    return()=>window.removeEventListener('qcdkr:inspect',handler);
  },[]);
  useEffect(()=>{
    if(!autoSpeak||!immersive||!engineerReply)return;
    if(engineerReply===engineerReplySeen.current)return;
    engineerReplySeen.current=engineerReply;
    const clean=String(engineerReply).replace(/[#*_>`\[\]()]/g,' ').replace(/\s+/g,' ').trim().slice(0,160);
    if(!clean)return;
    setEngineerStatus('AI 播报中…');
    Promise.resolve(viewerControls.current?.speak?.(clean))
      .then(ok=>setEngineerStatus(ok?'待命':'文字已就绪（语音不可用）'))
      .catch(()=>setEngineerStatus('待命'));
  },[engineerReply,autoSpeak,immersive]);
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
  return <div ref={workspaceElement} className={`live-workspace dashboard-workspace ${expanded?'live-expanded':''} ${immersive?'live-immersive':''}`} data-stream-cursor={stream.cursor} data-stream-count={stream.frames.length}>
    {planView&&<PreviewPolicies onReturn={onReturnBaseline} policy={candidatePolicy.selectedPolicy} onSelect={onSelectPolicy} disabled={!candidatePolicy.activeRun?.recommendations?.length||p.dirty}/>}
    {false&&<DashboardMetrics previewContent={planView?(previewReady?<PreviewResult plan={preview} caseData={p.caseData} result={currentResult} resultSample={p.resultSample} observationMatches={p.observationMatches}/>:<PreviewEmpty stale={candidatePolicy.status==='STALE'||p.dirty&&!!candidatePolicy.selectedPolicy} noQualified={candidatePolicy.activeRun?.result==='NO_QUALIFIED_CANDIDATE'} onOptimize={onOptimize}/>):null} predictionState={p.predictionState} inputDisplay={inputDisplay} targetValue={p.dashboardTargetValue} targetReference={p.targetReference} caseData={sceneData} result={currentResult} resultSample={p.resultSample} pendingStreamProjection={p.pendingStreamProjection} observationMatches={p.observationMatches} frames={metricFrames} selected={p.selected} dirty={p.dirty} optimizing={modelCandidateSearching} modelStatus={p.modelStatus} onSelect={select} onOpenPredictionErrorAlarmRange={openPredictionErrorAlarmRange} onOpenTargetReference={openTargetReference} predictionErrorAlarmRange={p.predictionErrorAlarmRange??DEFAULT_PREDICTION_ERROR_ALARM_RANGE} onOptimize={onOptimize}/>}

    <div className="dashboard-grid"><div className="dashboard-primary">
    <div className="live-main">
      <section className="twin-scene">
        {walkMode&&<div className="twin-heading"><div className="twin-heading-left"/><div className="scene-tools">
          <span className="scene-walk-mode">巡视中</span>
          <button type="button" onClick={()=>{setWalkMode(false);setExpanded(false)}}>退出巡视</button>
        </div></div>}
        <div className="twin-canvas"><Suspense fallback={<div className="live-loading">正在载入完整五机架设备…</div>}><ThreeViewer lighting={lighting} onResetCamera={resetCamera} onSceneReady={sceneReady} cameraReset={cameraReset} controlsRef={viewerControls} selectedStand={p.selected} onSelectStand={select} view={p.view} explode={p.explode} showStrip={true} compact={false} expanded={expanded} focusMode={scope} shellMode={shell} motionPlaying={true} processSpeed={sceneS5.speed} processData={sceneData} hasDataOverlay={false} annotationInsets={hudInsets||{top:expanded?90:immersive?58:compactDashboard?38:55,bottom:expanded?50:immersive?218:compactDashboard?32:42,left:24,right:24}} onAnchorsChange={setAnchors} onNavigate={p.onNavigate} walkMode={walkMode} onExitWalk={()=>{setWalkMode(false);setExpanded(false);}}/></Suspense>
          {annotations&&!walkMode&&<SpatialData anchors={projectedAnchors} selected={p.selected} scope={scope} expanded={expanded} caseData={sceneData} result={currentResult} frames={metricFrames} frame={sceneFrame} onSelect={select}/>}
          {/* 普通模式下底部已有完整 S5 趋势面板，浮动卡重复；仅全屏3D（面板隐藏）时显示 */}
          {!walkMode&&expanded&&<div className={'scene-dock scene-dock-left'+(leftDockCollapsed?' is-collapsed':'')}>
            <button type="button" className="dock-tab" onClick={()=>setLeftDockCollapsed(v=>!v)} aria-label={leftDockCollapsed?'展开轧制力趋势':'收起轧制力趋势'}>{leftDockCollapsed?'轧制力趋势 ›':'‹'}</button>
            <div className="dock-card dock-wide">
              <div className="dock-head"><span>S5 轧制力趋势</span><button type="button" className="dock-toggle" onClick={()=>setLeftDockCollapsed(true)} aria-label="收起轧制力趋势">‹</button></div>
              <TimePlot frames={plotFrames} keys={plotKeys} compact height={148} channel="force" stand={p.selected}/>
            </div>
          </div>}
          {expanded&&!walkMode&&(!planView||candidatePolicy.selectedPolicy)&&<div className="holo-chart"><div className="holo-chart-head"><b>S5 预测曲线</b><span>{recordAxis?'工业数据 · 记录顺序':inputDisplay.predictionAllowed?'PLC实时采集':'实时预测暂停'}</span></div><PolicyTrendPlot generation={planView?candidatePolicy.trendGeneration:null} frames={plotFrames} seriesActualAvailable={actualSeries.available} keys={plotKeys} policyLabel={policyLabel} predictedLabel={trendProjection.predictedLabel} height={110} observedLabel={observedLabel} sequence={recordAxis} selectedTime={sequence?publicContext.frames[referenceIndex]?.time:current?.time}/></div>}
          {/* 工况流程条：输入→预测→对照→保存，对标 WareTrack 运单 stepper */}
          <div className="twin-bottom twin-flow"><span className="flow-cond" title="当前工况">{readableConditionName(sceneData.id)}</span><ol className="flow-steps">
            <li className={flowBusy?'is-active':'is-done'}><i/><b>工况输入</b><small>{flowBusy?'待更新':'完整'}</small></li>
            <li className={p.predictionState==='FAILED'?'is-error':flowBusy?'is-active':'is-done'}><i/><b>模型预测</b><small>{p.predictionState==='FAILED'?'失败':flowBusy?'更新中':'完成'}</small></li>
            <li className={p.resultSample?.observedAvailable?'is-done':'is-muted'}><i/><b>实际值对照</b><small>{p.resultSample?.observedAvailable?'已对照':'暂无'}</small></li>
            <li className={flowBusy?'is-active':'is-done'}><i/><b>保存工况</b><small>{flowBusy?'待保存':'已保存'}</small></li>
          </ol><span className="flow-strip">{sceneS5.speed>0?'钢带输送 · 辊面转动':'钢带静止'}</span></div>
        </div>
        <div className="station-strip">{p.caseData.stands.map(st=>{
          const running=st.id!=='S5'&&Number(st.force)>0;
          const state=st.id==='S5'?(p.predictionState==='FAILED'?'预测失败':p.dirty?'预测更新中':'轧制力预测'):(running?'轧制中':'待机');
          const dot=st.id==='S5'?(p.predictionState==='FAILED'?'#ef8182':p.dirty?'#d2b381':'#6bafff'):(running?'#43d9b0':'#5c7a92');
          return <button key={st.id} className={`${st.id===p.selected?'selected':''} ${st.id==='S5'?'is-s5':''}`} onClick={()=>{select(st.id);setScope('line');viewerControls.current?.inspectStand?.(st.id);}} title={`聚焦 ${st.id} · 相机飞至机架`}><i style={{background:dot,boxShadow:`0 0 6px ${dot}`}}/><b>{st.id}</b><span>{st.id==='S5'?state:running?number(st.force,1)+' t':'待机'}</span><span className="strip-meter" style={{width:Math.min(100,Math.max(0,Number(st.force)/12))+'%'}} aria-hidden="true"/></button>;})}<button className="matrix-toggle" onClick={()=>setMatrix(v=>!v)} aria-expanded={matrix}><SlidersHorizontal size={14}/>{matrix?'收起参数':'全部参数'}</button></div>
      </section>
      
    </div>
    <section className="s5-trend" data-view-mode={workbenchViewMode} data-policy={planView?candidatePolicy.selectedPolicy||'NONE':'NONE'} data-policy-series-length={planView?candidatePolicy.seriesLength||0:0} data-policy-pending-count={planView?candidatePolicy.trendGeneration?.pendingCount||0:0} data-trend-source-id={actualSeries.sourceId} data-valid-actual-point-count={actualSeries.validActualPointCount} data-series-actual-available={actualSeries.available}><div className="trend-body"><div className="trend-heading"><b><Activity size={15}/> S5轧制力 / t</b>{(!planView||candidatePolicy.selectedPolicy)&&<span className="trend-legend">{(!planView||trendProjection.keys.includes('observed'))&&<><i style={{background:colors.observed}}/>实际值 </>}<i style={{background:colors.predicted}}/>{trendProjection.predictedLabel} {planView&&<><i style={{background:colors.policyPrediction}}/>{policyLabel} </>}</span>}{stream.mode!=='manual'&&stream.mode!=='plc'&&<button type="button" className="trend-playback" aria-label={stream.running?'暂停数据流':'播放数据流'} onClick={stream.toggle}>{stream.running?'暂停':'播放'}</button>}{p.predictionState==='FAILED'&&p.onRetryPrediction&&<button type="button" className="trend-playback" aria-label="重试当前工况预测" onClick={p.onRetryPrediction}>重试预测</button>}{planView&&candidatePolicy.selectedPolicy&&onRegenerateTrend&&<button className="trend-regenerate" aria-label="重新生成方案对比曲线" title="按已播放工况生成实际值、原预测和方案调整后估计；缺少实际值时显示原预测和方案预测" disabled={p.dirty||candidatePolicy.trendGeneration?.pendingCount>0} onClick={onRegenerateTrend}><RotateCcw size={12}/>重新生成方案对比曲线</button>}<select aria-label={recordAxis?"趋势记录范围":"趋势时间范围"} value={recordAxis?range:range||60} onChange={e=>setRange(Number(e.target.value))}>{recordAxis?<><option value="0">当前数据批次</option>{datasetCount>30&&<option value="30">最近 30 条</option>}</>:<><option value="30">最近 30 秒</option><option value="60">最近 1 分钟</option><option value="300">最近 5 分钟</option><option value="600">最近 10 分钟</option></>}</select></div>{planView&&!candidatePolicy.selectedPolicy?<PreviewEmpty stale={candidatePolicy.status==='STALE'||p.dirty&&!!candidatePolicy.selectedPolicy} noQualified={candidatePolicy.activeRun?.result==='NO_QUALIFIED_CANDIDATE'} onOptimize={onOptimize}/>:loopComparison?<PolicyTrendPlayback key={playbackKey} generation={candidatePolicy.trendGeneration} frames={playbackProjection.frames} range={range||playbackProjection.frames.length} sequence={recordAxis} seriesActualAvailable={actualSeries.available} keys={playbackProjection.keys} policyLabel={policyLabel} predictedLabel={playbackProjection.predictedLabel} observedLabel={observedLabel}/>:<PolicyTrendPlot generation={planView?candidatePolicy.trendGeneration:null} frames={plotFrames} seriesActualAvailable={actualSeries.available} keys={plotKeys} policyLabel={policyLabel} predictedLabel={trendProjection.predictedLabel} observedLabel={observedLabel} sequence={recordAxis} selectedTime={sequence?publicContext.frames[referenceIndex]?.time:current?.time} onInspect={inspect}/>} {!loopComparison&&<div className="time-scrubber"><span>{recordAxis?'播放进度 · '+(stream.running?'跟随记录':'可拖动定位'):'实时采集记录 · 可拖动查看'}</span><input aria-label="时间回放游标" type="range" min="0" max={Math.max(0,stream.frame?.seededDemo?stream.revealedCursor:(sequence?publicContext.frames.length:stream.frames.length)-1)} value={sequence?referenceIndex:stream.cursor} onChange={e=>sequence&&!current?.historicalReplay?p.onLoadSample?.(publicContext.frames[Number(e.target.value)].input):stream.seek(Number(e.target.value))} style={{'--scrub':`${Math.round(100*(sequence?referenceIndex:stream.cursor)/Math.max(1,(sequence?publicContext.frames.length:stream.frames.length)-1))}%`}}/><span>{sequence?referenceIndex+1:stream.frames.length?stream.cursor+1:0} / {sequence?publicContext.frames.length:stream.frames.length}</span></div>}</div></section>
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
    {matrix&&!planView&&<div className="live-matrix parameter-drawer" role="dialog" aria-label="参数编辑"><div className="dashboard-drawer-heading"><div><b>参数编辑</b><span>25 维正式输入 · 应用后自动预测</span></div><button onClick={()=>setMatrix(false)} aria-label="关闭全部参数"><X size={18}/></button></div><CommittedParameterEditor layout="vertical" onApply={p.onApplyParameters} onEditDirty={p.onEditDirty} onBeginEdit={p.onBeginEdit} discardTimeseriesCount={stream.mode!=='manual'&&stream.frames.length>1?stream.frames.length:0} caseData={p.caseData} selected={p.selected} onSelectStand={p.setSelected} onFieldChange={p.onFieldChange} onCaseFieldChange={p.onCaseFieldChange} dirty={p.dirty} errors={p.errors} focusRequest={focusRequest} visibleFields={visibleFields} onVisibleFieldChange={changeVisibleField} historicalChecked={historicalState.checked}/></div>}
    {p.errors.length>0&&<div className="live-error"><UserVisibleText value={p.errors[0]}/>{p.predictionState==='FAILED'&&p.onRetryPrediction&&<button type="button" onClick={p.onRetryPrediction}>重试预测</button>}</div>}
    {method&&!p.dirty&&<section className="prediction-method"><div><b>{currentResult.mode==='formal'?'QCDKR 模型预测':'本次演示预测'}</b><button onClick={()=>setMethod(false)} aria-label="关闭预测依据"><X size={15}/></button></div><p>{readableConditionName(p.resultCase.id)} · S5 预测 {formatEngineering('force',currentResult.value,3)}</p><p>{currentResult.sensitivityMethod||currentResult.sensitivityLabel}</p><div className="method-drivers">{currentResult.drivers.slice(0,3).map(d=><button key={d.name} onClick={()=>{if(/^S[1-5]$/.test(d.stand))select(d.stand);}}>{d.name}<b>{number(d.value,1)}{currentResult.mode==='formal'?'':'%'}</b></button>)}</div><button onClick={()=>onAsk('解释当前预测结果和主要影响参数')}>让 DK 工艺 Agent 解释当前样本</button></section>}
  </div>;
}
