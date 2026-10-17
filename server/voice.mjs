import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

export const MAX_VOICE_BYTES = 2 * 1024 * 1024;
export const MAX_VOICE_SECONDS = 25;
export const MAX_VOICE_TEXT_LENGTH = 120;
const ENGINE = 'windows-system-speech';
const LANGUAGE = 'zh-CN';
const DEFAULT_HELPER = fileURLToPath(new URL('../desktop/voice-engine.ps1', import.meta.url));
const EDGE_RUNNER = fileURLToPath(new URL('edge_tts_runner.py', import.meta.url));
const EDGE_VOICE = 'zh-CN-XiaoxiaoNeural';
const EDGE_RATE = '+8%';
const STATUS_CACHE_MS = 30_000;

export class VoiceError extends Error {
  constructor(status, message) { super(message); this.name = 'VoiceError'; this.status = status; }
}
function unpackedHelper(filename) {
  return filename.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}
function decodeWav(base64) {
  if (typeof base64 !== 'string' || !base64.length) throw new VoiceError(400, '请提交录音。');
  if (base64.length > Math.ceil(MAX_VOICE_BYTES / 3) * 4) throw new VoiceError(413, '录音文件最多 2 MiB。');
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new VoiceError(400, '录音格式无效。');
  const wav = Buffer.from(base64, 'base64');
  if (wav.toString('base64') !== base64 || wav.length < 44 || wav.length > MAX_VOICE_BYTES) throw new VoiceError(400, '录音格式无效。');
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE' || wav.readUInt32LE(4) + 8 !== wav.length) throw new VoiceError(400, '请使用 WAV 录音。');
  let format = null; let pcm = null; let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4); const start = offset + 8; const end = start + size;
    if (end > wav.length) throw new VoiceError(400, '录音文件不完整。');
    if (id === 'fmt ') {
      if (format || size < 16) throw new VoiceError(400, '录音格式无效。');
      format = { codec: wav.readUInt16LE(start), channels: wav.readUInt16LE(start + 2), rate: wav.readUInt32LE(start + 4), bytesPerSecond: wav.readUInt32LE(start + 8), alignment: wav.readUInt16LE(start + 12), bits: wav.readUInt16LE(start + 14) };
    }
    if (id === 'data') {
      if (pcm) throw new VoiceError(400, '录音格式无效。');
      pcm = wav.subarray(start, end);
    }
    offset = end + (size % 2);
  }
  if (offset !== wav.length || !format || !pcm?.length || pcm.length % 2 || format.codec !== 1 || format.channels !== 1 || format.rate !== 16000 || format.bits !== 16 || format.alignment !== 2 || format.bytesPerSecond !== 32000) throw new VoiceError(400, '请使用 16 kHz 单声道 PCM16 录音。');
  if (pcm.length > MAX_VOICE_SECONDS * 32000) throw new VoiceError(413, '每次录音最多 25 秒。');
  return { pcm, durationSeconds: pcm.length / 32000 };
}
function wavFromPcm(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Audio stays in memory. dataDir is accepted for the server interface; recordings
 * and assistant API settings are not read or written by this service.
 * runner/platform are backend-only test seams, never request parameters.
 */
export function createVoiceService({ dataDir, helperPath = DEFAULT_HELPER, runner, platform = process.platform, pythonCandidates = [] } = {}) {
  void dataDir;
  const children = new Set();
  let closed = false; let active = 0; let cachedStatus; let cachedAt = 0; let pendingStatus;
  const helper = unpackedHelper(path.resolve(helperPath));
  const edgePython = pythonCandidates.find(candidate => typeof candidate === 'string' && /[\\/]python(?:\.exe)?$/.test(candidate) && existsSync(candidate)) || null;

  async function nativeRun(request) {
    return new Promise((resolve, reject) => {
      const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
      children.add(child);
      let output = ''; let outputBytes = 0; let done = false;
      const finish = (error, value) => {
        if (done) return; done = true; clearTimeout(timer); children.delete(child);
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => { child.kill(); finish(new VoiceError(504, '语音处理超时，请重试。')); }, request.operation === 'status' ? 10_000 : 27_000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > 3 * 1024 * 1024) { child.kill(); finish(new VoiceError(502, '语音返回内容过大。')); return; }
        output += chunk;
      });
      child.stderr.resume();
      child.stdin.on('error', () => {});
      child.on('error', () => finish(new VoiceError(503, '本机语音组件暂不可用。')));
      child.on('close', code => {
        if (done) return;
        try {
          const result = JSON.parse(output.replace(/^\uFEFF/, '').trim());
          if (code !== 0 || result.ok !== true) {
            const allowed = { unavailable: [503, '本机未安装中文语音组件。'], no_speech: [422, '没有听清，请再说一次。'], too_long: [413, '每次语音最多 25 秒，请缩短内容。'], bad_request: [400, '语音内容格式无效。'] };
            const [status, message] = allowed[result.code] || [503, '本机语音处理失败，请重试。'];
            finish(new VoiceError(status, message)); return;
          }
          finish(null, result.data);
        } catch { finish(new VoiceError(503, '本机语音处理失败，请重试。')); }
      });
      child.stdin.end(JSON.stringify(request), 'utf8');
    });
  }
  async function run(request) {
    if (closed) throw new VoiceError(503, '语音服务已关闭。');
    if (active >= 2) throw new VoiceError(429, '语音正在处理中，请稍候。');
    active++;
    try { return await (runner || nativeRun)(request, { helperPath: helper }); }
    finally { active--; }
  }
  function unavailable(reason) {
    return { available: false, engine: ENGINE, language: LANGUAGE, recognitionAvailable: false, synthesisAvailable: false, reason };
  }
  async function status() {
    if (closed) return unavailable('语音服务已关闭。');
    if (platform !== 'win32') return unavailable('离线语音需要 Windows 中文语音组件。');
    if (cachedStatus && Date.now() - cachedAt < STATUS_CACHE_MS) return { ...cachedStatus };
    if (!pendingStatus) {
      pendingStatus = run({ operation: 'status' }).then(value => {
        const recognitionAvailable = value?.recognitionAvailable === true;
        const synthesisAvailable = value?.synthesisAvailable === true;
        cachedStatus = { available: recognitionAvailable && synthesisAvailable, engine: ENGINE, language: LANGUAGE, recognitionAvailable, synthesisAvailable };
        if (!recognitionAvailable || !synthesisAvailable) cachedStatus.reason = '本机中文语音组件不完整，请联系管理员。';
        cachedAt = Date.now();
        return cachedStatus;
      }).catch(() => {
        cachedStatus = unavailable('本机语音组件暂不可用，请重试。'); cachedAt = Date.now(); return cachedStatus;
      }).finally(() => { pendingStatus = null; });
    }
    return { ...await pendingStatus };
  }
  async function transcribe({ wavBase64 } = {}) {
    const { pcm, durationSeconds } = decodeWav(wavBase64);
    if (!(await status()).recognitionAvailable) throw new VoiceError(503, '本机中文语音识别不可用，请联系管理员。');
    const result = await run({ operation: 'transcribe', pcmBase64: pcm.toString('base64') });
    if (typeof result?.text !== 'string' || !result.text.trim()) throw new VoiceError(422, '没有听清，请再说一次。');
    const confidence = Number(result.confidence);
    return { text: result.text.trim().slice(0, 4000), confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0, language: LANGUAGE, engine: ENGINE, durationSeconds };
  }
  // Neural edge voice: bundled python + edge-tts, needs internet. Any failure
  // silently falls back to the offline SAPI engine below.
  function edgeSynthesize(speechText) {
    return new Promise((resolve, reject) => {
      if (!edgePython) { reject(new Error('edge python missing')); return; }
      const child = spawn(edgePython, ['-X', 'utf8', EDGE_RUNNER], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = ''; let done = false;
      const finish = (error, value) => { if (!done) { done = true; clearTimeout(timer); resolve(value); if (error) reject(error); } };
      const timer = setTimeout(() => { child.kill(); reject(new Error('edge timeout')); }, 12_000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.resume();
      child.stdin.on('error', () => {});
      child.on('error', error => finish(error));
      child.on('close', code => {
        if (done) return;
        try {
          const parsed = JSON.parse(output.trim());
          if (code === 0 && parsed.ok === true && typeof parsed.pcmBase64 === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(parsed.pcmBase64)) finish(null, parsed.pcmBase64);
          else finish(new Error('edge unavailable'));
        } catch { finish(new Error('edge bad output')); }
      });
      child.stdin.end(JSON.stringify({ text: speechText, voice: EDGE_VOICE, rate: EDGE_RATE }), 'utf8');
    });
  }
  async function synthesize({ text } = {}) {
    if (typeof text !== 'string' || !text.trim()) throw new VoiceError(400, '请输入要播报的内容。');
    if (text.length > MAX_VOICE_TEXT_LENGTH) throw new VoiceError(413, '每次播报最多 120 字，请缩短内容。');
    if (!(await status()).synthesisAvailable) throw new VoiceError(503, '本机中文语音播报不可用，请联系管理员。');
    const speechText = text.trim();
    if (!runner) {
      try {
        const pcm = Buffer.from(await edgeSynthesize(speechText), 'base64');
        if (pcm.length && pcm.length % 2 === 0 && pcm.length <= MAX_VOICE_SECONDS * 32000) {
          return { wavBase64: wavFromPcm(pcm).toString('base64'), mimeType: 'audio/wav', sampleRate: 16000, durationSeconds: pcm.length / 32000, voiceEngine: 'edge-neural' };
        }
      } catch { /* 断网/组件缺失 → 走离线引擎 */ }
    }
    const result = await run({ operation: 'synthesize', text: speechText });
    if (typeof result?.pcmBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(result.pcmBase64)) throw new VoiceError(502, '语音内容生成失败。');
    const pcm = Buffer.from(result.pcmBase64, 'base64');
    if (!pcm.length || pcm.length % 2 || pcm.length > MAX_VOICE_SECONDS * 32000) throw new VoiceError(413, '每次语音最多 25 秒，请缩短内容。');
    return { wavBase64: wavFromPcm(pcm).toString('base64'), mimeType: 'audio/wav', sampleRate: 16000, durationSeconds: pcm.length / 32000, voiceEngine: 'offline' };
  }
  function close() {
    closed = true; cachedStatus = null;
    for (const child of children) child.kill();
    children.clear();
  }
  return { status, transcribe, synthesize, close };
}
