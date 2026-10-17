import { spawn } from 'node:child_process';
import { readFile, access, mkdir, writeFile } from 'node:fs/promises';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FEATURE_KEYS, FEATURE_SCHEMA, validatePredictionInput, createInputSnapshot,
  restoreInputSnapshot, createObservation, normalizeEngineeringContext, PredictionContractError } from './prediction-contract.mjs';
import { predict as demoPredict, optimize as demoOptimize } from '../src/domain.js';
import { modelInputValues } from '../src/modelInputs.js';
import { formatEngineering, unitFor, sourceUnitFor } from '../src/engineeringUnits.js';
import { reportInputFingerprint, engineeringContextForRequest } from '../src/predictionSnapshot.js';
import { currentModelReferenceRanges } from '../src/inputRangeDefaults.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const finite = value => typeof value === 'number' && Number.isFinite(value);
const round = (value, digits = 4) => Number(value.toFixed(digits));

export class ModelError extends Error {
  constructor(message, code = 'MODEL_UNAVAILABLE', status = 503) {
    super(message); this.name = 'ModelError'; this.code = code; this.status = status;
  }
}

/** Exact 25-feature mapping. S5 observed force and target never enter the model. */
export function caseToModelValues(input) {
  const values = modelInputValues(input);
  const checked = validatePredictionInput(values);
  if (checked.status !== 'VERIFIED') throw new ModelError(checked.issues.map(x => `${x.field}：${x.message}`).join('；'), 'INVALID_INPUT', 400);
  return checked.values;
}

export function caseEngineeringContext(input) {
  if (input.engineering_context !== undefined) return normalizeEngineeringContext(input.engineering_context);
  const evidence = input.importProvenance;
  const value = evidence?.source_type === 'DEMO' ? null : input.stands?.find(stand => stand.id === 'S4')?.force;
  // Preserve an unverified raw value without claiming it is a sourced S4
  // measurement. Explicit context supplies confirmed units/source/time/quality.
  return normalizeEngineeringContext({ s4_rolling_force: { value: value ?? null } });
}

/** Raw case -> existing snapshot factory; no second snapshot identity system. */
export function createCaseInputSnapshot(input, metadata = {}) {
  const evidence = input.importProvenance;
  return createInputSnapshot(caseToModelValues(input), {
    sample_id: evidence?.sample_id || input.id || 'unidentified-sample',
    stream_id: evidence?.stream_id || 'model-service', input_version: evidence?.input_version ?? 0,
    source_type: evidence?.source_type || 'UNKNOWN', sample_timestamp: evidence?.sample_timestamp ?? null,
    ...metadata,
  }, { engineering_context: caseEngineeringContext(input) });
}

function caseObservation(input, snapshot) {
  const evidence = input.importProvenance;
  const value = evidence?.source_type === 'DEMO' || evidence?.observedAvailable === false ? null
    : evidence ? evidence.observed ?? null : input.stands?.find(stand => stand.id === 'S5')?.force ?? null;
  return createObservation(snapshot, { value, source: evidence?.observedSource || 'unknown',
    timestamp: evidence?.sample_timestamp ?? null });
}

async function exists(filename) { try { await access(filename); return true; } catch { return false; } }
function unpacked(filename) { return filename.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'); }

/** One persistent, bounded JSONL worker. No shell, no per-request process spawning. */
export class PythonModelWorker {
  constructor({ pythonPath, workerPath, modelPath, metadataPath, expectedSha256, startupTimeoutMs = 60000, timeoutMs = 30000 }) {
    this.options = { pythonPath, workerPath, modelPath, metadataPath, expectedSha256, startupTimeoutMs, timeoutMs };
    this.pending = new Map(); this.nextId = 0; this.closed = false; this.child = null; this.failure = null;
  }
  start() {
    if (this.starting) return this.starting;
    if (this.closed) return Promise.reject(new ModelError('模型进程已关闭。'));
    this.starting = new Promise((resolve, reject) => {
      const o = this.options;
      let settled = false, buffer = '', stderr = '';
      const finishError = error => {
        this.failure = error;
        if (!settled) { settled = true; clearTimeout(startTimer); reject(error); }
        for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
        this.pending.clear();
      };
      const startTimer = setTimeout(() => { finishError(new ModelError('模型加载超时。', 'MODEL_TIMEOUT', 504)); this.child?.kill(); }, o.startupTimeoutMs);
      try {
        this.child = spawn(o.pythonPath, ['-X', 'utf8', '-u', o.workerPath, '--model', o.modelPath,
          '--metadata', o.metadataPath, '--expected-sha256', o.expectedSha256], {
          shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1', OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' },
        });
      } catch { finishError(new ModelError('Python 运行环境启动失败。', 'PYTHON_UNAVAILABLE')); return; }
      this.child.on('error', () => finishError(new ModelError('Python 运行环境启动失败，请检查模型运行环境。', 'PYTHON_UNAVAILABLE')));
      this.child.stdin.on('error', () => finishError(new ModelError('模型进程连接中断。', 'MODEL_EXITED')));
      this.child.stderr.setEncoding('utf8');
      this.child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
      this.child.stdout.setEncoding('utf8');
      this.child.stdout.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > 2 * 1024 * 1024) { finishError(new ModelError('模型响应超过大小限制。', 'MODEL_PROTOCOL')); this.child.kill(); return; }
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
          if (!line) continue;
          let message;
          try { message = JSON.parse(line); } catch { finishError(new ModelError('模型响应格式无效。', 'MODEL_PROTOCOL')); this.child.kill(); return; }
          if (!settled && message.type === 'ready') {
            if (!message.model || typeof message.model !== 'object') { finishError(new ModelError('模型元数据无效。', 'MODEL_PROTOCOL')); this.child.kill(); return; }
            settled = true; clearTimeout(startTimer); this.metadata = message.model; resolve(message.model);
          } else if (message.type === 'error') {
            finishError(new ModelError(message.error?.message || '模型加载失败。', message.error?.code)); this.child.kill();
          } else {
            const item = this.pending.get(message.id);
            if (!item) continue;
            this.pending.delete(message.id); clearTimeout(item.timer);
            if (message.ok && Array.isArray(message.values) && message.values.length === item.count && message.values.every(finite)) item.resolve(message.values);
            else item.reject(new ModelError(message.error?.message || '模型预测响应无效。', message.error?.code || 'MODEL_PROTOCOL'));
          }
        }
      });
      this.child.on('exit', () => {
        finishError(this.failure || new ModelError('模型进程已退出，请重新启动应用。', 'MODEL_EXITED'));
        this.diagnostic = stderr;
      });
    });
    return this.starting;
  }
  async predictRows(rows) {
    await this.start();
    if (this.failure) throw this.failure;
    if (this.closed || !this.child || this.child.exitCode !== null) throw new ModelError('模型进程已关闭。');
    if (!Array.isArray(rows) || !rows.length || rows.length > 1024 || rows.some(row => validatePredictionInput(row).status !== 'VERIFIED')) throw new ModelError('模型输入须为 1–1024 行完整的 25 维数值。', 'INVALID_INPUT', 400);
    if (this.pending.size >= 24) throw new ModelError('模型正在处理其他工况，请稍后重试。', 'MODEL_BUSY', 429);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(new ModelError('模型预测超时。', 'MODEL_TIMEOUT', 504));
        this.failure = new ModelError('模型预测超时，请重新启动应用。', 'MODEL_TIMEOUT', 504); this.child.kill();
      }, this.options.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, count: rows.length });
      this.child.stdin.write(JSON.stringify({ id, action: 'predict', rows }) + '\n');
    });
  }
  close() {
    this.closed = true;
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new ModelError('模型进程已关闭。')); }
    this.pending.clear();
    this.child?.stdin.end(); this.child?.kill();
  }
}

export function createPredictionService({ dataDir = path.join(ROOT, 'data'), root = ROOT, modelBaseDir = path.join(root, 'models'), config, workerFactory = options => new PythonModelWorker(options) } = {}) {
  let initialization, worker, metadata, exampleCase, failure, configured = false, configuredMode = 'auto', closed = false;
  const cache = new Map();
  const predictions = new Map(), observations = new Map(), observationRevisions = new Map();
  let signingKey;
  async function key() {
    if (!signingKey) signingKey = (async () => {
      await mkdir(dataDir, { recursive: true });
      const filename = path.join(dataDir, 'snapshot-receipt-key');
      // Exclusive creation preserves historical receipts across server restarts.
      try { await writeFile(filename, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      const stored = await readFile(filename, 'utf8');
      if (!/^[a-f0-9]{64}$/.test(stored)) throw new ModelError('身份凭据不可用。', 'IDENTITY_KEY');
      return Buffer.from(stored, 'hex');
    })();
    return signingKey;
  }
  const unsigned = ({ receipt, ...record }) => record;
  async function sign(record) {
    const data = structuredClone(unsigned(record));
    return { ...data, receipt: createHmac('sha256', await key()).update(JSON.stringify(data)).digest('hex') };
  }
  async function authenticate(record) {
    if (!record || !/^[a-f0-9]{64}$/.test(record.receipt || '')) throw new ModelError('缺少可信身份记录，待验证。', 'UNVERIFIED_IDENTITY', 409);
    const expected = (await sign(record)).receipt;
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(record.receipt, 'hex'))) throw new ModelError('身份或计算记录已被修改。', 'IDENTITY_MISMATCH', 409);
    return structuredClone(record);
  }
  function checkInput(input, snapshot) {
    if (JSON.stringify(snapshot.values) !== JSON.stringify(caseToModelValues(input))
      || JSON.stringify(snapshot.engineering_context) !== JSON.stringify(caseEngineeringContext(input))) throw new ModelError('当前输入或工程上下文已编辑，请创建新快照。', 'SNAPSHOT_INPUT_MISMATCH', 400);
  }
  async function verifiedPrediction(record, input) {
    const verified = await authenticate(record);
    const snapshot = restoreInputSnapshot(verified.input_snapshot, { trustedRecord: true });
    if (verified.snapshot_id !== snapshot.snapshot_id || verified.input_hash !== snapshot.input_hash
      || verified.model_hash !== snapshot.model_hash || verified.model_version !== snapshot.model_version
      || !['formal', 'demo'].includes(verified.mode)
      || (verified.mode === 'demo' && (verified.model_hash !== null || verified.model_version !== 'demo-linear-v1'))) throw new ModelError('预测与快照身份不一致。', 'IDENTITY_MISMATCH', 409);
    if (input) {
      checkInput(input, snapshot);
      if (reportInputFingerprint(input) !== reportInputFingerprint(verified.inputContext)) throw new ModelError('重试须保留冻结输入；观测变化请使用 append-observation。', 'SNAPSHOT_INPUT_MISMATCH', 400);
    }
    predictions.set(snapshot.snapshot_id, verified);
    return verified;
  }
  async function remember(result, input, {retain=true}={}) {
    const observation = await sign(result.observation);
    if(retain)observations.set(observation.observation_id, observation);
    const bound = await sign({ ...result, observation, inputContext: structuredClone(input) });
    if(retain)predictions.set(bound.snapshot_id, bound);
    return bound;
  }
  async function retry(input, options, mode) {
    const saved = options.prediction || predictions.get(options.input_snapshot?.snapshot_id);
    const result = await verifiedPrediction(saved, input);
    const snapshot = restoreInputSnapshot(options.input_snapshot);
    if (JSON.stringify(snapshot) !== JSON.stringify(result.input_snapshot) || result.mode !== mode
      || (mode === 'formal' && (snapshot.model_hash !== metadata.model_hash || snapshot.model_version !== (metadata.model_version || metadata.version)))) throw new ModelError('重试快照或模型身份不一致。', 'IDENTITY_MISMATCH', 409);
    return result;
  }
  async function appendObservation({ input_snapshot, prediction, data, scope, revision } = {}) {
    const result = await verifiedPrediction(prediction || predictions.get(input_snapshot?.snapshot_id));
    if (JSON.stringify(restoreInputSnapshot(input_snapshot)) !== JSON.stringify(result.input_snapshot)) throw new ModelError('观测快照不一致。', 'IDENTITY_MISMATCH', 409);
    const sequenceKey = `${scope || 'local'}:${result.snapshot_id}`;
    if (!Number.isSafeInteger(revision) || revision < 0) throw new ModelError('观测请求版本无效。', 'INVALID_REVISION', 400);
    if (revision <= (observationRevisions.get(sequenceKey) ?? -1)) throw new ModelError('观测请求已过期。', 'STALE_OBSERVATION', 409);
    // No predict/cache/worker path: this append is independent of calculation.
    const observation = await sign(createObservation(result.input_snapshot, data));
    if (revision <= (observationRevisions.get(sequenceKey) ?? -1)) throw new ModelError('观测请求已过期。', 'STALE_OBSERVATION', 409);
    observationRevisions.set(sequenceKey, revision); observations.set(observation.observation_id, observation);
    return { snapshot_id: result.snapshot_id, input_hash: result.input_hash, observation, revision };
  }
  async function freezeContext(context = {}) {
    const source = structuredClone(context), input = source.caseData;
    if (!input) return source;
    let prediction;
    if (source.input_snapshot || source.prediction?.snapshot_id) {
      prediction = await verifiedPrediction(source.prediction, input);
      if (JSON.stringify(source.input_snapshot || prediction.input_snapshot) !== JSON.stringify(prediction.input_snapshot)) throw new ModelError('分析快照不一致。', 'IDENTITY_MISMATCH', 409);
    } else prediction = await predict(input, { mode: source.prediction?.mode || source.mode || 'auto' });
    const observation = source.observation ? await authenticate(source.observation) : prediction.observation;
    if (observation.snapshot_id !== prediction.snapshot_id || observation.input_hash !== prediction.input_hash) throw new ModelError('观测关联不一致。', 'IDENTITY_MISMATCH', 409);
    return { ...source, input_snapshot: prediction.input_snapshot, prediction, observation };
  }
  // Only explicit server dependency injection uses this adapter. No HTTP body
  // can supply its computed result; production computations use predict above.
  async function enclosePrediction(input, computed, options = {}) {
    if (options.input_snapshot) {
      const saved = await verifiedPrediction(options.prediction || predictions.get(options.input_snapshot.snapshot_id), input);
      if (JSON.stringify(options.input_snapshot) !== JSON.stringify(saved.input_snapshot) || computed.mode !== saved.mode || computed.model_hash !== saved.model_hash) throw new ModelError('模型身份不一致。', 'IDENTITY_MISMATCH', 409);
      return saved;
    }
    const snapshot = createCaseInputSnapshot(input, { model_hash: computed.mode === 'formal' ? computed.model_hash : null, model_version: computed.mode === 'formal' ? computed.model_version || 'injected-server-model' : 'demo-linear-v1' });
    return remember({ ...computed, snapshot_id:snapshot.snapshot_id, input_snapshot:snapshot, input_hash:snapshot.input_hash, model_hash:snapshot.model_hash, model_version:snapshot.model_version, observation:caseObservation(input,snapshot) },input);
  }
  async function initialize() {
    if (initialization) return initialization;
    initialization = (async () => {
      try {
        let setting = config, base = modelBaseDir;
        if (setting === undefined) {
          for (const filename of [path.join(dataDir, 'model-config.json'), path.join(modelBaseDir, 'model-config.json')]) {
            try { setting = JSON.parse(await readFile(filename, 'utf8')); base = path.dirname(filename); break; }
            catch (error) { if (error.code !== 'ENOENT') throw new ModelError('模型配置文件无效。', 'MODEL_CONFIG'); }
          }
        }
        if (setting === undefined) return;
        configured = true;
        if (!setting || typeof setting !== 'object' || Array.isArray(setting) || !['auto', 'formal', 'demo'].includes(setting.mode ?? 'auto')) throw new ModelError('模型配置文件无效。', 'MODEL_CONFIG');
        configuredMode = setting.mode ?? 'auto';
        if (configuredMode === 'demo') return;
        for (const key of ['modelPath', 'metadataPath', 'expectedSha256']) if (typeof setting[key] !== 'string' || !setting[key]) throw new ModelError('模型配置缺少冻结模型路径、元数据或 SHA-256。', 'MODEL_CONFIG');
        if (!/^[a-f0-9]{64}$/i.test(setting.expectedSha256)) throw new ModelError('模型 SHA-256 配置无效。', 'MODEL_CONFIG');
        const resolve = filename => path.resolve(base, filename);
        let pythonPath = process.env.DKQKAR_PYTHON || setting.pythonPath;
        if (pythonPath && /[\\/]/.test(pythonPath)) pythonPath = resolve(pythonPath);
        if (!pythonPath) for (const filename of [path.join(modelBaseDir, '..', 'model-runtime', 'python.exe'), path.join(root, '.venv-model', 'Scripts', 'python.exe'), path.join(root, '.venv-model', 'bin', 'python')]) if (await exists(filename)) { pythonPath = filename; break; }
        worker = workerFactory({ pythonPath: pythonPath || 'python', workerPath: unpacked(path.join(root, 'server', 'model_runtime.py')),
          modelPath: resolve(setting.modelPath), metadataPath: resolve(setting.metadataPath), expectedSha256: setting.expectedSha256.toLowerCase(), startupTimeoutMs: 60000, timeoutMs: 30000 });
        if (closed) { worker.close(); return; }
        metadata = await worker.start();
        if (metadata.model_hash !== setting.expectedSha256.toLowerCase()) throw new ModelError('模型身份校验未通过。', 'MODEL_HASH');
        if (typeof setting.examplePath === 'string') {
          try { const sample = JSON.parse(await readFile(resolve(setting.examplePath), 'utf8')); caseToModelValues(sample); exampleCase = sample; }
          catch { exampleCase = null; }
        }
      } catch (error) { failure = error instanceof ModelError ? error : new ModelError('模型加载失败，请检查运行环境和模型文件。'); worker?.close(); }
    })();
    return initialization;
  }
  async function status() {
    await initialize();
    const error = failure || worker?.failure;
    const available = Boolean(metadata && !error && !closed);
    return { available, status: available ? 'READY' : 'BLOCKED', mode: available ? 'formal' : 'demo', model: 'DK-QKAR-V5S2',
      model_hash: available ? metadata.model_hash : null, model_version: available ? (metadata.model_version || metadata.version) : null,
      schema_status: available ? 'VERIFIED' : 'DEFINITION_ONLY', reason: available ? '已加载训练模型。' : error?.message || '尚未配置训练完成的冻结模型。',
      demo_available: true, demo_mode: 'demo', configured, training_samples: metadata?.training_samples ?? null,
      unit: unitFor('force'), display_unit: unitFor('force'),
      validation: metadata ? { ...Object.fromEntries(['method', 'test_samples', 'groups', 'rmse', 'mae', 'r2', 'absolute_error_p95'].map(key => [key, metadata.validation?.[key] ?? null])), unit: unitFor('force') } : null,
      feature_ranges: available ? structuredClone(metadata.feature_ranges || {}) : null,
      feature_schema: FEATURE_SCHEMA.map(feature => ({ ...feature, unit: sourceUnitFor(feature.key), display_unit: unitFor(feature.key), unit_status: 'confirmed',
        unit_source: 'user-confirmed-source-units', reference_range: available ? currentModelReferenceRanges()[feature.key] || null : null })),
      source: metadata ? Object.fromEntries(['dataset_url', 'dataset_revision', 'rows_in_source', 'selection'].map(key => [key, (key === 'dataset_revision' ? metadata.source?.revision : metadata.source?.[key]) ?? null])) : null,
      exampleCase: available ? exampleCase ?? null : null };
  }
  async function selectMode(requested = 'auto') {
    if (!['auto', 'demo', 'formal'].includes(requested)) throw new ModelError('计算模式无效。', 'INVALID_MODE', 400);
    await initialize();
    if (requested === 'demo' || (requested === 'auto' && configuredMode === 'demo')) return 'demo';
    if (failure || worker?.failure) throw failure || worker.failure;
    if (metadata && !closed) return 'formal';
    if (requested === 'formal' || configured) throw new ModelError('正式预测尚未就绪：需配置训练完成的冻结模型。');
    return 'demo';
  }
  function range(index) {
    const value = metadata?.feature_ranges?.[FEATURE_KEYS[index]];
    const pair = Array.isArray(value) ? value : value && [value.min, value.max];
    return pair?.length === 2 && pair.every(finite) && pair[1] >= pair[0] ? pair : null;
  }
  function warnings(values) {
    const referenceRanges=currentModelReferenceRanges();
    return values.flatMap((value, index) => {
      const limits = referenceRanges[FEATURE_KEYS[index]];
      return limits && (value < limits[0] || value > limits[1]) ? [`${FEATURE_SCHEMA[index].label}超出当前默认参考范围 ${formatEngineering(FEATURE_KEYS[index], limits[0])}–${formatEngineering(FEATURE_KEYS[index], limits[1])}`] : [];
    });
  }
  async function formalPrediction(input, options = {}) {
    let snapshot, observation;
    try {
      snapshot = options.input_snapshot === undefined
        ? createCaseInputSnapshot(input, { model_hash: metadata.model_hash, model_version: metadata.model_version || metadata.version })
        : restoreInputSnapshot(options.input_snapshot);
      if (JSON.stringify(snapshot.values) !== JSON.stringify(caseToModelValues(input))
        || JSON.stringify(snapshot.engineering_context) !== JSON.stringify(caseEngineeringContext(input))) {
        throw new ModelError('当前输入或工程上下文已编辑，请创建新快照。', 'SNAPSHOT_INPUT_MISMATCH', 400);
      }
      observation = caseObservation(input, snapshot);
    } catch (error) {
      if (error instanceof PredictionContractError) throw new ModelError(error.message, 'INVALID_INPUT', 400);
      throw error;
    }
    const values = snapshot.values, key = JSON.stringify(values);
    let computed = cache.get(key);
    if (!computed) {
      const rows = [values], steps = [];
      for (let index = 0; index < 25; index++) {
        const limits = range(index), step = limits ? (limits[1] - limits[0]) * 0.05 : Math.max(Math.abs(values[index]) * 0.01, 0.001);
        const lower = [...values], upper = [...values];
        lower[index] -= step; upper[index] += step;
        if (limits && values[index] >= limits[0] && values[index] <= limits[1]) { lower[index] = Math.max(lower[index], limits[0]); upper[index] = Math.min(upper[index], limits[1]); }
        rows.push(lower, upper); steps.push({ lower: lower[index], upper: upper[index], delta: step });
      }
      const output = await worker.predictRows(rows), raw = output[0];
      const responses = steps.map((step, index) => ({ ...step, down: output[1 + index * 2] - raw, up: output[2 + index * 2] - raw }));
      const maximum = Math.max(...responses.map(x => Math.max(Math.abs(x.down), Math.abs(x.up))));
      const drivers = responses.map((response, index) => ({ name: FEATURE_SCHEMA[index].label, feature: FEATURE_KEYS[index], stand: FEATURE_SCHEMA[index].stand_id || '全线',
        value: maximum > 0 ? round(Math.max(Math.abs(response.down), Math.abs(response.up)) / maximum * 100, 2) : 0,
        contribution: round(Math.abs(response.up) >= Math.abs(response.down) ? response.up : response.down),
        direction: response.up >= response.down ? 'positive' : 'negative', response: { ...response } })).sort((a, b) => b.value - a.value);
      computed = { value: round(raw, 6), drivers }; cache.set(key, computed);
      if (cache.size > 64) cache.delete(cache.keys().next().value);
    }
    const rangeWarnings = warnings(values), value = computed.value, target = finite(input.target) ? input.target : null;
    return remember({ ...structuredClone(computed), snapshot_id: snapshot.snapshot_id, input_snapshot: snapshot,
      observation, target, deviation: target !== null && target !== 0 ? round((value - target) / target * 100, 2) : null, confidence: null,
      interval: [], intervalLabel: '未校准预测区间', sensitivityLabel: '模型参数响应', sensitivityMethod: '训练范围 5% 双向扰动，最大响应归一为 100',
      curve: input.stands.map(stand => ({ stand: stand.id, actual: stand.force, predicted: stand.id === 'S5' ? value : null })),
      ood: rangeWarnings.length > 0, rangeWarnings, mode: 'formal', unit: 't', display_unit: 't', model: 'DK-QKAR-V5S2',
      model_hash: metadata.model_hash, model_version: metadata.model_version || metadata.version,
      input_hash: snapshot.input_hash,
      explanation: `QCDKR 模型计算的 S5 轧制力为 ${formatEngineering('force', value, 3)}，目标 ${formatEngineering('force', input.target, 3)}。${rangeWarnings.length ? rangeWarnings.join('；') + '。' : ''}参数响应来自同一模型的逐项扰动计算。` }, input);
  }
  async function predict(input, options = {}) {
    const mode = await selectMode(options.mode);
    const kind = options.kind || (options.input_snapshot ? 'retry' : 'new');
    if (!['new', 'retry'].includes(kind) || (kind === 'new' && options.input_snapshot) || (kind === 'retry' && !options.input_snapshot)) throw new ModelError('须明确 new 或 retry 请求。', 'INVALID_REQUEST_KIND', 400);
    if (kind === 'retry') return retry(input, options, mode);
    if (mode === 'formal') {
      if(options.committed_snapshot){
        const committed=await authenticate(options.committed_snapshot);
        const snapshot=restoreInputSnapshot(committed.input_snapshot,{trustedRecord:true});
        checkInput(input,snapshot);
        if(reportInputFingerprint(input)!==reportInputFingerprint(committed.inputContext)
          ||snapshot.model_hash!==metadata.model_hash||snapshot.model_version!==(metadata.model_version||metadata.version))
          throw new ModelError('已提交工况或模型身份已变化。','IDENTITY_MISMATCH',409);
        return formalPrediction(input,{input_snapshot:snapshot});
      }
      return formalPrediction(input);
    }
    const snapshot = createCaseInputSnapshot(input, { model_hash: null, model_version: 'demo-linear-v1' });
    return remember({ ...demoPredict(input), snapshot_id: snapshot.snapshot_id, input_snapshot: snapshot,
      input_hash: snapshot.input_hash, model_hash: null, model_version: 'demo-linear-v1', observation: caseObservation(input, snapshot) }, input);
  }
  async function optimize(input, options = {}) {
    if (await selectMode(options.mode) === 'demo') return demoOptimize(input);
    if (!finite(input?.target) || input.target <= 0) throw new ModelError('请填写大于零的目标轧制力。', 'INVALID_TARGET', 400);
    const baseline = await predict(input, { ...options, mode: 'formal' }), error = Math.abs(input.target - baseline.value);
    if (baseline.ood || error < 0.02) return [];
    const strategies = [
      { id: 'tension-focus', title: '末机架张力微调', controls: [['S5', 'tension', 0.12]], description: '调整 S5 后张力，变化不超过 12%。' },
      { id: 'stand-balance', title: '后段机架协同', controls: [['S4', 'tension', 0.10], ['S5', 'tension', 0.10]], description: '调整 S4、S5 后张力，变化不超过 10%。' },
      { id: 'speed-tension', title: '速度与张力联动', controls: [['S5', 'tension', 0.08], ['S5', 'speed', 0.08]], description: '调整 S5 后张力和速度，变化不超过 8%。' },
    ];
    const candidates = [];
    for (const strategy of strategies) {
      const walk = (at, changes) => {
        if (at === strategy.controls.length) {
          if (!changes.length) return;
          const next = structuredClone(input);
          changes.forEach(change => { next.stands.find(s => s.id === change.stand)[change.field] = change.after; });
          const values = caseToModelValues(next);
          if (!warnings(values).length) candidates.push({ strategy, changes, values });
          return;
        }
        const [stand, field, fraction] = strategy.controls[at], before = input.stands.find(s => s.id === stand)[field];
        for (const direction of [-1, -0.5, 0, 0.5, 1]) {
          const after = round(before * (1 + fraction * direction));
          walk(at + 1, after === before ? changes : [...changes, { stand, field, before, after }]);
        }
      };
      walk(0, []);
    }
    if (!candidates.length) return [];
    const outputs = await worker.predictRows(candidates.map(x => x.values));
    const best = new Map();
    candidates.forEach((candidate, index) => {
      const distance = Math.abs(input.target - outputs[index]);
      if (distance >= error - 1e-6 || distance >= (best.get(candidate.strategy.id)?.distance ?? Infinity)) return;
      best.set(candidate.strategy.id, { distance, ...candidate, value: outputs[index] });
    });
    return Promise.all([...best.values()].map(async item => {
      const targetInput = structuredClone(input);
      item.changes.forEach(change => { targetInput.stands.find(stand => stand.id === change.stand)[change.field] = change.after; });
      const targetSnapshot = createCaseInputSnapshot(targetInput, { model_hash: metadata.model_hash, model_version: metadata.model_version || metadata.version });
      return { id: item.strategy.id, title: item.strategy.title, description: item.strategy.description,
      changes: item.changes, predictedValue: round(item.value, 6), baselineValue: baseline.value, improvement: round((error - item.distance) / error * 100, 2),
      risk: '模型复算', mode: 'formal', model_hash: metadata.model_hash, model_version: metadata.model_version || metadata.version,
      baseline_snapshot_id: baseline.snapshot_id, target_snapshot_id: targetSnapshot.snapshot_id, parent_snapshot_id: baseline.snapshot_id, input_snapshot: targetSnapshot, readOnly: true };
    }));
  }
  // Candidate search uses the existing frozen worker's safe batch transport.
  // Every row is freshly computed; the current-prediction cache is not consulted.
  // Cancellation is owned by the search scheduler, never by this shared worker.
  async function predictCandidateBatch(inputs) {
    if (await selectMode('formal') !== 'formal') throw new ModelError('智能搜索需要正式模型。');
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 48) throw new ModelError('候选批次无效。','INVALID_INPUT',400);
    const prepared = inputs.map(source => {
      const input = structuredClone(source);
      for (const name of ['observation','observed','observedAvailable','observedSource','measured','isMeasured']) delete input[name];
      const s5 = input.stands.find(stand => stand.id === 'S5');
      s5.force = null;
      for (const name of ['observation','observed','actual','measured','isMeasured','observedSource','observedAvailable']) delete s5[name];
      input.engineering_context = engineeringContextForRequest(input);
      input.importProvenance = {source_type:'HYPOTHETICAL_DRAFT',sourceName:'工况草案',sample_timestamp:null,
        observed:null,observedAvailable:false,observedSource:'草案尚无实际观测'};
      return input;
    });
    const output = await worker.predictRows(prepared.map(caseToModelValues));
    if (output.length !== prepared.length || output.some(value => !finite(value))) throw new ModelError('候选预测输出无效。','MODEL_OUTPUT_INVALID');
    return Promise.all(prepared.map((input,index) => {
      const snapshot = createCaseInputSnapshot(input,{model_hash:metadata.model_hash,model_version:metadata.model_version || metadata.version});
      return remember({value:round(output[index],6),drivers:[],snapshot_id:snapshot.snapshot_id,input_snapshot:snapshot,input_hash:snapshot.input_hash,
        observation:caseObservation(input,snapshot),target:input.target,mode:'formal',unit:'t',display_unit:'t',model:'DK-QKAR-V5S2',
        model_hash:metadata.model_hash,model_version:metadata.model_version || metadata.version,
        interval:[],intervalLabel:'未校准预测区间',sensitivityLabel:'未计算参数响应',rangeWarnings:warnings(snapshot.values)},input,{retain:false});
    }));
  }
  async function prepareCommittedInput(input){
    await selectMode('formal');
    const input_snapshot=createCaseInputSnapshot(input,{model_hash:metadata.model_hash,model_version:metadata.model_version||metadata.version});
    return sign({input_snapshot,inputContext:structuredClone(input)});
  }
  return { status, predict, optimize, predictCandidateBatch, prepareCommittedInput, appendObservation, verifiedPrediction, freezeContext, enclosePrediction, close() { closed = true; worker?.close(); cache.clear(); } };
}
