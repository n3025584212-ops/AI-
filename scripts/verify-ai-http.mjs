import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'tmp', 'test-data', 'ai-http-' + Date.now());
const server = await startServer({ port: 5401, dataDir, distDir: path.join(root, 'dist-3d'), requireLogin: false });
const base = 'http://127.0.0.1:5401';
const post = async (route, body) => {
  const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
try {
  const status = await fetch(base + '/api/assistant/status').then(response => response.json());
  assert.equal(status.available, false);
  assert.equal(status.inferenceTest, 'NOT_RUN');
  const created = await post('/api/agent/runs', { message: '后张力是什么？', context: { currentPage: 'data', lineId: 'local' }, access_mode: 'READ_ONLY' });
  assert.equal(created.status, 202, JSON.stringify(created.body));
  const deadline = Date.now() + 10000;
  let run = created.body;
  while (!['completed', 'partial', 'failed'].includes(run.status) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 80));
    run = await fetch(base + '/api/agent/runs/' + run.runId).then(response => response.json());
  }
  assert.equal(run.status, 'completed', JSON.stringify(run.error || run.reply));
  assert.equal(run.mode, 'local-tools');
  assert.equal(run.intent_source, 'rules-fallback');
  assert.ok(run.references.length > 0);
  assert.ok(run.reply.includes('后张力'));
  assert.ok(run.trace.some(step => step.tool === 'knowledge.search' && step.status === 'success'));
  const copilot = await post('/api/copilot/chat', { message: '后张力是什么？', context: { currentPage: 'data', lineId: 'local' }, accessMode: 'READ_ONLY', clientRequestId: 'offline-copilot' });
  assert.equal(copilot.status, 200, JSON.stringify(copilot.body));
  assert.equal(copilot.body.run.responseSource, 'DETERMINISTIC_FALLBACK');
  assert.ok(copilot.body.run.references.length > 0);
  assert.ok(copilot.body.session.messages.some(message => message.role === 'assistant' && message.responseSource === 'DETERMINISTIC_FALLBACK'));
  const incidents = await post('/api/copilot/incidents', {});
  const aiIncident = incidents.body.incidents.find(item => item.category === 'AI_SERVICE' && item.status === 'ACTIVE');
  assert.ok(aiIncident, 'missing cloud AI configuration must produce one shared incident');
  const reconciledAgain = await post('/api/copilot/incidents', {});
  const sameIncident = reconciledAgain.body.incidents.find(item => item.id === aiIncident.id);
  assert.ok(sameIncident && sameIncident.occurrences >= 2, 'reconciliation must update instead of duplicate');
  assert.ok(incidents.body.heartbeat?.at);
  console.log(JSON.stringify({ ok: true, cloud: { available: status.available, reason: status.reason, inferenceTest: status.inferenceTest }, run: { status: run.status, mode: run.mode, intentSource: run.intent_source, tools: run.trace.map(step => step.tool), references: run.references.map(ref => ref.id) }, copilot: { responseSource: copilot.body.run.responseSource, sessionId: copilot.body.session.id, references: copilot.body.run.references.map(ref => ref.id) } }, null, 2));
} finally {
  await new Promise(resolve => server.close(resolve));
}
