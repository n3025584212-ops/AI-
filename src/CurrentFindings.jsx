import { userVisibleText } from './userVisibleText.js';
import React from 'react';
import EvidenceReferences from './EvidenceReferences.jsx';
import { TARGET_METADATA } from './findingContract.js';
import './current-findings.css';
import { findingDisplayTitle } from './s5ActualDisplay.js';

const states={VALID:'依据已核验',PENDING:'依据待核验'};
const notices={WAITING:'等待当前工况预测完成',PENDING:'正在核验当前分析依据…',UNAVAILABLE:'分析依据暂不可用',DEMO:'演示模式 · 暂无正式分析依据'};
const scopeNote='依据状态仅说明记录引用的核验情况，不代表工艺正确、安全或现场验证通过。';

// App owns current identity filtering. This component only displays its projection.
export default function CurrentFindings({diagnostics,alarm,inputDisplay,predictionState,modelStatus,plcStatus,onLocateFindingTarget,onDiagnoseFinding,diagnosingFindingId=null,diagnosisBusy=false}) {
  // The workbench updates in two phases (input frame, then prediction), so
  // WAITING/PENDING would otherwise replace this whole bar with a notice and
  // make it blink every record. Keep the last verified analysis visible until
  // the next verified one arrives; the small dot is the only pending cue.
  const lastValid=React.useRef(null);
  const currentValid=diagnostics?.status==='VALID'&&Array.isArray(diagnostics.findings)&&diagnostics.findings.length>0;
  if(currentValid)lastValid.current={diagnostics,alarm};
  const holding=!currentValid&&!!lastValid.current&&predictionState!=='FAILED'
    &&inputDisplay?.predictionAllowed!==false&&!['BLOCKED','FAILED','ERROR'].includes(modelStatus?.status);
  const shown=holding?lastValid.current:{diagnostics,alarm};
  const shownAlarm=shown.alarm||alarm;
  const {status='WAITING',findings=[],evidence=[],identity,binding}=shown.diagnostics || {};
  const errorAlarm=['LOW_ERROR_ALARM','HIGH_ERROR_ALARM'].includes(shownAlarm?.status);
  const abnormal=inputDisplay?.predictionAllowed===false||predictionState==='FAILED'||['BLOCKED','FAILED','ERROR'].includes(modelStatus?.status)||errorAlarm;
  const heading=abnormal?'当前诊断':'当前分析';
  const notice=inputDisplay?.predictionAllowed===false?(inputDisplay.communicationStopped?'通讯已断开 · 数据已停止更新 · 实时预测暂停':inputDisplay.pausedText):predictionState==='FAILED'?'当前工况模型计算异常':notices[status]||'暂无当前分析项';
  if(status!=='VALID'||!findings.length)return <section className="current-findings current-findings-notice" aria-label={heading}><strong>{heading}</strong><span role="status">{notice}</span></section>;
  const title=finding=>findingDisplayTitle(finding);
  const errorState=shownAlarm?.status==='NORMAL'?'允许区间内':shownAlarm?.status==='LOW_ERROR_ALARM'?'低于下限 '+shownAlarm.exceedance.toFixed(3)+' t':shownAlarm?.status==='HIGH_ERROR_ALARM'?'超过上限 '+shownAlarm.exceedance.toFixed(3)+' t':'暂无可判断的预测误差';
  const description=(finding,compact)=>{const linked=evidence.filter(item=>finding.evidence_ids.includes(item.evidence_id)),verified=linked.filter(item=>item.status==='VALID').length;return <>{!compact&&<span>{finding.targets.join('、')}</span>}{!compact&&finding.kind==='S5_PREDICTION_OBSERVATION_DIFFERENCE'&&<span className={errorAlarm?'current-analysis-alarm':'current-analysis-normal'}>{errorState}</span>}<span title={scopeNote}>{verified===linked.length&&linked.length?'依据已核验':'依据待核验'} · {verified}项</span></>;};
  return <details className={'current-findings'+(abnormal?' is-diagnostic':' is-analysis')} data-holding={holding||undefined} data-snapshot-id={identity.snapshot_id+':'+identity.observation_id}>
    <summary className="current-findings-heading"><strong>{heading}</strong><span className="current-findings-count">{findings.length}项</span><span className="current-findings-preview">{findings.map(finding=><span className="current-finding-chip" key={finding.finding_id}>{description(finding,true)}</span>)}</span><span className={'current-findings-sync'+(holding?' is-active':'')} role="status" aria-label={holding?'下一工况分析更新中':'当前分析已同步'} title={holding?'下一工况分析更新中':'当前分析已同步'}><i/></span><span className="current-findings-expand">展开</span><span className="current-findings-collapse">收起</span></summary>
    <div className="current-findings-list">{findings.map(finding=><article className="current-finding" key={finding.finding_id}>
      <h3>{userVisibleText(title(finding))}</h3><p className="current-finding-meta">{description(finding,true)}</p>
      {onDiagnoseFinding&&<div className="current-finding-locations"><button type="button" disabled={diagnosisBusy||finding.status!=='VALID'} onClick={()=>onDiagnoseFinding(finding.finding_id)}>{diagnosingFindingId===finding.finding_id?'解读中…':finding.status!=='VALID'?'当前上下文不可用':abnormal?'DK AI诊断':'DK AI解读'}</button></div>}
      <details className="current-finding-evidence"><summary>查看依据</summary><EvidenceReferences message={{...identity,prediction_mode:identity.prediction_mode,evidence_status:'VALID',findings:[finding],evidence:evidence.filter(item=>finding.evidence_ids.includes(item.evidence_id))}} binding={binding}/></details>
      <div className="current-finding-locations" aria-label="诊断关联位置">{finding.targets.map(target=>TARGET_METADATA[target]?.locatable_3d
        ? finding.status==='VALID'&&onLocateFindingTarget&&<button type="button" key={target} onClick={()=>onLocateFindingTarget({finding_id:finding.finding_id,finding_receipt:finding.receipt,snapshot_id:finding.snapshot_id,target})}>定位到 {target}</button>
        : <span key={target}>关联位置：{target} · 当前3D暂不支持该区域定位</span>)}</div>
    </article>)}</div>
  </details>;
}
