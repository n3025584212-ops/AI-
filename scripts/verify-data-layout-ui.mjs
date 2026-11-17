import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'tmp', 'test-results'); await mkdir(output, { recursive: true });
const dataDir = path.join(root, 'tmp', 'test-data', 'data-layout-' + Date.now());
const username = 'layout-ui', password = randomBytes(24).toString('base64url');
const port = 5405, base = `http://127.0.0.1:${port}`, debugPort = Number(process.env.LAYOUT_CDP_PORT || 9451);
const server = await startServer({ port, dataDir, distDir: process.env.LAYOUT_DIST_DIR || path.join(root, '..', '..', 'ai-audit-20261111', 'dist-layout-test'), localLlm: { status: async () => ({ available: false }), chat: async () => { throw new Error('offline'); } } });
const result = { checks: [], consoleErrors: [], screenshots: {} };
const check = (name, passed, detail) => { result.checks.push({ name, passed: Boolean(passed), detail }); console.log(`${passed ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(detail ?? null).slice(0, 1200)}`); };
let ws;
try {
  const account = await fetch(base + '/api/auth/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, passwordConfirmation: password }) });
  assert.equal(account.status, 200);
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(base + '/?boot=0')}`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let sequence = 0; const pending = new Map();
  ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const item = pending.get(message.id); pending.delete(message.id); message.error ? item.reject(message.error) : item.resolve(message.result); } if (message.method === 'Runtime.exceptionThrown') result.consoleErrors.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text); };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const value = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }); if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text); return value.result?.value; };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (expression, timeout = 30000) => { const end = Date.now() + timeout; while (Date.now() < end) { const value = await evaluate(expression); if (value) return value; await wait(160); } return evaluate(expression); };
  const screenshot = async name => { const shot = await send('Page.captureScreenshot', { format: 'png' }); const file = path.join(output, name); await writeFile(file, Buffer.from(shot.data, 'base64')); result.screenshots[name] = file; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 960, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: base + '/?boot=0' });
  await until(`!!document.querySelector('.login-card') && !document.querySelector('.login-submit')?.disabled`);
  await evaluate(`(() => {const set=(selector,value)=>{const node=document.querySelector(selector);const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));};set('[aria-label="用户名"]',${JSON.stringify(username)});set('[aria-label="密码"]',${JSON.stringify(password)});document.querySelector('.login-card').requestSubmit();return true;})()`);
  await until(`!!document.querySelector('.data-workspace')`, 35000);
  await until(`!!document.querySelector('.data-col-left')`);
  const layout = await evaluate(`(() => {const rect=s=>{const r=document.querySelector(s)?.getBoundingClientRect();return r?{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}:null};const style=s=>{const n=document.querySelector(s);if(!n)return null;const x=getComputedStyle(n);return {visibility:x.visibility,opacity:x.opacity,display:x.display}};return {left:rect('.data-col-left'),right:rect('.data-col-right'),canvas:rect('.twin-canvas'),stage:rect('.twin-stage-3d'),rightStyle:style('.data-col-right'),trend:style('.s5-trend'),comparison:style('.dc-comparisons'),station:style('.station-strip'),stationRect:rect('.station-strip'),hud:style('.holo-hud'),toggle:!!document.querySelector('[aria-controls="data-params-panel"]'),insightButtons:[...document.querySelectorAll('.data-insight-tabs button')].map(button=>button.textContent)};})()`);
  check('left rail is focused and narrow', layout.left?.width <= 300, layout.left);
  check('right parameter rail is hidden by default', layout.rightStyle?.visibility === 'hidden' && layout.rightStyle?.opacity === '0', layout.rightStyle);
  check('analysis panels are collapsed but available', layout.trend?.display === 'none' && layout.comparison?.display === 'none' && layout.station?.display === 'flex', { trend: layout.trend, comparison: layout.comparison, station: layout.station });
  check('station strip is fully visible', layout.stationRect?.y >= 0 && layout.stationRect?.y + layout.stationRect?.height <= 960, layout.stationRect);
  check('3D stage gets the remaining width', layout.canvas?.width >= 1400, { canvas: layout.canvas, stage: layout.stage });
  check('parameter and insight toggles exist', layout.toggle && layout.insightButtons.length === 2, { parameter: layout.toggle, insight: layout.insightButtons });
  check('full 3D scene finishes loading', await until(`document.querySelector('.three-viewer')?.dataset.phase === 'ready'`, 45000));
  await wait(900);
  const cameraFit = await evaluate(`(() => {const n=document.querySelector('.three-viewer'),h=document.querySelector('.three-host');return {fitDistance:Number(h?.dataset.fitDistance||n?.dataset.fitDistance),cameraLevel:h?.dataset.cameraLevel||n?.dataset.cameraLevel,view:n?.dataset.presentationMode,camera:h?.dataset.camera||null};})()`);
  check('data page camera uses rolling-line framing', cameraFit.fitDistance > 0 && cameraFit.fitDistance <= 90, cameraFit);
  await screenshot('data-focus-default.png');
  await evaluate(`[...document.querySelectorAll('.data-insight-tabs button')].find(button=>button.textContent.includes('趋势')).click()`);
  check('trend panel restores on demand', await until(`(() => {const n=document.querySelector('.s5-trend');if(!n)return false;const s=getComputedStyle(n),r=n.getBoundingClientRect();return s.display!=='none'&&r.height>150;})()`));
  await screenshot('data-focus-trend.png');
  await evaluate(`[...document.querySelectorAll('.data-insight-tabs button')].find(button=>button.textContent.includes('对比')).click()`);
  check('comparison panel restores on demand', await until(`(() => {const n=document.querySelector('.dc-comparisons');if(!n)return false;const s=getComputedStyle(n),r=n.getBoundingClientRect();return s.display!=='none'&&r.height>150;})()`));
  await screenshot('data-focus-comparison.png');
  await evaluate(`[...document.querySelectorAll('.data-insight-tabs button')].find(button=>button.textContent.includes('对比')).click()`);
  check('insight panels can be collapsed again', await until(`getComputedStyle(document.querySelector('.dc-comparisons')).display==='none'`));
  await evaluate(`document.querySelector('[aria-controls="data-params-panel"]').click()`);
  const opened = await until(`(() => {const n=document.querySelector('.data-col-right');if(!n)return false;const x=getComputedStyle(n),r=n.getBoundingClientRect();return x.visibility==='visible'&&x.opacity==='1'&&r.width>=390;})()`);
  check('parameter drawer opens on demand', opened, await evaluate(`document.querySelector('.data-col-right')?.getBoundingClientRect().toJSON()`));
  await screenshot('data-focus-params.png');
  await evaluate(`document.querySelector('.data-params-close').click()`);
  check('parameter drawer closes again', await until(`getComputedStyle(document.querySelector('.data-col-right')).visibility==='hidden'`));
  assert.equal(result.consoleErrors.length, 0, result.consoleErrors.join('\n'));
  await writeFile(path.join(output, 'data-layout-results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ok: true, checks: result.checks, screenshots: result.screenshots, consoleErrors: result.consoleErrors }, null, 2));
} catch (error) {
  result.error = { message: error.message, stack: error.stack };
  try { const shot = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(output, 'data-layout-error.png'), Buffer.from(shot.data, 'base64')); } catch {}
  await writeFile(path.join(output, 'data-layout-results.json'), JSON.stringify(result, null, 2));
  console.error(error); process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}
