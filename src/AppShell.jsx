import { readableConditionName, userVisibleText } from './userVisibleText.js';
import { Activity, Box, RefreshCw, Database, FileText, LogOut, ScrollText, Settings2, ArrowDownToLine, Cable, ShieldCheck, HardHat } from 'lucide-react';
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
// 顶栏不再只显示流水号「工况-39」：钢种 + 入口→出口厚度才有信息量，
// 流水号和带宽留在悬停提示里（2026-11-16 操作者口径）。
const finiteNumber = value => typeof value === 'number' && Number.isFinite(value);
function conditionHeadline(caseData) {
  const stands = Array.isArray(caseData?.stands) ? caseData.stands : [];
  const entry = finiteNumber(stands[0]?.entryThickness) ? stands[0].entryThickness
    : finiteNumber(caseData?.entrySetThickness) ? caseData.entrySetThickness : null;
  const exit = stands.length && finiteNumber(stands[stands.length - 1]?.exitThickness) ? stands[stands.length - 1].exitThickness : null;
  const spec = entry != null && exit != null ? `${entry.toFixed(3)}→${exit.toFixed(3)} mm` : '';
  const grade = caseData?.steelGrade ? String(caseData.steelGrade) : '';
  if (grade && spec) return `${grade} · ${spec}`;
  if (grade) return grade;
  if (spec) return spec;
  return readableConditionName(caseData?.id);
}
function conditionTooltip(caseData) {
  const parts = [readableConditionName(caseData?.id)];
  if (caseData?.steelGrade) parts.push(String(caseData.steelGrade));
  if (finiteNumber(caseData?.width)) parts.push(`${caseData.width} mm`);
  return parts.join(' · ');
}
function Clock() {
  const [time,setTime]=useState(new Date());
  useEffect(()=>{const id=setInterval(()=>setTime(new Date()),1000);return()=>clearInterval(id);},[]);
  return <time className="console-clock">{time.toLocaleDateString('zh-CN').replaceAll('/','-')} {time.toLocaleTimeString('zh-CN',{hour12:false})}</time>;
}
export default function AppShell({page,onNavigate,user,onLogout,caseData,modelStatus,dirty,onSave,onOpenReport,assistantOpen,onAssistantToggle,assistantMode='APPROVAL',onAssistantModeChange,children,assistant,onRefresh,refreshing=false,systemHealth,assistantExperience,assistantTask,assistantBusy=false,assistantRunState='',twin,navActive}) {
  const serviceState = modelStateDisplay(modelStatus, dirty);
  const health = systemHealth || { level: serviceState.ready ? 'ok' : 'error', label: serviceState.label, reason: serviceState.reason, page: 'maintenance' };
  const activePages = navActive || [page];
  const copilotState = assistantBusy ? 'busy' : assistantTask?.state==='NEEDS_CONFIRMATION' || assistantExperience?.suggestion?.severity==='attention' ? 'attention' : 'idle';
  const copilotMode = ASSISTANT_MODE_LABELS[assistantMode] || ASSISTANT_MODE_LABELS.APPROVAL;
  return <div className={'app-shell s5-shell reference-shell workbench-shell nav-collapsed '+(page==='overview'?'prediction-shell ':'')+(assistantOpen?'assistant-open':'assistant-closed')}>
    <aside className="sidebar"><nav aria-label="主导航">{applicationPages.map(([id,label,Icon])=><button key={id} data-page={id} aria-label={label} aria-current={activePages.includes(id)?'page':undefined} className={activePages.includes(id)?'active':''} onClick={()=>onNavigate(id)}><i className="shell-nav-glyph" aria-hidden="true"><Icon size={20}/></i><span>{label}</span></button>)}</nav><div className="sidebar-bottom"><div className="sidebar-assistant-home" aria-hidden="true"/><div className="sidebar-signature"><b>{PRODUCT_NAME}</b><span>让数据创造稳定生产力</span><small>{APP_VERSION}</small></div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="topbar-product"><strong title={PRODUCT_NAME}>{PRODUCT_NAME}</strong><span>QCDKR · 五机架 UCM 产线</span></div><div className="topbar-coil"><small>当前工况</small><b title={conditionTooltip(caseData)}>{conditionHeadline(caseData)}</b></div><div className="topbar-right">{page!=='overview'&&<span className="twin-stage-topbar-hint" title="3D 工作台在面板左侧持续运行"><Box size={14}/><span>3D 运行中</span></span>}<button type="button" className={'topbar-action topbar-copilot is-'+copilotState+(assistantOpen?' is-open':'')} data-copilot-state={copilotState} data-access-mode={assistantMode} aria-label={(assistantOpen?'收起':'打开')+'DK AI 副驾驶'} aria-pressed={assistantOpen} title={`DK AI 副驾驶 · ${copilotMode.label}模式：${copilotMode.description}`} onClick={onAssistantToggle}><HardHat size={14}/><span>副驾驶</span><i className="topbar-copilot-dot" aria-hidden="true"/></button><button type="button" className={'system-health-icon '+health.level} title={`${health.label}${health.reason?' · '+userVisibleText(health.reason):''}；打开系统状态与维护`} aria-label={`${health.label}，打开系统状态与维护`} onClick={()=>onNavigate(health.page || 'maintenance')}><ShieldCheck size={17}/>{health.level!=='ok'&&<i className="health-badge" aria-hidden="true"/>}</button><button className="topbar-action save-condition" aria-label="保存当前工况" title={dirty?'预测更新中，完成后可保存':'保存当前工况'} onClick={onSave}><ArrowDownToLine size={14}/><span>保存</span></button><button type="button" className="topbar-action" aria-label="打开结果报告与导出" title="结果报告与导出" onClick={onOpenReport}><FileText size={14}/><span>报告</span></button><button type="button" className="topbar-action" aria-label="刷新当前工作台" title="刷新当前工作台" disabled={refreshing} onClick={onRefresh}><RefreshCw size={14} className={refreshing?'spin':undefined}/><span>刷新</span></button><Clock/><button className="console-user" aria-label="退出登录" title="退出登录" onClick={onLogout}><span className="console-avatar">{(user?.displayName||user?.name||user?.username||'DK').slice(0,2)}</span><span>{user?.role==='LOCAL_ADMIN' ? user.username : user?.displayName||user?.name||user?.username||'本机账户'}<small>{user?.role==='LOCAL_ADMIN' ? user.display_role : user?.role==='admin'?'管理员':'操作员'}</small></span><LogOut size={14}/></button></div></header><div className="workspace"><main className={'main-content '+(page==='overview'?'is-workbench':'reference-content')}>{children}</main></div></div>
    {/* 孪生舞台改造（2026-11-01）：3D 工作台常驻为全屏舞台，业务页以右侧面板环绕；
        原 TwinDock 迷你孪生面板与真实 3D 重复，停用（文件保留可回滚）。 */}
    {assistant}
  </div>;
}
