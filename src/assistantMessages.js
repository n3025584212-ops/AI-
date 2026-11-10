// Local conversation continuity. Only user-visible fields are stored; trace and
// attachment internals are deliberately re-read from the authoritative run when
// available, never replayed from this cache.
const STORAGE_PREFIX = 'qcdkr.assistant-messages.v1:';
const MAX_MESSAGES = 40;
const KEEP = [
  'role', 'text', 'mode', 'runId', 'request_id', 'user_message_id', 'snapshot_id', 'observation_id',
  'answerScope', 'question_type', 'diagnostic_sections', 'facts_state', 'ai_explanation_state',
  'actions', 'diagnosis_actions', 'trial_preview', 'trial_execution', 'references', 'analysisId',
  'historical', 'contextFingerprint', 'sampleTime', 'retry', 'generationError', 'routingError',
  'ai_explanation_primary_failure', 'diagnosis_title', 'trial_error', 'trial_choices',
  'reference_history_note', 'interruptionLabel',
];
const key = owner => STORAGE_PREFIX + encodeURIComponent(owner || 'local');
function compact(message) {
  const value = {};
  for (const field of KEEP) if (message?.[field] !== undefined) value[field] = message[field];
  return value;
}
export function readAssistantMessages(owner, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(key(owner));
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter(message => message && typeof message === 'object' && typeof message.role === 'string')
      .slice(-MAX_MESSAGES)
      .map(message => ({ ...message, historical: true }));
  } catch { return []; }
}
export function writeAssistantMessages(owner, messages, storage = globalThis.localStorage) {
  try {
    const data = (Array.isArray(messages) ? messages : []).slice(-MAX_MESSAGES).map(compact);
    storage?.setItem(key(owner), JSON.stringify(data));
    return true;
  } catch { return false; }
}
export function clearAssistantMessages(owner, storage = globalThis.localStorage) {
  try { storage?.removeItem(key(owner)); return true; } catch { return false; }
}
