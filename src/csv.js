/** One bounded CSV parser shared by case and time-series imports. */
export function readCSV(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('CSV 文件为空。');
  if (new TextEncoder().encode(text).length > 8 * 1024 * 1024) throw new Error('CSV 文件最多为 8 MiB。');
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', quoted = false, closed = false;
  const pushCell = () => { row.push(cell); cell = ''; closed = false; };
  const pushRow = () => {
    pushCell();
    if (row.length > 1 || row[0].trim()) rows.push(row);
    if (rows.length > 100001) throw new Error('CSV 最多包含 100000 条数据。');
    row = [];
  };
  for (let cursor = 0; cursor < text.length; cursor++) {
    const char = text[cursor];
    if (quoted) {
      if (char === '"') {
        if (text[cursor + 1] === '"') { cell += '"'; cursor++; }
        else { quoted = false; closed = true; }
      } else cell += char;
    } else if (char === ',') pushCell();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[cursor + 1] === '\n') cursor++;
      pushRow();
    } else if (char === '"' && cell === '' && !closed) quoted = true;
    else if (char === '"' || (closed && char.trim())) throw new Error('CSV 引号格式不正确。');
    else if (!closed) cell += char;
  }
  if (quoted) throw new Error('CSV 存在未闭合的引号。');
  if (row.length || cell || closed) pushRow();
  return rows;
}

const unsafeText = text => /^[\s]*[=+\-@]/.test(text) || /^[\t\r\n']/.test(text);

/** Quote CSV syntax and neutralize spreadsheet formulas in text, never numbers. */
export function csvCell(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('CSV 不接受非有限数值。');
  let text = String(value);
  if (typeof value === 'string' && unsafeText(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Reverse only the text protection emitted by csvCell, preserving raw values. */
export function csvText(value) {
  return value.startsWith("'") && unsafeText(value.slice(1)) ? value.slice(1) : value;
}

export function assertCSVHeaders(headers, allowed) {
  if (new Set(headers).size !== headers.length) throw new Error('CSV 表头列名重复。');
  for (const header of headers) if (!allowed.includes(header)) throw new Error(`未知 CSV 列：${header || '空列名'}。`);
}
