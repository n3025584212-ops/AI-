import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, BadgeCheck, BookOpen, ClipboardCheck, Loader2, RefreshCw, Send, ShieldAlert, X } from 'lucide-react';
import './technician.css';

const CONFIDENCE_LABEL = { HIGH: '高置信', MEDIUM: '中置信', LOW: '低置信' };
const TYPE_LABEL = { answer: '答复', diagnosis: '诊断单', action: '执行回执', report: '报告', watch: '值守解释', handover: '交接摘要' };
const TABS = [['watch', '值守'], ['handover', '交接'], ['memory', '记忆'], ['duties', '职责']];

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.message || data.error || '技术员服务暂时不可用。');
  return data;
}

function RiskBadge({ level }) {
  return <span className={'tech-risk tech-risk-' + String(level || '').toLowerCase()}>{level || '—'}</span>;
}

function ContractCard({ reply, onAction }) {
  return <article className="tech-reply" data-confidence={reply.confidence} data-duty={reply.duty}>
    <header className="tech-reply-head">
      <span className="tech-type">{TYPE_LABEL[reply.type] || reply.type}</span>
      <span className="tech-duty">{reply.duty} · {reply.mode}</span>
      <span className={'tech-confidence is-' + String(reply.confidence || '').toLowerCase()}>{CONFIDENCE_LABEL[reply.confidence] || reply.confidence}</span>
    </header>
    <div className="tech-summary">{reply.summary}</div>
    {reply.note && <p className="tech-note"><AlertTriangle size={12}/>{reply.note}</p>}
    {reply.evidence?.length > 0 && <details className="tech-evidence" open>
      <summary><BookOpen size={12}/>依据 {reply.evidence.length} 条</summary>
      {reply.evidence.map(item => <div key={item.id} className="tech-evidence-item">
        <strong>[{item.id}] {item.title}</strong>
        <small>{item.fileName || ''} · {item.locator || ''}</small>
        <blockquote>{item.quote}</blockquote>
      </div>)}
    </details>}
    {reply.memory_used?.length > 0 && <details className="tech-memory-used"><summary>引用的记忆 {reply.memory_used.length} 条</summary>
      {reply.memory_used.map(fact => <div key={fact.id} className="tech-memory-row"><span className={'tech-fact-state is-' + fact.status.toLowerCase()}>{fact.status === 'CONFIRMED' ? '已确认' : '待验证'}</span>{fact.text}</div>)}
    </details>}
    {reply.actions?.length > 0 && <div className="tech-actions">
      {reply.actions.map(action => <button key={action.tool + action.label} type="button" onClick={() => onAction(action)}>
        <RiskBadge level={action.risk_level}/>{action.label}{action.needs_confirm && <em>需确认</em>}
      </button>)}
    </div>}
    {reply.blocked_actions?.length > 0 && <div className="tech-blocked">
      <strong><ShieldAlert size={12}/>高危动作（不代执行）</strong>
      {reply.blocked_actions.map(action => <div key={action.tool + action.label}><RiskBadge level={action.risk_level}/>{action.label} —— 请由有权限的人员按 SOP 执行。</div>)}
    </div>}
    {reply.next_steps?.length > 0 && <div className="tech-next"><strong>下一步</strong><ul>{reply.next_steps.map(step => <li key={step}>{step}</li>)}</ul></div>}
  </article>;
}

export default function TechnicianPanel({ context = {}, notify }) {
  const [status, setStatus] = useState(null), [tab, setTab] = useState('watch');
  const [watch, setWatch] = useState(null), [handover, setHandover] = useState(null), [memory, setMemory] = useState(null);
  const [messages, setMessages] = useState([]), [input, setInput] = useState(''), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [sessionId, setSessionId] = useState(null), [tick, setTick] = useState(0);
  const list = useRef(null);

  const loadBase = useCallback(async () => {
    try { const [statusData, watchData] = await Promise.all([api('/api/technician/status'), api('/api/technician/watch')]);
      setStatus(statusData); setWatch(watchData); setError('');
    } catch (failure) { setError(failure.message); }
  }, []);
  useEffect(() => { void loadBase(); }, [loadBase, tick]);
  useEffect(() => {
    if (tab === 'memory' && !memory) api('/api/technician/memory').then(data => setMemory(data.memory)).catch(failure => setError(failure.message));
    if (tab === 'handover' && !handover) setHandover(status?.memory?.handovers?.[0] || null);
  }, [tab, memory, handover, status]);
  useEffect(() => {
    const node = list.current;
    if (!node) return;
    const frame = requestAnimationFrame(() => { node.scrollTop = node.scrollHeight; });
    return () => cancelAnimationFrame(frame);
  }, [messages, busy]);

  const send = async () => {
    const message = input.trim();
    if (!message || busy) return;
    setInput(''); setBusy(true); setError('');
    setMessages(previous => [...previous, { role: 'user', text: message }]);
    try {
      const reply = await api('/api/technician/chat', { method: 'POST', body: JSON.stringify({ message, context, sessionId }) });
      if (reply.session_id) setSessionId(reply.session_id);
      setMessages(previous => [...previous, { role: 'assistant', reply }]);
    } catch (failure) { setMessages(previous => [...previous, { role: 'assistant', error: failure.message }]); }
    finally { setBusy(false); }
  };

  const runAction = async action => {
    if (action.risk_level === 'L3') { notify?.('高危动作不代执行，请按 SOP 人工处理。', 'WARNING'); return; }
    if (action.needs_confirm && !window.confirm(`${action.label}\n风险等级 ${action.risk_level}，确认执行？`)) return;
    window.dispatchEvent(new CustomEvent('qcdkr:technician-action', { detail: action }));
    notify?.(`已下发：${action.label}`, 'INFO');
  };

  const remember = async fact => {
    try { await api('/api/technician/memory', { method: 'POST', body: JSON.stringify({ action: 'remember', text: fact.text, status: 'CONFIRMED', source: 'OPERATOR' }) });
      setMemory(null); setTick(value => value + 1); notify?.('已确认并写入记忆。', 'INFO');
    } catch (failure) { notify?.(failure.message, 'WARNING'); }
  };
  const closeIssue = async issue => {
    try { await api('/api/technician/memory', { method: 'POST', body: JSON.stringify({ action: 'resolve', id: issue.id, resolution: '交接确认关闭' }) });
      setMemory(null); setTick(value => value + 1); notify?.('未决项已关闭。', 'INFO');
    } catch (failure) { notify?.(failure.message, 'WARNING'); }
  };
  const generateHandover = async () => {
    try { setHandover(await api('/api/technician/handover', { method: 'POST', body: JSON.stringify({ note: '' }) })); setTick(value => value + 1); }
    catch (failure) { setError(failure.message); }
  };

  return <div className="technician-panel">
    <div className="tech-tabs" role="tablist" aria-label="技术员面板">
      {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
      <button type="button" className="tech-refresh" aria-label="刷新值守" onClick={() => { setMemory(null); setTick(value => value + 1); }}><RefreshCw size={12}/></button>
    </div>
    {error && <div className="tech-error" role="status"><AlertTriangle size={12}/>{error}<button type="button" aria-label="关闭" onClick={() => setError('')}><X size={11}/></button></div>}
    <div className="tech-body">
      {tab === 'watch' && <>
        <div className="tech-kpis">
          <span><b>{status?.kpis?.turns ?? 0}</b>交互</span><span><b>{status?.kpis?.grounding_rate ? Math.round(status.kpis.grounding_rate * 100) + '%' : '—'}</b>引用率</span>
          <span><b>{watch?.open_events ?? 0}</b>未闭环</span><span><b>{status?.kpis?.open_issues ?? 0}</b>未决项</span>
          <span><b>{status?.kpis?.l3_blocked ?? 0}</b>高危拦截</span>
        </div>
        <div className="tech-cards">
          {watch?.cards?.length ? watch.cards.map(card => <article key={card.id} className="tech-card" data-severity={card.severity}>
            <header><span className={'tech-severity is-' + String(card.severity || '').toLowerCase()}>{card.severity}</span><strong>{card.title}</strong></header>
            <p>{card.explanation}</p>
            <details><summary>先查这些</summary><ul>{card.checks?.map(item => <li key={item}>{item}</li>)}</ul></details>
          </article>) : <p className="tech-empty">当前没有未闭环事件。值守会持续检查事件、模型与 AI 状态。</p>}
        </div>
      </>}
      {tab === 'handover' && <>
        <button type="button" className="tech-primary" onClick={generateHandover}><ClipboardCheck size={13}/>生成本班交接摘要</button>
        {handover ? <>
          <pre className="tech-handover">{handover.text}</pre>
          {handover.sections?.issues?.length > 0 && <div className="tech-issues"><strong>未决项</strong>{handover.sections.issues.map(issue => <div key={issue.id}><RiskBadge level={issue.severity === 'HIGH' ? 'L3' : issue.severity === 'LOW' ? 'L0' : 'L2'}/>{issue.title}</div>)}</div>}
        </> : <p className="tech-empty">还没有交接记录。点上面按钮生成本班摘要。</p>}
        {status?.memory?.handovers?.length > 1 && <details className="tech-history"><summary>历史交接 {status.memory.handovers.length} 条</summary>
          {status.memory.handovers.slice(1, 6).map(item => <div key={item.id}><small>{item.at}</small><p>{item.note || '—'}</p></div>)}
        </details>}
      </>}
      {tab === 'memory' && <>
        <div className="tech-memory-head"><strong>记忆</strong><span>已确认事实与未决项；PENDING 不得当事实使用。</span></div>
        <div className="tech-memory-list">
          {memory?.facts?.length ? memory.facts.map(fact => <div key={fact.id} className="tech-memory-row">
            <span className={'tech-fact-state is-' + fact.status.toLowerCase()}>{fact.status === 'CONFIRMED' ? '已确认' : '待验证'}</span>
            <span>{fact.text}</span>
            {fact.status !== 'CONFIRMED' && <button type="button" onClick={() => remember(fact)}><BadgeCheck size={11}/>确认</button>}
          </div>) : <p className="tech-empty">还没有记忆。技术员会在诊断与交接中逐步沉淀现场事实。</p>}
        </div>
        <div className="tech-issues">
          <strong>未决项</strong>
          {memory?.issues?.filter(issue => issue.status === 'OPEN').length ? memory.issues.filter(issue => issue.status === 'OPEN').map(issue => <div key={issue.id}>
            <RiskBadge level={issue.severity === 'HIGH' ? 'L3' : issue.severity === 'LOW' ? 'L0' : 'L2'}/><span>{issue.title}</span><button type="button" onClick={() => closeIssue(issue)}>关闭</button>
          </div>) : <p className="tech-empty">没有未决项。</p>}
        </div>
      </>}
      {tab === 'duties' && <>
        <div className="tech-duty-list">{status?.duties?.map(duty => <article key={duty.id} className="tech-duty">
          <header><strong>{duty.label}</strong><RiskBadge level={duty.risk}/></header>
          <p>{duty.goal}</p>
          <small>交付物：{duty.deliverables?.join('、')} · 工具：{duty.tools?.slice(0, 4).join('、')}</small>
        </article>)}</div>
        <div className="tech-permissions"><strong>权限分级</strong>
          {status?.permissions && Object.entries(status.permissions).map(([level, item]) => <div key={level}><RiskBadge level={level}/><span>{item.label} · {item.description}</span><em>{item.approval === 'blocked' ? '不代执行' : item.approval === 'single' ? '人工确认' : '直接放行'}</em></div>)}
        </div>
        <div className="tech-boundaries"><strong>禁区</strong><ul>{status?.boundaries?.map(item => <li key={item}>{item}</li>)}</ul></div>
      </>}
    </div>
    <div className="tech-chat">
      <div className="tech-chat-list" ref={list}>
        {messages.length === 0 && <p className="tech-empty">问值守技术员：告警解释、诊断、参数建议、资料依据。回答会标注依据与置信度。</p>}
        {messages.map((message, index) => message.role === 'user'
          ? <div key={'u' + index} className="tech-user">{message.text}</div>
          : message.error ? <div key={'e' + index} className="tech-error">{message.error}</div>
            : <ContractCard key={'a' + index} reply={message.reply} onAction={runAction}/>)}
        {busy && <div className="tech-thinking"><Loader2 className="spin" size={13}/>技术员正在核验工况与资料…</div>}
      </div>
      <form className="tech-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
        <textarea rows="2" value={input} aria-label="向值守技术员提问" placeholder="问：S5 张力波动意味着什么？" onChange={event => setInput(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }}/>
        <button type="submit" aria-label="发送" disabled={busy || !input.trim()}><Send size={14}/></button>
      </form>
    </div>
  </div>;
}
