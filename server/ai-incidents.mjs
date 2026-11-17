import { createHash, randomUUID } from 'node:crypto';
import { StateError, now } from './local-state.mjs';
import { taskRecord } from './task-store.mjs';

const FILE = 'ai-incidents.json';
const EMPTY = { version: 1, incidents: [], heartbeat: null };
// 2026-11-17：标题必须让人看懂，英文错误码只放在摘要里的“技术参考”。
const CODE_LABELS = {
  INVALID_INPUT: '预测输入不完整',
  MODEL_MISSING: '预测模型文件缺失',
  MODEL_ERROR: '预测模型报错',
  MODEL_UNAVAILABLE: '预测模型未就绪',
  MODEL_NOT_READY: '预测模型未就绪',
  TIMEOUT: '请求超时',
  REQUEST_TIMEOUT: '请求超时',
  RATE_LIMIT: '请求过于频繁',
  QUOTA_EXCEEDED: '调用额度用尽',
  OUTPUT_VALIDATION_REJECTED: '模型输出未通过校验',
  RESULT_UNVERIFIED: '结果未通过核验',
  OPERATION_NOT_APPLIED: '参数修改没有生效',
  TASK_CONTEXT_STALE: '工况已经变化',
  TASK_NO_EXECUTABLE_ACTION: '任务没有可执行的动作',
  SERVER_RESTART: '服务重启过',
  SERVER_SHUTDOWN: '服务已停止',
  LOCAL_LLM_OFFLINE: 'AI 服务离线',
  LOCAL_LLM_MODEL_MISSING: 'AI 模型文件缺失',
  LOCAL_LLM_AUTH: 'AI 服务鉴权失败',
};
const CATEGORY_LABELS = { prediction: '预测', system: '系统', assistant: 'AI 助手', knowledge: '资料', task: '任务', communication: '通讯' };
const codeLabel = (code, category) => CODE_LABELS[code] || (CATEGORY_LABELS[category] ? CATEGORY_LABELS[category] + '异常' : '服务异常');
const severityOrder = { LOW: 1, MEDIUM: 2, HIGH: 3 };
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);

const taskAt = task => Date.parse(task.finishedAt || task.updatedAt || task.createdAt || '') || 0;
const isFinished = task => task.status === 'succeeded' || task.status === 'completed';

function sourceObservation({ model, llm, embedding, tasks, events, logs, actorId }) {
  const items = [];
  if (model?.available !== true) items.push({ key: 'model', category: 'MODEL', severity: 'HIGH', title: '数值预测模型未就绪', summary: '正式数值预测不可用；不能将演示计算当作正式预测。', sourceRefs: ['model/status'], actorId: 'shared', impact: ['正式预测', '候选复算'] });
  if (llm?.available !== true) items.push({ key: 'llm', category: 'AI_SERVICE', severity: 'MEDIUM', title: '云端模型生成能力未就绪', summary: '自然语言生成暂不可用；数值预测与资料检索可独立继续。', sourceRefs: ['assistant/status'], actorId: 'shared', impact: ['模型分析', '动态解释'] });
  if (embedding?.available !== true) items.push({ key: 'embedding', category: 'MEMORY', severity: 'MEDIUM', title: '语义经验检索未就绪', summary: '向量召回不可用时会明确降级为词法检索；不改变任务事实。', sourceRefs: ['copilot/status'], actorId: 'shared', impact: ['历史经验语义召回'] });
  const finished = (tasks || []).filter(isFinished);
  for (const task of tasks || []) {
    if (!['failed', 'needs_reconciliation', 'context_stale'].includes(task.status)) continue;
    const failedAt = taskAt(task);
    // 失败任务只在同一目标之后已经成功时才算翻篇；没有成功就一直保留告警，
    // 不按时间静默消失（用户口径 2026-11-16：没恢复就该一直报）。
    if (finished.some(done => done.goal && done.goal === task.goal && taskAt(done) > failedAt)) continue;
    items.push({ key: `task:${task.taskId}`, category: 'TASK', severity: task.status === 'needs_reconciliation' ? 'HIGH' : 'MEDIUM', title: `任务未完成：${text(task.goal || task.taskId, 120)}`, summary: task.terminalReason?.message || '任务未达到可验证完成状态。', sourceRefs: [`tasks/${task.taskId}`], actorId, impact: ['当前分析任务'] });
  }
  for (const event of events || []) {
    if (['closed', 'resolved', 'recovered'].includes(String(event.state || '').toLowerCase())) continue;
    items.push({ key: `business:${event.id}`, category: 'BUSINESS', severity: ['HIGH', 'CRITICAL', 'ERROR'].includes(String(event.severity || '').toUpperCase()) ? 'HIGH' : 'MEDIUM', title: text(event.title || event.message || event.type || '业务事件', 160), summary: text(event.message || event.title || '业务事件仍未闭环。', 800), sourceRefs: [`events/${event.id}`], actorId: 'shared', impact: ['当前业务事件'] });
  }
  const recentErrors = (logs || []).filter(row => ['error', 'critical'].includes(row.level) && Date.now() - Date.parse(row.createdAt) < 60 * 60 * 1000);
  const errorGroups = new Map();
  for (const row of recentErrors) {
    const key = `${row.category || 'system'}:${row.code || row.message || 'error'}`;
    if (!errorGroups.has(key)) errorGroups.set(key, []);
    errorGroups.get(key).push(row.id);
  }
  for (const [key, ids] of errorGroups) {
    // 2026-11-17 操作者口径：报警要直接说清是什么错，不能只写"存在 prediction 错误"。
    // 标题用真实错误码 + 原始消息，摘要补次数、首次时间和链路。
    const [category, code] = key.split(':');
    const group = recentErrors.filter(row => ids.includes(row.id));
    const sample = group[0] || {};
    const message = text(sample.message || sample.summary || '', 60).replace(/[。.]$/, '');
    const label = codeLabel(code, category);
    const title = !message || message === label ? label : label + '：' + message;
    const first = String(group.map(row => row.createdAt).filter(Boolean).sort()[0] || '').slice(0, 19).replace('T', ' ');
    items.push({
      key: `log:${key}`, category: 'SERVICE', severity: 'MEDIUM', title: text(title, 120),
      // 2026-11-17 操作者口径：不要英文错误码，摘要也只报中文。
      summary: `${CATEGORY_LABELS[category] || '服务'}同类错误 ${ids.length} 条${first ? '，最早 ' + first : ''}；逐条上下文在运行日志里。`,
      sourceRefs: ids.slice(0, 12), actorId: 'shared', impact: ['对应业务链'],
    });
  }

  return items;
}

export function createAiIncidentService({ state, modelStatus, llm, embedding, taskRuntime, maintenance, clock = Date.now }) {
  let timer = null, closed = false;
  const reconciling = new Map();
  const at = () => new Date(clock()).toISOString();
  const read = () => state.read(FILE, EMPTY);
  function owned(record, actor) {
    if (!record || !actor?.id || !['shared', actor.id].includes(record.actorId)) throw new StateError('事件不存在或不属于当前账号。', 404, 'INCIDENT_SCOPE');
    return record;
  }
  let logsCache = { at: 0, rows: [] };
  async function readLogs() {
    // 日志只用于“最近一小时错误”，5 分钟内复用；避免每 30 秒全量读 5MB JSON。
    if (clock() - logsCache.at < 5 * 60 * 1000) return logsCache.rows;
    const rows = await state.read('activity-log.json', []).catch(() => []);
    logsCache = { at: clock(), rows: Array.isArray(rows) ? rows : [] };
    return logsCache.rows;
  }
  async function observe(actor) {
    const [model, llmStatus, embeddingStatus, events, logs] = await Promise.all([
      modelStatus().catch(error => ({ available: false, error: error.code || 'MODEL_STATUS_FAILED' })),
      llm.status().catch(error => ({ available: false, error: error.code || 'LLM_STATUS_FAILED' })),
      embedding.status().catch(error => ({ available: false, error: error.code || 'EMBEDDING_STATUS_FAILED' })),
      maintenance.events({ limit: 100 }).then(result => result.items || []).catch(() => []),
      readLogs(),
    ]);
    const tasks = actor && actor.id !== 'system' ? taskRuntime.list(actor) : [];
    return sourceObservation({ model, llm: llmStatus, embedding: embeddingStatus, tasks, events, logs, actorId: actor?.id || 'shared' });
  }
  async function reconcile(actor = null) {
    if (closed) throw new StateError('事件服务已关闭。', 503, 'INCIDENT_CLOSED');
    const scopeKey = actor?.id || 'shared';
    if (reconciling.has(scopeKey)) return reconciling.get(scopeKey);
    const pending = (async () => {
      const observed = await observe(actor), atNow = at();
      return state.mutate(async () => {
        const data = await read(), currentKeys = new Set(observed.map(item => `${item.actorId || actor?.id || 'shared'}:${item.key}`));
        const recoveryScope = new Set(actor?.id === 'system' ? ['shared', 'system'] : [actor?.id || 'shared']);
        const changes = [];
        for (const item of observed) {
          const actorId = item.actorId || actor?.id || 'shared', key = `${actorId}:${item.key}`;
          let record = data.incidents.find(row => row.key === key && row.status !== 'RECOVERED');
          const next = { actorId, key, category: item.category, severity: item.severity, title: item.title, summary: item.summary, sourceRefs: taskRecord(item.sourceRefs || []), impact: item.impact || [], lastObservedAt: atNow };
          if (!record) {
            record = { id: `INC-${randomUUID()}`, ...next, firstObservedAt: atNow, lastChangedAt: atNow, status: 'ACTIVE', occurrences: 1, revision: 1, acknowledgedBy: null, acknowledgedAt: null, recoveredAt: null };
            data.incidents.unshift(record); changes.push({ type: 'CREATED', id: record.id });
          } else {
            const changed = ['category', 'severity', 'title', 'summary'].some(field => record[field] !== next[field]) || JSON.stringify(record.sourceRefs) !== JSON.stringify(next.sourceRefs);
            record.occurrences += 1;
            if (changed) { record.revision += 1; record.lastChangedAt = atNow; changes.push({ type: 'UPDATED', id: record.id }); }
            Object.assign(record, next);
          }
        }
        for (const record of data.incidents) {
          if (!recoveryScope.has(record.actorId) || record.status === 'RECOVERED' || currentKeys.has(record.key)) continue;
          // A real observation no longer reports the condition. No LLM is used to
          // declare recovery; the reconciled source state is the authority.
          record.status = 'RECOVERED'; record.recoveredAt = atNow; record.lastChangedAt = atNow; record.revision += 1;
          changes.push({ type: 'RECOVERED', id: record.id });
        }
        data.heartbeat = { at: atNow, actorId: actor?.id || 'shared', observedCount: observed.length, status: 'HEALTHY' };
        data.incidents = data.incidents.slice(0, 500);
        await state.write(FILE, data);
        return { ok: true, changes, heartbeat: data.heartbeat, incidents: data.incidents.filter(row => row.actorId === 'shared' || row.actorId === actor?.id) };
      });
    })().finally(() => { reconciling.delete(scopeKey); });
    reconciling.set(scopeKey, pending);
    return pending;
  }
  async function list(actor) {
    const data = await read();
    return data.incidents.filter(row => row.actorId === 'shared' || row.actorId === actor?.id);
  }
  async function acknowledge(actor, id) {
    return state.mutate(async () => {
      const data = await read(), record = owned(data.incidents.find(row => row.id === id), actor);
      if (record.status === 'RECOVERED') throw new StateError('事件已经恢复，无需再确认。', 409, 'INCIDENT_RECOVERED');
      record.acknowledgedBy = actor.id; record.acknowledgedAt = at(); record.revision += 1;
      await state.write(FILE, data); return record;
    });
  }
  async function handover(actor) {
    const incidents = await list(actor), active = incidents.filter(row => row.status === 'ACTIVE');
    const tasks = actor?.id && actor.id !== 'system' ? taskRuntime.list(actor) : [];
    const pending = tasks.filter(task => !['succeeded', 'completed', 'cancelled'].includes(task.status));
    return { generatedAt: at(), activeCount: active.length, active: active.map(item => ({ id: item.id, title: item.title, severity: item.severity, impact: item.impact, acknowledged: Boolean(item.acknowledgedAt) })), pendingTasks: pending.map(item => ({ id: item.taskId, goal: item.goal, status: item.status, reason: item.terminalReason || null })), note: active.length || pending.length ? '仍有未闭环事件或任务，交接后继续核查。' : '当前没有未闭环事件或任务。' };
  }
  return {
    reconcile, list, acknowledge, handover,
    start() {
      if (timer || closed) return;
      void reconcile({ id: 'system' }).catch(() => {});
      timer = setInterval(() => void reconcile({ id: 'system' }).catch(() => {}), 30000);
      timer.unref?.();
    },
    close() { closed = true; if (timer) clearInterval(timer); timer = null; },
  };
}
