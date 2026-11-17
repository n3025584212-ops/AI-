#!/usr/bin/env node
// QCDKR 只读 MCP 服务（stdio）。
// 只暴露三个查询：最近一次正式保存的预测、工艺资料检索、事件中心。
// 不提供写入/控制能力；所有请求走 QCDKR 现有 HTTP 接口与账号权限。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = (process.env.QCDKR_BASE_URL || 'http://127.0.0.1:5194').replace(/\/+$/, '');
const USERNAME = process.env.QCDKR_MCP_USERNAME || '';
const PASSWORD = process.env.QCDKR_MCP_PASSWORD || '';
let cookie = '';

async function login() {
  if (!USERNAME || !PASSWORD) throw new Error('缺少环境变量 QCDKR_MCP_USERNAME / QCDKR_MCP_PASSWORD。');
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(`QCDKR 登录失败：${data.message || data.error || response.status}`);
  const jars = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  cookie = (jars[0] || '').split(';')[0];
  if (!cookie) throw new Error('QCDKR 登录未返回会话 Cookie。');
}

async function api(path, options = {}, retried = false) {
  if (!cookie) await login();
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Cookie: cookie },
  });
  if (response.status === 401 && !retried) {
    cookie = '';
    await login();
    return api(path, options, true);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.message || data.error || `QCDKR 接口返回 ${response.status}`);
  return data;
}

const asText = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const asError = error => ({ isError: true, content: [{ type: 'text', text: `QCDKR 调用失败：${error.message}` }] });

const server = new McpServer({ name: 'qcdkr-mcp', version: '0.1.0' });

server.tool(
  'get_current_prediction',
  '读取 QCDKR 最近一次正式保存的 S5 轧制力预测（只读，不重新计算、不改参数）。',
  {
    caseId: z.string().optional().describe('可选：工况/案例 ID 或名称；省略时取最近保存的一条。'),
  },
  async ({ caseId }) => {
    try {
      const payload = await api('/api/cases');
      const cases = Array.isArray(payload) ? payload : payload.items || payload.cases || [];
      if (!cases.length) return asText({ available: false, reason: '工况库里还没有保存过正式预测。' });
      const ordered = [...cases].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      const item = caseId ? ordered.find(row => row.id === caseId || row.name === caseId) : ordered[0];
      if (!item) return asText({ available: false, reason: `未找到工况：${caseId}` });
      const prediction = item.prediction || {};
      return asText({
        available: prediction.value !== undefined,
        caseId: item.id,
        caseName: item.name,
        savedAt: item.createdAt,
        identityStatus: item.identity_status || null,
        prediction: {
          value: prediction.value,
          unit: prediction.unit || prediction.display_unit || 't',
          mode: prediction.mode || null,
          model: prediction.model || null,
          modelVersion: prediction.model_version || null,
          snapshotId: prediction.snapshot_id || null,
          inputHash: prediction.input_hash || null,
        },
        observation: item.observation ? {
          value: item.observation.value,
          source: item.observation.source || null,
          observationId: item.observation.observation_id || null,
          snapshotId: item.observation.snapshot_id || null,
        } : null,
        note: '这是最近一次正式保存的预测结果，不是重新计算；只读查询，不修改任何参数。',
      });
    } catch (error) {
      return asError(error);
    }
  },
);

server.tool(
  'search_knowledge',
  '在 QCDKR 工艺知识库中检索资料（只读），返回原文片段与出处。',
  {
    query: z.string().min(1).describe('检索问题或关键词。'),
    limit: z.number().int().min(1).max(8).optional().describe('返回条数，默认 4。'),
  },
  async ({ query, limit }) => {
    try {
      const data = await api(`/api/technician/knowledge?q=${encodeURIComponent(query)}&limit=${limit || 4}`);
      const references = (data.references || []).map(item => ({
        id: item.id || null,
        documentId: item.documentId || null,
        title: item.displayTitle || item.title || null,
        locator: item.locator || null,
        text: String(item.text || '').slice(0, 1200),
      }));
      return asText({ query: data.query, count: references.length, references });
    } catch (error) {
      return asError(error);
    }
  },
);

server.tool(
  'get_incidents',
  '读取 QCDKR 事件中心的未处理事件与最近恢复事件（只读）。',
  {},
  async () => {
    try {
      const data = await api('/api/copilot/incidents');
      const items = data.items || [];
      const active = items.filter(item => item.status === 'ACTIVE');
      const recovered = items.filter(item => item.status === 'RECOVERED');
      return asText({
        activeCount: active.length,
        recoveredCount: recovered.length,
        active: active.map(item => ({
          id: item.id,
          category: item.category,
          severity: item.severity,
          title: item.title,
          summary: item.summary,
          firstObservedAt: item.firstObservedAt,
          lastObservedAt: item.lastObservedAt,
          acknowledged: Boolean(item.acknowledgedAt),
        })),
        recovered: recovered.slice(0, 5).map(item => ({
          id: item.id,
          title: item.title,
          recoveredAt: item.recoveredAt,
        })),
        note: '只读；不会确认、关闭或修改事件。',
      });
    } catch (error) {
      return asError(error);
    }
  },
);

await server.connect(new StdioServerTransport());
console.error(`[qcdkr-mcp] ready base=${BASE}`);
