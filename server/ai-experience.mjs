import { randomUUID } from 'node:crypto';
import { StateError, now } from './local-state.mjs';
import { taskRecord } from './task-store.mjs';
import { cosineSimilarity } from './embedding-service.mjs';
import { retrieveKnowledge } from './knowledge.mjs';

const FILE = 'ai-copilot-experiences.json';
const EMPTY = { version: 1, experiences: [] };
const text = (value, max = 4000) => String(value ?? '').trim().slice(0, max);

export function createExperienceMemory({ state, embedding }) {
  const read = () => state.read(FILE, EMPTY);
  async function publish({ actor, session, outcome, confirmed = false }) {
    if (!actor?.id || !session || session.actorId !== actor.id) throw new StateError('经验归属无效。', 403, 'EXPERIENCE_SCOPE');
    if (confirmed !== true) throw new StateError('只有用户确认的结果才能沉淀为经验。', 409, 'EXPERIENCE_CONFIRMATION_REQUIRED');
    const result = text(outcome, 3000), assistant = [...session.messages].reverse().find(message => message.role === 'assistant');
    if (!result || !assistant) throw new StateError('经验需要已有分析和实际结果说明。', 400, 'EXPERIENCE_INCOMPLETE');
    const sourceRefs = session.messages.flatMap(message => message.toolRefs || []).slice(-12);
    const content = [session.task.goal || session.title, assistant.text, result].join('\n');
    const [vector] = await embedding.embed([content]);
    const experience = { id: randomUUID(), actorId: actor.id, workspaceId: session.workspaceId || 'local', title: text(session.title, 160), summary: assistant.text, outcome: result, goal: session.task.goal || session.title, sourceStatus: 'USER_CONFIRMED_OUTCOME', sourceRefs: taskRecord(sourceRefs), subject: taskRecord(session.subject), status: 'ACTIVE', embeddingModel: 'BAAI/bge-small-zh-v1.5', embedding: vector, createdAt: now(), updatedAt: now(), supersededBy: null };
    await state.mutate(async () => {
      const data = await read();
      if (data.experiences.some(item => item.actorId === actor.id && item.goal === experience.goal && item.outcome === experience.outcome && item.status === 'ACTIVE')) return;
      data.experiences.unshift(experience); data.experiences = data.experiences.slice(0, 2000); await state.write(FILE, data);
    });
    return { ...experience, embedding: undefined };
  }
  async function search({ actor, query, limit = 4 }) {
    const data = await read(), queryText = text(query, 4000);
    if (!queryText) return { items: [], retrievalMode: 'EMPTY', model: null };
    const candidates = data.experiences.filter(item => item.actorId === actor.id && item.status === 'ACTIVE');
    try {
      const [vector] = await embedding.embed([queryText], { query: true });
      const items = candidates.map(item => ({ id: item.id, title: item.title, summary: item.summary, outcome: item.outcome, goal: item.goal, sourceStatus: item.sourceStatus, sourceRefs: item.sourceRefs, subject: item.subject, createdAt: item.createdAt, score: cosineSimilarity(vector, item.embedding) }))
        .sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt)).slice(0, Math.min(8, Math.max(1, limit)));
      return { items, retrievalMode: 'DENSE_BGE', model: 'BAAI/bge-small-zh-v1.5', note: '相似度只用于召回，不是经验正确率或当前工况适用性的证明。' };
    } catch (error) {
      const docs = candidates.map(item => ({ id: item.id, title: item.title, fileName: 'experience', chunks: [{ id: item.id + '-text', text: `${item.goal}\n${item.summary}\n${item.outcome}` }] }));
      const refs = retrieveKnowledge(docs, queryText, { limit });
      const byId = new Map(candidates.map(item => [item.id, item]));
      return { items: refs.map(ref => ({ ...byId.get(ref.documentId), score: null })).filter(Boolean), retrievalMode: 'LEXICAL_FALLBACK', model: null, warning: '本地向量模型不可用，本次仅使用词法检索，未宣称语义召回。' };
    }
  }
  async function supersede({ actor, id, replacementId = null }) {
    return state.mutate(async () => {
      const data = await read(), item = data.experiences.find(row => row.id === id);
      if (!item || item.actorId !== actor.id) throw new StateError('经验不存在或不属于当前账号。', 404, 'EXPERIENCE_SCOPE');
      if (replacementId && !data.experiences.some(row => row.id === replacementId && row.actorId === actor.id)) throw new StateError('替代经验不存在。', 409, 'EXPERIENCE_REPLACEMENT');
      item.status = 'SUPERSEDED'; item.supersededBy = replacementId; item.updatedAt = now(); delete item.embedding;
      await state.write(FILE, data); return { ...item, embedding: undefined };
    });
  }
  return { publish, search, supersede };
}
