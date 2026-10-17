// Transport diagnostics are bounded, process-local, and contain identities only.
const records = [], owners = new WeakMap(), signalIds = new WeakMap();
export const AI_RETRY_DELAY_MS = 800;
export const AI_MAX_AUTO_RETRIES = 1;
const id = () => globalThis.crypto?.randomUUID?.() || `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const timestamp = () => new Date().toISOString();
export function getAiTransportTrace() { return structuredClone(records); }
export function clearAiTransportTrace() { records.length = 0; }
export function isAiApiPath(path) { return /^\/api\/(?:assistant\/status|agent\/|chat(?:$|\?))/.test(path); }
function signalId(signal) {
  if (!signal) return null;
  if (!signalIds.has(signal)) signalIds.set(signal, id());
  return signalIds.get(signal);
}
export function ownAiController(controller, kind, parentSignal) {
  const owner = { controller_id: signalId(controller.signal), request_kind: kind,
    parent_abort_signal_id: signalId(parentSignal), created_at: timestamp(), abort_triggered: false,
    abort_trigger_source: null, abort_triggered_at: null };
  owners.set(controller, owner);
  controller.signal.addEventListener('abort', () => {
    owner.abort_triggered = true; owner.abort_triggered_at = timestamp();
    owner.abort_trigger_source ||= 'CALLER_OR_PARENT_ABORT';
  }, { once: true });
  return controller;
}
export function abortAiController(controller, source) {
  if (!controller || controller.signal.aborted) return;
  const owner = owners.get(controller); if (owner) owner.abort_trigger_source = source;
  controller.abort();
}
const messages = {
  NETWORK_FETCH_FAILED: 'DK AI服务连接失败，请重试。', BACKEND_UNAVAILABLE: 'DK AI服务连接失败，请重试。',
  LOCAL_AI_UNAVAILABLE: '本地 AI 暂不可用。预测、诊断和决策支持功能仍可正常使用。',
  HTTP_NON_2XX: 'DK AI服务返回异常，请重试。', EMPTY_RESPONSE_BODY: 'DK AI服务返回异常，请重试。',
  TRUNCATED_RESPONSE_BODY: 'DK AI服务返回异常，请重试。', INVALID_CONTENT_TYPE: 'DK AI服务返回异常，请重试。',
  JSON_PARSE_FAILED: 'DK AI服务返回异常，请重试。', QWEN_FAILED: 'DK AI回答当前不可用，请重试。',
  GROUNDING_FAILED: '当前知识依据读取失败，请重试。', DIAGNOSIS_FACTS_FAILED: '当前诊断事实核验未完成。',
  NUMERIC_POLICY_REJECTED: 'DK AI回答未通过核验，请重试。', OUTPUT_VALIDATION_REJECTED: 'DK AI回答未通过核验，请重试。',
  STALE_IDENTITY: '当前工况已变化，请重新发起请求。', ABORTED: '本次任务已停止。', OTHER: 'DK AI请求未完成，请重试。'
};
export class AiTransportError extends Error {
  constructor(code, details = {}) { super(messages[code] || messages.OTHER); this.name = code === 'ABORTED' ? 'AbortError' : 'AiTransportError'; this.code = code; this.details = details; }
}
export function aiFailureCode(code) {
  if (Object.hasOwn(messages, code)) return code;
  if (/LOCAL_LLM_(?:OFFLINE|CONFIG|MODEL)/.test(code || '')) return 'LOCAL_AI_UNAVAILABLE';
  if (/LOCAL_LLM_|QWEN_/.test(code || '')) return 'QWEN_FAILED';
  if (/GROUNDING/.test(code || '')) return 'GROUNDING_FAILED';
  if (/DIAGNOSTIC.*IDENTITY|STALE|IDENTITY|CONTEXT_EXPIRED/.test(code || '')) return 'STALE_IDENTITY';
  if (/NUMERIC/.test(code || '')) return 'NUMERIC_POLICY_REJECTED';
  if (/OUTPUT.*REJECT/.test(code || '')) return 'OUTPUT_VALIDATION_REJECTED';
  return null;
}
export function asAiTransportError(error, signal, fetchFailure = false) {
  if (error instanceof AiTransportError) return error;
  if (signal?.aborted || error?.name === 'AbortError') return new AiTransportError('ABORTED');
  const code = aiFailureCode(error?.code) || (fetchFailure ? 'NETWORK_FETCH_FAILED' : 'OTHER');
  return new AiTransportError(code, { raw_error: String(error?.message || error) });
}
function beginTrace(url, options, meta, attempt) {
  const trace = { request_id: id(), request_kind: meta.kind || 'DK_AI_API', request_url: url,
    method: options.method || 'GET', payload_identity: structuredClone(meta.identity || {}),
    request_start_at: timestamp(), request_end_at: null, http_response_received: false, http_status: null,
    content_type: null, response_body_length: null, response_body_complete: 'NOT_PROVABLE',
    json_parse_attempted: false, json_parse_result: 'NOT_ATTEMPTED', local_ai_health_at_request: meta.health || 'UNKNOWN',
    grounding_started: 'NOT_REPORTED', grounding_completed: 'NOT_REPORTED', qwen_request_started: 'NOT_REPORTED', qwen_request_completed: 'NOT_REPORTED',
    final_request_status: 'REQUESTING', attempt, retry_skipped_stale_identity: false,
    ...(owners.get(meta.controller) || { controller_id: signalId(options.signal), parent_abort_signal_id: null }) };
  records.push(trace); if (records.length > 300) records.shift(); return trace;
}
function finishTrace(trace, meta, error) {
  trace.request_end_at = timestamp(); trace.request_finished_at = trace.request_end_at;
  const owner = owners.get(meta.controller); if (owner) Object.assign(trace, owner);
  if(meta.signal?.aborted&&!trace.abort_triggered){trace.abort_triggered=true;trace.abort_trigger_source=owner?.parent_abort_signal_id?'PARENT_ABORT':'CALLER_ABORT';trace.abort_triggered_at=timestamp();}
  if (error) { trace.final_request_status = error.code; trace.raw_error = error.details?.raw_error || null; trace.server_error_code = error.details?.server_error_code || null; }
  else trace.final_request_status = 'SUCCESS';
}
function pipelineTrace(trace, data) {
  const lifecycle=data?.request_lifecycle;
  if(lifecycle){
    trace.grounding_started=Boolean(lifecycle.grounding_started_at);trace.grounding_completed=Boolean(lifecycle.grounding_completed_at);
    trace.qwen_request_started=Boolean(lifecycle.qwen_request_started_at);trace.qwen_request_completed=Boolean(lifecycle.qwen_request_completed_at);
    trace.pipeline_timestamps=structuredClone(lifecycle);
  }
  const reported = data?.ai_explanation_trace;
  if (reported) {
    trace.grounding_started = Boolean(reported.GROUNDING_START);
    trace.grounding_completed = Boolean(reported.GROUNDING_END);
    trace.qwen_request_started = Boolean(reported.QWEN_REQUEST_START);
    trace.qwen_request_completed = Boolean(reported.QWEN_REQUEST_END);
  }
  if (data?.llmCalls) { trace.llm_calls = structuredClone(data.llmCalls); }
  trace.business_status = data?.status || null;
  trace.business_failure = data?.ai_explanation_primary_failure || data?.generationError || null;
}
export async function readAiJsonResponse(response, trace = {}) {
  trace.http_response_received = true; trace.http_status = response.status;
  trace.content_type = response.headers.get('content-type') || '';
  let text;
  try { text = await response.text(); }
  catch (error) {
    if (error?.name === 'AbortError') throw new AiTransportError('ABORTED');
    // A rejected body reader is direct evidence of an interrupted body transfer.
    trace.response_body_complete = false;
    throw new AiTransportError('TRUNCATED_RESPONSE_BODY', { raw_error: String(error?.message || error) });
  }
  trace.response_body_length = new TextEncoder().encode(text).length;
  const jsonType = /^application\/(?:json|[\w.+-]+\+json)(?:\s*;|$)/i.test(trace.content_type);
  const rawDetails = { http_status: response.status };
  if (!text.trim()) throw new AiTransportError(response.ok ? 'EMPTY_RESPONSE_BODY' : 'HTTP_NON_2XX', rawDetails);
  if (!jsonType) throw new AiTransportError(response.ok ? 'INVALID_CONTENT_TYPE' : 'HTTP_NON_2XX', rawDetails);
  let data;
  trace.json_parse_attempted = true;
  try { data = JSON.parse(text); trace.json_parse_result = 'SUCCESS'; trace.response_body_complete = true; }
  catch (error) {
    trace.json_parse_result = 'FAILED';
    // Malformed JSON alone does not prove network truncation.
    throw new AiTransportError(response.ok ? 'JSON_PARSE_FAILED' : 'HTTP_NON_2XX', { ...rawDetails, raw_error: error.message });
  }
  pipelineTrace(trace, data);
  if (!response.ok || data?.ok === false) {
    const serverCode = data?.error_code || data?.code;
    throw new AiTransportError(aiFailureCode(serverCode) || 'HTTP_NON_2XX', { ...rawDetails, server_error_code: serverCode, raw_error: data?.message || data?.error });
  }
  return data;
}
function retryAllowed(error) {
  return ['NETWORK_FETCH_FAILED', 'EMPTY_RESPONSE_BODY', 'TRUNCATED_RESPONSE_BODY'].includes(error.code)
    || error.code === 'HTTP_NON_2XX' && [502, 503].includes(error.details.http_status);
}
function waitRetry(signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new AiTransportError('ABORTED')); return; }
    const aborted = () => { clearTimeout(timer); reject(new AiTransportError('ABORTED')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', aborted); resolve(); }, AI_RETRY_DELAY_MS);
    signal?.addEventListener('abort', aborted, { once: true });
  });
}
export async function requestAiJson(url, options = {}, meta = {}) {
  // Capture the already-serialized body once; never reconstruct context on retry.
  const frozenOptions = { ...options }, fetchImpl = meta.fetchImpl || globalThis.fetch;
  for (let attempt = 0; attempt <= AI_MAX_AUTO_RETRIES; attempt++) {
    const trace = beginTrace(url, frozenOptions, meta, attempt);
    try {
      frozenOptions.signal?.throwIfAborted();
      const headers = new Headers(frozenOptions.headers); headers.set('X-DKQKAR-Request-Id', trace.request_id);
      let response;
      try { response = await fetchImpl(url, { ...frozenOptions, headers }); }
      catch (error) { throw asAiTransportError(error, frozenOptions.signal, true); }
      const data = await readAiJsonResponse(response, trace); frozenOptions.signal?.throwIfAborted();finishTrace(trace, { ...meta, signal:frozenOptions.signal }); return data;
    } catch (caught) {
      const error = asAiTransportError(caught, frozenOptions.signal); finishTrace(trace, { ...meta, signal:frozenOptions.signal }, error);
      if (attempt || meta.retry !== true || meta.readOnly !== true || !retryAllowed(error)) throw error;
      await waitRetry(frozenOptions.signal);
      if (meta.current && !meta.current()) {
        trace.retry_skipped_stale_identity = true;
        throw new AiTransportError('STALE_IDENTITY');
      }
    }
  }
}
// Direct Chat keeps its existing streaming protocol and never auto-retries it.
export async function openAiStream(url, options, meta = {}) {
  const trace = beginTrace(url, options, meta, 0), headers = new Headers(options.headers);
  headers.set('X-DKQKAR-Request-Id', trace.request_id);
  try {
    let response;
    try { response = await fetch(url, { ...options, headers }); }
    catch(error){throw asAiTransportError(error,options.signal,true);}
    trace.http_response_received = true; trace.http_status = response.status; trace.content_type = response.headers.get('content-type') || '';
    if (!response.ok || !/^application\/x-ndjson(?:\s*;|$)/i.test(trace.content_type)) {
      await readAiJsonResponse(response, trace);
      throw new AiTransportError('INVALID_CONTENT_TYPE');
    }
    return { response, trace, finish: error => finishTrace(trace, { ...meta, signal:options.signal }, error ? asAiTransportError(error, options.signal) : null) };
  } catch (error) { const failure = asAiTransportError(error, options.signal); finishTrace(trace, meta, failure); throw failure; }
}
