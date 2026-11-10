import { StateError } from './local-state.mjs';

// OpenAI-compatible cloud provider. ModelScope exposes the same
// /v1/chat/completions shape as OpenAI; `enable_thinking` is a Qwen extension
// accepted by ModelScope and ignored by other OpenAI-compatible servers.
export const CLOUD_LLM_DEFAULTS = Object.freeze({
  provider: 'modelscope',
  model: 'Qwen/Qwen3.5-35B-A3B',
  endpoint: 'https://api-inference.modelscope.cn/v1',
  apiKey: '',
});

const MAX_OUTPUT_TOKENS = 2048;
const STATUS_CACHE_MS = 15000;

function envConfig(provider) {
  const result = {};
  if (process.env.DKQKAR_LLM_MODEL) result.model = process.env.DKQKAR_LLM_MODEL.trim();
  if (process.env.DKQKAR_LLM_ENDPOINT) result.endpoint = process.env.DKQKAR_LLM_ENDPOINT.trim();
  const key = process.env.DKQKAR_LLM_API_KEY
    || (provider === 'modelscope' ? process.env.MODELSCOPE_API_KEY : '')
    || '';
  if (key.trim()) result.apiKey = key.trim();
  return result;
}

function outputBudget(maxTokens) {
  return Number.isFinite(maxTokens) ? Math.min(MAX_OUTPUT_TOKENS, Math.max(64, Math.trunc(maxTokens))) : 384;
}

function normalizeContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(part => part?.type === 'text' ? part.text || '' : '').join('');
  return '';
}

function normalizeToolCalls(calls) {
  return (calls || []).map((call, index) => ({
    id: call.id || `call_${index}`,
    type: call.type || 'function',
    function: {
      name: call.function?.name || '',
      arguments: typeof call.function?.arguments === 'string'
        ? call.function.arguments
        : JSON.stringify(call.function?.arguments || {}),
    },
  }));
}

function withJsonInstruction(messages, format) {
  if (!format) return messages;
  const schema = typeof format === 'string' ? format : JSON.stringify(format);
  const instruction = `只输出合法 JSON 对象，不要输出 Markdown 或解释。JSON Schema：${schema}`;
  const systemAt = messages.findIndex(message => message.role === 'system');
  if (systemAt >= 0) {
    return messages.map((message, index) => index === systemAt
      ? { ...message, content: `${message.content}\n\n${instruction}` }
      : message);
  }
  return [{ role: 'system', content: instruction }, ...messages];
}

function requestError(error, signal) {
  if (signal?.aborted) return signal.reason || error;
  if (error instanceof StateError) return error;
  const timeout = error.name === 'TimeoutError';
  return Object.assign(new StateError(
    timeout ? '云端 AI 回答超时，请重试。' : '云端 AI 暂不可用。',
    503,
    timeout ? 'LOCAL_LLM_TIMEOUT' : 'LOCAL_LLM_OFFLINE',
  ), { cause: error });
}

export function createCloudLlm({ settings = async () => ({}), fetchImpl = fetch, timeoutMs = 180000 } = {}) {
  let cached = null;
  let cachedKey = '';
  let cachedAt = 0;
  let pending = null;

  async function configuration() {
    const stored = await settings();
    const storedCloud = stored.localLlm || {};
    const provider = String(
      process.env.DKQKAR_LLM_PROVIDER || storedCloud.provider || CLOUD_LLM_DEFAULTS.provider,
    ).trim().toLowerCase();
    if (!['modelscope', 'openai', 'openai-compatible'].includes(provider)) {
      throw new StateError('云端 AI provider 配置无效。', 503, 'LOCAL_LLM_CONFIG');
    }
    const defaults = provider === 'modelscope'
      ? CLOUD_LLM_DEFAULTS
      : { provider, model: '', endpoint: '' };
    const config = { ...defaults, ...storedCloud, ...envConfig(provider), provider };
    const endpoint = String(config.endpoint || '').trim();
    let url;
    try { url = new URL(endpoint); } catch { throw new StateError('云端 AI 地址配置无效。', 503, 'LOCAL_LLM_CONFIG'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new StateError('云端 AI 地址配置无效。', 503, 'LOCAL_LLM_CONFIG');
    }
    if (!String(config.model || '').trim()) throw new StateError('云端 AI 模型配置无效。', 503, 'LOCAL_LLM_CONFIG');
    return {
      ...config,
      model: String(config.model).trim(),
      apiKey: String(config.apiKey || '').trim(),
      endpoint: url.href.replace(/\/+$/, '').replace(/\/chat\/completions$/, ''),
    };
  }

  async function httpError(response) {
    let body = '';
    try { body = (await response.text()).slice(0, 500); } catch { /* best effort */ }
    if ([401, 403].includes(response.status)) {
      return Object.assign(new StateError('云端 AI 访问令牌无效或未授权。', 503, 'LOCAL_LLM_AUTH'), {
        httpStatus: response.status, responseBody: body,
      });
    }
    if (response.status === 429) {
      return Object.assign(new StateError('AI 服务暂时不可用，请稍后重试。', 503, 'LOCAL_LLM_UNAVAILABLE'), {
        httpStatus: response.status, responseBody: body,
      });
    }
    if (response.status === 404 && /model/i.test(body)) {
      return Object.assign(new StateError('云端 AI 模型未找到。', 503, 'LOCAL_LLM_MODEL_MISSING'), {
        httpStatus: response.status, responseBody: body,
      });
    }
    return Object.assign(new StateError(`云端 AI 返回 HTTP ${response.status}。`, 503, 'LOCAL_LLM_HTTP'), {
      httpStatus: response.status, responseBody: body,
    });
  }

  function requestBody(config, messages, { tools, format, maxTokens, stream }) {
    const body = {
      model: config.model,
      messages: withJsonInstruction(messages, format),
      stream,
      max_tokens: outputBudget(maxTokens),
      temperature: 0,
      ...(tools ? { tools, tool_choice: 'auto' } : {}),
      ...(format ? { response_format: { type: 'json_object' } } : {}),
    };
    if (config.provider === 'modelscope') body.enable_thinking = false;
    return body;
  }

  function headers(config) {
    return {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    };
  }

  async function chat(messages, { tools, signal, format, maxTokens = 384 } = {}) {
    const config = await configuration();
    if (!config.apiKey) throw new StateError('云端 AI 未配置访问令牌。', 503, 'LOCAL_LLM_AUTH');
    let response;
    try {
      response = await fetchImpl(`${config.endpoint}/chat/completions`, {
        method: 'POST',
        headers: headers(config),
        body: JSON.stringify(requestBody(config, messages, { tools, format, maxTokens, stream: false })),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
    } catch (error) {
      throw requestError(error, signal);
    }
    if (!response.ok) throw await httpError(response);
    let data;
    try { data = await response.json(); } catch (error) {
      throw Object.assign(new StateError('云端 AI 返回内容无效。', 503, 'LOCAL_LLM_RESPONSE'), { cause: error });
    }
    const message = data?.choices?.[0]?.message || {};
    return {
      message: {
        content: normalizeContent(message.content),
        ...(Array.isArray(message.tool_calls) && message.tool_calls.length ? { tool_calls: normalizeToolCalls(message.tool_calls) } : {}),
      },
      metrics: {
        provider: 'cloud',
        promptTokens: data?.usage?.prompt_tokens ?? null,
        completionTokens: data?.usage?.completion_tokens ?? null,
        evalCount: data?.usage?.completion_tokens ?? null,
      },
    };
  }

  async function chatStream(messages, { tools, signal, format, maxTokens = 384, onDelta } = {}) {
    const config = await configuration();
    if (!config.apiKey) throw new StateError('云端 AI 未配置访问令牌。', 503, 'LOCAL_LLM_AUTH');
    let response;
    try {
      response = await fetchImpl(`${config.endpoint}/chat/completions`, {
        method: 'POST',
        headers: headers(config),
        body: JSON.stringify(requestBody(config, messages, { tools, format, maxTokens, stream: true })),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
    } catch (error) {
      throw requestError(error, signal);
    }
    if (!response.ok) throw await httpError(response);
    if (!response.body) throw new StateError('云端 AI 未返回可读内容。', 503, 'LOCAL_LLM_HTTP');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let complete = false;
    let usage = null;
    const toolCalls = [];

    const mergeToolCall = part => {
      const index = Number.isInteger(part?.index) ? part.index : toolCalls.length;
      const target = toolCalls[index] || (toolCalls[index] = { id: '', type: 'function', function: { name: '', arguments: '' } });
      if (part.id) target.id = part.id;
      if (part.type) target.type = part.type;
      if (part.function?.name) target.function.name = part.function.name;
      if (part.function?.arguments) target.function.arguments += part.function.arguments;
    };

    const consume = line => {
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (!payload) return;
      if (payload === '[DONE]') { complete = true; return; }
      let event;
      try { event = JSON.parse(payload); } catch { return; }
      if (event.error) {
        throw new StateError(`云端 AI 流式错误：${String(event.error.message || event.error).slice(0, 200)}`, 503, 'LOCAL_LLM_HTTP');
      }
      if (event.usage) usage = event.usage;
      const choice = event.choices?.[0];
      if (!choice) return;
      const delta = choice.delta || {};
      const text = normalizeContent(delta.content);
      if (text) { content += text; onDelta?.(text); }
      if (Array.isArray(delta.tool_calls)) delta.tool_calls.forEach(mergeToolCall);
      if (choice.finish_reason) complete = true;
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let at;
        while ((at = buffer.indexOf('\n')) >= 0) {
          consume(buffer.slice(0, at).trim());
          buffer = buffer.slice(at + 1);
        }
      }
      consume(buffer.trim());
      if (!complete) throw new StateError('回答生成中断，请重试。', 503, 'LOCAL_LLM_INTERRUPTED');
      const calls = toolCalls.filter(Boolean).map(call => ({
        ...call,
        function: { ...call.function, arguments: call.function.arguments || '{}' },
      }));
      return {
        message: { content, ...(calls.length ? { tool_calls: calls } : {}) },
        metrics: {
          provider: 'cloud',
          promptTokens: usage?.prompt_tokens ?? null,
          completionTokens: usage?.completion_tokens ?? null,
          evalCount: usage?.completion_tokens ?? null,
        },
      };
    } catch (error) {
      try { await reader.cancel?.(); } catch { /* best effort */ }
      throw requestError(error, signal);
    } finally {
      reader.releaseLock?.();
    }
  }

  async function probe(force) {
    let config;
    try { config = await configuration(); } catch (error) {
      return {
        configured: true, mode: 'cloud', provider: 'modelscope', model: '', endpoint: '',
        providerStatus: 'REQUEST_ERROR', status: 'request_error', available: false,
        reason: error.message || '云端 AI 配置无效。', inferenceTest: 'NOT_RUN',
        loadStatus: 'LOADED', processor: 'cloud', checkedAt: new Date().toISOString(),
      };
    }
    const key = JSON.stringify([config.provider, config.endpoint, config.model, Boolean(config.apiKey)]);
    if (!force && cached && cachedKey === key && Date.now() - cachedAt < STATUS_CACHE_MS) return cached;
    if (!config.apiKey) {
      cached = {
        configured: true, mode: 'cloud', provider: config.provider, model: config.model, endpoint: config.endpoint,
        providerStatus: 'REQUEST_ERROR', status: 'request_error', available: false,
        reason: '未配置云端 AI 访问令牌。', inferenceTest: 'NOT_RUN', loadStatus: 'LOADED', processor: 'cloud',
        lastError: { code: 'LOCAL_LLM_AUTH', summary: '未配置云端 AI 访问令牌。', httpStatus: null },
        checkedAt: new Date().toISOString(),
      };
      cachedKey = key; cachedAt = Date.now();
      return cached;
    }
    const started = Date.now();
    try {
      const models = await fetchImpl(`${config.endpoint}/models`, {
        headers: headers(config),
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
      if (!models.ok) throw await httpError(models);
      const listing = await models.json();
      const available = Array.isArray(listing?.data) && listing.data.some(item => item.id === config.model);
      if (!available) {
        cached = {
          configured: true, mode: 'cloud', provider: config.provider, model: config.model, endpoint: config.endpoint,
          providerStatus: 'MODEL_MISSING', status: 'model_missing', available: false,
          reason: '云端 AI 模型未找到。', modelAvailability: 'MISSING',
          inferenceTest: 'NOT_RUN', loadStatus: 'LOADED', processor: 'cloud',
          checkedAt: new Date().toISOString(),
        };
        cachedKey = key; cachedAt = Date.now();
        return cached;
      }
      const check = await chat([{ role: 'user', content: '只返回 READY' }], { maxTokens: 8 });
      if (!check.message?.content?.trim()) throw new StateError('云端 AI 推理未返回完整结果。', 503, 'LOCAL_LLM_RESPONSE');
      cached = {
        configured: true, mode: 'cloud', provider: config.provider, model: config.model, endpoint: config.endpoint,
        providerStatus: 'READY', status: 'ready', available: true,
        modelAvailability: 'AVAILABLE', inferenceTest: 'PASS',
        loadStatus: 'LOADED', processor: 'cloud', latencyMs: Math.max(1, Date.now() - started),
        checkedAt: new Date().toISOString(), lastError: null,
      };
      cachedKey = key; cachedAt = Date.now();
      return cached;
    } catch (error) {
      const failure = requestError(error);
      cached = {
        configured: true, mode: 'cloud', provider: config.provider, model: config.model, endpoint: config.endpoint,
        providerStatus: failure.code === 'LOCAL_LLM_AUTH' ? 'REQUEST_ERROR'
          : 'SERVICE_OFFLINE',
        status: failure.code === 'LOCAL_LLM_AUTH' ? 'request_error'
          : 'service_offline',
        available: false, reason: failure.message, inferenceTest: 'FAIL',
        loadStatus: 'LOADED', processor: 'cloud', checkedAt: new Date().toISOString(),
        lastError: { code: failure.code, summary: failure.message, httpStatus: failure.httpStatus ?? null },
      };
      cachedKey = key; cachedAt = Date.now();
      return cached;
    }
  }

  async function status({ force = false } = {}) {
    if (!pending) pending = probe(force).finally(() => { pending = null; });
    return pending;
  }

  function requestFailed(error) {
    if (!cached) return;
    const fatal = ['LOCAL_LLM_AUTH', 'LOCAL_LLM_CONFIG', 'LOCAL_LLM_MODEL_MISSING'].includes(error?.code);
    cached = {
      ...cached,
      ...(fatal ? { providerStatus: 'REQUEST_ERROR', status: 'request_error', available: false } : {}),
      lastError: { code: error?.code || 'AI_REQUEST_FAILED', summary: error?.message || '云端 AI 请求失败', httpStatus: error?.httpStatus ?? null },
      checkedAt: new Date().toISOString(),
    };
  }

  return { status, warmup: async () => (await status({ force: true })).available, chat, chatStream, requestFailed };
}

