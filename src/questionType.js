import { MODEL_FEATURES } from './modelInputs.js';
import { classifyAssistantIntent, isRootCauseQuestion } from './assistantIntent.js';

export const QUESTION_TYPE = Object.freeze({
  PARAMETER_KNOWLEDGE:'PARAMETER_KNOWLEDGE', PARAMETER_CURRENT_VALUE:'PARAMETER_CURRENT_VALUE',
  DATA_CHECK_EXPLAIN:'DATA_CHECK_EXPLAIN', PREDICTION_EXPLAIN:'PREDICTION_EXPLAIN',
  TARGET_GAP_EXPLAIN:'TARGET_GAP_EXPLAIN', OBSERVATION_GAP_EXPLAIN:'OBSERVATION_GAP_EXPLAIN',
  CAUSAL_PROBE:'CAUSAL_PROBE', TRIAL_REQUEST:'TRIAL_REQUEST', CANDIDATE_REVIEW:'CANDIDATE_REVIEW',
});
export const QUESTION_TYPE_PRIORITY = Object.freeze([
  QUESTION_TYPE.TRIAL_REQUEST, QUESTION_TYPE.CAUSAL_PROBE, QUESTION_TYPE.CANDIDATE_REVIEW,
  QUESTION_TYPE.DATA_CHECK_EXPLAIN, QUESTION_TYPE.OBSERVATION_GAP_EXPLAIN,
  QUESTION_TYPE.TARGET_GAP_EXPLAIN, QUESTION_TYPE.PREDICTION_EXPLAIN,
  QUESTION_TYPE.PARAMETER_CURRENT_VALUE, QUESTION_TYPE.PARAMETER_KNOWLEDGE,
]);
export const BATCH2_QUESTION_TYPES = Object.freeze([
  QUESTION_TYPE.DATA_CHECK_EXPLAIN, QUESTION_TYPE.PREDICTION_EXPLAIN,
  QUESTION_TYPE.TARGET_GAP_EXPLAIN, QUESTION_TYPE.OBSERVATION_GAP_EXPLAIN,
]);
export const BATCH3_QUESTION_TYPES = Object.freeze([QUESTION_TYPE.CAUSAL_PROBE,QUESTION_TYPE.TRIAL_REQUEST,QUESTION_TYPE.CANDIDATE_REVIEW]);
const enabled = new Set([QUESTION_TYPE.PARAMETER_KNOWLEDGE,QUESTION_TYPE.PARAMETER_CURRENT_VALUE,...BATCH2_QUESTION_TYPES,...BATCH3_QUESTION_TYPES]);
const compact = value => String(value ?? '').normalize('NFKC').replace(/\s/g,'').toLowerCase();
const contains = (text,label) => {
  const value=compact(label),at=text.indexOf(value);
  if(at<0)return false;
  return !/[a-z0-9]/.test(value) || !/[a-z0-9]/.test(text[at-1] || '') && !/[a-z0-9]/.test(text[at+value.length] || '');
};

// Names and indices come from the existing canonical metadata, never from AI.
export function resolveQuestionParameter(message) {
  const text=compact(message),stands=[...text.matchAll(/(?:^|[^a-z0-9])s([1-5])(?=$|[^a-z0-9])/g)].map(match=>'S'+match[1]);
  let matches=MODEL_FEATURES.filter(feature=>contains(text,feature.label)||contains(text,feature.key));
  if(!matches.length)matches=MODEL_FEATURES.filter(feature=>{
    if(stands.length&&(!feature.stand || !stands.includes(feature.stand)))return false;
    const concept=feature.label.replace(/^S[1-5]\s*/, '');
    return contains(text,concept) || /张力/.test(text)&&['tension','frontTension'].includes(feature.field)
      || /入口厚度/.test(text)&&['entrySetThickness','entryThickness'].includes(feature.field);
  });
  return {status:matches.length===1?'RESOLVED':matches.length?'AMBIGUOUS':'NOT_FOUND',parameter:matches.length===1?matches[0]:null,choices:matches};
}

export function classifyQuestionType(message) {
  const text=compact(message),legacy=classifyAssistantIntent(message);
  // Configuration and service queries continue to use their existing Router.
  if(['RULE','SERVICE'].includes(legacy.domain))return null;
  const resolution=resolveQuestionParameter(message),hasParameter=resolution.choices.length>0;
  const knowledgeQuery=/是什么|什么是|什么意思|有什么作用|怎么理解|解释|介绍|what.?is/.test(text);
  const bareCurrentParameter=/现在|当前|目前|此刻|本工况/.test(text)&&!knowledgeQuery&&resolution.choices.some(feature=>
    [feature.label,feature.key].some(name=>{const remaining=text.replace(compact(name),'');return remaining!==text&&/^(?:(?:现在|当前|目前|此刻|本工况|的|请问|请|查看|查询|获取|显示|看看)|[？?。！!])*$/.test(remaining);}));
  const currentValueQuery=/多少|(?:当前|现在|目前|实时)值|(?:数值|读数|取值|的值)[？?。！!]*$/.test(text)
    || bareCurrentParameter;
  const rules={
    TRIAL_REQUEST:/试算|试试|试一下|候选工况|(?:改成|改为|设为|调整为)/.test(text)
      || hasParameter&&/(?:降低|提高|减少|增加|下调|上调|增大|减小)[+-]?(?:\d|\.)/.test(text),
    CAUSAL_PROBE:isRootCauseQuestion(message)||hasParameter&&/导致|造成|引起|根因|是不是.+原因|是不是.+(?:让|使).*(?:改善|更好|结果)/.test(text) || /是不是(?:这个|该).*(?:调整|方案|候选).*(?:更好|改善|作用|结果)/.test(text),
    CANDIDATE_REVIEW:/(?:候选|方案|草案|a\/b).*(?:解读|解释|评估|效果|比较|对比|怎么样|改善|值得采用|更接近目标)|(?:解读|解释|评估).*(?:候选|方案|草案)|(?:这个|该)调整.*(?:怎么样|改善|有效|值得采用)/.test(text),
    DATA_CHECK_EXPLAIN:/(?:数据检查|历史分布|参考范围|自定义范围|超范围|超出.*范围)/.test(text)
      || hasParameter&&/正常吗|是否正常|在.*范围|为什么.*(?:核验|黄色)|(?:黄色|标黄).*(?:为什么|解释)/.test(text),
    OBSERVATION_GAP_EXPLAIN:/(?:预测.*(?:观测|实测|实际值|现场值)|(?:观测|实测|实际值|现场值).*预测)/.test(text)&&/差|不一样|解释|为什么|说明|依据/.test(text)
      || /(?:观测|实际值).*(?:缺失|不可用|没有)|未提供.*实际值/.test(text),
    TARGET_GAP_EXPLAIN:/(?:预测.*目标|目标.*预测)/.test(text)&&/差|高|低|解释|为什么|说明|意思/.test(text)
      || /目标偏差|(?:没有|未|没)达到目标/.test(text),
    PREDICTION_EXPLAIN:/(?:解释|解读|为什么).*(?:预测|模型结果)|(?:预测|模型结果).*(?:怎么理解|依据是什么|什么意思|是什么意思|代表什么)|(?:dk-qkar|qcdkr).*结果.*(?:代表什么|什么意思)/.test(text),
    PARAMETER_CURRENT_VALUE:hasParameter&&currentValueQuery,
    PARAMETER_KNOWLEDGE:hasParameter&&knowledgeQuery,
  };
  const type=QUESTION_TYPE_PRIORITY.find(type=>rules[type]);
  return type?{question_type:type,enabled:enabled.has(type),status:enabled.has(type)?'ENABLED':'QUESTION_TYPE_RECOGNIZED_BUT_NOT_ENABLED_IN_BATCH1',resolution}:null;
}
