import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { findingDisplayTitle } from './s5ActualDisplay.js';
import EvidenceReferences from './EvidenceReferences.jsx';
import './assistant-experience.css';

export default function AssistantTaskOverview({experience,busy,onAction,binding}) {
  const [actionState,setActionState]=useState(null);
  if(!experience)return null;
  const run=async action=>{
    if(busy||actionState?.status==='running')return;
    setActionState({key:experience.key,status:'running',text:'正在'+action.label+'…'});
    try {
      const receipt=await onAction(action);
      setActionState({key:experience.key,status:['FAILED','UNVERIFIED'].includes(receipt?.status)?'failed':receipt?.status==='PARTIAL'?'partial':'returned',text:receipt?.message||'请求已交给当前任务，请查看实际返回结果。'});
    } catch(error) {
      setActionState({key:experience.key,status:'failed',text:error.message||'处理未完成，请重试。'});
    }
  };
  return <section className="assistant-task-overview" data-context-key={experience.key} data-task-state={experience.state} aria-label="当前判断与下一步建议">
    <details className="assistant-current-context">
      <summary><strong>当前判断</strong><span>{experience.title}</span></summary>
      <p>{experience.detail}</p>
      {experience.findings.map(finding=><div className="assistant-current-finding" key={finding.finding_id}>
        <strong>{findingDisplayTitle(finding)}</strong>
        <details><summary>查看依据</summary><EvidenceReferences message={{...experience.identity,prediction_mode:'formal',evidence_status:'VALID',findings:[finding],evidence:experience.evidence.filter(e=>finding.evidence_ids.includes(e.evidence_id))}} binding={binding}/></details>
      </div>)}
      <details className="assistant-task-technical"><summary>查看工况身份</summary><pre>{JSON.stringify(experience.identity,null,2)}</pre></details>
    </details>
    <dl className="assistant-task-facts">{experience.facts.map(f=><div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>
    {experience.actions.length>0&&<div className="assistant-next-step">
      <div><strong>下一步建议</strong><span>{experience.state==='normal'?'由你的目标组织任务':'根据当前工况与核验结果'}</span></div>
      <div className="assistant-next-actions">{experience.actions.map((action,index)=><button key={action.type} disabled={busy||actionState?.status==='running'} className={index===0?'primary':''} data-task-action={action.type} onClick={()=>run(action)}>{action.label}{index===0&&<ArrowRight size={13}/>}</button>)}</div>
    </div>}
    {actionState&&<p className={'assistant-task-receipt is-'+actionState.status} role="status">{actionState.key!==experience.key?'工况已更新；本次动作记录保留为历史。':actionState.text}</p>}
  </section>;
}
