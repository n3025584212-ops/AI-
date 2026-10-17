// Fetch uses the desktop's authenticated XHR path; only validated workbook
// bytes become a renderer-owned Blob for the native save dialog.
export async function downloadPointMapTemplate({ fetcher = globalThis.fetch, document = globalThis.document, url = globalThis.URL } = {}) {
  const response = await fetcher('/api/communication/template', { credentials: 'same-origin' });
  if (!response.ok) throw new Error(response.status === 401 ? '会话已失效，请重新登录后下载标准点表。' : '标准点表下载失败，请重试。');
  const type = response.headers.get('content-type') || '';
  if (!type.toLowerCase().includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) throw new Error('标准点表响应格式异常，请重试。');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 4 || bytes.length > 2 * 1024 * 1024 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('标准点表文件无效，请重试。');
  const href = url.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement('a');
  anchor.href = href; anchor.download = 'QCDKR_PLC_POINT_MAP_TEMPLATE.xlsx';
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => url.revokeObjectURL(href), 60000);
}
