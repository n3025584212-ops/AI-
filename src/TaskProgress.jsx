import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Download, Loader2, Pause, RefreshCw, Square, X } from 'lucide-react';
import { TASK_TERMINAL, taskId, taskStatus, taskStepId, downloadTaskArtifact } from './useTaskRuntime.js';
import { MODEL_FEATURES } from './modelInputs.js';
import { formatEngineering, unitFor } from './engineeringUnits.js';
import './task-runtime.css';

const labels={queued:'已接收',pending:'已接收',planned:'待执行',validating:'核验上下文',planning:'组织任务',running:'执行中',executing:'执行中',verifying:'核对结果',waiting_input:'需要补充信息',needs_input:'需要补充信息',waiting_approval:'等待确认',needs_approval:'等待确认',waiting_ui:'等待界面核验',needs_reconciliation:'核对执行状态',context_stale:'工况已变化',stale_context:'工况已变化',interrupted:'执行已中断',succeeded:'已完成',completed:'已完成',partial:'部分完成',failed:'未完成',cancelled:'已取消',skipped:'已跳过',superseded:'已由补充信息替换'};
const label=status=>labels[status]||'处理中';
const text=value=>value==null?'未返回':typeof value==='object'?JSON.stringify(value):String(value);
const metricLabels={s5_prediction:'S5模型预测',s5_observed:'同工况实际值',s5_observation:'S5实际观测',prediction_error:'预测与实际值之差',s5_prediction_error:'预测误差（预测减实际）',current_prediction:'当前工况预测',reference_prediction:'对比工况预测',prediction_difference:'两工况预测差',s5_target_gap:'预测与目标差值',prediction:'模型预测',observation:'实际观测',actual:'实际观测',width:'带钢宽度'};
const scopeLabels={CURRENT:'当前工况',HISTORICAL:'历史工况',TASK:'任务绑定工况',CANDIDATE:'候选试算',SNAPSHOT:'绑定快照',current:'当前工况',historical:'历史工况',candidate:'候选试算',snapshot:'绑定快照'};
function safeArtifactUrl(artifact){
  const raw=artifact.downloadUrl||artifact.url||artifact.href;
  if(typeof raw!=='string')return null;
  try{const url=new URL(raw,window.location.origin);return url.origin===window.location.origin&&url.pathname.startsWith('/api/')?url.href:null;}catch{return null;}
}
export default function TaskProgress({runtime,caseData,accessMode='APPROVAL',lastTaskChange,onUndoTaskChange,onLoadCandidate}){
  const root=useRef(null);
  const [reply,setReply]=useState(''),[actionBusy,setActionBusy]=useState(false),[localError,setLocalError]=useState(''),[downloadNote,setDownloadNote]=useState('');
  const task=runtime.selected,status=taskStatus(task),terminal=TASK_TERMINAL.has(status);
  useEffect(()=>{if(terminal&&root.current?.parentElement)root.current.parentElement.scrollTop=0;},[taskId(task),terminal]);
  const run=async fn=>{if(actionBusy)return;setActionBusy(true);setLocalError('');try{await fn();setReply('');}catch(error){setLocalError(error.message);}finally{setActionBusy(false);}};
  if(!task)return runtime.error?<div className="task-runtime-error" role="status"><span>{runtime.error}</span><button type="button" onClick={runtime.refresh}><RefreshCw size={13}/>重新连接任务</button></div>:null;
  const pending=task.steps?.find(step=>['waiting_approval','needs_approval'].includes(step.status));
  const canUndo=accessMode!=='READ_ONLY'&&typeof onUndoTaskChange==='function'&&lastTaskChange?.taskId===taskId(task)&&!['queued','running','executing','verifying','waiting_ui','waiting_approval','waiting_input'].includes(status);
  const displayStatus=canUndo&&status==='failed'?'applied':status;
  const displayLabel=displayStatus==='applied'?'已应用 · 待核验':label(status);
  const pendingChanges=pending?.actionId==='parameter.update'&&Array.isArray(pending.args?.changes)?pending.args.changes.map(change=>{
    const feature=MODEL_FEATURES.find(item=>item.key===change.feature_key),target=feature?.stand?caseData?.stands?.find(stand=>stand.id===feature.stand):caseData;
    const before=feature?target?.[feature.field]:null,after=change.value;
    const unitMatches=Boolean(feature)&&change.unit===unitFor(feature.field);
    const percent=unitMatches&&Number.isFinite(before)&&before!==0&&Number.isFinite(after)?(after-before)/before*100:null;
    return {feature,change,before,after,percent,unitMatches};
  }):null;
  const facts=Array.isArray(task.facts)?task.facts:[],artifacts=Array.isArray(task.artifacts)?task.artifacts:[];
  const candidate=(task.steps||[]).map(step=>step.status==='succeeded'?(step.result?.candidate||step.result?.data?.candidate||null):null).filter(item=>item?.input).at(-1)||null;
  return <section ref={root} className="task-runtime" data-task-id={taskId(task)} data-task-status={status} data-display-status={displayStatus} data-access-mode={task.accessMode||'APPROVAL'} aria-label="AI任务执行记录">
    <header className="task-runtime-heading"><strong>当前任务</strong><span className={'task-runtime-status is-'+displayStatus} role="status">{terminal?(status==='succeeded'||status==='completed'||displayStatus==='applied'?<Check size={13}/>:<Square size={12}/>):['waiting_approval','waiting_input','context_stale','interrupted'].includes(status)?<Pause size={13}/>:<Loader2 className="spin" size={13}/>} {displayLabel}</span></header>
    {runtime.tasks.length>1&&<label className="task-runtime-select">任务记录<select aria-label="选择任务记录" value={taskId(task)} onChange={event=>runtime.select(event.target.value)}>{runtime.tasks.map(item=><option key={taskId(item)} value={taskId(item)}>{label(taskStatus(item))} · {item.goal}</option>)}</select></label>}
    <p className="task-runtime-goal">{task.goal}</p>
    <ol className="task-runtime-steps">{(task.steps||[]).map((step,index)=><li key={taskStepId(step)||index} data-step-status={step.status}><div><span className="task-runtime-step-number">{index+1}</span><strong>{step.title||step.actionId||step.action_id}</strong><span>{label(step.status)}</span></div>{step.error&&<p className="task-runtime-error">{text(step.error?.message||step.error)}</p>}{(step.result||step.receipt)&&<details><summary>查看执行结果与回执<ChevronDown size={12}/></summary><pre>{JSON.stringify({result:step.result,receipt:step.receipt},null,2)}</pre></details>}</li>)}</ol>
    {pending&&<div className="task-runtime-plan" aria-label="执行计划"><strong>执行计划</strong><span>{(task.steps||[]).map(step=>step.title||step.actionId).join(' → ')}</span><small>读取步骤已完成；写入步骤会在这里停下，确认参数与工况后执行。</small></div>}
    {pending&&<div className="task-runtime-confirm"><strong>确认这次实际操作</strong><p>{pending.title}</p>
      {pendingChanges?<div className="task-runtime-diff" role="table" aria-label="本次参数变更">
        <div className="task-runtime-diff-row task-runtime-diff-head" role="row"><span role="columnheader">参数</span><span role="columnheader">当前值</span><span role="columnheader">将改为</span><span role="columnheader">变化</span></div>
        {pendingChanges.map(({feature,change,before,after,percent,unitMatches})=><div className="task-runtime-diff-row" role="row" key={change.feature_key}>
          <span role="cell">{feature?.label||change.feature_key}</span>
          <span role="cell">{Number.isFinite(before)?formatEngineering(feature?.field||'force',before,3):'—'}</span>
          <span role="cell">{Number.isFinite(after)?`${after} ${change.unit||''}`.trim():'—'}</span>
          <span role="cell" className={Number.isFinite(percent)&&Math.abs(percent)>20?'is-warning':''}>{Number.isFinite(percent)?(percent>0?'+':'')+percent.toFixed(1)+'%':'—'}</span>
        </div>)}
        {pendingChanges.some(item=>Number.isFinite(item.percent)&&Math.abs(item.percent)>20)&&<p className="task-runtime-diff-warning" role="status">改动幅度超过 20%，请确认这是你要的目标值，而不是单位或字段换算错误。</p>}
        {pendingChanges.some(item=>!item.unitMatches)&&<p className="task-runtime-diff-warning" role="status">提交单位与当前显示单位不一致，请核对单位后再确认。</p>}
      </div>:<pre>{JSON.stringify(pending.args||pending.uiAction,null,2)}</pre>}
      <p>确认绑定本次参数与工况；参数或工况变化后，旧确认不再适用。</p><button className="task-runtime-primary" type="button" disabled={actionBusy} onClick={()=>run(()=>runtime.approve(task))}>确认并执行</button></div>}
    {runtime.importRequest?.taskId===taskId(task)&&<div className="task-runtime-confirm"><strong>{runtime.importRequest.kind==='knowledge'?'选择这次任务要上传的资料':'选择这次任务要导入的文件'}</strong><p>{runtime.importRequest.kind==='knowledge'?'选择 TXT、MD 或 DOCX 后提取资料，并核对服务端文档记录；不会从对话中猜测本机文件路径。':'选择 CSV 或 JSON 后，继续按实际字段、单位和数据校验结果执行。尚未选择文件不计为导入完成。'}</p><button type="button" className="task-runtime-primary" onClick={runtime.chooseImport}>{runtime.importRequest.kind==='knowledge'?'选择资料文件':'选择导入文件'}</button></div>}
    {['waiting_input','needs_input'].includes(status)&&<form className="task-runtime-reply" onSubmit={event=>{event.preventDefault();if(reply.trim())void run(()=>runtime.resume(task,{message:reply.trim()}));}}><label htmlFor={'task-reply-'+taskId(task)}>{text(task.pending?.question||task.pendingQuestion||task.pending?.message||'请补充任务需要的信息')}</label><textarea id={'task-reply-'+taskId(task)} value={reply} onChange={event=>setReply(event.target.value)} rows={2}/><button type="submit" disabled={actionBusy||!reply.trim()}>补充并继续</button></form>}
    {task.summary&&<p className="task-runtime-summary">{text(task.summary)}</p>}
    {candidate&&accessMode!=='READ_ONLY'&&!['queued','running','executing','verifying','waiting_ui','waiting_approval'].includes(status)&&typeof onLoadCandidate==='function'&&<div className="task-runtime-candidate">
      <strong>AI 候选（未应用）</strong>
      {candidate.changes?.length>0&&<div className="task-runtime-diff" role="table" aria-label="候选参数">
        <div className="task-runtime-diff-row task-runtime-diff-head" role="row"><span role="columnheader">参数</span><span role="columnheader">当前值</span><span role="columnheader">候选值</span><span role="columnheader">变化</span></div>
        {candidate.changes.map(change=>{const feature=MODEL_FEATURES.find(item=>item.key===change.feature_key);const percent=Number.isFinite(change.before)&&change.before!==0&&Number.isFinite(change.after)?(change.after-change.before)/change.before*100:null;return <div className="task-runtime-diff-row" role="row" key={change.feature_key}><span role="cell">{feature?.label||change.feature_key}</span><span role="cell">{formatEngineering(feature?.field||'force',change.before,3)}</span><span role="cell">{formatEngineering(feature?.field||'force',change.after,3)}</span><span role="cell">{Number.isFinite(percent)?(percent>0?'+':'')+percent.toFixed(1)+'%':'—'}</span></div>;})}
      </div>}
      <p>候选只生成，不会自动改工作台；确认后载入并重新预测。</p>
      <button type="button" className="task-runtime-primary" disabled={actionBusy} onClick={()=>run(async()=>{await onLoadCandidate(candidate);})}>载入候选并预测</button>
    </div>}
    {canUndo&&<div className="task-runtime-undo"><strong>本次变更已应用</strong><p>可用任务开始前的当前工况重新计算，撤销这次任务对工作台的修改。</p><button type="button" disabled={actionBusy} onClick={()=>run(async()=>{await onUndoTaskChange(lastTaskChange);})}>撤销本次变更</button></div>}
    {(task.error||task.terminalReason&&task.terminalReason.message!==task.summary)&&<p className="task-runtime-error" role="status">{text(task.error?.message||task.error||task.terminalReason?.message||task.terminalReason)}</p>}
    {facts.length>0&&<details className="task-runtime-facts"><summary>已核验事实 · {facts.length}</summary><dl>{facts.map((fact,index)=>{const identity=fact.contextIdentity||{},snapshot=fact.snapshot_id||fact.snapshotId||identity.snapshotId;return <div key={fact.factId||fact.id||index}><dt>{fact.label||metricLabels[fact.metric]||fact.metric||fact.name||'已核验事实'} · {fact.historical?'历史结果':scopeLabels[fact.scope]||fact.scope||'任务绑定结果'}</dt><dd>{text(fact.value??fact.text??fact.summary??fact)}{fact.unit?' '+fact.unit:''}</dd>{snapshot&&<small>快照：{snapshot}</small>}{(fact.source||fact.sourceStepId||fact.evidenceId)&&<small>来源：{text(fact.source||fact.sourceStepId||fact.evidenceId)}</small>}</div>;})}</dl></details>}
    {artifacts.length>0&&<div className="task-runtime-artifacts">{artifacts.map((artifact,index)=>{const name=artifact.name||artifact.filename||artifact.title||'下载任务成果';if(typeof artifact.content==='string')return <button type="button" key={artifact.id||index} disabled={actionBusy} onClick={()=>run(async()=>{const receipt=await downloadTaskArtifact(artifact);setDownloadNote('已校验并发起下载：'+receipt.artifact.filename);})}><Download size={14}/>{name}</button>;const url=safeArtifactUrl(artifact);return url?<a key={artifact.id||index} href={url} download><Download size={14}/>{name}</a>:<span key={artifact.id||index}>{name} · 下载内容尚未返回</span>;})}</div>}
    {downloadNote&&<p role="status">{downloadNote}</p>}
    {(runtime.error||localError)&&<p className="task-runtime-error" role="status">{localError||runtime.error}</p>}
    <footer className="task-runtime-actions">{!terminal&&<button type="button" disabled={actionBusy} onClick={()=>run(()=>runtime.cancel(task))}><X size={13}/>取消任务</button>}{['interrupted','needs_reconciliation'].includes(status)&&<button type="button" disabled={actionBusy} onClick={()=>run(()=>runtime.resume(task))}><RefreshCw size={13}/>核对并恢复</button>}<button type="button" disabled={actionBusy} onClick={runtime.refresh}><RefreshCw size={13}/>刷新实际状态</button></footer>
  </section>;
}
