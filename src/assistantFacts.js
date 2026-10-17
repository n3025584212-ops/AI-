import {summarizeModelInputs} from './modelInputs.js';
import {effectiveRangeProjection} from './effectiveRangeProjection.js';
import {DEFAULT_INPUT_RANGE_TABLE} from './inputRangeDefaults.js';
import {deepFreeze} from './predictionSnapshot.js';
import {classifyAssistantIntent} from './assistantIntent.js';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
export const factDirectionLabel=direction=>({BELOW:'预测低于实际值',ABOVE:'预测高于实际值',EQUAL:'与实际值一致',UNKNOWN:'无法比较'})[direction]||'无法比较';
export const factForce=value=>finite(value)?value.toFixed(3)+' t':'—';
const ACTUAL_SOURCE_LABELS=Object.freeze({
 REAL_EXCEL_MEASUREMENT:'Excel导入的S5轧制力记录',
 UNKNOWN:'来源未提供',unknown:'来源未提供'
});
export const assistantActualSourceLabel=value=>Object.hasOwn(ACTUAL_SOURCE_LABELS,value)?ACTUAL_SOURCE_LABELS[value]:value||'未提供';

// An AI-only projection of existing input/range/pairing states. It never
// predicts, fills an Actual, changes a range, or writes application state.
export function buildAssistantFactPacket(context={},identity={}){
 const snapshot=context.input_snapshot, p=context.prediction, o=context.observation;
 const snapshotId=context.request_snapshot_id??snapshot?.snapshot_id??null;
 const matches=Boolean(snapshotId&&snapshot?.snapshot_id===snapshotId&&p?.snapshot_id===snapshotId&&p.input_hash===snapshot.input_hash);
 const ready=matches&&p?.mode==='formal'&&finite(p.value)&&(!context.prediction_status||context.prediction_status==='READY');
 const actualAvailable=Boolean(snapshotId&&o?.observation_id&&o.snapshot_id===snapshotId&&o.input_hash===snapshot?.input_hash&&finite(o.value));
 const prediction=ready?p.value:null,actual=actualAvailable?o.value:null;
 const delta=prediction!==null&&actual!==null?prediction-actual:null;
 const input=summarizeModelInputs(context.caseData||{});
 let rangeStatus='INSUFFICIENT_HISTORY',outCount=0;
 try{
  const projection=effectiveRangeProjection(context.caseData,DEFAULT_INPUT_RANGE_TABLE,context.historicalRangeLimits);
  outCount=projection.effectiveRanges.filter(row=>['BELOW_RANGE','ABOVE_RANGE'].includes(row.range_status)).length;
  rangeStatus=outCount?'HAS_OUT_OF_RANGE':!projection.checked||projection.effectiveRanges.some(row=>row.range_status==='INSUFFICIENT_HISTORY')?'INSUFFICIENT_HISTORY':'ALL_IN_RANGE';
 }catch{/* Missing input is unknown, never an all-in-range verdict. */}
 const records=context.diagnostics,related=(records?.findings||[]).filter(f=>f.status==='VALID'&&f.kind==='S5_PREDICTION_OBSERVATION_DIFFERENCE'&&f.snapshot_id===snapshotId&&f.observation_id===o?.observation_id);
 const ids=related.flatMap(f=>f.evidence_ids||[]),evidence=(records?.evidence||[]).filter(e=>ids.includes(e.evidence_id));
 const evidenceStatus=actualAvailable&&records?.status==='VALID'&&ids.length&&evidence.length===new Set(ids).size&&evidence.every(e=>e.status==='VALID')?'VERIFIED':actualAvailable?'PAIRED_RECORD':'UNAVAILABLE';
 return deepFreeze({request_id:identity.request_id??context.request_id??null,user_message_id:identity.user_message_id??context.user_message_id??null,snapshot_id:snapshotId,
  prediction_t:prediction,actual_available:actualAvailable,actual_t:actual,delta_t:delta,absolute_delta_t:delta===null?null:Math.abs(delta),
  direction:delta===null?'UNKNOWN':delta<0?'BELOW':delta>0?'ABOVE':'EQUAL',actual_source:actualAvailable?(o.source??null):null,actual_evidence_status:evidenceStatus,
  input_complete_count:input.completeCount,input_total_count:input.total,range_status:rangeStatus,out_of_range_count:outCount,
  prediction_status:ready?'READY':context.prediction_status==='PENDING'?'PENDING':'UNAVAILABLE',snapshot_match_status:matches?'MATCHED':snapshotId&&p?'MISMATCHED':'UNAVAILABLE',
  model_identity:ready?{name:'QCDKR',version:p.model_version??null,sha256:p.model_hash??null}:null});
}

export function assistantFactFields(packet){return [
 {label:'S5 预测值',value:factForce(packet.prediction_t)},
 {label:'S5 实际值',value:factForce(packet.actual_t)},
 {label:'预测－实际值差值',value:factForce(packet.delta_t)},
 {label:'绝对差值',value:factForce(packet.absolute_delta_t)},
 {label:'方向',value:factDirectionLabel(packet.direction)},
 {label:'实际值来源',value:assistantActualSourceLabel(packet.actual_source)},
 {label:'配对状态',value:packet.actual_available?'与提问时冻结工况配对':'当前没有与该工况配对的有效实际值'},
 {label:'证据状态',value:({VERIFIED:'关联证据已核验',PAIRED_RECORD:'已配对记录；未确认完整诊断证据',UNAVAILABLE:'尚无有效实际值依据'})[packet.actual_evidence_status]},
 {label:'输入完整性',value:`${packet.input_complete_count} / ${packet.input_total_count}项完整`},
 {label:'输入有效范围检查',value:({ALL_IN_RANGE:'全部处于有效范围内',HAS_OUT_OF_RANGE:'存在超出有效范围的输入',INSUFFICIENT_HISTORY:'范围信息不足，未作完整判定'})[packet.range_status]},
 {label:'预测状态',value:packet.prediction_status==='READY'?'已完成':'当前预测尚未完成 / 当前没有有效预测结果'}
];}
export const assistantEvidenceBoundary='当前记录能够确认已提供的预测值、实际值、配对关系和数值差异。单条差值不能确定具体工艺根因、设备或测量系统故障、模型失效，也不能评价模型整体精度。';

// Keep parameter changes, configuration and knowledge questions on their
// existing routes; these read-only condition questions share the fact pipeline.
export function isFactDiagnosticQuestion(message){
 if(['RULE','SERVICE'].includes(classifyAssistantIntent(message).domain))return false;
 const q=String(message||'').replace(/\s/g,'');
 if(/试算|方案|候选|阈值|报警|预警|告警|设为|改为|改成|提高|降低|调整|原理|是什么/.test(q)&&!/差异依据是什么/.test(q))return false;
 return /预测.{0,16}(?:实际|观测|实测).{0,16}(?:差异|不同|偏差|依据)|为什么预测(?:值)?(?:偏)?低|当前工况(?:怎么看|如何|分析)|哪些参数有问题|当前预测(?:值)?(?:可靠|可信)|预测(?:值)?比实际(?:值)?(?:高|低)/.test(q);
}
