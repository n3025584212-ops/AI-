import { currentRunMatches } from './predictionSnapshot.js';
import { assistantContextKey } from './assistantTaskPolicy.js';

export const TASK_STATE_LABELS=Object.freeze({RECEIVED:'已接收',PLANNING:'理解任务',EXECUTING:'执行中',VERIFYING:'核验中',NEEDS_INPUT:'待补信息',NEEDS_CONFIRMATION:'待确认',COMPLETED:'已完成',PARTIAL:'部分完成',FAILED:'未完成',CANCELLED:'已停止',STALE:'工况已变化',UNCERTAIN:'待核对',IDLE:'待命'});
const activeStates=new Set(['RECEIVED','PLANNING','EXECUTING','VERIFYING']);
const rawStates={queued:'RECEIVED',routing:'PLANNING',running:'EXECUTING',executing:'EXECUTING',validating:'VERIFYING',waiting_ui:'VERIFYING',completed:'COMPLETED',partial:'PARTIAL',needs_input:'NEEDS_INPUT',needs_approval:'NEEDS_CONFIRMATION',failed:'FAILED',cancelled:'CANCELLED',stale_context:'STALE'};
const receiptStates={VERIFIED:'COMPLETED',COMPLETED:'COMPLETED',PARTIAL:'PARTIAL',FAILED:'FAILED',CANCELLED:'CANCELLED',STALE:'STALE',AWAITING_INPUT:'NEEDS_INPUT',AWAITING_CONFIRMATION:'NEEDS_CONFIRMATION',UNVERIFIED:'UNCERTAIN',DELEGATED:'VERIFYING'};
export const messageTaskKey=messages=>{const m=messages.findLast(item=>item.role==='user');return m?.user_message_id||m?.request_id||null;};
const failedStep=step=>['error','failed'].includes(step.status);
const pendingStep=step=>['pending','requested','running','queued'].includes(step.status);
function runState(run={}) {
  if(run.trial_error)return 'FAILED';
  if(run.trial_preview?.status==='CANCELLED')return 'CANCELLED';
  if(run.trial_preview?.status==='COMPLETED'&&run.trial_execution?.ab_generated)return 'COMPLETED';
  if(['PENDING_CONFIRMATION','CONFIRMED'].includes(run.trial_preview?.status))return 'NEEDS_CONFIRMATION';
  if(run.ai_explanation_state==='FAILED'&&run.facts_state==='READY')return 'PARTIAL';
  if(run.mode==='interrupted'||run.error_code==='ABORTED')return 'CANCELLED';
  if(run.mode==='error')return 'FAILED';
  let state=rawStates[run.status];
  if(run.final_response&&(!state||activeStates.has(state)))state='COMPLETED';
  if(state==='COMPLETED'&&(run.trace||[]).some(pendingStep))return 'VERIFYING';
  if(state==='COMPLETED'&&((run.trace||[]).some(failedStep)||run.generationError||run.routingError))return (run.trace||[]).some(s=>['success','completed'].includes(s.status))?'PARTIAL':'FAILED';
  return state||'UNCERTAIN';
}
export function receiptFromAgentRun(run) {
  if(!run||typeof run!=='object')return {status:'UNVERIFIED',message:'本次没有返回可关联的工具回执，未记为已完成。'};
  const state=runState(run),status=({COMPLETED:'COMPLETED',NEEDS_INPUT:'AWAITING_INPUT',NEEDS_CONFIRMATION:'AWAITING_CONFIRMATION',PARTIAL:'PARTIAL',FAILED:'FAILED',CANCELLED:'CANCELLED',STALE:'STALE'})[state]||'UNVERIFIED';
  const messages={COMPLETED:'本次工具流程已返回完成状态；实际结果保留在任务记录中。',PARTIAL:'已保留完成的事实或步骤；还有未完成部分，请查看任务结果。',AWAITING_INPUT:'任务需要补充信息，请在下方继续说明。',AWAITING_CONFIRMATION:'候选已准备，等待你确认后继续计算。',FAILED:'本次任务未完成，失败原因保留在任务结果中。',CANCELLED:'本次任务已停止；已完成的步骤保留。',STALE:'原工况已变化，旧结果仅作为历史记录。',UNVERIFIED:'工具未返回明确终态，未记为已完成。'};
  return {status,message:messages[status],run_id:run.runId||null,run_status:run.status||null,facts_state:run.facts_state||null,ai_state:run.ai_explanation_state||null,
    tool_receipts:(run.trace||[]).map(s=>({step_id:s.id||null,tool:s.tool,status:s.status,result_ref:s.resultRef||null,finished_at:s.finishedAt||null})),
    evidence_ids:(run.evidence||[]).map(e=>e.evidence_id).filter(Boolean)};
}
export function projectAssistantTask({messages=[],busy=false,runState:hint='',binding={},uiActivity=null}) {
  const user=messages.findLast(m=>m.role==='user'),key=messageTaskKey(messages);
  const reply=messages.findLast(m=>m.role==='assistant'&&(user?.user_message_id?m.user_message_id===user.user_message_id:true));
  const preferUi=uiActivity&&(!user||key===uiActivity.message_key_at_start)&&(!reply?.runId||uiActivity.receipt?.run_id!==reply.runId);
  if(preferUi) {
    const historical=uiActivity.context_key!==assistantContextKey(binding);
    return {...uiActivity,id:uiActivity.task_id,origin:'ui',title:uiActivity.goal,label:TASK_STATE_LABELS[uiActivity.state],historical,
      steps:uiActivity.receipt?.tool_receipts||[],invalidation_reason:historical?'CONTEXT_IDENTITY_CHANGED':null,message:null};
  }
  if(!user&&!reply)return null;
  let state=reply?runState(reply):busy?'RECEIVED':'UNCERTAIN';
  if(busy){state=/排队/.test(hint)?'RECEIVED':/核对|核验|视图/.test(hint)?'VERIFYING':/规划|思考/.test(hint)?'PLANNING':'EXECUTING';}
  const identity=reply?.task_context||user?.task_context||reply;
  const historical=!!identity&&(reply?.historical||(identity.snapshot_id?!currentRunMatches(identity,binding):identity.contextFingerprint&&identity.contextFingerprint!==binding.contextFingerprint));
  if(historical&&activeStates.has(state))state='STALE';
  return {id:reply?.runId||reply?.request_id||key,origin:'agent',title:user?.text||reply?.question||'当前业务任务',state,label:TASK_STATE_LABELS[state],historical,invalidation_reason:historical?'CONTEXT_IDENTITY_CHANGED':null,
    message:reply||null,context_identity:identity?{snapshot_id:identity.snapshot_id,observation_id:identity.observation_id,input_hash:identity.input_hash,model_hash:identity.model_hash,model_version:identity.model_version,prediction_mode:identity.prediction_mode,contextFingerprint:identity.contextFingerprint,operation_scope:identity.operation_scope}:null,
    steps:(reply?.trace||[]).map(s=>({step_id:s.id||null,tool:s.tool,status:s.status,result_ref:s.resultRef||null})),receipt:reply?receiptFromAgentRun(reply):null,
    needsConfirmation:state==='NEEDS_CONFIRMATION',canRetry:!!reply&&(reply.retry||reply.answer_variant==='AI_EXPLAIN'&&reply.ai_explanation_state==='FAILED')};
}
export function createUiTask(experience,action,messages) {
  return {task_id:crypto.randomUUID(),goal:action.label,action_type:action.type,state:'EXECUTING',context_key:experience.key,context_identity:structuredClone(experience.identity),
    message_key_at_start:messageTaskKey(messages),trigger:experience.trigger||'USER_ACTION',facts:experience.facts.map(f=>({...f})),fact_refs:experience.findings.map(f=>f.finding_id),
    evidence_refs:experience.evidence.map(e=>e.evidence_id),preconditions:{prediction_ready:experience.ready,finding_id:action.findingId||null,target:action.target||null},
    created_at:new Date().toISOString(),updated_at:new Date().toISOString(),receipt:null};
}
export function settleUiTask(task,receipt) {
  return {...task,state:receiptStates[receipt?.status]||'UNCERTAIN',receipt:receipt||{status:'UNVERIFIED'},updated_at:new Date().toISOString()};
}
export function restoreTaskActivities(raw) {
  try {
    const data=JSON.parse(raw);if(data?.version!==1||!Array.isArray(data.tasks))return [];
    return data.tasks.filter(t=>typeof t.task_id==='string'&&typeof t.goal==='string'&&typeof t.context_key==='string'&&TASK_STATE_LABELS[t.state]).map(t=>activeStates.has(t.state)?{...t,state:'UNCERTAIN',receipt:{status:'UNVERIFIED',message:'上次窗口关闭前没有终态回执；未自动重放。'}}:t);
  } catch {return [];}
}
export function petTaskState({task,busy=false,runState='',voiceState={},attention=false}) {
  if(voiceState.following&&voiceState.phase==='recording')return {id:'LISTENING',label:'正在聆听'};
  if(['recognizing','thinking'].includes(voiceState.phase))return {id:'PLANNING',label:'理解任务'};
  if(voiceState.phase==='executing')return {id:'EXECUTING',label:'执行中'};
  if(voiceState.phase==='speaking')return {id:'SPEAKING',label:'正在播报'};
  if(busy){const id=/排队/.test(runState)?'RECEIVED':/核对|核验|视图/.test(runState)?'VERIFYING':/规划|思考/.test(runState)?'PLANNING':'EXECUTING';return {id,label:TASK_STATE_LABELS[id]};}
  if(task&&!task.historical)return {id:task.state,label:TASK_STATE_LABELS[task.state]};
  return attention?{id:'ATTENTION',label:'有待处理项'}:{id:'IDLE',label:'DK AI'};
}
