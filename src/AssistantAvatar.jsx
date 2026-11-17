import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { AVATAR_SIZE, AVATAR_STORAGE, defaultAvatarPosition, dockAvatar, isAvatarDrag, moveAvatar, restoreAvatar } from './assistantAvatarGeometry.js';
import { avatarTaskState } from './assistantTaskRuntime.js';
import { mayAnnounceSuggestion } from './assistantTaskPolicy.js';
import AssistantAvatarVideo from './AssistantAvatarVideo.jsx';
import './assistant-experience.css';
const viewport=()=>({width:window.innerWidth,height:window.innerHeight});

export default function AssistantAvatar({open,onToggle,busy=false,runState='',suggestion,voice,task,voiceState,speech=null,onSpeechDismiss}) {
  const [saved,setSaved]=useState(()=>{let raw=null;try{raw=localStorage.getItem(AVATAR_STORAGE);}catch{}return restoreAvatar(raw,viewport());});
  const [dragging,setDragging]=useState(false),[hovered,setHovered]=useState(false),[notice,setNotice]=useState(null),[editing,setEditing]=useState(false);
  const latest=useRef(saved),gesture=useRef(null),suppressed=useRef(false),root=useRef(null),announced=useRef(new Map());latest.current=saved;
  const persist=next=>{latest.current=next;setSaved(next);try{localStorage.setItem(AVATAR_STORAGE,JSON.stringify({version:1,position:{x:next.x,y:next.y},model:next.model}));}catch{}};
  const finish=event=>{
    const active=gesture.current;if(!active||event?.pointerId!=null&&event.pointerId!==active.id)return;
    gesture.current=null;suppressed.current=active.moved;setDragging(false);
    try{if(active.target.hasPointerCapture(active.id))active.target.releasePointerCapture(active.id);}catch{}
    if(active.moved)persist({...latest.current,...dockAvatar(latest.current,viewport())});
  };
  useEffect(()=>{
    const resize=()=>persist({...latest.current,...dockAvatar(latest.current,viewport())});
    const blur=()=>finish();
    const focus=()=>queueMicrotask(()=>setEditing(!!document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')||!!document.querySelector('dialog[open],.modal-backdrop')));
    window.addEventListener('resize',resize);window.addEventListener('blur',blur);document.addEventListener('focusin',focus);document.addEventListener('focusout',focus);
    return()=>{window.removeEventListener('resize',resize);window.removeEventListener('blur',blur);document.removeEventListener('focusin',focus);document.removeEventListener('focusout',focus);finish();};
  },[]);
  // 对话框是助手的气泡：位置一变就广播，供 FloatingAssistant 重新贴靠。
  useEffect(()=>{
    window.dispatchEvent(new CustomEvent('dkqkar-avatar-geometry',{detail:{x:saved.x,y:saved.y,width:AVATAR_SIZE.width,height:AVATAR_SIZE.height}}));
  },[saved.x,saved.y]);
  // 拖气泡标题栏 = 拖助手，两者不会被拆散。
  useEffect(()=>{
    const nudge=event=>{
      const dx=Number(event.detail?.dx)||0,dy=Number(event.detail?.dy)||0;
      if(dx||dy)persist({...latest.current,...moveAvatar(latest.current,{x:dx,y:dy},viewport())});
    };
    window.addEventListener('dkqkar-avatar-nudge',nudge);
    return()=>window.removeEventListener('dkqkar-avatar-nudge',nudge);
  },[]);
  useEffect(()=>{
    if(!suggestion||open){setNotice(null);return;}
    const now=Date.now(),last=announced.current.get(suggestion.key)??-Infinity;
    if(mayAnnounceSuggestion({suggestion,now,lastAnnounced:last,editing,open,dragging})){
      if(announced.current.size>64)announced.current.clear();announced.current.set(suggestion.key,now);setNotice(suggestion.key);
    }
  },[suggestion?.key,suggestion?.contextKey,editing,open,dragging]);
  const start=e=>{
    if(e.button!==0||gesture.current)return;suppressed.current=false;
    gesture.current={id:e.pointerId,target:e.currentTarget,x:e.clientX,y:e.clientY,position:{...latest.current},moved:false};e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move=e=>{
    const g=gesture.current;if(!g||g.id!==e.pointerId)return;const delta={x:e.clientX-g.x,y:e.clientY-g.y};
    if(!g.moved&&!isAvatarDrag(delta))return;g.moved=true;setDragging(true);const next={...latest.current,...moveAvatar(g.position,delta,viewport())};latest.current=next;setSaved(next);
  };
  const keyboard=e=>{
    if(e.key==='Escape'){setNotice(null);finish();return;}
    if(e.key==='Home'){e.preventDefault();persist({...latest.current,...defaultAvatarPosition(viewport())});return;}
    const arrows={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(!arrows[e.key])return;
    e.preventDefault();const [x,y]=arrows[e.key],step=e.shiftKey?24:8;persist({...latest.current,...moveAvatar(latest.current,{x:x*step,y:y*step},viewport())});
  };
  const personaState=avatarTaskState({task,busy,runState,voiceState,attention:!!suggestion||!!speech});
  // 说话气泡不受面板开关影响：面板开着也要在助手旁边报一句（2026-11-17 操作者口径）。
  const showSpeech=!!speech&&!dragging&&!editing;
  const showNotice=!showSpeech&&notice===suggestion?.key&&!open&&!dragging&&!editing;
  return createPortal(<div ref={root} className={'assistant-avatar'+(dragging?' is-dragging':'')} data-avatar={saved.model} data-task-state={personaState.id} data-dragging={dragging} style={{left:saved.x,top:saved.y,width:AVATAR_SIZE.width,height:AVATAR_SIZE.height}}>
    {showSpeech&&<div className={'assistant-avatar-notice assistant-avatar-speech '+(saved.x>window.innerWidth/2?'opens-left':'opens-right')+(saved.y<100?' opens-down':'')} role="status" data-avatar-speech={speech.id}><button type="button" className="assistant-avatar-notice-main" onClick={()=>{onSpeechDismiss?.();onToggle();}}>{speech.text}<span>点我处理</span></button><button type="button" className="assistant-avatar-notice-dismiss" aria-label="忽略这次播报" onClick={()=>onSpeechDismiss?.()}><X size={12}/></button></div>}
    {showNotice&&<div className={'assistant-avatar-notice '+(saved.x>window.innerWidth/2?'opens-left':'opens-right')+(saved.y<100?' opens-down':'')} role="status"><button className="assistant-avatar-notice-main" onClick={()=>{setNotice(null);onToggle();}}>{suggestion.title}<span>查看处理建议</span></button><button className="assistant-avatar-notice-dismiss" aria-label="忽略本次建议" onClick={()=>setNotice(null)}><X size={12}/></button></div>}
    <button type="button" className="assistant-avatar-launcher" aria-label="工艺助手" aria-expanded={open} aria-controls="assistant-floating-window" title="DK AI · 拖动移动，点击打开任务；方向键移动，Home复位" onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onPointerEnter={()=>setHovered(true)} onPointerLeave={()=>setHovered(false)} onKeyDown={keyboard} onClick={e=>{if(e.detail>0&&suppressed.current){e.preventDefault();return;}onToggle();}}>
      <AssistantAvatarVideo phase={personaState.id} dragging={dragging} hovered={hovered}/>
      <span className="assistant-avatar-caption" title={personaState.label}>{personaState.id==='IDLE'?'DK AI':personaState.label}<i className={busy?'is-busy':''}/></span>
    </button>
    <div className="assistant-avatar-voice" title={busy?runState:undefined}>{voice}</div>
  </div>,document.body);
}
