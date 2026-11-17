export const EXECUTABLE_TECHNICIAN_ACTIONS = new Set(['ui.switch_page', 'ui.focus', 'report.export']);

export function technicianActionAvailability(action) {
  if (action?.risk_level === 'L3') return { executable: false, reason: '高危动作不代执行，请按 SOP 人工处理。' };
  if (!EXECUTABLE_TECHNICIAN_ACTIONS.has(action?.tool)) return { executable: false, reason: '该动作尚未接入真实执行器，未下发。' };
  return { executable: true, reason: '' };
}
