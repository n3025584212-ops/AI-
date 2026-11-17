import { useEffect, useRef, useState } from 'react';
import './assistant-avatar-video.css';

const CLIPS = {
  idle: 'idle', 'idle-look': 'idle-look', 'idle-float': 'idle-float',
  click: 'click', shy: 'shy', wave: 'wave',
  thinking: 'thinking', tool: 'tool', waiting: 'waiting', streaming: 'streaming',
  success: 'success', alert: 'alert', error: 'error',
  drag: 'drag', throw: 'throw', sleep: 'sleep', wake: 'wake',
};

const PHASE = {
  IDLE: 'idle',
  ATTENTION: 'alert',
  RECEIVED: 'thinking',
  PLANNING: 'thinking',
  EXECUTING: 'tool',
  VERIFYING: 'streaming',
  NEEDS_INPUT: 'waiting',
  NEEDS_CONFIRMATION: 'waiting',
  COMPLETED: 'success',
  PARTIAL: 'success',
  FAILED: 'error',
  CANCELLED: 'idle',
  STALE: 'alert',
  UNCERTAIN: 'waiting',
  LISTENING: 'shy',
  SPEAKING: 'wave',
};

const ONE_SHOT = new Set(['click', 'shy', 'wave', 'success', 'alert', 'error', 'wake', 'throw']);

export default function AssistantAvatarVideo({ phase = 'IDLE', dragging = false, hovered = false }) {
  const [clip, setClip] = useState('idle');
  const video = useRef(null);

  useEffect(() => {
    if (dragging) { setClip('drag'); return; }
    if (hovered && phase === 'IDLE') { setClip('shy'); return; }
    setClip(PHASE[phase] || 'idle');
  }, [phase, dragging, hovered]);

  useEffect(() => {
    const node = video.current;
    if (!node) return;
    node.loop = !ONE_SHOT.has(clip);
    try { node.currentTime = 0; } catch {}
    node.play().catch(() => {});
  }, [clip]);

  return <span className="assistant-avatar-video" aria-hidden="true">
    <video
      ref={video}
      src={`/assets/avatar/${CLIPS[clip] || 'idle'}.webm`}
      muted
      playsInline
      autoPlay
      preload="auto"
      onEnded={() => { if (ONE_SHOT.has(clip)) setClip('idle'); }}
    />
  </span>;
}
