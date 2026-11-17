import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, Send } from 'lucide-react';
import { nearChatBottom, shouldSendChat } from './assistantLayout.js';

export function AssistantConversation({ messages, busy, open, children }) {
  const root = useRef(null), pinned = useRef(true), previous = useRef({ signature: '' });
  const [unread, setUnread] = useState(false);
  const bottom = () => { const node = root.current; if (node) node.scrollTop = node.scrollHeight; pinned.current = true; setUnread(false); };
  // 2026-11-14 修复 React #185：App 每次渲染都内联 map 出新的 messages 数组，
  // 引用比较导致本布局效应在每次无关渲染时都 setState，与顶栏时钟/状态轮询叠加触发嵌套更新上限。
  // 改用内容签名（条数 + 末条标识 + 末条文本长度），只有真实变化才更新。
  const last = messages[messages.length - 1];
  const signature = messages.length + ':' + (last?.request_id || last?.user_message_id || '') + ':' + (typeof last?.text === 'string' ? last.text.length : 0) + (busy ? ':busy' : '');
  useLayoutEffect(() => {
    const changed = previous.current.signature !== signature;
    previous.current = { signature };
    if (changed && !pinned.current) setUnread(true);
    if (open && root.current?.clientHeight && pinned.current) bottom();
  }, [signature, open]);
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
    node.style.height = Math.min(156, Math.max(30, node.scrollHeight)) + 'px';
  }, [value]);
  // 2026-11-14 D5：输入法 compositionend 丢失时 composing 会一直为 true，回车和发送按钮都会失效。
  // 失焦时复位；点击发送按钮（submit）不受输入法合成态影响。
  return <form className="chat-input" onSubmit={event => { event.preventDefault(); composing.current = false; if (!busy) onSend(); }}>
    <textarea ref={input} aria-label="向 DK AI 提问" rows="1" value={value} onChange={event => onChange(event.target.value)} placeholder="输入问题或操作…"
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onBlur={() => { composing.current = false; }}
      onKeyDown={event => { if (shouldSendChat(event.nativeEvent, composing.current)) { event.preventDefault(); if (!busy) onSend(); } }}/>
    <div className="assistant-composer-bar"><div className="assistant-composer-tools">{tools}</div><button type="submit" aria-label="发送问题" disabled={busy || !value.trim()}><Send size={15}/></button></div>
  </form>;
}
