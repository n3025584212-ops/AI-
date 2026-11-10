import { startServer } from '../server/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await startServer({ port: 5299, dataDir: path.join(root, '.runtime-data/technician-test'),
  distDir: path.join(root, 'dist-3d'), requireLogin: false, accessMode: 'development' });
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, url, payload) => {
  const response = await fetch(base + url, { method, headers: payload ? { 'Content-Type': 'application/json' } : {},
    body: payload ? JSON.stringify(payload) : undefined });
  return { status: response.status, body: await response.json() };
};
let passed = 0, total = 0;
const check = (name, ok, detail) => { total++; if (ok) passed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail).slice(0, 300)}`); };

try {
  const status = await call('GET', '/api/technician/status');
  check('status 200', status.status === 200, status.status);
  check('status duties', status.body.duties?.length === 6, status.body.duties?.length);
  check('status kpis', Boolean(status.body.kpis), status.body.kpis);

  const reply = await call('POST', '/api/technician/chat', { message: '后张力过高有什么风险？', context: { caseData: { stands: [{ id: 'S5', tension: 180.5, speed: 320 }] } } });
  check('chat 200', reply.status === 200, reply.status);
  check('chat contract', ['type', 'duty', 'summary', 'evidence', 'confidence', 'actions', 'blocked_actions', 'next_steps'].every(key => key in (reply.body || {})), Object.keys(reply.body || {}));
  check('chat grounded', reply.body?.evidence?.length > 0 || reply.body?.confidence === 'LOW', { evidence: reply.body?.evidence?.length, confidence: reply.body?.confidence });

  const watch = await call('GET', '/api/technician/watch');
  check('watch 200', watch.status === 200 && Array.isArray(watch.body.cards), watch.body.cards?.length);

  const handover = await call('POST', '/api/technician/handover', { note: 'HTTP 验证' });
  check('handover 200', handover.status === 200 && /交接班摘要/.test(handover.body.text || ''), handover.status);

  const memory = await call('POST', '/api/technician/memory', { action: 'remember', text: 'S5 后张力上限 220 kN', status: 'PENDING', source: 'TEST' });
  check('memory write', memory.status === 200 && memory.body.fact?.status === 'PENDING', memory.status);
  const memoryRead = await call('GET', '/api/technician/memory');
  check('memory read', memoryRead.body.memory?.facts?.some(fact => fact.text.includes('220 kN')), memoryRead.body.memory?.facts?.length);

  const knowledge = await call('GET', '/api/technician/knowledge?q=' + encodeURIComponent('后张力 断带'));
  check('knowledge 200', knowledge.status === 200 && Array.isArray(knowledge.body.references), knowledge.body.references?.length);
} finally {
  await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify({ passed, total }));
