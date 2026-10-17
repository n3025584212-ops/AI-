const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const ENDPOINT = 'http://127.0.0.1:11434'
const MODEL = 'qwen3.5:4b'
let ownedProcess = null
let pendingStart = null

async function probe(timeoutMs = 1500) {
  try {
    const response = await fetch(`${ENDPOINT}/api/version`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) return null
    const version = await response.json()
    if (typeof version.version !== 'string') return null
    const tagResponse = await fetch(`${ENDPOINT}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!tagResponse.ok) return null
    const tags = await tagResponse.json()
    const model = tags.models?.find(item => item.name === MODEL)
    const runningResponse = await fetch(`${ENDPOINT}/api/ps`, { signal: AbortSignal.timeout(timeoutMs) })
    const running = runningResponse.ok ? (await runningResponse.json()).models?.find(item => item.name === MODEL) : null
    const device = { selection: 'auto', kind: running ? (running.size_vram > 0 ? 'gpu' : 'cpu') : 'auto', loaded: Boolean(running), vramBytes: running?.size_vram ?? 0, sizeBytes: running?.size ?? 0 }
    return { online: true, endpoint: ENDPOINT, runtimeVersion: version.version, model: MODEL, modelAvailable: Boolean(model), modelDigest: model?.digest ?? null, device }
  } catch { return null }
}

async function startLocalLlm({ resourcesPath, appPath, isPackaged, logDirectory, dataRoot: configuredRoot } = {}) {
  const existing = await probe()
  if (existing) return { ...existing, reused: true, owned: Boolean(ownedProcess) }
  const candidates = [
    configuredRoot || process.env.DKQKAR_LOCAL_LLM_ROOT,
    isPackaged && resourcesPath && path.join(resourcesPath, 'local-llm'),
    appPath && path.join(appPath, 'data', 'local-llm'),
    resourcesPath && path.join(resourcesPath, 'local-llm'),
  ].filter(Boolean)
  const dataRoot = candidates.find(root => fs.existsSync(path.join(root, 'runtime', 'ollama.exe')) && fs.existsSync(path.join(root, 'models')))
  if (!dataRoot) return { online: false, model: MODEL, endpoint: ENDPOINT, reason: 'local_runtime_missing' }
  const executable = path.join(dataRoot, 'runtime', 'ollama.exe')
  const logs = logDirectory || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'DKQKAR Studio', 'local-llm')
  try {
    fs.mkdirSync(logs, { recursive: true })
    const output = fs.openSync(path.join(logs, 'ollama-service.log'), 'a')
    try {
      if (!ownedProcess || ownedProcess.exitCode !== null) ownedProcess = spawn(executable, ['serve'], {
        cwd: path.dirname(executable), windowsHide: true, detached: false,
        stdio: ['ignore', output, output],
        env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_MODELS: path.join(dataRoot, 'models'), OLLAMA_NO_CLOUD: '1', OLLAMA_NUM_PARALLEL: '1', OLLAMA_MAX_LOADED_MODELS: '1', OLLAMA_MAX_QUEUE: '4', OLLAMA_CONTEXT_LENGTH: '4096', OLLAMA_KEEP_ALIVE: '1h' },
      })
    } finally { fs.closeSync(output) }
    const child = ownedProcess
    let launchError = null
    child.on('error', error => { launchError = error.message; if (ownedProcess === child) ownedProcess = null })
    child.on('exit', () => { if (ownedProcess === child) ownedProcess = null })
    child.unref()
    const deadline = Date.now() + 60000
    while (Date.now() < deadline && !launchError && child.exitCode === null) {
      const status = await probe(500)
      if (status) return { ...status, reused: false, owned: true, cloudEnabled: false, dataRoot }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    // GPU discovery can outlast a probe deadline. Keep the owned launch so a
    // later connection check can reuse it; do not start another service or kill it.
    return { online: false, endpoint: ENDPOINT, model: MODEL, reason: launchError ? 'local_runtime_launch_failed' : 'local_runtime_not_ready' }
  } catch {
    return { online: false, endpoint: ENDPOINT, model: MODEL, reason: 'local_runtime_launch_failed' }
  }
}

function ensureLocalLlm(options = {}) {
  if (!pendingStart) pendingStart = startLocalLlm(options).finally(() => { pendingStart = null })
  return pendingStart
}

// Fire-and-forget model pre-load: pays the one-time cold start (tens of
// seconds on CPU) while the user is still on the login screen, so the first
// question gets a warm reply. Never throws.
async function warmupLocalLlm({ timeoutMs = 180000 } = {}) {
  try {
    const response = await fetch(`${ENDPOINT}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: '只返回 READY' }], stream: false, think: false, keep_alive: '1h', options: { num_ctx: 4096, num_predict: 8, temperature: 0 } }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return false
    const result = await response.json()
    return result.model === MODEL && result.done === true && typeof result.message?.content === 'string' && result.message.content.trim().length > 0 && result.eval_count > 0
  } catch { return false }
}

function stopOwned() {
  if (!ownedProcess) return false
  const child = ownedProcess
  ownedProcess = null
  if (process.platform === 'win32' && child.pid && child.exitCode === null) {
    // Include inference runners spawned by this owned service, avoiding orphan memory.
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 3000, stdio: 'ignore' })
  } else { child.kill() }
  return true
}

module.exports = { ensureLocalLlm, stopOwned, warmupLocalLlm }

