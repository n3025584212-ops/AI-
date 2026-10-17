import { readableConditionName } from './userVisibleText.js';
import { ArrowRight } from 'lucide-react';
const value=n=>Number.isFinite(n)?n.toFixed(3):'—';
export default function AgentComparison({comparison,reference}) {
 if(!comparison)return null;
 return <section className="agent-comparison-view" data-comparison-ref={reference} aria-label="本次工况对比"><div className="replay-current"><div><small>参考工况 · {readableConditionName(comparison.referenceCaseId, "参考工况")}</small><strong>{value(comparison.referenceT)} t</strong></div><ArrowRight size={21}/><div><small>当前工况 · {readableConditionName(comparison.currentCaseId)}</small><strong>{value(comparison.currentT)} t</strong></div><div><small>当前 − 参考</small><strong>{value(comparison.deltaT)} t</strong></div></div><h3>输入参数变化</h3><table><thead><tr><th>机架 / 参数</th><th>参考</th><th>当前</th><th>单位</th></tr></thead><tbody>{(comparison.changes||[]).map((change,index)=><tr key={index}><td>{change.stand} {change.label||change.name||change.measurement}</td><td>{value(change.reference)}</td><td>{value(change.current)}</td><td>{change.unit}</td></tr>)}</tbody></table>{!comparison.changes?.length&&<p>两份工况的 25 维模型输入相同。</p>}<details className="prediction-record-technical"><summary>查看技术信息</summary><pre>{JSON.stringify(comparison,null,2)}</pre></details></section>;
}
