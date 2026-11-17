import assert from 'node:assert/strict';
import { createBlueprintAgent } from '../server/blueprint-agent.mjs';
import { retrieveKnowledge } from '../server/knowledge.mjs';

const files = new Map();
const state = {
  read: async (name, fallback) => files.has(name) ? structuredClone(files.get(name)) : structuredClone(fallback),
  write: async (name, value) => { files.set(name, structuredClone(value)); },
  mutate: async fn => fn(),
};
const llmCalls = [];
const llm = {
  status: async () => ({ available: true, providerStatus: 'READY' }),
  chat: async (messages, options = {}) => {
    llmCalls.push({ messages, options });
    if (options.format?.properties?.domain) {
      return { message: { content: JSON.stringify({ domain: 'DOMAIN_KNOWLEDGE', action: 'QUERY', scope: 'KNOWLEDGE', certainty: 'EXPLICIT', requiresTool: true, missing: [], subgoals: [] }) } };
    }
    if (options.tools) {
      const input = JSON.parse(messages.at(-1).content);
      return { message: { tool_calls: [
        { id: 'context', function: { name: 'runtime__get_context', arguments: JSON.stringify({ context_ref: input.context_ref }) } },
        { id: 'knowledge', function: { name: 'knowledge__search', arguments: JSON.stringify({ context_ref: input.context_ref, query: input.question, max_passages: 4 }) } },
      ] } };
    }
    return { message: { content: JSON.stringify({ answer: '后张力是入口侧带钢上的纵向张力。', used_reference_ids: ['R1'] }) } };
  },
};
const knowledgeDocs = [{ id: 'DOC-TENSION', title: '前张力与后张力', fileName: 'tension.md', chunks: [{ id: 'C1', heading: '后张力与前张力', locator: 'L1–L10', text: '后张力是入口侧带钢上的纵向张力。前张力是出口侧带钢上的纵向张力。' }] }];
const knowledge = async () => knowledgeDocs;
const maintenance = { getEvent: async () => null, log: async () => {}, recordInput: async () => {} };
const processAgent = { run: async input => ({ results: { knowledge: { references: retrieveKnowledge(knowledgeDocs, input.message, { limit: 4 }) } } }) };
const agent = await createBlueprintAgent({ state, processAgent, maintenance, llm, cases: async () => [], knowledge });
try {
  const actor = { id: 'test-user', role: 'LOCAL_ADMIN' };
  const created = await agent.create({ message: '后张力是什么？', context: { currentPage: 'data', lineId: 'local' }, access_mode: 'READ_ONLY' }, actor);
  assert.ok(created.runId, '通用自然语言入口必须创建 Run');
  const deadline = Date.now() + 5000;
  let run = created;
  while (!['completed', 'partial', 'failed'].includes(run.status) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 30));
    run = agent.get(created.runId, actor);
  }
  assert.equal(run.status, 'completed', JSON.stringify(run.error || run.routingError || run.reply));
  assert.equal(run.intent_source, 'llm');
  assert.equal(run.mode, 'local-llm');
  assert.ok(run.references.length > 0, '回答必须带真实检索引用');
  assert.ok(run.trace.some(step => step.tool === 'knowledge.search' && step.status === 'success'));
  assert.ok(run.reply.includes('入口侧'));
  console.log(JSON.stringify({ ok: true, runId: run.runId, status: run.status, intentSource: run.intent_source, llmCalls: llmCalls.length, tools: run.trace.map(step => step.tool), references: run.references.map(ref => ref.id), reply: run.reply }, null, 2));
} finally {
  await agent.close();
}
