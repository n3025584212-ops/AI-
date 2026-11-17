import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { acquireModel, createModelInstance, disposeObject } from './threeModel';
import { playCinematicIntro } from './cinematicIntro.js';

// Last rendered frame of the previous mount. Re-entering the workspace shows
// it under the loading overlay, so the WebGL re-init never reads as a black
// screen; it is refreshed on every unmount.
let lastSceneFrame = null;
import { createIndustrialStudio } from './industrialStudio';
import { createIndustrialStage } from './factoryStage';
import { buildFixtures } from './factoryLine.js';
import { loadPulpits } from './factoryPulpits.js';
import { loadLineAssets } from './factoryAssets.js';
import { FLOOR_Y, ENGINEER_AISLE_Z } from './factoryCharacter.js';
import { loadFactoryHall } from './factoryHall.js';
import { buildFactoryPlant } from './factoryPlant.js';
import { buildMillDetails } from './millDetails.js';
import { createFactoryTwinLayer } from './factoryTwinLayer.js';
import TwinHud from './TwinHud.jsx';
import { installStripFlow, installRollSurface } from './industrialMotion.js';
import { IndustrialContactPass } from './IndustrialContactPass';
import { refineIndustrialMaterial, prepareIndustrialMaterials } from './industrialMaterials';
import { industrialCameraDirection } from './industrialPresentation.js';
import { IndustrialGlowPass } from './IndustrialGlowPass';
import { INDUSTRIAL_PIXEL_RATIO, industrialPixelRatio } from './industrialRenderQuality.js';
import { annotationViewport, fitProjectedBounds, isProcessGroupVisible, isRollingCore, normalizedScreenPoint, rollRotationStep, visualTransportStep, workRollNipPosition } from './threeProcess';

const STANDS = ['S1', 'S2', 'S3', 'S4', 'S5'];
const baseButton = { border: '1px solid #42617480', background: '#11232cc9', color: '#b9cad4', borderRadius: 7, padding: '6px 9px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' };

export default function ThreeViewer({ selectedStand = 'S5', onSelectStand, view = 'perspective', showStrip = true,
  explode = false, compact = false, expanded = false, shellMode = 'solid',
  motionPlaying = true, processSpeed = 0, cameraReset = 0, processData, onTelemetry, onAnchorsChange, onCharacterAnchor, hasDataOverlay = true, annotationInsets, controlsRef, onResetCamera, onSceneReady,
  lighting = 'workshop', daypart = 'day', onNavigate, walkMode = false, onExitWalk }) {
  const focusMode = 'line';
  const host = useRef(null), engine = useRef(null), latest = useRef(null);
  latest.current = { selectedStand, onSelectStand, view, showStrip, explode, compact, expanded, focusMode, shellMode, motionPlaying, processSpeed, processData, onTelemetry, onAnchorsChange, onCharacterAnchor, hasDataOverlay, annotationInsets, controlsRef, onSceneReady, lighting, daypart, onNavigate, walkMode };
  const [status, setStatus] = useState({ phase: 'loading', percent: 0, message: '载入设备模型…' });
  const [interaction, setInteraction] = useState(null);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [retry, setRetry] = useState(0);
  useState(() => { globalThis.__viewerMounts = (globalThis.__viewerMounts || 0) + 1; return 0; });
  useEffect(() => { globalThis.__viewerEffects = (globalThis.__viewerEffects || 0) + 1; }, []);

  useEffect(() => {
    const element = host.current;
    if (element) element.dataset.mount = 'start';
    let alive = true, contextLost = false, restorationPending = false, renderer, controls, observer, frame = 0, lease, studio, stage, coils, model, instance, composer, contact, glow, finishes, antiAlias, output, sharpen;
    let factoryFixtures = null, factoryAssetGroup = null, factoryCharacter = null, factoryHall = null, factoryPlant = null, millDetail = null, patrolTimer = 0, patrolPausedUntil = 0;
    let twinLayer = null;
    let atmosphere = null, intro = null, roamEnabled = false, roamPhase = 0;
    let cameraFlight = null, renderingPaused = false;
    let assetColliders = [];
    let inspectionHighlight = null, inspectionTimer = 0;
    let activeView = latest.current.view, activeScope = latest.current.focusMode, measurementFocusedStand = null, findingFocusedStand = null;
    let wasExpanded = latest.current.expanded, savedCamera = null, lastTime = 0, renderCount = 0;
    let viewportKey = '', viewportWidth = 0, viewportHeight = 0, restoreFrame = 0, pendingRestore = null;
    let rollers = [], stripMeshes = [], standLabels = [], processAnchors = [], lastTelemetry = 0, lastAnchors = -Infinity, anchorTimer = null, pointerDown = null;
    let lastAnchorSignature = '', lastAnchorCallback = null, lastCharacterAnchorSignature = '';
    let lastFramingKey = '', lastGeometryKey = '';
    let hoverHelper = null, hoverKey = '', hoverAt = 0, tooltipEl = null, centerHoverAt = 0;
    let walkActive = false, walkSaved = null, walkYaw = 0, walkPitch = 0, lookDrag = null, walkShell = null;
    let walkLookYaw = 0, walkLookPitch = 0, walkPhase = 0, walkBoards = null;
    const walkKeys = new Set(), camKeys = new Set(), walkPos = new THREE.Vector3(10.4, 1.68, 17.4), walkVel = new THREE.Vector2(), pickRay = new THREE.Raycaster();
    const UP_AXIS = new THREE.Vector3(0, 1, 0);
    const distance = { value: 0 }, materialOriginals = new Map(), rollSurfaceMaterials = new Set();
    const scene = new THREE.Scene();
      scene.background = new THREE.Color('#172d34');
    scene.fog = new THREE.Fog('#172d34', 98, 245);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.4, 180);
    const owned = new THREE.Group(); scene.add(owned);
    const coreBounds = new Map();
    let measurementHighlight=null,findingHighlight=null;
    const effectiveFocusedStand=()=>findingFocusedStand||measurementFocusedStand||null;

    function standSpeed(stand) {
      if (stand === 'S5') return Number(latest.current.processSpeed) || 0;
      return Number(latest.current.processData?.stands?.find((item) => item.id === stand)?.speed) || 0;
    }
    function moving() {
      if (!model || !latest.current.motionPlaying || document.hidden) return false;
      return standSpeed('S5') > 0;
    }
    function writeTelemetry(now = 0) {
      element.dataset.motionPhase = distance.value.toFixed(8);
      element.dataset.rollAngle = (rollers.find((roll) => roll.name === 'S5_WorkRoll_Top')?.rotation.z || 0).toFixed(8);
      element.dataset.camera = JSON.stringify(camera.position.toArray());
      element.dataset.cameraFocus = effectiveFocusedStand() || latest.current.focusMode;
      element.dataset.target = JSON.stringify(controls.target.toArray());
      element.dataset.renderCount = String(renderCount);
      element.dataset.lighting = latest.current.lighting;
      if (renderer) {
        element.dataset.drawCalls = String(renderer.info.render.calls);
        element.dataset.pixelRatio = String(renderer.getPixelRatio());
        element.dataset.msaaSamples = String(composer?.readBuffer.samples || 0);
        element.dataset.glowEnabled = String(Boolean(glow?.enabled));
        element.dataset.renderWidth = String(renderer.domElement.width);
        element.dataset.renderHeight = String(renderer.domElement.height);
        element.dataset.composerWidth = String(composer?.readBuffer.width || 0);
        element.dataset.composerHeight = String(composer?.readBuffer.height || 0);
      }
      if (coils) element.dataset.coilJoints = JSON.stringify(coils.joints);
      element.dataset.visibleCoils = coils?.root.visible ? '2' : '0';
      if (factoryCharacter) {
        element.dataset.characterState = factoryCharacter.state;
        element.dataset.characterPosition = `${factoryCharacter.position.x.toFixed(1)},${factoryCharacter.position.z.toFixed(1)}`;
      }
      if (contact) element.dataset.contactRebuilds = String(contact.rebuildCount);
      if (now - lastTelemetry >= 250) {
        lastTelemetry = now;
        latest.current.onTelemetry?.({ distance: distance.value, camera: camera.position.toArray(), target: controls.target.toArray(), moving: moving() });
      }
    }
    function projectStandLabels() {
      const width = element.clientWidth, height = element.clientHeight;
      camera.updateMatrixWorld();
      const layout = [];
      for (const label of standLabels) {
        const point = label.position.clone().project(camera);
        const visible = !walkActive && latest.current.focusMode === 'line'
          && point.z >= -1 && point.z <= 1 && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1;
        layout.push({ label, visible, x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2, depth: label.position.distanceTo(camera.position) });
      }
      // 标签避让 v2（2026-11-01）：按相机距离由近到远放置，选中的机架最优先；
      // 屏幕矩形重叠就向上错层，错满仍放不下（视线顺产线时被近处机架叠住）就隐藏，
      // 不再让远端机架的牌子叠在近处牌子上面。
      const placed = [];
      const rectOf = (item, yTop) => {
        const halfWidth = (item.label.stand === 'S5' ? 104 : 92) / 2;
        return { left: item.x - halfWidth - 8, right: item.x + halfWidth + 8, top: yTop + 4, bottom: yTop - 50 };
      };
      const collides = rect => placed.some(other => rect.left < other.right && rect.right > other.left && rect.bottom < other.top && rect.top > other.bottom);
      const selectedStandNow = latest.current.selectedStand;
      const order = layout.filter(item => item.visible)
        .sort((a, b) => (a.label.stand === selectedStandNow ? -1 : 0) - (b.label.stand === selectedStandNow ? -1 : 0) || a.depth - b.depth);
      for (const item of order) {
        let yTop = item.y, ok = false;
        for (let tier = 0; tier < 4; tier++) {
          yTop = Math.max(96, item.y - tier * 52);
          if (!collides(rectOf(item, yTop))) { ok = true; break; }
        }
        if (!ok) { item.visible = false; continue; }
        item.y = yTop;
        placed.push(rectOf(item, yTop));
      }
      for (const item of layout) {
        item.label.element.hidden = !item.visible;
        item.label.element.style.display = item.visible ? 'block' : 'none';
        item.label.element.style.transform = `translate(-50%, -100%) translate(${item.x}px, ${item.y}px)`;
      }
    }
    // 数据牌内容跟随 processData：数值变了只改文本节点，不重建 DOM。
    function updateStandCards(props) {
      if (!standLabels.length) return;
      const stands = props.processData?.stands || [];
      for (const label of standLabels) {
        const data = stands.find(stand => stand.id === label.stand);
        const force = Number(data?.force);
        const text = Number.isFinite(force) ? force.toFixed(1) : '—';
        if (label.value?.firstChild) label.value.firstChild.nodeValue = text;
        if (label.sub) label.sub.textContent = label.stand === 'S5' ? '轧制力预测' : (Number(data?.speed) > 0 ? '轧制中' : '待机');
        label.element.classList.toggle('is-selected', props.selectedStand === label.stand);
      }
    }
    function projectProcessAnchors(now, force = false) {
      if (!alive || !latest.current.onAnchorsChange) return;
      if (!force && now - lastAnchors < 100) {
        // Deliver the final camera pose even when a short drag, a resize or a
        // paused-frame update ends before the throttle interval has elapsed.
        if (!anchorTimer) anchorTimer = window.setTimeout(() => {
          anchorTimer = null;
          projectProcessAnchors(performance.now(), true);
        }, 100 - (now - lastAnchors));
        return;
      }
      camera.updateMatrixWorld();
      lastAnchors = now;
      if (latest.current.onCharacterAnchor) {
        let characterAnchor = null;
        if (factoryCharacter?.group?.visible) {
          const position = factoryCharacter.group.getWorldPosition(new THREE.Vector3());
          position.y += 1.95;
          characterAnchor = normalizedScreenPoint(position.project(camera), true);
        }
        const characterKey = characterAnchor
          ? `${characterAnchor.x.toFixed(4)}:${characterAnchor.y.toFixed(4)}:${characterAnchor.visible}`
          : '';
        if (characterKey !== lastCharacterAnchorSignature) {
          lastCharacterAnchorSignature = characterKey;
          latest.current.onCharacterAnchor(characterAnchor);
        }
      }
      const anchors = processAnchors.map(({ stand, top, bottom, stripEdgeZ, tensionPosition }) => {
        const descriptor = (roll) => {
          const position = roll.getWorldPosition(new THREE.Vector3());
          return { position: position.toArray(), radius: roll.userData.radius,
            frontZ: position.z + roll.geometry.boundingBox.max.z };
        };
        const worldPosition = workRollNipPosition(descriptor(top), descriptor(bottom), stripEdgeZ);
        const standVisible = top.parent.visible && bottom.parent.visible;
        const project = (position, details, isVisible = standVisible) => ({ ...details, worldPosition: position,
          ...normalizedScreenPoint(new THREE.Vector3(...position).project(camera), isVisible) });
        const force = project(worldPosition, { objectName: top.name, sourceObjects: [top.name, bottom.name, 'Steel_Strip'],
          label: '工作辊辊缝', mapping: 'engineering-reference', note: '工艺位置关联，不代表模型中存在测力传感器' });
        const topDescriptor = descriptor(top);
        const speed = project([topDescriptor.position[0], topDescriptor.position[1], topDescriptor.frontZ], {
          objectName: top.name, sourceObjects: [top.name], label: '工作辊轴端', mapping: 'engineering-reference',
          note: '轧制速度关联工作辊；不是模型中的测速仪' });
        const tension = project(tensionPosition, { objectName: 'Steel_Strip', sourceObjects: ['Steel_Strip'],
          label: `${stand} 入口带钢`, mapping: 'engineering-reference', note: '紧邻本机架入口的带钢张力关联位置，非实际张力计' },
          standVisible && latest.current.showStrip);
        const sources = model.userData.sourceAnchors || {};
        const piston = sources[`${stand}_WorkRoll_Top_Operator_BendingPiston1`];
        const source = piston || sources[`${stand}_Frame`];
        const sourceGroup = source && model.getObjectByName(source.groupName);
        const sourcePosition = source ? new THREE.Vector3(...source.position) : new THREE.Vector3(...worldPosition);
        if (sourceGroup) sourcePosition.applyMatrix4(sourceGroup.matrixWorld);
        const bendingForce = project(sourcePosition.toArray(), {
          objectName: source?.objectName || top.name, sourceObjects: [source?.objectName || top.name],
          label: piston ? '操作侧弯辊液压活塞' : source ? '机架参考位置' : '工作辊参考位置', mapping: piston ? 'source-component' : 'engineering-reference',
          note: piston ? '原始 GLB 弯辊执行机构几何位置；未声明已接入压力传感器' : '源模型未定位独立弯辊执行机构，使用已有结构参考位置' },
          standVisible && (sourceGroup ? sourceGroup.visible : true));
        return { stand, ...force, channels: { force, speed, tension, bendingForce } };
      });
      const signature = JSON.stringify(anchors.map(({ stand, channels }) =>
        [stand, ...Object.entries(channels).map(([field, { x, y, visible, worldPosition }]) =>
          [field, Number(x.toFixed(6)), Number(y.toFixed(6)), visible, worldPosition])]));
      if (signature !== lastAnchorSignature || latest.current.onAnchorsChange !== lastAnchorCallback) {
        lastAnchorSignature = signature; lastAnchorCallback = latest.current.onAnchorsChange;
        lastAnchorCallback(anchors);
      }
    }
    function render(now) {
      frame = 0;
      if (!alive || !renderer || renderingPaused || contextLost || renderer.getContext().isContextLost()) return;
      const processMoving = moving();
      const animate = processMoving;
      // Quality is explicit: no adaptive resolution, 30 fps lock or bloom shutdown.
      // Keep the pre-optimization 60 Hz scheduling without changing render quality.
      if (animate && lastTime && now - lastTime < 1000 / 60) { invalidate(); return; }
      const elapsed = lastTime ? (now - lastTime) / 1000 : 0;
      if (cameraFlight) {
        const progress = Math.min(1, (now - cameraFlight.start) / cameraFlight.duration);
        const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
        camera.position.lerpVectors(cameraFlight.from, cameraFlight.to, eased);
        if (cameraFlight.arc) {
          const lift = Math.sin(progress * Math.PI) * cameraFlight.arc;
          camera.position.y += lift;
        }
        controls.target.lerpVectors(cameraFlight.fromTarget, cameraFlight.toTarget, eased);
        if (progress >= 1) cameraFlight = null;
        invalidate();
      }
      twinLayer?.setProcess(latest.current.processData, standSpeed('S5'));
      twinLayer?.update(Math.min(0.05, elapsed), now / 1000);
      lastTime = now;
      if (walkActive) updateWalk(Math.min(0.05, elapsed));
      else if (camKeys.size) updateFreeCamera(Math.min(0.05, elapsed));
      if (processMoving) {
        const transport = visualTransportStep(elapsed, standSpeed('S5'));
        distance.value += transport; coils?.advance(transport);
        for (const roll of rollers) {
          if (!roll.parent.visible) continue;
          const step = visualTransportStep(elapsed, standSpeed(roll.userData.stand));
          roll.rotation.z += rollRotationStep(step, roll.userData.radius, roll.name);
        }
      }
      stage?.updateCamera(camera);
      if (factoryCharacter) factoryCharacter.update(Math.min(0.05, elapsed));
      // 自动漫游：在默认机位的正面弧段内缓慢往返（±约18°），不绕到厂房背面。
      if (roamEnabled && controls && !walkActive && !intro) {
        roamPhase += Math.min(0.05, elapsed) * 0.5;
        const dAzimuth = Math.cos(roamPhase) * 0.16 * Math.min(0.05, elapsed);
        const offset = camera.position.clone().sub(controls.target);
        offset.applyAxisAngle(UP_AXIS, dAzimuth);
        camera.position.copy(controls.target).add(offset);
      }
      if (!walkActive && controls) {
        if (controls.update()) invalidate();
        // 相机贴地时 0.4 的近裁剪面会把地坪切开，露出一块斜切深色平面。
        // 约束相机与球心的高度，保证近平面永远在地面之上。
        const minCamY = FLOOR_Y + 1.1;
        if (camera.position.y < minCamY) camera.position.y = minCamY;
        if (controls.target.y < FLOOR_Y + 0.45) controls.target.y = FLOOR_Y + 0.45;
      }
      if (stage) element.dataset.hallBackdropVisible = String(stage.backdrop.visible);
      if (composer) composer.render(); else renderer.render(scene, camera);
      renderCount++;
      if (restorationPending && model) { restorationPending = false; setStatus({ phase: 'ready', message: '' }); }
      writeTelemetry(now); projectStandLabels(); projectProcessAnchors(now);
      if (animate || walkActive || twinLayer || (factoryCharacter && factoryCharacter.state !== 'IDLE') || intro || roamEnabled) invalidate();
    }
    // 用户一碰就停：进场运镜取消、自动漫游关闭。
    // 机房片式派工：数字人走到目标机架，看板/指向/点头一套汇报动作。
    function dispatchToStand(stand) {
      if (!factoryCharacter || !coreBounds.has(stand)) return false;
      const center = coreBounds.get(stand).getCenter(new THREE.Vector3());
      patrolPausedUntil = performance.now() + 20000;
      const targetZ = THREE.MathUtils.clamp(center.z + 2.2, 5.4, ENGINEER_AISLE_Z);
      const standGroup = model?.children?.find(group => group.userData?.stand === stand);
      factoryCharacter.walkTo(new THREE.Vector3(center.x, FLOOR_Y, targetZ), {
        onArrive: () => {
          factoryCharacter.face(new THREE.Vector3(center.x, 2.6, center.z));
          if (standGroup) highlightInspection(new THREE.Box3().setFromObject(standGroup), 0xffc857, 6000);
          factoryCharacter.act([
            { name: 'LookTablet', hold: 2.0 },
            { name: 'Point', hold: 1.8 },
            { name: 'Nod', hold: 1.0 },
          ], () => invalidate());
          invalidate();
        },
      });
      invalidate();
      return true;
    }
    function interruptCinematic() {
      if (intro) intro.cancel();
      cameraFlight = null;
      roamEnabled = false;
    }
    function invalidate() { if (alive && !renderingPaused && !contextLost && !frame) frame = requestAnimationFrame(render); }

    function interactionRoots() {
      return [model, factoryAssetGroup, factoryCharacter?.group, walkBoards?.group].filter(Boolean);
    }
    function describeObject(object) {
      let node = object;
      while (node && node !== scene) {
        if (node.visible === false) return null;
        const meta = node.userData?.interaction;
        if (meta) {
          const box = new THREE.Box3().setFromObject(node);
          if (box.isEmpty()) return null;
          return { ...meta, object: node, box, position: box.getCenter(new THREE.Vector3()).toArray(), size: box.getSize(new THREE.Vector3()).toArray(), key: `${meta.kind}:${meta.stand || meta.key || node.uuid}` };
        }
        const stand = node.userData?.stand;
        if (stand && STANDS.includes(stand)) {
          const box = (coreBounds.get(stand) || new THREE.Box3().setFromObject(node)).clone();
          if (box.isEmpty()) return null;
          return { kind: 'stand', stand, label: `${stand} 机架`, page: 'overview', desc: '五机架冷连轧机架', object: node, box, position: box.getCenter(new THREE.Vector3()).toArray(), size: box.getSize(new THREE.Vector3()).toArray(), key: `stand:${stand}` };
        }
        node = node.parent;
      }
      return null;
    }
    function pickAt(clientX, clientY) {
      if (!model || !renderer) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const px = new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
      pickRay.setFromCamera(px, camera);
      const hits = pickRay.intersectObjects(interactionRoots(), true);
      for (const hit of hits) {
        if (hit.object.visible === false) continue;
        if (walkActive && hit.distance > 26) continue;
        const descriptor = describeObject(hit.object);
        if (descriptor) return descriptor;
      }
      return null;
    }
    function clearHover() {
      hoverKey = '';
      if (hoverHelper) {
        owned.remove(hoverHelper);
        hoverHelper.geometry.dispose();
        hoverHelper.material.dispose();
        hoverHelper = null;
      }
      if (tooltipEl) tooltipEl.style.display = 'none';
      setHoverInfo(null);
      if (renderer) renderer.domElement.style.cursor = 'grab';
    }
    function setHover(descriptor, clientX = 0, clientY = 0) {
      const key = descriptor?.key || '';
      if (key === hoverKey) {
        if (tooltipEl && descriptor && !walkActive) {
          const rect = element.getBoundingClientRect();
          tooltipEl.style.left = `${clientX - rect.left + 14}px`;
          tooltipEl.style.top = `${clientY - rect.top + 12}px`;
        }
        return;
      }
      if (walkActive && key && key !== hoverKey) setInteraction(null);
      hoverKey = key;
      if (hoverHelper) {
        owned.remove(hoverHelper);
        hoverHelper.geometry.dispose();
        hoverHelper.material.dispose();
        hoverHelper = null;
      }
      setHoverInfo(descriptor ? { kind: descriptor.kind, label: descriptor.label, desc: descriptor.desc, stand: descriptor.stand || null } : null);
      if (!descriptor) {
        if (tooltipEl) tooltipEl.style.display = 'none';
        if (renderer) renderer.domElement.style.cursor = 'grab';
        return;
      }
      // In first-person mode the crosshair and [E] prompt carry the target;
      // a full wireframe box around the machine is too noisy at eye level.
      if (walkActive) {
        if (renderer) renderer.domElement.style.cursor = 'crosshair';
        invalidate();
        return;
      }
      const extent = Math.max(...(descriptor.size || [0, 0, 0]));
      // 真实厂区不使用悬停线框/浮签；选中与镜头层级足以表达可交互对象。
      if (renderer) renderer.domElement.style.cursor = 'pointer';
      if (tooltipEl) tooltipEl.style.display = 'none';
      invalidate();
    }
    function hoverAtPoint(clientX, clientY) {
      if (walkActive) return;
      const now = performance.now();
      if (now - hoverAt < 90) return;
      hoverAt = now;
      setHover(pickAt(clientX, clientY), clientX, clientY);
    }
    function focusOnBox(box) {
      if (!box || box.isEmpty()) return;
      const target = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length();
      const direction = camera.position.clone().sub(controls.target).normalize();
      const distance = Math.max(6, Math.min(60, size * 1.25 + 3));
      camera.position.copy(target).addScaledVector(direction, distance);
      controls.target.copy(target);
      controls.update();
    }
    function openInteraction(descriptor) {
      if (!descriptor) return;
      // 厂区技术员是巡检/派工演出角色；点击仍可唤起副驾驶，但 AI 人格由页面桌宠承担（2026-11-15 起）。
      if (descriptor.kind === 'character') {
        window.dispatchEvent(new Event('dkqkar-assistant-open'));
        return;
      }
      // 工控机这类固定入口设备：点一下直接进目标页面。
      if (descriptor.direct && descriptor.page) {
        latest.current.onNavigate?.(descriptor.page);
        return;
      }
      // 设备选择只同步到空间标签与数据状态，不再弹出遮挡场景的信息卡。
      if (descriptor.stand) latest.current.onSelectStand?.(descriptor.stand);
      invalidate();
    }
    function interactAtCenter() {
      if (!renderer) return;
      const rect = renderer.domElement.getBoundingClientRect();
      openInteraction(pickAt(rect.left + rect.width / 2, rect.top + rect.height / 2));
    }
    function clearInspectionHighlight() {
      if (inspectionHighlight) {
        owned.remove(inspectionHighlight);
        inspectionHighlight.geometry.dispose();
        inspectionHighlight.material.dispose();
        inspectionHighlight = null;
      }
      clearTimeout(inspectionTimer);
    }
    // 派工到达后的设备响应：给目标一个清晰的 3D 框，并让操作台/HMI
    // 的发光材质短时增强。这样是“点设备→人过去→设备回应”的实体交互，
    // 而不是角色自己循环走动。
    function highlightInspection(box, color = 0x63e6ff, duration = 5000) {
      if (!box || box.isEmpty()) return;
      clearInspectionHighlight();
      inspectionHighlight = new THREE.Box3Helper(box.clone().expandByScalar(0.18), color);
      inspectionHighlight.material.depthTest = false;
      inspectionHighlight.material.transparent = true;
      inspectionHighlight.material.opacity = 0.9;
      inspectionHighlight.renderOrder = 12;
      owned.add(inspectionHighlight);
      inspectionTimer = window.setTimeout(() => { clearInspectionHighlight(); invalidate(); }, duration);
      invalidate();
    }
    function pulseEmissive(target, duration = 4200) {
      if (!target) return;
      const affected = [];
      target.traverse(object => {
        if (!object.isMesh) return;
        for (const material of [].concat(object.material || [])) {
          if (!material || !material.emissive || material.emissiveIntensity === undefined) continue;
          if (material.emissive.r + material.emissive.g + material.emissive.b < 0.02) continue;
          affected.push({ material, base: material.emissiveIntensity });
          material.emissiveIntensity = Math.max(1.4, (Number(material.emissiveIntensity) || 1) * 2.4);
          material.needsUpdate = true;
        }
      });
      if (!affected.length) return;
      window.setTimeout(() => {
        for (const { material, base } of affected) { material.emissiveIntensity = base; material.needsUpdate = true; }
        invalidate();
      }, duration);
    }
    function respondToStand(stand) {
      latest.current.onSelectStand?.(stand);
      const housing = model?.getObjectByName(`${stand}:housing`);
      const box = housing ? new THREE.Box3().setFromObject(housing) : coreBounds.get(stand);
      highlightInspection(box, 0x63e6ff, 5000);
      const pulpit = factoryAssetGroup?.getObjectByName(`PulpitAsset_${stand}`) || factoryAssetGroup?.getObjectByName(`Pulpit_${stand}`);
      if (pulpit) pulseEmissive(pulpit);
    }
    function walkBlocked(x, z) {
      for (const box of assetColliders) {
        if (x > box.min.x && x < box.max.x && z > box.min.z && z < box.max.z) return true;
      }
      for (const stand of STANDS) {
        const bounds = coreBounds.get(stand);
        if (!bounds) continue;
        const cx = bounds.getCenter(new THREE.Vector3()).x;
        if (Math.abs(x - cx) < 1.6 && z > 7.8 && z < 11.6) return true;
      }
      return x > -19 && x < 19 && z > -6 && z < 5.5;
    }
    function updateWalk(dt) {
      if (!walkActive) return;
      // Ease the look direction so mouse drags do not snap the horizon around.
      const lookEase = Math.min(1, dt * 18);
      walkYaw += (walkLookYaw - walkYaw) * lookEase;
      walkPitch += (walkLookPitch - walkPitch) * lookEase;
      const maxSpeed = walkKeys.has('shift') ? 6.4 : 3.05;
      const fx = -Math.sin(walkYaw), fz = -Math.cos(walkYaw);
      const rx = Math.cos(walkYaw), rz = -Math.sin(walkYaw);
      let dx = 0, dz = 0;
      if (walkKeys.has('w') || walkKeys.has('arrowup')) { dx += fx; dz += fz; }
      if (walkKeys.has('s') || walkKeys.has('arrowdown')) { dx -= fx; dz -= fz; }
      if (walkKeys.has('a') || walkKeys.has('arrowleft')) { dx -= rx; dz -= rz; }
      if (walkKeys.has('d') || walkKeys.has('arrowright')) { dx += rx; dz += rz; }
      const length = Math.hypot(dx, dz);
      const targetX = length ? dx / length * maxSpeed : 0;
      const targetZ = length ? dz / length * maxSpeed : 0;
      const accel = Math.min(1, dt * (length ? 14 : 20));
      walkVel.x += (targetX - walkVel.x) * accel;
      walkVel.y += (targetZ - walkVel.y) * accel;
      const step = Math.hypot(walkVel.x, walkVel.y);
      if (step > 0.01) {
        setInteraction(null);
        walkPhase += step * dt * 1.9;
        const nx = THREE.MathUtils.clamp(walkPos.x + walkVel.x * dt, -24, 24);
        const nz = THREE.MathUtils.clamp(walkPos.z + walkVel.y * dt, 4.9, 22.0);
        if (!walkBlocked(nx, walkPos.z)) walkPos.x = nx;
        else walkVel.x = 0;
        if (!walkBlocked(walkPos.x, nz)) walkPos.z = nz;
        else walkVel.y = 0;
      }
      const bob = step > 0.2 ? Math.sin(walkPhase * 2.0) * 0.018 : 0;
      camera.position.set(walkPos.x, 1.68 + bob, walkPos.z);
      camera.rotation.set(walkPitch, walkYaw, 0, 'YXZ');
      const now = performance.now();
      if (now - centerHoverAt > 140) {
        centerHoverAt = now;
        const rect = renderer.domElement.getBoundingClientRect();
        setHover(pickAt(rect.left + rect.width / 2, rect.top + rect.height / 2));
      }
    }
    function roundedRect(ctx, x, y, width, height, radius) {
      const r = Math.min(radius, width / 2, height / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + width - r, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + r);
      ctx.lineTo(x + width, y + height - r);
      ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
      ctx.lineTo(x + r, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }
    function buildWalkBoards(anchors) {
      const group = new THREE.Group();
      group.name = 'Walk_Mode_Data_Boards';
      const boards = STANDS.map((stand) => {
        const bounds = coreBounds.get(stand);
        const canvas = document.createElement('canvas');
        canvas.width = 560; canvas.height = 196;
        const ctx = canvas.getContext('2d');
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false, toneMapped: false });
        const sprite = new THREE.Sprite(material);
        sprite.name = `Walk_Data_Board_${stand}`;
        const center = bounds ? bounds.getCenter(new THREE.Vector3()) : new THREE.Vector3(anchors[stand]?.x || 0, 0, 2);
        // 数据牌挂在机架顶部以上；Blender 轧机的 coreBounds 只包含辊系，
        // 需要额外抬到牌坊/压下装置之上。
        sprite.position.set(center.x, Math.max((bounds ? bounds.max.y : 6) + 2.05, 7.45), center.z + 0.15);
        sprite.scale.set(3.1, 1.09, 1);
        sprite.userData = { walkBoard: true, stand, interaction: { kind: 'stand', stand, label: `${stand} 机架`, page: 'overview', desc: '五机架冷连轧机架' } };
        sprite.renderOrder = 20;
        group.add(sprite);
        return { stand, sprite, canvas, ctx, texture, drawn: '' };
      });
      group.visible = false;
      scene.add(group);
      return { group, boards };
    }
    function drawWalkBoard(board) {
      const data = latest.current.processData?.stands?.find((item) => item.id === board.stand);
      const force = Number(data?.force);
      const text = Number.isFinite(force) ? force.toFixed(1) : '—';
      const selected = latest.current.selectedStand === board.stand;
      const signature = `${text}|${selected}`;
      if (signature === board.drawn) return;
      board.drawn = signature;
      const { ctx, canvas } = board, w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(7,32,44,.93)');
      grad.addColorStop(1, 'rgba(4,16,24,.93)');
      ctx.fillStyle = grad;
      roundedRect(ctx, 5, 5, w - 10, h - 10, 20);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = selected ? 'rgba(255,200,87,.96)' : 'rgba(79,196,224,.74)';
      ctx.stroke();
      ctx.fillStyle = selected ? '#ffc857' : '#4ec9e8';
      ctx.fillRect(24, 32, 6, h - 64);
      ctx.textBaseline = 'middle';
      ctx.fillStyle = selected ? '#ffe3a3' : '#8fd7ea';
      ctx.font = '600 30px "Segoe UI","Microsoft YaHei",sans-serif';
      ctx.fillText(`${board.stand} · 轧制力`, 50, 56);
      ctx.fillStyle = '#eefcff';
      ctx.font = '700 78px "Segoe UI","Microsoft YaHei",sans-serif';
      ctx.fillText(text, 48, 126);
      const valueWidth = ctx.measureText(text).width;
      ctx.fillStyle = '#8fb8c8';
      ctx.font = '500 30px "Segoe UI","Microsoft YaHei",sans-serif';
      ctx.fillText('t', 48 + valueWidth + 14, 144);
      ctx.beginPath(); ctx.arc(w - 46, 54, 9, 0, Math.PI * 2);
      ctx.fillStyle = Number.isFinite(force) && force > 0 ? '#56e0b0' : '#4a6b78';
      ctx.fill();
      ctx.fillStyle = 'rgba(126,206,226,.32)';
      ctx.fillRect(50, 166, w - 100, 3);
      board.texture.needsUpdate = true;
    }
    function updateWalkBoards() {
      if (!walkBoards) return;
      for (const board of walkBoards.boards) drawWalkBoard(board);
    }
    // 开放世界式相机：WASD/方向键平移相机与球心，Q/E 升降，Shift 加速。
    // 球心随移动一起走，所以不是固定绕一个点转。
    function updateFreeCamera(dt) {
      if (walkActive || !controls || !camKeys.size) return;
      const speed = (camKeys.has('shift') ? 15 : 5.5) * Math.max(0, dt);
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
      forward.normalize();
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
      const move = new THREE.Vector3();
      if (camKeys.has('w') || camKeys.has('arrowup')) move.add(forward);
      if (camKeys.has('s') || camKeys.has('arrowdown')) move.sub(forward);
      if (camKeys.has('d') || camKeys.has('arrowright')) move.add(right);
      if (camKeys.has('a') || camKeys.has('arrowleft')) move.sub(right);
      if (camKeys.has('e')) move.y += 1;
      if (camKeys.has('q')) move.y -= 1;
      if (move.lengthSq() < 1e-6) return;
      move.normalize().multiplyScalar(speed);
      camera.position.add(move);
      controls.target.add(move);
      controls.update();
      writeTelemetry();
      invalidate();
    }
    function setWalkMode(on) {
      const next = Boolean(on);
      if (next === walkActive) return;
      walkActive = next;
      if (next) interruptCinematic();
      element.dataset.walk = next ? 'true' : 'false';
      if (next) {
        walkSaved = { position: camera.position.clone(), target: controls.target.clone(), fov: camera.fov };
        controls.enabled = false;
        camera.clearViewOffset();
        camera.fov = 55;
        // Start behind the operator aisle, looking diagonally down the line:
        // all five pulpits, the S5 board and the engineer stay in frame.
        walkPos.set(10.4, 1.68, 20.6);
        walkYaw = 0.50; walkPitch = -0.025;
        walkLookYaw = walkYaw; walkLookPitch = walkPitch;
        walkVel.set(0, 0); walkPhase = 0;
        camera.position.copy(walkPos);
        camera.rotation.order = 'YXZ';
        camera.rotation.set(walkPitch, walkYaw, 0);
        camera.updateProjectionMatrix();
        element.classList.add('is-walking');
        factoryHall?.setMode('walk');
        if (walkShell) walkShell.visible = !factoryHall;
        if (walkBoards) { walkBoards.group.visible = true; updateWalkBoards(); }
        clearHover();
      } else {
        walkKeys.clear();
        lookDrag = null;
        walkVel.set(0, 0);
        element.classList.remove('is-walking');
        factoryHall?.setMode('overview');
        if (walkShell) walkShell.visible = false;
        if (walkBoards) walkBoards.group.visible = false;
        clearHover();
        if (walkSaved) {
          camera.fov = walkSaved.fov || 35;
          camera.position.copy(walkSaved.position);
          controls.target.copy(walkSaved.target);
          camera.updateProjectionMatrix();
          controls.enabled = true;
          controls.update();
          applyProjectionInsets();
        }
      }
      lastTime = 0;
      invalidate();
    }
    const walkKeyDown = event => {
      if (!walkActive) return;
      if (event.target?.matches?.('input,textarea,select,[contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (key === 'escape') { latest.current.onExitWalk?.(); return; }
      if (key === 'e') { event.preventDefault(); interactAtCenter(); return; }
      if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','shift'].includes(key)) {
        event.preventDefault();
        walkKeys.add(key);
      }
    };
    const walkKeyUp = event => { if (walkActive) walkKeys.delete(event.key.toLowerCase()); };
    const camKeyDown = event => {
      if (walkActive || !controls) return;
      interruptCinematic();
      if (event.target?.matches?.('input,textarea,select,[contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) {
        event.preventDefault();
        camKeys.add(key);
        invalidate();
      }
    };
    const camKeyUp = event => { if (!walkActive) camKeys.delete(event.key.toLowerCase()); };
    window.addEventListener('keydown', walkKeyDown);
    window.addEventListener('keyup', walkKeyUp);
    window.addEventListener('keydown', camKeyDown);
    window.addEventListener('keyup', camKeyUp);


    function applyProjectionInsets() {
      const width = Math.max(1, element.clientWidth), height = Math.max(1, element.clientHeight);
      camera.aspect = width / height;
      if (!latest.current.annotationInsets) {
        camera.clearViewOffset(); camera.updateProjectionMatrix(); delete element.dataset.annotationViewport; return null;
      }
      const viewport = annotationViewport(width, height, latest.current.annotationInsets);
      // Move the principal point to the free rectangle's center. The WebGL
      // canvas and all annotation coordinates still use the full container.
      camera.setViewOffset(width, height, viewport.offsetX, viewport.offsetY, width, height);
      element.dataset.annotationViewport = JSON.stringify(viewport);
      return viewport;
    }

    function fitCamera(direction, explicitStand = null) {
      if (!controls || walkActive) return;
      const viewport = applyProjectionInsets();
      const points = [];
      const addCorners = (bounds, matrix) => {
        // 尚未就位的资产会给出空盒（±Infinity）；这类点一旦进入取景计算，
        // 相机就会被推到模型之外，首屏只剩一片空场。
        if (!bounds || bounds.isEmpty?.()) return;
        for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
          const point = new THREE.Vector3(x, y, z);
          if (matrix) point.applyMatrix4(matrix);
          if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) continue;
          points.push(point);
        }
      };
      // 点集来自正在异步装配的场景：个别网格/实例的包围盒可能滞后一拍。
      // 按投影轴做 1%/99% 分位裁剪，正常点集（极值≈分位值）不会被削掉，
      // 混进来的远处离群点则不会再把取景距离放大一个数量级。
      const trimFitOutliers = (source) => {
        if (source.length < 24) return source;
        const keep = new Uint8Array(source.length).fill(1);
        let trimmed = 0;
        for (const axis of ['x', 'y', 'z']) {
          const values = [];
          for (const point of source) if (Number.isFinite(point[axis])) values.push(point[axis]);
          if (values.length < source.length) {
            for (let index = 0; index < source.length; index += 1) {
              if (!Number.isFinite(source[index][axis]) && keep[index]) { keep[index] = 0; trimmed += 1; }
            }
            continue;
          }
          values.sort((a, b) => a - b);
          const low = values[Math.floor((values.length - 1) * 0.01)];
          const high = values[Math.floor((values.length - 1) * 0.99)];
          const core = high - low;
          if (!(core > 0)) continue;
          const lowLimit = low - core * 3, highLimit = high + core * 3;
          for (let index = 0; index < source.length; index += 1) {
            const value = source[index][axis];
            if (keep[index] && (value < lowLimit || value > highLimit)) { keep[index] = 0; trimmed += 1; }
          }
        }
        if (!trimmed) return source;
        const filtered = source.filter((_, index) => keep[index]);
        if (filtered.length < 16) return source;
        element.dataset.fitTrimmed = String(trimmed);
        return filtered;
      };
      const selected = explicitStand;
      let target;
      if(selected&&findingFocusedStand===selected&&coreBounds.has(selected)){
        // Finding frames the existing rolling core, without distant drive foundations.
        const bounds=coreBounds.get(selected).clone().expandByScalar(.35);
        if(latest.current.explode){bounds.max.y+=1.7;bounds.max.z+=2.5;}
        target=bounds.getCenter(new THREE.Vector3());addCorners(bounds);
      } else if (selected && !viewport) {
        const core = coreBounds.get(selected) || new THREE.Box3(new THREE.Vector3(9.8, 0.8, -2.06), new THREE.Vector3(11, 5.2, 2.06));
        target = core.getCenter(new THREE.Vector3());
        // Frame around the rolling head, not the distant motor or operator
        // platform. The roll nip stays at the visual center in every view.
        target.y = 3; target.z = 0;
        const bounds = new THREE.Box3(target.clone().add(new THREE.Vector3(-3.8, -3.05, -2.45)), target.clone().add(new THREE.Vector3(3.8, 3.7, 2.45)));
        if (latest.current.explode) { bounds.max.y += 1.7; bounds.max.z += 2.5; }
        addCorners(bounds);
      } else if (model && activeView === 'hall' && !selected) {
        // Frame the actual designed bay, not its infinite presentation floor.
        // Keep the crane, stored coils, service area and mill in one composition.
        const hallBounds = new THREE.Box3(new THREE.Vector3(-22, -0.2, -11.8), new THREE.Vector3(22, 12.1, 7.8));
        addCorners(hallBounds); target = hallBounds.getCenter(new THREE.Vector3());
      } else if (model) {
        model.updateMatrixWorld(true);
        const frameRollingLine = !selected && activeView === 'perspective' && !latest.current.explode;
        model.traverseVisible((object) => {
          if (!object.isMesh) return;
          if(selected&&object.userData.stand!==selected&&object.userData.part!=='strip')return;
          if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
          if (selected && object.userData.part === 'strip') {
            const visibleBounds = object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
            const focusX=coreBounds.get(selected)?.getCenter(new THREE.Vector3()).x;
            const stripFocus=Number.isFinite(focusX)?[focusX-2.8,focusX+2.8]:[-15.55,15.55];
            visibleBounds.min.x = Math.max(visibleBounds.min.x, stripFocus[0]);
            visibleBounds.max.x = Math.min(visibleBounds.max.x, stripFocus[1]);
            if (!visibleBounds.isEmpty()) addCorners(visibleBounds);
          } else if (frameRollingLine) {
            // Distant drive foundations remain in the scene, but must not push
            // the operator-side overview away from the actual rolling line.
            // Keep each batch separate: one union box creates phantom tall
            // corners behind the housings and overstates their screen height.
            const rollingBounds = object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
            rollingBounds.min.z = Math.max(rollingBounds.min.z, -2.4);
            if (!rollingBounds.isEmpty()) addCorners(rollingBounds);
          } else addCorners(object.geometry.boundingBox, object.matrixWorld);
        });
        if (!selected) {
          // SpatialData owns the dashboard callouts and already reserves their
          // screen space. Legacy labels must not add a second world-space roof.
          if (!latest.current.onAnchorsChange) for (const label of standLabels) points.push(label.position.clone());
          if (coils?.root.visible) addCorners(coils.bounds);
          if (factoryCharacter) {
            const actorBounds = new THREE.Box3().setFromObject(factoryCharacter.group);
            if (!actorBounds.isEmpty()) addCorners(actorBounds);
          }
        }
        target = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
      } else {
        target = new THREE.Vector3(10.4, 3, 0);
        addCorners(new THREE.Box3(target.clone().addScalar(-4), target.clone().addScalar(4)));
      }
      if (!points.length) return;
      const framed = trimFitOutliers(points);
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
      const up = new THREE.Vector3().crossVectors(direction, right).normalize();
      const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const width = element.clientWidth, height = element.clientHeight;
      const sideReserve = !latest.current.compact && latest.current.hasDataOverlay ? (width >= 1100 ? 490 : width >= 850 ? 385 : 60) : 44;
      // 投影斜率必须有下限：首帧容器/标注留白还没测量完时 fraction 会趋近 0，
      // 斜率随之趋零，取景距离被放大成几百单位，画面就只剩一片空场。
      const slopeX = Math.max(viewport ? tanY * camera.aspect * viewport.fractionX
        : tanY * Math.max(camera.aspect, 0.3) * Math.max(0.36, 1 - sideReserve / Math.max(width, 1)), 0.03);
      const slopeY = Math.max(viewport ? tanY * viewport.fractionY
        : tanY * Math.max(0.60, 1 - 85 / Math.max(height, 260)), 0.03);
      let fitDistance = 1;
      for (const point of framed) {
        const relative = point.clone().sub(target), depth = relative.dot(direction);
        fitDistance = Math.max(fitDistance, Math.abs(relative.dot(right)) / slopeX + depth,
          Math.abs(relative.dot(up)) / slopeY + depth, depth + camera.near + 1);
      }
      if ((!selected || viewport) && model) {
        const fit = fitProjectedBounds(framed.map((point) => [point.dot(right), point.dot(up), point.dot(direction)]), slopeX, slopeY, camera.near);
        target.set(0, 0, 0).addScaledVector(right, fit.x).addScaledVector(up, fit.y).addScaledVector(direction, fit.z);
        fitDistance = fit.depth - fit.z;
      }
      // 正常取景距离（整线 ~32、厂房视角 ~50）远小于此。超出说明点集里混进了
      // 尚未就位或二次变换的包围盒；忽略这些点，只用模型整体包围盒重新取景。
      if (fitDistance > 72 && model) {
        const fallback = new THREE.Box3().setFromObject(model);
        const span = fallback.isEmpty() ? 0 : fallback.getSize(new THREE.Vector3()).length();
        if (!fallback.isEmpty() && fitDistance > Math.max(72, span * 2.2)) {
          const corners = [];
          for (const x of [fallback.min.x, fallback.max.x])
            for (const y of [fallback.min.y, fallback.max.y])
              for (const z of [fallback.min.z, fallback.max.z]) corners.push(new THREE.Vector3(x, y, z));
          const fit = fitProjectedBounds(corners.map((point) => [point.dot(right), point.dot(up), point.dot(direction)]), slopeX, slopeY, camera.near);
          target.set(0, 0, 0).addScaledVector(right, fit.x).addScaledVector(up, fit.y).addScaledVector(direction, fit.z);
          fitDistance = fit.depth - fit.z;
          element.dataset.fitFallback = '1';
        }
      }
      element.dataset.fitDistance = fitDistance.toFixed(1);
      const isPlantOverview = !selected && latest.current.focusMode === 'line' && activeView === 'perspective';
      if (isPlantOverview) {
        // 多线厂区（主线 z=-2.1 + 背景线 -22.1/-42.1）：默认取景罩住三条线，
        // 中心取产线群中心 z≈-20，距离按 21:06 三线时代先例（fit 118）随厂区深度略收。
        target.set(0, 1.5, -20);
        fitDistance = 112;
        controls.maxDistance = 170;
        camera.far = 300; camera.updateProjectionMatrix();
      }
      element.dataset.cameraLevel = selected ? 'equipment' : 'plant';
      controls.maxDistance = Math.max(110, fitDistance * 1.4);
      camera.far = Math.max(220, fitDistance * 2 + 50); camera.updateProjectionMatrix();
      // Keep a small margin in the line overview so the exit recoiler is not
      // clipped by the viewport edge on common laptop widths.
      const fitScale = (!selected && latest.current.focusMode === 'line') ? (element.clientHeight < 420 ? 1.08 : 1.025) : 1;
      camera.position.copy(target).addScaledVector(direction, fitDistance * fitScale);
      camera.up.set(0, 1, 0); controls.target.copy(target); controls.update(); writeTelemetry(); invalidate();
    }
    function clearMeasurementHighlight() {
      if(measurementHighlight){owned.remove(measurementHighlight);measurementHighlight.geometry.dispose();measurementHighlight.material.dispose();measurementHighlight=null;}
      delete element.dataset.highlightedStand;delete element.dataset.highlightedMeasurement;delete element.dataset.highlightedObject;
    }
    function cancelCameraRestore(){savedCamera=null;pendingRestore=null;cancelAnimationFrame(restoreFrame);restoreFrame=0;}
    function clearMeasurementFocus(){
      if(measurementFocusedStand)cancelCameraRestore();
      measurementFocusedStand=null;clearMeasurementHighlight();writeTelemetry();invalidate();
    }
    function clearFindingHighlight(){
      if(findingHighlight){owned.remove(findingHighlight);findingHighlight.geometry.dispose();findingHighlight.material.dispose();findingHighlight=null;}
      delete element.dataset.findingFocusedStand;
    }
    function clearFindingFocus(){
      if(findingFocusedStand)cancelCameraRestore();
      findingFocusedStand=null;clearFindingHighlight();writeTelemetry();invalidate();
    }
    function setView(nextView = 'perspective') {
      clearMeasurementHighlight();
      clearFindingFocus();
      activeView = ['hall', 'perspective', 'front', 'top', 'drive'].includes(nextView) ? nextView : 'perspective';
      measurementFocusedStand = null;
      const direction = new THREE.Vector3(...industrialCameraDirection(activeView, latest.current.focusMode)).normalize();
      fitCamera(direction);
    }
    function updateScene() {
      if (!model) return;
      const props = latest.current, scopeChanged = props.focusMode !== activeScope;
      studio?.setMode(props.lighting);
      twinLayer?.setSelected(props.selectedStand);
      activeScope = props.focusMode;
      stage?.setScope?.(props.focusMode);
      coils?.setScope(props.focusMode, props.showStrip);
      const geometryKey = [props.focusMode, props.shellMode, props.explode, props.explode ? props.selectedStand : '', props.showStrip].join('/');
      if (contact) contact.enabled = props.shellMode === 'solid';
      if (geometryKey !== lastGeometryKey) {
        renderer.shadowMap.needsUpdate = true;
        contact?.invalidateGeometry();
        lastGeometryKey = geometryKey;
      }
      for (const group of model.children) {
        const { stand, part } = group.userData;
        group.visible = isProcessGroupVisible(group.userData, props);
        group.position.set(0, 0, 0);
        if (props.explode && stand === props.selectedStand) {
          if (part === 'rollsTop') group.position.y = 1.7;
          if (part === 'rollsBottom') group.position.y = -0.6;
          if (part === 'housing') group.position.z = 3;
          if (part === 'drive') group.position.z = -2.5;
        }
        const translucent = props.shellMode === 'transparent' && !isRollingCore(part);
        group.traverse((object) => {
          if (!object.isMesh) return;
          object.castShadow = !translucent && part !== 'strip';
          for (const material of [].concat(object.material)) {
            const original = materialOriginals.get(material);
            const transparent = translucent || original.transparent;
            if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
            material.opacity = translucent ? (part === 'housing' ? 0.10 : 0.065) : original.opacity;
            material.depthWrite = translucent ? false : original.depthWrite;
          }
        });
      }
      for (const mesh of stripMeshes) for (const material of [].concat(mesh.material)) {
        material.clippingPlanes = null;
      }
      model.updateMatrixWorld(true);
      element.dataset.visibleRolls = String(rollers.filter((roll) => roll.parent.visible).length);
      element.dataset.visibleStands = STANDS.filter((stand) => model.children.some((group) => group.visible && group.userData.stand === stand)).join(',');
      element.dataset.shellOpacity = props.shellMode === 'solid' ? '1' : props.shellMode === 'transparent' ? '0.1' : '0';
      element.dataset.stripRange = JSON.stringify([-15.55, 15.55]);
      updateStandCards(props);
      projectStandLabels();
      updateWalkBoards();
      // Selecting an upstream card is a data-inspection action, not a camera
      // command. Keeping selectedStand out of this key prevents a card click
      // from re-fitting the whole line and visibly changing the 3D exposure.
      const framingKey = [props.focusMode, props.shellMode, props.explode].join('/');
      if (scopeChanged) setView(activeView);
      else if (props.annotationInsets && framingKey !== lastFramingKey) fitCamera(camera.position.clone().sub(controls.target).normalize(), effectiveFocusedStand());
      lastFramingKey = framingKey;
      lastTime = performance.now(); writeTelemetry(); invalidate();
      latest.current.onSceneReady?.();
    }
    function syncViewport(finalizeRestore = false) {
      if (!renderer || !alive) return;
      const width = Math.max(element.clientWidth, 1), height = Math.max(element.clientHeight, 1);
      const props = latest.current, expandedChanged = props.expanded !== wasExpanded;
      const insets = props.annotationInsets;
      const nextKey = [width, height, props.expanded, !!insets, insets?.top, insets?.bottom, insets?.left, insets?.right].join('/');
      // Ignore small layout churn from changing numeric text. A full refit on
      // a few pixels moves the camera and can visibly rebalance the stage
      // lighting between two otherwise identical stream rows.
      const widthDelta = Math.abs(width - viewportWidth), heightDelta = Math.abs(height - viewportHeight);
      const sizeChanged = widthDelta > 1 || heightDelta > 1;
      const refitSize = widthDelta > 24 || heightDelta > 24;
      if (!expandedChanged && nextKey === viewportKey && !pendingRestore) return;

      // Both React's insets effect and ResizeObserver enter here. Capture the
      // normal camera before either callback has an opportunity to reframe it.
      if (findingFocusedStand)cancelCameraRestore();
      if (expandedChanged && model && !findingFocusedStand) {
        if (props.expanded) {
          cancelAnimationFrame(restoreFrame); restoreFrame = 0; pendingRestore = null;
          savedCamera = { position: camera.position.clone(), target: controls.target.clone(), focus: measurementFocusedStand,
            maxDistance: controls.maxDistance, far: camera.far };
        } else if (savedCamera) {
          pendingRestore = savedCamera; savedCamera = null;
        }
      }
      wasExpanded = props.expanded;
      viewportKey = nextKey; viewportWidth = width; viewportHeight = height;
      applyProjectionInsets();
      if (sizeChanged) {
        // 显示器 DPR 可能在窗口跨屏后变化；渲染器与合成器的像素倍率必须同步，
        // 否则 EffectComposer 仍按构造时的 2.5 倍申请渲染目标。
        const ratio = industrialPixelRatio();
        if (renderer.getPixelRatio() !== ratio) { renderer.setPixelRatio(ratio); composer?.setPixelRatio(ratio); }
        renderer.setSize(width, height, false);
        composer?.setSize(width, height);
        if (sharpen && composer) sharpen.uniforms.texelSize.value.set(
          1 / Math.max(1, composer.readBuffer.width), 1 / Math.max(1, composer.readBuffer.height));
      }
      if (pendingRestore && !props.expanded) {
        camera.far = pendingRestore.far; camera.updateProjectionMatrix();
        controls.maxDistance = pendingRestore.maxDistance;
        camera.position.copy(pendingRestore.position); controls.target.copy(pendingRestore.target);
        measurementFocusedStand = pendingRestore.focus; controls.update();
        if (finalizeRestore) pendingRestore = null;
        else if (!restoreFrame) {
          // React can update insets before the resized canvas is observed.
          // Settle this transition against the committed layout in one frame;
          // subsequent equal-size notifications cannot refit the saved camera.
          restoreFrame = requestAnimationFrame(() => { restoreFrame = 0; syncViewport(true); });
        }
      } else if (!model) setView(activeView);
      else if (expandedChanged || refitSize || findingFocusedStand) {
        fitCamera(camera.position.clone().sub(controls.target).normalize(), effectiveFocusedStand());
      }
      writeTelemetry(); invalidate();
    }
    function resize() { syncViewport(); }
    const visibility = () => { lastTime = performance.now(); invalidate(); };
    let down, up, lost, restored, pointerMove, pointerLeave, dblclick;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      // 超采样倍率跟随显示器 DPR（上限 1.5x），不再固定 2.5x 盲目放大像素预算。
      renderer.setPixelRatio(INDUSTRIAL_PIXEL_RATIO);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = 1.0;
      renderer.localClippingEnabled = true;
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
      renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
      renderer.domElement.setAttribute('aria-label', 'S1至S5五机架轧制设备三维场景，可拖动旋转、滚轮缩放');
      element.appendChild(renderer.domElement);
      element.dataset.mount = 'renderer';
      controls = new OrbitControls(camera, renderer.domElement);
      // 开放世界式相机：平滑阻尼 + 可移动球心 + WASD 自由移动。
      controls.enableDamping = true; controls.dampingFactor = 0.08;
      controls.minDistance = 8.5; controls.maxDistance = 160;
      controls.maxPolarAngle = Math.PI * 0.495; controls.addEventListener('change', invalidate);
      controls.enablePan = true;
      controls.screenSpacePanning = true;
      controls.panSpeed = 1.0;
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };
      controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
      studio = createIndustrialStudio(renderer, scene);
      studio.setMode(latest.current.lighting);
      stage = createIndustrialStage(scene);
      // 巡视模式专用：补出完整的封闭车间（屋盖/桁架/侧墙/端墙），
      // 避免第一人称抬头看到空场景或远处悬空的吊车梁。
      walkShell = new THREE.Group();
      walkShell.name = 'Walk_Mode_Hall_Shell';
      walkShell.visible = false;
      const shellMat = new THREE.MeshStandardMaterial({ color: '#24343e', roughness: 0.86, metalness: 0.16, side: THREE.DoubleSide, envMap: studio.environment.texture, envMapIntensity: 0.2 });
      const roofMat = new THREE.MeshStandardMaterial({ color: '#141d24', roughness: 0.94, metalness: 0.04, side: THREE.DoubleSide, envMap: studio.environment.texture, envMapIntensity: 0.06 });
      const ribMat = new THREE.MeshStandardMaterial({ color: '#3c5563', roughness: 0.56, metalness: 0.48, envMap: studio.environment.texture, envMapIntensity: 0.16 });
      const lampMat = new THREE.MeshBasicMaterial({ color: '#9fc4d3' });
      const hallLampMat = new THREE.MeshBasicMaterial({ color: '#d8f2ff', toneMapped: false });
      const windowMat = new THREE.MeshStandardMaterial({ color: '#35586b', roughness: 0.38, metalness: 0.12, emissive: '#5f93ad', emissiveIntensity: 0.6, side: THREE.DoubleSide });
      const doorMat = new THREE.MeshStandardMaterial({ color: '#22323c', roughness: 0.72, metalness: 0.32, side: THREE.DoubleSide });
      const exitMat = new THREE.MeshBasicMaterial({ color: '#69f0b4', toneMapped: false });
      const place = new THREE.Matrix4(), placeQuat = new THREE.Quaternion(), placePos = new THREE.Vector3(), placeScale = new THREE.Vector3(1, 1, 1);
      const addHallInstances = (geometry, material, entries) => {
        const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
        entries.forEach((entry, index) => {
          placePos.fromArray(entry.p);
          placeQuat.setFromEuler(new THREE.Euler(...(entry.r || [0, 0, 0])));
          place.compose(placePos, placeQuat, placeScale);
          mesh.setMatrixAt(index, place);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        walkShell.add(mesh);
        return mesh;
      };
      const back = new THREE.Mesh(new THREE.PlaneGeometry(72, 14), shellMat);
      back.position.set(0, 6.4, 26); back.rotation.y = Math.PI; walkShell.add(back);
      addHallInstances(new THREE.BoxGeometry(0.12, 12.6, 0.12), ribMat,
        Array.from({ length: 25 }, (_, i) => ({ p: [-33.6 + i * 2.8, 6.3, 25.85] })));
      for (const x of [-24, 0, 24]) {
        const lamp = new THREE.Mesh(new THREE.PlaneGeometry(7, 0.10), lampMat);
        lamp.position.set(x, 9.1, 25.9); walkShell.add(lamp);
      }
      // 端墙卷帘门 + 出口标识，让回头方向也有真实车间尺度。
      const rollerDoor = new THREE.Mesh(new THREE.BoxGeometry(9.6, 6.6, 0.3), doorMat);
      rollerDoor.position.set(0, 3.3, 25.8); walkShell.add(rollerDoor);
      addHallInstances(new THREE.BoxGeometry(9.36, 0.07, 0.06), ribMat,
        Array.from({ length: 26 }, (_, i) => ({ p: [0, 0.34 + i * 0.245, 25.62] })));
      for (const x of [-4.95, 4.95]) {
        const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.34, 7.0, 0.42), ribMat);
        jamb.position.set(x, 3.5, 25.76); walkShell.add(jamb);
      }
      const header = new THREE.Mesh(new THREE.BoxGeometry(10.3, 0.42, 0.46), ribMat);
      header.position.set(0, 7.05, 25.76); walkShell.add(header);
      const exitSign = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.08), exitMat);
      exitSign.position.set(0, 7.55, 25.7); walkShell.add(exitSign);
      for (const side of [-1, 1]) {
        const wall = new THREE.Mesh(new THREE.PlaneGeometry(38, 14), shellMat);
        wall.position.set(side * 30, 6.4, 7); wall.rotation.y = side * Math.PI / 2; walkShell.add(wall);
        const band = new THREE.Mesh(new THREE.PlaneGeometry(35, 1.7), windowMat);
        band.position.set(side * 29.78, 7.9, 7); band.rotation.y = side * Math.PI / 2; walkShell.add(band);
      }
      addHallInstances(new THREE.BoxGeometry(0.12, 12.6, 0.12), ribMat,
        [-1, 1].flatMap(side => Array.from({ length: 16 }, (_, i) => ({ p: [side * 29.9, 6.3, -11.2 + i * 2.5] }))));
      addHallInstances(new THREE.BoxGeometry(0.08, 1.7, 0.1), ribMat,
        [-1, 1].flatMap(side => Array.from({ length: 15 }, (_, i) => ({ p: [side * 29.72, 7.9, -10.4 + i * 2.4] }))));
      // 屋盖与桁架：吊车梁最高点约 12.5 m，屋架放在其上方。
      const roof = new THREE.Mesh(new THREE.BoxGeometry(64, 0.4, 41), roofMat);
      roof.position.set(0, 13.55, 7); walkShell.add(roof);
      const trussZ = [];
      for (let z = -10; z <= 26; z += 4) trussZ.push(z);
      addHallInstances(new THREE.BoxGeometry(60, 0.18, 0.18), ribMat,
        trussZ.flatMap(z => [{ p: [0, 12.78, z] }, { p: [0, 13.16, z] }]));
      addHallInstances(new THREE.BoxGeometry(0.11, 0.38, 0.11), ribMat,
        trussZ.flatMap(z => Array.from({ length: 16 }, (_, i) => ({ p: [-30 + i * 4, 12.97, z] }))));
      addHallInstances(new THREE.BoxGeometry(0.09, 1.05, 0.09), ribMat,
        trussZ.flatMap(z => Array.from({ length: 15 }, (_, i) => ({ p: [-28 + i * 4, 12.97, z], r: [0, 0, i % 2 ? 0.72 : -0.72] }))));
      addHallInstances(new THREE.BoxGeometry(0.16, 0.16, 40), ribMat,
        [-24, -16, -8, 0, 8, 16, 24].map(x => ({ p: [x, 13.2, 7] })));
      const highBay = [];
      for (const x of [-12, -4, 4, 12]) for (const z of [-2, 6, 14, 22]) highBay.push({ p: [x, 12.55, z] });
      addHallInstances(new THREE.BoxGeometry(2.6, 0.14, 0.42), hallLampMat, highBay);
      addHallInstances(new THREE.BoxGeometry(0.05, 0.75, 0.05), ribMat,
        highBay.map(entry => ({ p: [entry.p[0], 12.99, entry.p[2]] })));
      for (const [x, z] of [[-8, 4], [8, 4], [-8, 16], [8, 16]]) {
        const fill = new THREE.PointLight('#cfe6ff', 22, 26, 2);
        fill.position.set(x, 11.6, z);
        walkShell.add(fill);
      }
      walkShell.add(new THREE.AmbientLight('#a8cfe0', 0.45));
      // 补上轧机侧后墙顶部与屋盖之间的采光带，避免露出一条黑色缝隙。
      const clerestory = new THREE.Mesh(new THREE.PlaneGeometry(64, 1.9), windowMat);
      clerestory.position.set(0, 12.55, -12.68); walkShell.add(clerestory);
      scene.add(walkShell);
      // Contact shadows are cached; no full-model SSAO geometry/depth pass is
      // rerun at every animation frame. SMAA keeps thin machine edges readable.
      // Restore the original 4x multisampled HDR render target alongside SMAA.
      // 2x 超采样 + 4x MSAA 已经覆盖抗锯齿；再叠一层 SMAA 会把细边二次柔化，
      // 所以只留 MSAA，并在输出末端补一级轻锐化把机械轮廓找回来。
      composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
      composer.addPass(new RenderPass(scene, camera));
      contact = new IndustrialContactPass(scene, camera); contact.kernelRadius = 0.45; contact.enabled = false; composer.addPass(contact);
      // 光污染收敛：只让真正的 HDR 高光（>1.0）轻微溢出，不再把钢带/灯带染成一团白。
      glow = new IndustrialGlowPass(); glow.strength = 0.26; glow.radius = 0.14; glow.threshold = 1.02; composer.addPass(glow);
      output = new OutputPass(); composer.addPass(output);
      sharpen = new ShaderPass({
        uniforms: { tDiffuse: { value: null }, texelSize: { value: new THREE.Vector2(1 / 2048, 1 / 1024) }, strength: { value: 0.22 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 texelSize; uniform float strength; varying vec2 vUv;
          void main(){
            vec4 center = texture2D(tDiffuse, vUv);
            vec4 blur = (texture2D(tDiffuse, vUv + vec2(texelSize.x, 0.0)) + texture2D(tDiffuse, vUv - vec2(texelSize.x, 0.0))
                      + texture2D(tDiffuse, vUv + vec2(0.0, texelSize.y)) + texture2D(tDiffuse, vUv - vec2(0.0, texelSize.y))) * 0.25;
            gl_FragColor = vec4(clamp(center.rgb + (center.rgb - blur.rgb) * strength, 0.0, 1.0), center.a);
          }`,
      });
      composer.addPass(sharpen);
      observer = new ResizeObserver(resize); observer.observe(element); resize();
      if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'scene-hover-tip';
        element.appendChild(tooltipEl);
      }
      down = (event) => {
        interruptCinematic();
        invalidate();
        if (walkActive) {
          lookDrag = { x: event.clientX, y: event.clientY, moved: 0 };
          try { renderer.domElement.setPointerCapture(event.pointerId); } catch { /* Pointer capture is optional. */ }
          return;
        }
        pointerDown = { x: event.clientX, y: event.clientY };
      };
      pointerMove = (event) => {
        if (walkActive) {
          if (!lookDrag) return;
          const dx = event.clientX - lookDrag.x, dy = event.clientY - lookDrag.y;
          lookDrag.moved += Math.abs(dx) + Math.abs(dy);
          lookDrag.x = event.clientX; lookDrag.y = event.clientY;
          walkLookYaw -= dx * 0.0012;
          walkLookPitch = THREE.MathUtils.clamp(walkLookPitch - dy * 0.0012, -1.1, 1.1);
          setInteraction(null);
          return;
        }
        hoverAtPoint(event.clientX, event.clientY);
      };
      pointerLeave = () => { if (!walkActive) clearHover(); };
      up = (event) => {
        if (walkActive) {
          const drag = lookDrag;
          lookDrag = null;
          if (drag && drag.moved < 6) openInteraction(pickAt(event.clientX, event.clientY));
          return;
        }
        if (!model || latest.current.focusMode !== 'line' || !pointerDown) return;
        const distance = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
        pointerDown = null;
        if (distance > 6) return;
        openInteraction(pickAt(event.clientX, event.clientY));
      };
      dblclick = (event) => {
        if (walkActive || !model || !renderer) return;
        const rect = renderer.domElement.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const descriptor = pickAt(event.clientX, event.clientY);
        let point = descriptor ? new THREE.Vector3(...descriptor.position) : null;
        if (!point) {
          const px = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
            -(event.clientY - rect.top) / rect.height * 2 + 1);
          pickRay.setFromCamera(px, camera);
          const hit = new THREE.Vector3();
          // 没有点到设备时，把球心落到地坪上。
          if (pickRay.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.14), hit)) point = hit;
        }
        if (!point) return;
        // 只移动旋转球心，保持当前观察距离和方向，画面不跳。
        const offset = camera.position.clone().sub(controls.target);
        controls.target.copy(point);
        camera.position.copy(point).add(offset);
        controls.update();
        writeTelemetry(); invalidate();
      };
      lost = (event) => {
        event.preventDefault();
        if (!alive) return;
        contextLost = true; restorationPending = false;
        cancelAnimationFrame(frame); frame = 0; lastTime = 0;
        element.dataset.contextLost = 'true';
        setStatus({ phase: 'error', message: '图形连接已中断，正在等待恢复；也可重新载入。' });
      };
      restored = () => {
        if (!alive) return;
        try {
          // Three restores its GL state before this listener. Regenerate the
          // application-owned PMREM image: an allocated target has no pixels
          // from before the loss. Keep geometry, view, selection and playback.
          const oldEnvironment = studio?.environment.texture;
          studio?.dispose();
          studio = createIndustrialStudio(renderer, scene);
          coils?.rebindEnvironment(oldEnvironment, studio.environment.texture);
          stage?.root.traverse(object => {
            for (const material of [].concat(object.material || [])) if (material.envMap === oldEnvironment) {
              material.envMap = studio.environment.texture; material.needsUpdate = true;
            }
          });
          model?.traverse(object => {
            if (!object.isMesh) return;
            for (const material of [].concat(object.material)) {
              if (material.envMap === oldEnvironment) {
                material.envMap = studio.environment.texture;
                material.needsUpdate = true;
              }
            }
          });
          renderer.shadowMap.needsUpdate = true;
          contact?.invalidateGeometry();
          lastTime = 0; contextLost = false; restorationPending = true;
          element.dataset.contextLost = 'false';
          element.dataset.contextRestores = String(Number(element.dataset.contextRestores || 0) + 1);
          setStatus({ phase: 'loading', percent: 100, message: '图形连接已恢复，正在重绘…' });
          fitCamera(camera.position.clone().sub(controls.target).normalize(),effectiveFocusedStand());
          latest.current.onSceneReady?.();
          invalidate();
        } catch {
          contextLost = true;
          setStatus({ phase: 'error', message: '图形恢复未完成，请重新载入。' });
        }
      };
      renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointerup', up);
      renderer.domElement.addEventListener('dblclick', dblclick);
      renderer.domElement.addEventListener('pointermove', pointerMove); renderer.domElement.addEventListener('pointerleave', pointerLeave);
      renderer.domElement.addEventListener('webglcontextlost', lost);
      renderer.domElement.addEventListener('webglcontextrestored', restored); document.addEventListener('visibilitychange', visibility);
      engine.current = { updateScene, setView, reset: () => setView(activeView), fitToViewport: resize,
        updateLighting() { studio?.setMode(latest.current.lighting); studio?.setDaypart(latest.current.daypart); lastTime = performance.now(); writeTelemetry(); invalidate(); },
        toggleScan() { return twinLayer?.toggleScan() || false; },
        clearInspection() { twinLayer?.clearInspection(); roamEnabled = false; invalidate(); },
        pauseRendering() { renderingPaused = true; cancelAnimationFrame(frame); frame = 0; return true; },
        resumeRendering() { renderingPaused = false; invalidate(); return true; },
        captureFrame() {
          if (!renderer || contextLost) return null;
          if (composer) composer.render(); else renderer.render(scene, camera);
          return renderer.domElement.toDataURL('image/jpeg', 0.84);
        },
        inspectAlert(stand = 'S5', onState) {
          const targetStand = STANDS.includes(stand) ? stand : 'S5';
          latest.current.onSelectStand?.(targetStand);
          twinLayer?.inspect(targetStand, () => onState?.({ stand: targetStand, status: 'arrived' }));
          if (coreBounds.has(targetStand)) {
            const center = coreBounds.get(targetStand).getCenter(new THREE.Vector3());
            const toTarget = new THREE.Vector3(center.x, 3.2, -0.5);
            cameraFlight = {
              from: camera.position.clone(), fromTarget: controls.target.clone(),
              to: toTarget.clone().add(new THREE.Vector3(8, 6, 13)), toTarget,
              start: performance.now(), duration: 1800, arc: 16,
            };
            element.dataset.cameraLevel = 'equipment';
            element.dataset.inspectionTarget = targetStand;
            roamEnabled = false;
          }
          invalidate();
          return Boolean(coreBounds.has(targetStand));
        },
        get ready() { return Boolean(model)&&!contextLost; },
        get sceneScope() { return activeScope; },
        get findingFocusedStand() { return findingFocusedStand; },
        clearFindingFocus,clearMeasurementFocus,
        // Data-only refresh: never re-run the scene/material/camera setup.
        // Stream rows only change labels, motion speed and telemetry.
        refreshProcess() { updateStandCards(latest.current); writeTelemetry(); updateWalkBoards(); invalidate(); },
        focusStand(stand){
          if(!model||contextLost||!STANDS.includes(stand)||!coreBounds.has(stand)||activeScope!==latest.current.focusMode)return false;
          if(!model.children.some(group=>group.visible&&group.userData.stand===stand))return false;
          clearMeasurementFocus();
          if(findingFocusedStand===stand&&findingHighlight)return true;
          clearFindingFocus();
          const bounds=coreBounds.get(stand).clone();
          findingHighlight=new THREE.Box3Helper(bounds.expandByScalar(.14),0x78c7de);
          findingHighlight.name='FindingAssociation';findingHighlight.material.depthTest=false;findingHighlight.material.transparent=true;findingHighlight.material.opacity=.75;findingHighlight.renderOrder=999;owned.add(findingHighlight);
          findingFocusedStand=stand;element.dataset.findingFocusedStand=stand;
          const center=bounds.getCenter(new THREE.Vector3());center.y=3;center.z=0;
          cameraFlight={from:camera.position.clone(),fromTarget:controls.target.clone(),to:center.clone().add(new THREE.Vector3(8.8,6.4,13.5)),toTarget:center,start:performance.now(),duration:1600,arc:16};
          element.dataset.cameraLevel='equipment';
          writeTelemetry();invalidate();return true;
        },
        focusMeasurement(stand,measurement) {
          if(!model||!coreBounds.has(stand))throw new Error('测点模型尚未就绪');
          clearFindingFocus();
          clearMeasurementHighlight();
          const top=rollers.find(roll=>roll.name===`${stand}_WorkRoll_Top`),bottom=rollers.find(roll=>roll.name===`${stand}_WorkRoll_Bottom`);
          const bounds=new THREE.Box3();
          if(top)bounds.expandByObject(top);if(bottom)bounds.expandByObject(bottom);
          const center=bounds.getCenter(new THREE.Vector3());
          if(['tension','frontTension','entryThickness','exitThickness','width','entrySetThickness'].includes(measurement)){
            const inlet=!['frontTension','exitThickness'].includes(measurement),x=center.x+(inlet?-1.5:1.5);
            bounds.set(new THREE.Vector3(x-.7,center.y-.13,-1.2),new THREE.Vector3(x+.7,center.y+.13,1.2));
          }
          if(bounds.isEmpty())bounds.copy(coreBounds.get(stand));
          measurementHighlight=new THREE.Box3Helper(bounds.expandByScalar(.08),0x65d4ff);
          measurementHighlight.material.depthTest=false;measurementHighlight.material.transparent=true;measurementHighlight.material.opacity=.95;measurementHighlight.renderOrder=1000;owned.add(measurementHighlight);
          measurementFocusedStand=stand;fitCamera(camera.position.clone().sub(controls.target).normalize(),stand);
          element.dataset.highlightedStand=stand;element.dataset.highlightedMeasurement=measurement;
          const objectName=['tension','frontTension','entryThickness','exitThickness','width','entrySetThickness'].includes(measurement)?'Steel_Strip':`${stand}_WorkRoll_Top`;
          element.dataset.highlightedObject=objectName;writeTelemetry();invalidate();
          return {stand,measurement,objectName};
        },
        zoom(direction) {
          if (!model) throw new Error('模型正在载入，请稍后再试');
          const offset = camera.position.clone().sub(controls.target);
          const length = THREE.MathUtils.clamp(offset.length() * (direction === 'in' ? 0.8 : 1.25), controls.minDistance, controls.maxDistance);
          camera.position.copy(controls.target).add(offset.setLength(length)); controls.update(); writeTelemetry(); invalidate();
        },
        // 把 OrbitControls 的旋转球心移到某个设备/地面点；相机位置不跳。
        setOrbitCenter(point) {
          if (walkActive || !point) return false;
          const pivot = new THREE.Vector3().fromArray(point);
          const offset = camera.position.clone().sub(controls.target);
          controls.target.copy(pivot);
          camera.position.copy(pivot).add(offset);
          controls.update(); writeTelemetry(); invalidate();
          return true;
        },
        // AI 派工：数字人走到指定机架，看平板 / 指向 / 点头。
        inspectStand(stand) {
          if (!factoryCharacter || contextLost || !STANDS.includes(stand)) return false;
          // 人工/AI 派工优先：暂停自动轮巡 20 秒，避免覆盖当前路径。
          patrolPausedUntil = performance.now() + 20000;
          const bounds = coreBounds.get(stand);
          const centerX = bounds ? bounds.getCenter(new THREE.Vector3()).x : 0;
          // 站到操作台侧前方的通道上，避免正对后门、让头/手与 HMI 重叠。
          const x = centerX - 1.5;
          factoryCharacter.walkTo(new THREE.Vector3(x, FLOOR_Y, ENGINEER_AISLE_Z), {
            onArrive: () => {
              respondToStand(stand);
              factoryCharacter.face(new THREE.Vector3(centerX, 2.6, 2.5));
              factoryCharacter.act([
                { name: 'LookTablet', hold: 2.0 },
                { name: 'Point', hold: 1.8 },
                { name: 'Nod', hold: 1.0 },
              ], () => invalidate());
              invalidate();
            },
          });
          element.dataset.engineerTarget = stand;
          invalidate();
          return true;
        },
        speak(text) {
          if (!factoryCharacter || !text) return Promise.resolve(false);
          // 行走中不要切 ACT，否则会中止巡检路径；待命时才点头。
          if (factoryCharacter.state === 'IDLE') factoryCharacter.act([{ name: 'Nod', hold: 1.4 }]);
          invalidate();
          return factoryCharacter.speak(text).finally(() => invalidate());
        },
        setWalkMode: on => setWalkMode(on),
        inspectObject(position) {
          if (!factoryCharacter) return false;
          const x = Number(position?.[0]) || 0, z = Number(position?.[2]) || 0;
          patrolPausedUntil = performance.now() + 20000;
          const targetX = z > 7 ? x - 1.5 : x;
          const targetZ = THREE.MathUtils.clamp(z + 2.2, 5.4, ENGINEER_AISLE_Z);
          factoryCharacter.walkTo(new THREE.Vector3(targetX, FLOOR_Y, targetZ), {
            onArrive: () => {
              factoryCharacter.face(new THREE.Vector3(x, 2.6, z));
              const point = new THREE.Vector3(x, 1.5, z);
              let assetTarget = null;
              for (const inst of factoryAssetGroup?.children || []) {
                if (!inst.userData?.interaction) continue;
                const box = new THREE.Box3().setFromObject(inst);
                if (!box.isEmpty() && box.distanceToPoint(point) < 2.4) { assetTarget = inst; break; }
              }
              if (assetTarget) {
                pulseEmissive(assetTarget);
                highlightInspection(new THREE.Box3().setFromObject(assetTarget), 0xffc857, 5000);
              }
              factoryCharacter.act([
                { name: 'LookTablet', hold: 2.0 },
                { name: 'Point', hold: 1.8 },
                { name: 'Nod', hold: 1.0 },
              ], () => invalidate());
              invalidate();
            },
          });
          invalidate();
          return true;
        },
        characterAct(name) {
          if (!factoryCharacter?.actions?.[name]) return false;
          factoryCharacter.act([{ name, hold: 2.2 }], () => invalidate());
          invalidate();
          return true;
        },
        characterHome() {
          if (!factoryCharacter) return false;
          patrolPausedUntil = 0;
          factoryCharacter.walkTo(new THREE.Vector3(20, FLOOR_Y, ENGINEER_AISLE_Z), {
            onArrive: () => factoryCharacter.face(new THREE.Vector3(21.5, 2.6, 11.0)),
          });
          invalidate();
          return true;
        },
        dispatchToStand(stand = 'S5') {
          if (!model || contextLost) return false;
          return dispatchToStand(String(stand).toUpperCase());
        },
      };
      if (latest.current.controlsRef) latest.current.controlsRef.current = engine.current;
      // 本机三维调试句柄（相机/数字人/引擎），便于验收朝向与交互，不发网络。
      window.__qcdkr3d = {
        scene, camera, controls, THREE,
        get character() { return factoryCharacter; },
        get engine() { return engine.current; },
      };
      element.dataset.mount = 'engine';
      lease = acquireModel((progress) => { if (alive && !contextLost) { element.dataset.mount = 'acquiring:' + progress.percent; setStatus({ phase: 'loading', ...progress }); } });
      lease.promise.then(async (template) => {
        if (!alive) return;
        instance = createModelInstance(template); model = instance.root;
        element.dataset.mount = 'model';
        finishes = prepareIndustrialMaterials(model, studio.environment.texture); scene.add(model);
        // 机架自带的前侧悬空走台（格栅 + 黄栏杆 + 支架）在远景里像一圈玩具围栏，
        // 参照视频里的厂没有这圈，整块隐藏；背景线副本构建时跳过不可见网格，同样不带。
        model.traverse((object) => {
          if (!object.isMesh) return;
          const names = [].concat(object.material || []).map((item) => item?.name || '');
          if (names.some((name) => /Safety_Yellow|Grating/i.test(name))) { object.visible = false; return; }
          const box = new THREE.Box3().setFromObject(object);
          if (!box.isEmpty() && box.min.z > 2.0 && box.max.y < 3.2 && box.min.y < 0.6) object.visible = false;
        });
        // 主线细节层：压下液压缸、前侧液压管路与桥架（顶部悬空平台已去掉）。
        millDetail = buildMillDetails(scene, { environment: studio.environment.texture });
        twinLayer = createFactoryTwinLayer(scene, { environment: studio.environment.texture });
        twinLayer.setSelected(latest.current.selectedStand);
        model.traverse((object) => {
          if (!object.isMesh) return;
          object.castShadow = true; object.receiveShadow = true;
          if (object.userData.rollName) {
            rollers.push(object);
            // A separate finish instance carries this physical roll's radius
            // and witness phase; source geometry/material cache stays immutable.
            const ownFinish = original => { const material = original.clone(); rollSurfaceMaterials.add(material); return material; };
            object.material = Array.isArray(object.material) ? object.material.map(ownFinish) : ownFinish(object.material);
          }
          if (object.userData.part === 'strip') stripMeshes.push(object);
          for (const material of [].concat(object.material)) {
            if (materialOriginals.has(material)) continue;
            materialOriginals.set(material, { opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite });
            refineIndustrialMaterial(material, object.userData);
            material.fog = false;
            if (object.userData.part === 'strip') installStripFlow(material, distance);
            if (object.userData.rollName) installRollSurface(material, {
              radius: object.userData.radius,
              phase: Number(object.userData.stand.slice(1)) * 0.61 + (/Backup/.test(object.name) ? 0.31 : /Intermediate/.test(object.name) ? 1.17 : 0),
            });
          }
        });
        model.updateMatrixWorld(true);
        const stripBounds = new THREE.Box3();
        stripMeshes.forEach((strip) => stripBounds.expandByObject(strip));
        for (const stand of STANDS) {
          const bounds = new THREE.Box3();
          rollers.filter((roll) => roll.userData.stand === stand).forEach((roll) => bounds.expandByObject(roll));
          if (!bounds.isEmpty()) coreBounds.set(stand, bounds);
          const top = rollers.find((roll) => roll.name === `${stand}_WorkRoll_Top`);
          const bottom = rollers.find((roll) => roll.name === `${stand}_WorkRoll_Bottom`);
          if (top && bottom) {
            const upstream = rollers.find((roll) => roll.name === `S${Number(stand.slice(1)) - 1}_WorkRoll_Top`);
            const inletX = upstream ? upstream.position.x : stripBounds.min.x;
            const stripEdgeZ = stripBounds.isEmpty() ? Infinity : stripBounds.max.z;
            const frameInlet = model.userData.sourceAnchors?.[`${stand}_Frame`]?.bounds?.min?.[0];
            const tensionX = Math.max(inletX + 0.15, Math.min(top.position.x - 0.35,
              Number.isFinite(frameInlet) ? frameInlet - 0.15 : top.position.x - 0.9));
            processAnchors.push({ stand, top, bottom, stripEdgeZ,
              tensionPosition: [tensionX, stripBounds.getCenter(new THREE.Vector3()).y, stripEdgeZ] });
          }
        }
        standLabels = STANDS.map((stand) => {
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'scene-stand-card' + (stand === 'S5' ? ' is-s5' : '');
          card.dataset.stand = stand;
          card.setAttribute('aria-label', `选择 ${stand} 机架`);
          // 数据牌直接锚在机架顶部：机架号 + 轧制力 + 来源说明，由 processData 驱动。
          card.innerHTML = `<span class="sc-head"><b>${stand}</b><i class="sc-dot"></i></span>`
            + `<span class="sc-value">—<span class="sc-unit">t</span></span>`
            + `<span class="sc-sub">轧制力</span>`;
          card.addEventListener('click', () => latest.current.onSelectStand?.(stand));
          element.appendChild(card);
          const bounds = coreBounds.get(stand);
          const position = bounds.getCenter(new THREE.Vector3());
          position.y = Math.max(bounds.max.y + 1.55, 6.85);
          return { stand, element: card, position,
            value: card.querySelector('.sc-value'), sub: card.querySelector('.sc-sub') };
        });
        const standAnchors = {};
        for (const stand of STANDS) {
          const bounds = coreBounds.get(stand);
          if (bounds) standAnchors[stand] = { x: bounds.getCenter(new THREE.Vector3()).x };
        }
        walkBoards = buildWalkBoards(standAnchors);
        updateWalkBoards();
        if (!contextLost) setStatus({ phase: 'loading', percent: 96, message: '布置厂房与产线设备…' });
        try {
          factoryFixtures = buildFixtures(scene, standAnchors, studio.environment.texture);
          // 程序化步进梁/鞍座/标牌龙门架统一落到 Blender 厂房地坪。
          factoryFixtures.group.position.y = -0.14;
          // 最后一批 JS 线体结构不再显示：轧机、产线设备、钢卷鞍座、厂房
          // 均已由 Blender 资产覆盖；动态数据牌属于 UI，不在此列。
          factoryFixtures.group.visible = false;
          // Blender 操作台替换程序化 fallback，和 factory-3d 原型保持同一套站位。
          for (const pulpit of Object.values(factoryFixtures.pulpits || {})) pulpit.visible = false;
          factoryAssetGroup = new THREE.Group();
          factoryAssetGroup.name = 'Factory_Blender_Assets';
          scene.add(factoryAssetGroup);
          const [pulpitResult, lineResult, characterResult] = await Promise.allSettled([
            // 2026-11-01 用户要求移除操作台柱子（pulpits_S*_mo.glb）；回滚：恢复 loadPulpits 调用
            Promise.resolve({ skipped: true }),
            loadLineAssets(factoryAssetGroup),
            // 2026-11-16 操作者口径：移除厂区“巡检技术员”3D 人偶；角色形象统一由开屏/桌宠的大肥鱼承担。
            Promise.resolve(null),
          ]);
          if (characterResult.status === 'fulfilled') factoryCharacter = characterResult.value;
          for (const result of [pulpitResult, lineResult, characterResult]) {
            if (result.status === 'rejected') console.warn('[factory] 资产载入失败', result.reason);
          }
          element.dataset.factoryAssets = [pulpitResult, lineResult, characterResult].every((result) => result.status === 'fulfilled') ? 'ready' : 'partial';
          element.dataset.character = factoryCharacter ? 'ready' : 'missing';
          // 单条冷轧主线：主电室/磨辊间留在传动侧与生产跨旁，不再推到厂区末端。
        } catch (error) {
          console.warn('[factory] 厂房资产不可用', error);
        }
        assetColliders = [];
        if (factoryAssetGroup) {
          for (const inst of factoryAssetGroup.children) {
            if (!inst.userData?.interaction) continue;
            const box = new THREE.Box3().setFromObject(inst);
            if (!box.isEmpty()) { box.expandByScalar(0.35); assetColliders.push(box); }
          }
        }
        // 数字人默认待命，不再自动巡游；只有点击设备、派工或 AI 指令
        // 才触发实体动作（走过去、看平板、指向、点头）与设备响应。
        if (!contextLost) setStatus({ phase: 'loading', percent: 99, message: '装配 Blender 厂房…' });
        try {
          factoryHall = await loadFactoryHall(scene);
          if (stage?.root) stage.root.visible = false;
          if (walkShell) walkShell.visible = false;
          // 程序化地贴与 Blender 厂房地贴重复：隐藏旧的程序化标牌。
          for (const name of ['Operator_Aisle_Prototype_Label', 'Strip_Flow_Label']) {
            const label = factoryFixtures?.group?.getObjectByName(name);
            if (label) label.visible = false;
          }
          // factoryDetails 的 Factory_Architectural_Details 是直接 scene.add 的，不在
          // stage.root 下，所以上面的 stage.root.visible=false 不会连带隐藏。它的
          // Operator_Aisle_Label（Canvas 地贴，宽 5.3m、z=6.15）与厂房自带
          // HALL_Floor_Text（“人行通道 / 保持畅通”，z≈6.2）几乎重叠但字距不同，
          // 低机位掠射角下会叠成“重影字”。隐藏前者，备料区/检修区位置不重叠所以保留。
          const architectural = scene.getObjectByName('Factory_Architectural_Details');
          const duplicateAisle = architectural?.getObjectByName('Operator_Aisle_Label');
          if (duplicateAisle) duplicateAisle.visible = false;
          factoryHall.setMode(walkActive ? 'walk' : 'overview');
          // 厂区扩建：复制主线几何 + 入口/出口工艺链 + 机架细节层，生成两条完整背景线；
          // 地坪、地台、后墙一并补齐（按材质合并控制 draw call）。
          factoryPlant = buildFactoryPlant(scene, {
            environment: studio.environment.texture,
            millSource: model,
            lineAssets: factoryAssetGroup,
            detailSource: millDetail?.root,
          });
        } catch (error) {
          element.dataset.hallError = String(error?.message || error);
          console.warn('[hall] Blender 厂房载入失败，保留程序化舞台', error);
        }
        updateScene(); setView(latest.current.view);
        // 首帧布局（HUD 留白 / 容器尺寸）可能晚一帧才稳定；资产全部就绪后
        // 再取景一次，避免整条产线停在推远或过近的相机上。
        // （进场运镜期间不重取景，否则会把镜头硬切回机位。）
        requestAnimationFrame(() => { if (alive && !walkActive && !intro) setView(latest.current.view); });
        if (!contextLost) setStatus({ phase: 'ready', message: '' });
        // 进场运镜（对标机房片动态片头）：每个浏览器会话只播一次
        // （?intro=1 强制重播），之后切页回来直接落位，不再劫持相机。
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const introSeen = sessionStorage.getItem('qcdkr_intro_seen') === '1';
        const introForced = new URLSearchParams(location.search).get('intro') === '1';
        if (!contextLost && !walkActive && !intro && !reduceMotion && (!introSeen || introForced)) {
          sessionStorage.setItem('qcdkr_intro_seen', '1');
          const endPosition = camera.position.clone(), endTarget = controls.target.clone();
          intro = playCinematicIntro({ camera, controls, endPosition, endTarget,
            onDone: () => { intro = null; roamEnabled = true; roamPhase = 0; },
            onInterrupt: () => { intro = null; roamEnabled = false; } });
        }
      }).catch((error) => { if (alive) setStatus({ phase: 'error', message: `模型载入失败：${error.message || '请检查本地资源'}` }); });
    } catch (error) { setStatus({ phase: 'error', message: '三维显示未就绪，请重新载入。' }); }

    return () => {
      try { if (renderer && !contextLost) { if (composer) composer.render(); else renderer.render(scene, camera); lastSceneFrame = renderer.domElement.toDataURL('image/jpeg', 0.55); } } catch { /* 快照失败则退回通用预览图 */ }
      alive = false; cancelAnimationFrame(frame); cancelAnimationFrame(restoreFrame); observer?.disconnect(); lease?.release();
      clearTimeout(anchorTimer); clearTimeout(patrolTimer);
      clearInspectionHighlight();
      renderer?.domElement.removeEventListener('pointerdown', down); renderer?.domElement.removeEventListener('pointerup', up);
      renderer?.domElement.removeEventListener('dblclick', dblclick);
      renderer?.domElement.removeEventListener('pointermove', pointerMove); renderer?.domElement.removeEventListener('pointerleave', pointerLeave);
      window.removeEventListener('keydown', walkKeyDown); window.removeEventListener('keyup', walkKeyUp);
      window.removeEventListener('keydown', camKeyDown); window.removeEventListener('keyup', camKeyUp);
      tooltipEl?.remove();
      renderer?.domElement.removeEventListener('webglcontextlost', lost);
      renderer?.domElement.removeEventListener('webglcontextrestored', restored); document.removeEventListener('visibilitychange', visibility);
      controls?.dispose();
      if (latest.current.controlsRef?.current === engine.current) latest.current.controlsRef.current = null;
      if (window.__qcdkr3d?.engine === engine.current) delete window.__qcdkr3d;
      engine.current = null;
      standLabels.forEach((label) => label.element.remove());
      if (model) scene.remove(model);
      // 厂房/操作台/数字人使用模块级 GLB 缓存，这里只脱离场景，不释放共享几何与材质。
      if (factoryCharacter) scene.remove(factoryCharacter.group);
      if (intro) { intro.cancel(); intro = null; }
      if (factoryAssetGroup) scene.remove(factoryAssetGroup);
      if (factoryFixtures) { scene.remove(factoryFixtures.group); disposeObject(factoryFixtures.group); }
      if (walkShell) { scene.remove(walkShell); walkShell.traverse(object => { if (object.geometry) object.geometry.dispose(); for (const material of [].concat(object.material || [])) material.dispose(); }); walkShell = null; }
      if (walkBoards) { scene.remove(walkBoards.group); walkBoards.boards.forEach(board => { board.texture.dispose(); board.sprite.material.dispose(); }); walkBoards = null; }
      factoryHall?.dispose(); factoryHall = null;
      factoryPlant?.dispose(); factoryPlant = null;
      twinLayer?.dispose(); twinLayer = null;
      millDetail?.dispose(); millDetail = null;
      finishes?.dispose(); instance?.dispose(); rollSurfaceMaterials.forEach(material => material.dispose()); coils?.dispose(); disposeObject(owned); contact?.dispose(); glow?.dispose(); antiAlias?.dispose(); output?.dispose(); sharpen?.dispose(); composer?.dispose(); studio?.dispose(); stage?.dispose();
      renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove();
    };
  }, [retry]);

  useEffect(() => { engine.current?.updateScene(); }, [selectedStand, showStrip, explode, focusMode, shellMode, motionPlaying]);
  useEffect(() => { engine.current?.refreshProcess(); }, [processSpeed, processData]);
  useEffect(() => { engine.current?.setView(view); }, [view, cameraReset]);
  useEffect(() => { engine.current?.updateLighting(); }, [lighting]);
  useEffect(() => { engine.current?.setDaypart?.(daypart); }, [daypart]);
  useEffect(() => { engine.current?.fitToViewport(); }, [expanded, Boolean(annotationInsets), annotationInsets?.top, annotationInsets?.bottom, annotationInsets?.left, annotationInsets?.right]);
  useEffect(() => { engine.current?.setWalkMode?.(walkMode); if (!walkMode) setHoverInfo(null); }, [walkMode]);

  return <div className={`three-viewer ${compact ? 'is-compact' : ''}`} data-phase={status.phase} data-focus-mode={focusMode}
    data-shell-mode={shellMode} data-motion-playing={motionPlaying} data-process-speed={processSpeed}
    style={{ position: 'relative', width: '100%', height: '100%', minHeight: compact ? 260 : 0, overflow: 'hidden', background: '#182731' }}>
    <div ref={host} className="three-host" style={{ position: 'absolute', inset: 0 }} />
    {status.phase !== 'ready' && <div style={{ position: 'absolute', inset: 0, zIndex: 3, background: lastSceneFrame ? `#0c1723 center/cover no-repeat url(${lastSceneFrame})` : '#0c1723' }}>
      {!lastSceneFrame && <img src="/assets/factory-preview.png" alt="轧制设备预览" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.25 }} />}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(0deg,#18212ce8,transparent 90%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: '#c5d7e0', fontSize: 12 }} role="status" aria-live="polite">
        <span>{status.message}</span>
        {status.phase === 'loading' ? <div style={{ width: 150, height: 3, background: '#35424c', borderRadius: 3, overflow: 'hidden' }}><div style={{ width: `${status.percent}%`, height: '100%', background: '#69bfca', transition: 'width .2s' }} /></div>
          : <button style={baseButton} onClick={() => setRetry((value) => value + 1)}>重新载入</button>}
      </div>
    </div>}
    {!walkMode && <button className="scene-reset" aria-label="复位三维视角" onClick={() => onResetCamera ? onResetCamera() : engine.current?.reset()} disabled={status.phase !== 'ready'}
      style={{ ...baseButton, position: 'absolute', right: 18, bottom: 92, zIndex: 2 }} title="复位三维视角">↺</button>}
    {interaction && (() => {
      const standData = interaction.stand ? processData?.stands?.find(stand => stand.id === interaction.stand) : null;
      const kindLabel = { stand: '机架', pulpit: '操作台', asset: '设备', character: '数字人' }[interaction.kind] || '设备';
      const pageLabel = { data: '数据接入', maintenance: '系统状态', logs: '运行日志', communication: '设备连接', overview: '预测工作台' }[interaction.page] || '页面';
      const value = (raw, digits = 1) => Number.isFinite(Number(raw)) ? Number(raw).toFixed(digits) : '—';
      const s1 = processData?.stands?.[0], s4 = processData?.stands?.[3], s5 = processData?.stands?.[4];
      const assetMetrics = interaction.kind === 'asset' ? ({
        coil: [['带钢宽度', `${value(processData?.width, 0)} mm`], ['入口厚度', `${value(s1?.entryThickness, 3)} mm`]],
        uncoiler: [['入口厚度', `${value(s1?.entryThickness, 3)} mm`], ['入口速度', `${value(s1?.speed, 0)} m/min`]],
        shear_welder: [['入口厚度', `${value(s1?.entryThickness, 3)} mm`], ['入口速度', `${value(s1?.speed, 0)} m/min`]],
        disc_shear: [['S4 出口厚度', `${value(s4?.exitThickness, 3)} mm`], ['S5 速度', `${value(s5?.speed, 0)} m/min`]],
        tension_reel: [['S5 速度', `${value(s5?.speed, 0)} m/min`], ['S5 后张力', `${value(s5?.tension)} t`]],
        bundler: [['S5 出口厚度', `${value(s5?.exitThickness, 3)} mm`], ['S5 速度', `${value(s5?.speed, 0)} m/min`]],
        control_room: [['S5 速度', `${value(s5?.speed, 0)} m/min`], ['S5 弯辊力', `${value(s5?.bendingForce)} kN`]],
        emulsion_station: [['S5 速度', `${value(s5?.speed, 0)} m/min`], ['S5 后张力', `${value(s5?.tension)} t`]],
        roll_cart: [['换辊状态', '待命'], ['工作辊', '在线']],
        tool_cabinet: [['检修状态', '可用'], ['工具', '就绪']],
        main_drive_room: [['主传动', '运行'], ['S5 速度', `${value(s5?.speed, 0)} m/min`]],
        roll_shop: [['磨辊状态', '待命'], ['轧辊', '在库']],
      }[interaction.key] || []) : [];
      return <div className="scene-interaction-card" role="dialog" aria-label={interaction.label}>
        <header><span className={`scene-interaction-kind is-${interaction.kind}`}>{kindLabel}</span><strong>{interaction.label}</strong>{standData && <em className={'scene-interaction-state ' + (Number(standData.speed) > 0 ? 'is-running' : 'is-idle')}>{Number(standData.speed) > 0 ? '轧制中' : '待机'}</em>}<button type="button" aria-label="关闭3D信息卡" onClick={() => setInteraction(null)}>×</button></header>
        {standData ? <>
          <dl>
            <div><dt>轧制力</dt><dd>{value(standData.force)} <small>t</small></dd></div>
            <div><dt>后张力</dt><dd>{value(standData.tension)} <small>t</small></dd></div>
            <div><dt>轧制速度</dt><dd>{value(standData.speed, 0)} <small>m/min</small></dd></div>
            <div><dt>入口厚度</dt><dd>{value(standData.entryThickness, 3)} <small>mm</small></dd></div>
            <div><dt>出口厚度</dt><dd>{value(standData.exitThickness, 3)} <small>mm</small></dd></div>
            <div><dt>弯辊力</dt><dd>{value(standData.bendingForce)} <small>kN</small></dd></div>
          </dl>
          <div className="scene-interaction-load" aria-label={'轧制负荷 ' + Math.round(Math.min(100, Math.max(0, Number(standData.force) / 12))) + '%'}><span>轧制负荷</span><i style={{ width: Math.min(100, Math.max(0, Number(standData.force) / 12)) + '%' }}/><b>{Math.round(Math.min(100, Math.max(0, Number(standData.force) / 12)))}%</b></div>
        </> : <>
          <p>{interaction.desc || '3D 场景中的可交互对象。'}</p>
          {assetMetrics.length > 0 && <dl>{assetMetrics.map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}</dl>}
        </>}
        <div className="scene-interaction-actions">
          {(interaction.stand || interaction.kind === 'asset' || interaction.kind === 'pulpit') && <button type="button" onClick={() => engine.current?.setOrbitCenter?.(interaction.position)}>设为中心</button>}
          {interaction.stand && <button type="button" onClick={() => engine.current?.inspectStand?.(interaction.stand)}>派工程师巡检</button>}
          {interaction.kind === 'asset' && <button type="button" onClick={() => engine.current?.inspectObject?.(interaction.position)}>派工程师查看</button>}
          {interaction.kind === 'character' && <><button type="button" onClick={() => engine.current?.characterAct?.('Wave')}>打招呼</button><button type="button" onClick={() => engine.current?.characterHome?.()}>回到中控</button></>}
          {interaction.page && <button type="button" onClick={() => onNavigate?.(interaction.page)}>打开{pageLabel}</button>}
          {interaction.kind !== 'character' && <button type="button" onClick={() => onNavigate?.('logs')}>查看运行日志</button>}
          <button type="button" onClick={() => setInteraction(null)}>关闭</button>
        </div>
      </div>;
    })()}
    <TwinHud hostRef={host} processData={processData} selected={selectedStand}
      onSelect={onSelectStand}
      onInspect={(stand, callback) => engine.current?.inspectAlert?.(stand, callback)}
      onFocus={(stand, measurement) => {
        onSelectStand?.(stand);
        if (measurement) engine.current?.focusMeasurement?.(stand, measurement);
        else engine.current?.focusStand?.(stand);
      }} />
    {walkMode && <>
      <div className={`scene-crosshair${hoverInfo ? ' is-target' : ''}`} aria-hidden="true"/>
      <div className="scene-walk-hint">WASD 移动 · Shift 加速 · 拖动环视 · 点击/E 交互 · Esc 退出</div>
      {hoverInfo && <div className="scene-walk-prompt">[E] {hoverInfo.label}</div>}
      <button type="button" className="scene-walk-exit" onClick={onExitWalk}>退出巡视</button>
    </>}
  </div>;
}
