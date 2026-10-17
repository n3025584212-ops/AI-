import { spawn, spawnSync } from 'node:child_process';
import { mkdir, access, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const url = 'http://127.0.0.1:5188';
const exists = async filename => access(filename).then(() => true, () => false);

async function health() {
  try { const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1200) }); if (!response.ok) return 'occupied'; let value; try { value = await response.json(); } catch { return 'occupied'; } return value.ok && value.app === 'dkqkar-studio' ? 'ready' : 'occupied'; }
  catch (error) { return error.name === 'TimeoutError' ? 'occupied' : 'absent'; }
}
function npm(args) {
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], { cwd: root, stdio: 'inherit', windowsHide: true })
    : spawnSync('npm', args, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`npm ${args.join(' ')} 执行失败，请检查 Node.js/npm 和网络连接。`);
}
function openBrowser() {
  if (process.argv.includes('--no-open')) return;
  const executable = process.platform === 'win32' ? 'powershell.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', `Start-Process '${url}'`] : [url];
  const child = spawn(executable, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => console.log(`请在浏览器中打开 ${url}`)); child.unref();
}

try {
  await mkdir(dataDir, { recursive: true });
  const current = await health();
  if (current === 'occupied') throw new Error('5188 端口已被其他服务占用，请关闭该服务后重试。');
  if (current === 'ready') { console.log(`复用已运行的 AI大模型与量子机器学习协同驱动的冷轧轧制力预测云平台：${url}`); openBrowser(); }
  else {
    if (!(await exists(path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite')))) npm(['install', '--no-audit', '--no-fund']);
    if (!(await exists(path.join(root, 'dist', 'index.html')))) npm(['run', 'build']);
    const output = await open(path.join(dataDir, 'server.log'), 'a');
    const errors = await open(path.join(dataDir, 'server-error.log'), 'a');
    const child = spawn(process.execPath, [path.join(root, 'server', 'index.mjs')], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', output.fd, errors.fd], env: { ...process.env, PORT: '5188' } });
    let spawnError;
    child.on('error', error => { spawnError = error; }); child.unref();
    await Promise.all([output.close(), errors.close()]);
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (spawnError) throw spawnError;
      if ((await health()) === 'ready') { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error('启动等待超时，请查看 data/server-error.log。');
    console.log(`AI大模型与量子机器学习协同驱动的冷轧轧制力预测云平台 已启动：${url}`); openBrowser();
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
