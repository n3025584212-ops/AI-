import { MODEL_FEATURES, MODEL_INPUT_COUNT, summarizeModelInputs } from './modelInputs.js';
import { dashboardInputDisplay, dataSourceDisplayName } from './workbenchDisplay.js';
import { modelDisplayName } from './userVisibleText.js';

export const DK_AI_DIAGNOSTIC_STATES = Object.freeze({
  NOT_CHECKED: { label: '尚未检查', recovery: null },
  NOT_CONFIGURED: { label: '尚未配置', recovery: '请先完成AI服务配置。' },
  SERVICE_UNREACHABLE: { label: 'AI服务无法连接', recovery: '确认当前AI服务已启动，并检查服务地址。' },
  MODEL_NOT_AVAILABLE: { label: '配置的AI模型不可用', recovery: '检查当前配置的AI模型是否已安装/可用。' },
  REQUEST_FAILED: { label: 'AI测试请求失败', recovery: '检查AI服务运行状态后重新检查。' },
  INVALID_RESPONSE: { label: 'AI响应异常', recovery: 'AI服务已响应，但返回格式异常，请重新检查或查看技术信息。' },
  AVAILABLE: { label: '可正常使用', recovery: null },
});
const finite = value => typeof value === 'number' && Number.isFinite(value);
const stamp = value => value != null && value !== '' && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
// Only known non-secret fields enter the display/export snapshot. Raw provider
// responses, config objects, endpoints, paths and error messages never enter it.
const safeName = value => typeof value === 'string' && value.trim() && value.length <= 160
  && !/[\r\n]|(?:api.?key|token|secret|authorization|bearer|password|密码)|(?:[a-z]:[\\/]|https?:|file:|\\\\)/i.test(value) ? value : null;
const safeCode = value => typeof value === 'string' && /^[A-Z0-9_]{1,64}$/.test(value)
  && !/(?:KEY|TOKEN|SECRET|AUTHORIZATION|PASSWORD)/.test(value) ? value : null;
const failureLabels = { CONFIG: 'AI配置', SERVICE: '服务连接', MODEL: '模型检查', INFERENCE: '最小响应测试', RESPONSE: '响应验证', TRANSPORT: '诊断请求' };
const failureReasons = {
  NOT_CONFIGURED: '当前AI服务配置不完整或无效。', SERVICE_UNREACHABLE: '无法连接当前配置的AI服务。',
  MODEL_NOT_AVAILABLE: 'AI服务可连接，但未找到当前配置的模型。', REQUEST_FAILED: 'AI诊断请求未能完成。',
  INVALID_RESPONSE: '返回内容未通过有效性验证。',
};

export function aiDiagnosticProjection(raw = {}) {
  raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const checkedAt = stamp(raw.checkedAt), code = safeCode(raw.lastError?.code || raw.healthTransportError);
  let state = 'NOT_CHECKED', stage = raw.failureStage;
  if (code === 'LOCAL_LLM_CONFIG' || raw.configured === false && stage === 'CONFIG') state = 'NOT_CONFIGURED';
  else if (['INVALID_HEALTH_RESPONSE', 'JSON_PARSE_FAILED', 'INVALID_CONTENT_TYPE', 'EMPTY_RESPONSE_BODY'].includes(code)) { state = 'INVALID_RESPONSE'; stage = 'RESPONSE'; }
  else if (raw.healthTransportError) { state = 'REQUEST_FAILED'; stage = 'TRANSPORT'; }
  else if (raw.inferenceTest === 'RUNNING') state = 'NOT_CHECKED';
  else if (checkedAt && !['RUNNING', 'NOT_RUN'].includes(raw.inferenceTest) && raw.providerStatus === 'READY'
    && raw.available === true && raw.configured === true && raw.serviceStatus === 'CONNECTED'
    && raw.modelAvailability === 'AVAILABLE' && raw.inferenceTest === 'PASS'
    && stamp(raw.inferenceCheckedAt) && finite(raw.latencyMs) && raw.latencyMs >= 0 && safeName(raw.model) && safeName(raw.provider)) state = 'AVAILABLE';
  else if (checkedAt && raw.providerStatus === 'READY') { state = 'INVALID_RESPONSE'; stage = 'RESPONSE'; }
  else if (checkedAt && raw.providerStatus === 'SERVICE_OFFLINE') state = 'SERVICE_UNREACHABLE';
  else if (checkedAt && raw.providerStatus === 'MODEL_MISSING') state = 'MODEL_NOT_AVAILABLE';
  else if (checkedAt && ['LOCAL_LLM_RESPONSE', 'INVALID_INFERENCE_RESPONSE'].includes(code)) { state = 'INVALID_RESPONSE'; stage = raw.failureStage || 'RESPONSE'; }
  else if (checkedAt && ['REQUEST_ERROR', 'MODEL_ERROR'].includes(raw.providerStatus)) state = 'REQUEST_FAILED';
  const definition = DK_AI_DIAGNOSTIC_STATES[state];
  const failed = !['AVAILABLE', 'NOT_CHECKED'].includes(state);
  return {
    aiStatus: state, aiStatusLabel: definition.label, aiRecoveryAction: definition.recovery,
    aiProvider: safeName(raw.provider), aiModel: safeName(raw.model),
    aiServiceStatus: ['CONNECTED', 'DISCONNECTED'].includes(raw.serviceStatus) ? raw.serviceStatus : 'NOT_CHECKED',
    aiModelAvailability: ['AVAILABLE', 'MISSING'].includes(raw.modelAvailability) ? raw.modelAvailability : 'NOT_CHECKED',
    aiResponseTest: ['PASS', 'FAIL', 'RUNNING', 'NOT_RUN'].includes(raw.inferenceTest) ? raw.inferenceTest : 'NOT_RUN',
    aiLastCheckedAt: checkedAt,
    aiLatencyMs: state === 'AVAILABLE' ? raw.latencyMs : null,
    aiCheckElapsedMs: finite(raw.checkElapsedMs) && raw.checkElapsedMs >= 0 ? raw.checkElapsedMs : null,
    aiFailureStage: failed ? code === 'INVALID_HEALTH_RESPONSE' ? '诊断结果验证' : failureLabels[stage] || '诊断请求' : null,
    aiFailureReason: failed ? code === 'INVALID_HEALTH_RESPONSE' ? '诊断接口未返回完整的AI检查结果。' : failureReasons[state] : null,
    aiErrorCode: failed ? code : null,
    aiErrorSummary: failed ? definition.label + (code ? '（' + code + '）' : '') : null,
    ...(code === 'INVALID_HEALTH_RESPONSE' ? { aiRecoveryAction: '诊断结果不完整，请重新检查或查看技术信息。' } : {}),
  };
}

export function latestDiagnosticAI(local, runtime) {
  if (!local) return runtime;
  if (runtime?.model && local.model && (runtime.model !== local.model || runtime.provider !== local.provider)) return runtime;
  return (Date.parse(runtime?.checkedAt) || 0) > (Date.parse(local.checkedAt) || 0) ? runtime : local;
}

// Reuse the formal health endpoint (service -> model -> minimal completion ->
// response validation). A single promise guards rapid clicks, even before React
// has committed the disabled state. This never invokes chat or sends case data.
export function createSystemAiDiagnosticCheck(request, now = Date.now) {
  let pending = null;
  return () => {
    if (pending) return pending;
    pending = Promise.resolve().then(async () => {
      const started = now();
      try {
        const result = await request('/assistant/status?check=1', { transport: { kind: 'LOCAL_AI_HEALTH', health: 'UNKNOWN' } });
        if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.providerStatus !== 'string' || !stamp(result.checkedAt)) {
          return { providerStatus: 'REQUEST_ERROR', available: false, inferenceTest: 'FAIL', checkedAt: new Date(now()).toISOString(),
            checkElapsedMs: Math.max(0, now() - started), failureStage: 'RESPONSE', lastError: { code: 'INVALID_HEALTH_RESPONSE' } };
        }
        return result;
      }
      catch (error) {
        const code = safeCode(error.details?.server_error_code || error.code) || 'AI_DIAGNOSTIC_REQUEST_FAILED';
        return { configured: code === 'LOCAL_LLM_CONFIG' ? false : undefined, providerStatus: 'REQUEST_ERROR',
          available: false, inferenceTest: 'NOT_RUN', checkedAt: new Date(now()).toISOString(),
          checkElapsedMs: Math.max(0, now() - started), failureStage: code === 'LOCAL_LLM_CONFIG' ? 'CONFIG' : 'TRANSPORT',
          healthTransportError: code, lastError: { code } };
      }
    }).finally(() => { pending = null; });
    return pending;
  };
}

export function createSystemDiagnosticSnapshot({ appVersion, modelStatus, caseData, stream, predictionState,
  currentPrediction, predictionBound, dirty, checked, industrialStatus, ai, statusCheckedAt, predictionUpdatedAt } = {}) {
  const summary = summarizeModelInputs(caseData), plc = stream?.mode === 'plc';
  const inputs = dashboardInputDisplay(summary, checked, plc ? industrialStatus || {} : null);
  const schemaAvailable = MODEL_INPUT_COUNT === 25 && MODEL_FEATURES.length === MODEL_INPUT_COUNT && modelStatus?.schema_status === 'VERIFIED';
  const modelReady = modelStatus?.available === true && modelStatus.status === 'READY' && modelStatus.mode === 'formal';
  const predictionReady = modelReady && schemaAvailable && inputs.predictionAllowed && !dirty && predictionBound === true
    && predictionState === 'READY' && currentPrediction?.mode === 'formal' && finite(currentPrediction.value)
    && currentPrediction.model_hash === modelStatus.model_hash && currentPrediction.model_version === modelStatus.model_version;
  let predictionStatus = 'PREDICTION_PENDING', predictionStatusLabel = predictionState === 'PREDICTING' ? '预测正在计算' : '当前预测尚未更新';
  if (!modelReady) { predictionStatus = 'MODEL_NOT_LOADED'; predictionStatusLabel = '模型未加载'; }
  else if (!schemaAvailable) { predictionStatus = 'CANONICAL25_UNAVAILABLE'; predictionStatusLabel = '25维输入定义尚未验证'; }
  else if (summary.missing.length || inputs.readCount < MODEL_INPUT_COUNT) { predictionStatus = 'INPUT_INCOMPLETE'; predictionStatusLabel = '输入数据不完整'; }
  else if (summary.invalid.length) { predictionStatus = 'INVALID_INPUT'; predictionStatusLabel = '当前输入存在无效值'; }
  else if (inputs.validCount < MODEL_INPUT_COUNT) { predictionStatus = 'INVALID_INPUT'; predictionStatusLabel = '当前输入存在无效数值'; }
  else if (!inputs.predictionAllowed) { predictionStatus = 'DATA_NOT_CURRENT'; predictionStatusLabel = '实时预测暂停，等待有效工况'; }
  else if (predictionState === 'FAILED') { predictionStatus = 'PREDICTION_FAILED'; predictionStatusLabel = '预测计算失败'; }
  else if (predictionReady) { predictionStatus = 'AVAILABLE'; predictionStatusLabel = '可正常使用'; }
  const frames = Array.isArray(stream?.frames) ? stream.frames : [], manual = stream?.mode === 'manual';
  const totalRecords = manual && caseData ? 1 : frames.length;
  const currentRecord = manual && caseData ? 1 : Number.isInteger(stream?.cursor) && stream.cursor >= 0 && stream.cursor < frames.length ? stream.cursor + 1 : null;
  const frame = stream?.frame || frames[stream?.cursor];
  const dataSource = plc ? 'PLC实时数据' : frame?.historicalReplay === true ? '工业数据'
    : safeName(dataSourceDisplayName(stream?.sourceName)) || ({ manual: '手动工况', import: '导入数据', demo: '工业数据' })[stream?.mode] || '来源不可用';
  const loaded = Boolean(caseData && currentRecord);
  const dataStatus = plc && inputs.communicationStopped ? 'STOPPED' : loaded ? 'LOADED' : 'NOT_LOADED';
  const aiProjection = aiDiagnosticProjection(ai);
  const timestamps = [statusCheckedAt, predictionUpdatedAt, aiProjection.aiLastCheckedAt].map(stamp).filter(Boolean).sort();
  return {
    schema: 'dkqkar-system-diagnostic-snapshot-v1', appVersion: safeName(appVersion),
    snapshotUpdatedAt: timestamps.at(-1) || null,
    predictionStatus, predictionStatusLabel,
    modelName: modelStatus?.model_version ? modelDisplayName(modelStatus.model_version) : null,
    modelVersion: safeName(modelStatus?.model_version), modelIdentity: safeName(modelStatus?.model),
    modelHash: /^[a-f0-9]{64}$/i.test(modelStatus?.model_hash || '') ? modelStatus.model_hash : null,
    inputStatus: { schemaAvailable, readCount: inputs.readCount, finiteCount: summary.completeCount,
      validCount: inputs.validCount, total: MODEL_INPUT_COUNT, missingCount: summary.missing.length, invalidCount: summary.invalid.length },
    currentPredictionStatus: predictionReady ? '已更新' : predictionStatusLabel,
    dataStatus, dataStatusLabel: dataStatus === 'STOPPED' ? '通讯已断开，数据已停止更新' : loaded ? '已载入' : '尚未载入',
    dataSource, currentRecord, totalRecords,
    ...aiProjection,
  };
}

export function exportSystemDiagnosticSnapshot(snapshot, exportedAt = new Date().toISOString()) {
  return { ...snapshot, exportedAt };
}
