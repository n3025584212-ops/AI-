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
// 运行时注入到 head 末尾，确保优先级高于所有既有样式
{
  const st = document.createElement('style');
  st.id = 'holo-theme-runtime';
  st.textContent = holoCSS;
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
createRoot(document.getElementById('root')).render(<LoginGate>{session=><App {...session}/>}</LoginGate>);
