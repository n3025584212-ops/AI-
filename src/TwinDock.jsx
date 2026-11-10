import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Box, X } from 'lucide-react';
import { createTwinDockScene } from './twinDockScene.js';
import './twin-dock.css';

const STANDS = ['S1', 'S2', 'S3', 'S4', 'S5'];
const PAGE_LABEL = { data: '数据接入', maintenance: '系统状态与维护', communication: '工业设备连接', logs: '运行日志' };

// 所有非工作台页面共用的 3D 孪生面板。默认收起成左下角一枚入口，鼠标移上去浮出，
// 移开自动收回；顶栏「3D孪生」按钮可以把面板固定住（pinned）。
// 面板本身不产生异步 state 更新：加载完成状态由场景直接切换 DOM class，
// 避免切页提交期间由异步 setState 打断 React 根，导致面板事件失效。
export default function TwinDock({ page, visible = true, pinned = false, selected = 'S5', onSelectStand, caseData, onOpenWorkbench, onClose, playback }) {
  const host = useRef(null), viewer = useRef(null);
  const [hovered, setHovered] = useState(false);
  const open = visible && (pinned || hovered);
  const selectRef = useRef(onSelectStand);
  const selectedRef = useRef(selected);
  const visibleRef = useRef(open);
  const playbackRef = useRef(playback);
  selectRef.current = onSelectStand;
  selectedRef.current = selected;
  visibleRef.current = open;
  playbackRef.current = playback;
  const standData = caseData?.stands?.find(stand => stand.id === selected);
  const force = Number(standData?.force);

  const selectStand = stand => {
    selectRef.current?.(stand);
    window.dispatchEvent(new CustomEvent('qcdkr:stand-selected', { detail: { stand, source: 'twin-dock' } }));
  };

  useEffect(() => {
    // 面板默认收起，首次展开时才挂载三维宿主；宿主出现后再建场景，只建一次。
    if (!host.current || viewer.current) return;
    const forces = Object.fromEntries((caseData?.stands || []).map(stand => [stand.id, Number(stand.force)]));
    const sceneApi = createTwinDockScene(host.current, { onSelectStand: selectStand, forces, getPlayback: () => playbackRef.current });
    viewer.current = sceneApi;
    sceneApi.setSelected(selectedRef.current);
    sceneApi.setActive?.(visibleRef.current);
  }, [open]);

  useEffect(() => () => {
    viewer.current?.dispose();
    viewer.current = null;
  }, []);

  useEffect(() => { viewer.current?.setSelected?.(selected); }, [selected]);
  useEffect(() => { viewer.current?.setActive?.(open); }, [open]);

  const selectAndInspect = stand => {
    selectStand(stand);
    viewer.current?.inspectStand?.(stand);
  };

  return <aside className={`twin-dock${visible ? '' : ' is-hidden'}${open ? ' is-open' : ' is-peek'}`}
    aria-label="3D数字孪生面板" data-page={page} data-visible={visible ? 'true' : 'false'} data-open={open ? 'true' : 'false'}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
    <button type="button" className="twin-dock-peek" aria-label="展开3D数字孪生" title="鼠标移入展开">
      <span className="twin-dock-peek-icon"><Box size={14}/></span>
      <span>3D 数字孪生</span>
      <span className="twin-dock-peek-page">{PAGE_LABEL[page] || '业务页面'}</span>
    </button>
    {/* 面板常驻 DOM：收起时只隐藏，避免宿主被卸载后 canvas 丢失。 */}
    <div className="twin-dock-panel">
      <header className="twin-dock-head">
        <div className="twin-dock-title">
          <span className="twin-dock-icon"><Box size={15}/></span>
          <div><b>3D 数字孪生</b><small>{PAGE_LABEL[page] || '业务页面'} · {selected}</small></div>
          <i className="twin-dock-status" aria-label="三维载入中"/>
        </div>
        <div className="twin-dock-actions">
          <button type="button" onClick={() => { setHovered(false); onClose?.(); }} aria-label="关闭3D数字孪生" title="关闭"><X size={14}/></button>
        </div>
      </header>
      <div className="twin-dock-body">
        <div className="twin-dock-canvas">
          <div ref={host} className="twin-dock-canvas-host"/>
          <div className="twin-dock-loading">载入工厂模型…</div>
          <span className="twin-dock-hint">拖动旋转 · 滚轮缩放 · 点机架</span>
        </div>
        <div className="twin-dock-stands">
          <div className="twin-dock-stand-buttons">{STANDS.map(id =>
            <button key={id} type="button" className={selected === id ? 'active' : ''} onClick={() => selectAndInspect(id)} title={`派工程师去 ${id} 巡检`}>{id}</button>)}
          </div>
          <span className="twin-dock-force"><small>{selected} 轧制力</small><b>{Number.isFinite(force) ? force.toFixed(1) : '—'}<i>t</i></b></span>
          <button type="button" className="twin-dock-open" onClick={onOpenWorkbench}>打开工作台<ArrowRight size={12}/></button>
        </div>
      </div>
    </div>
  </aside>;
}
