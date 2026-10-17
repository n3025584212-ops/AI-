import React from 'react';
import { messageEvidence } from './evidence.js';
import { actualDisplayText, findingDisplayTitle } from './s5ActualDisplay.js';
import { modelDisplayName, userVisibleText } from './userVisibleText.js';
import UserVisibleText from './UserVisibleText.jsx';

const names={PREDICTION:'QCDKR 正式预测',OBSERVATION:'S5实际值记录',DRAFT_COMPARISON:'方案工况对比'};
const kinds={S5_TARGET_DIFFERENCE:'S5 预测与目标差异',S5_PREDICTION_OBSERVATION_DIFFERENCE:'S5预测与实际值差异',S5_OBSERVATION_MISSING:'当前工况未提供S5实际值',DRAFT_PREDICTION_DIFFERENCE:'方案与当前工况预测对比'};
const sources={DK_QKAR_RESULT:'已验证正式预测结果',S5_OBSERVATION_RECORD:'已验证实际值记录',R3_DRAFT_RESULT_COMPARISON:'已验证方案与当前工况结果'};
const states={VALID:'依据已核验',STALE:'历史依据',PENDING:'依据待核验',UNAVAILABLE:'暂不可用'};
export default function EvidenceReferences({message,binding}) {
  const bundle=messageEvidence(message,binding),items=[...bundle.findings,...bundle.evidence];
  if(!items.length)return message.evidence_status==='UNAVAILABLE'?<p className="micro-note">证据记录暂不可用，无法形成已验证结论。</p>:null;
  return <div className="assistant-references" aria-label="系统证据依据"><small>依据 {items.length} 项</small>{items.map(item=><details key={item.finding_id || item.evidence_id}>
    <summary>{userVisibleText(findingDisplayTitle(item) || kinds[item.kind] || names[item.type] || '业务记录依据')} · {states[item.status]}</summary>
    {item.statement&&<UserVisibleText value={actualDisplayText(item.statement)}/>}
    <dl><dt>类型</dt><dd>{kinds[item.kind] || names[item.type]}</dd><dt>状态</dt><dd>{states[item.status]}</dd>
      <dt>来源</dt><dd>{userVisibleText(actualDisplayText(item.source_label || sources[item.source_kind] || '系统根据已验证业务记录计算'))}</dd>{item.model_version&&<><dt>模型</dt><dd>{modelDisplayName(item.model_version)}</dd></>}<dt>登记时间</dt><dd>{item.created_at}</dd></dl>
    <details><summary>查看技术信息</summary><pre>{JSON.stringify(item,null,2)}</pre></details>
  </details>)}</div>;
}
