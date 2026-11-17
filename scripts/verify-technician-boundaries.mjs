import assert from 'node:assert/strict';
import { createTechnician } from '../server/technician.mjs';
import { technicianActionAvailability } from '../src/technicianActions.js';

const state = { read: async (_name, fallback) => structuredClone(fallback), write: async () => {}, mutate: async fn => fn() };
const technician = createTechnician({ state, llm: { status: async () => ({ available: false }), chat: async () => ({}) }, knowledge: async () => [], maintenance: { events: async () => ({ items: [] }) }, cases: async () => [] });
const context = { caseData: { width: 926, entrySetThickness: 3, stands: [{ id: 'S1', force: 713 }, { id: 'S5', tension: 7.783, bendingForce: 61.43 }] } };
const reply = await technician.chat({ message: '打开运行日志并重连设备', context });
assert.ok(reply.summary.includes('S5 后张力：7.783 t'), reply.summary);
assert.ok(reply.summary.includes('S1 轧制力：713 t'), reply.summary);
assert.ok(!reply.summary.includes('7.783 kN') && !reply.summary.includes('713 kN'), reply.summary);
assert.equal(technicianActionAvailability({ tool: 'device.reconnect', risk_level: 'L2' }).executable, false);
assert.equal(technicianActionAvailability({ tool: 'acquisition.restart', risk_level: 'L2' }).executable, false);
assert.equal(technicianActionAvailability({ tool: 'ui.switch_page', risk_level: 'L1' }).executable, true);
assert.equal(technicianActionAvailability({ tool: 'device.command', risk_level: 'L3' }).executable, false);
console.log(JSON.stringify({ ok: true, unitSummary: reply.summary, actions: reply.actions.map(action => ({ tool: action.tool, executable: technicianActionAvailability(action).executable })) }, null, 2));
