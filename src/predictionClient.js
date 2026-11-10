const PREDICT_SERVICE_ERROR = '正式预测服务返回异常，请重试。';

export class PredictionRequestError extends Error {
  constructor(code, message, details) {
    super(message); this.name = 'PredictionRequestError'; this.code = code; this.details = details;
  }
}

/** Prediction transport only; malformed responses never become current results. */
export async function requestPredictionJson(url, options = {}, fetchImpl = globalThis.fetch) {
  const headers = new Headers(options.headers);
  if (!headers.has('X-DKQKAR-Request-Id')) headers.set('X-DKQKAR-Request-Id', crypto.randomUUID());
  // 没有超时的时候，模型服务不回包界面就永远停在"计算中"。
  // 这里给一个上限，超时按传输错误抛出，界面能回到可操作的错误态。
  const controller = !options.signal && typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 25000) : null;
  let response;
  try {
    response = await fetchImpl(url, { ...options, headers, ...(controller ? { signal: controller.signal } : {}) });
  } catch (error) {
    if (controller?.signal.aborted) throw new PredictionRequestError('PREDICT_TIMEOUT', '预测服务 25 秒未返回，已中止本次计算。', { request_id: headers.get('X-DKQKAR-Request-Id') });
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const text = await response.text();
  const details = { request_id: response.headers.get('X-DKQKAR-Request-Id') || headers.get('X-DKQKAR-Request-Id'),
    http_status: response.status, content_type: response.headers.get('Content-Type') || '', body_length: new TextEncoder().encode(text).length };
  if (!text.trim()) throw new PredictionRequestError(response.ok ? 'PREDICT_EMPTY_RESPONSE' : 'PREDICT_EMPTY_ERROR_RESPONSE', PREDICT_SERVICE_ERROR, details);
  if (!/^application\/(?:json|[\w.+-]+\+json)(?:\s*;|$)/i.test(details.content_type))
    throw new PredictionRequestError('PREDICT_RESPONSE_CONTENT_TYPE_INVALID', PREDICT_SERVICE_ERROR, details);
  let data;
  try { data = JSON.parse(text); }
  catch (error) { throw new PredictionRequestError('PREDICT_RESPONSE_JSON_INVALID', PREDICT_SERVICE_ERROR, { ...details, parse_error: error.message }); }
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new PredictionRequestError('PREDICT_RESPONSE_SHAPE_INVALID', PREDICT_SERVICE_ERROR, details);
  if (!response.ok) throw new PredictionRequestError(data.error_code || 'PREDICT_HTTP_ERROR', data.message || data.error || PREDICT_SERVICE_ERROR,
    { ...details, request_id: data.request_id || details.request_id });
  return data;
}

/** One engine per session: a formal result can never silently become a demo. */
export function createPredictionClient(request) {
  let mode = 'auto';
  const acceptStatus = status => { if (status?.available === true || status?.mode === 'formal') mode = 'formal'; return status; };
  const predict = async (input, options = {}) => {
    const requestedMode = mode;
    const { current, input_snapshot, prediction, observation, committed_snapshot, operation_scope, predictionErrorAlarmRange, ...transport } = options;
    const result = await request('/predict', { ...transport, method: 'POST', body: JSON.stringify({ input, mode: requestedMode,
      options: { kind: input_snapshot ? 'retry' : 'new', input_snapshot, prediction, observation, committed_snapshot }, operation_scope,
      alarm_range: predictionErrorAlarmRange }) });
    if (!Number.isFinite(result?.value) || !['demo', 'formal'].includes(result.mode)) throw new Error('预测服务未返回有效结果');
    if (requestedMode === 'formal' && result.mode !== 'formal') throw new Error('正式模型尚未完成计算，保留上次结果');
    if (result.mode === 'formal' && (!current || current())) mode = 'formal';
    return result;
  };
  const optimize = async (input, options = {}) => {
    const { input_snapshot, prediction, operation_scope, ...transport } = options;
    const response = await request('/optimize', { ...transport, method: 'POST', body: JSON.stringify({ input, mode, options:{input_snapshot,prediction}, operation_scope }) });
    const plans = Array.isArray(response) ? response : response.plans || response.schemes || [];
    if (mode === 'formal' && plans.some(plan => plan.mode !== 'formal')) throw new Error('方案未由当前正式模型计算');
    if (plans.some(plan => plan.mode === 'formal')) mode = 'formal';
    return plans;
  };
  const appendObservation = (input_snapshot, prediction, data, options = {}) => {
    const { operation_scope, revision, ...transport } = options;
    return request('/observation', {...transport, method:'POST', body:JSON.stringify({input_snapshot,prediction,data,operation_scope,revision})});
  };
  const prepareCommittedInput=(input,operation_scope)=>request('/input-snapshot',{method:'POST',body:JSON.stringify({input,operation_scope})});
  return { acceptStatus, predict, optimize, appendObservation, prepareCommittedInput, get mode() { return mode; } };
}

/** Invalidating also cancels transport; revision remains the final stale-response guard. */
export function createPredictionGate() {
  let revision = 0, controller;
  const invalidate = () => { revision += 1; controller?.abort(); };
  return { invalidate, get revision() { return revision; }, begin() { invalidate(); const version = revision; controller = new AbortController(); const signal = controller.signal;
    const current = () => version === revision && !signal.aborted;
    return { signal, revision:version, current, commit(fn) { if (current()) { fn(); return true; } return false; } }; } };
}
