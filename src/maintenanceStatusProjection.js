import { MODEL_FEATURES } from './modelInputs.js';
import { RANGE_CHECK_FIELD_COUNT } from './inputRangeFields.js';
import { dataSourceDisplayName } from './workbenchDisplay.js';
import { aiConnectionState, safeAiEndpoint } from './aiConnectionStatus.js';

export const READING = '正在读取…';
export const UNAVAILABLE = '状态暂不可用';
const finite = value => typeof value === 'number' && Number.isFinite(value);
export function safeStatusText(value) {
 if(typeof value!=='string'||!value.trim())return null;
 return /(?:[a-z]:[\\/]|\\\\|\.round\d|ui-audit-mode|session-data|preview-data|diagnostics|localhost|127\.0\.0\.1|OneDrive|vite|\bnpm\b|worker.*pid|\/api\/|^(?:\/|file:|https?:))/i.test(value)?null:value;
}
export function dataCheckState(summary, checked) {
 if(!summary||!Array.isArray(checked?.rows)||!checked.rows.length)return {status:'UNAVAILABLE',label:UNAVAILABLE,tone:'error',referenceNotice:null};
 const statuses=['NORMAL','REVIEW_RECOMMENDED','INSUFFICIENT_HISTORY','DEGENERATE','NOT_CHECKED'];
 if(checked.rows.length!==RANGE_CHECK_FIELD_COUNT||checked.rows.some(row=>!statuses.includes(row.status)))return {status:'UNAVAILABLE',label:UNAVAILABLE,tone:'error',referenceNotice:null};
 const referenceNotice=checked.rows.filter(row=>!['NORMAL','NOT_CHECKED'].includes(row.status)).length;
 const normal=summary.valid&&summary.missing.length===0&&summary.invalid.length===0&&referenceNotice===0;
 return {status:normal?'NORMAL':'HAS_NOTICE',label:normal?'正常':'有提示',tone:normal?'good':'notice',referenceNotice};
}
export function replayStatus(stream) {
 if(!stream)return {source:READING};
 const frames=Array.isArray(stream.frames)?stream.frames:[],frame=stream.frame||frames[stream.cursor];
 if(frame?.historicalReplay===true){
  const count=frames.filter(row=>row.historicalReplay===true).length;
  return {source:'工业数据',historyCount:count,position:Number.isInteger(stream.cursor)&&stream.cursor>=0&&stream.cursor<count?stream.cursor+1:null};
 }
 return {source:safeStatusText(dataSourceDisplayName(stream.sourceName))||({manual:'手动工况',import:'导入数据',demo:'工业数据'})[stream.mode]||'来源待确认'};
}
export function modelServiceState(model, failed=false) {
 if(failed)return {label:UNAVAILABLE,tone:'error'};
 const status=String(model?.status||'').toUpperCase();
 if(!model||!status||['CONNECTING','LOADING'].includes(status))return {label:READING,tone:'idle'};
 const ready=model.available===true&&status==='READY'&&model.mode==='formal';
 return {label:ready?'可用':'未就绪',tone:ready?'good':'error'};
}
export function aiServiceState(ai) {
 if(!ai?.providerStatus)return {label:READING,tone:'idle',load:READING};
 const {label,tone}=aiConnectionState(ai);
 return {label,tone,...(['READY','MODEL_LOADING'].includes(ai.providerStatus)?{load:({LOADED:'已加载',UNLOADED:'待调用加载',UNKNOWN:'加载状态待确认'})[ai.loadStatus]||'加载状态待确认'}:{})};
}
export const SEARCH_STATUS_LABELS=Object.freeze({IDLE:'就绪',SEARCHING:'搜索中',COMPLETED:'已完成',CANCELLED:'已取消',TIMEOUT:'已超时',FAILED:'暂不可用',STALE:'已过期',SUPERSEDED:'已被新搜索替代',TARGET_REQUIRED:'等待设定目标'});
export function searchStateDisplay(state) {
 const status=state?.status;
 return {label:SEARCH_STATUS_LABELS[status]||READING,tone:['IDLE','COMPLETED'].includes(status)?'good':['FAILED','TIMEOUT'].includes(status)?'error':'idle'};
}
// Session-only UI history, never Candidate state, persistence or a new Run.
export function rememberCompletedSearch(previous, run) {
 if(run?.status!=='COMPLETED'||!run.search_run_id||!finite(run.elapsed_ms)||run.elapsed_ms<0)return previous;
 if(previous?.search_run_id===run.search_run_id)return previous;
 return {search_run_id:run.search_run_id,elapsed_ms:run.elapsed_ms};
}
export function recentSearchDisplay(recent, state) {
 if(!recent)return '尚无记录';
 return recent.elapsed_ms+' ms'+(state?.status==='COMPLETED'&&state.search_run_id===recent.search_run_id?'':' · 已过期');
}
export function searchConfigDisplay(config) {
 const fields=config?.fields?.map(key=>MODEL_FEATURES.find(field=>field.key===key));
 if(!fields?.length||fields.some(field=>!field)||new Set(config.fields).size!==fields.length
  ||!Number.isInteger(config.totalCandidates)||!Number.isInteger(config.maxChangedActions)
  ||!Array.isArray(config.actions)||!config.actions.length||new Set(config.actions.map(a=>a.actionId)).size!==config.actions.length
  ||config.actions.some(a=>!a.actionId||!a.displayName||!a.affectedFields?.length||a.affectedFields.some(key=>!config.fields.includes(key)))
  ||JSON.stringify(config.actions.flatMap(a=>a.affectedFields))!==JSON.stringify(config.fields))return null;
 return {fields,actions:config.actions,totalCandidates:config.totalCandidates,maxChangedActions:config.maxChangedActions};
}
export function maintenanceReadProjection(status) {
 if(!status?.checkedAt||!Number.isFinite(new Date(status.checkedAt).getTime()))throw Error('maintenance status unavailable');
 return {checkedAt:status.checkedAt,lastLatencyMs:finite(status.prediction?.lastLatencyMs)&&status.prediction.lastLatencyMs>=0?status.prediction.lastLatencyMs:null};
}
export const localStatusTime=value=>value&&Number.isFinite(new Date(value).getTime())?new Date(value).toLocaleTimeString('zh-CN',{hour12:false}):null;
export const localStatusStamp=value=>value&&Number.isFinite(new Date(value).getTime())?new Date(value).toLocaleString('zh-CN',{hour12:false}):null;
export function safeMaintenanceDiagnostics(report) {
 const model=report?.prediction,ai=report?.ai||report?.assistant;
 return {readAt:localStatusStamp(report?.checkedAt),model:{status:modelServiceState(model).label,version:safeStatusText(model?.model_version),
  fingerprint:typeof model?.model_hash==='string'&&/^[a-f0-9]{64}$/i.test(model.model_hash)?model.model_hash:null,verification:model?.schema_status==='VERIFIED'?'已验证':null},
  ai:{...aiServiceState(ai),model:safeStatusText(ai?.model),provider:ai?.provider==='ollama'?'Ollama':'未核实',endpoint:safeAiEndpoint(ai?.endpoint),
   service:({CONNECTED:'已连接',DISCONNECTED:'未连接'})[ai?.serviceStatus]||'未核实',modelAvailability:({AVAILABLE:'已找到',MISSING:'未找到'})[ai?.modelAvailability]||'未核实',
   inference:({PASS:'PASS',FAIL:'FAIL',RUNNING:'正在检查',NOT_RUN:'未执行'})[ai?.inferenceTest]||'未执行',
   lastError:/^[A-Z0-9_]{1,64}$/.test(ai?.lastError?.code||'')?ai.lastError.code:'无',failureStage:({SERVICE:'服务连接',MODEL:'模型检查',INFERENCE:'最小推理'})[ai?.failureStage]||'无',
   checkedAt:localStatusStamp(ai?.checkedAt)||'尚未检查'}};
}
