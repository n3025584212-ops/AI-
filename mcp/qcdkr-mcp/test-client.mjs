#!/usr/bin/env node
// 端到端自测：以 MCP 客户端身份启动 server.mjs，真实调用三个工具。
// 用法（Git Bash）：
//   QCDKR_MCP_USERNAME=rollcraft QCDKR_MCP_PASSWORD='...' node test-client.mjs
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const serverPath = fileURLToPath(new URL('./server.mjs', import.meta.url));
const username = process.env.QCDKR_MCP_USERNAME || '';
const password = process.env.QCDKR_MCP_PASSWORD || '';
if (!username || !password) {
  console.error('缺少 QCDKR_MCP_USERNAME / QCDKR_MCP_PASSWORD。');
  process.exit(2);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env, QCDKR_MCP_USERNAME: username, QCDKR_MCP_PASSWORD: password },
  stderr: 'inherit',
});
const client = new Client({ name: 'qcdkr-mcp-test', version: '0.1.0' });
await client.connect(transport);

const parse = result => {
  const text = (result.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
  return { isError: Boolean(result.isError), value: text ? JSON.parse(text) : null };
};
const calls = [];
const run = async (name, args) => {
  const result = await client.callTool({ name, arguments: args || {} });
  const parsed = parse(result);
  calls.push({ name, isError: parsed.isError, value: parsed.value });
  return parsed;
};

const tools = await client.listTools();
const names = tools.tools.map(item => item.name).sort();
if (names.join(',') !== 'get_current_prediction,get_incidents,search_knowledge') {
  console.error('工具列表不符合预期：', names);
  process.exit(1);
}

const prediction = await run('get_current_prediction', {});
const knowledge = await run('search_knowledge', { query: 'S5 轧制力偏差', limit: 2 });
const incidents = await run('get_incidents', {});

const checks = [
  ['prediction returns saved case', prediction.value?.available === true && Number.isFinite(prediction.value?.prediction?.value)],
  ['prediction has snapshot id', Boolean(prediction.value?.prediction?.snapshotId)],
  ['knowledge returns references', (knowledge.value?.references || []).length > 0],
  ['incidents readable', Number.isInteger(incidents.value?.activeCount)],
];

console.log(JSON.stringify({
  tools: names,
  checks: checks.map(([name, pass]) => ({ name, pass: Boolean(pass) })),
  predSample: prediction.value?.prediction,
  knowledgeTitles: (knowledge.value?.references || []).map(item => item.title),
  activeIncidents: incidents.value?.activeCount,
}, null, 2));

await client.close();
if (checks.some(([, pass]) => !pass)) process.exit(1);
console.log('MCP E2E PASS');
