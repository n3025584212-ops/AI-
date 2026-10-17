import './agent-status.css';
import { knowledgeDisplayText } from './knowledgeDisplay.js';
import { actualDisplayText } from './s5ActualDisplay.js';
import UserVisibleText from './UserVisibleText.jsx';

const labels = { validate:'检查输入', predict:'模型预测', analyze:'影响分析', compare:'工况对比', optimize:'生成方案', knowledge:'检索资料', '3D':'定位测点', report:'生成报告', 'runtime.get_context':'读取请求上下文', 'diagnostic.query':'查询当前诊断依据', 'data.get_segment':'读取样本片段', 'data.validate':'检查输入', 'prediction.predict_s5':'计算 S5 预测', 'analysis.compare_segments':'比较工况', 'analysis.sensitivity':'分析参数影响', 'events.get_event':'读取事件', 'events.search':'查找事件', 'history.find_similar':'查找相似工况', 'knowledge.search':'检索资料', 'rules.get':'读取监测规则', 'rules.preview_change':'预览规则调整', 'service.inspect':'检查服务状态', 'trials.create_preview':'生成试算', 'ui.focus':'定位视图', 'ui.open_comparison':'打开工况对比', 'ui.open_replay':'载入预测数据' };
const states = { success:'完成', completed:'完成', error:'失败', failed:'失败', requested:'等待视图执行', pending:'等待视图执行', skipped:'未执行' };
export function downloadAgentReport(artifact) {
  const content = artifact?.content ?? artifact;
  const blob = new Blob([typeof content === 'string' ? content : JSON.stringify(content,null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob), link=document.createElement('a');
  link.href=url; link.download=artifact?.filename || 'DK工艺Agent-工况报告.json'; link.click();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
}
export default function AgentTrace({ trace=[], artifact }) {
  if (!trace.length) return null;
  return <details className="agent-trace"><summary>操作记录 <span>{trace.length} 项</span></summary><ol>{trace.map((step,index)=><li key={step.id||index} data-tool={step.tool} data-status={step.status}>
    <div><b>{labels[step.tool]||'相关操作'}</b><em>{states[step.status]||'状态待确认'}</em></div>
    <small>{step.startedAt?new Date(step.startedAt).toLocaleTimeString('zh-CN',{hour12:false}):''}{Number.isFinite(step.durationMs)?` · ${Math.round(step.durationMs)} ms`:''}</small>
    <UserVisibleText value={actualDisplayText(knowledgeDisplayText((typeof step.error==='object'?step.error.message:step.error) || step.summary || step.result?.summary || step.result?.message || (typeof step.result==='string'?step.result:''), step.result?.references || step.result?.passages))}/>
    <details><summary>查看技术信息</summary><pre>{JSON.stringify(step,null,2)}</pre></details>
  </li>)}</ol>{artifact&&<button type="button" onClick={()=>downloadAgentReport(artifact)}>下载本次工况报告</button>}</details>;
}
