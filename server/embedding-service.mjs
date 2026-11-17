import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as ort from 'onnxruntime-web';
import { StateError } from './local-state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MODEL_DIR = path.join(ROOT, 'models', 'embeddings', 'bge-small-zh-v1.5');
const MODEL_SHA256 = '15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc';
const MAX_TOKENS = 128;
const QUERY_PREFIX = '为这个句子生成表示以用于检索相关文章：';

// BGE is a separate local embedding model. It is not the conversational LLM and
// is never used to decide task state, permissions, execution or factual validity.
export function createEmbeddingService({ modelDir = DEFAULT_MODEL_DIR } = {}) {
  let sessionPromise, tokenizerPromise, lastError = null;
  const tensor = values => new ort.Tensor('int64', BigInt64Array.from(values, BigInt), [1, values.length]);
  async function tokenizer() {
    tokenizerPromise ||= readFile(path.join(modelDir, 'tokenizer.json'), 'utf8').then(text => {
      const data = JSON.parse(text), vocab = data?.model?.vocab;
      if (!vocab || typeof vocab !== 'object') throw new Error('Tokenizer vocabulary is missing');
      return { vocab, unknown: vocab['[UNK]'] ?? 100, cls: vocab['[CLS]'] ?? 101, sep: vocab['[SEP]'] ?? 102 };
    });
    return tokenizerPromise;
  }
  function wordPiece(word, vocab, unknown) {
    const output = [];
    let rest = word;
    while (rest.length) {
      let end = Math.min(rest.length, 48), found = null;
      for (; end > 0; end--) {
        const candidate = (output.length ? '##' : '') + rest.slice(0, end);
        if (Object.hasOwn(vocab, candidate)) { found = candidate; break; }
      }
      if (!found) return [unknown];
      output.push(vocab[found]); rest = rest.slice(end);
    }
    return output;
  }
  function encode(text, vocab, special) {
    const normalized = String(text || '').normalize('NFKC').toLowerCase().replace(/[\u0000-\u001f\u007f]/g, ' ');
    const basic = normalized.match(/[\p{Script=Han}]|[a-z0-9]+|[^\s\p{Script=Han}a-z0-9]/gu) || [];
    const ids = [special.cls];
    for (const token of basic) for (const id of wordPiece(token, vocab, special.unknown)) if (ids.length < MAX_TOKENS - 1) ids.push(id);
    ids.push(special.sep);
    while (ids.length < MAX_TOKENS) ids.push(0);
    return ids;
  }
  async function load() {
    if (sessionPromise) return sessionPromise;
    sessionPromise = (async () => {
      const filename = path.join(modelDir, 'model_quantized.onnx'), bytes = await readFile(filename);
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== MODEL_SHA256) throw new StateError('本地 Embedding 模型指纹不一致。', 503, 'EMBEDDING_MODEL_HASH');
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = pathToFileURL(path.join(ROOT, 'node_modules', 'onnxruntime-web', 'dist') + path.sep).href;
      return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    })().catch(error => { lastError = error; sessionPromise = null; throw error; });
    return sessionPromise;
  }
  async function embed(texts, { query = false } = {}) {
    const values = (Array.isArray(texts) ? texts : [texts]).slice(0, 32).map(value => String(value ?? '').slice(0, 4000));
    if (!values.length) return [];
    const [session, vocab] = await Promise.all([load(), tokenizer()]);
    const results = [];
    // Small bounded batches keep CPU and memory predictable on the target server.
    for (const text of values) {
      const ids = encode(query ? QUERY_PREFIX + text : text, vocab.vocab, vocab);
      const mask = ids.map(id => id ? 1 : 0), types = ids.map(() => 0);
      const inputs = { input_ids: tensor(ids), attention_mask: tensor(mask) };
      if (session.inputNames.includes('token_type_ids')) inputs.token_type_ids = tensor(types);
      const output = await session.run(inputs), hidden = output.last_hidden_state || output[session.outputNames[0]];
      if (!hidden?.data || hidden.dims?.length !== 3) throw new StateError('Embedding 模型输出格式无效。', 503, 'EMBEDDING_OUTPUT');
      const [, length, dimension] = hidden.dims, vector = new Array(dimension).fill(0);
      for (let token = 0; token < length; token++) if (mask[token]) for (let d = 0; d < dimension; d++) vector[d] += hidden.data[token * dimension + d];
      const count = mask.reduce((sum, value) => sum + value, 0) || 1;
      for (let d = 0; d < dimension; d++) vector[d] /= count;
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
      results.push(vector.map(value => value / norm));
    }
    return results;
  }
  return {
    embed,
    status: async () => {
      try { await load(); return { available: true, model: 'BAAI/bge-small-zh-v1.5', quantized: true, dimensions: 512, local: true, error: null }; }
      catch (error) { return { available: false, model: 'BAAI/bge-small-zh-v1.5', local: true, error: error.message, cause: lastError?.message }; }
    },
    close: async () => { if (sessionPromise) try { (await sessionPromise)?.release?.(); } catch {} sessionPromise = null; },
  };
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0, left = 0, right = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; left += a[i] ** 2; right += b[i] ** 2; }
  return dot / (Math.sqrt(left) * Math.sqrt(right) || 1);
}
