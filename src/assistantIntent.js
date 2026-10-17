import { isDomainKnowledgeQuestion } from './coldRollingDomain.js';
// Shared deterministic request classification. This registry contains names and
// relationships only; configuration values always come from the server tool.
const RULE_REFERENCES = Object.freeze([
  ['prediction-error', ['S5预测与实际值偏差', '预测与实际值偏差', 'S5预测与实测偏差', '预测与实测偏差', '预测偏差']],
  ['input-completeness', ['模型输入完整度', '输入完整度', '25维完整度']],
  ['input-drift', ['输入窗口均值变化', '输入漂移']],
  ['input-range', ['输入超出训练范围', '训练范围', '输入范围']],
  ['prediction-service', ['预测服务连续失败', '预测服务失败']],
  ['data-interruption', ['现场数据源中断或延迟', '数据源中断', '数据延迟']],
]);
const compact = value => String(value ?? '').replace(/\s/g, '').toLowerCase();
// Remove only a delimited leading greeting; keep the original business precedence.
export const requestText = value => compact(value).replace(/^(?:你好|您好|嗨|哈喽|hello|hi)[，,：:；;。？！?!]+(?=[^，,：:；;。？！?!])/, '');
export function resolveRuleReferences(message) {
  const text = compact(message);
  const exact = RULE_REFERENCES.filter(([id, aliases]) => new RegExp(`(^|[^a-z0-9-])${id}(?=$|[^a-z0-9-])`).test(text) || aliases.some(alias => text.includes(compact(alias)))).map(([id]) => id);
  const related = /s5.*(?:轧制力|预测)/i.test(text) && /阈值|预警|报警|告警|规则/.test(text) && !exact.includes('prediction-error') ? ['prediction-error'] : [];
  return { exact, related };
}

// Targets are supplied by the accepted current diagnostics, never a stand list.
export function diagnosticTargets(message, diagnostics) {
  const text = compact(message);
  const targets = [...new Set((diagnostics?.findings || []).flatMap(f => f.targets || []))];
  return targets.filter(target => {
    const escaped = compact(target).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped && new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`).test(text);
  });
}
export function isRootCauseQuestion(message) {
  const text = requestText(message);
  // Explicit model/prediction questions retain their existing analysis route.
  if (/预测|模型/.test(text)) return false;
  const sentence = text.replace(/[，,：:；;。？！?!]/g, '');
  if (/(?:当前|现在|这次|本次|这卷).*(?:轧制力|张力|辊系|来料|速度|厚度|材料).*(?:导致|造成|引起|原因|根因)/.test(sentence)) return true;
  return /^(?:为什么s5轧制力(?:偏高|高)|s5轧制力为什么(?:偏高|高)|s5轧制力(?:偏高|高)(?:是什么原因|的原因是什么)|是什么导致s5轧制力(?:偏高|高)|什么原因造成s5轧制力(?:偏高|高))$/.test(sentence)
    || /^(?:为什么|是什么导致|什么导致|什么原因导致|何种原因导致).*(?:轧制力|张力|辊系|来料|速度|厚度|材料).*(?:偏高|偏低|升高|降低|变化|高|低|故障|异常)[？?。！!]*$/.test(text);
}
export function classifyAssistantIntent(message, diagnostics) {
  const text = requestText(message), matches = resolveRuleReferences(text);
  const result = (domain, action, scope, certainty = 'EXPLICIT', entityRef = null, parsedChange = null, requiresTool = true) => ({ domain, action, scope, requiresTool, certainty, entityRef, parsedChange });
  if (/天气|新闻|笑话|电影|足球|世界杯|股票/.test(text)) return result('OTHER', 'NONE', 'SNAPSHOT', 'EXPLICIT', null, null, false);
  if (isRootCauseQuestion(text)) return result('ROOT_CAUSE_BOUNDARY', 'QUERY', 'SNAPSHOT');
  const targets = diagnosticTargets(text, diagnostics);
  const recordQuestion = /finding|evidence|诊断发现|这条诊断|这条发现|这条记录|诊断依据|当前有哪些诊断|列出当前分析发现|这个判断|这个发现|为什么关联这个/.test(text)
    || (diagnostics?.findings || []).some(f => [f.title, f.kind].some(value => value && text.includes(compact(value))))
    || targets.length > 0 && /为什么(?:是|关联)/.test(text);
  if (recordQuestion) return result('DIAGNOSTIC', 'QUERY', 'SNAPSHOT');
  // Domain precedes action: an operating parameter is never a rule write.
  if (/规则|阈值|预警|报警|告警|别再报/.test(text) || matches.exact.length) {
    const entity = matches.exact.length === 1 ? matches.exact[0] : null;
    if (/删除|清空|移除/.test(text)) return result('RULE', 'UNSUPPORTED_CHANGE', 'CONFIG', entity ? 'EXPLICIT' : 'AMBIGUOUS', entity);
    if (/是否|有没有|了吗|了没|启用状态|开启状态|关闭状态|禁用状态/.test(text) && !/改成|改为|设置为|设为|调整到|调到|提高到|降低到/.test(text)) return result('RULE', 'QUERY', 'CONFIG', entity ? 'EXPLICIT' : 'AMBIGUOUS', entity);
    const writes = text.match(/改成|改为|设置为|设为|调整到|调到|提高到|降低到|开启|启用|关闭|禁用/g) || [];
    const vague = /调高|调低|改大|改小|提高|降低|改一下|调整|修改|别再报/.test(text);
    if (writes.length || vague) {
      if (!entity || writes.length !== 1 || /是多少|是什么|查看|显示|告诉我|不要|不许|不能|无需|先不|(?:不|别)(?:开启|启用|关闭|禁用|改成|改为|设置|调|提高|降低)/.test(text)) return result('RULE', 'NEEDS_INPUT', 'CONFIG', 'AMBIGUOUS', entity);
      const verb = writes[0];
      if (/开启|启用|关闭|禁用/.test(verb)) {
        if (/调高|调低|改大|改小|提高|降低|改一下|调整|修改|\d[%％]/.test(text.replace(verb, ''))) return result('RULE', 'NEEDS_INPUT', 'CONFIG', 'AMBIGUOUS', entity);
        return result('RULE', 'CHANGE', 'CONFIG', 'EXPLICIT', entity, { enabled: /开启|启用/.test(verb) });
      }
      const value = /^(?:改成|改为|设置为|设为|调整到|调到|提高到|降低到)(-?\d+(?:\.\d+)?)(?:%|％|标准差|项|次|s)?[。！？!?]*$/i.exec(text.slice(text.indexOf(verb)));
      if (!value || !Number.isFinite(Number(value[1]))) return result('RULE', 'NEEDS_INPUT', 'CONFIG', 'AMBIGUOUS', entity);
      return result('RULE', 'CHANGE', 'CONFIG', 'EXPLICIT', entity, { threshold: Number(value[1]) });
    }
    return result('RULE', 'QUERY', 'CONFIG', entity ? 'EXPLICIT' : 'AMBIGUOUS', entity);
  }
  if (/模型原理|模型依据/.test(text)) return result('OTHER', 'QUERY', 'SNAPSHOT');
  if (/(?:预测服务|助手服务|ai服务|服务状态|服务.*(?:就绪|可用|故障|连接)|队列|(?:当前|现在).*模型|(?:什么|哪个)模型|大模型api|(?:助手|ai).*状态|模型.*(?:是什么|状态|版本|hash|可用|名称))/.test(text)) return result('SERVICE', 'QUERY', 'SERVICE');
  if (/试算|试试|(?:提高|降低|减少|增加|下调|上调|调整|改成|改为|设为|设置为).*(?:张力|弯辊|厚度|速度|宽度|轧制力)|(?:张力|弯辊|厚度|速度|宽度|轧制力).*(?:提高|降低|减少|增加|下调|上调|改成|改为|试算|调整|设为)/.test(text)) return result('PARAMETER', 'CHANGE', 'SNAPSHOT');
  if (!/预测|模型/.test(text) && isDomainKnowledgeQuestion(message)) return result('DOMAIN_KNOWLEDGE', 'QUERY', 'KNOWLEDGE');
  if (/工况|预测|输入|历史|相似|比较|对比|回放|偏差|误差|事件|导入|校验|完整|断开|故障|诊断|超时|日志|单位|知识|论文|文献|资料|张力|弯辊|轧制力|厚度|宽度|轧制速度|字段|依据|报告|优化|敏感|定位|高亮|聚焦|当前状态|松弛试验|保温时间/.test(text)) return result('SNAPSHOT', 'QUERY', 'SNAPSHOT');
  if (/^(?:请问)?(?:你好|您好|嗨|哈喽|在吗|你是谁|你叫什么|你有什么功能|你能做什么|谢谢|再见|hello|hi)[?？!！。]*$/i.test(text)) return result('OTHER', 'NONE', 'SNAPSHOT', 'EXPLICIT', null, null, false);
  return result('UNKNOWN', 'NEEDS_INPUT', 'SNAPSHOT', 'AMBIGUOUS');
}
