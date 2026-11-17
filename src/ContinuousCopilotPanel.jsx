import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, BookOpen, BrainCircuit, CheckCircle2, Loader2, Plus, ShieldAlert, Wrench } from 'lucide-react';
import FloatingAssistant from './FloatingAssistant.jsx';
import { AssistantComposer } from './AssistantConversation.jsx';
import UserVisibleText from './UserVisibleText.jsx';
import { ASSISTANT_MODES, ASSISTANT_MODE_LABELS } from './assistantAccess.js';
import './continuous-copilot.css';

async function request(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) window.dispatchEvent(new Event('dkqkar-session-expired'));
  if (!response.ok || data.ok === false) throw new Error(data.message || data.error || '连续分析服务暂时不可用。');
  return data;
}

const STALE_SESSION_MS = 12 * 60 * 60 * 1000;
// 超过 12 小时的旧会话不再自动续接，直接开新的空会话；历史仍留在下拉里，
// 手动恢复按钮已按操作者要求删除，回到旧会话走历史下拉（2026-11-16）。
const isStaleSession = session => {
  const updated = Date.parse(session?.updatedAt || '');
  return Number.isFinite(updated) && Date.now() - updated > STALE_SESSION_MS;
};
// 空态一键起始项：点一下直接开问，避免空窗只剩一段说明文字。
const STARTERS = [
  '当前工况有哪些风险？',
  '解释这次预测的依据',
  '如果不是当前假设呢？',
  '参考以前类似情况',
];

function Message({ message }) {
  // 模型与降级回复常带 Markdown 标题/列表前缀，面板按纯文本排版，去掉记号留内容。
  const text = typeof message.text === 'string' ? message.text.replace(/^#{1,6}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '· ') : message.text;
  return <article className={`ccp-message is-${message.role}`} data-message-id={message.id}>
    <header><span>{message.role === 'user' ? '你' : 'AI 副驾驶'}</span><small>{message.responseSource === 'LLM' ? '模型分析' : message.responseSource === 'DETERMINISTIC_FALLBACK' ? '确定性降级' : message.source === 'USER' ? '用户输入' : message.source}</small></header>
    <UserVisibleText value={text}/>
    {message.toolRefs?.length > 0 && <div className="ccp-receipts">{message.toolRefs.map(ref => <span key={ref.stepId}><CheckCircle2 size={12}/>{ref.actionId} · {ref.verified ? '已核验' : '待核验'}</span>)}</div>}
    {message.evidenceRefs?.length > 0 && <details className="ccp-evidence"><summary><BookOpen size={12}/>依据 {message.evidenceRefs.length} 条</summary>{message.evidenceRefs.map((ref, index) => <div key={ref.id || index}><strong>{ref.id} {ref.title || ref.source}</strong>{ref.locator && <small>{ref.locator}</small>}{ref.text && <p>{ref.text}</p>}</div>)}</details>}
  </article>;
}

// 2026-11-17：事件卡和交接摘要不显示英文级别
const SEVERITY_LABELS = { HIGH: '高', MEDIUM: '中', LOW: '低' };
export default function ContinuousCopilotPanel({ open, onOpenChange, sessionId: appSessionId, status, caseData, selected, source, notify, accessMode = 'APPROVAL', onAccessModeChange, readContext, onLegacy }) {
  const [session, setSession] = useState(null), [sessions, setSessions] = useState([]), [input, setInput] = useState('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [run, setRun] = useState(null);
  const [outcome, setOutcome] = useState(''), [publishing, setPublishing] = useState(false), [published, setPublished] = useState(null);
  const [incidents, setIncidents] = useState([]), [heartbeat, setHeartbeat] = useState(null), [incidentError, setIncidentError] = useState(''), [handover, setHandover] = useState(null);
  const [showMonitor, setShowMonitor] = useState(false);
  const requestRef = useRef(null), messagesRef = useRef(null);
  const load = useCallback(async id => {
    setLoading(true); setError('');
    try {
      const [current, history] = await Promise.all([request('/api/copilot/session' + (id ? '?id=' + encodeURIComponent(id) : '')), request('/api/copilot/sessions')]);
      let active = current.session;
      if (!id && isStaleSession(active)) {
        active = (await request('/api/copilot/session', { method: 'POST', body: '{}' })).session;
        const refreshed = await request('/api/copilot/sessions');
        setSessions(refreshed.items || []);
      } else setSessions(history.items || []);
      setSession(active);
    } catch (failure) { setError(failure.message); }
    finally { setLoading(false); }
  }, []);
  const loadIncidents = useCallback(async () => {
    try {
      const response = await request('/api/copilot/incidents', { method: 'POST' });
      setIncidents(response.incidents || []); setHeartbeat(response.heartbeat || null); setIncidentError('');
    } catch (failure) { setIncidentError(failure.message); }
  }, []);
  const acknowledgeIncident = async id => {
    try { const response = await request('/api/copilot/incidents/' + encodeURIComponent(id) + '/ack', { method: 'POST' }); setIncidents(items => items.map(item => item.id === id ? response.incident : item)); }
    catch (failure) { setIncidentError(failure.message); }
  };
  const loadHandover = async () => {
    try { setHandover(await request('/api/copilot/incidents/handover')); }
    catch (failure) { setIncidentError(failure.message); }
  };
  useEffect(() => { if (open) void load(); }, [open, appSessionId, load]);
  useEffect(() => {
    if (!open) return;
    void loadIncidents();
    const timer = setInterval(loadIncidents, 30000);
    return () => clearInterval(timer);
  }, [open, loadIncidents]);
  useEffect(() => { const node = messagesRef.current; if (node) node.scrollTop = node.scrollHeight; }, [session?.messages?.length, busy]);

  const send = async explicit => {
    const fromStarter = typeof explicit === 'string';
    const text = (fromStarter ? explicit : input).trim();
    if (!text || busy) return;
    const clientRequestId = crypto.randomUUID(), previous = session;
    requestRef.current = clientRequestId; setBusy(true); setError('');
    setSession(value => ({ ...value, messages: [...(value?.messages || []), { id: clientRequestId, role: 'user', text, source: 'USER' }] }));
    try {
      const response = await request('/api/copilot/chat', { method: 'POST', body: JSON.stringify({ sessionId: session?.id, message: text, context: readContext(text), accessMode, clientRequestId }) });
      setSession(response.session); setRun(response.run); if (!fromStarter) setInput('');
      const history = await request('/api/copilot/sessions'); setSessions(history.items || []);
    } catch (failure) { setSession(previous); setError(failure.message); }
    finally { setBusy(false); }
  };
  const createSession = async () => {
    setBusy(true); setError('');
    try { const response = await request('/api/copilot/session', { method: 'POST', body: '{}' }); setSession(response.session); setRun(null); setPublished(null); setSessions(items => [response.session, ...items]); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const publish = async () => {
    if (!outcome.trim() || !session?.id || publishing) return;
    setPublishing(true); setError('');
    try {
      const response = await request('/api/copilot/experience/publish', { method: 'POST', body: JSON.stringify({ sessionId: session.id, outcome, confirmed: true }) });
      setPublished(response.experience); setOutcome(''); notify?.('已保存为可检索的历史经验。');
    } catch (failure) { setError(failure.message); }
    finally { setPublishing(false); }
  };
  const lastAssistant = session?.messages?.findLast(message => message.role === 'assistant');
  const activeIncidents = incidents.filter(item => item.status === 'ACTIVE'), recoveredIncidents = incidents.filter(item => item.status === 'RECOVERED');
  return <FloatingAssistant open={open} onOpenChange={onOpenChange} sessionId={appSessionId} mode={status?.mode || 'cloud'}>
    <div className="ccp-panel" aria-label="连续工艺分析">
      <header className="ccp-header">
        <div className="ccp-head-status">
          <i className={status?.available ? 'is-ok' : 'is-warn'}/>
          <span>{status?.available ? '已连接' : '降级'}</span>
          {activeIncidents.length > 0 && <button type="button" className="ccp-event-chip" onClick={() => setShowMonitor(true)}><Activity size={11}/>{activeIncidents.length} 事件</button>}
        </div>
        <div className="ccp-header-actions"><button type="button" title="新建分析" aria-label="新建分析" onClick={createSession} disabled={busy}><Plus size={15}/></button><button type="button" className={'ccp-monitor-toggle' + (activeIncidents.length ? ' is-alert' : '')} title="全软件监控 · 事件与交接" aria-label="打开全软件监控" onClick={() => setShowMonitor(true)}><Activity size={14}/>{activeIncidents.length > 0 && <em>{activeIncidents.length}</em>}</button>{onLegacy && <button type="button" className="ccp-legacy" onClick={onLegacy}><Wrench size={13}/>高级工具</button>}</div>
      </header>

      <div className="ccp-meta">
        <span className="ccp-object">{selected || 'S5'} · {caseData?.id || '当前工况'}</span>
        <select className="ccp-session-select" aria-label="历史分析会话" title={sessions.find(item => item.id === session?.id)?.title || '历史分析'} value={session?.id || ''} onChange={event => void load(event.target.value)}><option value="" disabled>历史分析</option>{sessions.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
        {onAccessModeChange && <div className="ccp-permission" aria-label="副驾驶权限模式">{ASSISTANT_MODES.map(mode => <button type="button" key={mode} aria-pressed={accessMode === mode} title={ASSISTANT_MODE_LABELS[mode].description} onClick={() => onAccessModeChange(mode)}>{ASSISTANT_MODE_LABELS[mode].label}</button>)}</div>}
      </div>

      {session?.constraints?.length > 0 && <div className="ccp-constraints">{session.constraints.map(item => <span key={item}>约束：{item}</span>)}</div>}

      {activeIncidents.length > 0 && <button type="button" className="ccp-incident-banner" onClick={() => setShowMonitor(true)}>
        <ShieldAlert size={13}/><span>{activeIncidents[0].title}</span><em>{activeIncidents.length} 条未处理</em><b>查看</b>
      </button>}

      <div className="ccp-messages" ref={messagesRef} aria-live="polite">
        {!session?.messages?.length && <div className="ccp-empty">
          <div className="ccp-empty-head"><BrainCircuit size={16}/><p>从当前工况开始，连续分析问题。</p></div>
          <div className="ccp-starters">{STARTERS.map(text => <button type="button" key={text} disabled={busy} onClick={() => void send(text)}>{text}</button>)}</div>
        </div>}
        {session?.messages?.map(message => <Message key={message.id} message={message}/>)}
        {busy && <div className="ccp-thinking"><Loader2 size={14} className="spin"/>正在结合上下文与真实工具分析…</div>}
      </div>

      {error && <div className="ccp-error" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="关闭错误">×</button></div>}
      {run?.generationError && <p className="ccp-degraded" role="status">{run.generationError.message}</p>}

      {(session?.task?.hypotheses?.length > 0 || run?.experiences?.length > 0 || lastAssistant) && <details className="ccp-more">
        <summary>更多{session?.task?.hypotheses?.length ? ` · 假设 ${session.task.hypotheses.length}` : ''}{run?.experiences?.length ? ` · 经验 ${run.experiences.length}` : ''}{lastAssistant ? ' · 经验沉淀' : ''}</summary>
        <div className="ccp-more-body">
          {session?.task?.hypotheses?.length > 0 && <div className="ccp-hypotheses">{session.task.hypotheses.map(item => <div key={item.id} className={'is-' + String(item.status).toLowerCase()}><span>{item.text}</span><small>{item.status === 'SUPERSEDED' ? '已替代' : item.status === 'CANDIDATE' ? '候选' : item.status}</small></div>)}</div>}
          {run?.experiences?.length > 0 && <div className="ccp-experiences">{run.experiences.map(item => <div key={item.id}><strong>{item.title}</strong><span>相似度 {item.score?.toFixed(3) ?? '—'} · {item.sourceStatus}</span><p>{item.outcome}</p></div>)}</div>}
          {lastAssistant && <div className="ccp-publish"><p>只有确认实际结果后才写入；模型推断不会自动成为事实。</p><textarea aria-label="经验实际结果" value={outcome} onChange={event => setOutcome(event.target.value)} placeholder="例如：已核对资料，未修改正式参数。"/><button type="button" disabled={!outcome.trim() || publishing} onClick={publish}>{publishing ? '保存中…' : '确认结果并保存经验'}</button>{published && <small>已保存：{published.title}</small>}</div>}
        </div>
      </details>}

      <AssistantComposer value={input} onChange={setInput} onSend={send} busy={busy}/>

      {showMonitor && <div className="ccp-drawer-backdrop" onClick={() => setShowMonitor(false)}>
        <aside className="ccp-drawer" onClick={event => event.stopPropagation()} aria-label="全软件监控">
          <header><span><Activity size={13}/>全软件监控</span><button type="button" onClick={() => setShowMonitor(false)} aria-label="关闭">×</button></header>
          <small className="ccp-drawer-sub">{incidentError || (heartbeat ? `心跳 ${new Date(heartbeat.at).toLocaleTimeString('zh-CN', { hour12: false })} · ${activeIncidents.length} 个活动事件` : '正在核对服务状态…')}</small>
          {activeIncidents.length === 0 ? <p className="is-healthy"><CheckCircle2 size={12}/>当前未发现需要处理的活动事件</p> : activeIncidents.slice(0, 6).map(item => <article key={item.id} className={'ccp-incident is-' + String(item.severity).toLowerCase()}>
            <div><ShieldAlert size={13}/><strong>{item.title}</strong><em>{SEVERITY_LABELS[item.severity] || '中'}</em></div>
            <p>{item.summary}</p><small>影响：{(item.impact || []).join('、') || '待核对'} · 已出现 {item.occurrences} 次</small>
            <button type="button" disabled={Boolean(item.acknowledgedAt)} onClick={() => acknowledgeIncident(item.id)}>{item.acknowledgedAt ? '已确认已知' : '确认已知'}</button>
          </article>)}
          <details><summary>事件记录与交接</summary>
            {recoveredIncidents.slice(0, 3).map(item => <div className="ccp-recovered" key={item.id}><CheckCircle2 size={11}/>{item.title}<small>已由实际状态核对恢复</small></div>)}
            <button type="button" className="ccp-handover-button" onClick={loadHandover}>生成当前交接摘要</button>
            {handover && <pre className="ccp-handover">{`${handover.note}\n活动事件：${handover.activeCount} 条\n${handover.active.map(item => `- [${SEVERITY_LABELS[item.severity] || '中'}] ${item.title}${item.acknowledged ? '（已确认）' : ''}`).join('\n')}\n待处理任务：${handover.pendingTasks.length} 条`}</pre>}
          </details>
        </aside>
      </div>}
    </div>
  </FloatingAssistant>;
}
