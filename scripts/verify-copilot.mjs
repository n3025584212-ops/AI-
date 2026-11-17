import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/index.mjs';
import { createLocalState } from '../server/local-state.mjs';
import { createAiMemory } from '../server/ai-memory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'tmp', 'test-data', 'copilot-' + Date.now());
const port = 5402, base = `http://127.0.0.1:${port}`;
let turn = 0;
const llm = {
  status: async () => ({ available: true, providerStatus: 'READY' }),
  chat: async (messages, options = {}) => {
    if (options.tools) {
      const input = JSON.parse(messages.at(-1).content), tool = options.tools.find(item => item.function.description.startsWith('检索已收录资料'));
      return { message: { tool_calls: [{ id: 'lookup-' + turn, function: { name: tool.function.name, arguments: JSON.stringify({ query: input.question }) } }] } };
    }
    turn++;
    const corrected = messages.some(message => message.content?.includes('如果不是张力'));
    return { message: { content: JSON.stringify({ answer: corrected ? '已保留上一轮的 S5 对象，并将你的纠正作为新假设；正式参数不变。' : '先核对当前工况与入口侧张力，再进行历史对比 [R1]。', used_reference_ids: corrected ? [] : ['R1'], used_experience_ids: [], hypothesis_updates: [{ text: corrected ? '入口厚度或其他因素' : '入口侧张力', status: 'CANDIDATE' }] }) } };
  },
};
const request = async (method, route, body) => {
  const response = await fetch(base + route, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const value = await response.json();
  return { status: response.status, body: value };
};
const stop = server => new Promise(resolve => server.close(resolve));
const start = () => startServer({ port, dataDir, distDir: path.join(root, 'dist-3d'), requireLogin: false, localLlm: llm });
const results = [];
const check = (name, value) => { results.push({ name, passed: Boolean(value) }); assert.ok(value, name); };
let server = await start();
let sessionId;
try {
  let response = await request('POST', '/api/copilot/chat', { message: '分析 S5 后张力，只分析不要改正式参数', context: { currentPage: 'prediction', lineId: 'local' }, accessMode: 'READ_ONLY', clientRequestId: 'turn-one' });
  check('first turn HTTP', response.status === 200);
  sessionId = response.body.session.id;
  check('LLM source is visible', response.body.run.responseSource === 'LLM');
  check('real knowledge tool executed', response.body.run.tools.some(item => item.actionId === 'knowledge.search' && item.verified));
  check('constraint persisted', response.body.session.constraints.includes('只分析，不修改正式参数或设备'));
  check('real reference returned', response.body.run.references.length > 0);

  response = await request('POST', '/api/copilot/chat', { sessionId, message: '如果不是张力呢？', context: { currentPage: 'prediction', lineId: 'local' }, accessMode: 'READ_ONLY', clientRequestId: 'turn-two' });
  check('follow-up preserves conversation', response.body.session.messages.some(item => item.text.includes('分析 S5 后张力')));
  check('correction creates new candidate', response.body.session.task.hypotheses.some(item => item.text.includes('入口厚度')));
  check('old hypothesis is superseded', response.body.session.task.hypotheses.some(item => item.text === '入口侧张力' && item.status === 'SUPERSEDED'));
  check('constraint survives correction', response.body.session.constraints.includes('只分析，不修改正式参数或设备'));

  const duplicate = await request('POST', '/api/copilot/chat', { sessionId, message: '如果不是张力呢？', context: { currentPage: 'prediction', lineId: 'local' }, clientRequestId: 'turn-two' });
  check('duplicate request is idempotent', duplicate.body.run.duplicate === true);

  response = await request('POST', '/api/copilot/experience/publish', { sessionId, outcome: '完成资料核查，未修改正式参数。', confirmed: true });
  check('experience published', response.status === 201 && response.body.experience.sourceStatus === 'USER_CONFIRMED_OUTCOME');
  const experienceId = response.body.experience.id;
  response = await request('GET', '/api/copilot/experience/search?q=' + encodeURIComponent('入口侧张力异常以前怎么排查'));
  check('real dense experience retrieval', response.body.retrievalMode === 'DENSE_BGE' && response.body.items.some(item => item.id === experienceId));

  const otherMemory = createAiMemory({ state: createLocalState(dataDir) });
  let scoped = false;
  try { await otherMemory.get({ id: 'another-user' }, sessionId); } catch (error) { scoped = error.code === 'AI_SESSION_SCOPE'; }
  check('another user cannot read session', scoped);

  await stop(server); server = null;
  server = await start();
  response = await request('GET', '/api/copilot/session?id=' + sessionId);
  check('session restored after server restart', response.body.session.id === sessionId && response.body.session.messages.length >= 4);
  check('constraints restored after restart', response.body.session.constraints.includes('只分析，不修改正式参数或设备'));
  check('hypotheses restored after restart', response.body.session.task.hypotheses.length > 0);

  response = await request('POST', '/api/copilot/experience/supersede', { id: experienceId });
  check('experience can be superseded', response.body.experience.status === 'SUPERSEDED');
  response = await request('GET', '/api/copilot/experience/search?q=' + encodeURIComponent('入口侧张力异常以前怎么排查'));
  check('superseded experience is not recalled', !response.body.items.some(item => item.id === experienceId));
  console.log(JSON.stringify({ ok: true, sessionId, checks: results, dataDir }, null, 2));
} finally {
  if (server) await stop(server);
}
