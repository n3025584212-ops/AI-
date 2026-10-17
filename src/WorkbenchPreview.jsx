import { MODEL_FEATURES } from './modelInputs.js';
import { formatEngineering } from './engineeringUnits.js';
import { POLICY_BUTTON_LABELS } from './candidatePolicyState.js';
import { candidatePredictionMatches } from './candidatePrediction.js';
import { hasCurrentActionMetadata } from './candidatePresentation.js';
import './candidate-preview-ui.css';

export function previewCandidateFor(policy,result,dirty){
 const plan=policy?.selectedWinner;
 return !dirty&&plan&&hasCurrentActionMetadata(plan)&&plan.baseline_snapshot_id===result?.snapshot_id
  &&plan.search_identity?.baseline_input_hash===result.input_hash&&plan.model_hash===result.model_hash
  &&plan.model_version===result.model_version&&plan.candidate_prediction?.mode==='formal'
  &&plan.candidate_prediction.receipt&&candidatePredictionMatches(plan)?plan:null;
}
export function PreviewEmpty({stale,noQualified,onOptimize}){
 return <section className="preview-empty" aria-label="方案预览空状态"><h3>方案预览</h3><p>{noQualified?'当前模型输入覆盖范围内无可用调整方案。请检查目标值。':stale?'当前工况已变化，请重新生成优化方案。':'暂无可预览方案。'}</p><p>请先在⑤优化候选方案中生成并选择：最优 / 调参最少 / 折中</p><button type="button" onClick={onOptimize}>前往⑤优化候选方案</button></section>;
}
export function PreviewResult({plan,caseData,result,resultSample,observationMatches}){
 const anchored=plan.actual_anchored_mode;
 const force=value=>formatEngineering('force',value,3),signed=value=>(value>0?'+':'')+force(value);
 return <section className="dm-card dm-prediction preview-result" aria-label="S5 方案预览结果" data-base-snapshot-id={plan.baseline_snapshot_id} data-current-snapshot-id={result.snapshot_id}>
  <header><h3>S5 轧制力 · 方案预览</h3><span>QCDKR</span></header>
  <dl>{anchored?<><div><dt>当前实际值</dt><dd>{force(plan.actual_s5)}</dd></div><div><dt>模型预计变化</dt><dd>{signed(plan.model_response_delta)}</dd></div></>:<div><dt>当前模型预测</dt><dd>{force(plan.baseline_prediction)}</dd></div>}<div className="preview-main-value"><dt title={anchored?'基于当前实际值与模型预测变化量计算':undefined}>{anchored?'调整后估计值':'方案预测值'}</dt><dd>{force(plan.estimated_candidate_s5)}</dd></div><div><dt>目标值</dt><dd>{force(plan.target_s5)}</dd></div><div><dt>预计目标偏差</dt><dd>{signed(plan.estimated_target_gap)}</dd></div></dl>{!anchored&&<small>预调试算 · 当前无匹配实际值</small>}
 </section>;
}
export function PreviewPolicies({policy,onSelect,onReturn,disabled=false}){
 return <section className={'preview-policy-section'+(onReturn?' candidate-preview-navigation':'')} aria-label="候选方案">{onReturn?<button type="button" className="candidate-preview-return" onClick={onReturn}>← 返回当前工况</button>:<h3>候选方案</h3>}<div className="preview-policy-controls" aria-label="候选方案切换">{['TARGET_APPROACH','LOW_DISTURBANCE','BALANCED'].map(key=><button type="button" key={key} disabled={disabled} aria-pressed={policy===key} onClick={()=>onSelect(key)}>{POLICY_BUTTON_LABELS[key]}</button>)}</div></section>;
}
export function PreviewParameters({caseData,plan}){
 const changes=plan.changes.filter(change=>Number.isFinite(change.before)&&Number.isFinite(change.after)&&change.before!==change.after);
 return <section className="preview-change-summary" aria-label="方案改动摘要"><h3>方案改动摘要</h3>{changes.map(change=>{
  const f=MODEL_FEATURES.find(f=>f.key===change.feature_key);
  return <p key={change.feature_key} data-parameter-key={change.feature_key}>{f?.label||change.feature_key}：{formatEngineering(change.field,change.before,3)} → {formatEngineering(change.field,change.after,3)}（{change.relative_change_percent>0?'+':''}{change.relative_change_percent}%）</p>;
 })}</section>;
}
