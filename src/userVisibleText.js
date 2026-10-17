// Display projections only. Original records, identities and model values stay unchanged.
import { modelBrandDisplayText } from './productBrand.js';
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HASH = /\b[0-9a-f]{32,128}\b/gi;
const identities = /\b(?:model_hash|modelHash|input_hash|inputHash|snapshot_id|baseline_snapshot_id|draft_snapshot_id|candidate_id|draft_id|sampleId|sample_id|task_id|taskId|runId|log_id|UUID|SHA-256)\b/i;
export const isTechnicalLabel=value=>identities.test(String(value||''))
 || /(?:模型指纹|模型哈希|输入哈希|日志编号|任务编号|样本编号|快照编号|快照身份|snapshot|\bhash\b)/i.test(String(value||''));
const states = {
 READY:'运行正常', MODEL_OK:'模型运行正常', VERIFIED:'已验证', PASS:'通过', FAIL:'未通过',
 IN_RANGE:'均在当前参考范围内', OUT_OF_RANGE:'超出当前参考范围', formal:'正式模型',
 PREDICTING:'正在预测', LOADING:'正在加载', CONNECTING:'正在连接', FAILED:'处理失败',
 BLOCKED:'暂不可用', UNAVAILABLE:'暂不可用', STALE:'已过期', CANCELLED:'已取消',
 COMPLETED:'已完成', PENDING:'等待处理', RUNNING:'正在处理', NOT_RUN:'尚未执行',
 NORMAL:'正常', LOW_ERROR_ALARM:'低于允许偏差下限', HIGH_ERROR_ALARM:'超出允许偏差上限',
 NO_ACTUAL:'暂无实际值', HISTORICAL:'历史结果', prediction:'轧制力预测',
 rawPrediction:'预测值', actualValue:'实际值', model_version:'模型', modelVersion:'模型',
 MODEL_NOT_READY:'模型尚未就绪', MODEL_UNAVAILABLE:'预测模型暂不可用', MODEL_LOADING:'预测模型加载中',
 MODEL_EXITED:'预测服务连接已中断', PLAN_STALE:'方案已过期', STALE_REFERENCE:'当前参考值已更新',
 status:'状态', mode:'运行模式', reason:'说明'
};
export function modelDisplayName(value) {
 if (!value) return '—';
 return /^(?:DK-?QKAR|QCDKR)[- ]V5S2(?:\b|-)/i.test(String(value)) ? 'QCDKR V5S2' : /^(?:DK-?QKAR|QCDKR)$/i.test(String(value)) ? 'QCDKR' : '预测模型';
}
export function readableConditionName(value, fallback='当前工况') {
 if (typeof value !== 'string' || !value.trim()) return fallback;
 const name=value.trim();
 if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(name)
  || /^[0-9a-f]{24,}$/i.test(name) || /^(?:REAL_SAME_SPEC_|SYNTHETIC_|snapshot[:_-]|sample[:_-])/i.test(name)
  || name.length>80 || identities.test(name)) return fallback;
 return name.replaceAll('当前分析工况','当前工况').replaceAll('工况草案','方案工况');
}
function queueText(value) {
 try {
  const queue=JSON.parse(value);
  if (!queue || typeof queue!=='object' || !Number.isFinite(queue.running)) return null;
  const pending=Number.isFinite(queue.pending)&&queue.pending>0?`，${queue.pending}项等待处理`:'';
  return `当前任务：${queue.running}项正在运行${pending}`;
 } catch { return null; }
}
function structuredSummary(record) {
 if (!record || typeof record!=='object' || Array.isArray(record)) return '';
 const lines=[];
 if (Number.isFinite(record.running)) return queueText(JSON.stringify(record));
 if (record.model_version||record.modelVersion) lines.push('当前模型：'+modelDisplayName(record.model_version||record.modelVersion));
 if (states[record.status]) lines.push('状态：'+states[record.status]);
 if (record.mode==='formal') lines.push('运行模式：正式模型');
 if (states[record.rangeStatus]) lines.push('输入范围：'+states[record.rangeStatus]);
 if (Number.isFinite(record.rawPrediction)) lines.push('预测值：'+record.rawPrediction.toFixed(3)+' t');
 if (Object.hasOwn(record,'actualValue')) lines.push('实际值：'+(Number.isFinite(record.actualValue)?record.actualValue.toFixed(3)+' t':'—'));
 return lines.join('\n');
}
function projectJsonBlocks(raw,onTechnical) {
 let output='',cursor=0;
 for(let start=0;start<raw.length;start++) {
  if(raw[start]!=='{'&&raw[start]!=='[')continue;
  if(raw[start]==='['&&/^\[\d+\]/.test(raw.slice(start)))continue;
  let depth=0,quoted=false,escaped=false;
  for(let end=start;end<raw.length;end++) {
   const char=raw[end];
   if(quoted) {if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
   if(char==='"')quoted=true;
   else if(char==='{'||char==='[')depth++;
   else if(char==='}'||char===']')depth--;
   if(depth!==0)continue;
   try {
    const block=JSON.parse(raw.slice(start,end+1));
    if(block&&typeof block==='object') {
     onTechnical();output+=raw.slice(cursor,start)+(structuredSummary(block)||'详细信息请展开查看');
     cursor=end+1;start=end;
    }
   } catch { /* A citation or ordinary bracketed phrase is not JSON data. */ }
   break;
  }
 }
 return output+raw.slice(cursor);
}
export function userTextProjection(value) {
 const raw=value==null?'':typeof value==='string'?value:JSON.stringify(value,null,2);
 let technical=typeof value==='object'&&value!==null;
 try {
  const parsed=JSON.parse(raw);
  if (parsed!==null&&typeof parsed==='object'&&!/^\s*\[\d+\]\s*$/.test(raw)) {
   return {text:structuredSummary(parsed)||'详细信息请展开查看',technical:true,raw};
  }
 } catch { /* Ordinary text is projected below. */ }
 const readable=projectJsonBlocks(raw,()=>{technical=true;});
 let text=readable.split('\n').map(line=>{
  const queue=line.match(/\{[^{}]*"running"\s*:[^{}]*\}/);
  if(queue) { const summary=queueText(queue[0]);if(summary){technical=true;return summary;} }
  if (identities.test(line)) {technical=true;return '';}
  if (/^\s*```(?:json)?\s*$/.test(line)) {technical=true;return '';}
  const field=line.match(/^\s*(?:[-*]\s*)?([a-z][a-zA-Z0-9_]+)\s*[:=]/);
  if(field&&!states[field[1]]) {technical=true;return '';}
  if (/^\s*(?:[-*]\s*)?(?:日志编号|任务编号|样本编号|模型指纹|模型哈希|输入哈希|快照编号)\s*[:：]/.test(line)) {technical=true;return '';}
  if (/^\s*[\[{]/.test(line) && !/^\s*\[\d+\]/.test(line)) {technical=true;return '';}
  if (/^\s*"[^"]+"\s*:/.test(line) || /^\s*[}\]]\s*,?\s*$/.test(line)) {technical=true;return '';}
  return line;
 }).join('\n');
 text=text.replace(/(?:DK-?QKAR|QCDKR)-V5S2-[\w-]+/gi,()=>{technical=true;return 'QCDKR V5S2';});
 text=text.replace(UUID,()=>{technical=true;return '对应记录';}).replace(HASH,()=>{technical=true;return '技术标识';});
 text=text.replace(/\bREAL_SAME_SPEC_[^\s，。；）)]+/g,()=>{technical=true;return '当前工况';});
 text=text.replace(/\b(?:[A-Za-z_]\w*\.)+[a-z_]\w*\b/g,match=>{
  // Preserve filenames and numeric/model notation; internal tool calls belong in technical information.
  if (/\.(?:pdf|csv|xlsx|md|json|png|jpg)$/i.test(match)) return match;
  if (/^(?:runtime|diagnostic|data|prediction|analysis|events|history|knowledge|rules|service|trials|ui)\./.test(match)) {technical=true;return '相关操作';}
  return match;
 });
 text=text.replace(/\b(?:READY|MODEL_OK|VERIFIED|PASS|FAIL|IN_RANGE|OUT_OF_RANGE|formal|PREDICTING|LOADING|CONNECTING|FAILED|BLOCKED|UNAVAILABLE|STALE|CANCELLED|COMPLETED|PENDING|RUNNING|NOT_RUN|NORMAL|LOW_ERROR_ALARM|HIGH_ERROR_ALARM|NO_ACTUAL|HISTORICAL|prediction|rawPrediction|actualValue|model_version|modelVersion|status|mode|reason)\b/g,match=>{technical=true;return states[match];});
 text=text.replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g,match=>{technical=true;return states[match]||'处理提示（详见技术信息）';});
 text=text.replace(/\b(?:snapshot|hash|candidate_id|draft_id|input_hash|sampleId)\b/g,()=>{technical=true;return '相关记录';});
 text=text.replaceAll('当前分析工况','当前工况').replaceAll('工况草案','方案工况')
  .replaceAll('历史结果 · 工况或实际值版本已变化','当前工况已更新，请以最新分析结果为准')
  .replaceAll('基于先前工况快照','当前工况已更新，请以最新分析结果为准');
 text=text.replace(/任务队列\s*[:：]\s*当前任务\s*[:：]/g,'当前任务：');
 // Remaining raw JSON is retained only in the original-text fold.
 if (/["'][\w]+["']\s*:/.test(text)) {technical=true;text=text.replace(/\{[^{}]*\}/g,'').replace(/^\s*[{}].*$/gm,'');}
 text=text.replace(/\n{3,}/g,'\n\n').trim();
 return {text:modelBrandDisplayText(text)|| (raw?'详细信息请展开查看':'—'),technical,raw};
}
export const userVisibleText=value=>userTextProjection(value).text;
