import { readableConditionName, userVisibleText } from './userVisibleText.js';
import { Activity, RefreshCw, Box, ChevronRight, Database, LogOut, ScrollText, Settings2, ArrowDownToLine, Cable } from 'lucide-react';
import { APP_VERSION } from './version.js';
import { PRODUCT_NAME } from './productBrand.js';
import VoiceAssistant from './VoiceAssistant.jsx';
import './assistant-dock.css';
import './shell-visual.css';
import { AssistantDock } from './FloatingAssistant.jsx';
import { useEffect, useState } from 'react';
import { modelStateDisplay } from './workbenchDisplay.js';

export const applicationPages = [
  ['overview','预测工作台',Activity],
  ['data','数据接入',Database], ['maintenance','系统状态与维护',Settings2],
  ['communication','工业设备连接',Cable],
  ['logs','运行日志',ScrollText],
];
function Clock() {
  const [time,setTime]=useState(new Date());
  useEffect(()=>{const id=setInterval(()=>setTime(new Date()),1000);return()=>clearInterval(id);},[]);
  return <time className="console-clock">{time.toLocaleDateString('zh-CN').replaceAll('/','-')} {time.toLocaleTimeString('zh-CN',{hour12:false})}</time>;
}
export default function AppShell({page,onNavigate,collapsed,onToggleNav,user,onLogout,caseData,modelStatus,dirty,onSave,assistantOpen,onAssistantToggle,onVoiceCommand,onVoiceQuestion,children,assistant,onRefresh,refreshing=false}) {
  const serviceState = modelStateDisplay(modelStatus, dirty);
  return <div className={'app-shell s5-shell reference-shell workbench-shell '+(collapsed?'nav-collapsed ':'')+(page==='overview'?'prediction-shell ':'')+(assistantOpen?'assistant-open':'assistant-closed')}>
    <aside className="sidebar"><button className="brand" aria-label={PRODUCT_NAME+' 预测工作台'} title={PRODUCT_NAME} onClick={()=>onNavigate('overview')}><div className="brand-mark cube-brand"><Box size={30}/></div><div className="product-brand-title">{PRODUCT_NAME}<small>冷轧智能预测</small></div></button><button className="nav-toggle" aria-label={collapsed?'展开导航':'收起导航'} onClick={onToggleNav}><ChevronRight size={15} style={{transform:collapsed?undefined:'rotate(180deg)'}}/></button><nav aria-label="主导航">{applicationPages.map(([id,label,Icon])=><button key={id} data-page={id} title={label} aria-label={label} aria-current={page===id?'page':undefined} className={page===id?'active':''} onClick={()=>onNavigate(id)}><i className="shell-nav-glyph" aria-hidden="true"><Icon size={20}/></i><span>{label}</span></button>)}</nav><div className="sidebar-bottom"><div className="sidebar-signature"><b>{PRODUCT_NAME}</b><span>让数据创造稳定生产力</span><small>{APP_VERSION}</small></div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="topbar-product"><strong title={PRODUCT_NAME}>{PRODUCT_NAME}</strong><span>五机架 UCM 产线</span></div><div className="topbar-coil"><small>当前工况</small><b title={readableConditionName(caseData.id)}>{readableConditionName(caseData.id)}</b></div><div className="topbar-right"><span className="connection" title={userVisibleText(serviceState.reason)}><i className={'dot '+(!serviceState.ready?'orange':'')}/>{serviceState.label}</span><button className="topbar-action save-condition" aria-label="保存当前工况" disabled={dirty} onClick={onSave}><ArrowDownToLine size={14}/><span>保存</span></button><button type="button" className="topbar-action" aria-label="刷新当前工作台" title="刷新当前工作台" disabled={refreshing} onClick={onRefresh}><RefreshCw size={14} className={refreshing?'spin':undefined}/><span>刷新</span></button><Clock/><button className="console-user" aria-label="退出登录" title="退出登录" onClick={onLogout}><span className="console-avatar">{(user?.displayName||user?.name||user?.username||'DK').slice(0,2)}</span><span>{user?.role==='LOCAL_ADMIN' ? user.username : user?.displayName||user?.name||user?.username||'本机账户'}<small>{user?.role==='LOCAL_ADMIN' ? user.display_role : user?.role==='admin'?'管理员':'操作员'}</small></span><LogOut size={14}/></button></div></header><div className="workspace"><main className={'main-content '+(page==='overview'?'is-workbench':'reference-content')}>{children}</main></div></div>
    {assistant}<AssistantDock><button type="button" className="mascot-launcher" aria-label="工艺助手" aria-pressed={assistantOpen} aria-expanded={assistantOpen} aria-controls="assistant-floating-window" title={assistantOpen?'收起 AI 助手':'打开 AI 助手'} onClick={()=>{window.dispatchEvent(new Event('dkqkar-voice-activate'));window.dispatchEvent(new Event('dkqkar-assistant-toggle'));}}><img src="/assets/dk-assistant.gif" alt="" draggable="false"/><span>DK AI</span></button><VoiceAssistant onCommand={onVoiceCommand} onQuestion={onVoiceQuestion}/></AssistantDock>
  </div>;
}
