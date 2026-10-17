/** Normalize generated OOXML parts for native PowerPoint, which rejects invalid cell anchors. */
export async function normalizePresentation(blob) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const manifest = zip.file('[Content_Types].xml');
  if (!manifest) throw new Error('演示文稿缺少内容类型清单。');
  const types = await manifest.async('string');
  zip.file('[Content_Types].xml', types.replace(/<Override\b[^>]*\bPartName="([^"]+)"[^>]*\/>/g,
    (entry, part) => zip.file(part.replace(/^\//, '')) ? entry : ''));
  await Promise.all(Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).map(async name => {
    let xml = (await zip.file(name).async('string')).replace(/\banchor="mid"/g, 'anchor="ctr"');
    const ids = [...xml.matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"/g)].map(match => Number(match[1]));
    let nextId = Math.max(0, ...ids) + 1;
    const seen = new Set();
    xml = xml.replace(/(<p:cNvPr\b[^>]*\bid=")(\d+)("[^>]*>)/g, (entry, before, id, after) => {
      const unique = seen.has(id) ? String(nextId++) : id;
      seen.add(unique);
      return `${before}${unique}${after}`;
    });
    zip.file(name, xml);
  }));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}
