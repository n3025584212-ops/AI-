import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import LoginGate from './LoginGate.jsx';
import { PRODUCT_NAME } from './productBrand.js';
import './styles.css';
import './desktop.css';
import './print.css';
import './report.css';
import './report-print.css';
import './live-workspace.css';
import './monitor-surface.css';
import './dashboard-layout.css';
import './reference-ui.css';
import './prediction-visual.css';
import './product-brand.css';
import './p1-usability.css';
import './workspace-integration.css';
import './twin-stage.css';
import './digital-twin.css';
import holoCSS from './holo-theme.css?inline';
import aiConsoleCSS from './ai-console.css?inline';
// 运行时注入到 head 末尾，确保优先级高于所有既有样式
{
  const st = document.createElement('style');
  st.id = 'holo-theme-runtime';
  st.textContent = holoCSS;
  document.head.appendChild(st);
}
// DK AI 控制台皮肤：必须排在 holo-theme 之后，才能覆盖同权重的浮窗样式
{
  const st = document.createElement('style');
  st.id = 'ai-console-runtime';
  st.textContent = aiConsoleCSS;
  document.head.appendChild(st);
}
// 全息 HUD 覆盖层：叠在 3D 场景上，不拦截交互
function mountHoloHud(){
  if (document.querySelector('.holo-hud')) return;
  const hud = document.createElement('div');
  hud.className = 'holo-hud';
  hud.innerHTML = `
    <div class="hc tl"></div><div class="hc tr"></div>
    <div class="hc bl"></div><div class="hc br"></div>
    <div class="ruler-t"></div><div class="ruler-l"></div>
    <svg class="ring" viewBox="0 0 1180 520" preserveAspectRatio="none">
      <ellipse cx="590" cy="260" rx="524" ry="212"/>
      <ellipse cx="590" cy="260" rx="432" ry="172"/>
    </svg>
    <div class="scan"></div>
    <div class="beam b1"></div><div class="beam b2"></div>
    <div class="beam b3"></div><div class="beam b4"></div>
    <div class="tag a">S5 ROLLING FORCE · LIVE</div>
    <div class="tag b">QCDKR · 5-STAND UCM</div>
    <div class="tag c">MODEL INFERENCE · 60 Hz</div>
    <div class="tag d">LINK · 100%</div>`;
  document.body.appendChild(hud);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountHoloHud);
} else {
  mountHoloHud();
}
// HUD 只在沉浸式 3D 工作台显示；非沉浸（DashboardMetrics 卡片页）自动隐藏
function syncHudVisibility(){
  const hud = document.querySelector('.holo-hud');
  if (!hud) return;
  const immersive = !!document.querySelector('.live-workspace.live-immersive');
  hud.style.display = immersive ? '' : 'none';
}
setInterval(syncHudVisibility, 600);
new MutationObserver(syncHudVisibility).observe(document.body, {childList:true, subtree:true, attributes:true, attributeFilter:['class']});

if(window.dkqkarDesktop)document.documentElement.classList.add('desktop-title-overlay');
document.title=PRODUCT_NAME;
document.documentElement.style.setProperty('--product-name',JSON.stringify(PRODUCT_NAME));
// 2026-11-14 设计复核：局部渲染异常不允许黑掉整个工作台；给出可恢复的降级页。
class RootErrorBoundary extends React.Component {
  constructor(props){super(props);this.state={error:null};}
  static getDerivedStateFromError(error){return {error};}
  render(){
    if(!this.state.error)return this.props.children;
    return <div role="alert" style={{minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:14,background:'#040e14',color:'#d7e7ee',fontFamily:'"Segoe UI",system-ui,sans-serif'}}>
      <strong style={{fontSize:15,letterSpacing:'.12em'}}>界面出现异常</strong>
      <span style={{fontSize:12,color:'#7d9dae'}}>预测与数据服务不受影响；点击重载可恢复界面。</span>
      <button onClick={()=>{this.setState({error:null});window.location.reload();}} style={{minHeight:32,padding:'0 18px',border:'1px solid rgba(182,255,60,.4)',borderRadius:2,background:'rgba(182,255,60,.1)',color:'#dcff9d',fontSize:12,cursor:'pointer'}}>重载工作台</button>
    </div>;
  }
}
createRoot(document.getElementById('root')).render(<RootErrorBoundary><LoginGate>{session=><App {...session}/>}</LoginGate></RootErrorBoundary>);
