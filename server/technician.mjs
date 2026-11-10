import { randomUUID } from 'node:crypto';
import { StateError, now } from './local-state.mjs';
import { retrieveKnowledge, knowledgeTokens } from './knowledge.mjs';

// 值守技术员：岗位化 agent。人格、职责、权限、记忆、检索、交接都在这一层，
// 不把"技术员"退化成无职责的聊天入口。
export const TECHNICIAN_VERSION = '1.0.0';
const MEMORY_FILE = 'technician-memory.json';
const MAX_TURNS = 400;
const MAX_FACTS = 200;
const MAX_ISSUES = 200;
const MAX_SESSIONS = 100;
const MAX_HANDOVERS = 40;

export const TECHNICIAN_PERSONA = `你是 QCDKR 冷连轧工作台的值守技术员，岗位是当班工程师，不是聊天客服。
你的目标是让当班人员更快定位、更稳处置、事事可追溯。

工作原则（按优先级）：
1. 先查后答：先看当前工况、事件、日志和资料，再给结论；没有依据就明确说"库中没有/当前记录不足以判断"。
2. 事实、推断、建议必须分开写：事实来自当前工况或资料，推断标注"推断"，建议标注"建议"。
3. 数字必须有来源：只使用当前工况、事件、资料里出现过的数值；不编造参数、阈值、标准号、文献结论。
4. 关联不等于因果：只凭同一条记录里的数值关系，不得认定根因；根因只能给候选和验证步骤。
5. 权限分级：L0 只读直接做；L1 低危可建议执行；L2 必须人工确认；L3 高危只提示"需人工执行"，绝不代操作。
6. 每次回答必须给"下一步"：先查什么、验证什么、找谁确认。
7. 工程口吻，先结论后依据，中文，短句，带单位；不确定就说不确定。`;

export const DUTIES = Object.freeze([
  { id: 'watch', label: '监视与解释', goal: '解释告警、趋势和异常意味着什么，先看哪里',
    triggers: ['报警', '告警', '趋势', '异常', '变化', '是否正常', '状态'],
    tools: ['events.get_event', 'data.get_segment', 'service.inspect', 'knowledge.search'],
    deliverables: ['告警解释卡'], risk: 'L0' },
  { id: 'diagnose', label: '诊断与根因', goal: '关联日志、指标、历史记录，给根因候选与验证步骤',
    triggers: ['诊断', '根因', '原因', '故障', '偏差', '超差', '为什么'],
    tools: ['events.get_event', 'data.validate', 'data.get_segment', 'analysis.compare_segments', 'history.find_similar', 'knowledge.search'],
    deliverables: ['诊断单'], risk: 'L0' },
  { id: 'predict', label: '预测与建议', goal: '解释预测值、置信区间与偏差来源，给参数建议及依据',
    triggers: ['预测', '试算', '参数', '调整', '优化', '敏感', '建议值'],
    tools: ['prediction.predict_s5', 'trials.create_preview', 'analysis.sensitivity', 'knowledge.search'],
    deliverables: ['预测解释', '参数建议'], risk: 'L1' },
  { id: 'act', label: '处置与执行', goal: '按 SOP 分步执行可回滚动作，给执行回执',
    triggers: ['切换', '打开', '定位', '执行', '处理', '下发', '重启', '重连', '导出', '生成报告'],
    tools: ['ui.focus', 'ui.switch_page', 'ui.open_replay', 'ui.open_comparison', 'report.export', 'device.reconnect', 'acquisition.restart', 'device.command'],
    deliverables: ['执行回执'], risk: 'L1' },
  { id: 'record', label: '记录与交接', goal: '汇总本班异常、处置与未决项，形成交接班摘要',
    triggers: ['交接', '班次', '值班', '总结', '记录', '工单', '归档'],
    tools: ['memory.write', 'handover.generate'],
    deliverables: ['交接班摘要', '工单归档'], risk: 'L0' },
  { id: 'knowledge', label: '知识与传承', goal: '从手册、SOP、工单库检索，回答带出处',
    triggers: ['原理', '手册', '标准', '规范', '是什么', '怎么算', '公式', '资料', '文献', '制度', '依据'],
    tools: ['knowledge.search'],
    deliverables: ['带引用的技术答复'], risk: 'L0' },
]);

export const MODES = Object.freeze([
  { id: 'watch', label: '值守模式', description: '事件驱动，主动出告警解释卡；只提示不执行', trigger: 'event' },
  { id: 'qa', label: '问答模式', description: '技术问题带出处回答；查不到就说查不到', trigger: 'user' },
  { id: 'task', label: '作业模式', description: '诊断→方案→逐步执行→验证→报告；每步可中断', trigger: 'user' },
  { id: 'handover', label: '交接模式', description: '班次摘要、未决项、建议关注点', trigger: 'schedule' },
]);

export const PERMISSION_LEVELS = Object.freeze({
  L0: { label: '只读', description: '查指标、日志、手册、历史工单', approval: 'none' },
  L1: { label: '低危', description: '切页、聚焦、跑预测、生成报告', approval: 'none' },
  L2: { label: '中危', description: '改建议参数、重连设备、重启采集', approval: 'single' },
  L3: { label: '高危', description: '下发设备指令、停线、改模型配置', approval: 'blocked' },
});

export const TOOL_RISK = Object.freeze({
  'knowledge.search': 'L0', 'events.get_event': 'L0', 'events.search': 'L0', 'data.validate': 'L0',
  'data.get_segment': 'L0', 'history.find_similar': 'L0', 'analysis.compare_segments': 'L0',
  'service.inspect': 'L0', 'rules.get': 'L0', 'memory.write': 'L0', 'handover.generate': 'L0',
  'prediction.predict_s5': 'L1', 'ui.focus': 'L1', 'ui.switch_page': 'L1', 'ui.open_replay': 'L1',
  'ui.open_comparison': 'L1', 'report.export': 'L1', 'analysis.sensitivity': 'L1',
  'trials.create_preview': 'L2', 'rules.preview_change': 'L2', 'device.reconnect': 'L2', 'acquisition.restart': 'L2',
  'device.command': 'L3', 'line.stop': 'L3', 'model.config': 'L3',
});

export const BOUNDARIES = Object.freeze([
  '不编造参数、标准、阈值；没有出处必须回答"库中没有"。',
  '不替代操作员/工程师签字，不承担安全责任。',
  '不修改模型、历史数据、审计日志。',
  '不绕过安全联锁和权限校验。',
  '证据不足时只给候选根因和验证步骤，不给确定结论。',
  '不把上一次会话的猜测当事实带入新会话。',
]);

const DUTY_BY_ID = new Map(DUTIES.map(duty => [duty.id, duty]));
const RISK_ORDER = { L0: 0, L1: 1, L2: 2, L3: 3 };
const EMPTY = () => ({ version: 1, facts: [], issues: [], sessions: [], handovers: [], stats: { turns: 0, grounded: 0, refusals: 0, confirmations: 0, l3_blocked: 0, numeric_review: 0 } });
const clampText = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const cleanExcerpt = (value, max = 900) => String(value ?? '')
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/^#{1,6}\s*/gm, '')
  .replace(/^\s*[-*+]\s+/gm, '')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{2,}/g, '\n')
  .trim().slice(0, max);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const norm = value => String(value ?? '').replace(/\s+/g, '').toLowerCase();

function classifyDuty(message, context = {}) {
  const text = String(message || '');
  const scores = DUTIES.map(duty => ({ duty, score: duty.triggers.filter(trigger => text.includes(trigger)).length }));
  scores.sort((a, b) => b.score - a.score || DUTIES.indexOf(a.duty) - DUTIES.indexOf(b.duty));
  if (scores[0].score > 0) return scores[0].duty.id;
  if (context?.selectedEvent) return 'watch';
  if (/\d/.test(text) && /参数|张力|速度|弯辊/.test(text)) return 'predict';
  return 'knowledge';
}

function modeForDuty(duty) {
  return duty === 'record' ? 'handover' : duty === 'watch' ? 'watch' : duty === 'act' || duty === 'predict' ? 'task' : 'qa';
}

function contextFacts(context = {}) {
  const input = context.caseData || context.input || {};
  const stands = Array.isArray(input.stands) ? input.stands : [];
  const s5 = stands.find(stand => stand?.id === 'S5') || {};
  const rows = [];
  const push = (label, key, value, unit) => { if (finite(value)) rows.push({ label, key, value: Number(value.toFixed(4)), unit }); };
  push('S5 后张力', 'S5.tension', s5.tension, 'kN');
  push('S5 前张力', 'S5.frontTension', s5.frontTension, 'kN');
  push('S5 轧制速度', 'S5.speed', s5.speed, 'm/min');
  push('S5 弯辊力', 'S5.bendingForce', s5.bendingForce, 'kN');
  push('带钢宽度', 'width', input.width, 'mm');
  push('入口设定厚度', 'entrySetThickness', input.entrySetThickness, 'mm');
  for (const stand of stands.slice(0, 4)) push(`${stand.id} 轧制力`, `${stand.id}.force`, stand.force, 'kN');
  const prediction = context.prediction;
  if (prediction && finite(prediction.predicted_value ?? prediction.prediction)) rows.push({ label: '当前预测值', key: 'prediction', value: Number((prediction.predicted_value ?? prediction.prediction).toFixed(4)), unit: prediction.unit || 'kN' });
  const source = typeof context.dataSource === 'string' ? context.dataSource : null;
  const sampleTime = typeof context.sampleTime === 'string' ? context.sampleTime : null;
  return { rows, source, sampleTime, hasInput: Object.keys(input).length > 0 };
}

function factLine(fact) { return `${fact.label}：${fact.value}${fact.unit ? ' ' + fact.unit : ''}`; }

function relevantFacts(memory, message, limit = 6) {
  const text = norm(message);
  const tokens = [...new Set((text.match(/[\p{Script=Han}]{2}/gu) || []))];
  const scored = memory.facts.map(fact => ({ fact, score: tokens.reduce((sum, token) => sum + (norm(fact.text).includes(token) ? 1 : 0), 0) }))
    .sort((a, b) => b.score - a.score || String(b.fact.updatedAt).localeCompare(String(a.fact.updatedAt)));
  const confirmed = scored.filter(item => item.fact.status === 'CONFIRMED');
  const pool = scored.filter(item => item.score > 0);
  return [...new Map([...confirmed.slice(0, 3), ...pool, ...scored.slice(0, 2)].map(item => [item.fact.id, item.fact])).values()].slice(0, limit);
}

async function docsOf(knowledge) {
  try { return await knowledge(); }
  catch { return []; }
}

function referencesOf(refs) {
  return refs.map(ref => ({ id: ref.id, title: ref.title, fileName: ref.fileName, locator: ref.locator, quote: clampText(ref.text, 1200) }));
}

function evidenceFor(ids, refs) {
  const byId = new Map(refs.map(ref => [ref.id, ref]));
  return [...new Set(ids)].map(id => byId.get(id)).filter(Boolean).map(ref => ({ id: ref.id, title: ref.title, fileName: ref.fileName, locator: ref.locator, quote: cleanExcerpt(ref.text, 900) }));
}

function numbersIn(text) { return String(text || '').match(/[-+]?\d+(?:\.\d+)?/g) || []; }

// 轻量向量检索：对资料切片建 TF-IDF 稀疏向量，查询走余弦相似度。
// 之后换稠密 embedding 时只需替换 buildVectorIndex/scoreVector 两个函数。
function buildVectorIndex(docs) {
  const chunks = docs.flatMap(doc => (doc.chunks || []).map(chunk => ({ doc, chunk, text: `${doc.title} ${chunk.heading || ''} ${chunk.text}` })));
  const df = new Map(), rows = [];
  for (const item of chunks) {
    const tokens = knowledgeTokens(item.text).slice(0, 180), tf = new Map();
    for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);
    for (const token of tf.keys()) df.set(token, (df.get(token) || 0) + 1);
    rows.push({ item, tf, length: tokens.length || 1 });
  }
  const total = chunks.length || 1;
  const vectors = rows.map(({ item, tf, length }) => {
    const vector = new Map();
    for (const [token, count] of tf) vector.set(token, (count / length) * (Math.log((total + 1) / (1 + (df.get(token) || 0))) + 1));
    return { item, vector };
  });
  return { vectors, df, total };
}

function queryVector(query, index) {
  const tokens = knowledgeTokens(query).slice(0, 180), tf = new Map();
  for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);
  const length = tokens.length || 1, vector = new Map();
  for (const [token, count] of tf) vector.set(token, (count / length) * (Math.log((index.total + 1) / (1 + (index.df.get(token) || 0))) + 1));
  return vector;
}

function scoreVector(query, vector) {
  let dot = 0, queryNorm = 0, vectorNorm = 0;
  for (const [token, weight] of query) { queryNorm += weight * weight; const other = vector.get(token); if (other) dot += weight * other; }
  for (const weight of vector.values()) vectorNorm += weight * weight;
  return dot / (Math.sqrt(queryNorm) * Math.sqrt(vectorNorm) || 1);
}

function numericReview(summary, allowedText) {
  const allowed = new Set(numbersIn(allowedText));
  const suspicious = [...new Set(numbersIn(summary))].filter(value => {
    if (allowed.has(value)) return false;
    const number = Number(value);
    return Number.isFinite(number) && Math.abs(number) >= 10;
  });
  return suspicious.slice(0, 12);
}

function actionsFor(duty, message) {
  const text = String(message || '');
  if (duty === 'act') {
    const actions = [];
    if (/日志/.test(text)) actions.push({ tool: 'ui.switch_page', label: '打开运行日志页', params: { page: 'logs' }, risk_level: 'L1' });
    else if (/维护|系统状态/.test(text)) actions.push({ tool: 'ui.switch_page', label: '打开系统状态与维护页', params: { page: 'maintenance' }, risk_level: 'L1' });
    else if (/连接|设备/.test(text)) actions.push({ tool: 'ui.switch_page', label: '打开工业设备连接页', params: { page: 'communication' }, risk_level: 'L1' });
    else actions.push({ tool: 'ui.focus', label: '在三维场景中定位当前机架', params: { stand: 'S5' }, risk_level: 'L1' });
    if (/报告|导出/.test(text)) actions.push({ tool: 'report.export', label: '生成当前工况报告', params: {}, risk_level: 'L1' });
    if (/重连/.test(text)) actions.push({ tool: 'device.reconnect', label: '重连设备（需确认）', params: {}, risk_level: 'L2' });
    if (/重启采集/.test(text)) actions.push({ tool: 'acquisition.restart', label: '重启采集（需确认）', params: {}, risk_level: 'L2' });
    if (/下发|停线/.test(text)) actions.push({ tool: 'device.command', label: '下发设备指令（高危，需人工执行）', params: {}, risk_level: 'L3' });
    return actions;
  }
  if (duty === 'predict') return [{ tool: 'prediction.predict_s5', label: '用当前工况跑 S5 预测', params: {}, risk_level: 'L1' }];
  if (duty === 'diagnose') return [{ tool: 'events.get_event', label: '查看当前事件详情', params: {}, risk_level: 'L0' }];
  if (duty === 'record') return [{ tool: 'handover.generate', label: '生成本班交接摘要', params: {}, risk_level: 'L0' }];
  return [];
}

function normalizeActions(actions = []) {
  const executable = [], blocked = [];
  for (const action of actions.slice(0, 8)) {
    const risk = TOOL_RISK[action.tool] || 'L2';
    const item = { tool: action.tool, label: clampText(action.label || action.tool, 120), params: action.params && typeof action.params === 'object' ? action.params : {}, risk_level: risk,
      needs_confirm: RISK_ORDER[risk] >= 2, executable: RISK_ORDER[risk] < 3 };
    (item.executable ? executable : blocked).push(item);
  }
  return { actions: executable, blocked_actions: blocked };
}

function contract({ type, duty, mode, summary, evidence = [], confidence = 'MEDIUM', actions = [], blocked = [], nextSteps = [], note = null, numeric = null, memoryUsed = [] }) {
  return { ok: true, type, duty, mode, summary: clampText(summary), evidence, confidence,
    actions, blocked_actions: blocked, next_steps: nextSteps.filter(Boolean).slice(0, 6),
    boundary: BOUNDARIES, ...(note ? { note } : {}), ...(numeric ? { numeric_check: numeric } : {}),
    memory_used: memoryUsed, generated_at: now(), technician_version: TECHNICIAN_VERSION };
}

function parseJson(text) {
  const value = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(value); } catch {}
  const start = value.indexOf('{'), end = value.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(value.slice(start, end + 1)); } catch {} }
  return null;
}

export function createTechnician({ state, llm, knowledge, maintenance, cases, modelStatus = async () => ({}), agentRuns = () => [], timeoutMs = 120000 }) {
  async function load() {
    const value = await state.read(MEMORY_FILE, EMPTY());
    if (!value || typeof value !== 'object') return EMPTY();
    return { ...EMPTY(), ...value, facts: Array.isArray(value.facts) ? value.facts : [], issues: Array.isArray(value.issues) ? value.issues : [],
      sessions: Array.isArray(value.sessions) ? value.sessions : [], handovers: Array.isArray(value.handovers) ? value.handovers : [],
      stats: { ...EMPTY().stats, ...(value.stats || {}) } };
  }
  async function save(value) {
    await state.mutate(async () => {
      value.facts = value.facts.slice(0, MAX_FACTS);
      value.issues = value.issues.slice(0, MAX_ISSUES);
      value.sessions = value.sessions.slice(0, MAX_SESSIONS);
      value.handovers = value.handovers.slice(0, MAX_HANDOVERS);
      await state.write(MEMORY_FILE, value);
    });
    return value;
  }

  async function remember({ text, status = 'PENDING', source = 'USER', scope = null } = {}) {
    const content = clampText(text, 1000);
    if (!content) throw new StateError('记忆内容不能为空。', 400, 'MEMORY_EMPTY');
    if (!['CONFIRMED', 'PENDING'].includes(status)) throw new StateError('记忆状态无效。', 400, 'MEMORY_STATUS');
    const memory = await load(), at = now();
    const existing = memory.facts.find(fact => norm(fact.text) === norm(content));
    if (existing) Object.assign(existing, { status, source, scope, updatedAt: at });
    else memory.facts.unshift({ id: `F-${randomUUID().slice(0, 8)}`, text: content, status, source, scope, createdAt: at, updatedAt: at });
    await save(memory);
    return existing || memory.facts[0];
  }

  async function openIssue({ title, severity = 'MEDIUM', evidence = [] } = {}) {
    const content = clampText(title, 500);
    if (!content) throw new StateError('未决项标题不能为空。', 400, 'ISSUE_EMPTY');
    const memory = await load(), at = now();
    const existing = memory.issues.find(issue => issue.status === 'OPEN' && norm(issue.title) === norm(content));
    if (existing) return existing;
    const issue = { id: `I-${randomUUID().slice(0, 8)}`, title: content, severity: ['LOW', 'MEDIUM', 'HIGH'].includes(severity) ? severity : 'MEDIUM',
      status: 'OPEN', evidence: evidence.slice(0, 6), createdAt: at, updatedAt: at };
    memory.issues.unshift(issue); await save(memory); return issue;
  }

  async function resolveIssue({ id, resolution = '' } = {}) {
    const memory = await load(), issue = memory.issues.find(item => item.id === id);
    if (!issue) throw new StateError('未决项不存在。', 404, 'ISSUE_NOT_FOUND');
    Object.assign(issue, { status: 'CLOSED', resolution: clampText(resolution, 1000), closedAt: now(), updatedAt: now() });
    await save(memory); return issue;
  }

  async function recordTurn({ duty, mode, question, reply, evidenceCount, grounded, numericReview: review, sessionId = null }) {
    const memory = await load(), at = now();
    const stats = memory.stats;
    stats.turns += 1; if (grounded) stats.grounded += 1; if (!grounded && ['knowledge', 'diagnose'].includes(duty)) stats.refusals += 1;
    if (review?.length) stats.numeric_review += 1;
    if (reply.blocked_actions?.length) stats.l3_blocked += reply.blocked_actions.length;
    let session = sessionId ? memory.sessions.find(item => item.id === sessionId) : null;
    if (!session) { session = { id: `S-${randomUUID().slice(0, 8)}`, startedAt: at, endedAt: at, turns: 0, duties: [], summary: '' }; memory.sessions.unshift(session); }
    session.endedAt = at; session.turns += 1;
    if (!session.duties.includes(duty)) session.duties.push(duty);
    session.summary = clampText(`${session.summary}${session.summary ? '；' : ''}${clampText(question, 80)}`.slice(-1200), 1200);
    await save(memory);
    return session.id;
  }

  function kpis(memory) {
    const stats = memory.stats || {};
    const turns = Number(stats.turns) || 0;
    return { turns, grounded: Number(stats.grounded) || 0,
      grounding_rate: turns ? Number(((Number(stats.grounded) || 0) / turns).toFixed(4)) : 0,
      refusals: Number(stats.refusals) || 0, numeric_review: Number(stats.numeric_review) || 0,
      l3_blocked: Number(stats.l3_blocked) || 0, confirmations: Number(stats.confirmations) || 0,
      open_issues: memory.issues.filter(issue => issue.status === 'OPEN').length,
      facts: memory.facts.length, handovers: memory.handovers.length };
  }

  async function openEvents(limit = 5) {
    try { return (await maintenance.events({ state: 'open', limit })).items || []; }
    catch { return []; }
  }

  let indexCache = { key: '', index: null };
  function indexFor(docs) {
    const key = docs.map(doc => `${doc.id}:${doc.chunks?.length || 0}`).join('|');
    if (indexCache.key !== key) indexCache = { key, index: buildVectorIndex(docs) };
    return indexCache.index;
  }
  async function search(query, limit = 4) {
    const text = String(query || '').trim();
    if (!text) return [];
    const docs = await docsOf(knowledge);
    const lexical = retrieveKnowledge(docs, text, { limit });
    const index = indexFor(docs), qv = queryVector(text, index);
    const vectorHits = index.vectors.map(row => ({ row, score: scoreVector(qv, row.vector) }))
      .filter(hit => hit.score >= 0.08).sort((a, b) => b.score - a.score);
    const merged = [...lexical];
    for (const hit of vectorHits) {
      if (merged.length >= limit) break;
      const { doc, chunk } = hit.row.item;
      if (merged.some(ref => ref.chunkId === chunk.id)) continue;
      merged.push({ documentId: doc.id, chunkId: chunk.id, title: doc.title, fileName: doc.fileName,
        locator: chunk.locator || chunk.heading || '正文', text: cleanExcerpt(chunk.text, 900) });
    }
    return merged.slice(0, Math.max(1, limit)).map((ref, position) => ({ ...ref, id: `R${position + 1}` }));
  }

  function deterministic({ duty, facts, refs, events, question, context }) {
    const lines = [];
    const factLines = facts.rows.map(factLine);
    if (duty === 'knowledge') {
      if (!refs.length) return { type: 'answer', summary: '库中没有检索到与该问题直接匹配的资料。建议补充手册或工单后再问，或说明具体设备、工序和参数。', evidence: [], confidence: 'LOW', nextSteps: ['补充相关资料', '换用设备/工序关键词重试'] };
      const quotes = refs.slice(0, 3).map(ref => `“${cleanExcerpt(ref.text, 260)}” [${ref.id}]`);
      return { type: 'answer', summary: `资料记载：\n${quotes.join('\n')}`, evidence: evidenceFor(refs.map(ref => ref.id), refs), confidence: refs.length >= 2 ? 'HIGH' : 'MEDIUM', nextSteps: ['如与现场不符，以现场记录和设备手册为准'] };
    }
    if (duty === 'watch') {
      lines.push(factLines.length ? `当前工况：${factLines.join('；')}。` : '当前未取到完整工况数值。');
      lines.push(events.length ? `当前有 ${events.length} 条未闭环事件：${events.slice(0, 3).map(event => clampText(event.title || event.message || event.type, 60)).join('、')}。` : '当前没有未闭环事件。');
      lines.push('解释口径：以上是记录到的数值关系与事件状态，不等于设备故障或安全等级。');
      return { type: 'watch', summary: lines.join('\n'), evidence: [], confidence: factLines.length ? 'MEDIUM' : 'LOW', nextSteps: ['打开运行日志核对时间窗', '查看对应事件详情', '必要时对照设备手册'] };
    }
    if (duty === 'diagnose') {
      lines.push(factLines.length ? `当前工况：${factLines.join('；')}。` : '当前未取到完整工况数值。');
      if (events.length) lines.push(`相关未闭环事件：${events.slice(0, 3).map(event => clampText(event.title || event.message || event.type, 60)).join('、')}。`);
      if (refs.length) lines.push(`可供对照的资料：${refs.slice(0, 2).map(ref => `[${ref.id}] ${ref.title}`).join('；')}。`);
      lines.push('证据边界：仅凭当前记录中的数值关系不能认定根因；以下是候选方向，不是结论。');
      return { type: 'diagnosis', summary: lines.join('\n'), evidence: evidenceFor(refs.map(ref => ref.id), refs), confidence: 'LOW',
        nextSteps: ['核对事件时间窗与采样点', '对比同规格历史记录', '按候选方向逐项验证后再处置'] };
    }
    if (duty === 'predict') {
      lines.push(factLines.length ? `预测输入：${factLines.join('；')}。` : '当前未取到完整预测输入。');
      lines.push('建议：先在预测工作台用当前工况跑一次预测，再讨论参数调整；任何参数建议都需给出依据并做 A/B 对比。');
      return { type: 'answer', summary: lines.join('\n'), evidence: evidenceFor(refs.map(ref => ref.id), refs), confidence: 'LOW', nextSteps: ['跑当前工况预测', '确认目标值与容差', '做单参数试算并对比'] };
    }
    if (duty === 'act') {
      return { type: 'action', summary: `按你的指令整理了可执行动作。L2 需人工确认，L3 不代执行。${factLines.length ? `\n当前工况：${factLines.join('；')}。` : ''}`, evidence: [], confidence: 'MEDIUM', nextSteps: ['确认动作影响范围', 'L2 动作确认后再执行', '执行后回读状态'] };
    }
    return { type: 'answer', summary: lines.join('\n') || '请补充具体设备、工序或问题。', evidence: evidenceFor(refs.map(ref => ref.id), refs), confidence: 'LOW', nextSteps: ['补充问题细节'] };
  }

  function promptFor({ message, duty, mode, facts, refs, memoryFacts, issues, events, context }) {
    const evidenceBlock = refs.length ? refs.map(ref => `[${ref.id}] ${ref.title} · ${ref.locator}\n${cleanExcerpt(ref.text, 700)}`).join('\n\n') : '（无匹配资料）';
    const factsBlock = facts.rows.length ? facts.rows.map(factLine).join('\n') : '（无当前工况数值）';
    const eventsBlock = events.length ? events.slice(0, 5).map(event => `- ${event.severity || ''} ${clampText(event.title || event.message || event.type, 80)}`).join('\n') : '（无未闭环事件）';
    const memoryBlock = memoryFacts.length ? memoryFacts.map(fact => `- [${fact.status}] ${fact.text}`).join('\n') : '（无相关记忆）';
    const issuesBlock = issues.length ? issues.slice(0, 5).map(issue => `- ${issue.title}`).join('\n') : '（无未决项）';
    return `岗位职责：${DUTY_BY_ID.get(duty)?.label}；工作模式：${mode}。
用户问题：${message}

当前工况：
${factsBlock}

未闭环事件：
${eventsBlock}

相关记忆（PENDING 表示未确认，不得当事实）：
${memoryBlock}

未决项：
${issuesBlock}

可引用资料：
${evidenceBlock}

只输出 JSON，不要解释 JSON 以外的内容：
{"type":"answer|diagnosis|action|report|watch","summary":"给现场的答复，先结论后依据，事实/推断/建议分开写，必须带 [R#] 引用（如用到资料）","evidence_ids":["R1"],"confidence":"HIGH|MEDIUM|LOW","actions":[{"tool":"仅可从 ${DUTY_BY_ID.get(duty)?.tools.join(', ')} 中选","label":"动作名","params":{}}],"next_steps":["下一步"],"open_issue":{"title":"需要跟踪的未决项","severity":"LOW|MEDIUM|HIGH"} 或 null}`;
  }

  async function askLlm(args, signal) {
    try {
      const status = await llm.status();
      if (!status?.available) return null;
      const { message } = await llm.chat([{ role: 'system', content: TECHNICIAN_PERSONA }, { role: 'user', content: promptFor(args) }],
        { format: 'json', maxTokens: 800, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
      return parseJson(message?.content);
    } catch { return null; }
  }

  async function chat({ message, context = {}, mode = 'auto', sessionId = null, signal } = {}) {
    const question = clampText(message, 12000);
    if (!question) throw new StateError('问题不能为空。', 400, 'QUESTION_EMPTY');
    const duty = classifyDuty(question, context), resolvedMode = MODES.some(item => item.id === mode) ? mode : modeForDuty(duty);
    const [refs, events, memory] = await Promise.all([search(question, 4), ['watch', 'diagnose', 'record'].includes(duty) ? openEvents(5) : Promise.resolve([]), load()]);
    const facts = contextFacts(context);
    const memoryFacts = relevantFacts(memory, question);
    const issues = memory.issues.filter(issue => issue.status === 'OPEN').slice(0, 5);
    const draft = await askLlm({ message: question, duty, mode: resolvedMode, facts, refs, memoryFacts, issues, events, context }, signal);
    const fallback = deterministic({ duty, facts, refs, events, question, context });
    const source = draft || fallback;
    const evidenceIds = Array.isArray(source.evidence_ids) ? source.evidence_ids : [];
    const evidence = evidenceFor(evidenceIds.length ? evidenceIds : refs.slice(0, 2).map(ref => ref.id), refs);
    let summary = clampText(source.summary || fallback.summary, 6000);
    if (!summary) summary = fallback.summary;
    const allowedText = JSON.stringify({ facts, refs: refs.map(ref => ref.text), context: context?.caseData || context?.input || {} });
    const review = numericReview(summary, allowedText);
    let confidence = ['HIGH', 'MEDIUM', 'LOW'].includes(source.confidence) ? source.confidence : fallback.confidence;
    if (review.length) confidence = 'LOW';
    if (!evidence.length && ['knowledge', 'diagnose'].includes(duty)) confidence = 'LOW';
    const derived = normalizeActions(Array.isArray(source.actions) ? source.actions : actionsFor(duty, question));
    const note = review.length ? `回答中有 ${review.length} 个数值未在当前工况或资料中找到出处，已降级为待核对；请先核对再用于决策。` : null;
    const reply = contract({ type: source.type || fallback.type || 'answer', duty, mode: resolvedMode, summary, evidence, confidence,
      actions: derived.actions, blocked: derived.blocked_actions, nextSteps: source.next_steps || fallback.nextSteps, note, numeric: review.length ? { status: 'REVIEW', values: review } : { status: 'PASS' },
      memoryUsed: memoryFacts.map(fact => ({ id: fact.id, text: fact.text, status: fact.status })) });
    if (draft?.open_issue?.title) { try { await openIssue({ title: draft.open_issue.title, severity: draft.open_issue.severity }); } catch {} }
    try { reply.session_id = await recordTurn({ duty, mode: resolvedMode, question, reply, evidenceCount: evidence.length, grounded: evidence.length > 0, numericReview: review, sessionId }); } catch {}
    if (derived.actions.some(action => action.needs_confirm)) { try { const memory2 = await load(); memory2.stats.confirmations += 1; await save(memory2); } catch {} }
    return reply;
  }

  async function watch() {
    const [events, model, ai] = await Promise.all([openEvents(20), modelStatus().catch(() => ({})), llm.status().catch(() => null)]);
    const cards = events.map(event => ({
      id: event.id, severity: event.severity || 'MEDIUM', title: clampText(event.title || event.message || event.type || '未命名事件', 200),
      created_at: event.createdAt || null,
      explanation: `该事件当前未闭环。先核对时间窗内的指标与日志，再判断是否需要处置；事件本身不等于设备故障或安全等级。`,
      checks: ['打开运行日志核对同一时间窗', '查看事件详情中的关联指标', '对比同规格历史记录'],
      confidence: 'MEDIUM', duty: 'watch',
    }));
    if (ai && ai.available === false) cards.push({ id: 'SVC-AI', severity: 'LOW', title: 'AI 生成能力未就绪', created_at: now(),
      explanation: '当前回答退回本地检索与规则解释；工况数值、事件与资料检索仍可用。', checks: ['检查本地模型服务', '重试或改用资料检索'], confidence: 'HIGH', duty: 'watch' });
    if (model && model.available === false) cards.push({ id: 'SVC-MODEL', severity: 'HIGH', title: '预测模型未就绪', created_at: now(),
      explanation: '正式预测不可用，技术员不会给出预测值或参数结论。', checks: ['检查模型运行环境', '查看系统状态与维护页'], confidence: 'HIGH', duty: 'watch' });
    const memory = await load();
    return { ok: true, generated_at: now(), mode: 'watch', cards, kpis: kpis(memory), open_events: events.length };
  }

  async function handover({ actor, note = '' } = {}) {
    const [events, model] = await Promise.all([openEvents(50), modelStatus().catch(() => ({}))]);
    const memory = await load();
    const issues = memory.issues.filter(issue => issue.status === 'OPEN');
    let runs = [];
    try { runs = agentRuns(actor) || []; } catch {}
    const recent = (Array.isArray(runs) ? runs : []).slice(0, 10);
    const bySeverity = events.reduce((map, event) => { const key = event.severity || 'UNKNOWN'; map[key] = (map[key] || 0) + 1; return map; }, {});
    const lines = [];
    lines.push(`【交接班摘要】${new Date().toLocaleString('zh-CN', { hour12: false })}`);
    lines.push(`一、本班异常：未闭环事件 ${events.length} 条${events.length ? `（${Object.entries(bySeverity).map(([key, value]) => `${key} ${value}`).join('，')}）` : ''}。`);
    if (events.length) lines.push(events.slice(0, 8).map(event => `- ${event.severity || ''} ${clampText(event.title || event.message || event.type, 100)}`).join('\n'));
    lines.push(`二、未决项：${issues.length} 条${issues.length ? '。' : '。'}`);
    if (issues.length) lines.push(issues.slice(0, 8).map(issue => `- [${issue.severity}] ${issue.title}`).join('\n'));
    lines.push(`三、本班记录：技术员交互 ${memory.stats.turns} 次；最近任务 ${recent.length} 条。`);
    if (recent.length) lines.push(recent.slice(0, 5).map(run => `- ${run.status || ''} ${clampText(run.reply || run.goal || run.runId, 100)}`).join('\n'));
    lines.push(`四、建议关注：${issues.length || events.length ? '优先处理未决项与未闭环事件，再恢复常规巡检。' : '当前无未决项，保持常规巡检。'}`);
    lines.push(`五、系统状态：预测模型 ${model?.available === false ? '未就绪' : '状态未知/就绪'}。`);
    if (note) lines.push(`六、交接备注：${clampText(note, 1000)}`);
    const text = lines.join('\n');
    const record = { id: `H-${randomUUID().slice(0, 8)}`, at: now(), text, open_events: events.length, open_issues: issues.length, note: clampText(note, 1000) };
    memory.handovers.unshift(record); await save(memory);
    return { ok: true, type: 'handover', ...record, sections: { events: events.slice(0, 8), issues: issues.slice(0, 8), runs: recent.slice(0, 5) }, kpis: kpis(memory) };
  }

  async function status() {
    const [memory, model, ai] = await Promise.all([load(), modelStatus().catch(() => ({})), llm.status().catch(() => null)]);
    const events = await openEvents(1).catch(() => []);
    return { ok: true, version: TECHNICIAN_VERSION, persona: TECHNICIAN_PERSONA, duties: DUTIES, modes: MODES,
      permissions: PERMISSION_LEVELS, boundaries: BOUNDARIES, kpis: kpis(memory), ai, model,
      memory: { facts: memory.facts.slice(0, 20), issues: memory.issues.slice(0, 20), sessions: memory.sessions.slice(0, 10), handovers: memory.handovers.slice(0, 10) },
      open_events: events.length };
  }

  return { status, chat, watch, handover, search, memory: load, remember, openIssue, resolveIssue, kpis, classifyDuty };
}
