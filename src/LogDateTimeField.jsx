import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {CalendarDays,ChevronLeft,ChevronRight} from 'lucide-react';
import {formatLocalLogTime,parseLocalLogTime} from './logQuery.js';
import './log-date-time.css';
const pad=value=>String(value).padStart(2,'0');
export default function LogDateTimeField({label,value,onChange}) {
 const trigger=useRef(null),panel=useRef(null);
 const [open,setOpen]=useState(false),[position,setPosition]=useState({top:0,left:0});
 const [draft,setDraft]=useState(()=>new Date()),[month,setMonth]=useState(()=>new Date());
 const show=()=>{const next=parseLocalLogTime(value)||new Date();setDraft(next);setMonth(new Date(next.getFullYear(),next.getMonth(),1));const box=trigger.current.getBoundingClientRect();setPosition({top:Math.max(8,Math.min(box.bottom+5,window.innerHeight-365)),left:Math.max(8,Math.min(box.left,window.innerWidth-300))});setOpen(true);};
 useEffect(()=>{if(!open)return;const outside=event=>{if(!trigger.current?.contains(event.target)&&!panel.current?.contains(event.target))setOpen(false);};const key=event=>{if(event.key==='Escape')setOpen(false);};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);};},[open]);
 const start=new Date(month.getFullYear(),month.getMonth(),1-month.getDay());
 const choose=date=>{const next=new Date(date.getFullYear(),date.getMonth(),date.getDate(),draft.getHours(),draft.getMinutes());setDraft(next);setMonth(new Date(date.getFullYear(),date.getMonth(),1));};
 const setTime=(field,value)=>{const next=new Date(draft);field==='hour'?next.setHours(Number(value)):next.setMinutes(Number(value));setDraft(next);};
 const picker=open&&createPortal(<div ref={panel} className="log-time-picker" role="dialog" aria-label={'选择'+label} style={position}>
  <header><button type="button" aria-label={label+'上个月'} onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}><ChevronLeft size={16}/></button><strong>{month.getFullYear()}年{month.getMonth()+1}月</strong><button type="button" aria-label={label+'下个月'} onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}><ChevronRight size={16}/></button></header>
  <div className="log-time-week" aria-hidden="true">{['日','一','二','三','四','五','六'].map(day=><span key={day}>{day}</span>)}</div>
  <div className="log-time-days">{Array.from({length:42},(_,i)=>{const date=new Date(start.getFullYear(),start.getMonth(),start.getDate()+i),same=date.toDateString()===draft.toDateString();return <button key={i} type="button" aria-label={`${date.getFullYear()}年${date.getMonth()+1}月${date.getDate()}日`} aria-pressed={same} className={(same?'is-selected ':'')+(date.getMonth()!==month.getMonth()?'is-outside':'')} onClick={()=>choose(date)}>{date.getDate()}</button>;})}</div>
  <div className="log-time-clock"><span>时间</span><select aria-label={label+'小时'} value={draft.getHours()} onChange={e=>setTime('hour',e.target.value)}>{Array.from({length:24},(_,i)=><option key={i} value={i}>{pad(i)}</option>)}</select><span>:</span><select aria-label={label+'分钟'} value={draft.getMinutes()} onChange={e=>setTime('minute',e.target.value)}>{Array.from({length:60},(_,i)=><option key={i} value={i}>{pad(i)}</option>)}</select></div>
  <footer><button type="button" onClick={()=>{onChange('');setOpen(false);}}>清空</button><button type="button" onClick={()=>{onChange(formatLocalLogTime(new Date()));setOpen(false);}}>现在</button><button type="button" onClick={()=>{onChange(formatLocalLogTime(draft));setOpen(false);}}>确定</button></footer>
 </div>,document.body);
 return <label className="log-time-field"><span>{label}</span><div className="log-time-input" ref={trigger}><input aria-label={label} type="text" autoComplete="off" placeholder="YYYY-MM-DD HH:mm" value={String(value||'').replace('T',' ')} onChange={e=>onChange(e.target.value)} /><button type="button" aria-label={'选择'+label} title={'选择'+label} onClick={show}><CalendarDays size={15}/></button></div>{picker}</label>;
}