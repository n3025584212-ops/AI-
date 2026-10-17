import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { acquireModel, createModelInstance, disposeObject } from './threeModel';

// Last rendered frame of the previous mount. Re-entering the workspace shows
// it under the loading overlay, so the WebGL re-init never reads as a black
// screen; it is refreshed on every unmount.
let lastSceneFrame = null;
import { createIndustrialStudio } from './industrialStudio';
import { createIndustrialStage } from './industrialStage';
import { createIndustrialCoils } from './industrialCoils';
import { installStripFlow, installRollSurface } from './industrialMotion.js';
import { IndustrialContactPass } from './IndustrialContactPass';
import { refineIndustrialMaterial, prepareIndustrialMaterials } from './industrialMaterials';
import { IndustrialGlowPass } from './IndustrialGlowPass';
import { annotationViewport, fitProjectedBounds, isProcessGroupVisible, isRollingCore, normalizedScreenPoint, rollRotationStep, visualTransportStep, workRollNipPosition } from './threeProcess';

const STANDS = ['S1', 'S2', 'S3', 'S4', 'S5'];
const baseButton = { border: '1px solid #42617480', background: '#11232cc9', color: '#b9cad4', borderRadius: 7, padding: '6px 9px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' };

export default function ThreeViewer({ selectedStand = 'S5', onSelectStand, view = 'perspective', showStrip = true,
  explode = false, compact = false, expanded = false, focusMode = 'line', shellMode = 'solid',
  motionPlaying = true, processSpeed = 0, cameraReset = 0, processData, onTelemetry, onAnchorsChange, hasDataOverlay = true, annotationInsets, controlsRef, onResetCamera, onSceneReady }) {
  const host = useRef(null), engine = useRef(null), latest = useRef(null);
  latest.current = { selectedStand, onSelectStand, view, showStrip, explode, compact, expanded, focusMode, shellMode, motionPlaying, processSpeed, processData, onTelemetry, onAnchorsChange, hasDataOverlay, annotationInsets, controlsRef, onSceneReady };
  const [status, setStatus] = useState({ phase: 'loading', percent: 0, message: '载入设备模型…' });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const element = host.current;
    let alive = true, contextLost = false, restorationPending = false, renderer, controls, observer, frame = 0, lease, studio, stage, coils, model, instance, composer, contact, glow, finishes, antiAlias, output;
    let activeView = latest.current.view, activeScope = latest.current.focusMode, measurementFocusedStand = null, findingFocusedStand = null;
    let wasExpanded = latest.current.expanded, savedCamera = null, lastTime = 0, renderCount = 0;
    let viewportKey = '', viewportWidth = 0, viewportHeight = 0, restoreFrame = 0, pendingRestore = null;
    let rollers = [], stripMeshes = [], standLabels = [], processAnchors = [], lastTelemetry = 0, lastAnchors = -Infinity, anchorTimer = null, pointerDown = null;
    let lastAnchorSignature = '', lastAnchorCallback = null;
    let lastFramingKey = '', lastGeometryKey = '';
    const distance = { value: 0 }, materialOriginals = new Map(), rollSurfaceMaterials = new Set();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0c1723');
    scene.fog = new THREE.Fog('#0c1723', 52, 150);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.2, 240);
    const owned = new THREE.Group(); scene.add(owned);
    const coreBounds = new Map();
    let measurementHighlight=null,findingHighlight=null;
    const effectiveFocusedStand=()=>findingFocusedStand||measurementFocusedStand||null;
    const s5StripRange = [6.65, 14.15];
    const clippingPlanes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), -s5StripRange[0]), new THREE.Plane(new THREE.Vector3(-1, 0, 0), s5StripRange[1])];

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
      if (coils) element.dataset.coilJoints = JSON.stringify(coils.joints);
      element.dataset.visibleCoils = coils?.root.visible ? '2' : '0';
      if (contact) element.dataset.contactRebuilds = String(contact.rebuildCount);
      if (now - lastTelemetry >= 250) {
        lastTelemetry = now;
        latest.current.onTelemetry?.({ distance: distance.value, camera: camera.position.toArray(), target: controls.target.toArray(), moving: moving() });
      }
    }
    function projectStandLabels() {
      const width = element.clientWidth, height = element.clientHeight;
      camera.updateMatrixWorld();
      for (const label of standLabels) {
        const point = label.position.clone().project(camera);
        label.element.hidden = latest.current.focusMode !== 'line' || point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1;
        // Global button display rules can override the UA [hidden] rule.
        label.element.style.display = label.element.hidden ? 'none' : 'block';
        label.element.style.transform = `translate(-50%, -50%) translate(${(point.x + 1) * width / 2}px, ${(1 - point.y) * height / 2}px)`;
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
      if (!alive || !renderer || contextLost || renderer.getContext().isContextLost()) return;
      const animate = moving();
      if (animate && lastTime && now - lastTime < 1000 / 30) { invalidate(); return; }
      const elapsed = lastTime ? (now - lastTime) / 1000 : 0;
      lastTime = now;
      if (animate) {
        const transport = visualTransportStep(elapsed, standSpeed('S5'));
        distance.value += transport; coils?.advance(transport);
        for (const roll of rollers) {
          if (!roll.parent.visible) continue;
          const step = visualTransportStep(elapsed, standSpeed(roll.userData.stand));
          roll.rotation.z += rollRotationStep(step, roll.userData.radius, roll.name);
        }
      }
      stage?.updateCamera(camera);
      if (stage) element.dataset.hallBackdropVisible = String(stage.backdrop.visible);
      if (composer) composer.render(); else renderer.render(scene, camera);
      renderCount++;
      if (restorationPending && model) { restorationPending = false; setStatus({ phase: 'ready', message: '' }); }
      writeTelemetry(now); projectStandLabels(); projectProcessAnchors(now);
      if (animate) invalidate();
    }
    function invalidate() { if (alive && !contextLost && !frame) frame = requestAnimationFrame(render); }

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
      if (!controls) return;
      const viewport = applyProjectionInsets();
      const points = [];
      const addCorners = (bounds, matrix) => {
        for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
          const point = new THREE.Vector3(x, y, z);
          if (matrix) point.applyMatrix4(matrix);
          points.push(point);
        }
      };
      const selected = latest.current.focusMode === 's5' ? 'S5' : explicitStand;
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
            const stripFocus=Number.isFinite(focusX)?[focusX-2.8,focusX+2.8]:s5StripRange;
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
        }
        target = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
      } else {
        target = new THREE.Vector3(10.4, 3, 0);
        addCorners(new THREE.Box3(target.clone().addScalar(-4), target.clone().addScalar(4)));
      }
      if (!points.length) return;
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
      const up = new THREE.Vector3().crossVectors(direction, right).normalize();
      const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const width = element.clientWidth, height = element.clientHeight;
      const sideReserve = !latest.current.compact && latest.current.hasDataOverlay ? (width >= 1100 ? 490 : width >= 850 ? 385 : 60) : 44;
      const slopeX = viewport ? tanY * camera.aspect * viewport.fractionX
        : tanY * Math.max(camera.aspect, 0.3) * Math.max(0.36, 1 - sideReserve / Math.max(width, 1));
      const slopeY = viewport ? tanY * viewport.fractionY : tanY * Math.max(0.60, 1 - 85 / Math.max(height, 260));
      let fitDistance = 1;
      for (const point of points) {
        const relative = point.clone().sub(target), depth = relative.dot(direction);
        fitDistance = Math.max(fitDistance, Math.abs(relative.dot(right)) / slopeX + depth,
          Math.abs(relative.dot(up)) / slopeY + depth, depth + camera.near + 1);
      }
      if ((!selected || viewport) && model) {
        const fit = fitProjectedBounds(points.map((point) => [point.dot(right), point.dot(up), point.dot(direction)]), slopeX, slopeY, camera.near);
        target.set(0, 0, 0).addScaledVector(right, fit.x).addScaledVector(up, fit.y).addScaledVector(direction, fit.z);
        fitDistance = fit.depth - fit.z;
      }
      controls.maxDistance = Math.max(110, fitDistance * 1.4);
      camera.far = Math.max(220, fitDistance * 2 + 50); camera.updateProjectionMatrix();
      camera.position.copy(target).addScaledVector(direction, fitDistance);
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
      activeView = ['perspective', 'front', 'top', 'drive'].includes(nextView) ? nextView : 'perspective';
      measurementFocusedStand = null;
      const direction = {
        // From the operator side the process reads left-to-right (S1 → S5),
        // with enough elevation to see the moving strip between each nip.
        perspective: latest.current.focusMode === 'line' ? new THREE.Vector3(0.95, 0.85, 2.8) : new THREE.Vector3(0.72, 0.48, 1.4),
        front: new THREE.Vector3(0, 0.13, 1.6),
        top: new THREE.Vector3(0, 1.8, 0.001),
        drive: new THREE.Vector3(-0.65, 0.55, -1.3),
      }[activeView].normalize();
      fitCamera(direction,findingFocusedStand);
    }
    function updateScene() {
      if (!model) return;
      const props = latest.current, scopeChanged = props.focusMode !== activeScope;
      activeScope = props.focusMode;
      if(findingFocusedStand&&props.focusMode==='s5'&&findingFocusedStand!=='S5')clearFindingFocus();
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
        if (props.explode && stand === (props.focusMode === 's5' ? 'S5' : props.selectedStand)) {
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
        material.clippingPlanes = props.focusMode === 's5' ? clippingPlanes : null;
      }
      model.updateMatrixWorld(true);
      element.dataset.visibleRolls = String(rollers.filter((roll) => roll.parent.visible).length);
      element.dataset.visibleStands = STANDS.filter((stand) => model.children.some((group) => group.visible && group.userData.stand === stand)).join(',');
      element.dataset.shellOpacity = props.shellMode === 'solid' ? '1' : props.shellMode === 'transparent' ? '0.1' : '0';
      element.dataset.stripRange = JSON.stringify(props.focusMode === 's5' ? s5StripRange : [-15.55, 15.55]);
      projectStandLabels();
      const framingKey = [props.focusMode, props.shellMode, props.explode, props.selectedStand].join('/');
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
      const sizeChanged = width !== viewportWidth || height !== viewportHeight;
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
        renderer.setSize(width, height, false);
        composer?.setSize(width, height);
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
      else if (expandedChanged || sizeChanged || findingFocusedStand) {
        fitCamera(camera.position.clone().sub(controls.target).normalize(), effectiveFocusedStand());
      }
      writeTelemetry(); invalidate();
    }
    function resize() { syncViewport(); }
    const visibility = () => { lastTime = performance.now(); invalidate(); };
    let down, up, lost, restored;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = 1.0;
      renderer.localClippingEnabled = true;
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap;
      renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
      renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
      renderer.domElement.setAttribute('aria-label', 'S1至S5五机架轧制设备三维场景，可拖动旋转、滚轮缩放');
      element.appendChild(renderer.domElement);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false; controls.minDistance = 4; controls.maxDistance = 110;
      controls.maxPolarAngle = Math.PI * 0.49; controls.addEventListener('change', invalidate);
      studio = createIndustrialStudio(renderer, scene);
      stage = createIndustrialStage(scene);
      // Contact shadows are cached; no full-model SSAO geometry/depth pass is
      // rerun at every animation frame. SMAA keeps thin machine edges readable.
      composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
      composer.addPass(new RenderPass(scene, camera));
      contact = new IndustrialContactPass(scene, camera); contact.kernelRadius = 0.78; contact.enabled = false; composer.addPass(contact);
      glow = new IndustrialGlowPass(); glow.strength = 0.1; glow.threshold = 2.2; composer.addPass(glow);
      antiAlias = new SMAAPass(); composer.addPass(antiAlias);
      output = new OutputPass(); composer.addPass(output);
      observer = new ResizeObserver(resize); observer.observe(element); resize();
      down = (event) => { pointerDown = { x: event.clientX, y: event.clientY }; };
      up = (event) => {
        if (!model || latest.current.focusMode !== 'line' || !pointerDown || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 6) return;
        const rect = renderer.domElement.getBoundingClientRect();
        const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
        const ray = new THREE.Raycaster(); ray.setFromCamera(pointer, camera);
        const hit = ray.intersectObjects(model.children, true).find((item) => item.object.parent.visible && STANDS.includes(item.object.userData.stand));
        if (hit) latest.current.onSelectStand?.(hit.object.userData.stand);
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
      renderer.domElement.addEventListener('webglcontextlost', lost);
      renderer.domElement.addEventListener('webglcontextrestored', restored); document.addEventListener('visibilitychange', visibility);
      engine.current = { updateScene, setView, reset: () => setView(activeView), fitToViewport: resize,
        get ready() { return Boolean(model)&&!contextLost; },
        get sceneScope() { return activeScope; },
        get findingFocusedStand() { return findingFocusedStand; },
        clearFindingFocus,clearMeasurementFocus,
        focusStand(stand){
          if(!model||contextLost||!STANDS.includes(stand)||!coreBounds.has(stand)||activeScope!==latest.current.focusMode||(activeScope==='s5'&&stand!=='S5'))return false;
          if(!model.children.some(group=>group.visible&&group.userData.stand===stand))return false;
          clearMeasurementFocus();
          if(findingFocusedStand===stand&&findingHighlight)return true;
          clearFindingFocus();
          const bounds=coreBounds.get(stand).clone();
          findingHighlight=new THREE.Box3Helper(bounds.expandByScalar(.14),0x78c7de);
          findingHighlight.name='FindingAssociation';findingHighlight.material.depthTest=false;findingHighlight.material.transparent=true;findingHighlight.material.opacity=.75;findingHighlight.renderOrder=999;owned.add(findingHighlight);
          findingFocusedStand=stand;element.dataset.findingFocusedStand=stand;
          fitCamera(camera.position.clone().sub(controls.target).normalize(),stand);writeTelemetry();invalidate();return true;
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
      };
      if (latest.current.controlsRef) latest.current.controlsRef.current = engine.current;
      lease = acquireModel((progress) => { if (alive && !contextLost) setStatus({ phase: 'loading', ...progress }); });
      lease.promise.then((template) => {
        if (!alive) return;
        instance = createModelInstance(template); model = instance.root;
        finishes = prepareIndustrialMaterials(model, studio.environment.texture); scene.add(model);
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
        if (!stripBounds.isEmpty()) coils = createIndustrialCoils(scene, stripBounds, studio.environment.texture, distance);
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
          const button = document.createElement('button');
          button.type = 'button'; button.textContent = stand; button.className = 'scene-stand-id';
          button.dataset.stand = stand; button.setAttribute('aria-label', `选择 ${stand} 机架`);
          button.style.cssText = `position:absolute;left:0;top:0;z-index:2;padding:3px 6px;border-radius:4px;pointer-events:auto;cursor:pointer;font:600 10px Inter,Segoe UI,sans-serif;letter-spacing:.3px;border:1px solid ${stand === 'S5' ? '#8de0cca0' : '#8eabb85c'};background:${stand === 'S5' ? '#214c50ee' : '#20303bcc'};color:${stand === 'S5' ? '#c8fff0' : '#d0dce3'};box-shadow:none;`;
          button.addEventListener('click', () => latest.current.onSelectStand?.(stand));
          element.appendChild(button);
          const bounds = coreBounds.get(stand);
          const position = bounds.getCenter(new THREE.Vector3());
          position.y = bounds.max.y + 1.25;
          return { stand, element: button, position };
        });
        updateScene(); setView(latest.current.view);
        if (!contextLost) setStatus({ phase: 'ready', message: '' });
      }).catch((error) => { if (alive) setStatus({ phase: 'error', message: `模型载入失败：${error.message || '请检查本地资源'}` }); });
    } catch (error) { setStatus({ phase: 'error', message: '三维显示未就绪，请重新载入。' }); }

    return () => {
      try { if (renderer && !contextLost) { if (composer) composer.render(); else renderer.render(scene, camera); lastSceneFrame = renderer.domElement.toDataURL('image/jpeg', 0.55); } } catch { /* 快照失败则退回通用预览图 */ }
      alive = false; cancelAnimationFrame(frame); cancelAnimationFrame(restoreFrame); observer?.disconnect(); lease?.release();
      clearTimeout(anchorTimer);
      renderer?.domElement.removeEventListener('pointerdown', down); renderer?.domElement.removeEventListener('pointerup', up);
      renderer?.domElement.removeEventListener('webglcontextlost', lost);
      renderer?.domElement.removeEventListener('webglcontextrestored', restored); document.removeEventListener('visibilitychange', visibility);
      controls?.dispose();
      if (latest.current.controlsRef?.current === engine.current) latest.current.controlsRef.current = null;
      engine.current = null;
      standLabels.forEach((label) => label.element.remove());
      if (model) scene.remove(model);
      finishes?.dispose(); instance?.dispose(); rollSurfaceMaterials.forEach(material => material.dispose()); coils?.dispose(); disposeObject(owned); contact?.dispose(); glow?.dispose(); antiAlias?.dispose(); output?.dispose(); composer?.dispose(); studio?.dispose(); stage?.dispose();
      renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove();
    };
  }, [retry]);

  useEffect(() => { engine.current?.updateScene(); }, [selectedStand, showStrip, explode, focusMode, shellMode, motionPlaying, processSpeed, processData]);
  useEffect(() => { engine.current?.setView(view); }, [view, cameraReset]);
  useEffect(() => { engine.current?.fitToViewport(); }, [expanded, Boolean(annotationInsets), annotationInsets?.top, annotationInsets?.bottom, annotationInsets?.left, annotationInsets?.right]);

  return <div className={`three-viewer ${compact ? 'is-compact' : ''}`} data-phase={status.phase} data-focus-mode={focusMode}
    data-shell-mode={shellMode} data-motion-playing={motionPlaying} data-process-speed={processSpeed}
    style={{ position: 'relative', width: '100%', height: '100%', minHeight: compact ? 260 : 390, overflow: 'hidden', background: '#0c1723' }}>
    <div ref={host} className="three-host" style={{ position: 'absolute', inset: 0 }} />
    {status.phase !== 'ready' && <div style={{ position: 'absolute', inset: 0, zIndex: 3, background: lastSceneFrame ? `#0c1723 center/cover no-repeat url(${lastSceneFrame})` : '#0c1723' }}>
      {!lastSceneFrame && <img src="/assets/line-preview.png" alt="轧制设备预览" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.25 }} />}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(0deg,#18212ce8,transparent 90%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: '#c5d7e0', fontSize: 12 }} role="status" aria-live="polite">
        <span>{status.message}</span>
        {status.phase === 'loading' ? <div style={{ width: 150, height: 3, background: '#35424c', borderRadius: 3, overflow: 'hidden' }}><div style={{ width: `${status.percent}%`, height: '100%', background: '#69bfca', transition: 'width .2s' }} /></div>
          : <button style={baseButton} onClick={() => setRetry((value) => value + 1)}>重新载入</button>}
      </div>
    </div>}
    <button className="scene-reset" aria-label="复位三维视角" onClick={() => onResetCamera ? onResetCamera() : engine.current?.reset()} disabled={status.phase !== 'ready'}
      style={{ ...baseButton, position: 'absolute', right: 18, bottom: 92, zIndex: 2 }} title="复位三维视角">↺</button>
  </div>;
}
