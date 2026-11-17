// 桌宠开口的规则层：只生成一句能听懂的话，带真实数字，不念废话。
// 这里全是纯函数，方便单独跑 node 校验；React 侧只负责排队、冷却和展示。
export const PET_SPEECH_VISIBLE_MS = 12000;   // 气泡停留时长
export const PET_MIN_GAP_MS = 20000;          // 两次主动开口的最小间隔
export const PET_FIRST_REPORT_DELAY_MS = 8000; // 打开页面时先让人看清界面，再说旧账

const clean = (value, max) => String(value ?? '').replace(/[。.\s]+$/, '').trim().slice(0, max);
const severityRank = { HIGH: 3, MEDIUM: 2, LOW: 1 };

export const activeIncidents = incidents => (Array.isArray(incidents) ? incidents : []).filter(item => item && item.status === 'ACTIVE');

// 事件中心 → 一句话。气泡小，第一句就得是那个问题本身，不写"有个问题没处理"这种铺垫。
export function incidentSpeech(incidents = []) {
  const list = activeIncidents(incidents);
  if (!list.length) return null;
  const top = list.reduce((best, item) => ((severityRank[item.severity] || 0) > (severityRank[best.severity] || 0) ? item : best), list[0]);
  const title = clean(top.title || top.summary || '有件事没处理完', 26);
  return list.length === 1 ? title : `${title}，另有 ${list.length - 1} 个`;
}

// 问题清单的指纹：集合没变就不重复开口
export function incidentFingerprint(incidents = []) {
  return activeIncidents(incidents).map(item => item.id || item.key || item.title).filter(Boolean).sort().join('|');
}

// 业务事件 → 一句话：error 带"报警"，其余直接说事
export function eventSpeech(item = {}) {
  const detail = clean(item.message || item.title || '', 40);
  if (!detail) return null;
  return item.severity === 'error' ? `报警：${detail}` : detail;
}

// AI 任务结束 → 结论在前，任务名在后
export function taskSpeech(task) {
  if (!task || task.historical) return null;
  const title = clean(task.title || '这次任务', 20);
  if (task.state === 'COMPLETED') return `已完成：${title}`;
  if (task.state === 'PARTIAL') return `只完成一部分：${title}`;
  if (task.state === 'FAILED') return `没跑完：${title}`;
  if (task.state === 'CANCELLED') return `已停止：${title}`;
  return null;
}
