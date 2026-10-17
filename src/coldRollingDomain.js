// A shared vocabulary for intent and skill routing, not a model-input contract.
export const COLD_ROLLING_DOMAIN_GLOSSARY = Object.freeze({
  process: Object.freeze(['冷轧', '冷连轧', '串列冷轧', '串列冷连轧', '轧制', '轧制规程', '压下', '压下量', '压下率', '道次', '压下制度', 'cold rolling', 'tandem cold rolling']),
  product: Object.freeze(['带钢', '板带', '板材', '宽度', '厚度', '入口厚度', '出口厚度', '设定厚度', '实际厚度', '入口设定厚度', '入口实际厚度']),
  equipment: Object.freeze(['轧机', '机架', 'S1', 'S2', 'S3', 'S4', 'S5', '五机架', '六辊', 'UCM', 'UC-Mill', '工作辊', '中间辊', '支承辊', '辊系', '辊缝', 'work roll', 'intermediate roll', 'backup roll', 'roll gap']),
  force: Object.freeze(['轧制力', '轧制载荷', '接触压力', '弯辊', '弯辊力', '张力', '前张力', '后张力', '机架间张力', '张应力', 'rolling force', 'rolling load', 'front tension', 'back tension', 'interstand tension', 'bending']),
  deformation: Object.freeze(['轧制速度', '带钢速度', '轧辊速度', '前滑', '中性点', '质量流量', '摩擦', '变形抗力', '平面应变', '塑性变形', 'rolling speed', 'strip speed', 'forward slip', 'neutral point']),
  control: Object.freeze(['板形', '平直度', 'AGC', '板厚控制', '中间辊移位', 'flatness', 'gauge control']),
  lubrication: Object.freeze(['润滑', '轧制油', '乳化液', '冷却', 'lubrication', 'rolling oil', 'emulsion', 'cooling']),
});
const normalized = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
// Manually curated from the existing seed; never inferred from headings or LLMs.
export const CURATED_DOMAIN_TERM_REGISTRY = Object.freeze(['冷轧','冷连轧','轧制力','压下率','前张力','后张力','弯辊力','板形','UCM','UCM轧机','轧制速度','轧制油','乳化液','润滑','冷却']);
const queryText = value => String(value ?? '').normalize('NFKC').trim().replace(/^[，。！？!?：:、\s]+|[，。！？!?：:、\s]+$/g,'').replace(/\s/g,'');
export function bareDomainConcept(message) {
  const key=normalized(queryText(message));
  return CURATED_DOMAIN_TERM_REGISTRY.find(term=>normalized(term)===key) || null;
}
export const isKnowledgeDetailFollowup = message => /^(?:请)?(?:详细说说|详细解释(?:一下)?|展开讲讲|再详细一点|具体是什么意思|能详细介绍一下吗|具体一点|多说一点)$/.test(queryText(message));
export const isExplicitKnowledgeDetail = message => /^(?:请)?(?:详细说说|详细解释|详细介绍|展开讲讲|具体讲讲).+/.test(queryText(message)) && !isKnowledgeDetailFollowup(message);
// Use the current visible conversation only. No search backwards past a final
// non-knowledge answer, and no client-selected concept in the request payload.
export function adjacentKnowledgeFollowup(messages, uiRevision) {
  const visible=(messages || []).filter(message=>!message.hidden && !['loading','streaming','tool-trace','system'].includes(message.mode) && ['assistant','user'].includes(message.role));
  const previous=visible.at(-1);
  return previous?.role==='assistant' && previous.status==='completed' && previous.intent?.domain==='DOMAIN_KNOWLEDGE' && previous.answerScope==='KNOWLEDGE' && typeof previous.target_concept==='string' && previous.target_concept.trim() && !/[、，,；;]|[和与].+/.test(previous.target_concept) && previous.runId && (uiRevision===undefined || previous.knowledge_ui_revision===uiRevision) ? {run_id:previous.runId} : null;
}
export function domainTerms(message) {
  const text = normalized(message);
  const words = String(message ?? '').normalize('NFKC').toLowerCase();
  return Object.values(COLD_ROLLING_DOMAIN_GLOSSARY).flat().filter(term => {
    const key = normalized(term);
    if (/^[a-z0-9-]+$/.test(key)) {
      const escaped = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
      return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`).test(words);
    }
    return text.includes(key);
  });
}
export function isKnowledgeQuestion(message) {
  return /是什么|什么是|什么意思|怎么理解|有什么作用|为什么|有什么区别|有什么关系|如何工作|原理|是干什么的|怎么定义|解释|介绍|what\s+is|what\s+are|how\s+does|why|difference|define/i.test(String(message));
}
export function isDomainKnowledgeQuestion(message) {
  return Boolean(bareDomainConcept(message)) || (isKnowledgeQuestion(message) || isExplicitKnowledgeDetail(message)) && domainTerms(message).length > 0;
}
