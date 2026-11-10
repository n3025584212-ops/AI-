import { readableConditionName, userVisibleText } from './userVisibleText.js';
import { Activity, Box, RefreshCw, Database, FileText, LogOut, ScrollText, Settings2, ArrowDownToLine, Cable, ShieldCheck, HardHat, Mic } from 'lucide-react';
import { ASSISTANT_MODE_LABELS } from './assistantAccess.js';
import { APP_VERSION } from './version.js';
import { PRODUCT_NAME } from './productBrand.js';
import './assistant-dock.css';
import './assistant-copilot.css';
import './shell-visual.css';
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
export default function AppShell({page,onNavigate,user,onLogout,caseData,modelStatus,dirty,onSave,onOpenReport,assistantOpen,onAssistantToggle,assistantMode='APPROVAL',onAssistantModeChange,assistantVoiceEnabled=false,onVoiceCommand,onVoiceQuestion,children,assistant,onRefresh,refreshing=false,systemHealth,assistantExperience,assistantTask,assistantBusy=false,assistantRunState='',twin,navActive}) {
  const serviceState = modelStateDisplay(modelStatus, dirty);
  const health = systemHealth || { level: serviceState.ready ? 'ok' : 'error', label: serviceState.label, reason: serviceState.reason, page: 'maintenance' };
  const activePages = navActive || [page];
  const copilotState = assistantBusy ? 'busy' : assistantTask?.state==='NEEDS_CONFIRMATION' || assistantExperience?.suggestion?.severity==='attention' ? 'attention' : 'idle';
  const copilotMode = ASSISTANT_MODE_LABELS[assistantMode] || ASSISTANT_MODE_LABELS.APPROVAL;
  return <div className={'app-shell s5-shell reference-shell workbench-shell nav-collapsed '+(page==='overview'?'prediction-shell ':'')+(assistantOpen?'assistant-open':'assistant-closed')}>
    <aside className="sidebar"><nav aria-label="主导航">{applicationPages.map(([id,label,Icon])=><button key={id} data-page={id} aria-label={label} aria-current={activePages.includes(id)?'page':undefined} className={activePages.includes(id)?'active':''} onClick={()=>onNavigate(id)}><i className="shell-nav-glyph" aria-hidden="true"><Icon size={20}/></i><span>{label}</span></button>)}</nav><div className="sidebar-bottom"><div className="sidebar-assistant-home" aria-hidden="true"/><div className="sidebar-signature"><b>{PRODUCT_NAME}</b><span>让数据创造稳定生产力</span><small>{APP_VERSION}</small></div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="topbar-product"><strong title={PRODUCT_NAME}>{PRODUCT_NAME}</strong><span>QCDKR · 五机架 UCM 产线</span></div><div className="topbar-coil"><small>当前工况</small><b title={readableConditionName(caseData.id)}>{readableConditionName(caseData.id)}</b></div><div className="topbar-right">{page!=='overview'&&<span className="twin-stage-topbar-hint" title="3D 工作台在面板左侧持续运行"><Box size={14}/><span>3D 运行中</span></span>}<button type="button" className={'topbar-action topbar-voice'+(assistantVoiceEnabled?' is-on':'')} data-voice-enabled={assistantVoiceEnabled} aria-label={assistantVoiceEnabled?'关闭语音输入':'启用语音输入'} aria-pressed={assistantVoiceEnabled} title={assistantVoiceEnabled?'语音已开启，点击关闭':'点击启用语音：说“小迪”，然后说出操作'} onClick={()=>window.dispatchEvent(new Event(assistantVoiceEnabled?'dkqkar-voice-cancel':'dkqkar-voice-activate'))}><Mic size={14}/><span>语音</span></button><button type="button" className={'topbar-action topbar-copilot is-'+copilotState+(assistantOpen?' is-open':'')} data-copilot-state={copilotState} data-access-mode={assistantMode} aria-label={(assistantOpen?'收起':'打开')+'DK AI 副驾驶'} aria-pressed={assistantOpen} title={`DK AI 副驾驶 · ${copilotMode.label}模式：${copilotMode.description}`} onClick={onAssistantToggle}><HardHat size={14}/><span>副驾驶</span><em className="topbar-copilot-mode">{copilotMode.short}</em><i className="topbar-copilot-dot" aria-hidden="true"/></button><button type="button" className={'system-health-icon '+health.level} title={`${health.label}${health.reason?' · '+userVisibleText(health.reason):''}；打开系统状态与维护`} aria-label={`${health.label}，打开系统状态与维护`} onClick={()=>onNavigate(health.page || 'maintenance')}><ShieldCheck size={17}/>{health.level!=='ok'&&<i className="health-badge" aria-hidden="true"/>}</button><button className="topbar-action save-condition" aria-label="保存当前工况" title={dirty?'预测更新中，完成后可保存':'保存当前工况'} onClick={onSave}><ArrowDownToLine size={14}/><span>保存</span></button><button type="button" className="topbar-action" aria-label="打开结果报告与导出" title="结果报告与导出" onClick={onOpenReport}><FileText size={14}/><span>报告</span></button><button type="button" className="topbar-action" aria-label="刷新当前工作台" title="刷新当前工作台" disabled={refreshing} onClick={onRefresh}><RefreshCw size={14} className={refreshing?'spin':undefined}/><span>刷新</span></button><Clock/><button className="console-user" aria-label="退出登录" title="退出登录" onClick={onLogout}><span className="console-avatar">{(user?.displayName||user?.name||user?.username||'DK').slice(0,2)}</span><span>{user?.role==='LOCAL_ADMIN' ? user.username : user?.displayName||user?.name||user?.username||'本机账户'}<small>{user?.role==='LOCAL_ADMIN' ? user.display_role : user?.role==='admin'?'管理员':'操作员'}</small></span><LogOut size={14}/></button></div></header><div className="workspace"><main className={'main-content '+(page==='overview'?'is-workbench':'reference-content')}>{children}</main></div></div>
    {/* 孪生舞台改造（2026-11-01）：3D 工作台常驻为全屏舞台，业务页以右侧面板环绕；
        原 TwinDock 迷你孪生面板与真实 3D 重复，停用（文件保留可回滚）。 */}
    {assistant}
  </div>;
}
