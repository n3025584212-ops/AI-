import { createHash } from 'node:crypto';
import { StateError, now, record } from './local-state.mjs';

const SECRET_KEY = /^(?:api[_-]?key|authorization|password|passwd|secret|client[_-]?secret|access[_-]?token|refresh[_-]?token|cookie|credentials)$/i;

// Checkpoints are operational state, not a new knowledge-memory policy. Keep
// the original values of business data, but never persist provider credentials.
export function taskRecord(value) {
  if (typeof value === 'string') return value
    .replace(/\bBearer\s+[A-Za-z0-9_.~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}/g, '[REDACTED]');
  if (Array.isArray(value)) return value.map(taskRecord);
  if (record(value)) return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .map(([key, item]) => [key, SECRET_KEY.test(key) ? '[REDACTED]' : taskRecord(item)]));
  return value;
}

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}
export const taskDigest = value => createHash('sha256').update(JSON.stringify(ordered(value ?? null))).digest('hex');

export function contextIdentity(context = {}) {
  const prediction = context.prediction || {}, snapshot = context.input_snapshot || prediction.input_snapshot || {};
  const value = {
    snapshotId: snapshot.snapshot_id ?? prediction.snapshot_id ?? context.request_snapshot_id ?? null,
    observationId: context.observation?.observation_id ?? prediction.observation_id ?? null,
    inputHash: prediction.input_hash ?? snapshot.input_hash ?? null,
    modelHash: prediction.model_hash ?? context.model_hash ?? null,
    modelVersion: prediction.model_version ?? snapshot.model_version ?? null,
    predictionMode: prediction.mode ?? null,
    contextFingerprint: context.contextFingerprint ?? prediction.contextFingerprint ?? null,
    operationScope: context.operation_scope ?? null,
    datasetId: context.dataset_id ?? context.dataset?.id ?? null,
    datasetVersion: context.dataset_version ?? context.dataset?.version ?? null,
  };
  return { ...taskRecord(value), digest: taskDigest(value) };
}

export async function createTaskStore({ state, filename = 'ai-tasks.json' }) {
  if (!state?.read || !state?.write || !state?.mutate) throw new TypeError('Task store requires a local-state adapter.');
  const saved = await state.read(filename, { version: 1, tasks: [] });
  let records = new Map((Array.isArray(saved) ? saved : saved.tasks || []).map(task => [task.taskId, task]));
  return {
    async put(task) {
      if (!record(task) || !task.taskId || !task.actorId) throw new StateError('任务记录缺少身份。', 400, 'TASK_IDENTITY');
      return state.mutate(async () => {
        const next = taskRecord({ ...task, updatedAt: now() });
        const replacement = new Map(records); replacement.set(next.taskId, next);
        await state.write(filename, { version: 1, tasks: [...replacement.values()] });
        records = replacement;
        return structuredClone(next);
      });
    },
    get(id) { const value = records.get(id); return value ? structuredClone(value) : null; },
    list(actor) { return [...records.values()].filter(task => !actor || task.actorId === actor.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(task => structuredClone(task)); },
  };
}
