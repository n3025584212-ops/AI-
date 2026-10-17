// Shared prose boundary: standalone identifiers never authorize measured values.
export function hasNumericBoundaryViolation(text) {
  const normalized = String(text).normalize('NFKC');
  if (/[0-9]\s*(?:t\b|吨|kN\b|MN\b|mm\b|m\/min|%|项|个|维)/i.test(normalized)) return true;
  const remaining = normalized
    .replace(/(?<![A-Za-z0-9_.])S[1-5](?![A-Za-z0-9_.])/g, '')
    .replace(/(?<![\p{L}\p{N}_.+\-])(?:25|5)(?![\p{L}\p{N}_.%]|[,，][0-9])/gu, '');
  return /[0-9]/.test(remaining);
}
