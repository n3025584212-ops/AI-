import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2, Minus, X } from 'lucide-react';
import {
  ASSISTANT_WINDOW_STORAGE, clampWindowRect, defaultWindowState, keyboardWindowDelta,
  maximizedWindowRect, minimizedWindowRect, moveWindowRect, resizeWindowRect, restoreWindowState,
} from './assistantWindowGeometry.js';
import './floating-assistant.css';

const directions = [['n', '上'], ['ne', '右上'], ['e', '右'], ['se', '右下'],
  ['s', '下'], ['sw', '左下'], ['w', '左'], ['nw', '左上']];
const viewportNow = () => {
  const visual = window.visualViewport;
  return { width: visual?.width || window.innerWidth, height: visual?.height || window.innerHeight,
    left: visual?.offsetLeft || 0, top: visual?.offsetTop || 0 };
};
const upperEscapeLayer = () => [...document.querySelectorAll(
  '.modal-backdrop, .voice-popover, [data-escape-layer="modal"], [data-escape-layer="popover"]',
)].some(node => node.getClientRects().length > 0);

export function AssistantDock({ children }) {
  return createPortal(<div className="ai-floating-dock">{children}</div>, document.body);
}

export default function FloatingAssistant({ open, onOpenChange, sessionId, mode = 'local', children }) {
  const [viewport, setViewport] = useState(viewportNow);
  const [saved, setSaved] = useState(() => defaultWindowState(viewport));
  const [host, setHost] = useState(null);
  const [dragging, setDragging] = useState(false);
  const panel = useRef(null), dragHandle = useRef(null), gesture = useRef(null);
  const opener = useRef(null), previousOpen = useRef(false), hydrated = useRef(null);
  const interacted = useRef(false), restoringVisibility = useRef(false), latest = useRef(null);
  if (open && hydrated.current === null) interacted.current = true;
  latest.current = { saved, viewport, open, onOpenChange };
  const minimized = saved.mode === 'minimized', maximized = saved.mode === 'maximized';
  const rect = minimized ? minimizedWindowRect(saved.minimizedPosition, viewport)
    : maximized ? maximizedWindowRect(viewport) : clampWindowRect(saved.rect, viewport);
  const state = !open ? 'CLOSED' : saved.mode.toUpperCase();

  function commit(update) {
    interacted.current = true;
    const next = { ...latest.current.saved, ...update };
    latest.current.saved = next;
    setSaved(next);
  }
  function finishGesture(event) {
    const active = gesture.current;
    if (!active || (event && event.type !== 'blur' && event.pointerId !== undefined && event.pointerId !== active.id)) return;
    gesture.current = null;
    try { if (active.target?.hasPointerCapture(active.id)) active.target.releasePointerCapture(active.id); } catch {}
    setDragging(false);
    document.body.classList.remove('ai-window-gesturing');
  }
  function close() {
    finishGesture();
    commit({ mode: 'normal' });
    latest.current.onOpenChange(false);
  }
  function restore() {
    finishGesture();
    commit({ mode: 'normal' });
    requestAnimationFrame(() => dragHandle.current?.focus({ preventScroll: true }));
  }
  function toggleMaximize() {
    finishGesture();
    commit({ mode: latest.current.saved.mode === 'maximized' ? 'normal' : 'maximized' });
  }
  function minimize() {
    finishGesture();
    commit({ mode: 'minimized' });
    requestAnimationFrame(() => panel.current?.querySelector('[aria-label="还原 AI 聊天窗"]')?.focus({ preventScroll: true }));
  }
  function startGesture(event, kind, direction) {
    if (event.button !== 0 || !latest.current.open || latest.current.saved.mode === 'maximized') return;
    event.preventDefault();
    finishGesture();
    const compact = latest.current.saved.mode === 'minimized';
    const current = compact ? minimizedWindowRect(latest.current.saved.minimizedPosition, latest.current.viewport)
      : clampWindowRect(latest.current.saved.rect, latest.current.viewport);
    gesture.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY,
      rect: current, kind, direction, compact, target: event.currentTarget };
    interacted.current = true;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
    document.body.classList.add('ai-window-gesturing');
    setDragging(true);
  }
  function keyMove(event) {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (latest.current.saved.mode === 'minimized') restore(); else toggleMaximize();
      return;
    }
    const delta = keyboardWindowDelta(event.key, event.shiftKey);
    if (!delta || latest.current.saved.mode === 'maximized') return;
    event.preventDefault(); event.stopPropagation();
    const compact = latest.current.saved.mode === 'minimized';
    const value = compact ? latest.current.saved.minimizedPosition : latest.current.saved.rect;
    const moved = moveWindowRect(value, delta.dx, delta.dy, latest.current.viewport, compact);
    commit(compact ? { minimizedPosition: moved } : { rect: moved });
  }
  function keyResize(event, direction) {
    const delta = keyboardWindowDelta(event.key, event.shiftKey);
    if (!delta || event.isComposing || event.keyCode === 229) return;
    event.preventDefault(); event.stopPropagation();
    commit({ rect: resizeWindowRect(latest.current.saved.rect, direction, delta.dx, delta.dy, latest.current.viewport) });
  }

  useLayoutEffect(() => { setHost(document.body); }, []);
  useLayoutEffect(() => {
    if (!sessionId || hydrated.current === sessionId) return;
    let serialized;
    try { serialized = sessionStorage.getItem(ASSISTANT_WINDOW_STORAGE); } catch {}
    const firstHydration = hydrated.current === null;
    const restored = restoreWindowState(serialized, sessionId, latest.current.viewport);
    hydrated.current = sessionId;
    if (firstHydration && interacted.current) {
      setSaved(previous => ({ ...previous, sessionId }));
    } else {
      finishGesture();
      setSaved(restored);
      restoringVisibility.current = restored.open !== latest.current.open;
      latest.current.onOpenChange(restored.open);
    }
  }, [sessionId]);
  useEffect(() => {
    if (!sessionId || saved.sessionId !== sessionId) return;
    try {
      sessionStorage.setItem(ASSISTANT_WINDOW_STORAGE, JSON.stringify({
        app_session_id: sessionId, rect: saved.rect, minimizedPosition: saved.minimizedPosition,
        mode: saved.mode, open,
      }));
    } catch {}
  }, [sessionId, saved, open]);

  useLayoutEffect(() => {
    if (open && !previousOpen.current) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && !panel.current?.contains(active) && active !== document.body) opener.current = active;
      if (!restoringVisibility.current && latest.current.saved.mode === 'minimized') commit({ mode: 'normal' });
      requestAnimationFrame(() => {
        if (!latest.current.open) return;
        if (latest.current.saved.mode === 'minimized') panel.current?.querySelector('[aria-label="还原 AI 聊天窗"]')?.focus({ preventScroll: true });
        else dragHandle.current?.focus({ preventScroll: true });
      });
    } else if (!open && previousOpen.current) {
      finishGesture();
      const target = opener.current?.isConnected ? opener.current
        : document.querySelector('[aria-label="工艺助手"]');
      requestAnimationFrame(() => {
        if (!latest.current.open && target instanceof HTMLElement) target.focus({ preventScroll: true });
      });
    }
    previousOpen.current = open;
    restoringVisibility.current = false;
  }, [open, host]);

  useEffect(() => {
    const resize = () => {
      finishGesture();
      const next = viewportNow();
      latest.current.viewport = next;
      setViewport(next);
      setSaved(previous => ({ ...previous, rect: clampWindowRect(previous.rect, next),
        minimizedPosition: minimizedWindowRect(previous.minimizedPosition, next) }));
    };
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
    return () => {
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', resize);
    };
  }, []);
  useEffect(() => {
    const move = event => {
      const active = gesture.current;
      if (!active || event.pointerId !== active.id) return;
      if (event.pointerType === 'mouse' && event.buttons === 0) { finishGesture(event); return; }
      event.preventDefault();
      const dx = event.clientX - active.startX, dy = event.clientY - active.startY;
      const next = active.kind === 'resize'
        ? resizeWindowRect(active.rect, active.direction, dx, dy, latest.current.viewport)
        : moveWindowRect(active.rect, dx, dy, latest.current.viewport, active.compact);
      commit(active.compact ? { minimizedPosition: next } : { rect: next });
    };
    const finish = event => finishGesture(event);
    window.addEventListener('pointermove', move, { capture: true, passive: false });
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
    window.addEventListener('blur', finish);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      window.removeEventListener('blur', finish);
      finishGesture();
    };
  }, []);
  useEffect(() => {
    const escape = event => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229
        || !latest.current.open || upperEscapeLayer()) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (latest.current.saved.mode === 'maximized') restore(); else close();
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, []);

  useEffect(() => {
    const toggle = () => {
      if (latest.current.open && latest.current.saved.mode === 'minimized') restore();
      else if (latest.current.open) close();
      else { commit({ mode: 'normal' }); latest.current.onOpenChange(true); }
    };
    window.addEventListener('dkqkar-assistant-toggle', toggle);
    return () => window.removeEventListener('dkqkar-assistant-toggle', toggle);
  }, []);

  if (!host) return null;
  return createPortal(<aside ref={panel} id="assistant-floating-window"
    className={'assistant-panel ai-floating-window' + (dragging ? ' is-dragging' : '')}
    style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, zIndex: maximized ? 141 : 140 }}
    role="dialog" aria-modal="false" aria-label="DK 工艺 Agent" data-state={state} hidden={!open}>
    <header className="ai-window-titlebar">
      <div ref={dragHandle} className="ai-window-drag-handle" role="button" tabIndex={0}
        aria-label="移动 AI 聊天窗" title={minimized ? '拖动移动 · Enter 还原' : '拖动移动 · 方向键微调 · 双击或 Enter 最大化'}
        onPointerDown={event => startGesture(event, 'move')} onKeyDown={keyMove}
        onDoubleClick={() => minimized ? restore() : toggleMaximize()}>
        <img className="ai-window-mascot" src="/assets/dk-assistant.gif" alt="" draggable="false"/><span className="ai-window-title"><b>DK AI</b></span>
      </div>
      <div className="ai-window-controls">
        {!minimized && <button type="button" title="最小化" aria-label="最小化 AI 聊天窗" onClick={minimize}><Minus size={15}/></button>}
        <button type="button" title={minimized || maximized ? '还原' : '最大化'} aria-label={minimized || maximized ? '还原 AI 聊天窗' : '最大化 AI 聊天窗'} onClick={() => minimized ? restore() : toggleMaximize()}>{minimized || maximized ? <Minimize2 size={14}/> : <Maximize2 size={14}/>}</button>
        <button type="button" className="ai-window-close" title="关闭" aria-label="关闭 AI 聊天窗" onClick={close}><X size={16}/></button>
      </div>
    </header>
    <div className="ai-floating-body" hidden={minimized}>{children}</div>
    {!minimized && !maximized && directions.map(([direction, label]) => <div key={direction}
      className={'ai-window-resize ai-resize-' + direction} data-resize-direction={direction}
      role="button" tabIndex={0} aria-label={'向' + label + '调整 AI 聊天窗大小'}
      title={'拖动调整大小 · 方向键微调 · Shift 加速'}
      onPointerDown={event => startGesture(event, 'resize', direction)}
      onKeyDown={event => keyResize(event, direction)}/>)}
  </aside>, host);
}
