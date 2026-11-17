import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'tmp', 'test-results'); await mkdir(output, { recursive: true });
const dataDir = path.join(root, 'tmp', 'test-data', 'copilot-ui-' + Date.now());
const username = 'copilot-ui', password = randomBytes(24).toString('base64url');
let turn = 0;
const llm = { status: async () => ({ available: true, providerStatus: 'READY' }), chat: async (messages, options = {}) => {
  if (options.tools) {
    const input = JSON.parse(messages.at(-1).content), tool = options.tools.find(item => item.function.description.startsWith('检索已收录资料'));
    return { message: { tool_calls: [{ id: 'lookup-' + turn, function: { name: tool.function.name, arguments: JSON.stringify({ query: input.question }) } }] } };
  }
  turn++;
  const corrected = messages.some(message => message.content?.includes('如果不是张力'));
  return { message: { content: JSON.stringify({ answer: corrected ? '保留当前 S5 对象，改为验证新的候选原因；正式参数不变。' : '先核对当前工况与入口侧张力，再进行历史对比 [R1]。', used_reference_ids: corrected ? [] : ['R1'], used_experience_ids: [], hypothesis_updates: [{ text: corrected ? '其他候选原因' : '入口侧张力', status: 'CANDIDATE' }] }) } };
} };
const port = 5403, base = `http://127.0.0.1:${port}`, debugPort = 9450;
const server = await startServer({ port, dataDir, distDir: process.env.COPILOT_DIST_DIR || path.join(root, '..', '..', 'ai-audit-20261111', 'dist-copilot-test'), localLlm: llm });
const result = { checks: [], consoleErrors: [], screenshot: path.join(output, 'copilot-ui.png') };
const check = (name, passed, detail) => { result.checks.push({ name, passed: Boolean(passed), detail }); console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`); };
let ws;
try {
  const account = await fetch(base + '/api/auth/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, passwordConfirmation: password }) });
  assert.equal(account.status, 200);
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(base + '/?boot=0')}`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0; const pending = new Map();
  ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const item = pending.get(message.id); pending.delete(message.id); message.error ? item.reject(message.error) : item.resolve(message.result); } if (message.method === 'Runtime.exceptionThrown') result.consoleErrors.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text); };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const callId = ++id; pending.set(callId, { resolve, reject }); ws.send(JSON.stringify({ id: callId, method, params })); });
  const evaluate = async expression => { const value = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }); if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text); return value.result?.value; };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (expression, timeout = 20000) => { const end = Date.now() + timeout; while (Date.now() < end) { const value = await evaluate(expression); if (value) return value; await wait(150); } return evaluate(expression); };
  const setInput = async (selector, value, textarea = false) => evaluate(`(() => {const node=document.querySelector(${JSON.stringify(selector)});if(!node)return false;const setter=Object.getOwnPropertyDescriptor(${textarea ? 'HTMLTextAreaElement' : 'HTMLInputElement'}.prototype,'value').set;setter.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: base + '/?boot=0' });
  await until(`!!document.querySelector('.login-card') && !document.querySelector('.login-submit')?.disabled`);
  await setInput('[aria-label="用户名"]', username); await setInput('[aria-label="密码"]', password);
  await evaluate(`document.querySelector('.login-card').requestSubmit()`);
  check('authenticated dashboard', await until(`!!document.querySelector('.topbar-copilot')`, 35000));
  await evaluate(`document.querySelector('.topbar-copilot')?.getAttribute('aria-pressed')!=='true'&&document.querySelector('.topbar-copilot')?.click()`);
  check('continuous panel is default', await until(`!!document.querySelector('.ccp-panel') && !document.querySelector('#assistant-floating-window')?.hidden && document.querySelector('.ccp-panel').getBoundingClientRect().width>0`));
  await evaluate(`document.querySelector('[aria-label="打开全软件监控"]')?.click()`);
  check('whole-software monitor visible', await until(`document.querySelector('.ccp-drawer')?.textContent.includes('全软件监控') && document.querySelector('.ccp-drawer-sub')?.textContent.length > 0`, 15000), await evaluate(`document.querySelector('.ccp-drawer')?.innerText`));
  await evaluate(`document.querySelector('.ccp-drawer-backdrop')?.click()`);
  await setInput('[aria-label="向 DK AI 提问"]', '分析 S5 后张力，只分析不要改正式参数', true);
  await evaluate(`document.querySelector('[aria-label="发送问题"]').click()`);
  check('first answer and real tool receipt', await until(`!!document.querySelector('.ccp-message.is-assistant') && !!document.querySelector('.ccp-receipts')`, 25000));
  await setInput('[aria-label="向 DK AI 提问"]', '如果不是张力呢？', true);
  await evaluate(`document.querySelector('[aria-label="发送问题"]').click()`);
  check('follow-up and constraint visible', await until(`document.querySelectorAll('.ccp-message.is-assistant').length >= 2 && document.querySelector('.ccp-constraints')?.textContent.includes('不修改正式参数')`, 25000));
  check('hypotheses are visible', await until(`document.querySelector('.ccp-hypotheses')?.textContent.includes('候选')`));

  await send('Page.reload', { ignoreCache: true });
  await until(`!!document.querySelector('.topbar-copilot')`, 35000);
  await evaluate(`document.querySelector('.topbar-copilot')?.getAttribute('aria-pressed')!=='true'&&document.querySelector('.topbar-copilot')?.click()`);
  check('conversation restored after full page reload', await until(`document.querySelectorAll('.ccp-message.is-assistant').length >= 2 && document.querySelector('.ccp-constraints')?.textContent.includes('不修改正式参数')`, 25000));

  await evaluate(`document.querySelector('.ccp-publish').open=true`);
  await setInput('[aria-label="经验实际结果"]', '已完成资料核查，未修改正式参数。', true);
  await evaluate(`[...document.querySelectorAll('.ccp-publish button')].find(button=>button.textContent.includes('确认结果')).click()`);
  check('experience published from UI', await until(`document.querySelector('.ccp-publish small')?.textContent.includes('已保存')`));
  await evaluate(`document.querySelector('.ccp-legacy').click()`);
  check('legacy tools remain accessible', await until(`!!document.querySelector('.assistant-mode-switch')`));
  await evaluate(`[...document.querySelectorAll('.assistant-context-line button')].find(button=>button.textContent==='连续分析')?.click()`);
  check('continuous panel can be restored', await until(`!!document.querySelector('.ccp-panel') && !document.querySelector('#assistant-floating-window')?.hidden && document.querySelector('.ccp-panel').getBoundingClientRect().width>0`));
  const shot = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(result.screenshot, Buffer.from(shot.data, 'base64'));
  result.session = await evaluate(`fetch('/api/copilot/session').then(response=>response.json()).then(data=>({id:data.session.id,messages:data.session.messages.length,constraints:data.session.constraints,hypotheses:data.session.task.hypotheses}))`);
  await writeFile(path.join(output, 'copilot-ui-results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  result.error = { message: error.message, stack: error.stack };
  try { const shot = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(output, 'copilot-ui-error.png'), Buffer.from(shot.data, 'base64')); } catch {}
  await writeFile(path.join(output, 'copilot-ui-results.json'), JSON.stringify(result, null, 2));
  console.error(error); process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}
