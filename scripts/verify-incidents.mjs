import assert from 'node:assert/strict';
import { createAiIncidentService } from '../server/ai-incidents.mjs';

const files = new Map();
const state = {
  read: async (name, fallback) => files.has(name) ? structuredClone(files.get(name)) : structuredClone(fallback),
  write: async (name, value) => { files.set(name, structuredClone(value)); },
  mutate: async fn => fn(),
};
const health = { model: false, llm: false, embedding: false, event: true, failedTask: true };
let llmCalls = 0;
const llm = { status: async () => ({ available: health.llm }), chat: async () => { llmCalls++; throw new Error('LLM must not be called by incident monitoring'); } };
const embedding = { status: async () => ({ available: health.embedding }) };
const taskRuntime = { list: actor => health.failedTask && actor.id === 'user-a' ? [{ taskId: 'T-1', goal: '检查 S5 偏差', status: 'failed', terminalReason: { code: 'MODEL_TIMEOUT', message: '预测超时。' } }] : [] };
const maintenance = { events: async () => ({ items: health.event ? [{ id: 'E-1', state: 'active', severity: 'HIGH', title: 'S5 张力波动超限', message: '张力波动超过规则阈值。' }] : [] }) };
const service = createAiIncidentService({ state, modelStatus: async () => ({ available: health.model }), llm, embedding, taskRuntime, maintenance });
const actorA = { id: 'user-a', role: 'LOCAL_ADMIN' }, actorB = { id: 'user-b', role: 'LOCAL_ADMIN' };

const first = await service.reconcile(actorA);
assert.ok(first.incidents.length >= 5, JSON.stringify(first.incidents));
assert.equal(first.changes.filter(change => change.type === 'CREATED').length, first.incidents.length);
assert.equal(llmCalls, 0, 'monitoring must not call LLM');

const second = await service.reconcile(actorA);
assert.equal(second.incidents.length, first.incidents.length, 'same observations must not create duplicate incidents');
assert.ok(second.changes.every(change => change.type !== 'CREATED'));
assert.ok(second.incidents.every(item => item.occurrences >= 2));

const task = second.incidents.find(item => item.category === 'TASK');
assert.ok(task && task.sourceRefs.includes('tasks/T-1'));
const business = second.incidents.find(item => item.category === 'BUSINESS');
assert.ok(business && business.actorId === 'shared');
const bList = await service.list(actorB);
assert.ok(!bList.some(item => item.category === 'TASK' && item.sourceRefs.includes('tasks/T-1')), 'other user cannot see user A task incident');
let scoped = false;
try { await service.acknowledge(actorB, task.id); } catch (error) { scoped = error.code === 'INCIDENT_SCOPE'; }
assert.ok(scoped, 'other user cannot acknowledge user A incident');

const acknowledged = await service.acknowledge(actorA, task.id);
assert.equal(acknowledged.acknowledgedBy, 'user-a');
assert.ok(acknowledged.acknowledgedAt);
const handover = await service.handover(actorA);
assert.ok(handover.activeCount >= 1 && handover.active.some(item => item.id === task.id));

health.model = true; health.llm = true; health.embedding = true; health.event = false; health.failedTask = false;
const recoveredA = await service.reconcile(actorA);
assert.ok(recoveredA.changes.some(change => change.type === 'RECOVERED' && change.id === task.id), JSON.stringify(recoveredA.changes));
const system = await service.reconcile({ id: 'system' });
assert.ok(system.changes.some(change => change.type === 'RECOVERED' && change.id === business.id), JSON.stringify(system.changes));
const finalList = await service.list(actorA);
assert.ok(finalList.every(item => item.status === 'RECOVERED'));
assert.equal(llmCalls, 0);
assert.ok(system.heartbeat?.at);

console.log(JSON.stringify({ ok: true, incidentsCreated: first.incidents.length, deduplicated: true, userIsolation: true, acknowledgment: true, recoveryVerified: true, llmCalls }, null, 2));
service.close();
