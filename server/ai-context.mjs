import { StateError } from './local-state.mjs';
import { contextIdentity, taskRecord } from './task-store.mjs';
import { buildAssistantFactPacket } from '../src/assistantFacts.js';
import { unitFor } from '../src/engineeringUnits.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);

// A snapshot proves the identity of a computation. It does not prove that an
// imported observation is a certified field measurement or that UI text is true.
export async function buildAiContext({ actor, input = {}, freezeContext, session = null, requestId = null }) {
  if (!actor?.id) throw new StateError('AI 上下文需要真实用户身份。', 401, 'AI_ACTOR_REQUIRED');
  if (input?.actorId && input.actorId !== actor.id) throw new StateError('不能读取其他用户的 AI 上下文。', 403, 'AI_CONTEXT_SCOPE');
  const supplied = taskRecord(input || {});
  delete supplied.actorId;
  delete supplied.permissions;
  delete supplied.isAdmin;
  const frozen = await freezeContext(supplied);
  const prediction = frozen.prediction || {}, observation = frozen.observation || prediction.observation || {};
  const factPacket = buildAssistantFactPacket(frozen, { request_id: requestId });
  const selected = frozen.selectedStand || 'S5';
  const identity = contextIdentity(frozen);
  return {
    frozen,
    projection: {
      schema: 'qcdkr-ai-context-v1',
      request_id: requestId,
      actor: { id: actor.id },
      subject: {
        case_id: frozen.caseData?.id || null,
        snapshot_id: identity.snapshotId,
        stand: selected,
        event_id: frozen.selectedEvent?.id || null,
        data_source: typeof frozen.dataSource === 'string' ? frozen.dataSource : null,
      },
      identity,
      current: {
        page: frozen.currentPage || null,
        prediction: finite(prediction.value) ? { value: prediction.value, target: finite(prediction.target) ? prediction.target : null, deviation: finite(prediction.deviation) ? prediction.deviation : null, mode: prediction.mode, unit: unitFor('force'), source: 'VERIFIED_COMPUTATION' } : null,
        observation: finite(observation.value) ? { value: observation.value, unit: unitFor('force'), source: 'USER_SUPPLIED_OBSERVATION', source_text: observation.source || null } : null,
        fact_packet: factPacket,
        selected_event: frozen.selectedEvent ? { id: frozen.selectedEvent.id, title: frozen.selectedEvent.title || null, status: frozen.selectedEvent.state || null } : null,
      },
      task: session?.task ? structuredClone(session.task) : null,
      conversation: (session?.messages || []).slice(-12).map(message => ({ id: message.id, role: message.role, text: message.text, source: message.source, created_at: message.createdAt })),
      constraints: session?.constraints || [],
    },
  };
}
