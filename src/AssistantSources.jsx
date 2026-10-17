import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileText, Loader2, Paperclip, RefreshCw, Upload, X } from 'lucide-react';
import './assistant-sources.css';
import { isGeneralProcessKnowledge, knowledgeDisplay,knowledgeDisplayText } from './knowledgeDisplay.js';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const kinds = { paper: '论文', model: '模型代码', equipment: '设备资料', upload: '已上传', text: '文本资料', general: '工艺知识' };

async function requestKnowledge(options = {}) {
  const response = await fetch('/api/knowledge', options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || '资料请求未完成，请重试。');
  return body;
}

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('文件读取失败，请重新选择。'));
    reader.readAsDataURL(file);
  });
}

export default function AssistantSources({ open, onToggle, onUploaded, compact = false }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const fileInput = useRef(null), sourceRoot = useRef(null);
  const activeUpload = useRef(null);

  useEffect(() => () => activeUpload.current?.abort(), []);
  useEffect(() => {
    if (!compact || !open) return;
    const outside = event => { if (!sourceRoot.current?.contains(event.target)) onToggle(); };
    const escape = event => { if (event.key === 'Escape') { event.stopPropagation(); onToggle(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [compact, open, onToggle]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    requestKnowledge({ signal: controller.signal })
      .then(body => {
        if (!Array.isArray(body.docs)) throw new Error('资料列表未返回，请重试。');
        if (!controller.signal.aborted) setDocs(body.docs);
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, revision]);

  const upload = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (compact && !open) onToggle();
    const extension = file.name.split('.').at(-1).toLowerCase();
    if (!['txt', 'md', 'docx'].includes(extension)) { setError('请选择 TXT、MD 或 DOCX 文件。'); return; }
    if (!file.size) { setError('文件为空，请选择有内容的资料。'); return; }
    if (file.size > MAX_FILE_BYTES) { setError('单个文件请控制在 8 MB 以内。'); return; }
    const controller = new AbortController();
    activeUpload.current = controller;
    setUploading(true); setError('');
    try {
      const payload = extension === 'docx'
        ? { name: file.name, base64: await readBase64(file) }
        : { name: file.name, text: await file.text() };
      if (controller.signal.aborted) return;
      const body = await requestKnowledge({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
      if (controller.signal.aborted) return;
      if (Array.isArray(body.docs)) setDocs(body.docs);
      setRevision(value => value + 1);
      onUploaded?.(file.name);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause.message || '上传未完成，请重试。');
    } finally {
      if (!controller.signal.aborted) setUploading(false);
      if (activeUpload.current === controller) activeUpload.current = null;
    }
  };

  return <section ref={sourceRoot} className={`assistant-sources ${open ? 'is-open' : ''} ${compact ? 'is-compact' : ''}`}>
    <input ref={fileInput} type="file" aria-label="上传助手资料" accept=".txt,.md,.docx" hidden onChange={upload}/>
    {compact ? <div className="assistant-sources-bar compact-source-bar"><button type="button" className="assistant-tool-trigger" title="上传资料" aria-label="上传资料" disabled={uploading} onClick={() => fileInput.current?.click()}>{uploading ? <Loader2 size={16} className="spin"/> : <Paperclip size={16}/>}</button><button type="button" className="assistant-tool-trigger" title="查看资料" aria-label="查看资料" aria-expanded={open} aria-controls="assistant-source-files" onClick={onToggle}><FileText size={16}/></button></div> : <div className="assistant-sources-bar">
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls="assistant-source-files"><FileText size={13}/>资料{docs.length > 0 && <span>{docs.length}</span>}<ChevronDown size={12}/></button>
      {uploading && <small>正在提取资料…</small>}
    </div>}
    {open && <div className="assistant-source-files" id="assistant-source-files" data-escape-layer={compact ? 'popover' : undefined}>
      <div className="assistant-source-tools">
        <button type="button" disabled={uploading} onClick={() => fileInput.current?.click()}>{uploading ? <Loader2 size={13} className="spin"/> : <Upload size={13}/>}上传资料</button>
        <button type="button" aria-label="刷新助手资料" disabled={loading || uploading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={13}/></button>
        <button type="button" aria-label="收起助手资料" onClick={onToggle}><X size={13}/></button>
      </div>
      <p className="assistant-source-hint">TXT、MD、DOCX · 最大 8 MB</p>
      {error && <p className="assistant-source-error" role="alert">{error}</p>}
      {loading && <p className="assistant-source-status" role="status"><Loader2 size={12} className="spin"/>正在读取资料…</p>}
      {!loading && !error && !docs.length && <p className="assistant-source-status">添加资料后，助手会随提问检索原文。</p>}
      {docs.length > 0 && <ul className="assistant-source-list">{docs.map((doc, index) => <li key={doc.id || `${doc.fileName}-${index}`}>
        <FileText size={13}/><KnowledgeDocumentLabel doc={doc}/>
      </li>)}</ul>}
    </div>}
  </section>;
}

export function AssistantReferences({ references }) {
  const entries = Array.isArray(references) ? references.filter(reference => reference && !isGeneralProcessKnowledge(reference) && typeof reference.text === 'string' && reference.text.trim()) : [];
  if (!entries.length) return null;
  return <details className="assistant-references">
    <summary><FileText size={12}/>依据 {entries.length}<ChevronDown size={12}/></summary>
    <div className="assistant-reference-list">{entries.map((reference, index) => <details className="assistant-reference" key={`${reference.id || reference.fileName}-${index}`}>
      <summary><span>{index + 1}</span><b>{knowledgeDisplay(reference).displayTitle}</b><ChevronDown size={11}/></summary>
      {knowledgeDisplay(reference).knowledgeLabel && <small>{knowledgeDisplay(reference).knowledgeLabel}</small>}
      <div className="assistant-reference-location"><span>{knowledgeDisplay(reference).displayFileName}</span><code>{reference.locator}</code></div>
      <blockquote>{knowledgeDisplayText(reference.text)}</blockquote>
    </details>)}</div>
  </details>;
}

export function KnowledgeDocumentLabel({ doc }) {
  const display = knowledgeDisplay(doc);
  return <div><strong title={display.displayTitle}>{display.displayTitle}</strong><small title={display.displayFileName}>{display.displayFileName}</small><span>{kinds[doc.kind] || '参考资料'}{Number.isFinite(doc.chunkCount) ? ` · ${doc.chunkCount} 个片段` : ''}</span>{display.knowledgeLabel && <small>{display.knowledgeLabel}</small>}</div>;
}
