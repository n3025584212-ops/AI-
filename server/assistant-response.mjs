import {assistantFactFields,assistantEvidenceBoundary,factDirectionLabel} from '../src/assistantFacts.js';
import {hasNumericBoundaryViolation} from './interpretation-boundary.mjs';

// The model supplies explanation only. Numerical facts and verdicts remain
// deterministic and are rendered from the frozen packet, never its prose.
export function validFactInterpretation(text,packet){
 if(typeof text!=='string'||!text.trim()||text.length>1200)return false;
 text=text.normalize('NFKC');
 if(hasNumericBoundaryViolation(text))return false;
 const stripped=text.replace(/\b(?:S[1-5]|25|5)\b/g,'');
 if(/\d|[零一二三四五六七八九十百千万]+(?:[点个百分点]|\s*(?:吨|t|项完整))/.test(stripped))return false;
 if(/(?:预测|实际值|差值|完整度|范围)[^。；]*[零二三四五六七八九十百千万]/.test(stripped))return false;
 if(/预测(?:值)?.{0,6}(?:高于|超过|比.{0,5}高).{0,6}实际/.test(text)&&packet.direction!=='ABOVE')return false;
 if(/预测(?:值)?.{0,6}(?:低于|比.{0,5}低).{0,6}实际/.test(text)&&packet.direction!=='BELOW')return false;
 if(/实际(?:值)?.{0,6}(?:高于|超过).{0,6}预测/.test(text)&&packet.direction!=='BELOW')return false;
 if(/实际(?:值)?.{0,6}低于.{0,6}预测/.test(text)&&packet.direction!=='ABOVE')return false;
 for(const clause of text.split(/[。；！？\n]/)){
  if(!/预测/.test(clause)||!/实际/.test(clause))continue;
  const negativeEquality=/(?:不|未)(?:一致|相等|相同|等于|持平)/.test(clause);
  const positiveEquality=/(?:一致|相等|相同|等于|持平)/.test(clause.replace(/(?:不|未)(?:一致|相等|相同|等于|持平)/g,''));
  if(positiveEquality&&packet.direction!=='EQUAL'||negativeEquality&&!['ABOVE','BELOW'].includes(packet.direction))return false;
  if(/预测(?:值)?(?:比|较)实际(?:值)?.{0,4}(?:高|大)/.test(clause)&&packet.direction!=='ABOVE')return false;
  if(/预测(?:值)?(?:比|较)实际(?:值)?.{0,4}(?:低|小)/.test(clause)&&packet.direction!=='BELOW')return false;
  if(/实际(?:值)?(?:比|较)预测(?:值)?.{0,4}(?:高|大)/.test(clause)&&packet.direction!=='BELOW')return false;
  if(/实际(?:值)?(?:比|较)预测(?:值)?.{0,4}(?:低|小)/.test(clause)&&packet.direction!=='ABOVE')return false;
 }
 if(!packet.actual_available&&/实际值(?:已|可用|完整)|可以计算.{0,6}差/.test(text))return false;
 if(!packet.actual_available&&/(?:依据是|依据为|基于|来自).{0,30}配对实际值记录|现有比较(?:只能|已|可以)确认差异/.test(text))return false;
 if(packet.prediction_status!=='READY'&&/预测(?:已完成|结果可用)/.test(text))return false;
 if(packet.range_status!=='ALL_IN_RANGE'&&/全部.{0,6}范围内|所有参数.{0,6}正常/.test(text))return false;
 if(packet.range_status==='ALL_IN_RANGE'&&/(?:参数|输入|当前值).{0,6}(?:超出|低于|高于).{0,6}范围/.test(text))return false;
 if(packet.range_status==='INSUFFICIENT_HISTORY'&&/(?:参数|输入|当前值).{0,6}(?:处于|超出|低于|高于).{0,6}范围/.test(text))return false;
 if(packet.input_complete_count===packet.input_total_count&&/输入.{0,6}(?:不完整|缺失|未完整)/.test(text))return false;
 if(packet.input_complete_count!==packet.input_total_count&&/输入(?:已|全部|保持)?完整/.test(text))return false;
 if(packet.actual_evidence_status!=='VERIFIED'&&/证据.{0,4}(?:已核验|已校验|已验证)/.test(text))return false;
 if(/实际值.{0,10}(?:来源是|来源为|来自)/.test(text)&&(!packet.actual_source||!text.includes(packet.actual_source)))return false;
 if(/(?:已经|确认|证明|确定).{0,8}(?:根因|故障|模型失效)|(?:依据|因为|原因).{0,18}实际值(?:保持)?独立/.test(text))return false;
 // Pairing verification does not establish timestamp alignment or measurement accuracy.
 if(/(?:存在|具有|出现|发生|有|产生).{0,6}(?:时间差|时间错位|采样延迟|测量误差)|(?:采样|记录|测量).{0,6}(?:不同步|错位)|(?:实际值|测量(?:值|数据)?).{0,8}(?:准确性|精度).{0,6}(?:已核实|已验证|已确认)/.test(text))return false;
 if(/导致|造成|引起|源于|归因|由.{0,24}(?:产生|形成|出现)|可能(?:是|为)|(?:原因|根因)(?:是|为|在)|(?:张力|速度|厚度|弯辊|来料|辊系).{0,16}(?:是|为).{0,8}(?:原因|根因)|模型(?:已)?失效|故障(?:已|发生)|整体(?:精度|准确率).{0,6}(?:高|低|好|差)/.test(text))return false;
 return true;
}
export const factExplanationPrompt=`你是DK AI只读工况解读助手。FACT_PACKET是唯一事实来源。
字段语义：prediction_t、actual_t、delta_t、absolute_delta_t均为S5轧制力，单位t（吨），后缀_t不是时间。delta_t是预测轧制力减实际轧制力，绝不是时间差或秒数。时间戳不构成采样不同步的证据。
用简短中文解释用户所问记录的意义和证据边界。程序已经单独显示预测、实际值、差值、方向、来源、模型身份、完整度和范围状态；解读不要复述这些字段，不写业务数字或中文数字转写，只允许标识S1/S2/S3/S4/S5/25/5。禁止重新计算或补全事实。
差异判断的依据是提问时同工况的配对记录和数值比较，不是工艺成因证据。配对证据已核验不表示测量准确性、时间同步或模型精度已验证。没有配对实际值时说明不能比较，预测未完成时说明需等待正式结果。
对于为什么偏高或偏低，只能说明现有记录不足以确定工艺原因；不要使用导致、造成、引起、源于、归因、可能是等因果或猜测表述，不要编造时间差、采样延迟、测量误差、设备故障或模型失效。
合格解读示例（仅actual_available=true且prediction_status=READY时适用）：判断依据是提问时同工况的预测与配对实际值记录。现有比较只能确认差异现象，不能单凭这些记录确定工艺原因。
actual_available=false时的示例：当前没有配对实际值，不能计算预测与实际值差异。可先核对实际值记录后再比较。
只返回符合Schema的JSON，interpretation为非空字符串。`;
export const factExplanationSchema=Object.freeze({type:'object',properties:{interpretation:{type:'string',minLength:1,maxLength:1200}},required:['interpretation'],additionalProperties:false});
export function preparedFactResponse(packet){
 return {fact_packet:packet,facts_state:'READY',ai_explanation_state:'LOADING',diagnosis_title:'工况记录解读',
  diagnostic_sections:{facts:assistantFactFields(packet),technical:[{label:'FACT_PACKET',value:JSON.stringify(packet,null,2)}],interpretation:'DK AI正在解读…',
   checks:[packet.actual_available?'实际值记录与提问时工况配对。':'当前没有与该工况配对的有效实际值，因此不能计算预测与实际值差异。'],boundary:assistantEvidenceBoundary,next:[]}};
}
export async function explainFactPacket({packet,query,llm,signal}){
 const prepared=preparedFactResponse(packet);let interpretation='当前证据不足以解释具体工艺原因，可核对提问时的配对记录和输入检查。',error=null,calls=0;
 const trace={EXPLANATION_SOURCE:'FACT_PACKET',OUTPUT_FORMAT:'INTERPRETATION_JSON_SCHEMA',QWEN_RAW_RESULT_PRESENT:false,OUTPUT_SHAPE_VALIDATION_RESULT:'NOT_REACHED',OUTPUT_VALIDATION_RESULT:'NOT_REACHED'};
 try{
  const recordBoundary=!packet.actual_available?'当前缺少配对实际值。不能声称已有配对实际值记录、已有比较结果或已确认差异。'
   :packet.prediction_status!=='READY'?'当前预测尚未完成，不能声称已有比较结果。':'已有同工况配对记录，仅解释比较依据和证据边界。';
  calls=1;const response=await llm.chat([{role:'system',content:factExplanationPrompt},{role:'user',content:JSON.stringify({question:query,FACT_PACKET:packet,confirmed_direction:factDirectionLabel(packet.direction),record_boundary:recordBoundary})}],{signal,format:factExplanationSchema,maxTokens:512});
  signal?.throwIfAborted();trace.QWEN_RAW_RESULT_PRESENT=Boolean(response.message?.content);
  let output;try{output=JSON.parse(response.message?.content||'{}');}catch{ /* Invalid model output is not a transport failure. */ }
  trace.OUTPUT_SHAPE_VALIDATION_RESULT=output&&typeof output.interpretation==='string'&&Object.keys(output).length===1?'PASS':'FAIL';
  if(trace.OUTPUT_SHAPE_VALIDATION_RESULT!=='PASS')throw Object.assign(Error('FACT_INTERPRETATION_INVALID_FORMAT'),{code:'FACT_INTERPRETATION_INVALID_FORMAT'});
  const value=output.interpretation;trace.OUTPUT_VALIDATION_RESULT=validFactInterpretation(value,packet)?'PASS':'FAIL';
  if(trace.OUTPUT_VALIDATION_RESULT!=='PASS')throw Object.assign(Error('FACT_INTERPRETATION_REJECTED'),{code:'FACT_INTERPRETATION_REJECTED'});
  interpretation=value.trim();
 }catch(e){if(signal?.aborted)throw e;error=e.code||'QWEN_ERROR';}
 const sections={...prepared.diagnostic_sections,interpretation};
 const text=sections.facts.map(f=>f.label+'：'+f.value).join('\n')+'\n\nDK AI工艺解读\n'+interpretation+'\n\n'+sections.boundary;
 return {...prepared,diagnostic_sections:sections,text,explanation_text:interpretation,ai_explanation_state:error?'FAILED':'READY',generationError:error,
  ai_explanation_primary_failure:error,ai_explanation_trace:{...trace,FINAL_AI_EXPLANATION_STATUS:error?'FAILED':'READY'},
  status:error?'partial':'completed',response_source:error?'FALLBACK':'PRIMARY',llmCalls:{tool_router:0,answer_attempt:calls,answer_success:error?0:1,total:calls}};
}
