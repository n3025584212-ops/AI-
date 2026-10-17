import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Download, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react';
import './maintenance-workspace.css';
import MaintenanceGlyph from './MaintenanceGlyph.jsx';
import { modelDisplayName, readableConditionName, userVisibleText } from './userVisibleText.js';
import UserVisibleText from './UserVisibleText.jsx';
import { aiConnectionState } from './aiConnectionStatus.js';
import { MODEL_INPUT_COUNT, MODEL_FEATURES, summarizeModelInputs } from './modelInputs.js';
import { HistoricalRangeDetails, useHistoricalRangeCheck } from './HistoricalRangeCheck.jsx';
import { SEARCH_CONFIG } from './smartCandidateConfig.js';
import { APP_VERSION } from './version.js';
import { MODEL_DESCRIPTION } from './productBrand.js';
import { createSystemDiagnosticSnapshot, createSystemAiDiagnosticCheck, latestDiagnosticAI, exportSystemDiagnosticSnapshot } from './systemStatusDiagnostics.js';
import { READING, UNAVAILABLE, safeStatusText, dataCheckState, replayStatus, modelServiceState, aiServiceState,
 searchStateDisplay, recentSearchDisplay, searchConfigDisplay, maintenanceReadProjection, localStatusTime,
 localStatusStamp } from './maintenanceStatusProjection.js';


export const maintenanceStamp = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚无记录';
export function downloadOperationalFile(filename, payload, type = 'application/json;charset=utf-8') {
  const blob = new Blob([typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)], { type });
  const href = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = href; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
export function ServiceBadge({ good, children }) { return <span className={`maint-badge ${good ? 'is-good' : 'is-idle'}`}><i/>{children}</span>; }
export function OperationsDialog({ title, children, onClose, footer, ...dialogProps }) {
  const dialog = useRef(null), closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const prior = document.activeElement;
    dialog.current?.focus();
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current?.(); }
      if (event.key === 'Tab') {
        const nodes = [...(dialog.current?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') || [])];
        const first = nodes[0], last = nodes.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); prior?.focus?.(); };
  }, []);
  return <div className="maint-dialog-backdrop" data-escape-layer="modal" onMouseDown={event => { if (event.target === event.currentTarget) onClose?.(); }}><section ref={dialog} className="maint-dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} {...dialogProps}><header><h3>{title}</h3><button aria-label="关闭弹窗" onClick={onClose}><X size={19}/></button></header><div className="maint-dialog-body">{children}</div>{footer && <footer>{footer}</footer>}</section></div>;
}

function Panel({kind,title,state,children}){
 return <section className={'maint-panel maint-section-'+kind} aria-label={title}><header><span className="maint-panel-icon"><MaintenanceGlyph kind={kind}/></span>
 <div className="maint-panel-heading"><div className="maint-panel-title"><h3>{title}</h3><span className={'maint-badge is-'+state.tone}><i/>{state.label}</span></div></div></header>{children}</section>;
}
function Fact({label,children,title,tone}){
 return <div className="maint-fact"><dt>{label}</dt><dd title={title} className={tone?'maint-value-'+tone:undefined}>{children??READING}</dd></div>;
}
const predictionLabels={STALE:'正在准备重新预测',PREDICTING:'正在计算',READY:'已更新',FAILED:'暂未完成'};
export default function MaintenanceWorkspace({api,onNotify,onNavigate,onOpenSolutions,user,caseData,stream,modelStatus,
 assistantStatus,searchState,mostRecentCompletedSearch,predictionState,onRefreshModel,onRefreshAssistant,
 currentPrediction,predictionBound,dirty,industrialStatus,predictionUpdatedAt}){
 const [status,setStatus]=useState(null),[readState,setReadState]=useState('LOADING'),[modelReadFailed,setModelReadFailed]=useState(false);
 const [busy,setBusy]=useState(false),[refreshFailed,setRefreshFailed]=useState(false),[dialog,setDialog]=useState(null);
 const [diagnosticAi,setDiagnosticAi]=useState(null),[aiChecking,setAiChecking]=useState(false);
 const diagnosticCheck=useRef(null),diagnosticPending=useRef(null);
 const alive=useRef(true),callbacks=useRef(null),readRevision=useRef(0);
 callbacks.current={api,onNotify,onRefreshModel,onRefreshAssistant};
 if(!diagnosticCheck.current)diagnosticCheck.current=createSystemAiDiagnosticCheck((...args)=>callbacks.current.api(...args));
 // Keep the existing formal completeness source for the input check and its details.
 const inputSummary=caseData?summarizeModelInputs(caseData):null;
 const historical=useHistoricalRangeCheck(caseData),check=dataCheckState(inputSummary,historical.checked);
 const data=replayStatus(stream),model=modelServiceState(modelStatus,modelReadFailed),ai=aiServiceState(assistantStatus);
 const search=searchStateDisplay(searchState),config=searchConfigDisplay(SEARCH_CONFIG);
 const admin=['LOCAL_ADMIN','admin'].includes(user?.role);
 const refresh=useCallback(async(notify=false)=>{
  if(!alive.current)return;
  const revision=++readRevision.current,c=callbacks.current;setBusy(true);setRefreshFailed(false);
  try{
   const results=await Promise.allSettled([c.api('/maintenance/status'),c.onRefreshModel?c.onRefreshModel():Promise.resolve(),c.onRefreshAssistant?c.onRefreshAssistant({force:notify}):Promise.resolve()]);
   if(!alive.current||revision!==readRevision.current)return;
   let success=results[0].status==='fulfilled';
   if(success)try{setStatus(maintenanceReadProjection(results[0].value));setReadState('READY');}catch{success=false;}
   if(!success)setReadState('UNAVAILABLE');
   setModelReadFailed(results[1].status==='rejected');
   const failed=!success||results.some(result=>result.status==='rejected');setRefreshFailed(failed);
   if(notify&&!failed)c.onNotify?.('系统状态已更新');
  }finally{if(alive.current&&revision===readRevision.current)setBusy(false);}
 },[]);
 useEffect(()=>{alive.current=true;void refresh();return()=>{alive.current=false;readRevision.current++;};},[refresh]);
 const showDiagnostics=()=>setDialog('diagnostics');
 const checkDiagnosticAI=()=>{
  if(diagnosticPending.current)return diagnosticPending.current;
  setAiChecking(true);
  const pending=diagnosticCheck.current().then(value=>{if(alive.current)setDiagnosticAi(value);}).finally(()=>{
   if(diagnosticPending.current===pending)diagnosticPending.current=null;
   if(alive.current)setAiChecking(false);
  });
  diagnosticPending.current=pending;return pending;
 };
 const diagnostics=createSystemDiagnosticSnapshot({appVersion:APP_VERSION,modelStatus:modelReadFailed?{...modelStatus,available:false}:modelStatus,
  caseData,stream,predictionState,currentPrediction,predictionBound,dirty,checked:historical.checked,industrialStatus,
  ai:latestDiagnosticAI(diagnosticAi,assistantStatus),statusCheckedAt:status?.checkedAt,predictionUpdatedAt});
 const checkAI=async()=>{
  setBusy(true);try{await callbacks.current.onRefreshAssistant({force:true});}catch{if(alive.current)setRefreshFailed(true);}finally{if(alive.current)setBusy(false);}
 };
 const readingState={label:readState==='READY'?'已读取':readState==='UNAVAILABLE'?UNAVAILABLE:READING,tone:readState==='READY'?'good':readState==='UNAVAILABLE'?'error':'idle'};
 const completeText=inputSummary?inputSummary.completeCount+' / '+inputSummary.total:READING;
 const latency=readState==='READY'?(status.lastLatencyMs!==null?status.lastLatencyMs+' ms':'尚无记录'):readState==='UNAVAILABLE'?UNAVAILABLE:READING;
 const checkState=caseData?check:{label:READING,tone:'idle'};
 const dataCardState=caseData&&stream?{label:'已载入',tone:'good'}:{label:READING,tone:'idle'};
 const inputCheckCardState={...checkState,label:checkState.status==='NORMAL'?'检查通过':checkState.label};
 return <section className="maintenance-workspace competition-system-status" aria-label="系统状态与维护">
  <header className="maint-page-heading"><div><h2>系统状态与维护</h2><p>模型、数据、AI服务与当前运行状态</p></div>
   <div><button type="button" className="maint-button" disabled={busy} onClick={()=>refresh(true)}><RefreshCw size={14}/>刷新状态</button></div>
  </header>
  {refreshFailed&&<div className="maint-error" role="alert">{UNAVAILABLE}<button type="button" onClick={()=>refresh(true)} disabled={busy}>刷新状态</button></div>}
  <div className="maint-panels-scroll"><div className="maint-panels-grid">
   <Panel kind="data" title="数据与工况" state={dataCardState}><dl>
    <Fact label="当前数据来源">{data.source}</Fact>{data.historyCount!==undefined&&<Fact label="工况记录">{data.historyCount} 条</Fact>}
    <Fact label="当前工况">{data.position?('第'+data.position+' / '+data.historyCount+'条'):caseData?readableConditionName(caseData.id):READING}</Fact>
   </dl><div className="maint-panel-actions">{onNavigate&&<button className="maint-button" onClick={()=>onNavigate('data')}>数据详情<ChevronRight size={14}/></button>}</div></Panel>
   <Panel kind="prediction" title="QCDKR预测模型" state={model}><p className="maint-panel-note">{MODEL_DESCRIPTION}</p><dl>
    <Fact label="模型用途">S5轧制力预测</Fact><Fact label="输入维度">{MODEL_INPUT_COUNT}维</Fact>
    <Fact label="模型校验" tone={modelStatus?.schema_status==='VERIFIED'?'good':'idle'}>{modelStatus?.schema_status==='VERIFIED'?'已验证':modelStatus?.schema_status?'待校验':model.label===UNAVAILABLE?UNAVAILABLE:READING}</Fact>
    <Fact label="最近预测处理">{latency}</Fact><Fact label="模型状态" tone={model.tone}>{model.label}</Fact>
   </dl><div className="maint-panel-actions"><button className="maint-button" disabled={!modelStatus?.model_version} onClick={()=>setDialog('model')}>模型信息</button><button className="maint-button" disabled={busy} onClick={()=>refresh(true)}>检查服务</button></div></Panel>
   <Panel kind="rules" title="智能调整方案" state={search}><dl>
    {config&&<><Fact label="调节动作">{config.actions.length}项</Fact><Fact label="关联模型输入">{config.fields.length}项</Fact><Fact label="候选配置">最多{config.totalCandidates}个</Fact><Fact label="最大联合调整">{config.maxChangedActions}项</Fact></>}
    <Fact label="当前搜索状态" tone={search.tone}>{search.label}</Fact><Fact label="最近搜索">{recentSearchDisplay(mostRecentCompletedSearch,searchState)}</Fact>
   </dl><div className="maint-panel-actions"><button className="maint-button" disabled={!config} onClick={()=>setDialog('search')}>查看搜索配置</button>{onOpenSolutions&&<button className="maint-button" onClick={onOpenSolutions}>进入方案<ChevronRight size={14}/></button>}</div></Panel>
   <Panel kind="rules" title="当前工况检查" state={inputCheckCardState}><dl>
    <Fact label="输入完整性" tone={inputSummary?.valid?'good':'notice'}>{inputSummary?completeText+'项完整':READING}</Fact>
    <Fact label="数据检查" tone={checkState.tone}>{checkState.label}</Fact><Fact label="当前预测" tone={predictionState==='READY'?'good':predictionState==='FAILED'?'error':'idle'}>{predictionLabels[predictionState]||READING}</Fact>
   </dl><div className="maint-panel-actions"><button className="maint-button" disabled={!historical.checked?.rows?.length} onClick={()=>setDialog('check')}>查看检查详情</button></div></Panel>
   <Panel kind="assistant" title="DK AI服务" state={ai}><dl>
    {safeStatusText(assistantStatus?.model)&&<Fact label="本地模型">{assistantStatus.model}</Fact>}
    <Fact label="服务状态" tone={ai.tone}>{ai.label}</Fact>{ai.load&&<Fact label="模型加载" tone={ai.tone}>{ai.load}</Fact>}
    <Fact label="响应延迟">{aiConnectionState(assistantStatus).latencyMs!==null?aiConnectionState(assistantStatus).latencyMs+' ms':'—'}</Fact>
   </dl>{ai.note&&<p className="maint-panel-note">{ai.note}</p>}<p className="maint-panel-note maint-capabilities">能力：工艺问答 / 辅助诊断 / 参数试算 / 方案解读</p>
   <div className="maint-panel-actions"><button className="maint-button" disabled={busy||!onRefreshAssistant} onClick={checkAI}>检查连接</button></div></Panel>
   <Panel kind="system" title="系统状态与维护" state={readingState}><dl>
    <Fact label="最近状态读取" title={localStatusStamp(status?.checkedAt)||undefined}>{status?localStatusTime(status.checkedAt):readingState.label}</Fact>
    <Fact label="模型服务" tone={model.tone}>{model.label}</Fact><Fact label="DK AI服务" tone={ai.tone}>{ai.label}</Fact>
   </dl><div className="maint-panel-actions"><button className="maint-button" disabled={busy} onClick={()=>refresh(true)}>刷新状态</button>{admin&&<button className="maint-button" disabled={busy} onClick={showDiagnostics}>查看详情</button>}</div></Panel>
  </div></div>
  <footer className="maint-page-foot"><span><ShieldCheck size={13}/>{user?.role==='LOCAL_ADMIN'?user.display_role:admin?'管理员':'操作员'} · 本机维护</span></footer>
  {dialog==='model'&&<OperationsDialog title="模型信息" onClose={()=>setDialog(null)}><dl>
   <Fact label="当前模型">{modelDisplayName(modelStatus?.model_version)}</Fact>
   <Fact label="模型介绍">{MODEL_DESCRIPTION}</Fact>
   <Fact label="模型状态">{modelStatus?.schema_status==='VERIFIED'&&model.tone==='good'?'已验证，可正常使用':model.label}</Fact>
   <Fact label="完整性检查">{modelStatus?.schema_status==='VERIFIED'?'通过':'待检查'}</Fact>
   <Fact label="运行检查">{modelStatus?.schema_status==='VERIFIED'&&model.tone==='good'?'通过':'待检查'}</Fact>
   </dl><p>{modelStatus?.schema_status==='VERIFIED'&&model.tone==='good'?'系统已完成模型文件完整性、运行环境和启动计算检查，当前模型可以正常用于S5轧制力预测。':'模型检查尚未全部通过，请以当前模型状态为准。'}</p>
   <details className="prediction-record-technical"><summary>查看技术信息</summary><dl>
    <Fact label="完整模型版本">{safeStatusText(modelStatus?.model_version)}</Fact>{/^[a-f0-9]{64}$/i.test(modelStatus?.model_hash||'')&&<Fact label="模型指纹"><code className="maint-fingerprint">{modelStatus.model_hash}</code></Fact>}<Fact label="校验算法">SHA-256</Fact><Fact label="模型校验">{modelStatus?.schema_status==='VERIFIED'?'已验证':'待校验'}</Fact>
   </dl><pre className="maint-json">{JSON.stringify(modelStatus,null,2)}</pre></details></OperationsDialog>}
  {dialog==='search'&&config&&<OperationsDialog title="搜索配置" onClose={()=>setDialog(null)}><dl>
   <Fact label="调节动作">{config.actions.map(action=>action.displayName).join('、')}</Fact><Fact label="关联模型输入">{config.fields.map(field=>field.label).join('、')}</Fact><Fact label="调节范围">{Math.min(...SEARCH_CONFIG.actionLevelsPercent)}%~{Math.max(...SEARCH_CONFIG.actionLevelsPercent)}%</Fact>
  </dl></OperationsDialog>}
  {dialog==='check'&&<OperationsDialog title="当前工况检查详情" onClose={()=>setDialog(null)}><dl><Fact label="输入完整度">{completeText}</Fact>
   {inputSummary?.issues.map(issue=><Fact key={issue.field} label={MODEL_FEATURES.find(field=>field.key===issue.field)?.label||'输入提示'}><UserVisibleText value={issue.message}/></Fact>)}</dl><HistoricalRangeDetails {...historical}/></OperationsDialog>}
  {dialog==='diagnostics'&&<OperationsDialog title="系统状态详情" data-system-diagnostics onClose={()=>setDialog(null)} footer={<button className="maint-button" onClick={()=>downloadOperationalFile('QCDKR-系统诊断.json',exportSystemDiagnosticSnapshot(diagnostics))}><Download size={14}/>导出状态详情</button>}>
   <p className="system-diagnostic-time">状态更新时间：{localStatusStamp(diagnostics.snapshotUpdatedAt)||'尚无状态记录'}</p>
   <section className="system-diagnostic-section" aria-label="核心预测"><h4>核心预测</h4><dl>
    <Fact label="QCDKR预测" tone={diagnostics.predictionStatus==='AVAILABLE'?'good':'notice'}>{diagnostics.predictionStatus==='AVAILABLE'?'✓ ':'○ '}{diagnostics.predictionStatusLabel}</Fact>
    <Fact label="模型">{diagnostics.modelName||'不可用'}</Fact><Fact label="当前输入">{diagnostics.inputStatus.readCount} / {diagnostics.inputStatus.total}</Fact><Fact label="当前预测">{diagnostics.currentPredictionStatus}</Fact>
   </dl></section>
   <section className="system-diagnostic-section" aria-label="工业数据"><h4>工业数据</h4><dl>
    <Fact label="数据状态">{diagnostics.dataStatusLabel}</Fact><Fact label="数据来源">{diagnostics.dataSource}</Fact>
    <Fact label="当前记录">{diagnostics.currentRecord??'—'} / {diagnostics.totalRecords}</Fact>
   </dl></section>
   <section className="system-diagnostic-section" aria-label="DK AI助手"><h4>DK AI助手</h4><dl>
    <Fact label="助手状态" tone={diagnostics.aiStatus==='AVAILABLE'?'good':diagnostics.aiStatus==='NOT_CHECKED'?'idle':'error'}>{diagnostics.aiStatus==='AVAILABLE'?'✓ ':diagnostics.aiStatus==='NOT_CHECKED'?'○ ':'✕ '}{diagnostics.aiStatusLabel}</Fact>
    {diagnostics.aiStatus!=='NOT_CHECKED'&&<>
     {diagnostics.aiModel&&<Fact label="AI模型">{diagnostics.aiModel}</Fact>}
     {diagnostics.aiLatencyMs!==null&&<Fact label="响应时间">{diagnostics.aiLatencyMs} ms</Fact>}
     {diagnostics.aiLastCheckedAt&&<Fact label="最近检查">{localStatusStamp(diagnostics.aiLastCheckedAt)}</Fact>}
     {diagnostics.aiFailureStage&&<Fact label="失败阶段">{diagnostics.aiFailureStage}</Fact>}
     {diagnostics.aiFailureReason&&<Fact label="失败原因">{diagnostics.aiFailureReason}</Fact>}
     {diagnostics.aiRecoveryAction&&<Fact label="建议">{diagnostics.aiRecoveryAction}</Fact>}
    </>}
   </dl><button type="button" className="maint-button" disabled={aiChecking} onClick={checkDiagnosticAI}>{aiChecking&&<Loader2 size={14} className="spin"/>}{aiChecking?'检查中…':diagnostics.aiStatus==='NOT_CHECKED'?'立即检查':'重新检查'}</button></section>
   <details className="prediction-record-technical system-diagnostic-technical"><summary>查看技术信息</summary><dl>
    <Fact label="应用版本">{diagnostics.appVersion||'不可用'}</Fact><Fact label="模型名称">{diagnostics.modelVersion||'不可用'}</Fact>
    <Fact label="模型Identity">{diagnostics.modelIdentity||'不可用'}</Fact><Fact label="模型Hash">{diagnostics.modelHash?diagnostics.modelHash.slice(0,8)+'…':'不可用'}</Fact>
    <Fact label="25维输入状态">已读取 {diagnostics.inputStatus.readCount} / {diagnostics.inputStatus.total}，有限有效数值 {diagnostics.inputStatus.validCount}</Fact>
    <Fact label="当前数据源">{diagnostics.dataSource}</Fact><Fact label="当前记录">{diagnostics.currentRecord??'—'} / {diagnostics.totalRecords}</Fact>
    <Fact label="AI Provider">{diagnostics.aiProvider||'未配置'}</Fact><Fact label="AI模型">{diagnostics.aiModel||'未配置'}</Fact>
    <Fact label="AI服务状态">{({CONNECTED:'已连接',DISCONNECTED:'未连接'})[diagnostics.aiServiceStatus]||'尚未检查'}</Fact>
    <Fact label="最小响应测试">{({PASS:'通过',FAIL:'未通过',RUNNING:'检查中',NOT_RUN:'尚未执行'})[diagnostics.aiResponseTest]}</Fact>
    <Fact label="最近AI检查">{localStatusStamp(diagnostics.aiLastCheckedAt)||'尚未检查'}</Fact><Fact label="AI响应耗时">{diagnostics.aiLatencyMs!==null?diagnostics.aiLatencyMs+' ms':'不可用'}</Fact>
    <Fact label="最近AI错误">{diagnostics.aiErrorSummary||'无'}</Fact>
   </dl></details>
  </OperationsDialog>}
 </section>;
}
