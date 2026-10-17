export const ASSISTANT_LAYOUT = Object.freeze({ collapsed: 52, default: 480, min: 360, max: 720, mainMin: 720, separator: 8, margin: 16 });
export const ASSISTANT_STATES = Object.freeze(['COLLAPSED', 'EXPANDED', 'FULLSCREEN']);
export const DEFAULT_ASSISTANT_STATE = Object.freeze({ width: ASSISTANT_LAYOUT.default, state: 'COLLAPSED' });
export function normalizeAssistantState(value) {
  return { width: Number.isFinite(value?.width) ? Math.min(720, Math.max(360, value.width)) : 480,
    state: ASSISTANT_STATES.includes(value?.state) ? value.state : 'COLLAPSED' };
}
export function restoreAssistantState(serialized, sessionId) {
  if (!sessionId) return { ...DEFAULT_ASSISTANT_STATE };
  try {
    const saved = JSON.parse(serialized);
    return saved?.app_session_id === sessionId ? normalizeAssistantState(saved) : { ...DEFAULT_ASSISTANT_STATE };
  } catch { return { ...DEFAULT_ASSISTANT_STATE }; }
}
// availableWidth is the measured workspace after navigation, never screen width.
export function assistantGeometry(availableWidth, preferredWidth, state = 'EXPANDED') {
  const available = Math.max(0, Number(availableWidth) || 0);
  const { min, max, mainMin, separator, margin, collapsed } = ASSISTANT_LAYOUT;
  const requested = normalizeAssistantState({ width: preferredWidth }).width;
  const inlineMax = Math.min(max, available - mainMin - separator - margin);
  const overlay = state === 'FULLSCREEN' || inlineMax < min;
  const maxWidth = overlay ? Math.min(max, Math.max(1, available - margin)) : inlineMax;
  const width = state === 'COLLAPSED' ? collapsed : Math.min(requested, maxWidth);
  return { width, overlay, maxWidth, minWidth: Math.min(min, maxWidth),
    reservedWidth: state === 'FULLSCREEN' || overlay ? collapsed : width + (state === 'COLLAPSED' ? 0 : separator + margin) };
}
export function keyboardAssistantWidth(width, key, maximum = 720, minimum = 360, shiftKey = false) {
  const step = shiftKey ? 40 : 16;
  const value = key === 'ArrowLeft' ? width + step : key === 'ArrowRight' ? width - step
    : key === 'Home' ? minimum : key === 'End' ? maximum : null;
  return value === null ? null : Math.max(minimum, Math.min(maximum, value));
}
export function shouldSendChat({ key, shiftKey, isComposing, keyCode }, composing = false) {
  return key === 'Enter' && !shiftKey && !isComposing && !composing && keyCode !== 229;
}
export function nearChatBottom({ scrollHeight, scrollTop, clientHeight }, threshold = 48) {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}
const CHAT_INTENT = /你好|您好|哈喽|嗨|在吗|在不在|你是谁|你叫什么|你叫啥|你的名字|叫什么名字|你是干什么的|你是做什么的|你能做什么|你能干什么|你会做什么|你有什么功能|介绍一下?你自己|说说你自己|自我介绍|谢谢|多谢|辛苦|再见|拜拜|早上好|下午好|晚上好|晚安/i;
const CHAT_PREFIX = /^(?:你是|你叫|你的|你会|你能|你有没有|介绍|说说你)/i;
const CHAT_ENGLISH = /^(?:hi|hello|hey|ok|okay|thanks|thank you)[\s!！.。?？~～]*$/i;
const TOOL_INTENT = /试算|预测|预报|对比|比较|回放|历史|事件|报警|告警|阈值|规则|导入|导出|保存|报告|校验|检查|验证|诊断|定位|聚焦|打开|显示|查看|展示|趋势|样本|数据|工况|轧制|张力|弯辊|速度|厚度|宽度|温度|原因|为什么|误差|偏差|优化|方案|建议|分析|敏感|资料|文献|论文|知识|帮助|怎么用|如何/i;
// Shared by the renderer (route direct chat) and the agent (authoritative re-check);
// explicit tool operations keep the agent run even if they greeting-prefix, while
// everything else short goes to direct chat, whose prompt refuses out-of-scope asks.
export function isConversational(message) {
  const text = String(message ?? '').trim();
  if (!text || text.length > 40) return false;
  if (TOOL_INTENT.test(text)) return false;
  return true;
}
