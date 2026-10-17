import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, Send } from 'lucide-react';
import { nearChatBottom, shouldSendChat } from './assistantLayout.js';

export function AssistantConversation({ messages, busy, open, children }) {
  const root = useRef(null), pinned = useRef(true), previous = useRef({ messages, busy });
  const [unread, setUnread] = useState(false);
  const bottom = () => { const node = root.current; if (node) node.scrollTop = node.scrollHeight; pinned.current = true; setUnread(false); };
  useLayoutEffect(() => {
    const changed = previous.current.messages !== messages || previous.current.busy !== busy;
    previous.current = { messages, busy };
    if (changed && !pinned.current) setUnread(true);
    if (open && root.current?.clientHeight && pinned.current) bottom();
  }, [messages, busy, open]);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new ResizeObserver(() => { if (node.clientHeight && pinned.current) bottom(); });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <div className="assistant-conversation">
    <div ref={root} className="chat-messages" aria-label="助手对话记录" onScroll={() => { if (!root.current?.clientHeight) return; pinned.current = nearChatBottom(root.current); if (pinned.current) setUnread(false); }}>{children}</div>
    {unread && <button className="chat-new-messages" onClick={bottom}><ArrowDown size={13}/>有新消息，回到底部</button>}
  </div>;
}
export function AssistantComposer({ value, onChange, onSend, busy, tools }) {
  const input = useRef(null), composing = useRef(false);
  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = Math.min(156, Math.max(38, node.scrollHeight)) + 'px';
  }, [value]);
  return <form className="chat-input" onSubmit={event => { event.preventDefault(); if (!composing.current && !busy) onSend(); }}>
    <textarea ref={input} aria-label="向 DK AI 提问" rows="2" value={value} onChange={event => onChange(event.target.value)} placeholder="输入问题或操作…"
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={event => { if (shouldSendChat(event.nativeEvent, composing.current)) { event.preventDefault(); if (!busy) onSend(); } }}/>
    <div className="assistant-composer-bar"><div className="assistant-composer-tools">{tools}</div><span>Enter 发送</span><button type="submit" aria-label="发送问题" disabled={busy || !value.trim()}><Send size={15}/></button></div>
  </form>;
}
