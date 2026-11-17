import { classifyAssistantIntent } from '../src/assistantIntent.js';

// 意图解析：把"用户说的是什么"这件事交给模型，规则只做兜底与写操作护栏。
//
// 为什么默认 llm：本系统原先用 77 行正则决定走哪条链路，模型只在末端写文案，
// 看起来是脚本而不是 agent。改成模型主导后，同义说法、复合诉求、信息不足时的
// 追问都能被识别出来。
//
// 三条不变量：
// 1. 写配置（RULE + CHANGE/UNSUPPORTED_CHANGE）永远走规则 —— 改监测阈值这种
//    事不允许由模型的分类结果决定，只允许由用户明确指令 + 后端确认引用决定。
// 2. 模型只输出分类，不解析数值。parsedChange 恒为 null，真实变更由下游
//    parseGuidedTrialIntent / rules.preview_change 自己解析和校验。
// 3. 模型不可用、超时、返回不合枚举 —— 一律回落正则结果，功能不降级。

const DOMAINS = new Set(['OTHER', 'ROOT_CAUSE_BOUNDARY', 'DIAGNOSTIC', 'RULE', 'SERVICE', 'PARAMETER', 'DOMAIN_KNOWLEDGE', 'SNAPSHOT', 'UNKNOWN']);
const ACTIONS = new Set(['NONE', 'QUERY', 'CHANGE', 'UNSUPPORTED_CHANGE', 'NEEDS_INPUT']);
const SCOPES = new Set(['SNAPSHOT', 'CONFIG', 'SERVICE', 'KNOWLEDGE']);

const SYSTEM_PROMPT = `你是 DK 冷轧工艺助手的意图解析器。你只做分类，不回答业务问题，不编造任何数值。

把用户这一句话映射到下列枚举：

domain：
- SNAPSHOT 问当前工况、S5轧制力预测、25维输入、历史对比、回放、报告、导出
- PARAMETER 要试算或调整某个工艺参数（后张力/前张力/弯辊力/厚度/宽度/速度/轧制力）
- RULE 查或改监测规则、阈值、预警、报警
- DIAGNOSTIC 问某条诊断发现、证据、为什么这样判断
- ROOT_CAUSE_BOUNDARY 问物理根因，例如"为什么S5轧制力偏高"
- DOMAIN_KNOWLEDGE 问冷轧工艺知识、参数定义、文献资料
- SERVICE 问模型服务/AI服务状态、队列、版本、配置
- OTHER 打招呼、身份、闲聊、与本软件无关
- UNKNOWN 确实无法归类

action：QUERY 只查不改 / CHANGE 要改 / UNSUPPORTED_CHANGE 要求删除清空 / NEEDS_INPUT 信息不足 / NONE 无需动作
scope：SNAPSHOT 当前工况 / CONFIG 配置 / SERVICE 服务 / KNOWLEDGE 知识库
certainty：EXPLICIT 用户说清了自己要什么 / AMBIGUOUS 含糊
requiresTool：true 表示必须调用业务工具才能回答，闲聊与身份问题为 false
missing：信息不足时列出缺什么（中文短语，最多3条），够用就给空数组
subgoals：一句话里包含多个诉求时拆成子目标（中文短语，最多3条），单一诉求给空数组

硬性要求：
- 只输出 JSON 对象，不要 Markdown、不要解释、不要思考过程
- 不要输出任何业务数值、吨位、单位
- 多个诉求时 domain 取应当最先执行的那个，其余放 subgoals
- 用户明确在问冷轧工艺概念（如"后张力是什么"）时归 DOMAIN_KNOWLEDGE，不要归 SNAPSHOT`;

const RESPONSE_SHAPE = {
  type: 'object',
  properties: {
    domain: { type: 'string', enum: [...DOMAINS] },
    action: { type: 'string', enum: [...ACTIONS] },
    scope: { type: 'string', enum: [...SCOPES] },
    certainty: { type: 'string', enum: ['EXPLICIT', 'AMBIGUOUS'] },
    requiresTool: { type: 'boolean' },
    missing: { type: 'array', items: { type: 'string' } },
    subgoals: { type: 'array', items: { type: 'string' } },
  },
  required: ['domain', 'action', 'scope', 'certainty', 'requiresTool'],
};

function mode() {
  return String(process.env.DKQKAR_INTENT_MODE || 'llm').toLowerCase();
}

function withDefaults(intent) {
  return {
    parsedChange: null,
    certainty: 'EXPLICIT',
    ...intent,
    missing: Array.isArray(intent.missing) ? intent.missing : [],
    subgoals: Array.isArray(intent.subgoals) ? intent.subgoals : [],
  };
}

function accepted(parsed, fallback) {
  const domain = String(parsed?.domain || '').toUpperCase();
  if (!DOMAINS.has(domain)) return null;
  // 模型说不清、但正则能归类时，不要用 UNKNOWN 覆盖一个可用结果。
  if (domain === 'UNKNOWN' && fallback.domain !== 'UNKNOWN') return null;
  const action = String(parsed?.action || '').toUpperCase();
  const scope = String(parsed?.scope || '').toUpperCase();
  return withDefaults({
    domain,
    action: ACTIONS.has(action) ? action : fallback.action,
    scope: SCOPES.has(scope) ? scope : fallback.scope,
    certainty: parsed?.certainty === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'EXPLICIT',
    requiresTool: typeof parsed?.requiresTool === 'boolean' ? parsed.requiresTool : domain !== 'OTHER',
    entityRef: fallback.entityRef ?? null,
    missing: (Array.isArray(parsed?.missing) ? parsed.missing : []).filter(item => typeof item === 'string' && item.trim()).slice(0, 3).map(item => item.trim()),
    subgoals: (Array.isArray(parsed?.subgoals) ? parsed.subgoals : []).filter(item => typeof item === 'string' && item.trim()).slice(0, 3).map(item => item.trim()),
    intentSource: 'llm',
  });
}

export async function resolveIntent({ message, diagnostics = null, llm = null, signal = null } = {}) {
  const rules = withDefaults(classifyAssistantIntent(String(message ?? ''), diagnostics));
  const strategy = mode();

  if (strategy === 'rules') return { ...rules, intentSource: 'rules' };

  // 护栏：改监测规则/阈值属于写配置，模型不参与决定"要不要改"。
  if (rules.domain === 'RULE' && ['CHANGE', 'UNSUPPORTED_CHANGE'].includes(rules.action)) {
    return { ...rules, intentSource: 'rules-write-guard' };
  }

  if (strategy === 'hybrid' && rules.domain !== 'UNKNOWN' && rules.certainty === 'EXPLICIT' && rules.action !== 'NEEDS_INPUT') {
    return { ...rules, intentSource: 'rules-fast' };
  }

  if (!llm?.chat) return { ...rules, intentSource: 'rules-no-llm' };

  try {
    const response = await llm.chat([
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          question: String(message).slice(0, 2000),
          has_snapshot: Boolean(diagnostics?.status === 'VALID' || diagnostics?.findings?.length),
          rule_guess: { domain: rules.domain, action: rules.action, certainty: rules.certainty },
        }),
      },
    ], { format: RESPONSE_SHAPE, maxTokens: 320, signal });

    const parsed = JSON.parse(String(response.message?.content || '{}'));
    const intent = accepted(parsed, rules);
    if (!intent) return { ...rules, intentSource: 'rules-invalid' };
    return intent;
  } catch (error) {
    // 外部主动取消才向上抛；自身超时表示"模型没及时答"，回落规则继续跑。
    const timedOut = signal?.reason?.name === 'TimeoutError';
    if (signal?.aborted && !timedOut) throw error;
    return { ...rules, intentSource: timedOut ? 'rules-timeout' : 'rules-fallback', intentError: error?.code || error?.message || 'INTENT_UNAVAILABLE' };
  }
}

export function intentMode() {
  return mode();
}
