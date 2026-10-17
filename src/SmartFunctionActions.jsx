import { MODEL_INPUT_COUNT } from './modelInputs.js';

// Navigation labels only; all checks and work remain in the existing features.
export default function SmartFunctionActions({inputSummary,historicalSummary,diagnosisStatus,diagnosisCount,associatedStand,trialStatus,modelCandidateStatus,modelCandidateSearching=false,onScreening,onDiagnosis,onLocation,onTrial,onAB,diagnosisBusy=false}) {
  const inputStatus = !inputSummary ? '等待输入检查'
    : `${inputSummary.completeCount}/${MODEL_INPUT_COUNT}完整 · ${inputSummary.missing.length ? `${inputSummary.missing.length}项待补充${inputSummary.invalid.length ? ` · ${inputSummary.invalid.length}项待修正` : ''}`
      : inputSummary.invalid.length ? `${inputSummary.invalid.length}项待修正`
      : historicalSummary.reviewCount ? `${historicalSummary.reviewCount}项建议核验`
      : historicalSummary.insufficientCount+historicalSummary.degenerateCount+historicalSummary.notCheckedCount ? '分布检查未完成' : '分布正常'}`;
  const diagnosisText = diagnosisStatus === 'VALID' ? diagnosisCount ? `当前 ${diagnosisCount} 项 · 可解读` : '当前暂无诊断'
    : ({PENDING:'正在核验当前诊断',UNAVAILABLE:'诊断依据暂不可用',DEMO:'演示模式 · 暂无正式诊断',WAITING:'等待当前诊断'})[diagnosisStatus] || '当前暂无诊断';
  const trialText = trialStatus || '等待试算指令';
  const entries = [
    {id:'screening',title:'工况数据筛查',status:inputStatus,onClick:onScreening},
    {id:'diagnosis',title:'DK AI辅助诊断',status:diagnosisText,onClick:onDiagnosis,disabled:diagnosisBusy&&diagnosisCount===1},
    {id:'location',title:'3D设备定位',status:associatedStand ? `定位 ${associatedStand} 机架` : '整线设备可查看',onClick:onLocation},
    {id:'trial',title:'DK AI参数试算',status:trialText,onClick:onTrial},
    {id:'ab',title:'优化候选方案',status:modelCandidateStatus || '自动搜索 · 待生成',onClick:onAB},
  ];
  return <details className="smart-function-actions" aria-label="快捷操作">
    <summary><strong>快捷操作 · 5项</strong><span className="smart-function-toggle-open">展开</span><span className="smart-function-toggle-close">收起</span></summary>
    <div className="smart-function-grid">{entries.map((entry,index)=><button type="button" key={entry.id} data-quick-action={entry.id} className="smart-function-card" disabled={entry.disabled||!entry.onClick} onClick={entry.onClick} title={`${entry.title} · ${entry.status}`} aria-label={`${entry.title} · ${entry.status}`}>
      <span className="smart-function-number" aria-hidden="true">{index+1}</span><span className="smart-function-text"><strong>{entry.title}</strong><span role="status">{entry.status}</span></span>
    </button>)}</div>
  </details>;
}
