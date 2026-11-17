import { randomUUID } from 'node:crypto';
import { StateError, now } from './local-state.mjs';
import { taskRecord } from './task-store.mjs';

const FILE = 'ai-copilot-sessions.json';
const EMPTY = { version: 1, sessions: [] };
const text = (value, limit = 12000) => String(value ?? '').trim().slice(0, limit);
const clone = value => structuredClone(value);
const TASK_FIELDS = new Set(['goal', 'status', 'pending', 'steps', 'hypotheses', 'subject', 'lastReceipt']);

function publicSession(session) {
  if (!session) return null;
  return { ...clone(session), messages: session.messages.slice(-100), task: clone(session.task), constraints: [...session.constraints] };
}

export function createAiMemory({ state, filename = FILE }) {
  const read = () => state.read(filename, EMPTY);
  function owned(data, actor, sessionId) {
    const session = data.sessions.find(item => item.id === sessionId);
    if (!session || session.actorId !== actor.id) throw new StateError('会话不存在或不属于当前账号。', 404, 'AI_SESSION_SCOPE');
    return session;
  }
  async function open(actor, sessionId = null) {
    if (!actor?.id) throw new StateError('会话需要真实用户身份。', 401, 'AI_SESSION_ACTOR');
    return state.mutate(async () => {
      const data = await read();
      if (sessionId) return publicSession(owned(data, actor, sessionId));
      const latest = data.sessions.filter(item => item.actorId === actor.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (latest) return publicSession(latest);
      const at = now(), session = { id: randomUUID(), actorId: actor.id, title: '新的工艺分析', createdAt: at, updatedAt: at, subject: null, constraints: [], task: { goal: '', status: 'IDLE', steps: [], hypotheses: [], pending: null }, messages: [] };
      data.sessions.unshift(session); data.sessions = data.sessions.slice(0, 100);
      await state.write(filename, data); return publicSession(session);
    });
  }
  async function create(actor) {
    const session = await open(actor);
    return state.mutate(async () => {
      const data = await read(), at = now(), next = { id: randomUUID(), actorId: actor.id, title: '新的工艺分析', createdAt: at, updatedAt: at, subject: session.subject, constraints: [], task: { goal: '', status: 'IDLE', steps: [], hypotheses: [], pending: null }, messages: [] };
      data.sessions.unshift(next); await state.write(filename, data); return publicSession(next);
    });
  }
  async function append(actor, sessionId, input) {
    const role = input?.role;
    if (!['user', 'assistant', 'tool', 'system'].includes(role)) throw new StateError('会话消息角色无效。', 400, 'AI_MESSAGE_ROLE');
    const content = text(input.text);
    if (!content) throw new StateError('会话消息不能为空。', 400, 'AI_MESSAGE_EMPTY');
    return state.mutate(async () => {
      const data = await read(), session = owned(data, actor, sessionId), at = now();
      const message = { id: input.id || randomUUID(), role, text: content, source: input.source || role, clientRequestId: input.clientRequestId || null, evidenceRefs: taskRecord(input.evidenceRefs || []), experienceRefs: taskRecord(input.experienceRefs || []), toolRefs: taskRecord(input.toolRefs || []), responseSource: input.responseSource || null, createdAt: at };
      if (role === 'user' && input.clientRequestId) {
        const duplicate = session.messages.find(item => item.role === 'user' && item.clientRequestId === input.clientRequestId);
        if (duplicate) return { session: publicSession(session), message: clone(duplicate), duplicate: true };
      }
      session.messages.push(message); session.messages = session.messages.slice(-160);
      if (role === 'user') {
        if (session.messages.filter(item => item.role === 'user').length === 1) session.title = content.slice(0, 80);
        if (input.subject) session.subject = taskRecord(input.subject);
        if (Array.isArray(input.constraints)) session.constraints = [...new Set(input.constraints.map(value => text(value, 200)).filter(Boolean))].slice(0, 12);
      }
      session.updatedAt = at; await state.write(filename, data);
      return { session: publicSession(session), message: clone(message) };
    });
  }
  async function updateTask(actor, sessionId, patch = {}) {
    return state.mutate(async () => {
      const data = await read(), session = owned(data, actor, sessionId);
      for (const [key, value] of Object.entries(patch)) if (TASK_FIELDS.has(key)) session.task[key] = taskRecord(value);
      if (patch.constraints) session.constraints = [...new Set(patch.constraints.map(value => text(value, 200)).filter(Boolean))].slice(0, 12);
      if (patch.subject) session.subject = taskRecord(patch.subject);
      session.updatedAt = now(); await state.write(filename, data); return publicSession(session);
    });
  }
  async function get(actor, sessionId) { const data = await read(); return publicSession(owned(data, actor, sessionId)); }
  async function list(actor) {
    const data = await read();
    return data.sessions.filter(item => item.actorId === actor.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(item => ({ id: item.id, title: item.title, updatedAt: item.updatedAt, subject: item.subject, task: item.task, messageCount: item.messages.length }));
  }
  return { open, create, append, updateTask, get, list };
}
