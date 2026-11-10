import { createHash } from 'node:crypto';
import { StateError, now } from './local-state.mjs';

const FILE = 'operation-ledger.json';
const shared = new WeakMap();
const pending = new Set(['intended', 'executing', 'needs_reconciliation']);
const copy = value => value === undefined ? null : structuredClone(value);
const errorRecord = (error, fallback = 'OPERATION_FAILED') => ({ code: error?.code || fallback, message: error?.message || '操作失败。' });
function resultData(value, seen = new Set()) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  if (!value || typeof value !== 'object' || seen.has(value) || !Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new StateError('操作结果不是可持久化的有限 JSON 数据。', 500, 'INVALID_OPERATION_RESULT');
  seen.add(value);
  const normalized = Array.isArray(value) ? Array.from(value, item => resultData(item, seen)) : Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, resultData(item, seen)]));
  seen.delete(value); return normalized;
}

// JSON identity is strict: lossy JSON coercions must not silently share a key.
function canonical(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(Object.is(value, -0) ? 0 : value);
  if (!value || typeof value !== 'object' || seen.has(value)) throw new StateError('操作参数必须是有限、无循环的 JSON 数据。', 400, 'INVALID_OPERATION_ARGS');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new StateError('操作参数必须是普通 JSON 数据。', 400, 'INVALID_OPERATION_ARGS');
  seen.add(value);
  const result = Array.isArray(value) ? `[${Array.from(value, item => canonical(item, seen)).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key], seen)}`).join(',')}}`;
  seen.delete(value);
  return result;
}
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const text = (value, field) => { if (typeof value !== 'string' || !value.trim() || /[\0\r\n]/.test(value)) throw new StateError(`${field} 必须是明确的操作身份。`, 400, 'INVALID_OPERATION_IDENTITY'); return value; };

/**
 * Durable intent and verified receipts, not an exactly-once transport promise.
 * Side effects and verification run OUTSIDE state.mutate, because business
 * writers use that same queue. There are no task budgets or retry policies here.
 */
export function createOperationLedger({ state }) {
  if (!state?.read || !state?.write || !state?.mutate) throw new TypeError('state must expose read, write and mutate');
  let runtime = shared.get(state);
  if (!runtime) { runtime = { inflight: new Map() }; shared.set(state, runtime); }

  async function load() {
    const value = await state.read(FILE, { schema_version: 'operation-ledger-v1', operations: [] });
    if (value.schema_version !== 'operation-ledger-v1' || !Array.isArray(value.operations)) throw new StateError('操作回执存储格式无效。', 500, 'OPERATION_LEDGER_SCHEMA');
    return value;
  }
  async function update(operationId, change) {
    return state.mutate(async () => {
      const records = await load(), receipt = records.operations.find(item => item.operation_id === operationId);
      if (!receipt) throw new StateError('操作意图不存在。', 409, 'OPERATION_NOT_FOUND');
      Object.assign(receipt, change, { updated_at: now() });
      await state.write(FILE, records);
      return copy(receipt);
    });
  }
  const result = receipt => ({ status: pending.has(receipt.status) ? 'needs_reconciliation' : receipt.status, data: copy(receipt.data), receipt: copy(receipt), ...(receipt.error ? { error: copy(receipt.error) } : {}) });
  const context = (receipt, signal) => ({ operationId: receipt.operation_id, args: copy(receipt.args), receipt: copy(receipt), signal });

  async function settle(receipt, fields) {
    try { return result(await update(receipt.operation_id, fields)); }
    catch (error) {
      // The intent remains durable. Never report a verified operation if its
      // verification receipt could not be committed after the side effect.
      return result({ ...receipt, status: 'needs_reconciliation', error: errorRecord(error, 'RECEIPT_PERSIST_FAILED'), reconciliation_reason: 'receipt_persistence_failed' });
    }
  }
  async function reconcileReceipt(receipt, options = {}) {
    if (!pending.has(receipt.status)) return result(receipt);
    if (typeof options.reconcile !== 'function') return settle(receipt, { status: 'needs_reconciliation', reconciliation_reason: receipt.reconciliation_reason || 'no_reconciler' });
    try {
      // Reconciliation is a read-back of actual business state, not a replay.
      const checked = await options.reconcile(copy(receipt), context(receipt, options.signal));
      if (checked?.verified === true) return settle(receipt, { status: 'verified', data: checked.data === undefined ? receipt.data : resultData(checked.data), verification: { method: 'reconciliation', observed: resultData(checked.observed), checked_at: now() }, error: null, reconciliation_reason: null });
      if (checked?.applied === false && checked?.definitive === true) return settle(receipt, { status: 'failed', error: checked.error || receipt.error || { code: 'OPERATION_NOT_APPLIED', message: '已核对，操作未生效。' }, verification: { method: 'reconciliation', observed: copy(checked.observed), checked_at: now() }, reconciliation_reason: null });
      return settle(receipt, { status: 'needs_reconciliation', reconciliation_reason: 'outcome_not_confirmed' });
    } catch (error) { return settle(receipt, { status: 'needs_reconciliation', reconciliation_error: errorRecord(error, 'RECONCILIATION_FAILED') }); }
  }

  async function run(options, identity, parameterDigest) {
    let fresh = false;
    let receipt = await state.mutate(async () => {
      const records = await load(), old = records.operations.find(item => item.operation_id === identity.operation_id);
      if (old) {
        if (old.parameter_digest !== parameterDigest) throw new StateError('同一操作编号不能对应不同动作、参数或执行身份。', 409, 'OPERATION_ID_CONFLICT');
        return copy(old);
      }
      options.signal?.throwIfAborted();
      const created = { schema_version: 'operation-receipt-v1', ...identity, parameter_digest: parameterDigest, args: copy(options.args ?? {}), status: 'intended', data: null, verification: null, error: null, created_at: now(), updated_at: now() };
      records.operations.push(created);
      await state.write(FILE, records);
      fresh = true;
      return copy(created);
    });
    if (!fresh) return reconcileReceipt(receipt, options);
    if (options.signal?.aborted) return settle(receipt, { status: 'failed', error: errorRecord(options.signal.reason, 'OPERATION_CANCELLED'), reconciliation_reason: null });
    // Mark before the callback. A crash from this point is an uncertain outcome.
    receipt = await update(receipt.operation_id, { status: 'executing', started_at: now() });
    let data;
    try {
      options.signal?.throwIfAborted();
      data = resultData(await options.execute(context(receipt, options.signal)));
      const checked = await options.verify(data, context(receipt, options.signal));
      if (checked === true || checked?.verified === true) return settle(receipt, { status: 'verified', data: resultData(checked?.data === undefined ? data : checked.data), verification: { method: 'state_readback', observed: resultData(checked?.observed), checked_at: now() }, error: null, reconciliation_reason: null });
      receipt = await update(receipt.operation_id, { status: 'needs_reconciliation', data: copy(data), reconciliation_reason: 'verification_not_confirmed' });
    } catch (error) {
      const fields = { status: 'needs_reconciliation', data: copy(data), error: errorRecord(error), reconciliation_reason: 'execution_or_verification_interrupted' };
      try { receipt = await update(receipt.operation_id, fields); }
      catch (storageError) { return result({ ...receipt, ...fields, reconciliation_error: errorRecord(storageError, 'RECEIPT_PERSIST_FAILED') }); }
    }
    return reconcileReceipt(receipt, options);
  }

  async function execute(options = {}) {
    const identity = { operation_id: text(options.operationId, 'operationId'), actor_id: text(options.actorId, 'actorId'), task_id: text(options.taskId, 'taskId'), step_id: text(options.stepId, 'stepId'), action_id: text(options.actionId, 'actionId') };
    if (typeof options.execute !== 'function' || typeof options.verify !== 'function') throw new StateError('操作必须同时提供真实执行与结果核验。', 400, 'OPERATION_VERIFIER_REQUIRED');
    const parameterDigest = digest({ ...identity, args: options.args ?? {} });
    options = { ...options, args: copy(options.args ?? {}) };
    const running = runtime.inflight.get(identity.operation_id);
    if (running) {
      if (running.digest !== parameterDigest) throw new StateError('同一操作编号不能对应不同动作、参数或执行身份。', 409, 'OPERATION_ID_CONFLICT');
      return copy(await running.promise);
    }
    const entry = { digest: parameterDigest };
    const promise = run(options, identity, parameterDigest);
    entry.promise = promise; runtime.inflight.set(identity.operation_id, entry);
    try { return copy(await promise); } finally { if (runtime.inflight.get(identity.operation_id) === entry) runtime.inflight.delete(identity.operation_id); }
  }
  async function read(operationId, { actorId } = {}) {
    const receipt = (await load()).operations.find(item => item.operation_id === operationId);
    if (receipt && actorId !== undefined && receipt.actor_id !== actorId) throw new StateError('操作回执不属于当前用户。', 403, 'OPERATION_SCOPE');
    return receipt ? copy(receipt) : null;
  }
  async function list({ actorId, taskId, statuses } = {}) {
    return copy((await load()).operations.filter(item => (actorId === undefined || item.actor_id === actorId) && (taskId === undefined || item.task_id === taskId) && (!statuses || statuses.includes(item.status))));
  }
  async function reconcilePending({ resolve, signal, operationIds } = {}) {
    if (typeof resolve !== 'function') throw new TypeError('resolve(receipt) must provide the business reconciler');
    const rows = (await list({ statuses: [...pending] })).filter(receipt => !operationIds || operationIds.includes(receipt.operation_id)), results = [];
    for (const receipt of rows) {
      signal?.throwIfAborted();
      const running = runtime.inflight.get(receipt.operation_id);
      if (running) { results.push(copy(await running.promise)); continue; }
      const options = await resolve(copy(receipt));
      results.push(await reconcileReceipt(receipt, { ...options, signal }));
    }
    return results;
  }
  return Object.freeze({ execute, read, list, reconcilePending });
}
