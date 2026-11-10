// Copilot access contract shared by the browser and the task orchestrator.
// The server is authoritative; these helpers only keep the UI and planner in
// sync with the same capability policy.
export const ASSISTANT_MODES = Object.freeze(['READ_ONLY', 'APPROVAL', 'FULL_ACCESS']);
export const DEFAULT_ASSISTANT_MODE = 'APPROVAL';
export const ASSISTANT_MODE_LABELS = Object.freeze({
  READ_ONLY: { label: '只读', short: '只读', description: '可查询、解释、定位；不能载入、导入、试算或导出。' },
  APPROVAL: { label: '申请', short: '申请', description: '写操作先给计划/候选；工况变更只生成候选，需人工载入。' },
  FULL_ACCESS: { label: '完全访问', short: '完全', description: '读/导航/导出自动执行；工况变更只生成候选，需人工载入。' },
});
// Workbench-changing actions are never executed by the agent itself. The user
// applies a generated candidate explicitly from the task card. This keeps the
// audit trail free of "applied but failed" UI receipts.
export const MANUAL_WORKBENCH_WRITES = new Set(['case.load', 'data.import', 'trial.promote', 'parameter.update', 'ui.open_replay', 'optimization.preview_candidate']);
const MODE_SET = new Set(ASSISTANT_MODES);
export const MODE_STORAGE_KEY = 'qcdkr.assistant-mode.v1';
export const WRITE_EFFECTS = new Set(['write', 'write_current', 'config', 'delete', 'WRITE_CURRENT', 'CONFIG', 'DELETE']);

export function normalizeAssistantMode(value) {
  return MODE_SET.has(value) ? value : DEFAULT_ASSISTANT_MODE;
}
export function readAssistantMode(storage = globalThis.localStorage) {
  try { return normalizeAssistantMode(storage?.getItem(MODE_STORAGE_KEY)); } catch { return DEFAULT_ASSISTANT_MODE; }
}
export function writeAssistantMode(value, storage = globalThis.localStorage) {
  const mode = normalizeAssistantMode(value);
  try { storage?.setItem(MODE_STORAGE_KEY, mode); } catch {}
  return mode;
}
export function capabilityAllowed(definition, mode = DEFAULT_ASSISTANT_MODE) {
  if (MANUAL_WORKBENCH_WRITES.has(definition?.id)) return false;
  if (normalizeAssistantMode(mode) !== 'READ_ONLY') return true;
  const effect = definition?.effect || 'read';
  return effect === 'read' || effect === 'ui' || effect === 'preview';
}
export function isDestructiveCapability(definition) {
  const effect = definition?.effect || 'read';
  const id = String(definition?.id || '');
  // Irreversible or installation-wide operations keep an explicit confirmation
  // even in full-access mode.
  return effect === 'delete' || effect === 'config'
    || /^(rules|maintenance|communication)\./.test(id);
}
export function requiresApprovalFor(definition, mode = DEFAULT_ASSISTANT_MODE) {
  const normalized = normalizeAssistantMode(mode);
  if (normalized === 'READ_ONLY') return false;
  if (normalized === 'FULL_ACCESS') return isDestructiveCapability(definition);
  return definition?.requiresApproval === true || WRITE_EFFECTS.has(definition?.effect || 'read');
}
