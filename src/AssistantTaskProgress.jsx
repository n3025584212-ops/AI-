import { TASK_STATE_LABELS } from './assistantTaskRuntime.js';
const stepStates={success:'已完成',completed:'已完成',error:'失败',failed:'失败',pending:'待执行',requested:'待视图回执',skipped:'未执行',running:'执行中'};
const toolLabels={validate:'检查输入',predict:'模型预测',analyze:'影响分析',compare:'工况对比',optimize:'生成方案',knowledge:'检索资料','3D':'定位测点',report:'生成报告','runtime.get_context':'读取请求上下文','diagnostic.query':'查询诊断依据','data.get_segment':'读取样本片段','data.validate':'检查输入','prediction.predict_s5':'计算S5预测','analysis.compare_segments':'比较工况','analysis.sensitivity':'参数影响分析','events.get_event':'读取事件','events.search':'查找事件','history.find_similar':'查找相似工况','knowledge.search':'检索资料','service.inspect':'检查服务状态','trials.create_preview':'准备隔离试算','ui.focus':'定位视图','ui.open_comparison':'打开对比','ui.open_replay':'载入回放','rules.get':'读取监测规则','rules.preview_change':'预览规则调整'};
export default function AssistantTaskProgress({task,history=[],storageError,onCancel,busy}) {
  if(!task&&!history.length)return null;
  return <details className="assistant-task-progress" aria-label="任务状态与记录" data-active-task-id={task?.id} data-active-task-state={task?.state}>
    <summary><span className={'assistant-task-state is-'+(task?.state||'idle').toLowerCase()}>{task?.label||'任务记录'}</span><span title={task?.title}>{task?.title||'查看本机操作回执'}</span></summary>
    {task&&<div className="assistant-active-task">
      {task.historical&&<p>这是先前工况的任务记录，不作为当前操作依据。</p>}
      {task.state==='NEEDS_CONFIRMATION'&&<p>在下方候选结果中确认后，正式模型才继续试算。</p>}
      {task.state==='UNCERTAIN'&&<p>尚无明确终态回执，未自动重放或记为完成。</p>}
      {task.receipt?.message&&<p>{task.receipt.message}</p>}
      {task.steps?.length>0&&<ol>{task.steps.map((step,index)=><li key={step.step_id||index}><span>{toolLabels[step.tool]||'业务操作'}</span><span>{stepStates[step.status]||'状态待核对'}</span></li>)}</ol>}
      <details><summary>任务依据与回执</summary><pre>{JSON.stringify({task_id:task.id,state:task.state,invalidation_reason:task.invalidation_reason,trigger:task.trigger,context_identity:task.context_identity,preconditions:task.preconditions,fact_refs:task.fact_refs,evidence_refs:task.evidence_refs,receipt:task.receipt},null,2)}</pre></details>
      {busy&&<button type="button" onClick={onCancel}>停止当前任务</button>}
    </div>}
    {history.length>0&&<details className="assistant-task-history"><summary>本机操作记录 · {history.length}</summary><ol>{[...history].reverse().map(item=><li key={item.task_id} data-activity-task-id={item.task_id}><details><summary>{TASK_STATE_LABELS[item.state]} · {item.goal}</summary><p>{item.receipt?.message||'尚无终态回执'}</p><pre>{JSON.stringify(item,null,2)}</pre></details></li>)}</ol></details>}
    {storageError&&<p role="status">{storageError}</p>}
  </details>;
}
