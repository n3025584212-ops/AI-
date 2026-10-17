export const PRODUCT_NAME = 'AI大模型与量子机器学习协同驱动的冷轧轧制力预测云平台';
export const MODEL_NAME = 'QCDKR';
export const MODEL_DESCRIPTION = '量子—经典双核回归模型（Quantum–Classical Dual Kernel Regression，QCDKR）';

// Project legacy model wording without changing stored model identities or source files.
export function modelBrandDisplayText(value) {
  return typeof value === 'string' ? value
    .replace(/双核量子核辅助回归模型[（(]dual-kernel quantum-kernel-assisted regression[，,]\s*DK[-_]?QKAR[）)]/gi, MODEL_DESCRIPTION)
    .replace(/\bDK[-_]?QKAR\b/gi, MODEL_NAME) : value;
}

// Product wording is a display projection. Preserve technical identifiers,
// stored history, evidence hashes, executable names and local data paths.
export function productDisplayText(value) {
  return typeof value==='string'?modelBrandDisplayText(value.replaceAll('DKQKAR Studio',PRODUCT_NAME)):value;
}
