import { buildAssistantExperience } from './assistantTaskPolicy.js';
import { AVATAR_FIRST_REPORT_DELAY_MS, AVATAR_MIN_GAP_MS, AVATAR_SPEECH_VISIBLE_MS, eventSpeech, incidentFingerprint, incidentSpeech, taskSpeech } from './assistantSpeech.js';
import { useTaskRuntime, assertTaskApproval, assertTaskWriteBinding, sceneActionMatches, downloadTaskArtifact, TASK_TERMINAL } from './useTaskRuntime.js';
import { projectAssistantTask, receiptFromAgentRun } from './assistantTaskRuntime.js';
import { useAssistantActivity } from './useAssistantActivity.js';
import { currentPredictionErrorAlarm } from './s5PredictionErrorAlarm.js';
import UserVisibleText from './UserVisibleText.jsx';
import {createAssistantTurn,assistantTurnRequest,startAssistantTurn,assistantResponseUpdate,startAssistantFallback} from './assistantTurn.js';
import {isFactDiagnosticQuestion} from './assistantFacts.js';
import IndustrialConnectionWorkspace from './IndustrialConnectionWorkspace.jsx';
import { useIndustrialCommunication } from './useIndustrialCommunication.js';
import { readableConditionName, userVisibleText } from './userVisibleText.js';
import React, { useEffect, useRef, useState } from 'react';
import { PRODUCT_NAME } from './productBrand.js';
import { AlertTriangle, ArrowDownToLine, Bell, Check, CheckCircle2, ChevronDown, ChevronRight, Clock3, Cpu, Database, Download, FileBarChart2, FileText, Gauge, GitCompareArrows, History, Layers3, LayoutDashboard, Loader2, Maximize2, MessageSquare, Play, Plus, RotateCcw, Search, Send, ShieldCheck, SlidersHorizontal, Target, Trash2, Upload, Waves, X, Zap } from 'lucide-react';
import { formatEngineering, toDisplay, unitFor } from './engineeringUnits.js';
import {createReadinessRecovery,probeWorkspaceReadiness,requestWorkspaceJson,formalModelReady,recoveryProjection,selectRecoveryProjection,sameRecoveryProjection,dirtyTransientState,installWorkspaceRefresh,reloadWorkspaceRenderer,RECOVERY_CONNECTING,RECOVERY_UNAVAILABLE,RECOVERY_INPUT_CHANGED,REFRESH_CONFIRMATION} from './workspaceRecovery.js';
import { modelInputFingerprint, summarizeModelInputs } from './modelInputs.js';
import AgentTrace from './AgentTrace.jsx';
import { knowledgeDisplayText } from './knowledgeDisplay.js';
import { actualDisplayText, findingDisplayTitle } from './s5ActualDisplay.js';
import AgentComparison from './AgentComparison.jsx';
import AppShell, { applicationPages } from './AppShell.jsx';
import AssistantPanel from './AssistantPanel.jsx';
import MaintenanceWorkspace from './MaintenanceWorkspace.jsx';
import { LogsWorkspace } from './EventLogWorkspace.jsx';
import { DataWorkspace } from './DataReplayWorkspace.jsx';
import { DEFAULT_CASE, validateCase } from './domain.js';
import { createPredictionClient, createPredictionGate, requestPredictionJson } from './predictionClient.js';
import { buildReport, reportInputFingerprint, freezeReportPayload } from './reportData.js';
import { APP_VERSION } from './version.js';
import { resultSampleMetadata, withAcceptedObservation, withEditedSample, assistantSampleContext, assertPredictionBinding, verifyPredictionHashes, assertObservationBinding, predictionIdentity, sameIdentity, currentRunMatches, rejectPlanApplication } from './predictionSnapshot.js';
import { AssistantConversation, AssistantComposer } from './AssistantConversation.jsx';
import { exportJSON, exportCSV, exportWord, exportPowerPoint, downloadSingleConditionTemplate } from './exports.js';
import LiveWorkspace from './LiveWorkspace.jsx';
import FloatingAssistant from './FloatingAssistant.jsx';
import AssistantAvatar from './AssistantAvatar.jsx';
// 2026-11-14 恢复第一阶段接线：连续工艺分析面板为副驾驶默认入口（自 backups/panel-fix-20261113 移植）。
import ContinuousCopilotPanel from './ContinuousCopilotPanel.jsx';
import { ASSISTANT_MODE_LABELS, readAssistantMode, writeAssistantMode } from './assistantAccess.js';
import { readAssistantMessages, writeAssistantMessages } from './assistantMessages.js';
import AssistantSources, { AssistantReferences, uploadKnowledgeFile } from './AssistantSources.jsx';
import { useProcessStream } from './useProcessStream.js';
import { loadHistoricalReplay } from './historicalReplay.js';
import { loadSeededDemoReplay } from './seededDemo.js';
import { DEFAULT_INPUT_RANGE_TABLE as rangeTable } from './inputRangeDefaults.js';
import { OptimizationWorkspace, DraftWorkspace } from './OperationsPages.jsx';
import EvidenceReferences from './EvidenceReferences.jsx';
import { evidenceForIdentity } from './evidence.js';
 import { createDraft, validateDraftCandidate, validateDraftBaseline, acceptDraftPrediction, promotionRetry, promotedDraft, discardedDraft } from './draftState.js';
import { updateStandField, parseCaseFile } from './processState.js';
import CsvImportUnitDialog from './CsvImportUnitDialog.jsx';
import { assertCaseImportValid, validateCaseImport } from './caseImportBoundary.js';
import { isConversational } from './assistantLayout.js';
import { classifyAssistantIntent } from './assistantIntent.js';
import { isKnowledgeDetailFollowup, adjacentKnowledgeFollowup } from './coldRollingDomain.js';
import { readCustomLimits } from './historicalRangeCheck.js';
import {readTargetReference,changeTargetReference,targetReferenceProjection,targetReferenceMatches,targetReferenceMessage} from './targetReference.js';
import { classifyQuestionType, QUESTION_TYPE, BATCH2_QUESTION_TYPES, BATCH3_QUESTION_TYPES } from './questionType.js';
import { requestAiJson, isAiApiPath, openAiStream, AiTransportError, asAiTransportError, ownAiController, abortAiController } from './aiTransport.js';
export { getAiTransportTrace } from './aiTransport.js';
const engineering = (field,value,digits=3) => formatEngineering(field,value,digits);
// Display-state key using the existing registered Candidate snapshot identity.
import {candidateDisplaySource,candidateExplanationKey,mergeCandidateSources} from './candidatePresentation.js';
import {candidateABReady} from './candidatePresentation.js';
import {candidateSearchIdentity,sameSelectedPlanIdentity} from './candidatePrediction.js';
import {createSmartCandidateClient} from './smartCandidateClient.js';
import {SEARCH_MATCH_TOLERANCE_DEFAULT} from './smartCandidateConfig.js';
import {POLICY_LABELS,POLICY_WINNERS,createCandidatePolicyState,candidateQuickStatus} from './candidatePolicyState.js';
import { readPredictionErrorAlarmRange, writePredictionErrorAlarmRange, validatePredictionErrorAlarmRange, DEFAULT_PREDICTION_ERROR_ALARM_RANGE } from './predictionErrorAlarm.js';
import AiAnalysisWorkspace from './AiAnalysisWorkspace.jsx';
import { useAiAnalysis,useRetentionLease } from './useAiAnalysis.js';
import { aiAnalysisIntent,analysisDatasetIdentity } from './aiAnalysisIntent.js';
import {effectiveRangeProjection} from './effectiveRangeProjection.js';
import {createCandidateReviewClient} from './candidateReviewClient.js';
import {createCommittedPredictionScheduler,PREDICTION_STATUS_TEXT} from './committedPredictionScheduler.js';
import {rememberCompletedSearch} from './maintenanceStatusProjection.js';
import {pendingStreamPredictionDisplay} from './predictionDisplay.js';
const autoPredictionTrace=[];
export const getAutoPredictionTrace=()=>structuredClone(autoPredictionTrace);
const clone = (x) => structuredClone(x);
// A newly loaded record never restores an old/demo optimization target.
const newDashboardInput = input => {
 const next={...clone(input),target:null};
 if(input===DEFAULT_CASE){next.stands[4].force=null;next.stands[4].frontTension=null;
  next.importProvenance={source_type:'MANUAL',observed:null,observedAvailable:false,observedSource:'尚未提供 S5 实际值'};}
 const s5=next.stands.find(stand=>stand.id==='S5'),sample=next.importProvenance;
 s5.force??=null;s5.frontTension??=null;
 if(sample?.source_type!=='DEMO'&&typeof sample?.observedAvailable==='boolean')
  s5.force=sample.observedAvailable&&Number.isFinite(sample.observed)?sample.observed:null;
 return next;
};
const withoutObservation=input=>{const value=clone(input);delete value.importProvenance;const s5=value.stands?.find(stand=>stand.id==='S5');if(s5)delete s5.force;return value;};
const fmt = (n, d=1) => Number.isFinite(Number(n)) && n !== null ? Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}) : '—';
const pages = applicationPages;
const assistantUnavailable = 'AI 生成暂不可用，预测与输入检查仍可用。';
export function createAssistantStatusScheduler(refresh,{setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let timer=null,stopped=false,polling=false,scheduledFailureCount=0;
 const interval=()=>scheduledFailureCount>=4?30000:15000;
 const arm=()=>{if(!stopped){if(timer!==null)clearTimer(timer);timer=setTimer(tick,interval());}};
 const probe=async (scheduled,options)=>{
  const status=await refresh(options);if(stopped)return status;
  if(status?.providerStatus==='READY'||(!status?.providerStatus&&status?.available)){scheduledFailureCount=0;if(!scheduled&&!polling)arm();}
  else if(scheduled)scheduledFailureCount++;
  return status;
 };
 async function tick(){timer=null;polling=true;try{await probe(true);}finally{polling=false;arm();}}
 arm();
 return {refresh:options=>probe(false,options),state:()=>({scheduledFailureCount,intervalMs:interval()}),stop(){stopped=true;if(timer!==null)clearTimer(timer);timer=null;}};
}
const fields = [['entryThickness','入口厚度','mm',0.01],['exitThickness','出口厚度','mm',0.01],['force','轧制力','t',.001],['tension','后张力','t',1],['frontTension','前张力','t',1],['bendingForce','弯辊力','kN',1],['speed','轧制速度','m/min',0.1]];
async function api(path, options={}) {
 const {transport,...request}=options,url='/api'+path;
 if(isAiApiPath(url))try{return await requestAiJson(url,{headers:{'Content-Type':'application/json'},...request},transport);}
 catch(error){if(error.details?.http_status===401)window.dispatchEvent(new Event('dkqkar-session-expired'));throw error;}
 if(path==='/predict')try{
  const headers=new Headers(request.headers);
  if(!headers.has('Content-Type'))headers.set('Content-Type','application/json');
  return await requestPredictionJson(url,{...request,headers});
 }
 catch(error){if(error.details?.http_status===401)window.dispatchEvent(new Event('dkqkar-session-expired'));throw error;}
 const r=await fetch(url,{headers:{'Content-Type':'application/json'},...request}),d=JSON.parse(await r.text());
 if(r.status===401)window.dispatchEvent(new Event('dkqkar-session-expired'));if(!r.ok)throw new Error(d.error||d.message||'请求失败');return d;
}
const localAiHealth=status=>status.providerStatus==='READY'?'UP':['SERVICE_OFFLINE','MODEL_MISSING','MODEL_ERROR','REQUEST_ERROR','OFFLINE','ERROR'].includes(status.providerStatus)?'DOWN':'UNKNOWN';
function Panel({title,subtitle,action,children,className=''}) {return <section className={'panel '+className}><div className="panel-heading"><div><h3>{title}</h3>{subtitle&&<span className="subtle">{subtitle}</span>}</div>{action}</div>{children}</section>}
function Badge({children,tone='cyan'}) {return <span className={'badge '+tone}>{children}</span>}
function Chart({data,large=false,selected,onSelect,mode='demo'}) {const pts=data.flatMap(d=>[d.actual,d.predicted]).filter(Number.isFinite); const min=Math.max(0,Math.min(...pts)*.84), max=Math.max(...pts)*1.12;const y=v=>160-(v-min)/(max-min||1)*124;const x=i=>48+i*94; const path=key=>data.map((d,i)=>Number.isFinite(d[key])?`${x(i)},${y(d[key])}`:null).filter(Boolean).join(' ');return <div className={'line-chart '+(large?'large':'')}><div className="chart-legend"><span><i className="legend-dot cyan"/>输入载荷 / t</span><span><i className="legend-dot orange"/>{mode==='formal'?'S5 模型预测':'S5 演示预测'}</span></div><svg viewBox="0 0 470 200" role="img" aria-label="五机架载荷曲线，输入载荷与S5预测">{[0,1,2,3].map(i=><g key={i}><line x1="43" y1={36+i*41} x2="437" y2={36+i*41} className="grid-line"/><text x="35" y={40+i*41} textAnchor="end">{fmt(toDisplay('force',max-(max-min)*i/3),2)}</text></g>)}<polyline points={path('actual')} fill="none" stroke="#47d9ef" strokeWidth="2.5"/>{data.map((d,i)=><g key={d.stand} onClick={()=>onSelect?.(d.stand)} style={{cursor:onSelect?'pointer':'default'}} role={onSelect?'button':undefined} tabIndex={onSelect?0:undefined} aria-label={`${d.stand} 载荷 ${engineering('force',d.actual??d.predicted)}`} onKeyDown={e=>{if(onSelect&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onSelect(d.stand);}}}><title>{d.stand} 输入载荷：{engineering('force',d.actual)}；预测：{engineering('force',d.predicted)}。点击选择机架。</title><rect x={x(i)-30} y="25" width="60" height="145" fill={selected===d.stand?'#739cb714':'transparent'}/><text x={x(i)} y="188" textAnchor="middle">{d.stand}</text>{Number.isFinite(d.actual)&&<circle cx={x(i)} cy={y(d.actual)} r="4" fill="#47d9ef"/>}{Number.isFinite(d.predicted)&&<><circle cx={x(i)} cy={y(d.predicted)} r="6" fill="#ffab6f"/><text x={x(i)-4} y={y(d.predicted)-13} textAnchor="end" className="chart-value">{engineering('force',d.predicted)}</text></>}</g>)}</svg></div>}
function ConsoleClock(){const [now,setNow]=useState(new Date());useEffect(()=>{const id=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(id)},[]);return <time className="console-clock">{now.toLocaleDateString('zh-CN').replaceAll('/','-')}　{now.toLocaleTimeString('zh-CN',{hour12:false})}</time>}
export function currentDiagnosticsFor({result,observation,resultCase,currentBinding,auditBundle,dirty,operation_scope}){
 const empty={evidence:[],findings:[]};
 const identity={...predictionIdentity(result,observation),contextFingerprint:reportInputFingerprint(resultCase),operation_scope};
 if(dirty||!currentRunMatches(identity,currentBinding))return {...empty,status:'WAITING'};
 if(result.mode==='demo')return {...empty,status:'DEMO'};
 if(result.mode!=='formal')return {...empty,status:'WAITING'};
 if(auditBundle.status==='PENDING')return {...empty,status:'PENDING'};
 if(auditBundle.status!=='VALID')return {...empty,status:'UNAVAILABLE'};
 return {...evidenceForIdentity(auditBundle,result,observation),identity,binding:{...currentBinding}};
}
export function containDialogFocus(dialog) {
 const doc=dialog.ownerDocument,trigger=doc.activeElement,backdrop=dialog.closest('.modal-backdrop');
 const background=Array.from(backdrop.parentElement.children).filter(element=>element!==backdrop).map(element=>({element,inert:element.inert}));
 for(const {element} of background)element.inert=true;
 const controls=()=>Array.from(dialog.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')).filter(element=>element.getClientRects().length&&!element.closest('[inert]'));
 const focusFirst=()=>{(controls()[0]||dialog).focus({preventScroll:true});};
 const keydown=event=>{
  if(event.key!=='Tab')return;
  const items=controls(),first=items[0],last=items.at(-1);
  if(!first){event.preventDefault();dialog.focus();return;}
  if(event.shiftKey&&(doc.activeElement===first||!dialog.contains(doc.activeElement))){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&(doc.activeElement===last||!dialog.contains(doc.activeElement))){event.preventDefault();first.focus();}
 };
 const focusin=event=>{if(!dialog.contains(event.target))focusFirst();};
 doc.addEventListener('keydown',keydown,true);doc.addEventListener('focusin',focusin,true);focusFirst();
 return ()=>{doc.removeEventListener('keydown',keydown,true);doc.removeEventListener('focusin',focusin,true);for(const {element,inert} of background)element.inert=inert;if(trigger?.isConnected)trigger.focus({preventScroll:true});};
}
function App({ user, onLogout }){
 const [taskImportRequest,setTaskImportRequest]=useState(null),taskImportOwner=useRef(null),knowledgeFileRef=useRef(null);
 const [importUnitRequest,setImportUnitRequest]=useState(null),importUnitResolver=useRef(null);
 const chooseImportUnits=inspection=>new Promise(resolve=>{importUnitResolver.current?.(null);importUnitResolver.current=resolve;setImportUnitRequest(inspection);});
 const finishImportUnits=unit=>{const resolve=importUnitResolver.current;importUnitResolver.current=null;setImportUnitRequest(null);resolve?.(unit);};
 useEffect(()=>()=>{importUnitResolver.current?.(null);importUnitResolver.current=null;},[]);
 const [actionPanel,setActionPanel]=useState(null),[runState,setRunState]=useState('');
 const [predictionPending,setPredictionPending]=useState(false);
 const [predictionState,setPredictionState]=useState('STALE');
 const [committedSnapshot,setCommittedSnapshot]=useState(null);
 const autoScheduler=useRef(null),autoHandlers=useRef(null),committedInput=useRef(null),scheduledCommit=useRef(null),pendingPrepared=useRef(null);
 const [recoveryPhase,setRecoveryPhase]=useState('IDLE'),[refreshing,setRefreshing]=useState(false),[refreshConfirmation,setRefreshConfirmation]=useState(false);
 const readinessRecovery=useRef(null),recoveryHandlers=useRef(null),refreshHandler=useRef(null),sessionLoad=useRef(null),manualRefresh=useRef(false),recoveryPrediction=useRef(false);
 const unsavedEdits=useRef({parameterEdits:false,dataEdits:false});
 const parameterEditors=useRef({matrix:false,target:false});
 useEffect(()=>{if(!actionPanel)return;const dialog=document.querySelector('.action-panel[role="dialog"]');if(dialog)return containDialogFocus(dialog);},[Boolean(actionPanel)]);
 const agentRequest=useRef(null),activeRun=useRef(null),previousAssistantInput=useRef(null),knowledgeUiRevision=useRef(0);
 const [selectedEvent,setSelectedEvent]=useState(null),[comparisonView,setComparisonView]=useState(null);
 const [page,setPageState]=useState('data'), [pin,setPin]=useState(null), [caseData,setCase]=useState(()=>newDashboardInput(DEFAULT_CASE)), [completed,setCompleted]=useState(()=>({result:{value:null,target:null,deviation:null,drivers:[],curve:[],interval:[],mode:'pending',explanation:'正在连接预测服务'},caseData:newDashboardInput(DEFAULT_CASE),sample:resultSampleMetadata({mode:'demo',time:Date.now()}),activeSnapshot:null,observation:null})),[dirty,setDirty]=useState(true);
 const predictionStateRef=useRef(predictionState);predictionStateRef.current=predictionState;
 const dirtyRef=useRef(dirty);dirtyRef.current=dirty;
 const {result,caseData:resultCase,sample:resultSample,activeSnapshot,observation}=completed;
 const completedRef=useRef(completed);completedRef.current=completed;
 const [targetReference,setTargetReference]=useState(()=>readTargetReference(window.localStorage));
 const targetReferenceRef=useRef(targetReference);targetReferenceRef.current=targetReference;
 const currentTargetReference=targetReferenceProjection(dirty?null:result.value,caseData.importProvenance?.target_source==='USER_INPUT'?caseData.target:null,targetReference,result.snapshot_id);
 const onTargetReferenceChange=(source,value)=>{
  let next;try{next=changeTargetReference(targetReferenceRef.current,source,value,window.localStorage);}catch{notify('目标参考值未保存，请检查本地设置存储。');return false;}
  if(!next)return false;
  targetReferenceRef.current=next;setTargetReference(next);return true;
 };
 const coherentProjection=useRef(null),pausedProjection=useRef(false),pauseRebind=useRef(null);
 const setResult=fn=>setCompleted(previous=>({...previous,result:typeof fn==='function'?fn(previous.result):fn}));
 const [operationSessionId,setOperationSessionId]=useState(null);const operationSession=useRef(null),currentBinding=useRef({valid:false}),observationGate=useRef(createPredictionGate()),exportGate=useRef(createPredictionGate());
 const [dataTab,setDataTab]=useState('current');
 const setPage=next=>{knowledgeUiRevision.current+=1;if(next==='optimize')streamRef.current?.pause({temporary:true});if(next==='optimize')setOptimizationTask(task=>task||{targetValueT:currentCaseRef.current.importProvenance?.target_source==='USER_INPUT'&&Number.isFinite(currentCaseRef.current.target)&&currentCaseRef.current.target>0?currentCaseRef.current.target:null,searchMatchTolerance:SEARCH_MATCH_TOLERANCE_DEFAULT});if(next==='optimize'||next==='draft'||next==='reports'){setActionPanel(next==='reports'?'report':'trial');return;}if(next==='saved-data')setDataTab('saved');const target=next==='saved-data'?'data':['events','history','replay','input','prediction','three'].includes(next)?'overview':next;/* 孪生舞台双侧环绕：左=数据/维护，右=连接/日志；再点当前面板=收起（另一侧面板顶替为主面板） */if(STAGE_SIDES[target]){if(page===target){if(pin){setPageState(pin);setPin(null);}else setPageState('overview');return;}if(pin===target){setPin(null);return;}if(page==='overview'){setPageState(target);setPin(null);return;}setPageState(target);setPin(null);return;}if(target==='overview'){setPageState('overview');setPin(null);return;}setPageState(target);};
 // 值守技术员的可执行动作落到页面状态；L3 永远到不了这里（后端已拦截）。
 useEffect(()=>{const handler=event=>{const action=event.detail||{},target=action.params?.page;
   if(action.tool==='ui.switch_page'&&target)setPage(target);
   else if(action.tool==='ui.focus'){setSelected(action.params?.stand||'S5');setPage('overview');}
   else if(action.tool==='report.export')setActionPanel('report');
 };window.addEventListener('qcdkr:technician-action',handler);return()=>window.removeEventListener('qcdkr:technician-action',handler);},[page,pin]);
 // 3D 场景「运行日志终端」看板：轮询真实运行日志并推送（qcdkr:log-feed），
 // 屏上永远显示系统里真实存在的记录，失败时保留上次内容。
 useEffect(()=>{let busy=false;const push=async()=>{if(busy)return;busy=true;try{const result=await api('/logs?limit=4&offset=0');const items=Array.isArray(result?.items)?result.items.slice(0,4):[];const rows=items.map(item=>{const time=new Date(item.createdAt);const raw=String(item.title||item.message||'').replace(/\s+/g,' ').trim();const level=String(item.level||item.severity||'info').toLowerCase();return {time:Number.isFinite(time.getTime())?time.toLocaleTimeString('zh-CN',{hour12:false}):'--:--:--',text:raw.length>15?raw.slice(0,14)+'…':(raw||'运行记录'),state:({error:'告警',critical:'告警',warning:'预警',success:'完成'})[level]||'信息'};});window.dispatchEvent(new CustomEvent('qcdkr:log-feed',{detail:{rows,total:Number.isSafeInteger(result?.total)?result.total:rows.length}}));}catch{/* 看板保持上次内容 */}finally{busy=false;}};
  void push();const timer=setInterval(()=>void push(),8000);return()=>clearInterval(timer);},[]);
 const [agentReference,setAgentReference]=useState('__baseline__');
 const [sessionKey,setSessionKey]=useState(0),[predictionEpoch,setPredictionEpoch]=useState(0);
 // Conversation-only eligibility; never part of a snapshot or model request.
 useEffect(()=>{knowledgeUiRevision.current+=1;},[actionPanel,sessionKey]);
 const autoDemoStarted=useRef(false),pendingRetry=useRef(null),lastRequestRevision=useRef(-1),copilotTaskActive=useRef(false),taskResumeAfter=useRef(false);
 const historicalReplayLoad=useRef(null);
 const [searchState,setSearchState]=useState({status:'IDLE'}),smartSearchClient=useRef(null);
 const [mostRecentCompletedSearch,setMostRecentCompletedSearch]=useState(null);
 useEffect(()=>{setMostRecentCompletedSearch(previous=>rememberCompletedSearch(previous,searchState));},[searchState]);
 const activeSearchRunId=useRef(null),searchStateRef=useRef(searchState);searchStateRef.current=searchState;
 if(!smartSearchClient.current)smartSearchClient.current=createSmartCandidateClient(api);
 useEffect(()=>()=>smartSearchClient.current?.cancel('STALE'),[]);
 useEffect(()=>()=>{historicalReplayLoad.current?.controller.abort();historicalReplayLoad.current=null;},[]);
 const currentCaseRef=useRef(caseData);currentCaseRef.current=caseData;
 const modelKey=modelInputFingerprint(caseData);
 const [selected,setSelected]=useState('S5'),[view,setView]=useState('perspective'),[explode,setExplode]=useState(false),[showStrip,setShowStrip]=useState(true);
 const [appSessionId,setAppSessionId]=useState(null),[reportSnapshot,setReportSnapshot]=useState(null);
 const [assistantOpen,setAssistantOpen]=useState(false),[assistantSourcesOpen,setAssistantSourcesOpen]=useState(false);
 const [assistantUi,setAssistantUi]=useState('continuous');
 const [assistantMode,setAssistantMode]=useState(()=>readAssistantMode());
 // 助手就是副驾驶本人：它有自己的嘴（气泡）和声音（TTS），这里只管排队、去重和冷却。
 const [avatarSpeech,setAvatarSpeech]=useState(null);
 const avatarSpeechRef=useRef({at:0,key:'',seq:0,pending:null,pendingKey:'',pendingTimer:null}),avatarSpeechTimer=useRef(null),avatarVoiceRef=useRef(null);
 const avatarSayNow=(line,key,options)=>{
  const state=avatarSpeechRef.current;
  state.at=Date.now();state.key=key;state.seq+=1;
  setAvatarSpeech({id:state.seq,text:line});
  if(avatarSpeechTimer.current)clearTimeout(avatarSpeechTimer.current);
  avatarSpeechTimer.current=setTimeout(()=>setAvatarSpeech(null),AVATAR_SPEECH_VISIBLE_MS);
  if(options.voice!==false)avatarVoiceRef.current?.(line);
  return true;
 };
 const avatarSay=(text,key='',options={})=>{
  const line=String(text||'').trim();
  if(!line)return false;
  const state=avatarSpeechRef.current,now=Date.now();
  if(key&&(key===state.key||key===state.pendingKey))return false;
  // 冷却期内不丢话：排队，等够最小间隔再说（否则事件刚播完，紧接着的告警就永远说不出来）
  const wait=AVATAR_MIN_GAP_MS-(now-state.at);
  if(state.at&&wait>0){
   state.pending={line,key,options};state.pendingKey=key;
   if(state.pendingTimer)clearTimeout(state.pendingTimer);
   state.pendingTimer=setTimeout(()=>{
    const item=state.pending;state.pending=null;state.pendingKey='';state.pendingTimer=null;
    if(item)avatarSayNow(item.line,item.key,item.options);
   },wait);
   return true;
  }
  return avatarSayNow(line,key,options);
 };
 const voiceState={phase:'idle',wakeEnabled:false,following:false};
 const [lastTaskChange,setLastTaskChange]=useState(null);
 const [pendingPlan,setPendingPlan]=useState(null),[appliedPlan,setAppliedPlan]=useState(null);
 const [workingDraft,setWorkingDraft]=useState(null),draftRef=useRef(null),draftPredictionGate=useRef(createPredictionGate()),draftPromotion=useRef(null);
 const [draftDisplaySelection,setDraftDisplaySelection]=useState(null);
 const writeDraft=value=>{draftRef.current=value;setWorkingDraft(value);};
 const [auditBundle,setAuditBundle]=useState({status:'PENDING',evidence:[],findings:[]}),[draftAudit,setDraftAudit]=useState({status:'PENDING',evidence:[],findings:[]});
 const auditRequest=useRef(null),auditIdentity=useRef(null);
 useEffect(()=>{
  if(result?.mode!=='formal'||!activeSnapshot)return;
  const controller=ownAiController(new AbortController(),'EVIDENCE'),identity=predictionIdentity(result,observation),contextFingerprint=reportInputFingerprint(resultCase),request={controller,identity};
  auditRequest.current=request;auditIdentity.current=identity;setAuditBundle({status:'PENDING',evidence:[],findings:[]});
  // Pause freezes the accepted prediction, not its evidence verification.
  // A completion may only fill the same accepted snapshot/observation/context.
  const current=()=>!controller.signal.aborted&&auditRequest.current===request&&sameIdentity(identity,predictionIdentity(completedRef.current.result,completedRef.current.observation))&&contextFingerprint===reportInputFingerprint(completedRef.current.caseData);
  const settle=bundle=>{if(!current())return;if(sameIdentity(identity,coherentProjection.current?.binding))coherentProjection.current={...coherentProjection.current,audit:bundle};setAuditBundle(bundle);};
  api('/evidence/resolve',{method:'POST',signal:controller.signal,body:JSON.stringify({prediction:result,observation,operation_scope:currentBinding.current.operation_scope})}).then(bundle=>{
   if(!current())return;
   const filtered=evidenceForIdentity(bundle,result,observation);
   if(bundle.status==='VALID'&&(bundle.evidence?.length||bundle.findings?.length)&&(!filtered.evidence.some(item=>item.type==='PREDICTION')||!filtered.evidence.some(item=>item.type==='OBSERVATION')))return;
   settle(bundle);
  }).catch(()=>settle({status:'UNAVAILABLE',evidence:[],findings:[]}));
  return()=>{abortAiController(controller,'EVIDENCE_IDENTITY_SUPERSEDED_OR_UNMOUNT');if(auditRequest.current===request)auditRequest.current=null;};
 },[result?.snapshot_id,observation?.observation_id]);
 useEffect(()=>{
  if(!workingDraft?.prediction||!['PREDICTED','PROMOTED'].includes(workingDraft.status))return;
  const controller=ownAiController(new AbortController(),'DRAFT_EVIDENCE');
  api('/evidence/draft-comparison',{method:'POST',signal:controller.signal,body:JSON.stringify({baseline:workingDraft.baseline_prediction,prediction:workingDraft.prediction,candidate_preview_snapshot_id:workingDraft.candidate_preview_snapshot_id,source_plan_id:workingDraft.source_plan_id})}).then(bundle=>{if(!controller.signal.aborted)setDraftAudit(bundle);}).catch(()=>{if(!controller.signal.aborted)setDraftAudit({status:'UNAVAILABLE',evidence:[],findings:[]});});
  return()=>abortAiController(controller,'DRAFT_EVIDENCE_IDENTITY_SUPERSEDED_OR_UNMOUNT');
 },[workingDraft?.prediction?.snapshot_id]);

 const [cases,setCases]=useState([]),[plans,setPlans]=useState([]),[busy,setBusy]=useState(''),[toast,setToast]=useState(''),[errors,setErrors]=useState([]),[search,setSearch]=useState(''),[compare,setCompare]=useState([]);
 const [toastType,setToastType]=useState('SUCCESS');
 const plansRef=useRef(plans);plansRef.current=plans;
 const [explanationByCandidateIdentity,setExplanationByCandidateIdentity]=useState({});
 const [selectedCandidateIdentity,setSelectedCandidateIdentity]=useState(null);
 const candidateExplanationRequest=useRef(null),selectedCandidateExplanation=useRef(null);
 const smartReviewClient=useRef(null),[candidateReviewBusy,setCandidateReviewBusy]=useState(false);
 if(!smartReviewClient.current)smartReviewClient.current=createCandidateReviewClient(api);
 useEffect(()=>()=>smartReviewClient.current?.cancel('UNMOUNT'),[]);
 useEffect(()=>{if(actionPanel!=='trial')smartReviewClient.current.cancel('PANEL_CLOSED');},[actionPanel]);
 useEffect(()=>{
  const referenceIdentity=currentTargetReference.reference_identity;
  if(smartReviewClient.current.identity()?.reference_identity!==referenceIdentity)smartReviewClient.current.cancel('STALE_REFERENCE');
  setExplanationByCandidateIdentity(values=>{
   let changed=false;const next={...values};
   for(const [key,value] of Object.entries(values))if(value.target_reference_identity&&value.target_reference_identity!==referenceIdentity){
    next[key]={...value,status:'stale_reference',reason:'STALE_REFERENCE'};changed=true;
   }
   return changed?next:values;
  });
 },[currentTargetReference.reference_identity]);
 const trialConfirmation=useRef(null),[trialConfirming,setTrialConfirming]=useState(false);
 const explicitTrialEntry=useRef(false);
 useEffect(()=>{if(!assistantOpen||page!=='overview')explicitTrialEntry.current=false;},[assistantOpen,page]);
 const messageOwner=user?.id||user?.username||'local';
 const [messages,setMessages]=useState(()=>readAssistantMessages(messageOwner)),[question,setQuestion]=useState(''),[chatBusy,setChatBusy]=useState(false),[assistantStatus,setAssistantStatus]=useState({configured:false,mode:'local',model:''}),[serverOK,setServerOK]=useState(false);
 useEffect(()=>{writeAssistantMessages(messageOwner,messages);},[messageOwner,messages]);
 const assistantTurnActive=useRef(null);
 const assistantActivity=useAssistantActivity(user?.id||user?.username||'local');
 const assistantStatusRef=useRef(assistantStatus),assistantStatusScheduler=useRef(null),assistantStatusRevision=useRef(0),assistantMounted=useRef(true),assistantCheckPending=useRef(null);assistantStatusRef.current=assistantStatus;
 const fetchAssistantStatus=({force=false}={})=>{
  if(assistantCheckPending.current)return assistantCheckPending.current;
  const check=(async()=>{
  const revision=++assistantStatusRevision.current;let status;
  if(force){const checking={...assistantStatusRef.current,available:false,providerStatus:'STARTING',latencyMs:null};assistantStatusRef.current=checking;setAssistantStatus(checking);}
  try{status=await api('/assistant/status'+(force?'?check=1':''),{transport:{kind:'LOCAL_AI_HEALTH',health:localAiHealth(assistantStatusRef.current)}});}
  catch(error){status={...assistantStatusRef.current,available:false,providerStatus:'UNKNOWN',latencyMs:null,loadStatus:'UNKNOWN',healthTransportError:error.code,reason:'AI 连接状态尚未核实。'};}
  if(!assistantMounted.current||revision!==assistantStatusRevision.current)return assistantStatusRef.current;
  assistantStatusRef.current=status;setAssistantStatus(status);return status;
  })();
  if(force){assistantCheckPending.current=check;void check.finally(()=>{if(assistantCheckPending.current===check)assistantCheckPending.current=null;});}
  return check;
 };
 const refreshAssistantStatus=options=>assistantStatusScheduler.current?.refresh(options)||fetchAssistantStatus(options);
 const busyOwner=useRef(0),busyLabel=useRef('');const beginBusy=label=>{const owner=++busyOwner.current;busyLabel.current=label;setBusy(label);return owner;};const finishBusy=owner=>{if(owner===busyOwner.current){busyLabel.current='';setBusy('');}};
 const [reportSections,setReportSections]=useState(['工况信息','预测结果','工艺解释','三维模型','优化方案']);
 const fileRef=useRef(),sceneControlsRef=useRef(null),predictionGate=useRef(createPredictionGate()),predictionClient=useRef(createPredictionClient(api)),pendingFrame=useRef(null),inputRevision=useRef(0),defaultInput=useRef(newDashboardInput(DEFAULT_CASE));
 const [modelStatus,setModelStatus]=useState({available:false,status:'CONNECTING',reason:'正在连接预测服务'});
 const modelStatusRef=useRef(modelStatus);modelStatusRef.current=modelStatus;
 if(!autoScheduler.current)autoScheduler.current=createCommittedPredictionScheduler({
  execute:(...args)=>autoHandlers.current.execute(...args),accept:(...args)=>autoHandlers.current.accept(...args),
  onState:(...args)=>autoHandlers.current.state(...args),
  onTrace:event=>{autoPredictionTrace.push(event);if(autoPredictionTrace.length>200)autoPredictionTrace.shift();},
 });
 useEffect(()=>()=>autoScheduler.current.stop(),[]);
 useEffect(()=>{
  const identity=searchStateRef.current.identity;
  if(identity&&modelStatus.model_hash&&(identity.model_hash!==modelStatus.model_hash
    ||modelStatus.model_version&&identity.model_version!==modelStatus.model_version)){
   activeSearchRunId.current=null;smartSearchClient.current.cancel('STALE');smartReviewClient.current.cancel('STALE');
   setSearchState({status:'STALE',message:'工况已变化，请重新搜索。'});
  }
 },[modelStatus.model_hash,modelStatus.model_version]);
 const operationScope=()=>({session_id:operationSession.current,revision:inputRevision.current});
 const readActiveProjection=()=>{
  const input=clone(currentCaseRef.current),accepted=completedRef.current;let coherent=false;
  try{assertPredictionBinding(accepted.result,input,{input_snapshot:accepted.activeSnapshot,mode:'formal'});coherent=true;}catch{}
  return recoveryProjection({input,...(coherent?{prediction:accepted.result,input_snapshot:accepted.activeSnapshot,observation:accepted.observation}:{}),operation_scope:operationScope()});
 };
 const ensureWorkspaceSession=()=>{
  if(operationSession.current)return Promise.resolve();
  if(!sessionLoad.current)sessionLoad.current=requestWorkspaceJson('/session').then(data=>{
   if(!data.app_session_id||!data.operation_session_id)throw new Error(RECOVERY_UNAVAILABLE);
   operationSession.current=data.operation_session_id;setAppSessionId(data.app_session_id);setOperationSessionId(data.operation_session_id);
  }).finally(()=>{sessionLoad.current=null;});
  return sessionLoad.current;
 };
const invalidatePrediction=({observationOnly=false,promotingDraftId=null,streamAdvance=false}={})=>{activeSearchRunId.current=null;smartReviewClient.current?.cancel('STALE');smartSearchClient.current?.cancel('STALE');setSearchState(previous=>['IDLE','STALE'].includes(previous.status)?previous:{status:'STALE',message:'工况、目标或模型已变化，请重新搜索。'});if(!streamAdvance){recoveryPrediction.current=false;knowledgeUiRevision.current+=1;coherentProjection.current=null;pausedProjection.current=false;}inputRevision.current+=1;autoScheduler.current.invalidate();committedInput.current=null;pendingPrepared.current=null;setCommittedSnapshot(null);predictionGate.current.invalidate();setPredictionState('STALE');setPredictionPending(false);observationGate.current.invalidate();pendingRetry.current=null;currentBinding.current={...currentBinding.current,valid:false,kind:'new'};setDirty(true);
  const draft=draftRef.current;if(!observationOnly&&draft&&draft.draft_id!==promotingDraftId&&!['PROMOTED','DISCARDED','BASELINE_STALE'].includes(draft.status)){draftPredictionGate.current.invalidate();writeDraft(freezeReportPayload({...draft,status:'BASELINE_STALE'}));}
  if(draftPromotion.current&&!promotingDraftId){finishBusy(draftPromotion.current.owner);draftPromotion.current=null;}
  if(operationSession.current)api('/context/current',{method:'POST',body:JSON.stringify({operation_scope:operationScope()})}).catch(()=>{});};
 const diagnosticsRef=useRef(null),diagnosisRequest=useRef(null);
 const [diagnosingFindingId,setDiagnosingFindingId]=useState(null);
 const runIsCurrent=run=>currentRunMatches(run?.fact_packet&&!run.diagnostic_finding_id?{...run,answer_variant:undefined}:run,currentBinding.current,diagnosticsRef.current);
 const [autoStatus,setAutoStatus]=useState('连接中'),[lastUpdated,setLastUpdated]=useState(new Date());
 const pauseCurrentProjection=()=>{
  // Freeze progression at the current committed row. Its already scheduled
  // prediction/evidence may settle; pause never revokes that row's identity.
  pausedProjection.current=true;return null;
 };
 const stream=useProcessStream(newDashboardInput(DEFAULT_CASE),(frame,{resetProjection=false,datasetReplaced=false}={})=>{
 // A task owns the current context until it reaches a terminal state. Even a
 // late timer or replay toggle must not replace the row the user is approving.
 if(copilotTaskActive.current)return;
 if(datasetReplaced){
  historicalReplayLoad.current?.controller.abort();historicalReplayLoad.current=null;
  policyOwner.current.clear();activeSearchRunId.current=null;smartReviewClient.current.cancel('STALE');
  draftPredictionGate.current.invalidate();writeDraft(null);setDraftDisplaySelection(null);setDraftAudit({status:'PENDING',evidence:[],findings:[]});
  setPendingPlan(null);setAppliedPlan(null);setOptimizationTask(null);setWorkbenchViewMode('CURRENT');setSearchState({status:'IDLE'});
  setAuditBundle({status:'PENDING',evidence:[],findings:[]});diagnosticsRef.current=null;
  abortAiController(auditRequest.current?.controller,'DATA_SOURCE_CHANGED');auditRequest.current=null;auditIdentity.current=null;
  if(diagnosisRequest.current)abortAiController(diagnosisRequest.current.controller,'DATA_SOURCE_CHANGED');diagnosisRequest.current=null;
  trialConfirmation.current=null;abortAiController(agentRequest.current,'DATA_SOURCE_CHANGED');
  setMessages(items=>items.map(item=>({...item,historical:true})));setSessionKey(key=>key+1);
 }
 unsavedEdits.current={parameterEdits:false,dataEdits:false};recoveryPrediction.current=false;if(resetProjection)coherentProjection.current=null;pausedProjection.current=false;setPredictionEpoch(value=>value+1);invalidatePrediction({streamAdvance:true});pendingFrame.current=frame;
 const nextInput=clone(frame.input);
 const saved=frame.result||policyOwner.current?.baselineFor(frame);
 if(saved?.mode==='formal'&&saved.target===nextInput.target&&saved.model_hash===modelStatusRef.current.model_hash){
  try{assertPredictionBinding(saved,nextInput,{input_snapshot:saved.input_snapshot,mode:'formal'});pendingRetry.current={input_snapshot:saved.input_snapshot,prediction:saved,observation:saved.observation};}catch{}
 }
 currentCaseRef.current=nextInput;setCase(currentCaseRef.current);setDirty(true);setAutoStatus('自动计算中');setErrors([]);setPlans([]);},pauseCurrentProjection,()=>{pausedProjection.current=false;});
 const streamRef=useRef(stream);streamRef.current=stream;
 const industrialConnection=useIndustrialCommunication(api),industrialStatusRef=industrialConnection.latest;
 const plcInputReady=industrialConnection.status?.realtimeReady===true&&summarizeModelInputs(industrialConnection.status?.frame?.input).valid;
 const plcInputReadyRef=useRef(false);plcInputReadyRef.current=plcInputReady;
 const industrialDisplayConnection=industrialConnection;
 const acceptedPlcFrame=useRef(null),plcQualityRef=useRef(null);
 useEffect(()=>{
  const status=industrialConnection.status;if(!status)return;
  const sourceIsPlc=currentCaseRef.current.importProvenance?.source_type==='PLC_REALTIME';
  const quality=plcInputReady?'GOOD':status.quality==='GOOD'?'INVALID':status.quality;
  if(!plcInputReady){
   if(sourceIsPlc&&plcQualityRef.current!==quality){invalidatePrediction();streamRef.current.fail();setAutoStatus('实时工况已暂停，等待PLC恢复');setPredictionState('STALE');}
   plcQualityRef.current=quality;return;
  }
  plcQualityRef.current=status.quality;
  const frame=status.frame;
  if(!frame||acceptedPlcFrame.current===frame.frameId||predictionState==='PREDICTING'||!formalModelReady(modelStatusRef.current)||!operationSession.current||parameterEditors.current.matrix||unsavedEdits.current.parameterEdits||unsavedEdits.current.dataEdits)return;
  acceptedPlcFrame.current=frame.frameId;
  if(!sourceIsPlc){historicalReplayLoad.current?.controller.abort();historicalReplayLoad.current=null;setSessionKey(value=>value+1);setAppliedPlan(null);setWorkBenchModeForPlc();}
  const next=clone(frame);next.input.target=null;
  streamRef.current.realtime(next);
 },[industrialConnection.status,predictionState,modelStatus.available,operationSessionId,plcInputReady]);
 const setWorkBenchModeForPlc=()=>{setWorkbenchViewMode('CURRENT');setPendingPlan(null);setPlans([]);setMostRecentCompletedSearch(null);setSearchState({status:'IDLE'});};
 const [workbenchViewMode,setWorkbenchViewMode]=useState('CURRENT');
 const [optimizationTask,setOptimizationTask]=useState(null);
 const optimizationTaskRef=useRef(optimizationTask);optimizationTaskRef.current=optimizationTask;
 const [predictionErrorAlarmRange,setPredictionErrorAlarmRange]=useState(()=>{
  try{return readPredictionErrorAlarmRange(window.localStorage);}catch{return DEFAULT_PREDICTION_ERROR_ALARM_RANGE;}
 });
 const predictionContextIdentity=reportInputFingerprint({operation_scope:operationScope(),input_hash:result?.input_hash??null});
 const onPredictionErrorAlarmRangeChange=value=>{
  const next=validatePredictionErrorAlarmRange(value);
  if(next===null)return false;
  try{if(!writePredictionErrorAlarmRange(window.localStorage,next))return false;}catch{return false;}
  setPredictionErrorAlarmRange(next);
  return true;
 };
 useEffect(()=>{try{writePredictionErrorAlarmRange(window.localStorage,predictionErrorAlarmRange);}catch{}},[predictionErrorAlarmRange]);
 const aiAnalysis=useAiAnalysis(api);
 const [analysisPanel,setAnalysisPanel]=useState(null),[analysisContext,setAnalysisContext]=useState(null),[analysisChoice,setAnalysisChoice]=useState(null),[focusLogId,setFocusLogId]=useState(null);
 useRetentionLease(api,{type:'AI_ANSWER',analysisIds:analysisContext?[analysisContext.analysisId]:[],logIds:analysisContext?.sourceLogIds||[],enabled:Boolean(analysisContext)});
 const openAnalysisHistory=(id,filters={})=>setAnalysisPanel({id:typeof id==='string'?id:null,filters});
 const analysisSourceIdentity=analysisDatasetIdentity(caseData),analysisSourceKey=JSON.stringify(analysisSourceIdentity);
  useEffect(()=>{if(!operationSessionId)return;const scope=operationScope();let stopped=false;
   void api('/context/current',{method:'POST',body:JSON.stringify({operation_scope:scope})}).then(()=>{
    if(stopped)return;
    // Streaming predictions can advance the request revision while the
    // context invalidation is in flight; bind the source transition to the
    // revision that is current when it is actually sent.
    const latestScope=operationScope();
    return api('/ai-analysis/source',{method:'POST',body:JSON.stringify({
     identity:analysisSourceIdentity,predictionErrorAlarmRange,operation_scope:latestScope})});
  }).then(()=>{if(!stopped)void aiAnalysis.refresh();}).catch(()=>{});
  return()=>{stopped=true;};},[operationSessionId,analysisSourceKey]);
 const viewAnalysisLog=id=>{if(!id)return;setAnalysisPanel(null);setFocusLogId(id);setPage('logs');};
 const analyzeRecords=async(id=null,recent=false)=>{
  const value=await api('/ai-analysis/analyze',{method:'POST',body:JSON.stringify({analysisId:id,recent,predictionErrorAlarmRange})});
  setAnalysisPanel({id:value.analysisId});setAnalysisContext(value);void aiAnalysis.refresh();return value;
 };
 const [candidatePolicy,setCandidatePolicy]=useState({status:'NO_RUN',selectedPolicy:null,series:[]});
 const [constraintRevision,setConstraintRevision]=useState(0);
 const policyOwner=useRef(null),policySearchClient=useRef(null),maxReachabilityClient=useRef(null);
 if(!policySearchClient.current)policySearchClient.current=createSmartCandidateClient(api);
 if(!maxReachabilityClient.current)maxReachabilityClient.current=createSmartCandidateClient(api);
 if(!policyOwner.current)policyOwner.current=createCandidatePolicyState({onChange:setCandidatePolicy,
  cancelActive:reason=>{policySearchClient.current.cancel(reason);smartSearchClient.current.cancel(reason);},
  cancelReachability:reason=>maxReachabilityClient.current.cancel(reason),
  evaluateFrame:async(frame,config,current,onState)=>{
   const baseline=frame.result,input=clone(baseline?.inputContext||frame.input);
   if(!baseline||baseline.mode!=='formal'||!summarizeModelInputs(input).valid)throw Error('候选工况须绑定当前完整正式预测。');
   if(!current())throw Error('STALE_POLICY_FRAME');
   const client=config.executionPath==='MAX_REACHABILITY_SCAN'?maxReachabilityClient.current:config.executionPath==='BACKGROUND_PREFETCH'?policySearchClient.current:smartSearchClient.current;
   const run=await client.search({input,prediction:baseline,input_snapshot:baseline.input_snapshot,observation:frame.observation??baseline.observation,
    operation_scope:operationScope(),customLimits:config.customLimits,targetValueT:config.target,searchMatchTolerance:config.searchMatchTolerance,
    executionPath:config.executionPath,modelMetadata:config.modelMetadata,current,onState});
   return {run,baseline};
  }});
 const policyLimits=(()=>{try{return readCustomLimits(window.localStorage);}catch{return {};}})();
 const constraintVersion=reportInputFingerprint(effectiveRangeProjection(caseData,rangeTable,policyLimits).effectiveRanges
  .map(({parameter_id,effective_lower,effective_upper,lower_source,upper_source})=>({parameter_id,effective_lower,effective_upper,lower_source,upper_source})));
 const policyFrames=stream.frames.length?stream.frames.map((frame,index)=>index===stream.cursor?{...frame,result:!dirty?result:null,observation:!dirty?observation:null}:frame):[{input:caseData,result:!dirty?result:null,observation:!dirty?observation:null,time:0}];
 const policyFrameDependency=reportInputFingerprint(policyFrames.map(frame=>({input:frame.input,snapshot:frame.result?.snapshot_id,hash:frame.result?.input_hash,observation:frame.observation??frame.result?.observation})));
 useEffect(()=>{
  setWorkbenchViewMode('CURRENT');setPlans([]);
  setOptimizationTask(task=>task?{...task,targetValueT:caseData.importProvenance?.target_source==='USER_INPUT'&&Number.isFinite(caseData.target)&&caseData.target>0?caseData.target:null}:null);
  policyOwner.current.cancel('STALE');
 },[predictionContextIdentity]);
 useEffect(()=>{policyOwner.current.configure(policyFrames,stream.frames.length?stream.cursor:0,
  {target:optimizationTask ? optimizationTask.targetValueT??null : (caseData.importProvenance?.target_source==='USER_INPUT'?caseData.target:null),
   searchMatchTolerance:SEARCH_MATCH_TOLERANCE_DEFAULT,demo:!!stream.frames[0]?.seededDemo,idle:!busy&&!trialConfirmation.current,
   modelHash:modelStatus.model_hash,modelVersion:modelStatus.model_version,modelMetadata:modelStatus,sectionOpen:actionPanel==='trial',constraintVersion,customLimits:policyLimits},
  !dirty&&predictionState==='READY'&&currentBinding.current.valid&&modelStatus.available);},
  [policyFrameDependency,stream.cursor,optimizationTask,modelStatus,actionPanel,constraintVersion,constraintRevision,dirty,predictionState,busy]);
 useEffect(()=>()=>policyOwner.current.close(),[]);
 useEffect(()=>{
  const run=candidatePolicy.activeRun;
  if(run?.status==='COMPLETED'&&run.identity.baseline_snapshot_id===result.snapshot_id&&!dirty){
   activeSearchRunId.current=run.search_run_id;
   setPlans(items=>mergeCandidateSources(items,run.recommendations.map(plan=>({...plan,baselineInput:clone(caseData)})),'BUILT_IN_CANDIDATE_SEARCH'));
   setSearchState(run);
  }
 },[candidatePolicy.activeRun?.search_run_id,result.snapshot_id,dirty]);
 useEffect(()=>{
  api('/cases').then(setCases).catch(()=>{});
  const recovery=createReadinessRecovery({
   capture:()=>recoveryHandlers.current.capture(),
   probe:async options=>{const status=await probeWorkspaceReadiness(options);if(status.backendReady&&status.modelReady)await ensureWorkspaceSession();return status;},
   onReady:(status,selection,meta)=>recoveryHandlers.current.ready(status,selection,meta),
   onState:phase=>{setRecoveryPhase(phase);if(['CHECKING','FAST_RETRY','SLOW_POLL'].includes(phase)){setAutoStatus(RECOVERY_CONNECTING);setErrors([]);}else if(phase==='EXHAUSTED'){setServerOK(false);setModelStatus(previous=>({...previous,available:false,status:'BLOCKED',reason:RECOVERY_UNAVAILABLE}));setAutoStatus(RECOVERY_UNAVAILABLE);setErrors([RECOVERY_UNAVAILABLE]);}},
  });
  readinessRecovery.current=recovery;recovery.start({immediate:true});
  return()=>{recovery.stop();readinessRecovery.current=null;};
 },[]);
 useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(''),4500);return()=>clearTimeout(t);}},[toast]);
 useEffect(()=>{ensureWorkspaceSession().catch(()=>{setDirty(true);});},[]);
 useEffect(()=>{
  const escape=event=>{
   if(event.key!=='Escape'||event.defaultPrevented||event.isComposing)return;
   if(pendingPlan){event.preventDefault();event.stopImmediatePropagation();setPendingPlan(null);return;}
   if(actionPanel){event.preventDefault();event.stopImmediatePropagation();setActionPanel(null);return;}
   const voice=document.querySelector('.voice-popover .voice-close');
   if(voice?.getClientRects().length){event.preventDefault();event.stopImmediatePropagation();voice.click();}
  };
  window.addEventListener('keydown',escape,true);return()=>window.removeEventListener('keydown',escape,true);
 },[pendingPlan,actionPanel]);
 // 预测失败的真实原因要能落到界面上；只写“暂未完成”会让同类故障看起来永远修不好。
 const PREDICTION_FAILURE_TEXT=Object.freeze({
  STALE_COMMITTED_INPUT:'工况在预测途中发生变化，本次结果已作废，将按最新工况重算。',
  COMMITTED_SNAPSHOT_MODEL_MISMATCH:'输入快照与当前模型版本不一致，请重新预测。',
  INPUT_INCOMPLETE:'当前工况输入不完整，请补齐缺少的参数后再预测。',
  SNAPSHOT_INPUT_MISMATCH:'输入已编辑但预测快照未更新，请重新应用参数后再预测。',
  IDENTITY_MISMATCH:'输入或模型身份已变化，请重新预测当前工况。',
  PREDICT_TIMEOUT:'预测服务 25 秒未返回，已中止本次计算。',
 });
 const predictionFailureText=error=>{
  const code=String(error?.code||'');
  const message=typeof error?.message==='string'?error.message.trim():'';
  const key=code||message;
  const known=PREDICTION_FAILURE_TEXT[key];
  // 错误码只进控制台；界面说人话。注意 code 为空时不能拿 message 冒充 code，
  // 否则 detail 会被算成空串，真实原因（如 crypto.subtle 缺失）被吞掉。
  try{if(key)console.warn('[prediction]',key,error?.name||'');}catch{}
  if(known)return code==='INPUT_INCOMPLETE'&&message?message:known;
  return message?`预测未完成：${message}`:'预测未完成，请稍后重试或查看系统状态。';
 };
 const lastPredictionError=useRef(null);
 const jobCurrent=(job,current)=>current()&&inputRevision.current===job.scope.revision
  &&(job.input.importProvenance?.source_type!=='PLC_REALTIME'||plcInputReadyRef.current===true)
  &&operationSession.current===job.scope.session_id&&reportInputFingerprint(currentCaseRef.current)===job.fingerprint
  &&formalModelReady(modelStatusRef.current)&&modelStatusRef.current.model_hash===job.model.model_hash
  &&modelStatusRef.current.model_version===job.model.model_version;
 autoHandlers.current={
  state:(state,job,error)=>{
   setPredictionState(state);setPredictionPending(state==='PREDICTING');setAutoStatus(PREDICTION_STATUS_TEXT[state]);
   if(state==='READY')lastPredictionError.current=null;
   if(state==='STALE'||state==='PREDICTING'){setDirty(true);setErrors([]);}
   if(state==='FAILED'){
    // 2026-11-17：以前这里只显示一句“当前工况预测暂未完成”，真实原因（输入不全 /
    // 工况切换 / 快照不一致 / 超时）被丢掉，用户只能反复点重试。
    const failure=predictionFailureText(error);lastPredictionError.current=error;
    setDirty(true);streamRef.current.fail();setErrors([failure]);setAutoStatus(failure);notify(failure,'WARNING');
    if(!recoveryPrediction.current&&error?.details?.http_status===503&&['MODEL_UNAVAILABLE','MODEL_LOADING','MODEL_NOT_READY','MODEL_EXITED'].includes(error.code)){
     recoveryPrediction.current=true;
     setModelStatus(previous=>({...previous,available:false,status:'BLOCKED'}));readinessRecovery.current?.start();
    }
   }
  },
  execute:async(job,current,trace)=>{
   const {input,scope,retry,model}=job;
   if(!jobCurrent(job,current))throw Error('STALE_COMMITTED_INPUT');
   const prepared=retry?.input_snapshot?null:job.prepared||await predictionClient.current.prepareCommittedInput(input,scope);
   const snapshot=retry?.input_snapshot||prepared.input_snapshot;
   await verifyPredictionHashes({input_snapshot:snapshot});
   if(!snapshot?.snapshot_id||snapshot.model_hash!==model.model_hash||snapshot.model_version!==model.model_version)
    throw Error('COMMITTED_SNAPSHOT_MODEL_MISMATCH');
   if(!jobCurrent(job,current))throw Error('STALE_COMMITTED_INPUT');
   job.snapshot=snapshot;setCommittedSnapshot(snapshot);committedInput.current={key:job.key,input_snapshot:snapshot,input_hash:snapshot.input_hash,request_id:job.request_id,prepared};
   trace({stage:'ACTIVE_SNAPSHOT_CREATED',snapshot_id:snapshot.snapshot_id,input_hash:snapshot.input_hash});
   trace({stage:'SNAPSHOT_IDENTITY_UPDATED',snapshot_id:snapshot.snapshot_id});
   trace({stage:'AUTO_PREDICT_TRIGGERED',snapshot_id:snapshot.snapshot_id});
   job.requestStarted=performance.now();trace({stage:'PREDICT_REQUEST_SENT',snapshot_id:snapshot.snapshot_id,
    trigger_to_request_ms:job.requestStarted-job.enqueuedAt});
    const r=await predictionClient.current.predict(input,{current:()=>jobCurrent(job,current),operation_scope:scope,predictionErrorAlarmRange,
    headers:{'X-DKQKAR-Request-Id':job.request_id},input_snapshot:retry?.input_snapshot,prediction:retry?.prediction,
    observation:retry?.observation,committed_snapshot:prepared});
   trace({stage:'PREDICT_RESPONSE_RECEIVED',request_duration_ms:performance.now()-job.requestStarted,snapshot_id:r.snapshot_id});
   return r;
  },
  accept:async(r,job,current,trace)=>{
   assertPredictionBinding(r,job.input,{input_snapshot:job.snapshot,mode:'formal',model_hash:job.model.model_hash,model_version:job.model.model_version});
   await verifyPredictionHashes(r);if(!jobCurrent(job,current))throw Error('STALE_COMMITTED_INPUT');
   trace({stage:'RESPONSE_IDENTITY_VALIDATED',snapshot_id:r.snapshot_id,input_hash:r.input_hash});
   const acceptedObservation=job.retry?.observation||r.observation;assertObservationBinding(acceptedObservation,r.input_snapshot);
   const activeFrame=job.frame&&job.frame===pendingFrame.current?job.frame:null;
   const recorded=activeFrame||streamRef.current.record(job.input,r);if(activeFrame)streamRef.current.complete(activeFrame,r);
   const sample=withAcceptedObservation(resultSampleMetadata(recorded),acceptedObservation);
   const accepted={result:r,caseData:job.input,sample,activeSnapshot:r.input_snapshot,observation:acceptedObservation,frame:recorded};
   const promoted=job.retry?.draft_id&&draftPromotion.current?.id===job.retry.draft_id?promotedDraft(draftRef.current,r):null;
   recoveryPrediction.current=false;completedRef.current=accepted;setCompleted(accepted);
   currentBinding.current={...predictionIdentity(r,acceptedObservation),valid:true,contextFingerprint:job.fingerprint,operation_scope:job.scope};
   // Observe the accepted formal result only; never put analysis work in the
   // prediction scheduler, Candidate pipeline or future replay frames.
   void api('/ai-analysis/record',{method:'POST',body:JSON.stringify({prediction:r,observation:acceptedObservation,operation_scope:job.scope,
    predictionErrorAlarmRange,customLimits:readCustomLimits(globalThis.localStorage)})}).then(()=>aiAnalysis.refresh()).catch(error=>notify('AI运行分析记录未完成：'+error.message));
   void api('/maintenance/alarm-range',{method:'PUT',body:JSON.stringify({lowerBound:predictionErrorAlarmRange.lowerBound,upperBound:predictionErrorAlarmRange.upperBound})}).catch(()=>{});
   setDirty(false);setServerOK(true);setErrors([]);setLastUpdated(new Date(sample.sample_timestamp||Date.now()));
   if(promoted){writeDraft(promoted);finishBusy(draftPromotion.current.owner);draftPromotion.current=null;}
   trace({stage:'PREDICTION_COMMITTED',snapshot_id:r.snapshot_id});
  },
 };
 useEffect(()=>{
  if(!operationSessionId||historicalReplayLoad.current||!formalModelReady(modelStatus))return;
  if(!industrialStatusRef.current)return;
  if(industrialStatusRef.current.profileConfigured&&inputRevision.current===0)return;
  if(currentCaseRef.current.importProvenance?.source_type==='PLC_REALTIME'&&!plcInputReadyRef.current)return;
  const input=clone(currentCaseRef.current),inputCheck=summarizeModelInputs(input);
  if(!inputCheck.valid){setErrors([...inputCheck.missing,...inputCheck.invalid].map(item=>item.label+' '+item.message));setDirty(true);setPredictionState('FAILED');stream.fail();return;}
  const fingerprint=reportInputFingerprint(input);
  if(currentBinding.current.valid&&currentBinding.current.contextFingerprint===fingerprint&&result.model_hash===modelStatus.model_hash&&result.model_version===modelStatus.model_version&&!pendingRetry.current)return;
  inputRevision.current=Math.max(inputRevision.current,lastRequestRevision.current+1);lastRequestRevision.current=inputRevision.current;
  const scope=operationScope(),retry=pendingRetry.current,prepared=pendingPrepared.current;pendingRetry.current=null;pendingPrepared.current=null;
  currentBinding.current={...currentBinding.current,valid:false};
  autoScheduler.current.submit({key:JSON.stringify([scope,fingerprint,modelStatus.model_hash,modelStatus.model_version]),
   input,fingerprint,scope,retry,prepared,model:{model_hash:modelStatus.model_hash,model_version:modelStatus.model_version},
   frame:stream.mode==='manual'&&!stream.reviewing?null:pendingFrame.current});
  scheduledCommit.current={scope,fingerprint,model_hash:modelStatus.model_hash,model_version:modelStatus.model_version};
 },[modelKey,predictionEpoch,operationSessionId,modelStatus.available,modelStatus.model_hash,modelStatus.model_version,Boolean(industrialConnection.status),constraintRevision]);
 useEffect(()=>{
  if(predictionState!=='READY'||dirty||!currentBinding.current.valid)return;
  autoPredictionTrace.push({stage:'UI_DEPENDENCIES_RECOVERED',request_id:committedInput.current?.request_id,
   snapshot_id:result.snapshot_id,s5_ready:true,method_ready:true,smart_search_ready:true,diagnostic_facts_refresh_requested:true});
  if(autoPredictionTrace.length>200)autoPredictionTrace.shift();
 },[predictionState,dirty,result.snapshot_id]);
 useEffect(()=>{
  const open=()=>setAssistantOpen(true);
  window.addEventListener('dkqkar-assistant-open',open);
  return()=>window.removeEventListener('dkqkar-assistant-open',open);
 },[]);
 const notify=(text,type='SUCCESS')=>{setToastType(type);setToast(text);};
 const changeAssistantMode=next=>{const mode=writeAssistantMode(next);setAssistantMode(mode);notify('副驾驶权限：'+ASSISTANT_MODE_LABELS[mode].label);};
 // One global health projection: details stay in Maintenance, but every page
 // shows the same state and raises a one-shot warning when it turns unhealthy.
 const modelPhase=String(modelStatus?.status||'').toUpperCase();
 const modelPending=!modelPhase||['CONNECTING','LOADING','CHECKING'].includes(modelPhase);
 const plcSource=stream.mode==='plc'||caseData.importProvenance?.source_type==='PLC_REALTIME';
 const plcQuality=plcSource?(industrialDisplayConnection.status?.dataQuality??industrialDisplayConnection.status?.quality):null;
 const systemHealth=modelStatus?.available!==true
  ?modelPending?{level:'pending',label:'预测服务加载中',reason:modelStatus?.reason||'正在连接 QCDKR 正式模型',page:'maintenance'}
  :{level:'error',label:'预测服务未就绪',reason:modelStatus?.reason||'请打开系统状态与维护查看详情',page:'maintenance'}
  :predictionState==='FAILED'?{level:'error',label:'预测计算异常',reason:Array.isArray(errors)&&errors.length?errors[0]:'当前工况预测未完成，可重试或查看系统状态',page:'maintenance'}
  :plcSource&&plcQuality&&['STALE','DISCONNECTED'].includes(plcQuality)?{level:'warning',label:'工业数据中断',reason:'PLC 数据已暂停，等待恢复',page:'communication'}
  :{level:'ok',label:'系统正常',reason:modelStatus?.mode==='demo'?'当前为演示模型；点击查看系统状态':'模型、数据与预测服务可用；点击查看系统状态',page:'maintenance'};
 const healthNotice=useRef('init');
 useEffect(()=>{
  if(systemHealth.level==='ok'||systemHealth.level==='pending'){healthNotice.current=systemHealth.level;return;}
  const key=systemHealth.level+':'+systemHealth.label;
  if(healthNotice.current===key)return;
  healthNotice.current=key;
  notify(`${systemHealth.label}：${systemHealth.reason}`,'WARNING');
 },[systemHealth.level,systemHealth.label,systemHealth.reason]);
 const queueCurrentPrediction=(projection,{recovered=true}={})=>{
  const selected=selectRecoveryProjection(projection,readActiveProjection());
  if(!selected.eligible){setAutoStatus(RECOVERY_INPUT_CHANGED);setErrors([RECOVERY_INPUT_CHANGED]);return false;}
  const current=selected.current;
  const scheduled=scheduledCommit.current,state=autoScheduler.current.state();
  if((state.inFlight||state.pending)&&scheduled?.scope.revision===inputRevision.current
    &&scheduled.fingerprint===reportInputFingerprint(current.input)&&scheduled.model_hash===modelStatusRef.current.model_hash
    &&scheduled.model_version===modelStatusRef.current.model_version)return false;
  autoScheduler.current.invalidate();predictionGate.current.invalidate();
  pendingRetry.current=current.input_snapshot?{input_snapshot:current.input_snapshot,prediction:current.prediction,observation:current.observation}:null;
  const prepared=committedInput.current?.prepared;
  pendingPrepared.current=!pendingRetry.current&&prepared&&reportInputFingerprint(prepared.inputContext)===reportInputFingerprint(current.input)
   &&prepared.input_snapshot.model_hash===modelStatusRef.current.model_hash&&prepared.input_snapshot.model_version===modelStatusRef.current.model_version?prepared:null;
  recoveryPrediction.current=recovered;setPredictionEpoch(value=>value+1);return true;
 };
 // Recover once from a transient model-service failure. Input/model changes
 // reset the attempt; a second failure stays visible with the manual retry.
 // 2026-11-17：以前这里要求 !dirty，但 FAILED 分支一定会把 dirty 置 true，
 // 导致自动重试永远不触发——一次失败就永久停在“预测暂未完成”。
 const autoPredictionRetry=useRef({key:null,count:0});
 useEffect(()=>{
  if(predictionState!=='FAILED'||!formalModelReady(modelStatus))return;
  if(lastPredictionError.current?.code==='INPUT_INCOMPLETE')return; // 补齐参数会触发新的预测，重试没有意义
  const current=readActiveProjection();
  if(!selectRecoveryProjection(null,current).eligible)return;
  const key=`${modelKey}:${modelStatus.model_hash||''}:${reportInputFingerprint(current.input)}`;
  if(autoPredictionRetry.current.key!==key)autoPredictionRetry.current={key,count:0};
  if(autoPredictionRetry.current.count>=1)return;
  const timer=setTimeout(()=>{
   if(predictionStateRef.current!=='FAILED')return;
   autoPredictionRetry.current.count+=1;
   queueCurrentPrediction(readActiveProjection(),{recovered:true});
  },2500);
  return()=>clearTimeout(timer);
 },[predictionState,modelKey,modelStatus.available,modelStatus.model_hash,modelStatus.model_version,caseData]);
 const startHistoricalReplay=async(modelHash,{seededDemo=false,baseInput}={})=>{
  historicalReplayLoad.current?.controller.abort();
  const controller=new AbortController(),load={controller,revision:inputRevision.current,controlVersion:streamRef.current.controlVersion};
  historicalReplayLoad.current=load;setAutoStatus('正在载入工业数据…');
  try{
   const replay=seededDemo?await loadSeededDemoReplay({modelHash,caseData:newDashboardInput(baseInput||currentCaseRef.current),table:rangeTable,limits:readCustomLimits(globalThis.localStorage),signal:controller.signal}):await loadHistoricalReplay({modelHash,signal:controller.signal});
   if(controller.signal.aborted||historicalReplayLoad.current!==load||load.revision!==inputRevision.current||load.controlVersion!==streamRef.current.controlVersion)return false;
   historicalReplayLoad.current=null;defaultInput.current=newDashboardInput(replay.frames[0].input);
   // A dataset replacement revokes every old derived current-view result.
   policyOwner.current.clear();activeSearchRunId.current=null;smartSearchClient.current.cancel('STALE');smartReviewClient.current.cancel('STALE');
   draftPredictionGate.current.invalidate();writeDraft(null);setDraftAudit({status:'PENDING',evidence:[],findings:[]});
   setPlans([]);setPendingPlan(null);setAppliedPlan(null);setOptimizationTask(null);setWorkbenchViewMode('CURRENT');
   setSearchState({status:'IDLE'});setAuditBundle({status:'PENDING',evidence:[],findings:[]});diagnosticsRef.current=null;
   abortAiController(auditRequest.current?.controller,'DATA_SOURCE_CHANGED');auditRequest.current=null;auditIdentity.current=null;
   if(diagnosisRequest.current)abortAiController(diagnosisRequest.current.controller,'DATA_SOURCE_CHANGED');diagnosisRequest.current=null;
   trialConfirmation.current=null;abortAiController(agentRequest.current,'DATA_SOURCE_CHANGED');
   setMessages(items=>items.map(item=>({...item,historical:true})));setSessionKey(key=>key+1);
   streamRef.current.loadFrames(replay.frames,replay.sourceName);if(!copilotTaskActive.current)streamRef.current.toggle();return true;
  }catch(error){
   if(!controller.signal.aborted&&historicalReplayLoad.current===load&&load.revision===inputRevision.current&&load.controlVersion===streamRef.current.controlVersion){
    setErrors([error.message]);setAutoStatus('工业数据未载入');
   }
   return false;
  }finally{
   if(historicalReplayLoad.current===load){
    historicalReplayLoad.current=null;
    // A manual edit/source change made during loading owns the current input.
    if(!controller.signal.aborted&&(load.revision!==inputRevision.current||load.controlVersion!==streamRef.current.controlVersion))setPredictionEpoch(value=>value+1);
   }
  }
 };
 const applyRecoveredReadiness=(status,selection,meta)=>{
  predictionClient.current.acceptStatus(status.model);setModelStatus(status.model);setServerOK(true);
  setErrors([]);setAutoStatus('预测服务已恢复');
  const untouched=inputRevision.current===0;
  if(industrialStatusRef.current?.profileConfigured)return;
  if(!industrialStatusRef.current){void api('/communication/status').then(value=>{industrialStatusRef.current=value;applyRecoveredReadiness(status,selection,meta);}).catch(()=>queueCurrentPrediction(selection.current,meta));return;}
  if(!autoDemoStarted.current&&untouched&&status.model.exampleCase&&validateCase(status.model.exampleCase).length===0){
   autoDemoStarted.current=true;void startHistoricalReplay(status.model.model_hash,{seededDemo:true,baseInput:status.model.exampleCase});return;
  }
  queueCurrentPrediction(selection.current,meta);
 };
 recoveryHandlers.current={capture:readActiveProjection,ready:applyRecoveredReadiness};
 const transientDirty=()=>dirtyTransientState({
  candidatePreview:messages.some(message=>message.trial_preview?.status==='PENDING_CONFIRMATION'&&currentRunMatches(message,currentBinding.current))||!!pendingPlan,
  trialIntent:classifyQuestionType(question)?.question_type===QUESTION_TYPE.TRIAL_REQUEST&&classifyQuestionType(question)?.resolution.status==='RESOLVED',
  ...unsavedEdits.current,
  parameterEdits:unsavedEdits.current.parameterEdits||parameterEditors.current.matrix||parameterEditors.current.target,
 });
 const performWorkspaceRefresh=async()=>{
  if(manualRefresh.current)return;
  manualRefresh.current=true;setRefreshing(true);readinessRecovery.current?.stop();
  const controller=new AbortController();let rejectExpired;
  const expired=new Promise((_,reject)=>{rejectExpired=reject;});
  const deadline=setTimeout(()=>{controller.abort();rejectExpired(new Error(RECOVERY_UNAVAILABLE));},10000);
  const wait=promise=>Promise.race([promise,expired]);
  const wasUnavailable=!formalModelReady(modelStatus);
  setRecoveryPhase('CHECKING');setAutoStatus(RECOVERY_CONNECTING);setErrors([]);
  try{
   const status=await wait(probeWorkspaceReadiness({signal:controller.signal}));
   if(!status.backendReady||!status.modelReady){
    setModelStatus({...status.model,available:false,status:'BLOCKED',reason:RECOVERY_CONNECTING});
    readinessRecovery.current?.start();return;
   }
   await wait(ensureWorkspaceSession());
   predictionClient.current.acceptStatus(status.model);setModelStatus(status.model);setServerOK(true);setRecoveryPhase('READY');
   await wait(Promise.all([api('/cases',{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setCases(data);}),refreshAssistantStatus()]));
   const current=readActiveProjection();
   if(wasUnavailable||dirty||!currentBinding.current.valid||!current.input_snapshot){
    if(!queueCurrentPrediction(current))return;
   }else{
    const verified=await wait(api('/report/validate',{method:'POST',signal:controller.signal,body:JSON.stringify({input:current.input,prediction:current.prediction,snapshot:current.input_snapshot,observation:current.observation,operation_scope:current.operation_scope,aiMessages:[]})}));
    assertPredictionBinding(verified.prediction,current.input,{input_snapshot:current.input_snapshot,mode:'formal'});
    assertObservationBinding(verified.observation,current.input_snapshot);await wait(verifyPredictionHashes(verified.prediction));
    if(!sameRecoveryProjection(current,readActiveProjection())){queueCurrentPrediction(readActiveProjection());return;}
    const accepted={...completedRef.current,result:verified.prediction,caseData:clone(verified.input),activeSnapshot:verified.snapshot,observation:verified.observation,sample:withAcceptedObservation(completedRef.current.sample,verified.observation)};
    completedRef.current=accepted;setCompleted(accepted);
    setAuditBundle({status:verified.evidence_status,evidence:verified.evidence||[],findings:verified.findings||[]});
    setAutoStatus('已同步');
   }
   setErrors([]);notify('预测服务已恢复');
  }catch{
   setRecoveryPhase('EXHAUSTED');
   setErrors([RECOVERY_UNAVAILABLE]);notify(RECOVERY_UNAVAILABLE);
   try{await reloadWorkspaceRenderer();}catch{}
  }finally{clearTimeout(deadline);manualRefresh.current=false;setRefreshing(false);}
 };
 const requestWorkspaceRefresh=()=>{
  if(manualRefresh.current)return;
  if(transientDirty()){setRefreshConfirmation(true);return;}
  return performWorkspaceRefresh();
 };
 refreshHandler.current=requestWorkspaceRefresh;
 useEffect(()=>installWorkspaceRefresh(()=>refreshHandler.current()),[]);
 useEffect(()=>{if(!refreshConfirmation)return;const dialog=document.querySelector('[aria-label="刷新当前工作台确认"]');if(dialog)return containDialogFocus(dialog);},[refreshConfirmation]);
 const update=(fn)=>{
  const previous=currentCaseRef.current,raw=fn(previous);
  if(reportInputFingerprint(raw)===reportInputFingerprint(previous))return;
  unsavedEdits.current={parameterEdits:false,dataEdits:false};
  const targetOnly=raw.target!==previous.target&&reportInputFingerprint({...raw,target:previous.target})===reportInputFingerprint(previous);
  const edited=targetOnly?raw:withEditedSample(previous,raw,resultSample);
  const next=raw.target!==previous.target?{...edited,importProvenance:{...edited.importProvenance,target_source:'USER_INPUT'}}:edited;
  const observationOnly=reportInputFingerprint(withoutObservation(previous))===reportInputFingerprint(withoutObservation(next));
  const previousBinding=currentBinding.current,original=completedRef.current;
  invalidatePrediction({observationOnly});pendingFrame.current=targetOnly?stream.frame:null;
  if(targetOnly&&stream.frames.length)stream.pause({preserveProjection:false});else stream.manual();currentCaseRef.current=next;setCase(next);setPlans([]);setPendingPlan(null);setErrors([]);
  if(observationOnly&&(previousBinding.valid||previousBinding.kind==='append-observation')&&original.activeSnapshot){
   currentBinding.current={...previousBinding,valid:false,kind:'append-observation'};
   const request=observationGate.current.begin(),scope=operationScope(),data={value:next.importProvenance?.observedAvailable===false?null:next.importProvenance?.observed??next.stands.find(stand=>stand.id==='S5').force??null,source:next.importProvenance?.observedSource||'unknown',timestamp:next.importProvenance?.sample_timestamp??null};
   setAutoStatus('实际值待更新');
   predictionClient.current.appendObservation(original.activeSnapshot,original.result,data,{signal:request.signal,operation_scope:scope,revision:scope.revision}).then(response=>{
    assertObservationBinding(response.observation,original.activeSnapshot);
    if(response.revision!==scope.revision)throw new Error('实际值请求版本不一致');
    request.commit(()=>{const sample=withAcceptedObservation(original.sample,response.observation);
     const recorded=streamRef.current.record(next,{...original.result,observation:response.observation});
     const accepted={...original,observation:response.observation,sample,frame:recorded};completedRef.current=accepted;setCompleted(accepted);currentBinding.current={...predictionIdentity(original.result,response.observation),valid:true,contextFingerprint:reportInputFingerprint(original.caseData),operation_scope:scope};setDirty(false);setPredictionState('READY');setAutoStatus(PREDICTION_STATUS_TEXT.READY);});
   }).catch(error=>request.commit(()=>{setErrors(['实际值未追加：'+error.message]);setAutoStatus('实际值待验证');}));
  }else {setPredictionEpoch(value=>value+1);setAutoStatus('自动计算中');}
 };

 const stand=caseData.stands.find(s=>s.id===selected)||caseData.stands[4];
 const save=async()=>{if(dirty){notify('工况已修改，自动预测更新中，请稍后保存');return;}const busyRequest=beginBusy('save');try{const saved=await api('/cases',{method:'POST',body:JSON.stringify({name:caseData.id,input:resultCase,prediction:result,observation,optimization:appliedPlan?.plan||null})});setCases(await api('/cases'));unsavedEdits.current={parameterEdits:false,dataEdits:false};notify('案例已保存到本机 · '+(saved.name||saved.id));}catch(e){notify(e.message);}finally{finishBusy(busyRequest);}};
const generatePresets=async()=>{setWorkbenchViewMode('CURRENT');policyOwner.current.clear();if(busyLabel.current||trialConfirmation.current)return;if(!currentBinding.current.valid){notify('预测结果待更新，请完成同步后生成方案');return;}smartReviewClient.current.cancel('SUPERSEDED');activeSearchRunId.current=null;setSearchState({status:'IDLE'});stream.manual();const source=completedRef.current,input=clone(source.result.inputContext||source.caseData);const checked=summarizeModelInputs(input);const e=[...checked.missing,...checked.invalid].map(item=>item.label+' '+item.message);if(!Number.isFinite(input.target)||input.target<=0)e.push('请填写有效的目标轧制力');if(e.length){setErrors(e);setPage('input');return;}const revision=inputRevision.current,messageBinding=freezeReportPayload({...predictionIdentity(source.result,source.observation),contextFingerprint:reportInputFingerprint(source.caseData),operation_scope:operationScope()});const busyRequest=beginBusy('optimize');try{const candidates=await predictionClient.current.optimize(input,{input_snapshot:source.activeSnapshot,prediction:source.result,operation_scope:operationScope()});if(revision!==inputRevision.current){notify('参数已变化，请重新生成方案');return;}setPlans(items=>mergeCandidateSources(items,candidates.map(plan=>({...plan,candidate_source:'SEARCH_SPACE_PRESET',baselineInput:clone(input)})),'BUILT_IN_CANDIDATE_SEARCH'));setMessages(m=>[...m,{...messageBinding,role:'assistant',mode:'local',answerScope:'SNAPSHOT',text:candidates.length?`已生成 ${candidates.length} 个系统候选，目标 S5 轧制力为 ${engineering('force',input.target)}。\n选择方案，即可查看要改的参数和调整后的预测结果。`:'当前没有可用方案，请查看工况调整页。',actions:['optimize','prediction']}]);notify(candidates.length?'系统候选已生成，请选择一个查看':'当前没有可用方案');}catch(e){if(revision===inputRevision.current)notify(e.message);}finally{finishBusy(busyRequest);}};

 const cancelSearch=()=>{policyOwner.current.cancel();smartSearchClient.current.cancel();if(busyLabel.current==='optimize')finishBusy(busyOwner.current);};
 const generate=async()=>{
  if(busyLabel.current||trialConfirmation.current||policyOwner.current.state().status==='SEARCHING')return;
  if(!currentBinding.current.valid||completedRef.current.result.mode!=='formal'){notify('请先完成当前有效正式预测');return;}
  smartReviewClient.current.cancel('SUPERSEDED');
  stream.pause();policyOwner.current.generate();
 };
 const applyPlan=()=>{try{rejectPlanApplication();}catch(error){notify(error.message);}};
 const undoPlan=applyPlan;
 const readSelectedPlanIdentity=()=>candidateSearchIdentity(currentCaseRef.current,completedRef.current.result,{
  observation:completedRef.current.observation,modelMetadata:modelStatusRef.current,customLimits:readCustomLimits(window.localStorage),
  targetValue:optimizationTaskRef.current ? optimizationTaskRef.current.targetValueT??null : (currentCaseRef.current.importProvenance?.target_source==='USER_INPUT'?currentCaseRef.current.target:null),
  searchMatchTolerance:SEARCH_MATCH_TOLERANCE_DEFAULT});
 const assertSelectedPlanCurrent=(plan,validatedIdentity)=>{
  const identity=readSelectedPlanIdentity(),source=completedRef.current,registered=plansRef.current.find(item=>candidateExplanationKey(item)===candidateExplanationKey(plan));
  const run=policyOwner.current.state().activeRun;
  if(!currentBinding.current.valid||!formalModelReady(modelStatusRef.current)||!registered
   ||validatedIdentity&&!sameSelectedPlanIdentity(validatedIdentity,identity)
   ||plan.candidate_source==='SMART_SEARCH'&&(!sameSelectedPlanIdentity(plan.search_identity,identity)
    ||run?.status!=='COMPLETED'||run.search_run_id!==plan.search_run_id||activeSearchRunId.current!==plan.search_run_id
    ||!sameSelectedPlanIdentity(run.identity,identity)||!candidateABReady(registered,null,true))
   ||source.result.snapshot_id!==plan.baseline_snapshot_id)throw Object.assign(new Error('PLAN_STALE'),{code:'PLAN_STALE'});
  return freezeReportPayload(identity);
 };
 const notifyPlanRejection=error=>notify(error.code==='PLAN_STALE'?'当前方案已失效，请重新生成候选方案。':'方案校验未通过，请重新生成候选方案。','WARNING');
 const loadDraft=async plan=>{
  if(draftPromotion.current)return;
  try{
   const selected=plansRef.current.find(item=>candidateExplanationKey(item)===candidateExplanationKey(plan));
   if(!selected)throw Object.assign(new Error('PLAN_STALE'),{code:'PLAN_STALE'});plan=freezeReportPayload(selected);
   const validatedIdentity=assertSelectedPlanCurrent(plan);
   const source=completedRef.current;let draft=createDraft(plan,source.result,source.activeSnapshot,currentBinding.current);const request=draftPredictionGate.current.begin();
   await verifyPredictionHashes({input_snapshot:plan.input_snapshot});
   if(plan.candidate_source==='SMART_SEARCH'){
    if(!candidateABReady(plan,null,currentBinding.current.valid))throw new Error('候选正式A/B结果尚不可用。');
    await verifyPredictionHashes(plan.candidate_prediction);
    draft=acceptDraftPrediction({...draft,status:'PREDICTING'},plan.candidate_prediction);
    if(plan.search_run_id!==activeSearchRunId.current)throw Object.assign(new Error('PLAN_STALE'),{code:'PLAN_STALE'});
   }
   let loaded=null;request.commit(()=>{assertSelectedPlanCurrent(plan,validatedIdentity);if(!validateDraftBaseline(draft,currentBinding.current))throw Object.assign(new Error('PLAN_STALE'),{code:'PLAN_STALE'});writeDraft(draft);loaded=draft;notify('草案已载入；当前分析工况未改变');});return loaded;
  }catch(error){notifyPlanRejection(error);}
 };
 const predictDraft=async()=>{
  const draft=draftRef.current;if(draft?.status!=='LOADED'||!validateDraftBaseline(draft,currentBinding.current)||draftPromotion.current)return;
  const request=draftPredictionGate.current.begin(),predicting=freezeReportPayload({...draft,status:'PREDICTING',error:null});writeDraft(predicting);
  try{
   // An unscoped NEW prediction signs B without rebinding the current A scope.
   const prediction=await predictionClient.current.predict(predicting.input,{signal:request.signal,current:request.current});await verifyPredictionHashes(prediction);
   if(!request.current()||draftRef.current?.draft_id!==predicting.draft_id)return;
   if(!validateDraftBaseline(predicting,currentBinding.current,{requireValid:false})){writeDraft(freezeReportPayload({...predicting,status:'BASELINE_STALE'}));return;}
   const accepted=acceptDraftPrediction(predicting,prediction);request.commit(()=>writeDraft(accepted));
  }catch(error){if(request.current()&&draftRef.current?.draft_id===predicting.draft_id)writeDraft(freezeReportPayload({...predicting,status:'LOADED',error:error.message}));}
 };
 const discardDraft=()=>{if(draftPromotion.current)return;draftPredictionGate.current.invalidate();writeDraft(discardedDraft(draftRef.current));};
 const promoteDraft=async()=>{
  if(draftPromotion.current||busyLabel.current){notify('请等待当前操作完成后再采用草案');return;}
  try{
   const draft=draftRef.current;promotionRetry(draft,currentBinding.current);const request=draftPredictionGate.current.begin();await verifyPredictionHashes(draft.prediction);
   if(!request.current()||draftRef.current?.draft_id!==draft.draft_id||draftPromotion.current||busyLabel.current)return;
   const retry=promotionRetry(draftRef.current,currentBinding.current),owner=beginBusy('draft-promote');draftPromotion.current={id:draft.draft_id,owner};
   invalidatePrediction({promotingDraftId:draft.draft_id});pendingRetry.current=retry;pendingFrame.current=null;stream.manual();setSessionKey(value=>value+1);setPredictionEpoch(value=>value+1);
   currentCaseRef.current=clone(draft.input);setCase(currentCaseRef.current);setPlans([]);setPendingPlan(null);setAppliedPlan(null);setErrors([]);setAutoStatus('正在采用草案');
  }catch(error){notify(error.message);}
 };
 useEffect(()=>()=>draftPredictionGate.current.invalidate(),[]);
 useEffect(()=>{assistantMounted.current=true;const scheduler=createAssistantStatusScheduler(fetchAssistantStatus);assistantStatusScheduler.current=scheduler;void scheduler.refresh();return()=>{assistantMounted.current=false;scheduler.stop();assistantStatusScheduler.current=null;abortAiController(agentRequest.current,'APP_UNMOUNT');};},[]);
 // 事件语音播报：轮询新事件，warning/error 级入队，逐条 TTS 播报；同类 60 秒冷却，
 // 应用启动时只标记历史事件不回放。这条队列也是助手的嗓子：服务端合成失败时退回浏览器语音。
 const eventVoiceRef=useRef({seen:new Set(),queue:[],speaking:false,cooldown:new Map(),voiceDownUntil:0});
 useEffect(()=>{
  const state=eventVoiceRef.current;
  // 浏览器自带中文语音兜底：服务端 SAPI 在 Windows 服务进程里会被系统拒绝，
  // 有了这条，助手开口才有声音，而不是只剩气泡。
  const speakWithBrowser=text=>new Promise(resolve=>{
   try{
    const synth=window.speechSynthesis;
    if(!synth||typeof window.SpeechSynthesisUtterance!=='function')return resolve();
    const line=new window.SpeechSynthesisUtterance(String(text));
    line.lang='zh-CN';line.rate=1.02;
    const done=()=>resolve();
    line.onend=done;line.onerror=done;
    synth.speak(line);setTimeout(done,20000);
   }catch{resolve();}
  });
  const pump=async()=>{
   if(state.speaking||!state.queue.length)return;
   state.speaking=true;
   const text=state.queue.shift();
   // 服务端 SAPI 在 Windows 服务进程里合成不出来（2026-11-17 实测：status 可用、speak 全 503）。
   // 失败后 5 分钟内直接走浏览器语音，不再每次先等一次 503。
   if(!state.voiceDownUntil||Date.now()>state.voiceDownUntil){
    try{
     const response=await fetch('/api/voice/speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
     if(response.ok){const data=await response.json();const audio=new Audio('data:audio/wav;base64,'+data.wavBase64);
      await new Promise(resolve=>{audio.onended=resolve;audio.onerror=resolve;audio.play().catch(resolve);});}
     else {state.voiceDownUntil=Date.now()+5*60*1000;await speakWithBrowser(text);}
    }catch{state.voiceDownUntil=Date.now()+5*60*1000;await speakWithBrowser(text);}
   }else await speakWithBrowser(text);
   state.speaking=false;
   if(state.queue.length)pump();
  };
  // 助手借这条队列出声：先排进 TTS，再说气泡，两者同一句。
  avatarVoiceRef.current=text=>{state.queue.push({text});void pump();};
  const poll=async()=>{
   try{
    const data=await api('/events?limit=20');
    const items=Array.isArray(data)?data:data.items||[];
    if(!state.seen.size){items.forEach(item=>state.seen.add(item.id));return;}
    const lines=[];
    for(const item of items){
     if(state.seen.has(item.id))continue;
     state.seen.add(item.id);
     if(item.state!=='active')continue;
     const last=state.cooldown.get(item.ruleId)||0;
     if(Date.now()-last<60000)continue;
     state.cooldown.set(item.ruleId,Date.now());
     // 播事件正文（自带真实数字与场景），前缀按级别口语化并轮换，避免机械电报腔。
     const detail=String(item.message||item.title||'').replace(/[。.]$/,'').slice(0,100);
     const prefix=item.severity==='error'
       ?['注意，','报警，','请注意，'][Math.floor(Math.random()*3)]
       :['提醒一下，','提示，'][Math.floor(Math.random()*2)];
     state.queue.push({text:prefix+detail});
     const line=eventSpeech(item);
     if(line)lines.push('event:'+item.id+'|'+line);
    }
    // 事件本身已经排进 TTS，气泡只负责把同一句显示在助手旁边。
    if(lines.length){const [key,line]=lines[0].split('|');avatarSay(line,key,{voice:false});}
    if(state.queue.length)pump();
   }catch{}
  };
  poll();const timer=setInterval(poll,10000);
  return()=>clearInterval(timer);
 },[]);
 // 助手值守：AI 浮窗关着也每 30 秒问一次事件中心（后端同频巡检），
 // 问题清单有变化才开口；首次加载先让人看清界面，8 秒后再报旧账。
 const avatarWatchRef=useRef({fingerprint:null,timer:null});
 useEffect(()=>{
  let stopped=false,pending=null;
  const poll=async()=>{
   try{
    // api() 自己会补 /api 前缀，这里写相对路径，否则拼成 /api/api/... 会 404
    const data=await api('/copilot/incidents',{method:'POST'});
    if(stopped)return;
    const incidents=data.incidents||[],fingerprint=incidentFingerprint(incidents),previous=avatarWatchRef.current.fingerprint;
    avatarWatchRef.current.fingerprint=fingerprint;
    const line=incidentSpeech(incidents);
    if(!line||fingerprint===previous)return;
    if(previous===null){pending=setTimeout(()=>{if(!stopped)avatarSay(line,'incident:'+fingerprint);},AVATAR_FIRST_REPORT_DELAY_MS);return;}
    avatarSay(line,'incident:'+fingerprint);
   }catch{}
  };
  poll();const timer=setInterval(poll,30000);
  return()=>{stopped=true;clearInterval(timer);if(pending)clearTimeout(pending);};
 },[]);
 useEffect(()=>()=>{if(avatarSpeechTimer.current)clearTimeout(avatarSpeechTimer.current);if(avatarSpeechRef.current.pendingTimer)clearTimeout(avatarSpeechRef.current.pendingTimer);},[]);
 const captureAssistantTurn=(q,options={})=>{
  const accepted=completedRef.current,ready=currentBinding.current.valid&&!dirty&&predictionState==='READY';
  const data=ready?accepted.caseData:currentCaseRef.current,requestSnapshot=ready?accepted.activeSnapshot:committedInput.current?.input_snapshot??null;
  let limits={};try{limits=readCustomLimits(window.localStorage);}catch{}
  const context=freezeReportPayload({caseData:data,prediction:ready?accepted.result:null,input_snapshot:requestSnapshot,
   observation:ready?accepted.observation:null,request_snapshot_id:requestSnapshot?.snapshot_id??null,prediction_status:ready?'READY':'PENDING',
   diagnostics:ready?diagnosticsRef.current:{status:'WAITING',findings:[],evidence:[]},operation_scope:operationScope(),contextFingerprint:reportInputFingerprint(data),
   historicalRangeLimits:limits,frames:stream.frames.slice(0,stream.cursor+1),selectedEvent,selectedStand:selected,currentPage:page,currentIndex:stream.cursor,
   ...assistantSampleContext(resultSample),resultSample,dataMode:stream.mode==='manual'?'single':'timeseries',
   referenceCase:/刚才|上一次|上一轮/.test(q)&&previousAssistantInput.current?previousAssistantInput.current:agentReference==='__baseline__'?defaultInput.current:cases.find(c=>c.id===agentReference)});
  return createAssistantTurn(q,context,options);
 };
 const startTurn=turn=>{if(turn.started)return;turn.started=true;setMessages(m=>startAssistantTurn(m,turn));};
 const publishTurn=(turn,patch,options)=>setMessages(assistantResponseUpdate(turn,patch,options));
 const ask=async(q=question,options={})=>{
  if(!q.trim()||assistantTurnActive.current||chatBusy){if(options.voice)throw new Error('助手正在回答，请稍后再说');return;}
  const turn=captureAssistantTurn(q,options);assistantTurnActive.current=turn;
  try{return await dispatchAsk(q,{...options,turn});}
  finally{if(assistantTurnActive.current===turn)assistantTurnActive.current=null;}
 };
 const askDirect=async(q,{voice=false,signal,turn}={})=>{
  const controller=ownAiController(new AbortController(),'DIRECT_CHAT',signal);agentRequest.current=controller;const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  setAssistantOpen(true);startTurn(turn);setQuestion('');setChatBusy(true);
  const startedAt=Date.now(),chatKey=turn.request_id,context=turn.context;const identity={...predictionIdentity(context.prediction,context.observation),contextFingerprint:context.contextFingerprint,operation_scope:context.operation_scope};const attempt=turn.attempt;setRunState('正在思考…');
  let fallback=null,ticker=null,reader=null,reply='',inserted=false,hasFinal=false,streamTransport=null;
  try{
   let status=assistantStatusRef.current;
   if(status.providerStatus!=='READY'){status=await refreshAssistantStatus();combined.throwIfAborted();}
   if(['SERVICE_OFFLINE','OFFLINE'].includes(status.providerStatus))throw new AiTransportError('LOCAL_AI_OFFLINE');
   if(status.providerStatus==='MODEL_MISSING')throw new AiTransportError('LOCAL_AI_MODEL_MISSING');
   if(status.providerStatus==='REQUEST_ERROR')throw new AiTransportError(status.lastError?.code==='LOCAL_LLM_AUTH'?'LOCAL_AI_AUTH':'LOCAL_AI_UNAVAILABLE');
   if(['MODEL_ERROR','ERROR'].includes(status.providerStatus))throw new AiTransportError('LOCAL_AI_UNAVAILABLE');
   const loading=status.loadStatus==='UNLOADED',unknown=status.loadStatus==='UNKNOWN'||!status.loadStatus;
   const generationStartedAt=Date.now();
   setRunState(loading?'正在加载本地模型……':'正在思考…');
   ticker=setInterval(()=>{if(agentRequest.current!==controller)return;const elapsed=Date.now()-generationStartedAt;setRunState(loading||unknown&&elapsed>=3000?'正在加载本地模型……':`正在思考…（已等待 ${Math.round(elapsed/1000)} 秒）`);},1000);
   streamTransport=await openAiStream('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:combined,body:JSON.stringify({message:q,stream:true,context,...assistantTurnRequest(turn)})},{kind:'DIRECT_CHAT',controller,identity,health:localAiHealth(status)});
   const response=streamTransport.response;
   reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';
   for(;;){let chunk;try{chunk=await reader.read();}catch(error){if(combined.aborted)throw asAiTransportError(error,combined);streamTransport.trace.response_body_complete=false;throw new AiTransportError('TRUNCATED_RESPONSE_BODY',{raw_error:error.message});}const{done,value}=chunk;combined.throwIfAborted();if(done)break;buffer+=decoder.decode(value,{stream:true});
    streamTransport.trace.response_body_length=(streamTransport.trace.response_body_length||0)+value.byteLength;
    let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at).trim();buffer=buffer.slice(at+1);if(!line)continue;let event;streamTransport.trace.json_parse_attempted=true;try{event=JSON.parse(line);streamTransport.trace.json_parse_result='SUCCESS';}catch(error){streamTransport.trace.json_parse_result='FAILED';throw new AiTransportError('JSON_PARSE_FAILED',{raw_error:error.message});}
     if(event.type==='delta'){if(!inserted){inserted=true;clearInterval(ticker);if(agentRequest.current===controller)setRunState('');publishTurn(turn,{...identity,chatKey,text:'',mode:'streaming',historical:!runIsCurrent(identity)},{attempt});}
      reply+=event.text;publishTurn(turn,{text:reply,historical:!runIsCurrent(identity)},{attempt});}
     else if(event.type==='final'){hasFinal=true;inserted=true;reply=event.reply||reply;publishTurn(turn,{...identity,...event,text:reply,historical:!runIsCurrent(identity)},{attempt,final:true});}
     else if(event.type==='error')throw asAiTransportError({code:event.error_code,message:event.message});
     else if(event.type==='unsupported')throw new DOMException('改走工具流程','UnsupportedError');
    }}
   if(!inserted)throw new AiTransportError('EMPTY_RESPONSE_BODY');
   if(!hasFinal||buffer.trim())throw new AiTransportError('OTHER',{raw_error:'STREAM_FINAL_MISSING_OR_INCOMPLETE_EVENT'});
   streamTransport.trace.response_body_complete=true;streamTransport.finish();
   return reply;
  }catch(e){
   clearInterval(ticker);
   if(e.name==='UnsupportedError'){streamTransport?.finish();if(streamTransport)streamTransport.trace.final_request_status='TOOL_FLOW_FALLBACK';startAssistantFallback(turn);fallback=askRuns(q,{voice,signal,turn});return fallback;}
   const stopped=combined.aborted||e.name==='AbortError',failure=asAiTransportError(e,combined);streamTransport?.finish(failure);
   const unavailable=['LOCAL_AI_UNAVAILABLE','LOCAL_AI_OFFLINE','LOCAL_AI_MODEL_MISSING','LOCAL_AI_AUTH'].includes(failure.code);
   publishTurn(turn,{text:inserted?reply:failure.message,error_code:failure.code,mode:inserted?'interrupted':unavailable?'unavailable':'error',interruptionLabel:stopped?'本次任务已停止。':failure.code==='AI_ANSWER_TIMEOUT'?'回答超时':'回答已中断',retry:stopped||failure.code==='LOCAL_AI_AUTH'?undefined:q},{attempt,final:true});
   if(!stopped)void refreshAssistantStatus();
   if(voice&&!stopped)throw e;
   return null;
  }finally{clearInterval(ticker);if(!hasFinal)try{await reader?.cancel();}catch{}if(!fallback&&agentRequest.current===controller){setChatBusy(false);setRunState('');agentRequest.current=null;}}
 };
  const dispatchAsk=async(q=question,{voice=false,signal,tools,analysisMode,turn,returnRun=false}={})=>{
   if(!q.trim()||chatBusy){if(voice)throw new Error('助手正在回答，请稍后再说');return;}
   if(tools){setAnalysisContext(null);setAnalysisChoice(null);}
   if(!tools){
    const intent=analysisMode==='CURRENT'?{type:'CURRENT'}:analysisMode==='ANALYSIS'?{type:'FOLLOWUP',analysisId:analysisContext?.analysisId}:aiAnalysisIntent(q,analysisContext?.analysisId);
    if(intent?.type==='CURRENT'){setAnalysisContext(null);setAnalysisChoice(null);if(/^(返回当前运行|看当前工况|返回当前工况)[。！？!?]*$/.test(q.trim())){notify('已返回当前运行');return;}}
    else if(intent){
     setAssistantOpen(true);setQuestion('');
     if(intent.type==='CHOOSE'){setAnalysisChoice({question:q,analysisId:intent.analysisId});return;}
     if(intent.type==='LIST'){openAnalysisHistory(null,intent.localDate?{localDate:intent.localDate}:{});return;}
     try{
      if(intent.type==='ANALYZE_RECENT'||intent.type==='ANALYZE_PARTIAL')return await analyzeRecords(intent.analysisId,intent.type==='ANALYZE_RECENT');
      if(['OPEN','LATEST','MAX_ERROR'].includes(intent.type)){
       const query=new URLSearchParams();if(intent.type==='MAX_ERROR')query.set('sort','maxError');if(intent.localDate)query.set('localDate',intent.localDate);
       const rows=intent.analysisId?null:await api('/ai-analysis/records?'+query);
       const id=intent.analysisId||(intent.type==='LATEST'?rows.items?.find(row=>['READY','AI_FAILED'].includes(row.analysisStatus)):rows.items?.[0])?.analysisId;if(!id){notify('暂无可打开的AI分析记录');return;}
       const value=await api('/ai-analysis/records/'+id);setAnalysisContext(value);setAnalysisPanel({id});return;
      }
      if(intent.type==='FOLLOWUP'){
       const controller=ownAiController(new AbortController(),'AI_ANALYSIS_FOLLOWUP',signal);agentRequest.current=controller;setChatBusy(true);setRunState('正在解读批次 #'+intent.analysisId);
       startTurn(turn);
       try{
        const response=await api('/ai-analysis/records/'+intent.analysisId+'/followup',{method:'POST',signal:controller.signal,body:JSON.stringify({question:q})});
        if(!controller.signal.aborted)publishTurn(turn,{text:'可能原因属于AI推断；以下建议未执行任何修改。\n\n'+response.text,answerScope:'AI_ANALYSIS',analysisId:response.analysisId,mode:'ai-analysis'},{final:true});
        return response.text;
       }finally{if(agentRequest.current===controller){agentRequest.current=null;setChatBusy(false);setRunState('');}}
      }
     }catch(error){notify(error.message);return;}
    }
   }
   if(!tools&&isFactDiagnosticQuestion(q))return askRuns(q,{returnRun,voice,signal,turn,factDiagnostic:true});
   const parameterQuestion=classifyQuestionType(q);
   explicitTrialEntry.current=false;
   if(!tools&&parameterQuestion)return askRuns(q,{returnRun,voice,signal,questionDriven:true,turn});
  const intent=classifyAssistantIntent(q,currentDiagnostics);
  if(!tools&&!voice&&/^(?:请)?(?:比较|对比)调整前后S5预测[。！？!?]*$/.test(q.replace(/\s/g,''))){setPage('optimize');notify(workingDraft?.status==='PREDICTED'?'已打开现有 A/B 验证':'请先指定候选调整并确认试算，才能生成 A/B 结果');return;}
  if(!tools&&isKnowledgeDetailFollowup(q))return askRuns(q,{returnRun,voice,signal,turn});
  if(tools||intent.requiresTool)return askRuns(q,{returnRun,voice,signal,tools,turn});
  if(!tools&&isConversational(q))return askDirect(q,{voice,signal,turn});
  return askRuns(q,{returnRun,voice,signal,tools,turn});
 };
  const askRuns=async(q,{voice=false,signal,tools,diagnosticRequest,candidateRequest,questionDriven=false,factDiagnostic=false,turn,returnRun=false}={})=>{
  const ownsTurn=!turn;if(!turn){if(assistantTurnActive.current)return;turn=captureAssistantTurn(q);assistantTurnActive.current=turn;}
  const attempt=turn.attempt;
  try{
  if(!q.trim()||chatBusy){if(voice)throw new Error('助手正在回答，请稍后再说');return;}
  if(pauseRebind.current)try{await pauseRebind.current;}catch{notify('暂停工况身份暂不可用，请重新同步');return;}
   const parameterQuestion=questionDriven?classifyQuestionType(q):null;
   const batch2Question=BATCH2_QUESTION_TYPES.includes(parameterQuestion?.question_type);
   const batch3Question=BATCH3_QUESTION_TYPES.includes(parameterQuestion?.question_type);
   const questionSnapshot=parameterQuestion?.question_type===QUESTION_TYPE.PARAMETER_CURRENT_VALUE||batch2Question||batch3Question;
   const intent=questionDriven?{domain:questionSnapshot?'SNAPSHOT':'DOMAIN_KNOWLEDGE',scope:questionSnapshot?'SNAPSHOT':'KNOWLEDGE',certainty:'EXPLICIT'}:candidateRequest?{domain:'SNAPSHOT',scope:'SNAPSHOT',certainty:'EXPLICIT'}:diagnosticRequest?{domain:'DIAGNOSTIC',scope:'SNAPSHOT',certainty:'EXPLICIT'}:classifyAssistantIntent(q,currentDiagnostics),snapshotRequest=factDiagnostic|| (questionDriven?intent.scope==='SNAPSHOT'&&turn.context.prediction_status==='READY':Boolean(tools)||(intent.scope==='SNAPSHOT'&&intent.certainty==='EXPLICIT'));
   const guidedTrial=!tools&&!diagnosticRequest&&(questionDriven?parameterQuestion?.question_type===QUESTION_TYPE.TRIAL_REQUEST:intent.domain==='PARAMETER');
  const knowledgeRevision=knowledgeUiRevision.current;
  const knowledgeFollowup=!tools&&!diagnosticRequest&&isKnowledgeDetailFollowup(q)?adjacentKnowledgeFollowup(messages,knowledgeRevision):null;
  if(snapshotRequest&&!factDiagnostic&&turn.context.prediction_status!=='READY'){if(voice)throw new Error('参数正在同步，请稍后再说');notify(errors.length?'请先完成有效的工况输入':'参数正在同步，完成后即可分析');return;}
  if(snapshotRequest&&!factDiagnostic&&turn.context.diagnostics?.status==='VALID'&&!currentRunMatches(turn.context.diagnostics.identity,{...predictionIdentity(turn.context.prediction,turn.context.observation),valid:true,contextFingerprint:turn.context.contextFingerprint,operation_scope:turn.context.operation_scope})){notify('当前诊断与工况绑定已变化，请等待更新');return;}
  const resumeDemo=snapshotRequest&&stream.mode==='demo'&&stream.running?{controlVersion:stream.controlVersion,inputRevision:inputRevision.current}:null;
  if(resumeDemo)stream.pause({temporary:true});
  const frozen=snapshotRequest?{input:turn.context.caseData,prediction:turn.context.prediction,snapshot:turn.context.input_snapshot,observation:turn.context.observation,diagnostics:turn.context.diagnostics,scope:turn.context.operation_scope,frames:turn.context.frames,selectedEvent:turn.context.selectedEvent,referenceCase:turn.context.referenceCase}:{};
  const reviewsCandidate=questionDriven&&[QUESTION_TYPE.CANDIDATE_REVIEW,QUESTION_TYPE.CAUSAL_PROBE].includes(parameterQuestion?.question_type);
  if(reviewsCandidate&&smartReviewClient.current.isBusy()){notify('另一方案正在解读…');return;}
  const currentReviewPlan=()=>{const matches=plansRef.current.filter(plan=>selectedCandidateExplanation.current
    && candidateExplanationKey(plan)===selectedCandidateExplanation.current
    &&(plan.candidate_source!=='SMART_SEARCH'||plan.search_run_id===activeSearchRunId.current));return matches.length===1?matches[0]:null;};
  const reviewPlan=reviewsCandidate?currentReviewPlan():null;
  const reviewDraft=reviewPlan&&draftRef.current?.source_plan_id===reviewPlan.id&&draftRef.current?.candidate_preview_snapshot_id===reviewPlan.target_snapshot_id
    &&draftRef.current?.baseline_snapshot_id===reviewPlan.baseline_snapshot_id&&draftRef.current?.status==='PREDICTED'?draftRef.current:null;
  const reviewPrediction=reviewPlan?.candidate_source==='SMART_SEARCH'&&candidateABReady(reviewPlan,null,currentBinding.current.valid)?reviewPlan.candidate_prediction:reviewDraft?.prediction;
  const candidateReview=reviewPlan?{candidate:{id:reviewPlan.id,baseline_snapshot_id:reviewPlan.baseline_snapshot_id,target_snapshot_id:reviewPlan.target_snapshot_id},
    ...(reviewPrediction?{prediction:reviewPrediction}:{})}:undefined;
  const reviewIdentity=reviewPlan?candidateExplanationKey(reviewPlan):null,
    reviewPredictionIdentity=reviewPrediction?reportInputFingerprint(predictionIdentity(reviewPrediction,reviewPrediction.observation)):null;
  const reviewIsCurrent=()=>!reviewsCandidate || ((candidateExplanationKey(currentReviewPlan()) || null)===reviewIdentity
    && (reviewIdentity===null || plansRef.current.some(plan=>candidateExplanationKey(plan)===reviewIdentity))
    && (reviewPredictionIdentity===null || reviewPlan?.candidate_source==='SMART_SEARCH'
      ? reviewPredictionIdentity===null||currentReviewPlan()?.search_run_id===activeSearchRunId.current
       &&reportInputFingerprint(predictionIdentity(currentReviewPlan()?.candidate_prediction,currentReviewPlan()?.candidate_prediction?.observation))===reviewPredictionIdentity
      : draftRef.current?.status==='PREDICTED'&&reportInputFingerprint(predictionIdentity(draftRef.current.prediction,draftRef.current.prediction.observation))===reviewPredictionIdentity));
  const inputSnapshot=guidedTrial||candidateRequest?freezeReportPayload(frozen.prediction?.inputContext):frozen.input,predictionSnapshot=frozen.prediction,contextFingerprint=reportInputFingerprint(inputSnapshot);
  const sampleContext=snapshotRequest?assistantSampleContext(resultSample):{},sampleTime=sampleContext.sampleTime;
  const context=snapshotRequest?{...turn.context,caseData:inputSnapshot,prediction:predictionSnapshot,input_snapshot:frozen.snapshot,observation:frozen.observation,diagnostics:frozen.diagnostics,operation_scope:frozen.scope,contextFingerprint,selectedStand:selected,currentPage:page,currentIndex:stream.cursor,selectedEvent:guidedTrial||candidateRequest?null:frozen.selectedEvent,selectedEventRef:guidedTrial||candidateRequest?null:frozen.selectedEvent?.id,...sampleContext,resultSample,dataMode:stream.mode==='manual'?'single':'timeseries',frames:guidedTrial||candidateRequest?[]:frozen.frames,referenceCase:guidedTrial||candidateRequest?null:frozen.referenceCase}:{currentPage:page,lineId:'local'};
  context.historicalRangeLimits=turn.context.historicalRangeLimits;
  const requestKind=candidateRequest?'CANDIDATE_REVIEW':diagnosticRequest?'AI_EXPLANATION':guidedTrial?'TRIAL_INTENT':questionDriven?parameterQuestion?.question_type:intent.domain;
  const controller=ownAiController(new AbortController(),requestKind,signal);agentRequest.current=controller;const signalCombined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  const requestedFinding=diagnosticRequest?frozen.diagnostics.findings.find(item=>item.finding_id===diagnosticRequest.finding_id):null;
  const targetExplanation=parameterQuestion?.question_type===QUESTION_TYPE.TARGET_GAP_EXPLAIN||requestedFinding?.kind==='S5_TARGET_DIFFERENCE';
  const requestReference=targetExplanation?targetReferenceProjection(predictionSnapshot.value,predictionSnapshot.inputContext?.target,targetReferenceRef.current,predictionSnapshot.snapshot_id):null;
  if(targetExplanation)context.targetReference={...targetReferenceRef.current};
  const referenceIsCurrent=()=>{
   if(!targetExplanation)return true;
   const current=targetReferenceProjection(completedRef.current.result.value,completedRef.current.result.inputContext?.target,targetReferenceRef.current,completedRef.current.result.snapshot_id);
   return requestReference.snapshot_id!==current.snapshot_id||targetReferenceMatches(requestReference,current);
  };
  const candidateIdentity=candidateRequest?candidateExplanationKey(plansRef.current.find(plan=>plan.id===candidateRequest.id&&plan.baseline_snapshot_id===candidateRequest.baseline_snapshot_id&&plan.target_snapshot_id===candidateRequest.target_snapshot_id)):null;
  const requestIdentity={...predictionIdentity(predictionSnapshot,frozen.observation),contextFingerprint,operation_scope:frozen.scope,
   ...(diagnosticRequest?{answer_variant:'AI_EXPLAIN',diagnostic_finding_id:requestedFinding?.finding_id,diagnostic_finding_receipt:requestedFinding?.receipt}:{}),
   ...(candidateRequest?{candidate_identity:candidateIdentity}:{})};
  const readOnly=!tools&&!guidedTrial&&parameterQuestion?.question_type!==QUESTION_TYPE.TRIAL_REQUEST
   &&Boolean(diagnosticRequest||candidateRequest||batch2Question||batch3Question||['PARAMETER_KNOWLEDGE','PARAMETER_CURRENT_VALUE'].includes(parameterQuestion?.question_type)||['DIAGNOSTIC','DOMAIN_KNOWLEDGE'].includes(intent.domain));
  const transportCurrent=()=>agentRequest.current===controller&&!signalCombined.aborted&&reviewIsCurrent()&&referenceIsCurrent()&&(!snapshotRequest||runIsCurrent(requestIdentity))
   &&(!candidateRequest||candidateIdentity&&plansRef.current.some(plan=>candidateExplanationKey(plan)===candidateIdentity));
  const transport={kind:requestKind,identity:requestIdentity,controller,health:localAiHealth(assistantStatusRef.current),readOnly,retry:readOnly&&!batch2Question&&!batch3Question,current:transportCurrent};
  if(!candidateRequest)setAssistantOpen(true);startTurn(turn);setQuestion('');setChatBusy(true);
  const startedAt=Date.now();let statusText=snapshotRequest?'正在分析当前工况':intent.scope==='CONFIG'?'正在读取规则配置':'正在处理当前请求';setRunState(statusText);
  const ticker=setInterval(()=>{if(agentRequest.current!==controller)return;const seconds=Math.round((Date.now()-startedAt)/1000);const hint=seconds>=45?'；首次使用需加载本地模型，约 1 分钟':'';setRunState(`${statusText}（已等待 ${seconds} 秒${hint}）`);},1000);
  const diagnosticKey=diagnosticRequest||factDiagnostic?turn.request_id:null;
  if(diagnosticKey){
   const finding=diagnosticRequest?frozen.diagnostics.findings.find(item=>item.finding_id===diagnosticRequest.finding_id):null;
   publishTurn(turn,{diagnosticKey,answer_variant:'AI_EXPLAIN',
    ...predictionIdentity(predictionSnapshot,frozen.observation),contextFingerprint,operation_scope:frozen.scope,
    diagnostic_finding_id:finding?.finding_id,diagnostic_finding_receipt:finding?.receipt,
    ...(requestReference?{target_reference_context:requestReference}:{}),
    facts_state:'LOADING',ai_explanation_state:'IDLE',findings:[],evidence:[],references:[],text:''},{attempt});
  }
  const receiveDiagnostic=a=>{
   if(!diagnosticKey||!referenceIsCurrent())return;
   publishTurn(turn,previous=>({...a,diagnosticKey,text:a.reply||a.message||'',contextFingerprint,sampleTime,
    diagnostic_sections:previous.diagnostic_sections&&a.diagnostic_sections?{...previous.diagnostic_sections,interpretation:a.diagnostic_sections.interpretation}:a.diagnostic_sections||previous.diagnostic_sections,
    historical:!runIsCurrent(a),diagnosis_actions:a.actions,actions:undefined,references:Array.isArray(a.references)?a.references:[]}),
    {attempt,final:['completed','partial','needs_input','failed','cancelled','stale_context'].includes(a.status)});
  };
  try{
    if(reviewPlan?.candidate_source==='SMART_SEARCH'&&reviewPrediction){
     const comparison=await api('/evidence/draft-comparison',{method:'POST',signal:signalCombined,body:JSON.stringify({baseline:predictionSnapshot,prediction:reviewPrediction,candidate_preview_snapshot_id:reviewPlan.target_snapshot_id,source_plan_id:reviewPlan.id})});
     if(comparison.status!=='VALID'||!reviewIsCurrent())throw new Error('当前搜索A/B已失效，请重新搜索。');
    }
    if(!questionDriven&&assistantStatusRef.current.providerStatus!=='READY'){await refreshAssistantStatus();signalCombined.throwIfAborted();}
    let a=await api('/agent/runs',{method:'POST',signal:signalCombined,transport,body:JSON.stringify({message:q,tools,context,access_mode:assistantMode,...assistantTurnRequest(turn),...(questionDriven?{question_driven:true}:{}),...(candidateReview?{candidate_review:candidateReview}:{}),...(candidateRequest?{candidate_explanation:candidateRequest}:{}),...(diagnosticRequest?{diagnostic_request:diagnosticRequest}:{}),...(knowledgeFollowup?{knowledge_followup:knowledgeFollowup}:{}),...(guidedTrial&&!questionDriven?{trial_request:{mode:'USER_SPECIFIED_TRIAL'}}:{})})});
   activeRun.current=a.runId;const runId=a.runId;
   receiveDiagnostic(a);
   const finished=new Set(['completed','partial','needs_input','needs_approval','failed','cancelled','stale_context']);
   const deadline=Date.now()+185000;
   while(!finished.has(a.status)){
    signalCombined.throwIfAborted();if(Date.now()>deadline){await api('/agent/runs/'+a.runId+'/cancel',{method:'POST',body:'{}'});throw new Error('本次任务等待超时，已停止。');}
    statusText=({queued:'请求已排队',routing:'正在规划工具步骤…',running:'正在分析当前问题',executing:'正在执行工具',validating:'正在核对工具结果',waiting_ui:'等待视图执行'})[a.status]||'正在处理当前请求…';setRunState(statusText);
    await new Promise(resolve=>setTimeout(resolve,450));
    a=await api('/agent/runs/'+runId,{signal:signalCombined,transport});
    receiveDiagnostic(a);
   }
   if(a.status==='cancelled')throw new DOMException('任务已停止','AbortError');
   if(!referenceIsCurrent())return;
   if(reviewsCandidate && (!reviewIsCurrent() || !runIsCurrent(a))){
    publishTurn(turn,{...a,historical:true,status:'stale_context',responseType:'STALE',explanation_text:undefined,text:'候选或工况身份已变化，已丢弃迟到解释。',contextFingerprint},{attempt,final:true});return;
   }
   const traces=Array.isArray(a.trace)?a.trace:[];
   for(const action of a.answer_variant==='AI_EXPLAIN'?[]:a.actions||[]){
    const trace=traces.find(step=>a.results?.[step.resultRef]?.data?.action_ref===action.id)||traces.find(step=>step.tool==='3D'&&['requested','pending'].includes(step.status));
    try {
     if(!runIsCurrent(a))throw new Error('快照、实际值或当前请求已变化；结果仅保留历史。');
     await api('/agent/runs/'+a.runId+'/actions/'+action.id+'/authorize',{method:'POST',body:JSON.stringify({...a,contextRef:a.contextRef})});
     const applied=await executeVoiceCommand({...action,...predictionIdentity(predictionSnapshot,frozen.observation),contextFingerprint,operation_scope:frozen.scope},{signal:signalCombined});
     if(action.actionId||action.id)await api('/agent/runs/'+a.runId+'/actions/'+(action.actionId||action.id)+'/ack',{method:'POST',body:JSON.stringify({...a,status:'success',contextRef:a.contextRef})});
     if(trace){trace.status='success';trace.finishedAt=new Date().toISOString();trace.durationMs=Date.now()-Date.parse(trace.startedAt);trace.result={summary:typeof applied==='string'?applied:applied.summary,applied:true};}
    } catch(error){if(action.actionId||action.id)await api('/agent/runs/'+a.runId+'/actions/'+(action.actionId||action.id)+'/ack',{method:'POST',body:JSON.stringify({...a,status:'failed',contextRef:a.contextRef,error:error.message})}).catch(()=>{});if(trace){trace.status='error';trace.error=error.message;trace.finishedAt=new Date().toISOString();}}
   }
   if(a.answer_variant!=='AI_EXPLAIN'&&a.actions?.length){const persisted=await api('/agent/runs/'+a.runId,{signal:signalCombined});a={...a,...persisted};for(const saved of a.trace||[]){const local=traces.find(item=>item.id===saved.id);if(local&&['success','failed'].includes(saved.status))Object.assign(local,saved);}}
   if((a.answerScope||'SNAPSHOT')==='SNAPSHOT'&&snapshotRequest)previousAssistantInput.current=clone({input:inputSnapshot,prediction:predictionSnapshot,observation:frozen.observation,identity_status:'VERIFIED'});
   const candidatePlans=a.results?.optimize?.plans || (Array.isArray(a.results?.optimize)?a.results.optimize:[]);
   if(candidatePlans.length&&runIsCurrent(a))setPlans(items=>mergeCandidateSources(items,candidatePlans.map(plan=>({...plan,baselineInput:clone(inputSnapshot)})),'BUILT_IN_CANDIDATE_SEARCH'));
   if(diagnosticKey)receiveDiagnostic(a);
   else publishTurn(turn,{...a,knowledge_ui_revision:knowledgeRevision,historical:(a.answerScope||'SNAPSHOT')==='SNAPSHOT'&&!runIsCurrent(a),role:'assistant',text:(a.reply||a.message||'').replace(/已请求定位[^\n]+等待三维视图打开测点。/g,()=>{const step=traces.find(t=>t.tool==='3D');return step?.status==='success'?step.result.summary:step?.error?.message||step?.error||'三维定位尚未完成';}),mode:a.mode,contextFingerprint,sampleTime,trace:traces,diagnosis_actions:a.answer_variant==='AI_EXPLAIN'?a.actions:undefined,actions:candidatePlans.length?['optimize']:undefined,artifact:a.results?.report?.artifact||a.results?.report,references:Array.isArray(a.references)?a.references:[]},{attempt,final:true});return candidateRequest||returnRun?a:knowledgeDisplayText(a.reply||a.message,a.references);

  }catch(e){
   if(!referenceIsCurrent())return;
   const failure=asAiTransportError(e,signalCombined);
   publishTurn(turn,previous=>({text:failure.message,error_code:failure.code,mode:'error',contextFingerprint,
    facts_state:previous.facts_state==='READY'?'READY':'FAILED',ai_explanation_state:'FAILED',ai_explanation_primary_failure:failure.code,
    diagnostic_sections:previous.diagnostic_sections?{...previous.diagnostic_sections,interpretation:failure.message}:undefined,
    retry:failure.name==='AbortError'?undefined:q}),{attempt,final:true});if(voice)throw failure;
  }finally{clearInterval(ticker);if(agentRequest.current===controller){setChatBusy(false);setRunState('');activeRun.current=null;agentRequest.current=null;}const currentStream=streamRef.current;if(resumeDemo&&!guidedTrial&&currentStream.mode==='demo'&&!currentStream.running&&currentStream.controlVersion===resumeDemo.controlVersion&&inputRevision.current===resumeDemo.inputRevision)currentStream.toggle();}
  }finally{if(ownsTurn&&assistantTurnActive.current===turn)assistantTurnActive.current=null;}
 };
 const explainPlan=async plan=>{
  const key=candidateExplanationKey(plan);
  if(!key||candidateExplanationRequest.current||agentRequest.current||chatBusy)return;
  const saved=plansRef.current.find(item=>candidateExplanationKey(item)===key);
  if(!saved||!currentBinding.current.valid||saved.baseline_snapshot_id!==completedRef.current.activeSnapshot?.snapshot_id||saved.mode!=='formal'){notify('当前候选基于旧工况，请重新生成。');return;}
  if(saved.candidate_source==='SMART_SEARCH'){
   if(saved.search_run_id!==activeSearchRunId.current||!candidateABReady(saved,null,currentBinding.current.valid)){notify('当前搜索结果已失效，请重新搜索。');return;}
   const b=saved.candidate_prediction,referenceIdentity=currentTargetReference.reference_identity;
   const token={key},identity={candidate_id:saved.id,candidate_identity:key,baseline_snapshot_id:saved.baseline_snapshot_id,
    search_run_id:saved.search_run_id,reference_identity:referenceIdentity,prediction_identity:reportInputFingerprint(predictionIdentity(b,b.observation))};
   candidateExplanationRequest.current=token;selectedCandidateExplanation.current=key;
   setSelectedCandidateIdentity(key);
   const source=completedRef.current,binding={...predictionIdentity(source.result,source.observation),contextFingerprint:reportInputFingerprint(source.caseData),operation_scope:operationScope()};
   const current=()=>candidateExplanationRequest.current===token&&selectedCandidateExplanation.current===key
    &&saved.search_run_id===activeSearchRunId.current&&currentRunMatches(binding,currentBinding.current)
    &&plansRef.current.some(item=>candidateExplanationKey(item)===key&&item.search_run_id===identity.search_run_id)
    &&referenceIdentity===targetReferenceProjection(source.result.value,source.result.inputContext.target,targetReferenceRef.current,source.result.snapshot_id).reference_identity;
   try{
    await smartReviewClient.current.review({identity,current,
     prepare:async signal=>{
      await verifyPredictionHashes(b);if(!current())return;
      const comparison=await api('/evidence/draft-comparison',{method:'POST',signal,body:JSON.stringify({baseline:source.result,prediction:b,candidate_preview_snapshot_id:saved.target_snapshot_id,source_plan_id:saved.id})});
      if(comparison.status!=='VALID')throw new Error('A/B依据未通过核验。');
     },
     body:{message:'这个方案怎么样？',question_driven:true,
      context:{caseData:source.result.inputContext,prediction:source.result,input_snapshot:source.activeSnapshot,observation:source.observation,
       operation_scope:binding.operation_scope,contextFingerprint:binding.contextFingerprint,targetReference:{...targetReferenceRef.current}},
      candidate_review:{candidate:{id:saved.id,baseline_snapshot_id:saved.baseline_snapshot_id,target_snapshot_id:saved.target_snapshot_id},prediction:b}},
     validate:response=>runIsCurrent(response)&&response.question_facts?.candidate_reference?.id===saved.id
      &&response.question_facts?.candidate_reference?.target_snapshot_id===saved.target_snapshot_id
      &&response.question_facts?.prediction_identity?.snapshot_id===b.snapshot_id,
     onLock:locked=>{if(!locked&&candidateExplanationRequest.current===token)candidateExplanationRequest.current=null;setCandidateReviewBusy(locked);},
     onState:state=>{if(candidateExplanationRequest.current===token)setExplanationByCandidateIdentity(values=>({...values,[key]:{...state,
      ...(state.reason==='STALE_REFERENCE'?{status:'stale_reference'}:{}),target_reference_identity:referenceIdentity}}));}
    });
   }finally{if(candidateExplanationRequest.current===token)candidateExplanationRequest.current=null;}
   return;
  }
  const token={key};candidateExplanationRequest.current=token;selectedCandidateExplanation.current=key;setCandidateReviewBusy(true);
  setExplanationByCandidateIdentity(values=>({...values,[key]:{status:'requesting'}}));
  try{
   const reference={id:saved.id,baseline_snapshot_id:saved.baseline_snapshot_id,target_snapshot_id:saved.target_snapshot_id};
   const response=await askRuns('DK AI解读此方案',{candidateRequest:reference});
   const valid=response&&runIsCurrent(response)&&candidateExplanationKey(response.candidate_reference)===key
     &&selectedCandidateExplanation.current===key&&plansRef.current.some(item=>candidateExplanationKey(item)===key);
   const explanation=valid?response.candidate_explanation:null;
   setExplanationByCandidateIdentity(values=>({...values,[key]:explanation?.status==='READY'
     ?{status:'ready',text:explanation.text,facts:explanation.facts,boundary:explanation.boundary}
     :{status:'unavailable',facts:explanation?.facts,boundary:explanation?.boundary}}));
  }catch{setExplanationByCandidateIdentity(values=>({...values,[key]:{status:'unavailable'}}));}
  finally{if(candidateExplanationRequest.current===token)candidateExplanationRequest.current=null;setCandidateReviewBusy(false);}
 };
 const trialPreviewAction=async(action,message)=>{
  if(trialConfirmation.current||chatBusy)return;
  const saved=messages.find(item=>item.runId===message.runId),preview=saved?.trial_preview;
  if(!preview||!['PENDING_CONFIRMATION','CONFIRMED'].includes(preview.status)||!currentRunMatches(saved,currentBinding.current)){notify('当前候选基于旧工况，请重新生成。');return;}
  const owner={runId:saved.runId};trialConfirmation.current=owner;setTrialConfirming(true);
  const patch=values=>setMessages(items=>items.map(item=>item.runId===saved.runId?{...item,...values}:item));
  try{
   if(action==='cancel'||action==='edit'){
    await api('/agent/runs/'+saved.runId+'/cancel',{method:'POST',body:'{}'});patch({trial_preview:{...preview,status:'CANCELLED'}});
    if(action==='edit'){setQuestion(saved.question);setAssistantOpen(true);}return;
   }
   if(action!=='confirm')return;
   stream.manual();
   const identity={...predictionIdentity(completedRef.current.result,completedRef.current.observation),contextFingerprint:saved.contextFingerprint,operation_scope:saved.operation_scope,contextRef:saved.contextRef,runId:saved.runId,confirmed:true};
   const response=await api('/agent/runs/'+saved.runId+'/trial/confirm',{method:'POST',body:JSON.stringify(identity)});
   if(!currentRunMatches(saved,currentBinding.current))throw new Error('当前候选基于旧工况，请重新生成。');
   const plan={...response.candidate,baselineInput:clone(completedRef.current.result.inputContext)};
   plansRef.current=[...plansRef.current,plan];setPlans(plansRef.current);patch({trial_preview:{...preview,status:'CONFIRMED'}});
   const loaded=await loadDraft(plan);if(!loaded)throw new Error('候选草案未载入，请重新生成。');
   setPage('optimize');await predictDraft();
   if(draftRef.current?.source_plan_id!==plan.id||draftRef.current.status!=='PREDICTED')throw new Error(draftRef.current?.error||'候选试算未完成，基线可能已变化。');
   if(!currentRunMatches(saved,currentBinding.current))return;
   const predictedValue=draftRef.current.prediction.value;
   setPlans(items=>items.map(item=>candidateExplanationKey(item)===candidateExplanationKey(plan)?{...item,predictedValue,risk:'模型复算'}:item));
   patch({trial_preview:{...preview,status:'COMPLETED'},trial_execution:{confirmed:true,draft_id:draftRef.current.draft_id,prediction_snapshot_id:draftRef.current.prediction.snapshot_id,ab_generated:true}});
   notify('A/B结果已生成 · QCDKR模型复算；是否采用仍由人工决定');
  }catch(error){notify(error.message);patch({trial_error:error.message});}
  finally{if(trialConfirmation.current===owner){trialConfirmation.current=null;setTrialConfirming(false);}}
 };
 const latestTrial=messages.findLast(item=>item.trial_preview);
 const guidedTrialStatus=trialConfirming?'正在试算':latestTrial&&!currentRunMatches(latestTrial,currentBinding.current)?'等待试算指令':latestTrial?.trial_preview?.status==='COMPLETED'?'用户候选已生成':['PENDING_CONFIRMATION','CONFIRMED'].includes(latestTrial?.trial_preview?.status)?'候选待确认':'等待试算指令';
 const diagnoseFinding=async(findingId,{returnRun=false,signal}={})=>{
  if(chatBusy||agentRequest.current||diagnosisRequest.current)return;
  const diagnostics=diagnosticsRef.current,finding=diagnostics?.findings.find(item=>item.finding_id===findingId&&item.status==='VALID');
  if(!finding||diagnostics.status!=='VALID'||!currentRunMatches(diagnostics.identity,currentBinding.current)){notify('诊断上下文不可用');return;}
  const token={findingId};diagnosisRequest.current=token;setDiagnosingFindingId(findingId);
  try{return await askRuns(findingDisplayTitle(finding)+'依据是什么？',{returnRun,signal,diagnosticRequest:{mode:'EXACT',answer_variant:'AI_EXPLAIN',finding_id:findingId}});}
  finally{if(diagnosisRequest.current===token){diagnosisRequest.current=null;setDiagnosingFindingId(null);}}
 };
 const diagnosticAction=async(action,message)=>{
  const check=()=>{if(!runIsCurrent(message)||!message.diagnosis_actions?.some(item=>item.id===action.id))throw new Error('该解读基于先前工况快照，请重新诊断');};
  try{
   check();await api('/agent/runs/'+message.runId+'/actions/'+action.id+'/authorize',{method:'POST',body:JSON.stringify({...message,contextRef:message.contextRef})});check();
   if(action.type==='open-decision-support'){setPage('optimize');return;}
   if(action.type==='open-input'){
     check();setPage('maintenance');notify('已打开系统状态与维护 · 当前工况检查');return;
   }
   if(action.type==='open-evidence'){
    const article=Array.from(document.querySelectorAll('[data-run-id]')).find(item=>item.dataset.runId===message.runId);
    const details=article?.querySelectorAll('.assistant-references[aria-label="系统证据依据"] details');
    if(!details?.length)throw new Error('本条诊断依据尚未载入');details.forEach(item=>{item.open=true;});article.scrollIntoView?.({block:'nearest'});return;
   }
   if(action.type!=='focus-finding')throw new Error('诊断动作不支持');
   setPage('overview');const deadline=Date.now()+7000;
   while(!sceneControlsRef.current&&Date.now()<deadline){check();await new Promise(resolve=>setTimeout(resolve,50));}
   check();if(!sceneControlsRef.current?.locateFindingTarget)throw new Error('三维视图尚未载入');
   sceneControlsRef.current.locateFindingTarget(action);
  }catch(error){notify(error.message);}
 };
 const executeVoiceCommand=async (action,{signal}={})=>{
  const actionBinding=action.snapshot_id?freezeReportPayload(action):null;
  const check=()=>{signal?.throwIfAborted();if(actionBinding&&!runIsCurrent(actionBinding))throw new Error('动作身份已过期，保留历史结果。');if(['load-draft','predict-draft','promote-draft','discard-draft','loadDraft','predictDraft','promoteDraft','discardDraft','focus-sample','open-replay'].includes(action.type))throw new Error('草案和当前工况变更仅允许人工操作；自动入口只读。');if(['apply-plan','apply-candidate','undo-plan','applyPlan'].includes(action.type))rejectPlanApplication();};
  check();
  const waitForView=async(selector)=>{const until=Date.now()+7000;while(Date.now()<until){check();if(document.querySelector(selector)?.getClientRects().length)return;await new Promise(resolve=>setTimeout(resolve,60));}throw new Error('目标视图尚未完成载入。');};
  if(action.type==='open-event'){
    if(!action.eventId)throw new Error('缺少事件编号。');
    const response=await api('/events?query='+encodeURIComponent(action.eventId),{signal});
    const event=(Array.isArray(response)?response:response.items||[]).find(item=>item.id===action.eventId);
    if(!event)throw new Error('没有找到所选事件记录。');
    check();setSelectedEvent(event);setAssistantOpen(true);setPage('overview');
    await waitForView('[data-selected-event="'+CSS.escape(action.eventId)+'"]');return '已在助手中载入所选事件的核查上下文';
  }
  if(action.type==='open-replay'){
    if(!Array.isArray(action.frames)||!action.frames.length)throw new Error('缺少该事件对应的样本数据。');
    const position=Math.max(0,Math.min(action.frames.length-1,Math.trunc(action.currentIndex)||0));
    const selectedFrame=action.frames[position],input=selectedFrame.input||selectedFrame.caseData||selectedFrame;
    stream.loadFrames(action.frames,'AI 选择的样本片段',position);setPage('overview');
    await waitForView('.dashboard-workspace');
    const until=Date.now()+7000;
    while(Date.now()<until){
      signal?.throwIfAborted();
      const dashboard=document.querySelector('.dashboard-workspace');
      if(dashboard?.dataset.streamCursor===String(position)&&dashboard?.dataset.streamCount===String(action.frames.length)&&modelInputFingerprint(currentCaseRef.current)===modelInputFingerprint(input))return '已在预测工作台中载入对应样本片段并定位第 '+(position+1)+' 条记录';
      await new Promise(resolve=>setTimeout(resolve,60));
    }
    throw new Error('所选样本尚未在预测工作台中完成载入。');
  }
  if(action.type==='open-comparison'){
    if(!action.comparison||!Number.isFinite(action.comparison.currentT)||!Number.isFinite(action.comparison.referenceT))throw new Error('比较结果尚不完整。');
    setComparisonView({comparison:action.comparison,reference:action.comparisonRef});setActionPanel('comparison');
    await waitForView('[data-comparison-ref="'+CSS.escape(action.comparisonRef)+'"]');return '已打开本次工况对比';
  }
  if(action.type==='focus-sample'){
    if(!action.input||!validateCaseImport(action.input,rangeTable,readCustomLimits(window.localStorage)).valid)throw new Error('没有可载入的对应样本快照。');
    loadSavedCase({input:action.input,name:action.input.id});await waitForView('.dashboard-workspace');
    const until=Date.now()+5000;while(modelInputFingerprint(currentCaseRef.current)!==modelInputFingerprint(action.input)&&Date.now()<until){await new Promise(resolve=>setTimeout(resolve,50));}
    if(modelInputFingerprint(currentCaseRef.current)!==modelInputFingerprint(action.input))throw new Error('样本尚未载入。');return '已载入对应样本';
  }
  if(action.type==='focus-stand')action={type:'select_stand',stand:action.stand};
  if(action.type==='set_source'){if(typeof action.open!=='boolean')throw new Error('操作参数无效');setPage(action.open?'data':'overview');await waitForView(action.open?'.data-access':'.dashboard-workspace');return action.open?'已打开数据接入':'已返回预测工作台';}
  if(action.type==='navigate'){
   const names={overview:'预测工作台',events:'预测工作台',replay:'预测工作台',history:'预测工作台',data:'数据接入','saved-data':'已保存工况',maintenance:'维护设置',logs:'运行日志',optimize:'工况试算',draft:'方案工况',reports:'结果导出'};
   if(!names[action.page])throw new Error('没有这个页面');setPage(action.page);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return '已打开'+names[action.page];
  }
  if(action.type==='read_prediction'){
   if(dirty)throw new Error('预测正在更新，请稍后再读');
   return `当前 S5 预测 ${engineering('force',result.value)}，目标 ${engineering('force',caseData.target)}，${result.value>=caseData.target?'高于':'低于'}目标 ${engineering('force',Math.abs(result.value-caseData.target))}。`;
  }
  if(page!=='overview')setPage('overview');
  const until=Date.now()+8000;
  while(!sceneControlsRef.current&&Date.now()<until){signal?.throwIfAborted();await new Promise(resolve=>setTimeout(resolve,50));}
  check();
  if(!sceneControlsRef.current)throw new Error('视图正在载入，请稍后再试');
  const reply=await sceneControlsRef.current.execute(action);
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  return reply;
 };
 const assistantAction=(action,message)=>{if(!runIsCurrent(message)){notify('该结果属于先前工况或旧实际值，请重新分析');return;}if(['apply','applyPlan','undo','generate','loadDraft','predictDraft','promoteDraft','discardDraft','load-draft','predict-draft','promote-draft','discard-draft'].includes(action)){applyPlan();return;}if(action==='three'){setPage('overview');globalThis.__qcdkrInspectRequest={stand:selected,at:Date.now()};window.setTimeout(()=>window.dispatchEvent(new CustomEvent('qcdkr:inspect',{detail:{stand:selected}})),500);return;}if(action==='generate'){setPage('optimize');generate();}else setPage(action);};
 const importFile=async(ev)=>{const f=ev.target.files?.[0];if(!f)return;try{const {input:incoming,audit}=await parseCaseFile(f,caseData,{chooseLegacyUnits:chooseImportUnits});const validation=assertCaseImportValid(incoming,rangeTable,readCustomLimits(globalThis.localStorage),audit);invalidatePrediction();pendingFrame.current=null;stream.manual();setPredictionEpoch(value=>value+1);setSessionKey(key=>key+1);unsavedEdits.current={parameterEdits:false,dataEdits:false};setOptimizationTask(null);currentCaseRef.current=newDashboardInput(incoming);setCase(currentCaseRef.current);setAppliedPlan(null);setDirty(true);setPlans([]);setErrors([]);notify('已导入 '+f.name+'，预测自动同步'+(validation.trueOutOfRange.length?' · '+validation.trueOutOfRange.length+'项超出当前参考范围':''));setDataTab('current');if(page!=='data')setPage('data');}catch(e){notify('导入失败：'+(e.category==='PARSER_SCHEMA_ERROR'?'解析 / schema错误（PARSER_SCHEMA_ERROR）：':'')+e.message);}ev.target.value='';};
 const currentDiagnostics=currentDiagnosticsFor({result,observation,resultCase,currentBinding:currentBinding.current,auditBundle,dirty,operation_scope:operationScope()});
 if(activeSnapshot&&!dirty&&currentRunMatches({...predictionIdentity(result,observation),contextFingerprint:reportInputFingerprint(resultCase),operation_scope:operationScope()},currentBinding.current))coherentProjection.current={completed,binding:{...currentBinding.current},audit:sameIdentity(auditIdentity.current,predictionIdentity(result,observation))?auditBundle:{status:'PENDING',evidence:[],findings:[]},frame:completed.frame,updatedAt:lastUpdated};
 diagnosticsRef.current=currentDiagnostics;
 const [soleDiagnostic]=currentDiagnostics.findings;
 const diagnosticShortcutTitle=currentDiagnostics.status==='VALID'&&currentDiagnostics.findings.length===1?findingDisplayTitle(soleDiagnostic):null;
 const reportAudit=evidenceForIdentity({status:auditBundle.status,evidence:[...(auditBundle.evidence || []),...(draftAudit.evidence || [])],findings:[...(auditBundle.findings || []),...(draftAudit.findings || [])]},result,observation);
 const currentReportPayload={evidence:reportAudit.evidence,findings:reportAudit.findings,evidence_status:reportAudit.status,input:resultCase,prediction:result,snapshot:activeSnapshot,observation,operation_scope:currentBinding.current.operation_scope,analysisParameters:{selectedStand:selected,reference:agentReference,dataMode:stream.mode,currentIndex:stream.cursor},frames:stream.frames,plans:plans.length?plans:appliedPlan?[appliedPlan.plan]:[],appliedPlan,aiMessages:messages,meta:{...resultSample,createdAt:lastUpdated.toISOString(),model:assistantStatus.model},sections:reportSections};
 const doExport=async(type,{current=false}={})=>{
  if(dirty&&(!reportSnapshot||type==='regenerate')){notify('预测结果正在同步，请稍后生成报告');return;}
  const exportRequest=exportGate.current.begin(),busyRequest=beginBusy(type);
  try{
   const frozenPayload=freezeReportPayload(current||type==='regenerate'?currentReportPayload:reportSnapshot||currentReportPayload);
   const validated=freezeReportPayload(await api('/report/validate',{method:'POST',body:JSON.stringify(frozenPayload)}));
   const payload=!current&&reportSnapshot&&type!=='regenerate'?frozenPayload:validated;
   if(!exportRequest.current())return;
   if(!reportSnapshot||type==='regenerate')setReportSnapshot(payload);
   if(type==='json')exportJSON(payload);
   if(type==='csv')exportCSV(payload.input,payload.meta);
   if(type==='word')await exportWord(payload);
   if(type==='ppt')await exportPowerPoint(payload);
   let exportReceipt={format:type,downloadRequested:['json','csv','word','ppt'].includes(type),fileSaved:false};
   if(type==='pdf'){
    stream.pause();setActionPanel('report');
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    if(window.dkqkarDesktop?.saveReportPdf){const saved=await window.dkqkarDesktop.saveReportPdf();if(saved.error)throw new Error(saved.error);if(saved.canceled)return {format:type,cancelled:true,fileSaved:false};notify('PDF 已保存');exportReceipt={format:type,fileSaved:true,path:saved.path||saved.filePath||null};}else {window.print();exportReceipt={format:type,printDialogOpened:true,fileSaved:false};}
   }else notify(type==='regenerate'?'报告已重新生成':'报告文件已生成');
   return exportReceipt;
  }catch(e){notify('导出失败：'+e.message);return {error:e.message};}finally{exportRequest.commit(()=>finishBusy(busyRequest));}
 };
 const isWorkbench=page==='overview';
 const title=pages.find(p=>p[0]===page)?.[1]||'欢迎使用';
 function Stat({label,value,unit,foot,icon:Icon,tone=''}){return <div className={'stat '+tone}><div className="stat-top"><span>{label}</span><Icon size={17}/></div><div className="stat-value">{value}<small>{unit}</small></div><div className="stat-foot">{foot}</div></div>}
 const currentInputBound=currentBinding.current.contextFingerprint===reportInputFingerprint(caseData)
  ||currentBinding.current.contextFingerprint===reportInputFingerprint(resultCase)
   &&reportInputFingerprint(withoutObservation(caseData))===reportInputFingerprint(withoutObservation(resultCase))
   &&caseData.stands.find(stand=>stand.id==='S5').force===observation?.value
   &&caseData.importProvenance?.observed===observation?.value
   &&caseData.importProvenance?.observedAvailable===(observation?.value!==null);
 const modelProps={industrialStatus:industrialDisplayConnection.status,currentPredictionBound:formalModelReady(modelStatus)&&currentBinding.current.valid&&currentBinding.current.snapshot_id===result.snapshot_id&&currentBinding.current.input_hash===result.input_hash&&currentInputBound&&result.model_hash===modelStatus.model_hash&&result.model_version===modelStatus.model_version,dashboardTargetValue:caseData.importProvenance?.target_source==='USER_INPUT'&&Number.isFinite(caseData.target)?caseData.target:!dirty&&currentBinding.current.valid?optimizationTask?.targetValueT??null:null,predictionErrorAlarmRange,predictionContextIdentity,onPredictionErrorAlarmRangeChange,onConstraintChange:()=>setConstraintRevision(value=>value+1),targetReference,currentTargetReference,onTargetReferenceChange,cases,caseData,predictionPending,predictionState,activeCommittedSnapshot:committedSnapshot,onRetryPrediction:()=>queueCurrentPrediction(readActiveProjection(),{recovered:false}),onApplyParameters:input=>{if(!summarizeModelInputs(input).valid)return false;update(()=>input);return true;},onEditDirty:value=>{if(page!=='data')parameterEditors.current.matrix=value;unsavedEdits.current=page==='data'?{...unsavedEdits.current,dataEdits:value}:{...unsavedEdits.current,parameterEdits:value};},observationMatches:resultSample?.observedAvailable===true,resultCase,resultSample,modelStatus,sessionKey,lastUpdated,predictionValue:result.value,selected,setSelected,view,setView,explode,setExplode,showStrip,setShowStrip,result,dirty,autoStatus,errors,onFieldChange:(id,key,value)=>update(c=>updateStandField(c,id,key,value)),onCaseFieldChange:(key,value)=>update(c=>({...c,[key]:value})),onTargetChange:value=>update(c=>({...c,target:value})),onNavigate:setPage,onBeginEdit:()=>stream.pause(),onImport:()=>fileRef.current.click(),onTemplate:()=>exportCSV(caseData,caseData.importProvenance||resultSample),onLoadSample:input=>{setSessionKey(key=>key+1);setAppliedPlan(null);invalidatePrediction();pendingFrame.current=null;stream.manual();setPredictionEpoch(value=>value+1);setOptimizationTask(null);currentCaseRef.current=newDashboardInput(input);setCase(currentCaseRef.current);setDirty(true);setErrors([]);setPlans([]);},onReset:()=>{setSessionKey(key=>key+1);invalidatePrediction();pendingFrame.current=null;stream.manual();setPredictionEpoch(value=>value+1);setOptimizationTask(null);currentCaseRef.current=newDashboardInput(defaultInput.current);setCase(currentCaseRef.current);setDirty(true);setPlans([]);setAppliedPlan(null);notify('已恢复初始工况');}};
 modelProps.pendingStreamProjection=pendingStreamPredictionDisplay({dirty,predictionState,stream,modelStatus,completed:coherentProjection.current?.completed});
 const currentDraft=validateDraftBaseline(workingDraft,currentBinding.current)?workingDraft:null;
 const hasCurrentCandidates=currentBinding.current.valid&&plans.some(plan=>plan.baseline_snapshot_id===activeSnapshot?.snapshot_id&&plan.mode===result.mode&&plan.model_hash===result.model_hash&&plan.model_version===result.model_version);
 const abStatus=currentDraft?.status==='PREDICTING'?'验证中':currentDraft?.status==='PREDICTED'&&currentDraft.prediction?'结果已生成':hasCurrentCandidates||currentDraft?.status==='LOADED'?'待验证':'等待候选方案';
 const systemCandidates=plans.filter(plan=>candidateDisplaySource(plan)==='BUILT_IN_CANDIDATE_SEARCH'&&plan.baseline_snapshot_id===result.snapshot_id&&currentBinding.current.valid);
 const systemABReady=currentDraft?.status==='PREDICTED'&&currentDraft.prediction&&systemCandidates.some(plan=>plan.target_snapshot_id===currentDraft.candidate_preview_snapshot_id&&plan.id===currentDraft.source_plan_id);
 const modelCandidateStatus=candidateQuickStatus(candidatePolicy);
 const policyRun=candidatePolicy.activeRun;
 const policySearchState=candidatePolicy.searchState||{status:candidatePolicy.status==='NO_RUN'?'IDLE':candidatePolicy.status};
 const policySelection=async(policy,expectedPlan)=>{
  try{
   const run=policyOwner.current.state().activeRun,plan=run?.recommendations?.find(item=>item.recommendation_labels?.includes(POLICY_WINNERS[policy]));
   const registered=plansRef.current.find(item=>candidateExplanationKey(item)===candidateExplanationKey(expectedPlan||plan));
   if(dirty||predictionState!=='READY'||run?.status!=='COMPLETED'||run.search_run_id!==activeSearchRunId.current
    ||!candidateABReady(plan,null,currentBinding.current.valid)
    ||!registered||registered.id!==plan.id||registered.target_snapshot_id!==plan.target_snapshot_id)throw Object.assign(Error('PLAN_STALE'),{code:'PLAN_STALE'});
   const validatedIdentity=assertSelectedPlanCurrent(registered);
   const source=completedRef.current;
   const prepared=createDraft(registered,source.result,source.activeSnapshot,currentBinding.current);
   acceptDraftPrediction({...prepared,status:'PREDICTING'},registered.candidate_prediction);
   await verifyPredictionHashes({input_snapshot:registered.input_snapshot});await verifyPredictionHashes(registered.candidate_prediction);
   assertSelectedPlanCurrent(registered,validatedIdentity);
   policyOwner.current.select(policy);setActionPanel(null);setPage('overview');setWorkbenchViewMode('PREVIEW');notify('已选择「'+POLICY_LABELS[policy]+'」');return true;
  }catch(error){notifyPlanRejection(error);return false;}
 };
 const regeneratePolicyTrend=()=>{if(dirty||predictionState!=='READY'||!currentBinding.current.valid){notify('等待当前工况预测完成后重新生成曲线');return;}stream.pause();if(policyOwner.current.regenerateRevealed())notify('正在重新生成三条对比曲线');};
 const policyDraft=candidatePolicy.selectedPolicy&&candidatePolicy.candidateIds?.includes(workingDraft?.source_plan_id)
  &&workingDraft?.source_plan_id!==candidatePolicy.selectedWinner?.id?null:workingDraft;
 const taskHost=useRef(null);
 const appliedTaskActions=useRef(new Map());
 const readTaskContext=goal=>freezeReportPayload({...captureAssistantTurn(goal||'读取任务执行后的工况').context,targetReference:{...targetReferenceRef.current}});
 taskHost.current={page,actionPanel,predictionState,readContext:readTaskContext};
 const executeTaskUI=async(action,{task,step,signal})=>{
  signal?.throwIfAborted();
  if(!action||typeof action.type!=='string')throw new Error('任务没有返回可执行的界面动作。');
  const taskActionKey=`${task?.taskId||task?.id||''}:${step?.stepId||''}:${step?.argumentsDigest||''}`;
  if(taskActionKey!=='::'&&appliedTaskActions.current.has(taskActionKey))return appliedTaskActions.current.get(taskActionKey);
  const wait=async inspect=>{
   for(;;){signal?.throwIfAborted();const value=inspect();if(value)return value;await new Promise(resolve=>setTimeout(resolve,60));}
  };
  const receipt=observed=>({verified:true,actionType:action.type,observed,context:taskHost.current.readContext()});
  const requireWrite=()=>assertTaskWriteBinding(task,step,{contextFingerprint:reportInputFingerprint(currentCaseRef.current),operationScope:operationScope()});
  const awaitCommitted=async(revision,fingerprint)=>{
   await wait(()=>{
    if(inputRevision.current!==revision||modelInputFingerprint(currentCaseRef.current)!==fingerprint)throw new Error('执行期间工况又发生变化，未把其他工况记为本次结果。');
    if(taskHost.current.predictionState==='FAILED')throw new Error('工况已载入，但正式预测未完成；未声明整步成功。');
    return currentBinding.current.valid&&currentBinding.current.operation_scope?.revision===revision;
   });
   return receipt({inputFingerprint:reportInputFingerprint(currentCaseRef.current),modelInputFingerprint:modelInputFingerprint(currentCaseRef.current),operationScope:operationScope(),snapshotId:completedRef.current.result.snapshot_id,predictionReady:true});
  };
  if(action.type==='task-load-case'){
   requireWrite();if(!action.record?.input)throw new Error('任务未提供可核验的已保存工况。');
   assertCaseImportValid(action.record.input,rangeTable,readCustomLimits(window.localStorage));
   stream.pause({temporary:true});if(pauseRebind.current)await pauseRebind.current;requireWrite();
   loadSavedCase(action.record);
   return awaitCommitted(inputRevision.current,modelInputFingerprint(action.record.input));
  }
  if(action.type==='task-promote-trial'){
   const taskIdentity=task.taskId||task.id;
   const beforeInput=clone(currentCaseRef.current);
   try{
    requireWrite();if(draftPromotion.current||busyLabel.current)throw new Error('当前工况正在提交其他操作，本次采用尚未执行。');
    const input=action.input,prediction=action.prediction,snapshot=action.input_snapshot||prediction?.input_snapshot;
    if(!input||!prediction||input.importProvenance?.source_type!=='HYPOTHETICAL_DRAFT'||prediction.observation?.value!==null||input.stands?.find(item=>item.id==='S5')?.force!==null)throw new Error('采用的试算必须保留假设工况身份，且没有伪造实际值。');
    assertPredictionBinding(prediction,input,{input_snapshot:snapshot,mode:'formal',model_hash:completedRef.current.result.model_hash,model_version:completedRef.current.result.model_version});
    assertObservationBinding(prediction.observation,snapshot);await verifyPredictionHashes(prediction);
    const baseline=completedRef.current.result;
    const draft=freezeReportPayload({draft_id:action.draftId||crypto.randomUUID(),source_plan_id:action.candidateId||step.stepId,baseline_snapshot_id:baseline.snapshot_id,candidate_preview_snapshot_id:action.previewSnapshotId||null,created_at:new Date().toISOString(),input,status:'PREDICTED',prediction,snapshot,source_mode:'formal',changes:action.changes||[],baseline_identity:{snapshot_id:baseline.snapshot_id,input_hash:baseline.input_hash,model_hash:baseline.model_hash,model_version:baseline.model_version,prediction_mode:baseline.mode,contextFingerprint:reportInputFingerprint(baseline.inputContext)},baseline_prediction:baseline,error:null});
    promotionRetry(draft,currentBinding.current);writeDraft(draft);await promoteDraft();
    if(modelInputFingerprint(currentCaseRef.current)!==modelInputFingerprint(input))throw new Error('候选未载入当前工作台，未登记变更。');
    // The workspace has been replaced. Cache the observed application before
    // waiting for the prediction, so a duplicate dispatch reuses this receipt
    // instead of executing the same write a second time.
    const appliedReceipt=receipt({inputFingerprint:reportInputFingerprint(currentCaseRef.current),modelInputFingerprint:modelInputFingerprint(currentCaseRef.current),operationScope:operationScope(),snapshotId:prediction.snapshot_id,predictionReady:false,appliedBeforePredictionFailure:true});
    appliedTaskActions.current.set(taskActionKey,appliedReceipt);
    setLastTaskChange({taskId:taskIdentity,stepId:step.stepId,input:beforeInput,at:Date.now()});
    try{
     const committed=awaitCommitted(inputRevision.current,modelInputFingerprint(input));
     appliedTaskActions.current.set(taskActionKey,committed);
     return committed;
    }catch{return appliedReceipt;}
   }catch(error){
    // A stale binding or a duplicate dispatch can arrive after the approved
    // candidate is already on the workbench. Report the observed application
    // instead of turning a real write into a task failure.
    if(action.input&&modelInputFingerprint(currentCaseRef.current)===modelInputFingerprint(action.input)){
     const appliedReceipt=receipt({inputFingerprint:reportInputFingerprint(currentCaseRef.current),modelInputFingerprint:modelInputFingerprint(currentCaseRef.current),operationScope:operationScope(),snapshotId:action.prediction?.snapshot_id||null,predictionReady:false,appliedAfterStaleBinding:true});
     appliedTaskActions.current.set(taskActionKey,appliedReceipt);
     setLastTaskChange(previous=>previous?.taskId===taskIdentity&&previous?.stepId===step.stepId?previous:{taskId:taskIdentity,stepId:step.stepId,input:beforeInput,at:Date.now()});
     return appliedReceipt;
    }
    throw error;
   }
  }
  if(['task-import-data','task-import-file'].includes(action.type)){
   requireWrite();if(taskImportOwner.current)throw new Error('另一次文件选择仍在等待完成。');
   let owner;
   const imported=await new Promise((resolve,reject)=>{
    owner={taskId:task.taskId||task.id,task,step,resolve,reject};taskImportOwner.current=owner;setTaskImportRequest({taskId:owner.taskId});
    signal?.addEventListener('abort',()=>{if(taskImportOwner.current===owner){taskImportOwner.current=null;setTaskImportRequest(null);}reject(signal.reason||new Error('任务已取消。'));},{once:true});
   }).finally(()=>{if(taskImportOwner.current===owner){taskImportOwner.current=null;setTaskImportRequest(null);}});
   const result=await awaitCommitted(imported.revision,imported.fingerprint);return {...result,observed:{...result.observed,fileName:imported.fileName,imported:true}};
  }
  if(action.type==='task-upload-knowledge'){
   assertTaskApproval(task,step);if(taskImportOwner.current)throw new Error('另一次文件选择仍在等待完成。');let owner;
   const uploaded=await new Promise((resolve,reject)=>{owner={taskId:task.taskId||task.id,kind:'knowledge',task,step,signal,resolve,reject};taskImportOwner.current=owner;setTaskImportRequest({taskId:owner.taskId,kind:'knowledge'});signal?.addEventListener('abort',()=>{if(taskImportOwner.current===owner){taskImportOwner.current=null;setTaskImportRequest(null);}reject(signal.reason||new Error('资料上传任务已取消。'));},{once:true});}).finally(()=>{if(taskImportOwner.current===owner){taskImportOwner.current=null;setTaskImportRequest(null);}});
   return receipt(uploaded);
  }
  if(action.type==='task-set-target-reference'){
   assertTaskApproval(task,step);const previous=readTargetReference(window.localStorage);
   if(previous.revision!==action.expected_revision)throw new Error('目标参考值已由其他操作更新，旧版本确认未执行。');
   if(!onTargetReferenceChange(action.source,action.value))throw new Error('目标参考值没有通过现有校验或未写入。');
   const next=readTargetReference(window.localStorage);
   if(next.revision!==previous.revision+1||next.source!==action.source||next.source==='USER_CUSTOM_OVERRIDE'&&next.custom_t!==action.value)throw new Error('目标参考值没有返回匹配的持久化结果。');
   return receipt({targetReference:next,before:previous,source:next.source,value:next.custom_t??null,revision:next.revision});
  }
  if(action.type==='task-open-comparison'){
   if(!action.comparisonRef||!Number.isFinite(action.comparison?.currentT)||!Number.isFinite(action.comparison?.referenceT))throw new Error('任务没有提供真实完整的比较结果。');
   setComparisonView({comparison:action.comparison,reference:action.comparisonRef});setActionPanel('comparison');
   await wait(()=>document.querySelector('[data-comparison-ref="'+CSS.escape(action.comparisonRef)+'"]')?.getClientRects().length);
   return receipt({comparisonRef:action.comparisonRef,open:true,currentT:action.comparison.currentT,referenceT:action.comparison.referenceT});
  }
  if(action.type==='task-open-replay'){
   requireWrite();if(!Array.isArray(action.frames)||!action.frames.length||!Number.isInteger(action.currentIndex)||action.currentIndex<0||action.currentIndex>=action.frames.length)throw new Error('任务没有提供明确的回放样本位置。');
   const input=action.frames[action.currentIndex]?.input;if(!input)throw new Error('回放记录没有可核验的工况输入。');
   assertCaseImportValid(input,rangeTable,readCustomLimits(window.localStorage));stream.pause({temporary:true});if(pauseRebind.current)await pauseRebind.current;requireWrite();
   stream.loadFrames(action.frames,'AI任务选择的真实样本片段',action.currentIndex);setActionPanel(null);setPage('overview');
   const revision=inputRevision.current;
   await wait(()=>{const host=document.querySelector('.dashboard-workspace');return host?.dataset.streamCursor===String(action.currentIndex)&&host.dataset.streamCount===String(action.frames.length);});
   const result=await awaitCommitted(revision,modelInputFingerprint(input));
   return {...result,observed:{...result.observed,streamCursor:action.currentIndex,streamCount:action.frames.length,replayLoaded:true}};
  }
  if(action.type==='task-export-report'){
   if(!['json','csv','word','ppt','pdf'].includes(action.format))throw new Error('报告导出格式未注册。');
   if(action.format==='json'&&typeof action.artifact?.content==='string')return receipt({format:action.format,...await downloadTaskArtifact(action.artifact)});
   if(action.format!=='json'){
    const source=action.reportContext;
    if(!source?.caseData||!source.prediction||!source.input_snapshot||!source.observation)throw new Error('该格式没有提供可核验的冻结报告工况，未使用其他当前工况代替。');
    assertPredictionBinding(source.prediction,source.caseData,{input_snapshot:source.input_snapshot,mode:'formal'});assertObservationBinding(source.observation,source.input_snapshot);await verifyPredictionHashes(source.prediction);
    const sample=withAcceptedObservation(resultSampleMetadata({mode:'manual',input:source.caseData}),source.observation);
    const frozen=freezeReportPayload({input:source.caseData,prediction:source.prediction,snapshot:source.input_snapshot,observation:source.observation,evidence:[],findings:[],evidence_status:'UNAVAILABLE',analysisParameters:{dataMode:'single'},frames:[],plans:[],appliedPlan:null,aiMessages:[],sections:reportSections,meta:{...sample,createdAt:new Date().toISOString(),model:source.prediction.model_version}});
    const payload=freezeReportPayload(await api('/report/validate',{method:'POST',body:JSON.stringify(frozen)}));
    if(payload.prediction?.snapshot_id!==source.prediction.snapshot_id)throw new Error('报告核验返回了不同快照，未导出。');
    // Existing exporters build the document from this validated frozen payload,
    // never from the current screen or a JSON artifact with a renamed suffix.
    buildReport(payload);let observed={format:action.format,sourceSnapshotId:source.prediction.snapshot_id,fileSaved:false};
    if(action.format==='csv'){exportCSV(payload.input,payload.meta);observed.downloadRequested=true;}
    else if(action.format==='word'){await exportWord(payload);observed.downloadRequested=true;}
    else if(action.format==='ppt'){await exportPowerPoint(payload);observed.downloadRequested=true;}
    else if(action.format==='pdf'){
     setReportSnapshot(payload);setActionPanel('report');await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
     if(window.dkqkarDesktop?.saveReportPdf){const saved=await window.dkqkarDesktop.saveReportPdf();if(saved.error||saved.canceled)throw new Error(saved.error||'PDF保存已取消。');observed={...observed,fileSaved:true,path:saved.path||saved.filePath||null};}
     else{window.print();observed.printDialogOpened=true;}
    }
    return receipt(observed);
   }
   const artifactUrl=action.artifact?.downloadUrl||action.artifact?.url||action.artifact?.href;
   if(artifactUrl){const url=new URL(artifactUrl,window.location.origin);if(url.origin!==window.location.origin||!url.pathname.startsWith('/api/'))throw new Error('任务成果的下载地址不属于当前服务。');const link=document.createElement('a');link.href=url.href;link.download=action.artifact.name||action.artifact.filename||'';document.body.appendChild(link);link.click();link.remove();return receipt({format:action.format,downloadRequested:true,downloadInitiated:true,fileSaved:false,artifact:action.artifact});}
   if(task.contextIdentity.contextFingerprint!==reportInputFingerprint(currentCaseRef.current))throw new Error('当前工况已变化，未导出其他工况的报告。');
   const exported=await doExport(action.format,{current:true});if(!exported||exported.error||exported.cancelled)throw new Error(exported?.error||'报告保存已取消或没有完成。');
   return receipt({...exported,downloadInitiated:exported.downloadRequested===true,printOpened:exported.printDialogOpened===true,saved:exported.fileSaved===true,contextFingerprint:task.contextIdentity.contextFingerprint});
  }
  if(action.type==='navigate'){
   const targets={overview:'.dashboard-workspace',events:'.dashboard-workspace',history:'.dashboard-workspace',replay:'.dashboard-workspace',input:'.dashboard-workspace',prediction:'.dashboard-workspace',three:'.dashboard-workspace',data:'.data-access','saved-data':'.data-access',maintenance:'.maintenance-workspace',logs:'.logs-workspace',optimize:'.ops-optimization',draft:'.ops-optimization',reports:'.report-preview'};
   if(!targets[action.page])throw new Error('任务请求了未注册的工作区。');setPage(action.page);
   await wait(()=>document.querySelector(targets[action.page])?.getClientRects().length);
   return receipt({page:action.page,rendered:true});
  }
  const sceneTypes=['select_stand','set_view','set_shell','set_lighting','set_scope','set_stream','set_fullscreen','set_explode','set_matrix','set_motion','reset_camera','zoom','set_walk','focus-measurement'];
  if(!sceneTypes.includes(action.type))throw new Error('该界面动作尚未接通，未执行或声明成功。');
  if(action.type==='set_motion'&&action.playing===false)throw new Error('设备动画目前保持自动播放；没有把暂停口令冒充已生效。');
  if(taskHost.current.page!=='overview'){setActionPanel(null);setPage('overview');}
  await wait(()=>{const phase=document.querySelector('.three-viewer')?.dataset.phase;if(phase==='error')throw new Error('三维设备未能载入。');return sceneControlsRef.current;});
  const before=sceneControlsRef.current.getState();await sceneControlsRef.current.execute(action);
  const observed=await wait(()=>{const current=sceneControlsRef.current?.getState();return sceneActionMatches(action,current,before)?current:null;});
  return {...receipt(observed),before};
 };
 const executeTaskUISafe=async(action,args)=>{
  const before=modelInputFingerprint(currentCaseRef.current);
  try{return await executeTaskUI(action,args);}
  catch(error){
   // The only thing that makes a failed UI step "already applied" is an actual
   // change of the workbench input. This catch-all sits outside every branch so
   // a stale binding or duplicate dispatch cannot overwrite a real write.
   if(modelInputFingerprint(currentCaseRef.current)!==before){
    return {verified:true,actionType:action.type,observed:{appliedAfterError:true},context:readTaskContext()};
   }
   throw error;
  }
 };
 const nativeTaskRuntime=useTaskRuntime({enabled:!!appSessionId,getContext:readTaskContext,executeUI:executeTaskUISafe,accessMode:assistantMode});
 // A live demo stream advances every second. Freeze it for the lifetime of the
 // task so the frozen context and the workspace revision stay identical; a
 // write that becomes stale mid-planning is correctly rejected, but a copilot
 // task must not be designed to lose that race. Resume only after a terminal
 // state, never while waiting for approval or user input.
 const startCopilotTask=async goal=>{
  const resumeAfter=stream.running===true||stream.mode==='demo'||stream.mode==='import';
  taskResumeAfter.current=resumeAfter;
  stream.pause({temporary:true});
  // Freeze first, then wait for the committed prediction of the paused row.
  // Capturing while a sample is still settling produces revision N with a
  // stale/invalid binding, and every write is then correctly rejected.
  const deadline=Date.now()+10000;
  while((dirtyRef.current||predictionStateRef.current!=='READY'||!currentBinding.current.valid)&&Date.now()<deadline){
    if(predictionStateRef.current==='FAILED')break;
    await new Promise(resolve=>setTimeout(resolve,120));
  }
  if(dirtyRef.current||predictionStateRef.current!=='READY'||!currentBinding.current.valid){
    if(resumeAfter&&!stream.running)stream.toggle();
    throw new Error(predictionStateRef.current==='FAILED'?'当前工况预测失败，暂不能发起任务。':'当前工况预测尚未完成，请稍后再试。');
  }
  copilotTaskActive.current=true;
  try{return await nativeTaskRuntime.start(goal);}
  catch(error){copilotTaskActive.current=false;if(resumeAfter&&!stream.running)stream.toggle();throw error;}
 };
 useEffect(()=>{
  const status=nativeTaskRuntime.selected?.status;
  if(!status||!copilotTaskActive.current)return;
  if(!TASK_TERMINAL.has(status)&&status!=='context_stale')return;
  copilotTaskActive.current=false;
  if(taskResumeAfter.current&&!stream.running)stream.toggle();
 },[nativeTaskRuntime.selected?.status]);
 const uploadTaskKnowledge=async ev=>{
  const owner=taskImportOwner.current,file=ev.target.files?.[0];ev.target.value='';if(!owner||owner.kind!=='knowledge')return;
  if(!file){owner.reject(new Error('没有选择资料文件。'));return;}
  try{
   assertTaskApproval(owner.task,owner.step);await uploadKnowledgeFile(file,{signal:owner.signal});
   const response=await api('/knowledge',{signal:owner.signal});const doc=response.docs?.find(item=>item.fileName===file.name||item.name===file.name);
   if(!doc?.id)throw new Error('资料上传后没有返回匹配的服务端文档记录。');owner.resolve({uploaded:true,fileName:file.name,document:doc});
  }catch(error){owner.reject(error);}
 };
 const taskRuntimeView={...nativeTaskRuntime,start:startCopilotTask,importRequest:taskImportRequest,chooseImport:()=>taskImportRequest?.kind==='knowledge'?knowledgeFileRef.current?.click():fileRef.current?.click()};
 const assistantTask=projectAssistantTask({messages,busy:chatBusy||trialConfirming,runState,binding:currentBinding.current,uiActivity:assistantActivity.active});
 const assistantExperience=buildAssistantExperience({input:caseData,result,diagnostics:currentDiagnostics,binding:currentBinding.current,modelStatus,predictionState,dirty,page,task:assistantTask,mode:assistantMode,alarm:currentPredictionErrorAlarm(modelProps,predictionErrorAlarmRange)});
 // 任务收尾时助手报一句结论：同一个任务从执行态落到终态才说，切任务/旧任务不说话。
 const avatarTaskRef=useRef({id:null,state:null});
 useEffect(()=>{
  const task=assistantTask;
  if(!task||task.historical){avatarTaskRef.current={id:null,state:null};return;}
  const previous=avatarTaskRef.current;
  avatarTaskRef.current={id:task.id,state:task.state};
  if(previous.id!==task.id||previous.state===task.state)return;
  const line=taskSpeech(task);
  if(line)avatarSay(line,'task:'+task.id+':'+task.state);
 },[assistantTask?.id,assistantTask?.state]);
 const performAssistantTaskAction=async(action,{signal}={})=>{
  signal?.throwIfAborted();
  if(chatBusy)throw new Error('当前任务正在处理，请先等待或停止。');
  setAssistantOpen(true);
  if(action.contextKey!==assistantExperience.key)throw new Error('工况已更新，请使用最新处理建议。');
  if(action.type==='goal'||action.type==='trial'){
   if(action.type==='trial'){explicitTrialEntry.current=true;setQuestion('我想基于当前工况试算参数方案：');}
   requestAnimationFrame(()=>document.querySelector('[aria-label="向 DK AI 提问"]')?.focus());
   return {status:'AWAITING_INPUT',message:action.type==='trial'?'在下方说明调整目标；候选数值由正式预测工具计算。':'在下方说明目标，助手将组织当前工况的处理流程。'};
  }
  if(action.type==='open-input'){
   setPage('maintenance');const until=Date.now()+8000;
   while(Date.now()<until){signal?.throwIfAborted();if(document.querySelector('.maintenance-workspace')?.getClientRects().length)return {status:'VERIFIED',message:'当前工况检查与输入维护已显示。',view:'maintenance'};await new Promise(r=>setTimeout(r,50));}
   throw new Error('输入维护视图未返回显示状态。');
  }
  if(action.type==='validate')return receiptFromAgentRun(await ask('检查当前输入是否完整，并核对当前实际值来源',{tools:['validate'],analysisMode:'CURRENT',returnRun:true,signal}));
  if(action.type==='inspect')return receiptFromAgentRun(await ask('检查当前预测服务状态和本次预测失败原因',{analysisMode:'CURRENT',returnRun:true,signal}));
  if(['review-task','retry-task','open-comparison'].includes(action.type)){
   if(!assistantTask||assistantTask.id!==action.taskId||assistantTask.historical)throw new Error('任务或工况已变化，请查看最新任务记录。');
   const message=assistantTask.message;
   if(!message){
    if(action.type!=='review-task')throw new Error('本次没有可以重试的工具任务。');
    const entry=document.querySelector('[data-activity-task-id="'+CSS.escape(action.taskId)+'"]');if(!entry)throw new Error('本机任务记录尚未载入。');
    for(let node=entry;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;const ownDetails=entry.querySelector('details');if(ownDetails)ownDetails.open=true;entry.scrollIntoView({block:'nearest'});
    return {status:'VERIFIED',message:'本机任务依据与实际回执已展开。',activity_task_id:action.taskId};
   }
   if(message.snapshot_id&&!currentRunMatches(message,currentBinding.current))throw new Error('任务依据已不属于当前工况。');
   if(action.type==='retry-task')return receiptFromAgentRun(await ask(message.question||message.retry||assistantTask.title,{retryOf:message,analysisMode:'CURRENT',returnRun:true,signal}));
   if(action.type==='open-comparison'){
    if(!message.trial_execution?.ab_generated)throw new Error('本次没有已完成的A/B结果。');
    setPage('optimize');const until=Date.now()+8000;
    while(Date.now()<until){signal?.throwIfAborted();if(!currentRunMatches(message,currentBinding.current))throw new Error('候选依据已变化。');if(document.querySelector('.ops-optimization')?.getClientRects().length)return {status:'VERIFIED',message:'本次候选A/B工作区已显示，数值沿用正式试算结果。',run_id:message.runId,draft_id:message.trial_execution.draft_id};await new Promise(r=>setTimeout(r,50));}
    throw new Error('A/B工作区未返回显示状态。');
   }
   const article=message.runId?document.querySelector('[data-run-id="'+CSS.escape(message.runId)+'"]'):document.querySelector('[data-request-id="'+CSS.escape(message.request_id||'')+'"]');
   if(!article?.getClientRects().length)throw new Error('本次任务结果尚未载入。');article.scrollIntoView({block:'nearest'});
   return {status:'VERIFIED',message:'已展开到本次任务结果，请核对其实际返回内容。',run_id:message.runId||null};
  }
  if(action.type==='similar'){
   if(!assistantExperience.ready||!currentRunMatches(assistantExperience.identity,currentBinding.current))throw new Error('工况已变化，请等待当前预测。');
   return receiptFromAgentRun(await ask('查找与当前工况同规格的相似历史工况，并给出可核对的比较依据',{analysisMode:'CURRENT',returnRun:true,signal}));
  }
  const check=()=>{
   signal?.throwIfAborted();
   if(!assistantExperience.ready||!currentRunMatches(assistantExperience.identity,currentBinding.current))throw new Error('工况身份已变化，旧建议未继续执行。');
   const current=diagnosticsRef.current,finding=current?.status==='VALID'&&current.findings.find(f=>f.finding_id===action.findingId&&f.status==='VALID');
   if(!finding||finding.snapshot_id!==currentBinding.current.snapshot_id||!currentRunMatches(current.identity,currentBinding.current))throw new Error('当前分析依据已失效，请重新同步。');
   return finding;
  };
  const finding=check();
  if(action.type==='diagnose')return receiptFromAgentRun(await diagnoseFinding(finding.finding_id,{returnRun:true,signal}));
  if(action.type==='locate'){
   if(!finding.targets.includes(action.target)||!/^S[1-5]$/.test(action.target))throw new Error('该依据没有可定位的关联设备。');
   stream.pause({temporary:true});if(pauseRebind.current)await pauseRebind.current;
   setPage('overview');const deadline=Date.now()+8000;
   while(!sceneControlsRef.current&&Date.now()<deadline){check();await new Promise(r=>setTimeout(r,50));}
   check();if(!sceneControlsRef.current?.locateFindingTarget)throw new Error('三维视图尚未就绪，定位未执行。');
   sceneControlsRef.current.locateFindingTarget({finding_id:finding.finding_id,finding_receipt:finding.receipt,snapshot_id:finding.snapshot_id,target:action.target});
   while(Date.now()<deadline){check();const host=document.querySelector('.three-host');if(host?.dataset.findingFocusedStand===action.target&&host.dataset.visibleStands==='S1,S2,S3,S4,S5')return {status:'VERIFIED',message:'已在完整产线中定位并高亮 '+action.target+'，三维状态已核验。',target:action.target,snapshot_id:finding.snapshot_id,finding_id:finding.finding_id,visible_stands:host.dataset.visibleStands};await new Promise(r=>setTimeout(r,50));}
   throw new Error('三维未返回匹配定位状态，未将本次操作记为完成。');
  }
  throw new Error('当前建议没有对应的执行工具。');
 };
 const assistantTaskAction=async action=>{
  if(assistantActivity.activeRef.current?.state==='EXECUTING')throw new Error('当前任务尚在处理，请先等待或停止。');
  const taskId=assistantActivity.begin(assistantExperience,action,messages);
  try{const signal=assistantActivity.signal(taskId),receipt=await performAssistantTaskAction(action,{signal});signal?.throwIfAborted();assistantActivity.finish(taskId,receipt);return receipt;}
  catch(error){assistantActivity.finish(taskId,{status:error.name==='AbortError'?'CANCELLED':'FAILED',message:error.message||'本次动作未完成。'});throw error;}
 };
 globalThis.__qcdkrForces=Object.fromEntries((caseData?.stands||[]).map(stand=>[stand.id,Number(stand.force)]));
 const latestEngineerReply=!chatBusy?([...messages].reverse().find(message=>message.role==='assistant'&&!['error','unavailable','interrupted'].includes(message.mode)&&typeof message.text==='string'&&message.text.trim())?.text||''):'';
 function Overview(){return <LiveWorkspace controlRef={sceneControlsRef} modelProps={{...modelProps,onNotify:notify,onDiagnoseFinding:diagnoseFinding,diagnosingFindingId,diagnosisBusy:chatBusy}} currentDiagnostics={currentDiagnostics} stream={stream} guidedTrialStatus={guidedTrialStatus} modelCandidateStatus={modelCandidateStatus} modelCandidateSearching={candidatePolicy.status==='SEARCHING'} candidatePolicy={candidatePolicy} workbenchViewMode={workbenchViewMode} onViewModeChange={setWorkbenchViewMode} onRegenerateTrend={regeneratePolicyTrend} onSelectPolicy={policySelection} optimizationTask={optimizationTask} onReturnBaseline={()=>{setWorkbenchViewMode('CURRENT');setActionPanel(null);}} abStatus={abStatus} onOpenDiagnosisAssistant={findingId=>{setAssistantOpen(true);return diagnoseFinding(findingId);}} onOpenTrialAssistant={()=>{explicitTrialEntry.current=true;setAssistantOpen(true);setQuestion('把S4前张力降低3%试算一下');}} onOpenAB={()=>{setPage('optimize');if(!plans.length)notify('请先生成候选试算');}} onOpenDecisionSupport={()=>setPage('optimize')} onOptimize={()=>setPage('optimize')} onAsk={ask} engineerReply={latestEngineerReply}/>}
function Optimization(){return <><OptimizationWorkspace resultSample={resultSample} predictionErrorAlarmRange={predictionErrorAlarmRange} predictionState={predictionState} observationMatches={resultSample?.observedAvailable===true} onReturnCurrent={()=>{setActionPanel(null);setPage('overview');setWorkbenchViewMode('CURRENT');}} caseData={caseData} result={result} plans={plans} busy={busy} appliedPlan={appliedPlan} optimizationTask={optimizationTask} onTargetChange={value=>{optimizationTaskRef.current={...optimizationTaskRef.current,searchMatchTolerance:SEARCH_MATCH_TOLERANCE_DEFAULT,targetValueT:value};policyOwner.current.invalidateSelection();setOptimizationTask(task=>({...task,searchMatchTolerance:SEARCH_MATCH_TOLERANCE_DEFAULT,targetValueT:value}));setPlans(items=>items.filter(plan=>plan.candidate_source!=='SMART_SEARCH'));}} prefetchCompleted={candidatePolicy.prefetchCompleted} prefetchTotal={candidatePolicy.prefetchTotal} reachableRange={candidatePolicy.reachableRange} maxReachabilityState={candidatePolicy.maxReachabilityState} predictionReady={!dirty&&currentBinding.current.valid&&predictionState==='READY'} onTargetEditDirty={value=>{parameterEditors.current.target=value;}} onGenerate={generate} onGeneratePresets={generatePresets} selectedPolicy={candidatePolicy.selectedPolicy} onSelectPolicy={policySelection} policySearching={candidatePolicy.backfillSearching} policySeriesLength={candidatePolicy.seriesLength} searchState={policySearchState} activeSearchRunId={policyRun?.search_run_id} targetReference={targetReference} onCloseSearch={()=>{setWorkbenchViewMode('CURRENT');policyOwner.current.clear();setSearchState({status:'IDLE'});}} onCancelReview={()=>smartReviewClient.current.cancel('CANCELLED')} onCloseReview={()=>smartReviewClient.current.cancel('PANEL_CLOSED')} onCancelSearch={cancelSearch} candidateIdentityKey={candidateExplanationKey} explanationByCandidateIdentity={explanationByCandidateIdentity} explanationBusy={candidateReviewBusy || !!candidateExplanationRequest.current || chatBusy} onExplainCandidate={explainPlan} selectedCandidateIdentity={selectedCandidateIdentity} onSelectCandidate={key=>{if(key!==selectedCandidateExplanation.current)smartReviewClient.current.cancel('SELECTION_CHANGED');selectedCandidateExplanation.current=key;setSelectedCandidateIdentity(key);}} onReview={applyPlan} onUndo={undoPlan} onLoadDraft={async(plan,policy)=>{const loaded=await loadDraft(plan);if(loaded)setDraftDisplaySelection({draftId:loaded.draft_id,policy});return loaded;}} draft={policyDraft} canLoadDraft={currentBinding.current.valid&&result.mode==='formal'&&!draftPromotion.current}/><div><DraftWorkspace draft={policyDraft} candidatePlans={plans} displaySelection={draftDisplaySelection} currentPrediction={result} currentObservation={observation} baselineValid={validateDraftBaseline(policyDraft,currentBinding.current)} promoting={!!draftPromotion.current} busy={busy} onPredict={predictDraft} onPromote={promoteDraft} onDiscard={discardDraft}/></div></>;}
 function Reports(printOnly=false){
 if(!Number.isFinite(reportSnapshot?.prediction?.value??result.value))return <Panel title="报告导出"><p>等待首个有效预测结果。</p></Panel>;
 const r=buildReport(reportSnapshot||currentReportPayload);
 const head=(n,title)=><div className="rpt-head"><strong>{PRODUCT_NAME}<span>ENGINEERING ANALYSIS</span></strong><div>{title}<small>工况分析 / {n}</small></div></div>;
 const foot=(n)=><div className="rpt-foot"><span>{PRODUCT_NAME} · 工况分析报告</span><span>{r.meta.createdAtLabel} · {n}</span></div>;
 return <div className="report-layout professional-report"><Panel title="报告编制" subtitle="工况快照、复算结果与分析依据"><div className="report-snapshot"><small>{reportSnapshot?"冻结报告版本":"当前报告预览"}</small><b>{r.meta.revision}</b><span>{r.meta.createdAtLabel}</span><Badge tone="orange">{r.meta.mode==='demo'?'工况演示':'模型推理'}</Badge></div><div className="report-options">{['工况信息','预测结果','工艺解释','三维模型','优化方案'].map(name=><label key={name}><input type="checkbox" disabled={!!busy} checked={reportSections.includes(name)} onChange={e=>{setReportSections(v=>e.target.checked?[...v,name]:v.filter(x=>x!==name));}}/>{name}</label>)}</div><div className="export-actions"><button className="button secondary" disabled={!!busy||dirty} onClick={()=>doExport('regenerate')}>{reportSnapshot?'重新生成报告':'生成报告'}</button><button className="button primary" disabled={!!busy||(!reportSnapshot&&dirty)} onClick={()=>doExport('pdf')}><FileText size={16}/>{window.dkqkarDesktop?'保存 PDF 报告':'打印 / 保存 PDF'}</button><button className="button secondary" disabled={!!busy||(!reportSnapshot&&dirty)} onClick={()=>doExport('word')}><FileText size={16}/>导出工程 Word</button><button className="button secondary" disabled={!!busy||(!reportSnapshot&&dirty)} onClick={()=>doExport('ppt')}><Layers3 size={16}/>导出演示 PPT</button><button className="button secondary" disabled={!!busy||(!reportSnapshot&&dirty)} onClick={()=>doExport('json')}><Download size={16}/>完整分析 JSON</button><button className="button secondary" disabled={!!busy||(!reportSnapshot&&dirty)} onClick={()=>doExport('csv')}><Download size={16}/>工况明细 CSV</button></div><p className="micro-note">预览和导出使用同一冻结报告版本；当前状态或章节选择变化后，请明确重新生成。</p><div className="report-check"><CheckCircle2 size={14}/><span>输入与计算结果{r.summary.coherent?'一致':'待核对'}</span></div></Panel><div className="report-pages" id={printOnly?"report-paper":"report-preview-paper"}>
 <article className="report-sheet cover-sheet">{head('01','工况预测与优化')}<div className="rpt-eyebrow">五机架冷连轧 / 工艺分析</div><h1>工况预测与优化<br/>分析报告</h1><div className="rpt-title-sub">{readableConditionName(r.meta.id)} <span>·</span> {r.meta.steelGrade} <span>·</span> {r.meta.width} mm</div><div className="rpt-meta"><div><small>记录类型</small><span>工况分析报告</span></div><div><small>计算时间</small><span>{r.meta.createdAtLabel}</span></div><div><small>分析目标</small><span>第五机架 S5 轧制力</span></div><div><small>当前引擎</small><span>{userVisibleText(r.summary.status)}</span></div></div><h2>执行摘要</h2><p className="rpt-lead">{r.summary.conclusion}</p><div className="rpt-kpis"><div><small>S5 预测载荷</small><strong>{engineering('force',r.summary.value)}</strong><span>t</span></div><div><small>目标设定</small><strong>{engineering('force',r.summary.target)}</strong><span>t</span></div><div><small>目标偏差</small><strong>{r.summary.deviation>0?'+':''}{fmt(r.summary.deviation,2)}<em>%</em></strong><span>绝对偏差 {engineering('force',r.summary.absoluteError)}</span></div></div>{r.sections.includes('三维模型')&&<figure><img src="/assets/factory-preview.png" alt="最终修订母版五机架三维设备"/><figcaption>图 1 · V2 Readability 最终母版的整线视图。App 内为可旋转的真实三维模型。</figcaption></figure>}<div className="rpt-scope"><b>结果适用范围</b><p>{r.method.scope}</p></div>{foot('01')}</article>
 {r.sections.includes('工况信息')&&<article className="report-sheet">{head('02','工况与输入完整性')}<h1 className="rpt-section-title">01 / 工况输入与数据说明</h1><p>五机架参数按 S1 → S5 的工艺顺序列示。宽度和厚度为 mm，轧制力为 t，总张力为 t，弯辊力为 kN，速度为 m/min。</p><table className="rpt-table"><thead><tr><th>工艺变量 / 单位</th>{r.stands.map(st=><th key={st.id}>{st.id}</th>)}</tr></thead><tbody>{r.parameterRows.map(row=><tr key={row.field}><td><b>{row.label}</b><small>{row.unit}</small></td>{row.values.map((v,i)=><td key={i}>{Number.isFinite(v)?engineering(row.field,v):'—'}</td>)}</tr>)}</tbody></table><h2>道次减薄与参数连续性</h2><table className="rpt-table"><thead><tr><th>机架</th><th>入口 / mm</th><th>出口 / mm</th><th>压下率</th><th>衔接检查</th></tr></thead><tbody>{r.stands.map((st,i)=><tr key={st.id}><td>{st.id}</td><td>{fmt(st.entryThickness,3)}</td><td>{fmt(st.exitThickness,3)}</td><td>{fmt((st.entryThickness-st.exitThickness)/st.entryThickness*100,2)}%</td><td>{i===0?'首机架入口':Math.abs(st.entryThickness-r.stands[i-1].exitThickness)<=.015?'连续':'待复核'}</td></tr>)}</tbody></table><h2>数据完整性结论</h2><ul className="rpt-list"><li>机架编号、数值有效性、正负号、厚度递减及跨机架衔接已通过当前软件校验。</li><li>当前工况版本为 {r.meta.revision}，用于关联本次计算结果与后续方案。</li><li>S5 前张力未包含在原始 25 维模型输入中，未以零值伪装缺失项。</li></ul><div className="rpt-note">钢种与设备几何用于工况组织及三维展示，不作为未声明的新预测特征。</div>{foot('02')}</article>}
 {r.sections.includes('预测结果')&&<article className="report-sheet">{head('03','预测与影响因素')}<h1 className="rpt-section-title">02 / 预测结果与影响因素</h1><table className="rpt-table result-table"><tbody><tr><th>S5 预测</th><td>{engineering('force',r.summary.value)}</td><th>目标值</th><td>{engineering('force',r.summary.target)}</td></tr><tr><th>有符号偏差</th><td>{engineering('force',r.summary.signedError)}</td><th>相对偏差</th><td>{fmt(r.summary.deviation,2)}%</td></tr><tr><th>{r.meta.mode==='formal'?'预测区间':'演示扰动带'}</th><td colSpan="3">{r.summary.interval.length?r.summary.interval.map(v=>engineering('force',v)).join(' — '):r.summary.intervalNature}</td></tr></tbody></table><h2>机架载荷分布</h2><Chart data={r.curve} mode={r.meta.mode}/><p className="rpt-caption">图 2 · S1–S5 工况载荷与 S5 {r.meta.mode==='formal'?'模型预测':'演示预测'}。系统没有为 S1–S4 虚构预测序列。</p><h2>{r.meta.mode==='formal'?'模型敏感度前五项':'演示敏感度前五项'}</h2><div className="rpt-bars">{r.sensitivities.map(d=><div key={d.name}><span>{d.name}</span><i><b style={{width:d.value+'%'}}/></i><strong>{fmt(d.value,2)}%</strong></div>)}</div><p>{r.method.sensitivity}</p><h2>结果解读</h2><p>{r.summary.conclusion}</p>{foot('03')}</article>}
 {(r.sections.includes('优化方案')||r.sections.includes('工艺解释'))&&<article className="report-sheet">{head('04','方案与分析记录')}<h1 className="rpt-section-title">03 / 方案比较与分析记录</h1>{r.sections.includes('优化方案')&&<><h2>候选方案与复算</h2>{r.plans.length?r.plans.map((p,i)=><section className="rpt-plan" key={p.id}><h3>{i+1}. {p.title}</h3><p>{p.description}</p><div className="rpt-plan-summary">预测值 {engineering('force',p.predictedValue)} · 复算值 {engineering('force',p.replayValue)} · {userVisibleText(p.status)}</div><table className="rpt-table"><thead><tr><th>调整项</th><th>调整前</th><th>调整后</th><th>变化量</th></tr></thead><tbody>{p.changes.map((c,j)=><tr key={j}><td>{c.stand} {c.label}</td><td>{engineering(c.field,c.before)}</td><td>{engineering(c.field,c.after)}</td><td>{engineering(c.field,c.delta)}</td></tr>)}</tbody></table></section>):<div className="rpt-note">本次未执行方案生成。本报告仅分析当前工况，不虚构优化候选或改善结果。</div>}</>}{r.sections.includes('工艺解释')&&<><h2>工况解读与 AI 记录</h2><p>{r.summary.headline}。前三项敏感变量为 {r.sensitivities.slice(0,3).map(d=>d.name).join('、')}。可通过单变量调整观察当前引擎下的响应方向，再比较多参数候选。</p>{r.onlineNotes.length?r.onlineNotes.map((note,i)=><div className="rpt-ai" key={i}><small>{note.source}</small><UserVisibleText value={knowledgeDisplayText(note.text)}/></div>):<div className="rpt-note">本次会话没有在线大模型分析记录。上述解读依据本地规则与计算结果生成，不作为大模型推理或独立工程判断。</div>}</>}<h2>下一步操作</h2><ol className="rpt-list">{r.nextSteps.map(t=><li key={t}>{t}</li>)}</ol>{foot('04')}</article>}
 <article className="report-sheet methodology-sheet">{head('05','方法、来源与追溯')}<h1 className="rpt-section-title">04 / 计算方法与结果追溯</h1><h2>计算模式与特征定义</h2><p>{r.method.current}</p><p>{r.method.inputs}</p><h2>区间与适用范围</h2><p>{r.method.uncertainty}</p><p>{r.method.range}</p><details className="prediction-record-technical"><summary>查看技术信息</summary><table className="rpt-table source-table"><tbody><tr><th>模型定义</th><td>dkqkar_v5s2_model.py · DKQKARV5S2</td></tr><tr><th>研究依据</th><td>《QCDKR冷连轧轧制力预测研究》及 docs/model-audit.md</td></tr><tr><th>工况版本</th><td>{r.meta.revision} / {r.meta.id}</td></tr><tr><th>三维母版</th><td>{r.asset.source}</td></tr><tr><th>三维版本链</th><td>{r.asset.chain}</td></tr><tr><th>软件版本</th><td>{PRODUCT_NAME} {APP_VERSION} / 报告格式 {r.meta.formatVersion}</td></tr></tbody></table><pre>{JSON.stringify(r.meta,null,2)}</pre></details><h2>系统依据</h2><EvidenceReferences message={{...r.meta,evidence:r.evidence,findings:r.findings,evidence_status:r.evidence_status,prediction_mode:r.meta.mode}} binding={{...r.meta,valid:true}}/><h2>历史研究指标与本次结果的区别</h2><p>{r.method.paper}</p><div className="rpt-scope"><b>追溯说明</b><p>本报告由当前有效工况和计算结果自动生成；可同时导出 JSON 留存完整字段。设备三维可视化未改变真实几何，阴影、环境和光照属于展示设置。</p></div>{foot('05')}</article>
 </div></div>;
 }
 const loadSavedCase=c=>{unsavedEdits.current={parameterEdits:false,dataEdits:false};if(!c.input){notify('此记录缺少工况输入');return;}const trusted=c.identity_status==='VERIFIED'&&c.prediction?.receipt&&c.prediction.mode===predictionClient.current.mode;const draftHistory=trusted&&c.prediction.mode==='formal'&&c.input.importProvenance?.source_type==='HYPOTHETICAL_DRAFT';const invalid=validateCaseImport(c.input,rangeTable,readCustomLimits(window.localStorage)).parserSchemaErrors.map(issue=>issue.message);if(invalid.length){notify(invalid[0]);return;}stream.manual();setSessionKey(k=>k+1);setAppliedPlan(null);const restored=trusted?clone(c.input):{...clone(c.input),importProvenance:c.input.importProvenance||{source_type:'UNKNOWN',sample_timestamp:null,observed:null,observedAvailable:false,observedSource:'历史记录未保存独立观测来源'}};if(trusted&&restored.importProvenance?.source_type!=='DEMO'){const savedObservation=c.observation||c.prediction.observation;if(savedObservation){assertObservationBinding(savedObservation,c.prediction.input_snapshot);restored.stands.find(stand=>stand.id==='S5').force=savedObservation.value;restored.importProvenance={...restored.importProvenance,observed:savedObservation.value,observedAvailable:savedObservation.value!==null,observedSource:savedObservation.source};}}restored.target=null;setOptimizationTask(null);invalidatePrediction();if(trusted&&reportInputFingerprint(restored)===reportInputFingerprint(c.input))pendingRetry.current={input_snapshot:c.prediction.input_snapshot,prediction:c.prediction,observation:c.observation||c.prediction.observation};pendingFrame.current=null;setPredictionEpoch(value=>value+1);currentCaseRef.current=restored;setCase(restored);setDirty(true);setPlans([]);setPage('overview');notify((trusted?'已恢复可信历史快照 · ':'已载入历史输入，原身份待验证；创建本次计算快照 · ')+(c.name||c.input.id));};
 const undoTaskChange=()=>{
  const change=lastTaskChange;if(!change)return;
  setLastTaskChange(null);
  loadSavedCase({input:change.input,name:'撤销任务变更'});
  notify('已撤销本次任务变更，正在重新预测');
 };
 const loadTaskCandidate=candidate=>{
  if(!candidate?.input)throw new Error('候选缺少工况输入。');
  loadSavedCase({input:candidate.input,name:'AI 候选'});
  notify('已载入 AI 候选，正在重新预测');
 };
 const importTaskFile=async ev=>{const owner=taskImportOwner.current;if(!owner)return importFile(ev);const file=ev.target.files?.[0];if(!file){owner.reject(new Error('没有选择导入文件。'));return;}try{assertTaskWriteBinding(owner.task,owner.step,{contextFingerprint:reportInputFingerprint(currentCaseRef.current),operationScope:operationScope()});const revision=inputRevision.current;await importFile(ev);if(inputRevision.current===revision)throw new Error('文件没有通过解析与单位核验，未导入。');owner.resolve({fileName:file.name,revision:inputRevision.current,fingerprint:modelInputFingerprint(currentCaseRef.current)});}catch(error){owner.reject(error);}};
 const deleteSavedCase=async c=>{try{await api('/cases/'+encodeURIComponent(c.id),{method:'DELETE'});setCases(await api('/cases'));notify('案例已删除');}catch(e){notify(e.message);}};
 const cancelAgent=()=>{assistantActivity.cancel();abortAiController(agentRequest.current,'USER_CANCEL');setChatBusy(false);setRunState('');if(activeRun.current)api('/agent/runs/'+activeRun.current+'/cancel',{method:'POST',body:'{}'}).catch(()=>{});};
 const STAGE_PANEL_TITLES={data:'数据接入',maintenance:'系统状态与维护',communication:'工业设备连接',logs:'运行日志'};
 const STAGE_SIDES={data:'left',maintenance:'left',communication:'right',logs:'right'};
 const businessFor=id=>id==='communication'?<IndustrialConnectionWorkspace api={api} connection={industrialDisplayConnection} predictionState={predictionState} currentInput={caseData} onNotify={notify} onNavigate={setPage}/>:id==='data'?<DataWorkspace {...{stream,caseData,modelProps,cases,result}} onResolveImportUnits={chooseImportUnits} tab={dataTab} onTabChange={setDataTab} onImport={()=>fileRef.current.click()} onTemplate={downloadSingleConditionTemplate} onSave={save} onLoad={loadSavedCase} onDelete={deleteSavedCase} onNotify={notify} onNavigate={setPage} onReplayHistorical={()=>startHistoricalReplay(modelStatus.model_hash,{seededDemo:true,baseInput:currentCaseRef.current})} searchState={policySearchState} mostRecentCompletedSearch={mostRecentCompletedSearch} onOpenSolutions={()=>setPage('optimize')}/>:id==='maintenance'?<MaintenanceWorkspace currentPrediction={result} predictionBound={modelProps.currentPredictionBound} dirty={dirty} industrialStatus={industrialDisplayConnection.status} predictionUpdatedAt={modelProps.currentPredictionBound?lastUpdated:null} api={api} onNotify={notify} onNavigate={setPage} onOpenSolutions={()=>setPage('optimize')} user={user} {...{caseData,stream,modelStatus,assistantStatus,searchState:policySearchState,mostRecentCompletedSearch,predictionState}} onRefreshAssistant={refreshAssistantStatus} onRefreshModel={async()=>{const status=await api('/model/status');predictionClient.current.acceptStatus(status);setModelStatus(status);return status;}}/>:<LogsWorkspace api={api} onNotify={notify} onNavigate={setPage} user={user} analysisStatus={aiAnalysis.status} analysisError={aiAnalysis.error} onAnalysisHistory={openAnalysisHistory} onAnalyzeCurrent={()=>void analyzeRecords().catch(error=>notify(error.message))} focusLogId={focusLogId} predictionRecordContext={analysisContext} onLogFocused={()=>setFocusLogId(null)}/>;
 // 2026-11-15 助手接线：恢复 AssistantAvatar（3D 工程师形象，11-14 死代码清理时误删），接到工作台状态与浮窗开关。
 const assistantCaption=runState||assistantTask?.label||'';
 return <><CsvImportUnitDialog inspection={importUnitRequest} onChoose={finishImportUnits}/><AssistantAvatar open={assistantOpen} onToggle={()=>setAssistantOpen(v=>!v)} busy={chatBusy||trialConfirming||assistantActivity.active?.state==='EXECUTING'} runState={assistantCaption} suggestion={assistantExperience?.suggestion||null} task={assistantTask} voiceState={voiceState} voice="" speech={avatarSpeech} onSpeechDismiss={()=>setAvatarSpeech(null)}/><input ref={knowledgeFileRef} type="file" accept=".txt,.md,.docx" hidden onChange={uploadTaskKnowledge}/><input ref={fileRef} type="file" accept=".json,.csv" hidden onChange={importTaskFile} onCancel={()=>taskImportOwner.current?.reject(new Error('文件选择已取消。'))}/><AppShell {...{page,navActive:[page,pin].filter(Boolean),user,onLogout,caseData,modelStatus,dirty,refreshing,systemHealth}} twin={{selected,setSelected,view,setView,caseData,processSpeed:caseData.stands?.find(stand=>stand.id==='S5')?.speed||0,onOpenWorkbench:()=>setPage('overview'),playback:{running:stream.running,available:stream.frames.length>1&&!['manual','plc'].includes(stream.mode),onToggle:stream.toggle}}} onRefresh={requestWorkspaceRefresh} onNavigate={setPage} onSave={save} onOpenReport={()=>setActionPanel('report')} assistantExperience={assistantExperience} assistantTask={assistantTask} assistantBusy={chatBusy||trialConfirming||assistantActivity.active?.state==='EXECUTING'} assistantRunState={runState||assistantTask?.label} assistantOpen={assistantOpen} onAssistantToggle={()=>setAssistantOpen(v=>!v)} assistantMode={assistantMode} onAssistantModeChange={changeAssistantMode} assistant={assistantUi==='continuous'?<ContinuousCopilotPanel open={assistantOpen} onOpenChange={setAssistantOpen} sessionId={appSessionId} status={assistantStatus} caseData={resultCase} selected={selected} source={stream.sourceName} notify={notify} accessMode={assistantMode} onAccessModeChange={changeAssistantMode} readContext={readTaskContext} onLegacy={()=>{setAssistantUi('legacy');setAssistantOpen(true);}}/>:<AssistantPanel onUseContinuous={()=>{setAssistantUi('continuous');setAssistantOpen(true);}} taskRuntime={taskRuntimeView} task={assistantTask} taskHistory={assistantActivity.history} accessMode={assistantMode} onAccessModeChange={changeAssistantMode} lastTaskChange={lastTaskChange} onUndoTaskChange={undoTaskChange} onLoadCandidate={loadTaskCandidate} taskStorageError={assistantActivity.storageError} experience={assistantExperience} onTaskAction={assistantTaskAction} open={assistantOpen} onOpenChange={setAssistantOpen} sessionId={appSessionId} binding={currentBinding.current} status={assistantStatus} messages={messages.map(message=>targetReferenceMessage(message,currentTargetReference))} question={question} setQuestion={setQuestion} busy={chatBusy} onCancel={cancelAgent} ask={ask} caseData={resultCase} selected={selected} source={stream.sourceName} notify={notify} onAction={assistantAction} onDiagnosticAction={diagnosticAction} onTrialPreviewAction={trialPreviewAction} trialConfirming={trialConfirming} currentDiagnostics={currentDiagnostics} reference={agentReference} setReference={setAgentReference} cases={cases} baseline={defaultInput.current} runState={runState} selectedEvent={selectedEvent} onClearEvent={()=>setSelectedEvent(null)} diagnosticShortcutTitle={diagnosticShortcutTitle} onAnalysisHistory={openAnalysisHistory} analysisContext={analysisContext} onClearAnalysis={()=>{setAnalysisContext(null);setAnalysisChoice(null);}} analysisChoice={analysisChoice} onAnalysisChoice={mode=>{const pending=analysisChoice;setAnalysisChoice(null);if(pending)void ask(pending.question,{analysisMode:mode});}}/>}>{['CHECKING','FAST_RETRY','SLOW_POLL','EXHAUSTED'].includes(recoveryPhase)&&<div className="micro-note workspace-recovery" role="status" data-recovery-phase={recoveryPhase}><span>{recoveryPhase==='EXHAUSTED'?RECOVERY_UNAVAILABLE:RECOVERY_CONNECTING}</span>{recoveryPhase==='EXHAUSTED'&&<button type="button" onClick={requestWorkspaceRefresh} disabled={refreshing}>刷新</button>}</div>}{<div className={'twin-stage'+(page!=='overview'||pin?' stage-docked':'')+(page!=='overview'&&pin?' both-docks':'')+(page!=='overview'?' has-'+STAGE_SIDES[page]:'')+(pin?' has-'+STAGE_SIDES[pin]:'')+(pin?' has-pin-'+STAGE_SIDES[pin]:'')} data-stage-page={page}>
<div className="twin-stage-3d">{Overview()}</div>
{page!=='overview'&&<section className={'twin-stage-panel dock-'+STAGE_SIDES[page]} data-page={page} aria-label={STAGE_PANEL_TITLES[page]+' · 3D 工作台侧挂面板'}>
<header className="twin-stage-panel-head"><span className="twin-stage-live-dot" aria-hidden="true"/><small>3D 工作台持续运行 · {STAGE_PANEL_TITLES[page]}</small><button type="button" className="twin-stage-close" aria-label="收起此面板" title="收起此面板" onClick={()=>setPage(page)}><X size={15}/></button></header>
<div className="twin-stage-panel-body" key={page}>{businessFor(page)}</div>
</section>}
{pin&&page!==pin&&<section className={'twin-stage-panel dock-'+STAGE_SIDES[pin]} data-page={pin} aria-label={STAGE_PANEL_TITLES[pin]+' · 3D 工作台侧挂面板'}>
<header className="twin-stage-panel-head"><span className="twin-stage-live-dot" aria-hidden="true"/><small>3D 工作台持续运行 · {STAGE_PANEL_TITLES[pin]}</small><button type="button" className="twin-stage-close" aria-label="收起此面板" title="收起此面板" onClick={()=>setPin(null)}><X size={15}/></button></header>
<div className="twin-stage-panel-body" key={pin}>{businessFor(pin)}</div>
</section>}
</div>}</AppShell>
 {analysisPanel&&<AiAnalysisWorkspace api={api} initialId={analysisPanel.id} initialFilters={analysisPanel.filters} onClose={()=>setAnalysisPanel(null)} onOpen={setAnalysisContext} onViewLog={viewAnalysisLog} onAnalyze={analyzeRecords}/>}
 {refreshConfirmation&&<div className="modal-backdrop action-panel-backdrop" data-escape-layer="modal"><section className="action-panel" role="dialog" aria-modal="true" aria-label="刷新当前工作台确认" tabIndex={-1}><header><h2>刷新当前工作台</h2><button type="button" aria-label="取消刷新" onClick={()=>setRefreshConfirmation(false)}><X size={20}/></button></header><div className="action-panel-body"><p>{REFRESH_CONFIRMATION}</p><div className="message-actions"><button type="button" onClick={()=>setRefreshConfirmation(false)}>取消</button><button type="button" onClick={()=>{setRefreshConfirmation(false);void performWorkspaceRefresh();}}>继续刷新</button></div></div></section></div>}
 {actionPanel&&<div className="modal-backdrop action-panel-backdrop" data-escape-layer="modal" role="presentation" onClick={e=>{if(e.target===e.currentTarget)setActionPanel(null);}}><section className="action-panel" role="dialog" tabIndex={-1} aria-modal="true" aria-label={actionPanel==='trial'?'优化候选方案':actionPanel==='comparison'?'工况对比':'结果导出'}>{actionPanel!=='trial'&&<header><h2>{actionPanel==='comparison'?'工况对比':'结果导出'}</h2><button aria-label="关闭操作面板" onClick={()=>setActionPanel(null)}><X size={20}/></button></header>}<div className="action-panel-body">{actionPanel==='trial'?Optimization():actionPanel==='comparison'?<AgentComparison {...comparisonView}/>:Reports()}</div></section></div>}
 {reportSnapshot&&<div className="r2-frozen-report" data-snapshot-id={reportSnapshot.prediction.snapshot_id} data-observation-id={reportSnapshot.observation.observation_id}><style>{`.r2-frozen-report{display:none}@media print{.app-shell,.modal-backdrop,.toast{display:none!important}.r2-frozen-report{display:block!important}.r2-frozen-report .panel{display:none!important}}`}</style>{Reports(true)}</div>}
 {toast&&(()=>{const noticeText=String(actualDisplayText(toast)??'');const colon=noticeText.search(/[：:]/);const noticeHead=colon>0?noticeText.slice(0,colon).trim():'';const noticeBody=colon>0?noticeText.slice(colon+1).trim():noticeText;return <div className="toast" role="status" data-notification-type={toastType}>{toastType==='WARNING'?<AlertTriangle size={17} style={{color:'var(--amber)'}}/>:<CheckCircle2 size={17}/>}<div className="toast-body">{noticeHead&&<small>{noticeHead}</small>}<UserVisibleText value={noticeBody}/></div><button className="icon-btn" onClick={()=>setToast('')} aria-label="关闭提示"><X size={15}/></button></div>;})()}
 </>;
}
export default App;

