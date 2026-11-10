import AssistantTaskOverview from './AssistantTaskOverview.jsx';
import TaskProgress from './TaskProgress.jsx';
import AssistantTaskProgress from './AssistantTaskProgress.jsx';
import TechnicianPanel from './TechnicianPanel.jsx';
import { memo, useEffect, useRef, useState } from 'react';
import { ArrowRight, Loader2, SlidersHorizontal, Square, X } from 'lucide-react';
import FloatingAssistant from './FloatingAssistant.jsx';
import { AssistantConversation, AssistantComposer } from './AssistantConversation.jsx';
import AssistantSources, { AssistantReferences } from './AssistantSources.jsx';
import AgentTrace from './AgentTrace.jsx';
import EvidenceReferences from './EvidenceReferences.jsx';
import { knowledgeDisplayText } from './knowledgeDisplay.js';
import { reportInputFingerprint } from './reportData.js';
import { currentRunMatches } from './predictionSnapshot.js';
import { toDisplay, unitFor } from './engineeringUnits.js';
import { dataSourceDisplayName } from './workbenchDisplay.js';
import { actualDisplayText } from './s5ActualDisplay.js';
import './assistant-compact.css';
import { aiConnectionState } from './aiConnectionStatus.js';
import { ASSISTANT_MODES, ASSISTANT_MODE_LABELS } from './assistantAccess.js';
import UserVisibleText from './UserVisibleText.jsx';
import { isTechnicalLabel, readableConditionName, userVisibleText } from './userVisibleText.js';

export function assistantScopeLabel(message) {
  if(message.answerScope==='AI_ANALYSIS')return '历史分析 · #'+message.analysisId;
  const time=message.checkedAt?new Date(message.checkedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}):'时间未返回';
  if(message.answerScope==='CONFIG')return `配置查询 · ${time}`;
  if(message.answerScope==='SERVICE')return `服务状态 · ${time}`;
  return null;
}

const actions = [['validate','检查输入'],['predict','预测'],['analyze','分析'],['compare','对比'],['optimize','试算'],['knowledge','查资料'],['3D','定位'],['report','导出']];
export function assistantAvailability(status={}) {
 const state=aiConnectionState(status);
 return {available:state.available,label:(status.mode==='cloud'?'云端 AI · ':'本地 AI · ')+state.label};
}
function degradationText(message){
 if(['PARAMETER_KNOWLEDGE','PARAMETER_CURRENT_VALUE'].includes(message.question_type))return null;
 if(message.answer_variant==='AI_EXPLAIN')return message.facts_state?null:message.generationError || null;
 if(message.generationError)return String(message.text||'').includes(message.generationError)?null:message.generationError;
 if(!message.routingError)return null;
 const knowledge=message.references?.length||message.trace?.some(step=>step.tool==='knowledge.search');
 return knowledge?message.references?.length?'AI摘要暂不可用，下面显示本地资料检索结果。':'AI摘要暂不可用，本地资料中也未检索到直接匹配片段。':'AI生成说明暂不可用，以下为系统计算事实。';
}

export function CandidateTrialPreview({message,binding,busy,onAction}) {
 const preview=message.trial_preview;if(!preview)return null;
 const current=currentRunMatches(message,binding),change=preview.change,unit=change.unit;
 const number=value=>Number.isFinite(value)?String(Number(value.toFixed(6))):'—';
 const pending=['PENDING_CONFIRMATION','CONFIRMED'].includes(preview.status);
 return <section className="assistant-trial-preview" aria-label="候选试算预览" data-preview-snapshot={preview.candidate_preview_snapshot_id}>
  <strong>DK AI · 候选试算</strong>
  {!current?<p role="status">当前候选基于旧工况，请重新生成。</p>:<p role="status">{preview.status==='COMPLETED'?'A/B结果已生成':preview.status==='CANCELLED'?'已取消':'候选待确认'}</p>}
  <dl><div><dt>字段</dt><dd>{change.label}</dd></div><div><dt>当前值</dt><dd>{number(change.displayBefore)} {unit}</dd></div><div><dt>候选值</dt><dd>{number(change.displayAfter)} {unit}</dd></div><div><dt>调整方式</dt><dd>{preview.adjustment}</dd></div></dl>
  <p>其它模型输入保持当前工况值；预测值由 QCDKR 重新计算。</p>
  {preview.reference_warnings?.map(warning=><p key={warning.parameter_id} className="micro-note" role="status">{warning.message}</p>)}
  {message.trial_execution?.ab_generated&&<p>✓ 用户确认　✓ QCDKR候选预测　✓ A/B结果生成</p>}
  {message.trial_error&&<div role="status"><UserVisibleText value={message.trial_error}/></div>}
  {pending&&<div className="message-actions"><button disabled={busy||!current} onClick={()=>onAction('confirm',message)}>确认试算</button><button disabled={busy||!current} onClick={()=>onAction('edit',message)}>修改</button><button disabled={busy||!current} onClick={()=>onAction('cancel',message)}>取消</button></div>}
 </section>;
}
const DiagnosticFacts=memo(function DiagnosticFacts({facts}) {
 return <section><h4>诊断事实</h4><dl className="diagnostic-facts">{facts.filter(item=>!isTechnicalLabel(item.label)).map((item,index)=><div key={item.label+index}><dt>{userVisibleText(actualDisplayText(item.label))}</dt><dd><UserVisibleText value={actualDisplayText(item.value)}/></dd></div>)}</dl>{facts.some(item=>isTechnicalLabel(item.label))&&<details><summary>查看技术信息</summary><pre>{JSON.stringify(facts,null,2)}</pre></details>}</section>;
});
const DiagnosticSupport=memo(function DiagnosticSupport({checks,boundary,next,technical}) {
 return <>
  <section><h4>关联检查</h4><ul>{checks.map(item=><li key={item}><UserVisibleText value={actualDisplayText(item)}/></li>)}</ul></section>
  <section className="diagnostic-boundary"><h4>证据边界</h4><UserVisibleText value={actualDisplayText(boundary)}/></section>
  <section><h4>下一步</h4><ul>{next.map(item=><li key={item}><UserVisibleText value={actualDisplayText(item)}/></li>)}</ul></section>
  {technical?.length>0&&<details><summary>查看技术信息</summary><dl>{technical.map(item=><div key={actualDisplayText(item.label)}><dt>{actualDisplayText(item.label)}</dt><dd>{actualDisplayText(item.value)}</dd></div>)}</dl></details>}
 </>;
});
function diagnosticFailureText(message){
 const failure=message.ai_explanation_primary_failure||message.generationError;
 if(failure==='STALE_FINDING_ID')return '当前工况已更新，已丢弃旧工况解读。请重新解读当前工况。';
 if(['FACT_INTERPRETATION_REJECTED','NUMERIC_POLICY_REJECTED'].includes(failure))return '本次AI回答未通过事实校验，已保留诊断事实。可重新解读。';
 if(failure==='FACT_INTERPRETATION_INVALID_FORMAT')return '本次AI回答格式异常，已保留诊断事实。可重新解读。';
 if(['QWEN_TIMEOUT','LOCAL_LLM_TIMEOUT'].includes(failure))return 'AI解读超时，已保留诊断事实。可重新解读。';
 if(['QWEN_INTERRUPTED','LOCAL_LLM_INTERRUPTED'].includes(failure))return '回答生成中断，已保留诊断事实。可重新解读。';
 if(['QWEN_CONTEXT','LOCAL_LLM_CONTEXT'].includes(failure))return '问题超出本地模型上下文，已保留诊断事实。可缩短后重试。';
 if(['QWEN_UNAVAILABLE','LOCAL_LLM_OFFLINE','LOCAL_LLM_MODEL_MISSING','LOCAL_LLM_UNAVAILABLE'].includes(failure))return 'AI连接未就绪，已保留诊断事实。连接恢复后可重新解读。';
 if(failure==='QWEN_ERROR')return 'AI未完成本次解读，已保留诊断事实。可重新解读。';
 return 'DK AI工艺解读当前不可用。';
}
export function DiagnosticSections({message,onRetry,busy=false}) {
  const section=message.diagnostic_sections;
  const factsState=message.facts_state || (section?'READY':'IDLE'),aiState=message.ai_explanation_state || (message.generationError?'FAILED':'READY');
  if(factsState!=='READY'||!section)return <div className="diagnostic-sections" data-facts-state={factsState} data-ai-explanation-state={aiState}><p role="status">{aiState==='STALE_REFERENCE'?'目标参考值已更新，可重新生成DK AI解读。':factsState==='FAILED'?'诊断事实核验失败。':factsState==='LOADING'?'正在核验诊断事实…':'等待诊断事实。'}</p></div>;
  return <div className="diagnostic-sections" data-facts-state={factsState} data-ai-explanation-state={aiState}>
    <DiagnosticFacts facts={section.facts}/>
    <section className="diagnostic-interpretation"><h4>DK AI工艺解读</h4><div role="status">{aiState==='STALE_REFERENCE'?'目标参考值已更新，可重新生成DK AI解读。':['IDLE','LOADING'].includes(aiState)?'DK AI正在解读…':aiState==='FAILED'?diagnosticFailureText(message):<UserVisibleText value={actualDisplayText(section.interpretation)}/>}</div>{aiState==='FAILED'&&onRetry&&message.ai_explanation_primary_failure!=='STALE_FINDING_ID'&&<div className="message-actions"><button disabled={busy} onClick={onRetry}>重新解读<ArrowRight size={12}/></button></div>}{aiState==='STALE_REFERENCE'&&section.interpretation&&message.explanation_text&&<details><summary>历史解读</summary><UserVisibleText value={actualDisplayText(section.interpretation)}/></details>}</section>
    <DiagnosticSupport checks={section.checks} boundary={section.boundary} next={section.next} technical={section.technical}/>
  </div>;
}
export default function AssistantPanel({open,onOpenChange,sessionId,binding,status,messages,question,setQuestion,busy,onCancel,ask,caseData,selected,source,notify,onAction,onDiagnosticAction,onTrialPreviewAction,trialConfirming=false,currentDiagnostics,reference,setReference,cases,baseline,runState,selectedEvent,onClearEvent,diagnosticShortcutTitle=null,onAnalysisHistory,analysisContext,onClearAnalysis,analysisChoice,onAnalysisChoice,experience,onTaskAction,task,taskHistory=[],taskStorageError='',taskRuntime,accessMode='APPROVAL',onAccessModeChange,lastTaskChange,onUndoTaskChange,onLoadCandidate}) {
  const availability=assistantAvailability(status);
  const retryDiagnostic=message=>message.question&&!message.historical&&currentRunMatches(message.fact_packet&&!message.diagnostic_finding_id?{...message,answer_variant:undefined}:message,binding,currentDiagnostics)
    ?()=>ask(message.question,{retryOf:message}):undefined;
  const [sourcesOpen,setSourcesOpen]=useState(false), [toolsOpen,setToolsOpen]=useState(false),[composerMode,setComposerMode]=useState('task');
  // 技术员需要同时看值守卡、记忆和对话，进入该模式时把浮窗展开一次。
  useEffect(()=>{if(composerMode!=='technician')return;const timer=setTimeout(()=>{document.querySelector('[aria-label="最大化 AI 聊天窗"]')?.click();},80);return()=>clearTimeout(timer);},[composerMode]);
  const submit=async()=>{
    if(composerMode==='question'||!taskRuntime)return ask();
    try{const created=await taskRuntime.start(question);if(created)setQuestion('');}catch(error){notify?.(error.message||'任务未开始，请稍后再试。','WARNING');/* Keep the goal so the user can retry after the workspace settles. */}
  };
  const toolsRef=useRef(null);
  useEffect(()=>{
    if(!toolsOpen)return;
    const close=event=>{if(!toolsRef.current?.contains(event.target))setToolsOpen(false);};
    const escape=event=>{if(event.key==='Escape'){event.stopPropagation();setToolsOpen(false);}};
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape,true);
    return ()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape,true);};
  },[toolsOpen]);
  const runTool=(tool,label)=>{setToolsOpen(false);ask(label+'当前工况',{tools:[tool]});};
  const diagnoseCurrent=q=>{
    if(busy)return;
    onClearAnalysis?.();
    return ask(q,{analysisMode:'CURRENT'});
  };
  const composerTools=<>
    <AssistantSources compact open={sourcesOpen} onToggle={()=>{setSourcesOpen(v=>!v);setToolsOpen(false);}} onUploaded={name=>notify('资料已加入：'+name)}/>
    <div ref={toolsRef} className="assistant-quick-tools">
      <button type="button" className="assistant-tool-trigger" title="工况操作" aria-label="工况操作" aria-expanded={toolsOpen} aria-controls="assistant-quick-actions" onClick={()=>{setToolsOpen(v=>!v);setSourcesOpen(false);}}><SlidersHorizontal size={16}/></button>
      {toolsOpen&&<div className="assistant-quick-actions" id="assistant-quick-actions" data-escape-layer="popover"><div className="assistant-quick-heading"><strong>工况操作</strong><button type="button" aria-label="收起工况操作" onClick={()=>setToolsOpen(false)}><X size={14}/></button></div><div className="agent-tool-shortcuts">{actions.map(([tool,label])=><button type="button" key={tool} disabled={busy} onClick={()=>runTool(tool,label)}>{label}</button>)}</div><label className="agent-reference">对比工况<select aria-label="对比工况" value={reference} onChange={e=>setReference(e.target.value)}><option value="__baseline__">初始工况 · {readableConditionName(baseline.id)}</option>{cases.filter(item=>item.input).map(item=><option key={item.id} value={item.id}>{readableConditionName(item.name||item.input.id)}</option>)}</select></label></div>}
    </div>
  </>;
  return <FloatingAssistant {...{open,onOpenChange,sessionId}} mode={status.mode}><div className="assistant-content assistant-compact" data-access-mode={accessMode}>
    <div className="assistant-context-line" data-selected-event={selectedEvent?.id}><span className={'assistant-ready-dot '+(!availability.available?'is-idle':'')} aria-label={availability.label}/><span className="assistant-availability" role="status" title={!availability.available?'AI生成暂不可用；预测与输入检查仍可用。':undefined}>{availability.label}</span><span className="assistant-context-label" title={analysisContext?'历史分析 · #'+analysisContext.analysisId:selectedEvent?userVisibleText(selectedEvent.title||"异常事件"):dataSourceDisplayName(source)+' · '+readableConditionName(caseData.id)}>{analysisContext?'历史分析 · #'+analysisContext.analysisId:selectedEvent?'事件 · '+(userVisibleText(selectedEvent.title||"异常事件")):'当前工况 · '+selected}</span>{selectedEvent&&<button type="button" disabled={busy} onClick={onClearEvent}>返回当前工况</button>}{onAnalysisHistory&&<button type="button" onClick={onAnalysisHistory}>分析记录</button>}</div>
    {onAccessModeChange&&composerMode!=='technician'&&<div className="assistant-mode-control" data-mode={accessMode} aria-label="副驾驶权限模式">
      <div className="assistant-mode-tabs" role="group" aria-label="副驾驶权限模式">
        {ASSISTANT_MODES.map(mode=><button key={mode} type="button" aria-pressed={accessMode===mode} title={ASSISTANT_MODE_LABELS[mode].description} onClick={()=>onAccessModeChange(mode)}>{ASSISTANT_MODE_LABELS[mode].label}</button>)}
      </div>
      <small className="assistant-mode-note">{ASSISTANT_MODE_LABELS[accessMode]?.description}</small>
    </div>}
    {composerMode!=='technician'&&(composerMode==='task'&&taskRuntime?.selected?<details className="task-current-reference"><summary>查看当前工况与下一步建议</summary><AssistantTaskOverview {...{experience,busy,messages,binding}} onAction={onTaskAction}/></details>:<AssistantTaskOverview {...{experience,busy,messages,binding}} onAction={onTaskAction}/>)}
    {taskRuntime&&<div className="assistant-mode-switch" aria-label="助手工作方式"><button type="button" aria-pressed={composerMode==='task'} onClick={()=>setComposerMode('task')}>任务执行</button><button type="button" aria-pressed={composerMode==='question'} onClick={()=>setComposerMode('question')}>工艺问答</button><button type="button" aria-pressed={composerMode==='technician'} onClick={()=>setComposerMode('technician')}>值守技术员</button><span>{composerMode==='task'?'描述目标，查看实际执行结果':composerMode==='technician'?'值守、诊断、交接，带依据与权限':'保留原有问答与资料检索'}</span></div>}
    {composerMode==='question'&&<AssistantTaskProgress task={task} history={taskHistory} storageError={taskStorageError} busy={busy||['RECEIVED','PLANNING','EXECUTING','VERIFYING'].includes(task?.state)} onCancel={onCancel}/>}
    {analysisContext&&<div className="ai-analysis-context"><span>当前分析 · #{analysisContext.analysisId}</span><button type="button" onClick={onClearAnalysis}>返回当前运行</button></div>}
    {analysisChoice&&<div className="ai-analysis-choice"><span>请选择问题所指的上下文：</span><button type="button" onClick={()=>onAnalysisChoice('ANALYSIS')}>当前分析</button><button type="button" onClick={()=>onAnalysisChoice('CURRENT')}>当前工况</button></div>}
    {composerMode==='technician'?<TechnicianPanel context={{caseData, dataSource:source}} notify={notify}/>:taskRuntime&&composerMode==='task'?<div key={'task-'+(taskRuntime.selected?.taskId||taskRuntime.selected?.id||'empty')} className="assistant-conversation task-runtime-conversation"><div className="chat-messages" aria-label="AI任务执行记录"><TaskProgress runtime={taskRuntime} caseData={caseData} accessMode={accessMode} lastTaskChange={lastTaskChange} onUndoTaskChange={onUndoTaskChange} onLoadCandidate={onLoadCandidate}/>{!taskRuntime.selected&&<div className="assistant-empty"><p>告诉我你要处理的目标，我会核验当前工况并组织工具执行。</p></div>}</div></div>:<AssistantConversation {...{messages,busy,open}}>
      {messages.length===0&&<div className="assistant-empty"><p>告诉我你要处理的目标，我会核验当前工况并组织工具执行。</p></div>}
      {messages.map((message,index)=><article key={message.role+":"+(message.user_message_id||message.request_id||index)} data-request-id={message.request_id} data-user-message-id={message.user_message_id} className={'message '+message.role} data-message-mode={message.mode} data-run-id={message.runId} data-diagnostic-message-index={message.answer_variant==='AI_EXPLAIN'?index:undefined}>{message.role==='assistant'&&<div className="message-label"><span className="tiny-bot">DK</span> {message.answer_variant==='AI_EXPLAIN'?userVisibleText(message.diagnosis_title || '工况诊断事实'):'DK AI'} {['error','unavailable'].includes(message.mode)&&<small>服务提示</small>}{message.mode==='interrupted'&&<small className="assistant-interrupted">回答已中断</small>}</div>}{message.role==='assistant'&&assistantScopeLabel(message)&&<small className="message-context-age">{assistantScopeLabel(message)}</small>}{message.role==='assistant'&&!['CONFIG','SERVICE'].includes(message.answerScope)&&message.snapshot_id&&!currentRunMatches(message.fact_packet&&!message.diagnostic_finding_id?{...message,answer_variant:undefined}:message,binding,currentDiagnostics)&&<small className="message-context-age">{message.answer_variant==='AI_EXPLAIN'?'当前工况已更新，请以最新分析结果为准':'当前工况已更新，请以最新分析结果为准'}</small>}{message.reference_history_note&&<small className="message-context-age">历史结果 · {userVisibleText(message.reference_history_note)}</small>}{degradationText(message)&&<p className="assistant-degradation-note">{actualDisplayText(degradationText(message))}</p>}<div className="message-content">{message.answer_variant==='AI_EXPLAIN'&&(message.diagnostic_sections||message.facts_state)?<DiagnosticSections message={message} busy={busy} onRetry={retryDiagnostic(message)}/>:message.role==='assistant'?<UserVisibleText value={actualDisplayText(knowledgeDisplayText(message.text,message.references))}/>:actualDisplayText(knowledgeDisplayText(message.text,message.references))}</div>{message.mode==='interrupted'&&<p className="assistant-degradation-note">{userVisibleText(message.interruptionLabel||'回答已中断')}；这不是完整回答。</p>}{['error','unavailable','interrupted'].includes(message.mode)&&message.retry&&<div className="message-actions"><button disabled={busy} onClick={()=>ask(message.retry,{retryOf:message})}>重试<ArrowRight size={12}/></button></div>}<CandidateTrialPreview message={message} binding={binding} busy={busy||trialConfirming} onAction={onTrialPreviewAction}/>{message.trial_choices?.length>0&&<div className="message-actions">{message.trial_choices.map(choice=><button key={choice.key} disabled={busy} onClick={()=>setQuestion(`将${choice.label}调整为`)}>{choice.label} · 当前值 {String(toDisplay(choice.key,choice.current_value)??'—')} {unitFor(choice.key)}</button>)}</div>}<AgentTrace trace={message.trace} artifact={message.artifact}/><AssistantReferences references={message.references}/>{message.role==='assistant'&&<EvidenceReferences message={message} binding={binding}/>}{message.diagnosis_actions&&<div className="message-actions">{message.diagnosis_actions.map(action=><button key={action.id} disabled={busy||!currentRunMatches(message.fact_packet&&!message.diagnostic_finding_id?{...message,answer_variant:undefined}:message,binding,currentDiagnostics)} onClick={()=>onDiagnosticAction(action,message)}>{userVisibleText(action.label)}<ArrowRight size={12}/></button>)}</div>}{message.actions&&<div className="message-actions">{message.actions.map(action=><button key={action} disabled={!currentRunMatches(message,binding)} onClick={()=>onAction(action,message)}>{({optimize:'查看试算方案',prediction:'查看预测',three:'定位机架',reports:'导出结果'})[action]||'打开'}<ArrowRight size={12}/></button>)}</div>}</article>)}
      {busy&&<div className="chat-thinking"><Loader2 className="spin" size={14}/><span>{userVisibleText(runState||'正在处理…')}</span><button onClick={onCancel}><Square size={12}/>停止</button></div>}
    </AssistantConversation>}
    {composerMode!=='technician'&&<AssistantComposer value={question} onChange={setQuestion} onSend={submit} busy={busy||taskRuntime?.submitting} tools={composerTools}/>}
  </div></FloatingAssistant>;
}
