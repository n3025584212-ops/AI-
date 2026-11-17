import { StateError } from './local-state.mjs';
import { createLocalAiHealth } from './local-ai-health.mjs';

export const LOCAL_LLM_DEFAULTS = Object.freeze({ model: 'qwen3.5:4b', endpoint: 'http://127.0.0.1:11434', provider: 'ollama' });
// Must stay >= the desktop runtime's OLLAMA_KEEP_ALIVE so an idle gap never
// unloads the model and forces a full cold load onto the next question.
const KEEP_ALIVE = '1h';
// Callers already choose 640/1200/1800-token budgets for brief/detail answers.
// The old hard 512 cap silently discarded those budgets and cut long answers.
// Keep a ceiling for runaway generations, but never below the caller's budget.
const MAX_OUTPUT_TOKENS = 2048;
const LOCAL_CONTEXT_TOKENS = 4096;
function outputBudget(messages, maxTokens) {
  const requested = Number.isFinite(maxTokens) ? Math.max(64, Math.trunc(maxTokens)) : 384;
  // Conservative token estimate for Chinese text; this keeps num_ctx from
  // being overrun when a long RAG prompt and a long answer are requested.
  const chars = messages.reduce((sum, message) => sum + String(message?.content ?? '').length, 0);
  const estimatedInput = Math.ceil(chars / 2);
  const available = Math.max(256, LOCAL_CONTEXT_TOKENS - estimatedInput - 128);
  return Math.min(MAX_OUTPUT_TOKENS, requested, available);
}

export function createLocalLlm({ settings = async () => ({}), fetchImpl = fetch, timeoutMs = 120000, ensureService, healthOptions={} } = {}) {
  async function configuration({ statusOnly = false } = {}) {
    const stored = await settings(), config = { ...LOCAL_LLM_DEFAULTS, ...(stored.localLlm || {}) };
    const url = new URL(config.endpoint);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new StateError('助手服务地址配置无效。', 503, 'LOCAL_LLM_CONFIG');
    if(config.provider!=='ollama'||typeof config.model!=='string'||!config.model.trim())throw new StateError('本地 AI provider 或模型配置无效。',503,'LOCAL_LLM_CONFIG');
    return { ...config, endpoint: url.origin };
  }
  async function boundedText(response) {
    const reader = response.body.getReader(); let bytes = 0; const chunks = [];
    for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw new StateError('助手返回的内容过长。', 503); } chunks.push(value); }
    return Buffer.concat(chunks).toString('utf8');
  }
  async function httpError(response) {
    let responseBody = ''; try { responseBody = await boundedText(response); } catch (error) { responseBody = error.message; }
    if (response.status === 400 && /context|num_ctx|too long|exceed|prompt.{0,20}(long|large)/i.test(responseBody)) {
      return Object.assign(new StateError('问题超出本地模型上下文长度，请缩短后重试。', 503, 'LOCAL_LLM_CONTEXT'), { httpStatus: response.status, responseBody });
    }
    return Object.assign(new StateError(`助手服务返回 HTTP ${response.status}。`, 503, 'LOCAL_LLM_HTTP'), { httpStatus: response.status, responseBody });
  }
  async function boundedJson(response) {
    if (!response.ok) throw await httpError(response);
    try { return JSON.parse(await boundedText(response)); }
    catch (error) { if (error instanceof StateError) throw error; throw Object.assign(new StateError('助手状态内容无效。', 503, 'LOCAL_LLM_RESPONSE'), { cause: error }); }
  }
  function requestError(error, signal, partial = false) {
    if (signal?.aborted) return signal.reason || error;
    if (error instanceof StateError) return error;
    const timeout = error.name === 'TimeoutError';
    const code = timeout ? 'LOCAL_LLM_TIMEOUT' : partial ? 'LOCAL_LLM_INTERRUPTED' : 'LOCAL_LLM_OFFLINE';
    const message = timeout ? '本地 AI 回答超时，请重试。' : partial ? '回答生成中断，请重试。' : '本地 AI 暂不可用。';
    return Object.assign(new StateError(message, 503, code), { cause: error });
  }
  function chatRequest(config, messages, { tools, signal, format, maxTokens = 384, stream = false } = {}) {
    return fetchImpl(`${config.endpoint}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ model: config.model, messages, stream, think: false, keep_alive: KEEP_ALIVE, ...(tools ? { tools } : {}), ...(format ? { format } : {}),
        options: { num_ctx: LOCAL_CONTEXT_TOKENS, num_predict: outputBudget(messages, maxTokens), temperature: 0 } }) });
  }
  // Web 部署没有桌面壳，不存在可自动拉起的 Ollama 进程 —— 这里只接受宿主显式
  // 注入的 ensureService（桌面端专用）。没有注入时不做任何拉起尝试，直接按
  // 探测结果报告 SERVICE_OFFLINE，由前端回落到确定性回答。
  const launch = ensureService ?? null;
  const health=createLocalAiHealth({configuration,ensureService:launch,...healthOptions,
    jsonRequest:async(config,path)=>boundedJson(await fetchImpl(config.endpoint+path,{signal:AbortSignal.timeout(2500),redirect:'error'})),
    infer:async config=>boundedJson(await chatRequest(config,[{role:'user',content:'只返回 READY'}],{maxTokens:8}))});
  return {
    status: health.status,
    async warmup() { return (await health.status({force:true})).available; },
    async chat(messages, { tools, signal, format, maxTokens = 384 } = {}) {
      const config = await configuration();
      try {
        const response = await chatRequest(config, messages, { tools, signal, format, maxTokens });
        const data = await boundedJson(response);
        return { message: data.message || {}, metrics: { totalDurationNs: data.total_duration, evalCount: data.eval_count, evalDurationNs: data.eval_duration } };
      } catch (error) { const failure=requestError(error,signal);if(!signal?.aborted)health.requestFailed(failure);throw failure; }
    },
    // Streaming variant for user-facing replies. Tool-call parts are merged in
    // arrival order; onDelta fires for every content piece as it arrives.
    async chatStream(messages, { tools, signal, format, maxTokens = 384, onDelta } = {}) {
      const config = await configuration();
      let response; try { response = await chatRequest(config, messages, { tools, signal, format, maxTokens, stream: true }); } catch (error) { const failure=requestError(error,signal);if(!signal?.aborted)health.requestFailed(failure);throw failure; }
      if (!response.ok) { const failure=await httpError(response);health.requestFailed(failure);throw failure; }
      if (!response.body) throw new StateError('助手服务未返回可读内容。', 503, 'LOCAL_LLM_HTTP');
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '', content = '', complete = false, metrics = { totalDurationNs: null, evalCount: null, evalDurationNs: null };
      const toolCalls = [];
      const consume = line => {
        if (!line) return;
        let event; try { event = JSON.parse(line); } catch { return; }
        if (event.error) throw new StateError(`助手服务错误：${String(event.error).slice(0, 200)}`, 503, 'LOCAL_LLM_HTTP');
        const piece = event.message || {};
        if (typeof piece.content === 'string' && piece.content) { content += piece.content; onDelta?.(piece.content); }
        if (Array.isArray(piece.tool_calls)) toolCalls.push(...piece.tool_calls);
        if (event.done) { complete = true; metrics = { totalDurationNs: event.total_duration ?? null, evalCount: event.eval_count ?? null, evalDurationNs: event.eval_duration ?? null }; }
      };
      try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let at;
        while ((at = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, at).trim()); buffer = buffer.slice(at + 1); }
      }
      consume(buffer.trim());
      if (!complete) throw new StateError('回答已中断。', 503, 'LOCAL_LLM_INTERRUPTED');
      return { message: { content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, metrics };
      } catch (error) { try { await reader.cancel?.(); } catch {} const failure=requestError(error,signal,Boolean(content));if(!signal?.aborted)health.requestFailed(failure);throw failure; }
      finally { reader.releaseLock?.(); }
    },
  };
}
