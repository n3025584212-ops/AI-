import { evidenceForIdentity } from './evidence.js';
import { MODEL_DESCRIPTION, modelBrandDisplayText } from './productBrand.js';
import { summarizeModelInputs } from './modelInputs.js';
import { predict, validateCase } from './domain.js';
import { toDisplay, unitFor, formatEngineering, unitMetadata } from './engineeringUnits.js';
import { reportInputFingerprint, freezeReportPayload, assertPredictionBinding, assertObservationBinding, predictionIdentity, sameIdentity } from './predictionSnapshot.js';
export { reportInputFingerprint, freezeReportPayload } from './predictionSnapshot.js';

export const REPORT_FIELDS = [
  ['width', '带钢宽度', 'mm'], ['entryThickness', '入口厚度', 'mm'],
  ['exitThickness', '出口厚度', 'mm'], ['force', '轧制力', 't'],
  ['tension', '后张力', 't'], ['frontTension', '前张力', 't'],
  ['bendingForce', '弯辊力', 'kN'], ['speed', '轧制速度', 'm/min'], ['temperature', '温度', '°C'],
];
export const reportNumber = (value, digits = 2) => Number.isFinite(value) ? value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '未提供';
const rounded = value => Number.isFinite(value) ? Number(value.toFixed(4)) : null;
// Source timestamps identify samples, but do not change a plan's parameter values.
const caseParameters = ({ importProvenance, ...parameters }) => parameters;
const fingerprint = value => {
  let hash = 2166136261;
  for (const character of reportInputFingerprint(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
};

/** Shared, deterministic report facts. No model calls, fabricated findings or hidden edits. */
export function buildReport(payload) {
  payload = freezeReportPayload(payload);
  const { input, prediction, plans = [], meta = {}, aiMessages = [], appliedPlan } = payload;
  const bound = Boolean(prediction?.snapshot_id || payload.snapshot);
  if (bound) {
    assertPredictionBinding(prediction,input,{input_snapshot:payload.snapshot});
    if (payload.observation) assertObservationBinding(payload.observation,prediction.input_snapshot);
  }
  const identity = predictionIdentity(prediction,payload.observation || prediction?.observation);
  const audit=evidenceForIdentity(payload,prediction,payload.observation || prediction?.observation);
  const checked=summarizeModelInputs(input);
  const errors = prediction?.mode==='formal'?[...checked.missing,...checked.invalid].map(x=>x.label+' '+x.message):validateCase(input);
  if (errors.length) throw new Error(`报告工况无效：${errors.join('；')}`);
  if (!prediction || !Number.isFinite(prediction.value)) throw new Error('请先计算有效预测结果。');
  const value = prediction.value;
  const target = Number.isFinite(input.target)?input.target:null;
  const signedError = target===null?null:value-target;
  const absoluteError = signedError===null?null:Math.abs(signedError);
  const deviation = target===null||target===0?null:signedError/target*100;
  const createdAt = new Date(meta.createdAt || Date.now()).toISOString();
  const version = String(meta.revision || meta.version || `CASE-${fingerprint(input)}`);
  const formal = prediction.mode === 'formal';
  const sameParameters = (a, b) => Boolean(a && b) && reportInputFingerprint(caseParameters(a)) === reportInputFingerprint(caseParameters(b));
  const modelIdentity = formal ? { name: typeof prediction.model === 'string' ? prediction.model : 'DK-QKAR-V5S2', mode: 'formal', version: prediction.model_version || null, hash: prediction.model_hash || null }
    : prediction.model || { mode: 'demo', version: 'demo-linear-v1', hash: null };
  const coherent = formal ? Boolean(modelIdentity.hash) && sameParameters(prediction.inputContext, input) : Math.abs(predict(input).value - value) <= 0.011;
  const planReports = plans.map(plan => {
    const applied = appliedPlan?.plan?.id === plan.id;
    const baselineInput = applied && appliedPlan.before ? appliedPlan.before : input;
    const baselineValue = applied && Number.isFinite(appliedPlan.beforeResult?.value) ? appliedPlan.beforeResult.value : value;
    const baselineTarget = baselineInput.target;
    const baselineError = Math.abs(baselineValue - baselineTarget);
    const candidate = structuredClone(baselineInput);
    let compatible = true;
    const changes = (plan.changes || []).map(change => {
      const stand = candidate.stands.find(item => item.id === change.stand);
      if (!stand || !Number.isFinite(change.after) || !Number.isFinite(change.before) || Math.abs(stand[change.field] - change.before) > 0.00011) compatible = false;
      if (stand && Number.isFinite(change.after)) stand[change.field] = change.after;
      const spec = REPORT_FIELDS.find(item => item[0] === change.field);
      return { ...change, label: spec?.[1] || change.field, unit: unitFor(change.field), delta: Number.isFinite(change.after - change.before) ? rounded(change.after - change.before) : null };
    });
    const appliedStateMatches = !applied || reportInputFingerprint(caseParameters(candidate)) === reportInputFingerprint(caseParameters(input));
    const validCandidate = compatible && appliedStateMatches && changes.length > 0 && (formal?summarizeModelInputs(candidate).valid:validateCase(candidate).length===0);
    const sameModel = formal && plan.mode === 'formal' && Boolean(plan.model_hash) && plan.model_hash === modelIdentity.hash;
    const recorded = validCandidate && sameModel && sameParameters(plan.baselineInput, baselineInput) && Math.abs(plan.baselineValue - baselineValue) <= 0.011;
    const canReplay = !formal && validCandidate && Math.abs(predict(baselineInput).value - baselineValue) <= 0.011;
    const replayValue = formal ? recorded ? plan.predictedValue : null : canReplay ? predict(candidate).value : null;
    const replayError = Number.isFinite(replayValue) ? Math.abs(replayValue - baselineTarget) : null;
    const replayImprovement = Number.isFinite(replayError) && baselineError > 0 ? rounded((baselineError - replayError) / baselineError * 100) : null;
    const verified = formal ? recorded && coherent && (!applied || Math.abs(value - plan.predictedValue) < 0.011) : canReplay && Math.abs(replayValue - plan.predictedValue) < 0.011;
    const stale = !compatible || !appliedStateMatches || formal && !recorded;
    return { ...plan, changes, replayValue, replayError, replayImprovement, baselineValue, baselineTarget, baselineError, verified, recalculated: formal ? applied && verified : verified, calculationSource: formal ? 'server-model-record' : 'demo-replay', stale, status: stale ? '与当前工况或模型不一致' : verified ? formal ? applied ? '已应用 · 模型复算一致' : '服务端模型计算' : applied ? '已应用 · 复算一致' : '复算一致' : '未通过核验', applied };
  });
  const matchingAI = aiMessages.filter(message => bound && sameIdentity(message,identity) && !message.historical && message.contextFingerprint === reportInputFingerprint(input) && message.role === 'assistant' && typeof message.text === 'string' && message.text.trim());
  const onlineNotes = matchingAI.filter(message=>message.mode==='online').slice(-2).map(message => ({ text: message.text, runId:message.runId, ...identity, source: `在线模型答复${meta.model ? ` · ${meta.model}` : ''}；由应用传入会话记录，未经独立工程验证` }));
  const direction = signedError > 0.005 ? '高于' : signedError < -0.005 ? '低于' : '接近';
  const boundObservation = payload.observation || prediction.observation;
  const observation = meta.observationMatches === false || meta.source_type === 'DEMO' || meta.observedAvailable === false ? null
    : bound ? Number.isFinite(boundObservation?.value) ? boundObservation.value : null : !Number.isFinite(meta.observed) ? null : meta.observed;
  const summary = {
    value, target, observed: observation, observedAvailable: observation !== null, predictionError: observation !== null ? rounded(value - observation) : null, signedError: rounded(signedError), absoluteError: rounded(absoluteError), deviation: rounded(deviation),
    interval: formal ? [] : prediction.interval || [], intervalNature: formal ? '未校准预测区间' : prediction.intervalLabel || '预设演示扰动带',
    ood: Boolean(prediction.ood), coherent, status: formal ? 'QCDKR 正式模型预测' : '工况演示 · 未加载训练权重', resultLabel: formal ? 'S5 模型预测' : 'S5 演示估算', sensitivityLabel: formal ? '模型参数响应' : '演示敏感度',
    headline: `S5 ${formal ? '模型预测' : '演示估算'}${direction}目标 ${formatEngineering('force', absoluteError, 3)}`,
    conclusion: `本工况 S5 轧制力${formal ? '模型预测值' : '演示预测值'}为 ${formatEngineering('force', value, 3)}，目标 ${formatEngineering('target', target, 3)}，相对目标偏差 ${reportNumber(deviation)}%。${observation !== null ? `实际值 ${formatEngineering('observed', observation, 3)}，预测误差 ${formatEngineering('error', value - observation, 3)}。` : ''}${planReports.length ? `记录 ${planReports.length} 项候选方案，其中 ${planReports.filter(plan => plan.verified).length} 项${formal ? '与当前工况和模型记录一致' : '与当前输入复算一致'}。` : '本次尚未执行方案生成。'}`,
  };
  return {
    meta: { ...identity, identity_status:bound ? payload.identity_status || 'SERVICE_RESPONSE' : 'PENDING', id: input.id, steelGrade: input.steelGrade, width: input.width, createdAt, createdAtLabel: new Date(createdAt).toLocaleString('zh-CN', { hour12: false }), revision: version, mode: prediction.mode || 'demo', reportId: `${input.id}-${version}`, formatVersion: '2.2', numericStorage: 'model-raw', contextFingerprint: reportInputFingerprint(input), dataSource: meta.source_type || meta.sourceType || 'UNKNOWN', sample_timestamp: meta.sample_timestamp || null, observedSource: meta.observedSource || '', modelIdentity, unitMetadata: unitMetadata() },
    snapshot:bound ? prediction.input_snapshot : null, observation:bound ? boundObservation : null,
    evidence:audit.evidence,findings:audit.findings,evidence_status:audit.status,
    aiRecords:matchingAI, analysisParameters:payload.analysisParameters || {},
    summary,
    display: { unit: 't', value: toDisplay('force', value), target: toDisplay('target', target), observed: toDisplay('observed', observation), predictionError: toDisplay('error', summary.predictionError), targetDeviation: toDisplay('delta', signedError) },
    // Displayed observation is independent of the raw input retained for demo validation.
    stands: input.stands.map(stand => ({ ...stand, force: stand.id === 'S5' ? observation : stand.force, width: input.width })),
    input,
    parameterRows: REPORT_FIELDS.map(([field, label, unit]) => {
      const values = input.stands.map(stand => field === 'width' ? input.width : field === 'force' && stand.id === 'S5' ? observation : stand[field]);
      return { field, label, unit, values, displayValues: values.map(value => toDisplay(field, value)) };
    }),
    curve: input.stands.map(stand => ({ stand: stand.id, actual: stand.id === 'S5' ? observation : stand.force, predicted: stand.id === 'S5' ? value : null })),
    sensitivities: [...(prediction.drivers || [])].sort((a, b) => b.value - a.value).slice(0, 5),
    plans: planReports,
    rangeWarnings: prediction.rangeWarnings || [],
    onlineNotes,
    appliedPlan: appliedPlan || null,
    sections: payload.sections?.length ? [...payload.sections] : ['工况信息', '预测结果', '工艺解释', '三维模型', '优化方案'],
    method: {
      current: formal ? `本次由已加载的 QCDKR 训练模型计算。模型版本 ${modelBrandDisplayText(modelIdentity.version) || '未提供'}；SHA-256 ${modelIdentity.hash || '未提供'}。报告保留服务端计算结果，不在浏览器中重新拟合或使用演示公式复算。` : '当前演示采用源码公开的确定性线性扰动公式：基准 874.2 加各输入相对默认工况的偏移乘以手设系数。没有加载训练后的 QCDKR 权重。',
      inputs: MODEL_DESCRIPTION + '。论文输入共 25 维：入口设定/实际厚度、宽度，S1–S3 轧制力，S1–S5 弯辊力/速度/后张力，以及 S1–S4 前张力。温度及钢种不进入所附模型。',
      sensitivity: formal ? '模型参数响应：按训练范围的 5% 对每项输入分别双向扰动，使用同一模型计算响应，以最大响应归一为 100；各项数值不要求加和为 100%，不是因果效应。' : '敏感度为各变量在手设公式下 ±1% 扰动的绝对响应占比。图中只显示前五项，占比基于全部 25 项归一化；它不是 SHAP 值或因果效应。',
      uncertainty: formal ? '本模型尚未校准预测区间，本报告不附加演示扰动带或统计置信度。' : '扰动带为预设 ±5%；超出论文单变量范围时为 ±12%。没有统计置信度，不是置信区间、容差带或现场允许误差。',
      scope: formal ? '本报告记录当前模型预测与软件内参数调整。现场准确率应以独立实测标签评价，“应用到当前工况”仅更新软件内参数。' : '本报告记录工况演示计算和软件操作结果。未加载训练后的 QCDKR 权重。',
      range: formal ? '范围检查与模型保存的训练输入边界比较；它不能替代独立现场验证。' : '范围检查仅与论文表 1 的单变量最小/最大值比较。全部变量处于范围内不等于已经验证为训练分布内。',
      paper: '论文在 400 条 CRD 样本、8 个规格的 4 折评价中报告 RMSE 19.205 t、MAE 10.784 t、R² 0.9894。它们是已有论文结果，不是本工况准确率。完整未见规格条件下没有形成一致优势。',
    },
    asset: {
      version: 'V2 Readability 最终母版', chain: 'V3 Astra → V2 Revision → V2 Readability',
      source: 'DKQKAR_5Stand_V2_Readability/DKQKAR_5Stand_Master.blend',
      objects: 3519, triangles: 995336, primaryRolls: 30, materials: 33, images: 10,
      evidence: 'docs/model-source.md 与 docs/model-export-audit.json',
      description: '按最终主 Scene 的可见性导出，保留 30 根主辊和 S5 服务设备；920 个母版隐藏装饰未输出。无减面，导出前后母版哈希一致。已移除旧顶部桥架，保留更新后的 S5 目标铭牌。',
    },
    nextSteps: [
      '核实完整 25 维采集字段，记录工况来源与时间戳。轧制力和总张力使用原始 t（吨力），与模型尺度一致。',
      formal ? '使用独立现场样本评价预测误差，保留模型版本和工况来源。' : '接入经验证的训练工件并保留预处理器、特征索引和核参考数据，再用独立现场样本评价。',
      planReports.length ? '比较已复算候选，记录选择与参数变更；本报告不代表设备已经执行调整。' : '在当前输入完成复核后生成候选方案，再比较参数变更及目标误差。',
    ],
  };
}
