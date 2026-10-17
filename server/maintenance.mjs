const normalizeLogLevel = value => { const level = String(value || '').toLowerCase(); return level === 'warn' ? 'warning' : level; };
import { randomUUID, createHash } from 'node:crypto';
import { readdir, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { StateError, now, record } from './local-state.mjs';
import { modelInputValues } from '../src/modelInputs.js';
import { currentModelReferenceRanges } from '../src/inputRangeDefaults.js';
import { monitorData } from '../src/dataMonitoring.js';

const RULES = [
  { id: 'prediction-error', name: 'S5 预测与实测偏差', enabled: true, metric: 'predictionErrorPercent', threshold: 5, severity: 'warning', unit: '%', source: '软件默认阈值，可由管理员确认修改' },
  { id: 'input-completeness', name: '模型输入完整度', enabled: true, metric: 'completenessPercent', threshold: 100, severity: 'error', unit: '%', source: '冻结模型需要完整 25 维输入' },
  { id: 'input-drift', name: '输入窗口均值变化', enabled: true, metric: 'driftScore', threshold: 1, severity: 'warning', unit: '标准差', source: '软件统计提示，非设备安全限值' },
  { id: 'input-range', name: '输入超出参考范围', enabled: true, metric: 'outOfRangeCount', threshold: 1, severity: 'warning', unit: '项', source: '已确认PDF原始边界 / 冻结60条Demo逐侧兜底；范围仅作提示' },
  { id: 'prediction-service', name: '预测服务连续失败', enabled: true, metric: 'failureCount', threshold: 3, severity: 'error', unit: '次', source: '正式预测请求连续失败计数，成功后清零' },
  { id: 'data-interruption', name: '现场数据源中断或延迟', enabled: false, supported: false, status: 'awaiting-source', metric: 'sourceDelaySeconds', threshold: 30, severity: 'warning', unit: 's', source: '待接入现场源；手动输入和回放暂停不判现场断流' },
];
const DEFAULT_CONFIG = { voiceEnabled: true, eventRetentionDays: 30 };
const admin = actor => { if (!['LOCAL_ADMIN','admin'].includes(actor?.role)) throw new StateError('此操作需要管理员账号。', 403, 'ADMIN_REQUIRED'); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function createMaintenance({ state, dataDir, cases, modelStatus, llm, getQueue = () => ({}), getLatency = () => null }) {
  // Session scope is independent of saved history and survives page navigation.
  const sessionStartedAt = now();
  const initialRules = { version: 1, rules: RULES, updatedAt: now() };
  async function rules() { const saved = await state.read('monitoring-rules.json', initialRules); return { ...saved, registryVersion: 2, rules: [...saved.rules, ...RULES.filter(rule => !saved.rules.some(item => item.id === rule.id))] }; }
  async function config() { return state.read('maintenance-config.json', { version: 1, config: DEFAULT_CONFIG }); }
  async function log(category, level, message, details = {}) {
    const item = { id: randomUUID(), category, level, message: String(message).slice(0, 2000), createdAt: now(), ...details };
    await state.mutate(async () => { const rows = await state.read('activity-log.json', []); rows.unshift(item); await state.write('activity-log.json', rows); }); return item;
  }
  async function logs(query = {}) {
    let rows = await state.read('activity-log.json', []);
    if(query.scope==='realtime') rows=rows.filter(row=>Date.parse(row.createdAt)>=Date.parse(sessionStartedAt));
    if (query.category && query.category !== 'all') rows = rows.filter(row => (query.category === 'model' ? ['model', 'prediction'] : query.category === 'system' ? ['system', 'auth'] : query.category === 'agent' ? ['agent', 'ai'] : [query.category]).includes(row.category));
    if (query.level && query.level !== 'all') rows = rows.filter(row => normalizeLogLevel(row.level) === normalizeLogLevel(query.level));
    const from=query.from?Date.parse(query.from):null,to=query.to?Date.parse(query.to):null;
    if(query.from&&!Number.isFinite(from)||query.to&&!Number.isFinite(to)||from!==null&&to!==null&&from>to)throw new StateError('日志起止时间无效。');
    if(from!==null)rows=rows.filter(row=>Number.isFinite(Date.parse(row.createdAt))&&Date.parse(row.createdAt)>=from);
    if(to!==null)rows=rows.filter(row=>Number.isFinite(Date.parse(row.createdAt))&&Date.parse(row.createdAt)<=to);
    const text = query.query || query.q; if (text) rows = rows.filter(row => JSON.stringify(row).toLowerCase().includes(String(text).toLowerCase()));
    const total = rows.length, offset = Math.max(0, Number(query.offset) || 0); return { items: rows.slice(offset, offset + Math.min(1000, Number(query.limit) || 200)), total, sessionStartedAt };
  }
  async function events(query = {}) {
    // Expiry is applied by the background rolling-retention task. Querying never
    // drops an invalid timestamp or a currently protected event.
    let rows = await state.read('monitoring-events.json', []);
    if (query.state === 'acknowledged') rows = rows.filter(row => row.acknowledgedAt);
    else if (query.state === 'open') rows = rows.filter(row => !row.acknowledgedAt);
    else if (query.state && query.state !== 'all') rows = rows.filter(row => row.state === query.state);
    if (query.level && query.level !== 'all') rows = rows.filter(row => row.severity === query.level);
    if (query.type && query.type !== 'all') rows = rows.filter(row => row.type === query.type);
    if (query.from) rows = rows.filter(row => row.createdAt >= query.from);
    if (query.to) rows = rows.filter(row => row.createdAt <= query.to);
    const text = query.query || query.q; if (text) rows = rows.filter(row => JSON.stringify(row).includes(String(text)));
    const offset = Math.max(0, Number(query.offset) || 0); return { items: rows.slice(offset, offset + Math.min(1000, Number(query.limit) || 200)), total: rows.length };
  }
  async function storage() {
    let bytes = 0;
    for (const item of await readdir(dataDir, { withFileTypes: true })) if (item.isFile()) bytes += (await stat(path.join(dataDir, item.name))).size;
    let freeBytes = null; try { const disk = await statfs(dataDir); freeBytes = Number(disk.bavail) * Number(disk.bsize); } catch {}
    return { dataDir, bytes, freeBytes, lastBackup: await state.read('last-backup.json', null) };
  }
  async function status() {
    const [stored, prediction, ai, disk, currentRules] = await Promise.all([cases(), modelStatus(), llm.status(), storage(), rules()]);
    return { checkedAt: now(), data: { status: stored.length ? 'ready' : 'idle', source: '本地工况库', caseCount: stored.length, lastSampleAt: stored[0]?.createdAt || null },
      prediction: { ...prediction, lastLatencyMs: getLatency() }, ai, assistant: ai, queue: getQueue(), storage: disk, ruleVersion: currentRules.version };
  }
  function validateRules(input, current) {
    if (!Array.isArray(input) || input.length !== current.length) throw new StateError('请保留全部已注册规则。');
    const seen = new Set();
    return input.map(item => {
      const base = current.find(rule => rule.id === item?.id);
      if (!base || seen.has(item.id) || typeof item.enabled !== 'boolean' || typeof item.threshold !== 'number' || !Number.isFinite(item.threshold) || item.threshold <= 0 || item.threshold > (item.id === 'input-drift' ? 100 : 100)) throw new StateError('规则编号、启用状态或阈值无效。');
      if (base.supported === false && item.enabled) throw new StateError('现场数据源尚未接入，此规则暂不开放启用。');
      seen.add(item.id); return { ...base, threshold: item.threshold, enabled: item.enabled };
    });
  }
  async function preview(input, actor) {
    const current = await rules();
    if (input.version !== current.version) throw new StateError('规则版本已变化，请刷新后重新预览。', 409, 'STALE_RULE_VERSION');
    const next = validateRules(input.rules, current.rules);
    const diff = current.rules.flatMap(before => { const after = next.find(rule => rule.id === before.id); return before.threshold !== after.threshold || before.enabled !== after.enabled ? [{ id: before.id, name: before.name, before, after }] : []; });
    if (!diff.length) throw new StateError('没有待应用的规则修改。');
    const historical = await state.read('monitoring-events.json', []);
    const comparable = historical.filter(event => Number.isFinite(event.evidence?.metricValue));
    const count = list => comparable.filter(event => { const rule = list.find(item => item.id === event.ruleId); return rule?.enabled && (rule.id === 'input-completeness' ? event.evidence.metricValue < rule.threshold : Math.abs(event.evidence.metricValue) > rule.threshold); }).length;
    const change = { changeRef: randomUUID(), actorId: actor.id, oldVersion: current.version, rules: next, parameterDigest: hash(next), diff,
      impact: { evaluatedSamples: comparable.length, beforeTriggers: count(current.rules), afterTriggers: count(next), scope: '已保存事件中的可计算样本', historicalCoverage: historical.length, note: '只覆盖已记录事件，非全量生产样本回放。' },
      approvalRequired: true, expiresAt: new Date(Date.now() + 10 * 60000).toISOString(), createdAt: now(), status: 'preview' };
    await state.mutate(async () => { const changes = await state.read('rule-changes.json', []); changes.unshift(change); await state.write('rule-changes.json', changes.slice(0, 1000)); });
    await log('maintenance', 'info', '已生成规则修改预览，等待确认。', { actorId: actor.id, changeRef: change.changeRef }); return change;
  }
  async function apply(input, actor) {
    admin(actor);
    const result = await state.mutate(async () => {
      const changes = await state.read('rule-changes.json', []), change = changes.find(item => item.changeRef === input.changeRef);
      if (!change || change.actorId !== actor.id) throw new StateError('当前账号没有此规则修改预览。', 403, 'APPROVAL_OWNER');
      if (change.status === 'applied') return { ...change.applied, idempotent: true };
      const current = await rules();
      if (current.changeRef === change.changeRef) { change.status = 'applied'; change.applied = current; await state.write('rule-changes.json', changes); return { ...current, idempotent: true }; }
      if (Date.parse(change.expiresAt) <= Date.now() || current.version !== change.oldVersion || input.expectedVersion !== change.oldVersion || hash(change.rules) !== change.parameterDigest || change.rules.length !== current.rules.length) throw new StateError('预览已过期或规则版本变化，请重新预览。', 409, 'STALE_RULE_VERSION');
      const result = { version: current.version + 1, rules: change.rules, updatedAt: now(), appliedBy: actor.id, changeRef: change.changeRef };
      await state.write('monitoring-rules.json', result); change.status = 'applied'; change.applied = result; await state.write('rule-changes.json', changes); return result;
    });
    if (!result.idempotent) await log('maintenance', 'info', `规则版本 ${result.version} 已生效。`, { actorId: actor.id, changeRef: input.changeRef }); return result;
  }
  async function recordPrediction(input, result, actor) {
    await state.mutate(async () => { await state.write('prediction-service-state.json', { failureCount: 0, lastSuccessAt: now() }); });
    const settings = await rules(), sample = input.importProvenance || {}, sampleId = sample.sample_id || sample.sampleId || result.input_snapshot?.sample_id || null;
    const observed = sample.observedAvailable === true && Number.isFinite(sample.observed) && sample.observed !== 0 ? sample.observed : null;
    const error = observed === null ? null : (result.value - observed) / observed * 100, rule = settings.rules.find(r => r.id === 'prediction-error');
    if (!rule?.enabled || error === null || Math.abs(error) <= rule.threshold) return;
    const item = { id: randomUUID(), type: 'prediction-error', severity: rule.severity, title: rule.name, message: `预测与同一样本实测偏差 ${error.toFixed(2)}%，超过软件阈值 ${rule.threshold}%。`, state: 'active', createdAt: now(), ruleId: rule.id, ruleVersion: settings.version, sampleId, actorId: actor?.id || null,
      evidence: { metricValue: error, observed: sample.observed, prediction: result.value, sampleId, modelHash: result.model_hash || null, source: sample.observedSource || '导入样本实测', snapshot: structuredClone(input) } };
    await state.mutate(async () => { const events = await state.read('monitoring-events.json', []); if (sampleId && events.some(event => event.sampleId === sampleId && event.ruleId === rule.id && event.ruleVersion === settings.version)) return; events.unshift(item); await state.write('monitoring-events.json', events); });
  }
  async function recordInput(input, context = {}, actor) {
    if (!input || !Array.isArray(input.stands)) return;
    const current = await rules(), values = modelInputValues(input), complete = values.filter(value => typeof value === 'number' && Number.isFinite(value)).length / 25 * 100;
    const sampleId = input.importProvenance?.sample_id || input.importProvenance?.sampleId || null, pending = [];
    const completeness = current.rules.find(rule => rule.id === 'input-completeness');
    if (completeness?.enabled && complete < completeness.threshold) pending.push({ rule: completeness, metricValue: complete, message: `当前输入完整度 ${complete.toFixed(0)}%，低于软件阈值 ${completeness.threshold}%。缺失字段不会用语言模型补值。` });
    const rangeRule = current.rules.find(rule => rule.id === 'input-range');
    if (rangeRule?.enabled) {
      const metadata = await modelStatus(), ranges = currentModelReferenceRanges(context.historicalRangeLimits), keys = metadata.feature_keys || metadata.feature_schema?.map(item => item.key) || [];
      const out = keys.flatMap((key, index) => { const candidate = ranges[key], bounds = Array.isArray(candidate) ? candidate : candidate && [candidate.min, candidate.max]; return Number.isFinite(values[index]) && bounds?.length === 2 && bounds.every(Number.isFinite) && (values[index] < bounds[0] || values[index] > bounds[1]) ? [{ key, value: values[index], bounds }] : []; });
      if (out.length >= rangeRule.threshold) pending.push({ rule: rangeRule, metricValue: out.length, message: `${out.length} 项输入超出当前参考范围。该提示不阻断导入或预测，也不表示设备危险。`, detail: { outOfRange: out, modelHash: metadata.model_hash || null } });
    }
    const drift = current.rules.find(rule => rule.id === 'input-drift');
    if (drift?.enabled && context.frames?.length) {
      const checked = monitorData({ input, frames: context.frames, currentIndex: context.currentIndex, mode: context.dataMode || 'time-series', driftThreshold: drift.threshold });
      const changed = checked.drift?.features?.filter(feature => feature.drifted) || [];
      if (changed.length) { const scores = changed.map(feature => feature.score).filter(Number.isFinite); pending.push({ rule: drift, metricValue: scores.length ? Math.max(...scores) : null, message: `${changed.length} 项模型输入出现相邻窗口均值变化。${scores.length ? `最大变化为 ${Math.max(...scores).toFixed(2)} 个基准标准差。` : '基准窗口为常量，变化未换算为标准差。'}该提示不等于设备故障。`, detail: { windows: checked.drift.windows, features: changed.map(({ key, score, meanShift, constantBaseline }) => ({ key, score, meanShift, constantBaseline })) } }); }
    }
    if (!pending.length) return;
    await state.mutate(async () => {
      const rows = await state.read('monitoring-events.json', []);
      for (const { rule, metricValue, message, detail } of pending) {
        const fingerprint = hash({ ruleId: rule.id, version: current.version, sampleId, values, detail });
        if (rows.some(item => item.fingerprint === fingerprint)) continue;
        rows.unshift({ id: randomUUID(), fingerprint, type: rule.id, severity: rule.severity, title: rule.name, message, state: 'active', createdAt: now(), ruleId: rule.id, ruleVersion: current.version, sampleId, actorId: actor?.id || null, evidence: { metricValue, sampleId, source: context.dataSource || input.importProvenance?.source_type || '当前工况输入', snapshot: structuredClone(input), ...detail } });
      }
      await state.write('monitoring-events.json', rows);
    });
  }
  async function recordServiceFailure(input, error, actor) {
    if (error.status < 500 || error.code === 'INVALID_INPUT') return;
    const current = await rules(), rule = current.rules.find(item => item.id === 'prediction-service');
    await state.mutate(async () => {
      const previous = await state.read('prediction-service-state.json', { failureCount: 0 }), failureCount = previous.failureCount + 1;
      await state.write('prediction-service-state.json', { ...previous, failureCount, lastFailureAt: now(), lastError: error.code || 'MODEL_UNAVAILABLE' });
      if (!rule?.enabled || failureCount < rule.threshold || previous.failureCount >= rule.threshold) return;
      const rows = await state.read('monitoring-events.json', []);
      rows.unshift({ id: randomUUID(), type: rule.id, severity: rule.severity, title: rule.name, message: `正式预测服务连续 ${failureCount} 次失败，请检查预测服务状态。`, state: 'active', createdAt: now(), ruleId: rule.id, ruleVersion: current.version, actorId: actor?.id || null,
        evidence: { metricValue: failureCount, code: error.code || 'MODEL_UNAVAILABLE', source: '正式预测请求', snapshot: structuredClone(input) } });
      await state.write('monitoring-events.json', rows);
    });
  }
  return { status, rules, config, logs, log, events, preview, apply, recordPrediction, recordInput, recordServiceFailure,
    async getEvent(id) { return (await state.read('monitoring-events.json', [])).find(row => row.id === id) || null; },
    async updateConfig(input, actor) {
      admin(actor); const current = await config(); if (input.version !== current.version) throw new StateError('配置版本已变化，请刷新。', 409);
      if (!record(input.config) || Object.keys(input.config).some(key => !(key in DEFAULT_CONFIG)) || typeof input.config.voiceEnabled !== 'boolean' || !Number.isInteger(input.config.eventRetentionDays) || input.config.eventRetentionDays < 1 || input.config.eventRetentionDays > 3650) throw new StateError('语音开关和事件保留天数无效。');
      const next = { version: current.version + 1, config: input.config, updatedAt: now() }; await state.mutate(async () => { if ((await config()).version !== current.version) throw new StateError('配置版本已变化。', 409); await state.write('maintenance-config.json', next); }); await log('maintenance', 'info', '维护设置已更新。', { actorId: actor.id }); return next;
    },
    async acknowledge(id, actor) { const item = await state.mutate(async () => { const rows = await state.read('monitoring-events.json', []), item = rows.find(row => row.id === id); if (!item) throw new StateError('事件不存在。', 404); item.acknowledgedAt ||= now(); item.acknowledgedBy ||= actor.id; await state.write('monitoring-events.json', rows); return item; }); await log('event', 'info', '事件已确认，检测状态保持原值。', { eventId: id, actorId: actor.id }); return item; },
    async backup(actor) { admin(actor); const id = randomUUID(), createdAt = now(), filename = `backup-${createdAt.replace(/[:.]/g, '-')}.json`, content = { schema: 'dkqkar-local-backup-v1', createdAt, cases: await cases(), rules: await rules(), config: await config(), events: (await events({ limit: 1000 })).items }; const info = { id, filename, createdAt, bytes: Buffer.byteLength(JSON.stringify(content, null, 2)) + 1 }; await state.mutate(async () => { await state.write(`backups/${filename}`, content); await state.write('last-backup.json', info); }); await log('maintenance', 'info', '本地备份已创建。', { backupId: id }); return info; },
    async diagnostics(actor) { admin(actor); const current = await status(); return { schema: 'dkqkar-diagnostics-v1', createdAt: now(), ...current, storage: { ...current.storage, dataDir: '[本机数据目录]' }, logs: (await logs({ limit: 100 })).items, rules: await rules(), config: await config() }; },
  };
}
