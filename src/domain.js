import { formatEngineering, toDisplay } from './engineeringUnits.js';
/**
 * Transparent UI demonstration engine. This is NOT DK-QKAR inference.
 * This legacy deterministic engine remains separate from the deployed trained model.
 * Canonical inputs, model outputs and display share the original engineering units.
 */

export const MODEL_METADATA = Object.freeze({
  name: 'DK-QKAR-V5S2',
  mode: 'demo',
  target: 'S5 轧制力',
  unit: 't', display_unit: 't',
  inputDimensions: 25,
  quantumDimensions: 5,
  classicalWeight: 0.9,
  quantumWeight: 0.1,
  paperMetrics: { rmse: 19.205, mae: 10.784, r2: 0.9894, samples: 400, folds: 4 },
  notice: '透明工况演示；未加载训练权重，数值不代表 QCDKR 模型推理。',
});

const defaultStands = [
  { id: 'S1', entryThickness: 2.75, exitThickness: 1.82, force: 1120, tension: 12, frontTension: 17, bendingForce: 88, speed: 145, temperature: 25 },
  { id: 'S2', entryThickness: 1.82, exitThickness: 1.18, force: 1080, tension: 17, frontTension: 23, bendingForce: 82, speed: 220, temperature: 27 },
  { id: 'S3', entryThickness: 1.18, exitThickness: 0.76, force: 1010, tension: 23, frontTension: 30, bendingForce: 76, speed: 340, temperature: 30 },
  { id: 'S4', entryThickness: 0.76, exitThickness: 0.50, force: 940, tension: 30, frontTension: 36, bendingForce: 70, speed: 520, temperature: 32 },
  { id: 'S5', entryThickness: 0.50, exitThickness: 0.33, force: 870, tension: 36, bendingForce: 64, speed: 785, temperature: 35 },
];

export const DEFAULT_CASE = Object.freeze({
  id: 'EXP-026',
  steelGrade: 'DC01',
  width: 1000,
  entrySetThickness: 2.75,
  target: 860,
  stands: Object.freeze(defaultStands.map((stand) => Object.freeze(stand))),
});

const round = (value, digits = 2) => Number(value.toFixed(digits));
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** Hard validation checks usability; paper-range checks are reported separately. */
export function validateCase(caseData) {
  const errors = [];
  if (!caseData || typeof caseData !== 'object' || Array.isArray(caseData)) return ['工况必须是对象。'];
  const check = (value, label, minimum, maximum, field) => {
    if (!isNumber(value)) errors.push(`${label}必须是有限数值。`);
    else if (value < minimum || value > maximum) errors.push(`${label}须在 ${field ? formatEngineering(field,minimum,3) : minimum}–${field ? formatEngineering(field,maximum,3) : maximum} 范围内。`);
  };
  if (typeof caseData.id !== 'string' || !caseData.id.trim()) errors.push('请输入工况编号。');
  if (typeof caseData.steelGrade !== 'string' || !caseData.steelGrade.trim()) errors.push('请输入钢种。');
  check(caseData.width, '带钢宽度（mm）', 100, 3000);
  if (caseData.target != null && caseData.target !== '') check(caseData.target, '目标 S5 轧制力（t）', 1, 10000, 'force');
  if (caseData.entrySetThickness !== undefined) check(caseData.entrySetThickness, '入口设定厚度（mm）', 0.01, 20);
  if (!Array.isArray(caseData.stands) || caseData.stands.length !== 5) {
    errors.push('工况须包含按 S1 至 S5 排列的五个机架。');
    return errors;
  }
  caseData.stands.forEach((stand, index) => {
    const name = `S${index + 1}`;
    if (!stand || typeof stand !== 'object' || Array.isArray(stand)) {
      errors.push(`${name} 机架参数缺失。`);
      return;
    }
    if (stand.id !== name) errors.push(`第 ${index + 1} 个机架编号必须是 ${name}。`);
    check(stand.entryThickness, `${name} 入口厚度（mm）`, 0.01, 20);
    check(stand.exitThickness, `${name} 出口厚度（mm）`, 0.01, 20);
    if (index !== 4 || stand.force != null && stand.force !== '') check(stand.force, `${name} 轧制力（t）`, index === 4 ? 0 : 1, 10000, 'force');
    check(stand.tension, `${name} 后张力（t）`, 0, 200);
    check(stand.speed, `${name} 速度（m/min）`, 0, 3000);
    if (stand.bendingForce !== undefined) check(stand.bendingForce, `${name} 弯辊力（kN）`, 0, 1000);
    if (stand.frontTension !== undefined && !(index === 4 && (stand.frontTension === null || stand.frontTension === ''))) check(stand.frontTension, `${name} 前张力（t）`, 0, 200);
    if (stand.temperature !== undefined) check(stand.temperature, `${name} 展示温度（℃）`, -50, 1400);
    if (isNumber(stand.entryThickness) && isNumber(stand.exitThickness) && stand.exitThickness >= stand.entryThickness) {
      errors.push(`${name} 出口厚度须小于入口厚度。`);
    }
    const previous = caseData.stands[index - 1];
    if (previous && isNumber(previous.exitThickness) && isNumber(stand.entryThickness) && Math.abs(previous.exitThickness - stand.entryThickness) > 0.015) {
      errors.push(`${name} 入口厚度须与上机架出口厚度衔接（允许 0.015 mm 舍入差）。`);
    }
  });
  return errors;
}

// All coefficients below are hand-picked for interaction demos, not fitted data,
// literature-derived physical laws, or sensitivity estimates of the real model.
const COEFFICIENTS = Object.freeze({
  force: [0.06, 0.10, 0.24, 0, 0],
  speed: [0.006, 0.009, 0.012, 0.016, 0.020],
  tension: [-0.55, -0.75, -1.0, -1.5, -3.2],
  bendingForce: [0.08, 0.10, 0.12, 0.15, 0.20],
  frontTension: [-0.15, -0.20, -0.35, -0.55, 0],
});
const LABELS = { force: '轧制力', speed: '轧制速度', tension: '后张力', bendingForce: '弯辊力', frontTension: '前张力' };

function featureTerms(caseData) {
  const terms = [
    { name: '带钢宽度', stand: '全线', value: caseData.width, baseline: DEFAULT_CASE.width, coefficient: 0.18 },
    { name: '入口实际厚度', stand: 'S1', value: caseData.stands[0].entryThickness, baseline: 2.75, coefficient: 65 },
    { name: '入口设定厚度', stand: 'S1', value: caseData.entrySetThickness ?? caseData.stands[0].entryThickness, baseline: 2.75, coefficient: 25 },
  ];
  caseData.stands.forEach((stand, index) => {
    for (const [field, coefficients] of Object.entries(COEFFICIENTS)) {
      const coefficient = coefficients[index];
      if (!coefficient) continue;
      const baseline = DEFAULT_CASE.stands[index][field];
      terms.push({ name: `${stand.id} ${LABELS[field]}`, stand: stand.id, field, value: stand[field] ?? baseline, baseline, coefficient });
    }
  });
  return terms;
}

function paperRangeWarnings(caseData) {
  const warnings = [];
  const check = (value, lower, upper, name) => {
    const field=name.includes('轧制力')?'force':name.includes('厚度')?'entryThickness':name.includes('宽度')?'width':name.includes('速度')?'speed':name.includes('弯辊力')?'bendingForce':'tension';
    if (value < lower || value > upper) warnings.push(`${name}超出论文样本范围 ${formatEngineering(field,lower,3)}–${formatEngineering(field,upper,3)}`);
  };
  check(caseData.width, 794, 1250, '宽度');
  check(caseData.entrySetThickness ?? caseData.stands[0].entryThickness, 1.8, 3.5, '入口设定厚度');
  check(caseData.stands[0].entryThickness, 1.728, 3.478, '入口实际厚度');
  caseData.stands.forEach((stand, index) => {
    if (index < 3) check(stand.force, 595.6, 1215, `${stand.id} 轧制力`);
    check(stand.speed, 35.91, 1143, `${stand.id} 速度`);
    check(stand.tension, 3.030, 44.27, `${stand.id} 后张力`);
    if (stand.bendingForce !== undefined) check(stand.bendingForce, 29.43, 163.5, `${stand.id} 弯辊力`);
    if (index < 4 && stand.frontTension !== undefined) check(stand.frontTension, 3.041, 44.42, `${stand.id} 前张力`);
  });
  return warnings;
}

/** Return a deterministic what-if estimate with explicit provenance. */
export function predict(caseData) {
  const errors = validateCase(caseData);
  if (errors.length) throw new Error(errors.join('\n'));
  const terms = featureTerms(caseData);
  const rawValue = 874.2 + terms.reduce((total, term) => total + term.coefficient * (term.value - term.baseline), 0);
  const value = round(Math.max(1, rawValue));
  const warnings = paperRangeWarnings(caseData);
  const totalSensitivity = terms.reduce((total, term) => total + Math.abs(term.coefficient * term.value), 0);
  const drivers = terms.map((term) => ({
    name: term.name,
    stand: term.stand,
    value: round(Math.abs(term.coefficient * term.value) / totalSensitivity * 100),
    contribution: round(term.coefficient * (term.value - term.baseline)),
    direction: term.coefficient < 0 ? 'negative' : 'positive',
  })).sort((a, b) => b.value - a.value);
  const halfRange = value * (warnings.length ? 0.12 : 0.05);
  const leading = drivers[0];
  return {
    value,
    target: caseData.target,
    deviation: isNumber(caseData.target) && caseData.target > 0 ? round((value - caseData.target) / caseData.target * 100) : null,
    confidence: null,
    interval: [round(Math.max(0, value - halfRange)), round(value + halfRange)],
    intervalLabel: warnings.length ? '演示扰动 ±12%' : '演示扰动 ±5%',
    drivers,
    curve: caseData.stands.map((stand) => ({ stand: stand.id, actual: stand.force, predicted: stand.id === 'S5' ? value : null })),
    ood: warnings.length > 0,
    rangeWarnings: warnings,
    mode: 'demo',
    unit: 't', display_unit: 't',
    explanation: `当前 S5 演示估算为 ${formatEngineering('force',value,3)}，目标 ${formatEngineering('force',caseData.target,3)}，目标偏差 ${formatEngineering('force',isNumber(caseData.target)?value-caseData.target:null,3)}。${leading.name}的演示局部敏感度最高。此结果由固定演示公式计算。${warnings.join('；')}`,
  };
}

function boundedChange(caseData, standId, field, fraction, error, proportion) {
  const index = Number(standId.slice(1)) - 1;
  const before = caseData.stands[index][field];
  const coefficient = COEFFICIENTS[field]?.[index];
  if (!isNumber(before) || !coefficient) return null;
  const limits = { tension: [3.03, 44.27], speed: [35.91, 1143], bendingForce: [29.43, 163.5], frontTension: [3.041, 44.42] }[field];
  const minimum = Math.max(limits[0], before * (1 - fraction));
  const maximum = Math.min(limits[1], before * (1 + fraction));
  // Out-of-range inputs require review before generating adjustment advice.
  if (minimum > maximum || before < limits[0] || before > limits[1]) return null;
  const after = round(clamp(before + error * proportion / coefficient, minimum, maximum), 4);
  return Math.abs(after - before) < 0.00001 ? null : { stand: standId, field, before, after };
}

/** Generate constrained, replayable candidates and retain only verified gains. */
export function optimize(caseData) {
  const baseline = predict(caseData);
  const error = caseData.target - baseline.value;
  if (Math.abs(error) < 0.02 || baseline.ood) return [];
  const strategies = [
    {
      id: 'tension-focus', title: '末机架张力微调', risk: '低 · 演示',
      description: '调整 S5 后张力，单次变化不超过 12%。',
      controls: [['S5', 'tension', 0.12, 1]],
    },
    {
      id: 'stand-balance', title: '后段机架协同', risk: '中 · 演示',
      description: '同时调整 S4、S5 后张力，每项变化不超过 10%。',
      controls: [['S4', 'tension', 0.10, 0.25], ['S5', 'tension', 0.10, 0.75]],
    },
    {
      id: 'speed-tension', title: '速度与张力联动', risk: '中 · 演示',
      description: '同时调整 S5 后张力和速度，每项变化不超过 8%。',
      controls: [['S5', 'tension', 0.08, 0.88], ['S5', 'speed', 0.08, 0.12]],
    },
  ];
  return strategies.map((strategy) => {
    const changes = strategy.controls.map(([stand, field, fraction, proportion]) => boundedChange(caseData, stand, field, fraction, error, proportion)).filter(Boolean);
    const candidate = structuredClone(caseData);
    changes.forEach(({ stand, field, after }) => { candidate.stands.find((item) => item.id === stand)[field] = after; });
    const result = predict(candidate);
    const improvement = round((Math.abs(error) - Math.abs(caseData.target - result.value)) / Math.abs(error) * 100);
    return {
      id: strategy.id,
      title: strategy.title,
      description: strategy.description,
      changes,
      predictedValue: result.value,
      improvement,
      risk: strategy.risk,
      mode: 'demo',
    };
  }).filter((plan) => plan.changes.length && plan.improvement > 0);
}
