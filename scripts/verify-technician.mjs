import { createTechnician } from '../server/technician.mjs';

const files = new Map();
const state = {
  async read(name, fallback) { return files.has(name) ? JSON.parse(files.get(name)) : structuredClone(fallback); },
  async write(name, value) { files.set(name, JSON.stringify(value)); },
  async mutate(fn) { return fn(); },
};
const docs = [{ id: 'doc-1', title: '冷连轧张力操作手册', fileName: 'tension.md', kind: 'md', sha256: 'x', createdAt: new Date().toISOString(),
  chunks: [{ id: 'c1', heading: '后张力调整', locator: '第2章', text: '后张力升高会降低轧制力并改善板形，但过高会增加断带风险。调整后张力应结合轧制速度与弯辊力共同确认，单次调整幅度不宜过大。' },
    { id: 'c2', heading: '断带征兆', locator: '第5章', text: '断带前常见征兆包括张力波动增大、轧制力突降、板形恶化。出现征兆时应先降速再检查来料与辊系。' }] }];
const events = { items: [{ id: 'E-1', severity: 'HIGH', title: 'S5 后张力波动超限', createdAt: new Date().toISOString() }], total: 1 };
const technician = createTechnician({
  state,
  llm: { status: async () => ({ available: false }), chat: async () => ({ message: { content: '{}' } }) },
  knowledge: async () => docs,
  maintenance: { events: async () => events },
  cases: async () => [],
  modelStatus: async () => ({ available: true }),
  agentRuns: () => [],
});
const context = { caseData: { width: 1200, entrySetThickness: 2.5, stands: [{ id: 'S5', tension: 180.5, speed: 320, bendingForce: 45 }] }, dataSource: '本地工况库' };
const out = [];
const check = (name, ok, detail) => { out.push({ name, ok, detail }); if (!ok) process.exitCode = 1; };

const status = await technician.status();
check('status.duties=6', status.duties.length === 6, status.duties.length);
check('status.modes=4', status.modes.length === 4, status.modes.length);
check('status.permissions L0-L3', ['L0', 'L1', 'L2', 'L3'].every(level => status.permissions[level]), Object.keys(status.permissions));

const knowledgeReply = await technician.chat({ message: '后张力过高有什么风险？', context });
check('knowledge duty', knowledgeReply.duty === 'knowledge', knowledgeReply.duty);
check('knowledge evidence', knowledgeReply.evidence.length > 0, knowledgeReply.evidence.map(item => item.id));
check('knowledge summary has citation', /\[R\d+\]/.test(knowledgeReply.summary), knowledgeReply.summary.slice(0, 120));
check('knowledge contract fields', ['type', 'summary', 'evidence', 'confidence', 'actions', 'blocked_actions', 'next_steps'].every(key => key in knowledgeReply), Object.keys(knowledgeReply));

const diagnosis = await technician.chat({ message: 'S5 后张力波动是什么原因？', context });
check('diagnose duty', diagnosis.duty === 'diagnose', diagnosis.duty);
check('diagnose boundary text', /(不能认定|候选|证据边界)/.test(diagnosis.summary), diagnosis.summary.slice(0, 160));
check('diagnose confidence low', diagnosis.confidence === 'LOW', diagnosis.confidence);

const act = await technician.chat({ message: '打开运行日志并下发设备指令', context });
check('act duty', act.duty === 'act', act.duty);
check('L3 blocked, not executable', act.blocked_actions.length >= 1 && act.blocked_actions.every(item => item.risk_level === 'L3' && item.executable === false), act.blocked_actions);
check('L1 action present', act.actions.every(item => item.risk_level !== 'L3'), act.actions);

const watch = await technician.watch();
check('watch has event card', watch.cards.some(card => card.id === 'E-1'), watch.cards.map(card => card.id));

const handover = await technician.handover({ note: '夜班交接' });
check('handover text', /交接班摘要/.test(handover.text) && handover.sections.issues !== undefined, handover.text.slice(0, 80));

const remembered = await technician.remember({ text: 'S5 后张力基准 180 kN', status: 'CONFIRMED', source: 'SOP' });
check('memory fact written', remembered.status === 'CONFIRMED', remembered);
const memory = await technician.memory();
check('memory persisted fact', memory.facts.some(fact => fact.text.includes('180 kN')), memory.facts.length);
check('kpi turns counted', memory.stats.turns >= 3, memory.stats.turns);

for (const row of out) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name} ${JSON.stringify(row.detail)}`);
console.log(JSON.stringify({ passed: out.filter(row => row.ok).length, total: out.length }));
