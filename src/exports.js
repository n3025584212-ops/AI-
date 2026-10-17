import { caseToCSV, singleConditionTemplateCSV } from './processState.js';
import { PRODUCT_NAME, modelBrandDisplayText } from './productBrand.js';
import { knowledgeDisplayText } from './knowledgeDisplay.js';
import { buildReport, reportNumber as num } from './reportData.js';
import { normalizePresentation } from './presentationPackage.js';
import { toDisplay, formatEngineering } from './engineeringUnits.js';

const C = { ink: '17354D', blue: '225E87', muted: '63798A', line: 'D4DEE6', pale: 'F1F5F8', white: 'FFFFFF' };
const sign = value => `${value > 0 ? '+' : ''}${num(value)}`;
const force = (value, digits = 3) => num(toDisplay('force', value), digits);
const forceWithUnit = value => formatEngineering('force', value, 3);
const signForce = value => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${force(value)}` : '未提供';
const changeNumber = (change, value) => num(toDisplay(change.field, value), 3);
const changeSign = (change, value) => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${changeNumber(change, value)}` : '未提供';
const selected = (report, section) => report.sections.includes(section);
const bytes = url => Uint8Array.from(atob(url.split(',')[1]), character => character.charCodeAt(0));
function filename(input, ext) { return `${String(input.id || 'QCDKR').replace(/[^\p{L}\p{N}_-]/gu, '_')}_工艺报告.${ext}`; }
function download(blob, name) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
function imageData(data) { let binary = ''; for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192)); return `data:image/png;base64,${btoa(binary)}`; }
async function preview() { const response = await fetch('/assets/line-preview.png', { cache: 'no-store' }); if (!response.ok) throw new Error('最终母版预览读取失败。'); return new Uint8Array(await response.arrayBuffer()); }

export function exportJSON(data) {
  const report = data.input && data.prediction ? buildReport(data) : undefined;
  download(new Blob([JSON.stringify({ ...data, report, exportedAt: new Date().toISOString(), mode: data.prediction?.mode || 'demo' }, null, 2)], { type: 'application/json' }), filename(data.input || data, 'json'));
}
export function exportCSV(input, metadata = {}) {
  download(new Blob([caseToCSV(input, metadata)], { type: 'text/csv;charset=utf-8' }), filename(input, 'csv'));
}

export function downloadSingleConditionTemplate() {
  download(new Blob([singleConditionTemplateCSV()], { type: 'text/csv;charset=utf-8' }), 'QCDKR_单工况模板.csv');
}

/** Deterministic evidence graphics, drawn from the report's actual numbers. */
export async function createReportCharts(report) {
  await document.fonts.ready;
  function canvas() { const el = document.createElement('canvas'); el.width = 1200; el.height = 440; const ctx = el.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1200, 440); ctx.font = '22px "Microsoft YaHei", sans-serif'; return [el, ctx]; }
  const [line, c] = canvas(), values = report.curve.flatMap(p => [p.actual, p.predicted]).filter(Number.isFinite);
  const low = Math.floor(Math.min(...values) * .88 / 50) * 50, high = Math.ceil(Math.max(...values) * 1.06 / 50) * 50;
  const x = i => 116 + i * 232, y = value => 346 - (value - low) / (high - low || 1) * 238;
  c.fillStyle = '#225e87'; c.fillRect(116, 27, 35, 5); c.fillText('输入载荷', 163, 37);
  c.fillStyle = '#b87535'; c.beginPath(); c.arc(340, 30, 6, 0, Math.PI * 2); c.fill(); c.fillText(report.summary.resultLabel, 358, 37);
  c.fillStyle = '#63798a'; c.fillText('轧制力 / t', 855, 37);
  for (let i = 0; i <= 4; i++) { const value = low + (high - low) * i / 4, yy = y(value); c.strokeStyle = '#d9e3ea'; c.lineWidth = 1; c.beginPath(); c.moveTo(106, yy); c.lineTo(1065, yy); c.stroke(); c.fillStyle = '#63798a'; c.textAlign = 'right'; c.fillText(force(value, 2), 90, yy + 8); }
  c.strokeStyle = '#225e87'; c.lineWidth = 4; c.beginPath(); let connected = false; report.curve.forEach((p, i) => { if (!Number.isFinite(p.actual)) { connected = false; return; } if (connected) c.lineTo(x(i), y(p.actual)); else c.moveTo(x(i), y(p.actual)); connected = true; }); c.stroke();
  report.curve.forEach((p, i) => { c.textAlign = 'center'; if (Number.isFinite(p.actual)) { c.fillStyle = '#225e87'; c.beginPath(); c.arc(x(i), y(p.actual), 6, 0, Math.PI * 2); c.fill(); c.fillStyle = '#17354d'; c.fillText(force(p.actual, 2), x(i), y(p.actual) - 20); } c.fillStyle = '#63798a'; c.fillText(p.stand, x(i), 391); });
  c.fillStyle = '#b87535'; c.beginPath(); c.arc(x(4), y(report.summary.value), 9, 0, Math.PI * 2); c.fill(); c.textAlign = 'right'; c.fillText(force(report.summary.value), x(4) - 17, y(report.summary.value) + 37);
  const [bars, b] = canvas(), maximum = Math.max(1, ...report.sensitivities.map(item => item.value));
  report.sensitivities.forEach((item, i) => { const yy = 35 + i * 78; b.fillStyle = '#17354d'; b.textAlign = 'right'; b.fillText(item.name, 307, yy + 25); b.fillStyle = '#edf2f6'; b.fillRect(332, yy, 686, 36); b.fillStyle = i === 0 ? '#225e87' : '#6997af'; b.fillRect(332, yy, item.value / maximum * 686, 36); b.textAlign = 'left'; b.fillStyle = '#17354d'; b.fillText(`${num(item.value)}%`, 1040, yy + 26); });
  return { loadCurve: line.toDataURL('image/png'), sensitivity: bars.toDataURL('image/png') };
}

export async function exportWord(payload) {
  const report = buildReport(payload), r = report.summary, formal = report.meta.mode === 'formal', charts = await createReportCharts(report);
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ImageRun, Header, Footer, PageNumber, AlignmentType, VerticalAlign, BorderStyle } = await import('docx');
  const run = (text, extra = {}) => new TextRun({ text: modelBrandDisplayText(String(text)), font: '宋体', size: 21, color: C.ink, ...extra });
  const p = (text, extra = {}) => new Paragraph({ children: [run(text)], spacing: { after: 130, line: 310 }, widowControl: true, ...extra });
  const h = (text, page = false) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, pageBreakBefore: page, keepNext: true, spacing: { after: 180 } });
  const h2 = text => new Paragraph({ text, heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 140, after: 100 } });
  const note = text => new Paragraph({ children: [run(text, { size: 18, color: C.muted })], spacing: { after: 110, line: 255 }, widowControl: true });
  const image = (data, w, h) => new Paragraph({ children: [new ImageRun({ data, type: 'png', transformation: { width: w, height: h } })], alignment: AlignmentType.CENTER, spacing: { after: 100 } });
  const table = (rows, widths) => new Table({ width: { size: 10200, type: WidthType.DXA }, columnWidths: widths,
    borders: Object.fromEntries(['top', 'bottom', 'left', 'right', 'insideHorizontal', 'insideVertical'].map(edge => [edge, { style: BorderStyle.SINGLE, size: 4, color: C.line }])),
    rows: rows.map((row, ri) => new TableRow({ tableHeader: ri === 0, cantSplit: true, children: row.map((value, ci) => new TableCell({ width: { size: widths[ci], type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, shading: { fill: ri === 0 ? C.blue : ri % 2 ? C.white : C.pale }, margins: { top: 95, bottom: 95, left: 110, right: 110 }, children: [new Paragraph({ children: [run(value, { font: ri === 0 ? '微软雅黑' : '宋体', size: 19, color: ri === 0 ? C.white : C.ink, bold: ri === 0 })], alignment: ci > 0 ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { after: 0, line: 250 } })] })) })),
  });
  const content = [new Paragraph({ children: [run(PRODUCT_NAME, { font: '微软雅黑', bold: true, size: 38, color: C.blue })], spacing: { after: 280 } }), new Paragraph({ text: '五机架冷连轧工艺分析报告', heading: HeadingLevel.TITLE, spacing: { after: 180 } }), p(`${report.meta.id}  |  ${report.meta.steelGrade}  |  带钢宽度 ${num(report.meta.width, 0)} mm`), note(`报告编号：${report.meta.reportId}\n生成时间：${report.meta.createdAtLabel}\n计算状态：${r.status}`)];
  if (selected(report, '三维模型')) content.push(image(await preview(), 520, 314));
  content.push(h2('执行摘要'), p(r.conclusion), note(`本报告记录输入、离线估算与候选复算，未连接现场控制系统。${r.ood ? '存在超出论文单变量范围的输入。' : '本次未发现论文单变量范围越界。'}${formal ? r.coherent ? '预测结果绑定当前工况与模型身份。' : '预测结果未绑定完整工况，请重新计算。' : r.coherent ? '预测数据与当前公式复算一致。' : '预测数据与当前公式复算不一致，应先更新工况计算。'}`));
  if (selected(report, '工况信息')) {
    content.push(h('1 工况输入与数据完整性', true), p(`工况 ${report.meta.id}；入口设定厚度 ${num(report.input.entrySetThickness ?? report.input.stands[0].entryThickness, 3)} mm；版本 ${report.meta.revision}。`));
    content.push(table([['参数', '单位', 'S1', 'S2', 'S3', 'S4', 'S5'], ...report.parameterRows.map(row => [row.label, row.unit, ...row.displayValues.map(value => num(value, row.unit === 'mm' ? 3 : 2))])], [1800, 1400, 1400, 1400, 1400, 1400, 1400]));
    content.push(note('表 1  五机架完整参数。S5 前张力不是论文输入；未提供时保留缺失状态。'), h2('单位与输入口径'), p('统一原始工程单位：轧制力和总张力 t（吨力），弯辊力 kN，速度 m/min，厚度与宽度 mm，温度 °C。模型输入、输出与显示保持同一原始尺度。'), h2('数据检查'), p('输入通过有限数值、五机架顺序、压下方向和机架间厚度衔接校验。S5 输入载荷用于实际值对照，未作为预测特征；目标值也不参与预测。'), p(r.ood ? `超范围项：${report.rangeWarnings.join('；')}。` : '未发现单变量范围越界；此检查不能替代多变量分布验证、传感器核验或现场工况评估。'));
  }
  if (selected(report, '预测结果')) {
    content.push(h('2 S5 预测、实际值与目标', true), p(r.headline), table([['指标', '结果 / t', '口径'], [r.resultLabel, force(r.value), '当前工况模型输出'], ['实际值', force(r.observed), '与当前工况匹配的实际值'], ['目标值', force(r.target), '软件工况目标'], ['预测误差', signForce(r.predictionError), '模型预测 - 实际值'], ['目标偏差', signForce(r.signedError), '模型预测 - 目标值'], ['相对目标偏差', `${sign(r.deviation)}%`, '目标偏差 / 目标 × 100%'], [formal ? '预测区间' : '演示扰动区间', r.interval.length ? r.interval.map(v => force(v)).join(' — ') : '未校准', r.intervalNature]], [2900, 3300, 4000]));
    content.push(note('表 2  目标比较。这里的误差指对目标的偏离，不是以真实标签计算的模型误差。'), image(bytes(charts.loadCurve), 560, 205), note(`图 1  五机架输入载荷与 ${r.resultLabel}。S1–S4 为输入载荷，橙色点仅表示 S5。`), p(report.method.uncertainty));
  }
  if (selected(report, '工艺解释')) {
    content.push(h('3 敏感度分析与计算方法', true), image(bytes(charts.sensitivity), 560, 205), note(`图 2  前五项${r.sensitivityLabel}。`), p(report.method.sensitivity), h2('当前计算状态'), p(report.method.current), h2('与论文方法的关系'), p(report.method.inputs), p(formal ? `模型版本：${report.meta.modelIdentity.version}；SHA-256：${report.meta.modelIdentity.hash}。` : '所附 Python 文件提供 QCDKR 训练和推理结构，当前尚未加载拟合后模型工件。'), note(report.method.paper));
    if (report.onlineNotes.length) { content.push(h2('在线助手说明')); report.onlineNotes.forEach(item => content.push(p(`答复节选：${knowledgeDisplayText(item.text).slice(0, 180)}${item.text.length > 180 ? '…' : ''}`), note(item.source))); }
    else content.push(note('本次未收到在线模型答复；上述说明来自输入数值与源码规则。'));
  }
  if (selected(report, '优化方案')) {
    content.push(h('4 优化候选与变更复算', true), p(formal ? '候选值来自同一正式模型的服务端计算记录；本报告核对模型身份、基线工况与应用后的预测值。改善率是目标误差减少比例。' : '改善率按“(基线绝对目标误差 - 候选误差) / 基线误差”计算。已应用方案使用保存的应用前工况复算，并核对其变更后状态与当前工况一致。'));
    if (!report.plans.length) content.push(h2('本次未执行方案生成'), p('当前没有候选方案数据。报告不填写参数调整、改善率或执行结果。'), p('生成候选后，记录每一项机架和参数的变更前后值，并以同一工况与模型版本进行计算。'));
    else {
      content.push(table([['候选', formal ? '模型计算 S5' : '复算 S5', '目标误差', '改善率', '核验'], ...report.plans.map(plan => [plan.title, force(plan.replayValue), force(plan.replayError), Number.isFinite(plan.replayImprovement) ? `${num(plan.replayImprovement)}%` : '未复算', plan.status])], [2600, 1900, 1900, 1900, 1900]));
      report.plans.forEach((plan, i) => { content.push(h2(`4.${i + 1} ${plan.title}`), table([['机架与参数', '原值', '候选值', '变化量'], ...plan.changes.map(change => [`${change.stand} ${change.label} / ${change.unit}`, changeNumber(change, change.before), changeNumber(change, change.after), changeSign(change, change.delta)])], [3600, 2200, 2200, 2200]), note(`基线 S5 ${force(plan.baselineValue)}；基线误差 ${force(plan.baselineError)}。${plan.description || ''} 轧制力单位 t，其余单位见参数名称。${plan.stale ? '旧基线不匹配，未采用旧方案改善率。' : ''}${plan.applied ? '已在软件工况应用；未记录现场设备执行。' : '未记录现场执行。'}`)); });
    }
    content.push(note(report.method.scope));
  }
  content.push(h('5 资产来源与后续工作', true));
  if (selected(report, '三维模型')) content.push(h2('最终三维资产'), p(`来源链：${report.asset.chain}。当前使用 ${report.asset.version}。`), table([['资产核查项', '本次使用值'], ['可见设备对象', String(report.asset.objects)], ['逐实例三角面数', String(report.asset.triangles)], ['主辊 / PBR 材质 / 内嵌图像', '30 / 33 / 10'], ['源母版', report.asset.source]], [3200, 7000]), p(report.asset.description), note('文档图片为最终母版静态预览，软件内为实时 GLB。摄影灯与部分 Cycles 射线可见性无直接 glTF 等价表示，实时照明可能与离线图片不同。'));
  content.push(h2('结论与下一步'), p(r.conclusion));
  report.nextSteps.forEach((text, i) => content.push(p(`${i + 1}. ${text}`)));
  content.push(h2('来源与可追溯性'), note(`工况快照：${report.meta.reportId}；生成：${report.meta.createdAtLabel}。\n方法资料：《QCDKR冷连轧轧制力预测研究》与 dkqkar_v5s2_model.py。\n应用计算：${formal ? 'QCDKR Python 模型服务' : 'src/domain.js'}；资产证据：${report.asset.evidence}。\nJSON 导出保留完整工况、预测、方案和报告事实对象。`));
  const doc = new Document({ creator: PRODUCT_NAME, title: `${report.meta.id} 五机架冷连轧工艺分析报告`, styles: { default: { document: { run: { font: '宋体', size: 21, color: C.ink }, paragraph: { spacing: { line: 310 } } } }, paragraphStyles: [
    { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { font: '微软雅黑', size: 36, bold: true, color: '000000' } },
    { id: 'Heading1', name: 'heading 1', basedOn: 'Normal', next: 'Normal', run: { font: '微软雅黑', size: 29, bold: true, color: '000000' }, paragraph: { keepNext: true } },
    { id: 'Heading2', name: 'heading 2', basedOn: 'Normal', next: 'Normal', run: { font: '微软雅黑', size: 23, bold: true, color: '000000' }, paragraph: { keepNext: true } },
  ] }, sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1000, right: 1020, bottom: 1000, left: 1020, header: 450, footer: 450 } } }, headers: { default: new Header({ children: [new Paragraph({ children: [run(PRODUCT_NAME+'  ·  五机架冷连轧工程分析', { font: '微软雅黑', size: 16, color: C.muted })], border: { bottom: { style: BorderStyle.SINGLE, color: C.line, size: 4 } } })] }) }, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [run(`${report.meta.id}  |  ${report.meta.revision}  |  第 `, { size: 16, color: C.muted }), new TextRun({ children: [PageNumber.CURRENT], size: 16 }), run(' / ', { size: 16 }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16 }), run(' 页', { size: 16 })] })] }) }, children: content }] });
  download(await Packer.toBlob(doc), filename(report.input, 'docx'));
}

export async function exportPowerPoint(payload) {
  const report = buildReport(payload), r = report.summary, formal = report.meta.mode === 'formal', charts = await createReportCharts(report);
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE'; pptx.author = PRODUCT_NAME; pptx.subject = '五机架冷连轧工况与候选复算'; pptx.title = `${report.meta.id} 工艺分析报告`; pptx.lang = 'zh-CN'; pptx.theme = { headFontFace: 'Microsoft YaHei', bodyFontFace: 'Microsoft YaHei', lang: 'zh-CN' };
  let index = 0;
  const text = (s, value, x, y, w, h, options = {}) => s.addText(modelBrandDisplayText(String(value)), { x, y, w, h, fontFace: 'Microsoft YaHei', fontSize: 17, color: C.ink, margin: 0, valign: 'top', ...options });
  const slide = (title, source = report.method.current) => { const s = pptx.addSlide(); s.background = { color: C.white }; index++; text(s, title, .6, .4, 12.1, .6, { fontSize: 27, bold: true }); s.addShape(pptx.ShapeType.line, { x: .6, y: 1.22, w: 12.1, h: 0, line: { color: C.line, width: 1 } }); text(s, `${report.meta.id} · ${report.meta.revision}  |  ${formal ? '模型分析' : '演示分析'} / ${index}`, .6, 7.06, 12, .2, { fontSize: 9, color: C.muted }); s.addNotes(`来源：${source}\n报告时间：${report.meta.createdAtLabel}\n论文指标不代表本工况准确率。`); return s; };
  const table = (s, rows, options = {}) => s.addTable(rows.map((row, ri) => row.map(value => ({ text: String(value), options: { bold: ri === 0, color: ri === 0 ? C.white : C.ink, fill: ri === 0 ? C.blue : ri % 2 ? C.white : C.pale } }))), { x: .6, y: 1.65, w: 12.1, fontFace: 'Microsoft YaHei', fontSize: 14, margin: .10, border: { type: 'solid', color: C.line, pt: .6 }, rowH: .48, valign: 'middle', autoPage: false, ...options });
  let s = slide('五机架冷连轧工艺分析报告');
  text(s, report.meta.id, .65, 1.65, 5.8, .55, { fontSize: 26, color: C.blue }); text(s, force(r.value), .65, 2.6, 5.5, 1.13, { fontSize: 64, bold: true, color: C.blue }); text(s, `${r.resultLabel} / t`, .7, 3.85, 5.7, .4, { fontSize: 18, color: C.muted }); text(s, `目标 ${force(r.target)}\n目标差 ${signForce(r.signedError)}\n相对目标偏差 ${sign(r.deviation)}%`, 7, 2, 5.2, 2.1, { fontSize: 25, paraSpaceAfterPt: 18 }); text(s, r.conclusion, .7, 4.75, 11.8, .95, { fontSize: 19 }); text(s, `${report.meta.steelGrade} · 宽度 ${num(report.meta.width, 0)} mm · 5 个机架\n${report.meta.createdAtLabel} · ${r.status}`, .7, 6.02, 11.8, .64, { fontSize: 14, color: C.muted });
  if (selected(report, '工况信息')) { s = slide('工况快照与完整机架参数'); table(s, [['参数', '单位', 'S1', 'S2', 'S3', 'S4', 'S5'], ...report.parameterRows.map(row => [row.label, row.unit, ...row.displayValues.map(value => num(value, row.unit === 'mm' ? 3 : 2))])], { colW: [1.75, 1.35, 1.8, 1.8, 1.8, 1.8, 1.8], fontSize: 13.5, rowH: .43 }); text(s, '轧制力 t；总张力 t；弯辊力 kN；速度 m/min；厚度与宽度 mm；温度 °C。S5 前张力可记录，不进入模型。', .65, 6.05, 11.9, .55, { fontSize: 15, color: C.muted }); }
  if (selected(report, '预测结果')) { s = slide('S5 估算与目标比较'); s.addImage({ data: charts.loadCurve, x: 4.05, y: 1.85, w: 8.75, h: 3.21 }); text(s, `${force(r.value)}\n${r.resultLabel}`, .7, 1.8, 3.1, 1.35, { fontSize: 30, bold: true, color: C.blue }); text(s, `目标  ${force(r.target)}\n绝对目标误差  ${force(r.absoluteError)}\n目标偏差  ${sign(r.deviation)}%`, .7, 3.55, 3.4, 1.45, { fontSize: 17, paraSpaceAfterPt: 10 }); text(s, `${formal ? '预测区间：未校准' : `扰动带：${r.interval.map(v => force(v)).join(' — ')}（${r.intervalNature}）`}\n${report.method.uncertainty} S1–S4 曲线为输入载荷。`, .7, 5.55, 11.85, .9, { fontSize: 17, color: C.muted }); }
  if (selected(report, '工艺解释')) { s = slide(`前五项${r.sensitivityLabel}`); s.addImage({ data: charts.sensitivity, x: .6, y: 1.8, w: 8.2, h: 3.01 }); text(s, '解释口径', 9.3, 1.9, 3.25, .5, { fontSize: 21, bold: true }); text(s, formal ? '对各输入作双向扰动\n同一模型计算响应\n以最大响应归一为 100' : '对各输入作 ±1% 扰动\n计算手设公式的绝对响应\n以全部 25 项响应归一化', 9.3, 2.62, 3.2, 1.9, { fontSize: 17, paraSpaceAfterPt: 14 }); text(s, report.method.sensitivity, .7, 5.65, 11.85, .8, { fontSize: 17, color: C.muted }); }
  if (selected(report, '优化方案')) {
    s = slide('优化候选与目标误差改善');
    if (report.plans.length) { table(s, [['候选方案', formal ? '模型计算 S5' : '复算 S5', '目标误差', '改善率', '复算状态'], ...report.plans.map(plan => [plan.title, force(plan.replayValue), force(plan.replayError), Number.isFinite(plan.replayImprovement) ? `${num(plan.replayImprovement)}%` : '未复算', plan.status])], { colW: [3.4, 2.1, 2.1, 2.1, 2.4], rowH: .62 }); text(s, formal ? '保留服务端模型计算的候选值与模型身份，核对其工况基线及应用后结果。浏览器不使用演示公式复算正式方案。' : '每项候选从其工况基线复制、应用变更并复算。已应用方案使用保存的应用前基线，并核验变更后的状态。', .7, 5.08, 11.8, .9, { fontSize: 19 }); }
    else { text(s, '本次未执行方案生成', .7, 2.1, 11.8, .8, { fontSize: 32, bold: true, color: C.blue }); text(s, '当前没有候选方案、变更或改善率。\n完成输入复核后，可生成并回放候选工况进行比较。', .7, 3.6, 11.8, 1.6, { fontSize: 23 }); }
    text(s, '“改善率”是对设定目标的绝对误差减少，不表示现场质量或产能改善。', .7, 6.18, 11.8, .5, { fontSize: 15, color: C.muted });
    s = slide('候选参数变更与应用记录');
    const rows = report.plans.flatMap(plan => plan.changes.map(change => [plan.title, change.stand, change.label + ' / ' + change.unit, changeNumber(change, change.before), changeNumber(change, change.after), changeSign(change, change.delta)]));
    if (rows.length) table(s, [['方案', '机架', '参数', '原值', '候选值', '变化量'], ...rows], { colW: [2.9, 1, 2.2, 2, 2, 2], fontSize: 13.5, rowH: .47 }); else text(s, '无候选参数变更记录', .7, 2.4, 11.8, .7, { fontSize: 30, color: C.blue });
    text(s, '单位见各参数名称。应用到当前工况后，仅更新软件内参数。\n未记录 PLC 指令下发或现场设备执行；旧基线方案会标记为与当前工况不一致。', .7, 5.75, 11.8, .85, { fontSize: 17, color: C.muted });
  }
  if (selected(report, '三维模型')) { s = slide('最终母版与三维设备资产', 'DKQKAR_5Stand_V2_Readability 最终母版、docs/model-export-audit.json。图片为既有整线渲染。'); s.addImage({ data: imageData(await preview()), x: .6, y: 1.58, w: 8, h: 4.83 }); text(s, 'V2 Readability', 9, 1.7, 3.7, .6, { fontSize: 25, bold: true, color: C.blue }); text(s, '3,519 个可见对象\n995,336 个三角面\n30 根主辊\n33 个 PBR 材质', 9, 2.55, 3.6, 2.25, { fontSize: 21, paraSpaceAfterPt: 13 }); text(s, 'V3 Astra → V2 Revision\n→ V2 Readability\n无减面，主 Scene 可见性保持', 9, 5.15, 3.65, 1, { fontSize: 14.5, color: C.muted }); }
  s = slide('方法、模型状态与适用范围', '《QCDKR冷连轧轧制力预测研究》第2、3、4节，dkqkar_v5s2_model.py，src/domain.js。');
  [['当前运行', formal ? `QCDKR 训练模型；版本 ${report.meta.modelIdentity.version}` : '手设线性扰动公式，未加载训练权重；仅作工况演示。'], ['论文方法', '25 维 RBF 核 + 5 维量子保真度核，权重 0.90 / 0.10；直接预测 S5 轧制力。'], ['论文既有结果', '400 条样本、8 个规格、4 折评价；RMSE 19.205 t / MAE 10.784 t / R² 0.9894。'], ['本次适用边界', report.method.range]].forEach(([title, body], i) => { const yy = 1.65 + i * 1.12; text(s, title, .7, yy, 2.3, .5, { fontSize: 20, bold: true, color: C.blue }); text(s, body, 3.05, yy, 9.5, .83, { fontSize: 18 }); }); text(s, '论文指标不等于本次预测准确率，也不是现场允许误差。', .7, 6.28, 11.8, .4, { fontSize: 15, color: C.muted });
  s = slide('分析结论与后续工作'); text(s, r.conclusion, .7, 1.6, 11.8, 1.08, { fontSize: 23, color: C.blue }); report.nextSteps.forEach((step, i) => { text(s, `${i + 1}`, .75, 3.02 + i * .91, .55, .55, { fontSize: 23, bold: true, color: C.blue }); text(s, step, 1.55, 3.05 + i * .91, 10.8, .72, { fontSize: 18 }); }); text(s, report.onlineNotes.length ? '在线答复另见 Word 节选及 JSON 原文；来源为传入会话记录。' : '本次没有在线模型答复；结论来自输入数值与透明规则计算。', .7, 6.2, 11.8, .5, { fontSize: 14, color: C.muted });
  download(await normalizePresentation(await pptx.write({ outputType: 'blob' })), filename(report.input, 'pptx'));
}
