import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, X } from 'lucide-react';
import { PET_SIZE, PET_STORAGE, defaultPetPosition, dockPet, isPetDrag, movePet, restorePet } from './assistantPetGeometry.js';
import { petTaskState } from './assistantTaskRuntime.js';
import { mayAnnounceSuggestion } from './assistantTaskPolicy.js';
import './assistant-experience.css';
const PetScene=lazy(()=>import('./AssistantPetScene.jsx'));
const viewport=()=>({width:window.innerWidth,height:window.innerHeight});

export default function AssistantPet({open,onToggle,busy=false,runState='',suggestion,voice,task,voiceState}) {
  const [saved,setSaved]=useState(()=>{let raw=null;try{raw=localStorage.getItem(PET_STORAGE);}catch{}return restorePet(raw,viewport());});
  const [dragging,setDragging]=useState(false),[hovered,setHovered]=useState(false),[menu,setMenu]=useState(false),[notice,setNotice]=useState(null),[editing,setEditing]=useState(false);
  const latest=useRef(saved),gesture=useRef(null),suppressed=useRef(false),root=useRef(null),announced=useRef(new Map());latest.current=saved;
  const persist=next=>{latest.current=next;setSaved(next);try{localStorage.setItem(PET_STORAGE,JSON.stringify({version:1,position:{x:next.x,y:next.y},model:next.model}));}catch{}};
  const finish=event=>{
    const active=gesture.current;if(!active||event?.pointerId!=null&&event.pointerId!==active.id)return;
    gesture.current=null;suppressed.current=active.moved;setDragging(false);
    try{if(active.target.hasPointerCapture(active.id))active.target.releasePointerCapture(active.id);}catch{}
    if(active.moved)persist({...latest.current,...dockPet(latest.current,viewport())});
  };
  useEffect(()=>{
    const resize=()=>persist({...latest.current,...dockPet(latest.current,viewport())});
    const blur=()=>finish();
    const focus=()=>queueMicrotask(()=>setEditing(!!document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')||!!document.querySelector('dialog[open],.modal-backdrop')));
    window.addEventListener('resize',resize);window.addEventListener('blur',blur);document.addEventListener('focusin',focus);document.addEventListener('focusout',focus);
    return()=>{window.removeEventListener('resize',resize);window.removeEventListener('blur',blur);document.removeEventListener('focusin',focus);document.removeEventListener('focusout',focus);finish();};
  },[]);
  useEffect(()=>{
    if(!suggestion||open){setNotice(null);return;}
    const now=Date.now(),last=announced.current.get(suggestion.key)??-Infinity;
    if(mayAnnounceSuggestion({suggestion,now,lastAnnounced:last,editing,open,dragging})){
      if(announced.current.size>64)announced.current.clear();announced.current.set(suggestion.key,now);setNotice(suggestion.key);
    }
  },[suggestion?.key,suggestion?.contextKey,editing,open,dragging]);
  useEffect(()=>{
    if(!menu)return;const close=e=>{if(!root.current?.contains(e.target))setMenu(false);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);
  },[menu]);
  const start=e=>{
    if(e.button!==0||gesture.current)return;suppressed.current=false;setMenu(false);
    gesture.current={id:e.pointerId,target:e.currentTarget,x:e.clientX,y:e.clientY,position:{...latest.current},moved:false};e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move=e=>{
    const g=gesture.current;if(!g||g.id!==e.pointerId)return;const delta={x:e.clientX-g.x,y:e.clientY-g.y};
    if(!g.moved&&!isPetDrag(delta))return;g.moved=true;setDragging(true);const next={...latest.current,...movePet(g.position,delta,viewport())};latest.current=next;setSaved(next);
  };
  const keyboard=e=>{
    if(e.key==='Escape'){setMenu(false);setNotice(null);finish();return;}
    if(e.key==='Home'){e.preventDefault();persist({...latest.current,...defaultPetPosition(viewport())});return;}
    if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();setMenu(v=>!v);return;}
    const arrows={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(!arrows[e.key])return;
    e.preventDefault();const [x,y]=arrows[e.key],step=e.shiftKey?24:8;persist({...latest.current,...movePet(latest.current,{x:x*step,y:y*step},viewport())});
  };
  const personaState=petTaskState({task,busy,runState,voiceState,attention:!!suggestion});
  const showNotice=notice===suggestion?.key&&!open&&!dragging&&!editing;
  return createPortal(<div ref={root} className={'assistant-pet'+(dragging?' is-dragging':'')} data-avatar={saved.model} data-task-state={personaState.id} data-dragging={dragging} style={{left:saved.x,top:saved.y,width:PET_SIZE.width,height:PET_SIZE.height}}>
    {showNotice&&<div className={'assistant-pet-notice '+(saved.x>window.innerWidth/2?'opens-left':'opens-right')+(saved.y<100?' opens-down':'')} role="status"><button className="assistant-pet-notice-main" onClick={()=>{setNotice(null);onToggle();}}>{suggestion.title}<span>查看处理建议</span></button><button className="assistant-pet-notice-dismiss" aria-label="忽略本次建议" onClick={()=>setNotice(null)}><X size={12}/></button></div>}
    <button type="button" className="assistant-pet-launcher" aria-label="工艺助手" aria-expanded={open} aria-controls="assistant-floating-window" title="DK AI · 拖动移动，点击打开任务；方向键移动，Home复位" onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onPointerEnter={()=>setHovered(true)} onPointerLeave={()=>setHovered(false)} onContextMenu={e=>{e.preventDefault();setMenu(v=>!v);}} onKeyDown={keyboard} onClick={e=>{if(e.detail>0&&suppressed.current){e.preventDefault();return;}onToggle();}}>
      <Suspense fallback={<span className="assistant-pet-loading">载入三维形象</span>}><PetScene taskPhase={personaState.id} model={saved.model} engaged={open||busy} hovered={hovered} dragging={dragging}/></Suspense>
      <span className="assistant-pet-caption" title={personaState.label}>{personaState.id==='IDLE'?'DK AI':personaState.label}<i className={busy?'is-busy':''}/></span>
    </button>
    <button className="assistant-pet-options" aria-label="助手形象与位置" aria-expanded={menu} onClick={()=>setMenu(v=>!v)}><MoreHorizontal size={15}/></button>
    {menu&&<div className={'assistant-pet-menu '+(saved.x>window.innerWidth/2?'opens-left':'opens-right')+(saved.y<48?' opens-down':'')} role="group" aria-label="助手形象与位置设置"><strong>三维助手形象</strong>{[['engineer','项目工程师'],['worker','产线工人']].map(([id,label])=><button key={id} aria-pressed={saved.model===id} onClick={()=>{persist({...latest.current,model:id});setMenu(false);}}>{label}</button>)}<button onClick={()=>{persist({...latest.current,...defaultPetPosition(viewport())});setMenu(false);}}>回到侧边</button></div>}
    <div className="assistant-pet-voice" title={busy?runState:undefined}>{voice}</div>
  </div>,document.body);
}
