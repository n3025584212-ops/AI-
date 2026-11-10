import { useEffect, useRef, useState } from 'react';
import { TWIN_STANDS, twinSensorData } from './factoryTwinLayer.js';

const STAND_X = [-10.4, -5.2, 0, 5.2, 10.4];

export default function TwinHud({ hostRef, processData, selected, onSelect, onInspect, onFocus }) {
  const [inspection, setInspection] = useState(null);
  const [scanning, setScanning] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const processRef = useRef(processData); processRef.current = processData;
  const inspectionRef = useRef(inspection); inspectionRef.current = inspection;
  const inspector = useRef(onInspect); inspector.current = onInspect;
  const focuser = useRef(onFocus); focuser.current = onFocus;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  useEffect(() => {
    if (!hostRef.current) return;
    const markersRoot = document.createElement('div');
    markersRoot.className = 'twin-sensor-layer';
    const leaderSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    leaderSvg.setAttribute('class', 'twin-sensor-leaders');
    markersRoot.appendChild(leaderSvg);
    const elements = [];
    for (const stand of TWIN_STANDS) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = `twin-spatial-label${stand === 'S5' ? ' is-primary' : ''}`;
      button.innerHTML = `<i></i><span><b>${stand}</b><small>${stand === 'S5' ? 'AI 预测' : '轧制中'}</small></span><strong>—<em>t</em></strong>`;
      button.setAttribute('aria-label', `查看 ${stand} 空间设备`);
      button.onclick = () => focuser.current?.(stand);
      const leader = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      leaderSvg.appendChild(leader); markersRoot.appendChild(button);
      elements.push({ stand, button, leader });
    }
    hostRef.current.appendChild(markersRoot);
    let active = true, timer = 0;
    const draw = () => {
      if (!active) return;
      const host = hostRef.current;
      const engine = window.__qcdkr3d;
      if (!host || !engine?.camera) { timer = setTimeout(draw, 80); return; }
      const width = host.clientWidth, height = host.clientHeight;
      const camera3d = engine.camera;
      const project = (x, y, z) => {
        const vector = new engine.THREE.Vector3(x, y, z).project(camera3d);
        return { x: (vector.x + 1) * width / 2, y: (1 - vector.y) * height / 2, visible: vector.z > -1 && vector.z < 1 && Math.abs(vector.x) < 1.08 && Math.abs(vector.y) < 1.08 };
      };
      const stands = processRef.current?.stands || [];
      const visibleAnchors = [];
      elements.forEach((element, index) => {
        const item = stands.find(entry => entry.id === element.stand);
        const force = Number(item?.force);
        const numberNode = element.button.querySelector('strong');
        const text = Number.isFinite(force) ? force.toFixed(1) : '—';
        if (numberNode.firstChild?.nodeValue !== text) numberNode.firstChild.nodeValue = text;
        element.button.classList.toggle('is-selected', selectedRef.current === element.stand);
        element.button.classList.toggle('is-alert', inspectionRef.current?.stand === element.stand);
        const anchor = project(STAND_X[index], 6.8, -2.1);
        visibleAnchors.push({ ...anchor, index });
      });
      const placedLabels = [];
      visibleAnchors.forEach(({ index }) => {
        const element = elements[index];
        const anchor = project(STAND_X[index], 6.8, -2.1);
        const labelX = Math.max(34, Math.min(width - 34, anchor.x));
        const labelWidth = element.button.offsetWidth || 46;
        let labelY = Math.max(122, anchor.y - 18);
        while (placedLabels.some(item => Math.abs(item.x - labelX) < (labelWidth + 5) && Math.abs(item.y - labelY) < 31)) {
          labelY -= 30;
        }
        placedLabels.push({ x: labelX, y: labelY });
        element.button.dataset.stand = element.stand;
        element.button.style.transform = `translate(-50%, -100%) translate(${labelX}px,${labelY}px)`;
        element.button.style.display = anchor.visible ? 'flex' : 'none';
        element.leader.setAttribute('d', `M${anchor.x},${anchor.y} L${labelX},${labelY + 4}`);
        element.leader.style.display = anchor.visible ? '' : 'none';
      });
      timer = setTimeout(draw, 80);
    };
    draw();
    return () => { active = false; clearTimeout(timer); markersRoot.remove(); };
  }, [hostRef]);

  const inspect = stand => {
    setInspection({ stand, status: 'assigned' });
    inspector.current?.(stand, event => setInspection({ stand, status: event?.status || 'arrived' }));
  };
  const scan = () => { setScanning(value => !value); window.__qcdkr3d?.engine?.toggleScan?.(); };
  const focused = TWIN_STANDS.includes(selected) ? selected : 'S5';
  return <>
    {expanded && <div className="twin-measurement-panel">
      <header><span><i/> 空间测点图谱</span><button aria-label="关闭测点图谱" onClick={() => setExpanded(null)}>×</button></header>
      <div className="twin-device-title"><b>{expanded} · 六辊轧机</b><small>工艺关联 / 在线数据</small></div>
      <div className="twin-measurement-grid">{twinSensorData(expanded, processData).map(data => <button key={data.key} onClick={() => onFocus?.(expanded, data.measurement)}><span>{data.name}<small>{data.key === 'bendingForce' ? '执行机构关联' : '设备关联位置'}</small></span><b>{data.value}<em>{data.unit}</em></b></button>)}</div>
      <p>位置用于设备与工艺数据关联，不代表已安装对应实体传感器。</p>
    </div>}
    {inspection && <section className="twin-inspection-card" aria-label="巡检复核任务">
      <header><span><i/> 设备巡检复核</span><button aria-label="关闭巡检任务" onClick={() => { setInspection(null); window.__qcdkr3d?.engine?.clearInspection?.(); }}>×</button></header>
      <div className="twin-alert-title"><b>{inspection.stand} 工作辊区域</b><span>DEMO</span></div>
      <p>演示异常事件 · 未接入现场温度传感器</p>
      <div className="twin-inspection-route"><span className="done">异常选中</span><i/><span className={inspection.status !== 'assigned' ? 'done' : 'active'}>镜头定位</span><i/><span className={inspection.status === 'arrived' ? 'done' : 'active'}>机器人复核</span></div>
      <div className="twin-robot-state"><span className={inspection.status === 'arrived' ? 'done' : 'running'}/><b>{inspection.status === 'assigned' ? '巡检机器人正在前往目标机架' : '机器人已到达 · 演示复核完成'}</b></div>
      <div className="twin-inspection-actions"><button onClick={() => onFocus?.(inspection.stand)}>查看设备</button><button onClick={() => setExpanded(inspection.stand)}>查看关联测点</button></div>
      <small className="twin-demo-note">仅验证场景联动流程，不形成设备健康诊断。</small>
    </section>}
  </>;
}
