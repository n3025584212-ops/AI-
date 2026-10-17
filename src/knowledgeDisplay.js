import { productDisplayText, MODEL_DESCRIPTION } from './productBrand.js';
export const PAPER_DISPLAY_TITLE = '《QCDKR冷连轧轧制力预测研究》';
export const MAIN_MODEL_KNOWLEDGE_LABEL = '主模型：' + MODEL_DESCRIPTION;
const GENERAL_DOCUMENT_IDS = new Set(Array.from({ length: 10 }, (_, index) => `DOC-${String(index + 1).padStart(2, '0')}`));
const PAPER_FILE_NAME = 'DK_QKAR_论文_插图正式版_蓝灰无Marker雷达图_第4.3节消融压缩定稿版.docx';

export function isGeneralProcessKnowledge(entry) {
  return entry?.kind === 'general' || GENERAL_DOCUMENT_IDS.has(entry?.documentId || entry?.id);
}

// Display fields only; stored document, chunk, hash and locator identities stay intact.
export function knowledgeDisplay(entry, chunk = entry) {
  const id = entry?.documentId || entry?.id;
  const paper = id === 'paper-main';
  const modelText = chunk?.text;
  const mainModel = id === 'model-python' || id === 'DOC-11' || (paper && (!modelText || /DK[-_]?QKAR|QCDKR|25维|双核|量子核|S5[^。\n]*(?:预测目标|唯一预测对象)/i.test(modelText)));
  return {
    displayTitle: paper ? PAPER_DISPLAY_TITLE : knowledgeDisplayText(entry?.title || entry?.fileName || '知识条目'),
    displayFileName: paper ? PAPER_DISPLAY_TITLE : knowledgeDisplayText(entry?.fileName),
    knowledgeLabel: mainModel ? MAIN_MODEL_KNOWLEDGE_LABEL : '',
  };
}

export function knowledgeDisplayText(value, references = []) {
  let text = String(value || '').replaceAll(PAPER_FILE_NAME, PAPER_DISPLAY_TITLE)
    .replaceAll(PAPER_FILE_NAME.replace(/\.docx$/, ''), PAPER_DISPLAY_TITLE)
    .replace(/《DK-QKAR 论文正文》|DK-QKAR 论文正文|我的论文(?:\.docx)?/g, PAPER_DISPLAY_TITLE)
    .replace(/paper-main(?:-c(\d+))?/g, (_, chunk) => PAPER_DISPLAY_TITLE + (chunk ? ` · 片段 ${chunk}` : ''));
  for (const reference of references) {
    if (isGeneralProcessKnowledge(reference) && /^R\d+$/.test(reference.id || '')) {
      text = text.replaceAll(`[${reference.id}]`, '');
    }
  }
  return productDisplayText(text);
}
