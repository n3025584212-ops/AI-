import { summarizeModelInputs } from './modelInputs.js';
import { currentRunMatches } from './predictionSnapshot.js';
import { normalizeAssistantMode } from './assistantAccess.js';

export const SUGGESTION_COOLDOWN_MS = 30000;
const number = value => Number.isFinite(value) ? value.toLocaleString('en-US',{maximumFractionDigits:3})+' t' : '—';
export function assistantContextKey(identity={}) {
  return [identity.snapshot_id,identity.observation_id,identity.input_hash,identity.model_hash,identity.model_version,identity.prediction_mode,identity.contextFingerprint,identity.operation_scope?.session_id,identity.operation_scope?.revision].map(x=>typeof x==='object'?JSON.stringify(x):x||'').join('|');
}
export function buildAssistantExperience({input,result,diagnostics,binding={},modelStatus={},predictionState,dirty,alarm={},page='overview',task=null,mode='APPROVAL'}) {
  const summary=summarizeModelInputs(input),identity={...binding},key=assistantContextKey(identity);
  const ready=binding.valid===true&&!dirty&&predictionState==='READY'&&result?.mode==='formal'&&Number.isFinite(alarm.rawPrediction);
  const findings=ready&&diagnostics?.status==='VALID'&&currentRunMatches(diagnostics.identity,binding)
    ? (diagnostics.findings||[]).filter(f=>f.status==='VALID'&&f.snapshot_id===binding.snapshot_id) : [];
  const act=(type,label,extra={})=>({type,label,contextKey:key,...extra});
  const facts=[{label:'S5预测',value:ready?number(alarm.rawPrediction):'等待当前预测'},{label:'当前实测',value:ready?number(alarm.actualValue):'等待核对'},
    {label:'正式输入',value:`${summary.completeCount}/25完整${summary.invalid.length?' · '+summary.invalid.length+'项待修正':''}`}];
  let state='updating',title='正在同步当前工况',detail='预测与依据同步后再生成处理建议。',actions=[],suggestion=null;
  if(!summary.valid) {
    state='input';title='当前输入需要处理';detail=`${summary.missing.length}项待补充，${summary.invalid.length}项待修正：${[...summary.missing,...summary.invalid].map(item=>item.label).join('、')}。先核验输入，再预测或试算。`;
    actions=[act('validate','核验当前输入'),act('open-input','查看输入字段')];
    suggestion={key:'INPUT:'+summary.missing.map(x=>x.key||x).join(',')+':'+summary.invalid.map(x=>x.key||x).join(','),title:'有输入需要核验',reason:detail,severity:'attention'};
  } else if(predictionState==='FAILED'||['FAILED','ERROR','BLOCKED'].includes(modelStatus.status)) {
    state='failed';title='当前预测尚未完成';detail='先检查预测服务和本次失败原因，不把缺少结果当成工况故障。';
    actions=[act('inspect','检查预测服务')];suggestion={key:'PREDICTION_FAILED',title:'本次预测需要检查',reason:detail,severity:'attention'};
  } else if(ready) {
    const deviation=['LOW_ERROR_ALARM','HIGH_ERROR_ALARM'].includes(alarm.status),hasActual=Number.isFinite(alarm.actualValue);
    state=deviation?'attention':hasActual?'normal':'observation';
    title=deviation?'当前预测误差超出允许区间':hasActual?'当前工况在允许区间内':'当前缺少可比对的实测';
    detail=deviation?'先核对同一工况的输入与实测，再分析偏差或组织候选试算。':hasActual?'没有需要重复提醒的处理项。可以直接告诉助手你的生产目标。':'保留预测结果；没有有效实测时，不推断误差异常或设备故障。';
    const finding=findings.find(f=>f.kind==='S5_PREDICTION_OBSERVATION_DIFFERENCE')||findings[0];
    if(deviation&&finding) {
      actions=[act('diagnose','分析当前偏差',{findingId:finding.finding_id})];
      const target=finding.targets?.find(t=>/^S[1-5]$/.test(t));
      if(target)actions.push(act('locate','查看关联设备',{findingId:finding.finding_id,target}));
      actions.push(act('trial','提出试算目标'));
      suggestion={key:'ERROR:'+alarm.status+':'+(target||''),title:'当前偏差值得核对',reason:detail,severity:'attention'};
    } else if(!hasActual)actions=[act('validate','核对输入与实测来源')];
    else actions=[act('goal','说明处理目标')];
  }
  let trigger=state==='input'?'INPUT_CHANGED':state==='failed'?'PREDICTION_FAILED':ready?'CURRENT_CONTEXT_ACCEPTED':'CONTEXT_UPDATING';
  if(ready&&task&&!task.historical) {
    const extra={taskId:task.id};
    if(task.state==='NEEDS_CONFIRMATION') {
      trigger='TASK_WAITING_CONFIRMATION';actions=[act('review-task','查看待确认候选',extra)];
      suggestion={key:'TASK:'+task.id+':CONFIRM',title:'候选等待确认',reason:'先核对本次候选的具体调整，再决定是否继续试算。',severity:'attention'};
    } else if(task.state==='NEEDS_INPUT') {
      trigger='TASK_WAITING_INPUT';actions=[act('goal','补充任务信息')];suggestion=null;
    } else if(['PARTIAL','FAILED','UNCERTAIN'].includes(task.state)) {
      trigger='TASK_'+task.state;actions=[...(task.canRetry?[act('retry-task','重试未完成部分',extra)]:[]),act('review-task','查看本次任务记录',extra)];
      suggestion={key:'TASK:'+task.id+':'+task.state,title:task.state==='PARTIAL'?'任务还有未完成部分':'本次任务需要处理',reason:'保留真实结果与失败原因，不把未完成步骤记为成功。',severity:'attention'};
    } else if(task.state==='COMPLETED'&&task.message?.trial_execution?.ab_generated) {
      trigger='TRIAL_COMPLETED';actions=[act('open-comparison',page==='optimize'?'查看本次候选差异':'查看本次A/B结果',extra),act('trial','提出新的试算目标')];suggestion=null;
    } else if(task.state==='COMPLETED'&&task.message?.facts_state==='READY'&&findings.length) {
      trigger='DIAGNOSTIC_COMPLETED';const finding=findings.find(f=>f.kind==='S5_PREDICTION_OBSERVATION_DIFFERENCE')||findings[0],target=finding.targets?.find(t=>/^S[1-5]$/.test(t));
      actions=[act('similar','查找同规格相似工况'),...(target?[act('locate','查看关联设备',{findingId:finding.finding_id,target})]:[]),act('trial','提出试算目标')];suggestion=null;
    }
  }
  const accessMode=normalizeAssistantMode(mode);
  if(accessMode==='READ_ONLY'){
    const allowed=new Set(['validate','open-input','inspect','diagnose','locate','goal','similar','review-task','open-comparison']);
    actions=actions.filter(action=>allowed.has(action.type));
  }
  return {key,identity,ready,state,title,detail,facts,trigger,page,mode:accessMode,findings:findings.map(f=>({...f})),evidence:ready?diagnostics?.evidence||[]:[],actions,suggestion:suggestion?{...suggestion,contextKey:key,trigger,fact_refs:findings.map(f=>f.finding_id),preconditions:{current_snapshot:binding.snapshot_id||null,prediction_ready:ready}}:null};
}
export function mayAnnounceSuggestion({suggestion,now,lastAnnounced=-Infinity,editing=false,open=false,dragging=false}) {
  return !!suggestion&&suggestion.severity==='attention'&&!editing&&!open&&!dragging&&now-lastAnnounced>=SUGGESTION_COOLDOWN_MS;
}
