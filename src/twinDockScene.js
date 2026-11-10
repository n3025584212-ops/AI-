import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { acquireModel, createModelInstance } from './threeModel.js';
import { prepareIndustrialMaterials } from './industrialMaterials.js';
import { loadPulpits } from './factoryPulpits.js';
import { Character } from './factoryCharacter.js';

const STANDS = ['S1', 'S2', 'S3', 'S4', 'S5'];

// 跨页 3D 孪生面板的独立轻量场景。
// 不进入 React 的 ThreeViewer 生命周期，避免切页时第二个 WebGL 场景的被动
// effect 被主线程同步更新打断；模型/操作台/数字人仍复用同一套 GLB 缓存。
export function createTwinDockScene(container, { onSelectStand, onReady, forces = {}, getPlayback } = {}) {
  const dock = container.closest('.twin-dock');
  let disposed = false;
  let frame = 0;
  let active = false;
  let fitted = false;
  let fitBox = null;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0a1a24');
  scene.fog = new THREE.Fog('#0a1a24', 48, 96);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 220);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
  renderer.domElement.setAttribute('aria-label', '数据接入页3D数字孪生，可拖动旋转、点击机架');
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 7;
  controls.maxDistance = 85;
  controls.maxPolarAngle = Math.PI * 0.49;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.04);
  scene.environment = envRT.texture;
  room.dispose?.();

  scene.add(new THREE.HemisphereLight('#e8f5ff', '#38474f', 1.8));
  const key = new THREE.DirectionalLight('#fff1df', 2.8);
  key.position.set(-18, 28, 18);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -30;
  key.shadow.camera.right = 30;
  key.shadow.camera.top = 24;
  key.shadow.camera.bottom = -24;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#b7d8ef', 1.35);
  fill.position.set(16, 12, -10);
  scene.add(fill);

  const floorMat = new THREE.MeshStandardMaterial({ color: '#24333c', roughness: 0.84, metalness: 0.04 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 100), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.16;
  floor.receiveShadow = true;
  scene.add(floor);
  const aisleMat = new THREE.MeshBasicMaterial({ color: '#b99632' });
  const aisle = new THREE.Mesh(new THREE.PlaneGeometry(58, 0.12), aisleMat);
  aisle.rotation.x = -Math.PI / 2;
  aisle.position.set(0, -0.14, 6.2);
  scene.add(aisle);

  const standBounds = new Map();
  let templateInstance = null;
  let model = null;
  let finishes = null;
  let actor = null;
  let propGroup = null;
  let highlight = null;
  let selectedStand = 'S5';
  const clock = new THREE.Clock();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down = null;

  // 时序回放的启停按钮直接贴在 3D 设备上：每帧跟随选中机架的投影位置，
  // 点击等同数据接入页 KPI 卡片里的播放按钮，不再需要回到面板上找。
  const playbackButton = document.createElement('button');
  playbackButton.type = 'button';
  playbackButton.className = 'twin-dock-play is-hidden';
  playbackButton.textContent = '▶';
  playbackButton.setAttribute('aria-label', '继续时序播放');
  playbackButton.title = '继续时序播放';
  (container.parentElement || container).appendChild(playbackButton);
  const playbackState = () => (typeof getPlayback === 'function' ? getPlayback() : null);
  const playbackAnchor = new THREE.Vector3();
  function syncPlaybackButton() {
    if (disposed) return;
    const state = playbackState();
    if (!state?.available || !standBounds.has(selectedStand)) {
      playbackButton.classList.add('is-hidden');
      return;
    }
    const box = standBounds.get(selectedStand);
    box.getCenter(playbackAnchor);
    playbackAnchor.y = box.max.y + 0.8;
    playbackAnchor.project(camera);
    const width = container.clientWidth, height = container.clientHeight;
    if (width < 2 || height < 2 || playbackAnchor.z > 1
      || !Number.isFinite(playbackAnchor.x) || !Number.isFinite(playbackAnchor.y)) {
      playbackButton.classList.add('is-hidden');
      return;
    }
    const x = (playbackAnchor.x * 0.5 + 0.5) * width;
    const y = (-playbackAnchor.y * 0.5 + 0.5) * height;
    playbackButton.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
    playbackButton.classList.remove('is-hidden');
    const running = Boolean(state.running);
    if (playbackButton.dataset.running !== String(running)) {
      playbackButton.dataset.running = String(running);
      playbackButton.textContent = running ? '❚❚' : '▶';
      const label = running ? '暂停时序播放' : '继续时序播放';
      playbackButton.setAttribute('aria-label', label);
      playbackButton.title = label;
    }
  }
  playbackButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    playbackState()?.onToggle?.();
    syncPlaybackButton();
  });

  function setSelected(stand) {
    selectedStand = STANDS.includes(stand) ? stand : selectedStand;
    if (dock) dock.dataset.selectedStand = selectedStand;
    if (highlight) {
      scene.remove(highlight);
      highlight.geometry.dispose();
      highlight.material.dispose();
      highlight = null;
    }
    if (!standBounds.has(selectedStand)) return;
    highlight = new THREE.Box3Helper(standBounds.get(selectedStand).clone().expandByScalar(0.35), 0x63dfff);
    highlight.material.depthTest = false;
    highlight.material.transparent = true;
    highlight.material.opacity = 0.7;
    highlight.renderOrder = 9;
    scene.add(highlight);
    syncPlaybackButton();
  }

  function inspectStand(stand) {
    if (!actor || !standBounds.has(stand)) return false;
    const x = standBounds.get(stand).getCenter(new THREE.Vector3()).x;
    actor.walkTo(new THREE.Vector3(x, 0, 11.0), {
      onArrive: () => {
        actor.face(new THREE.Vector3(x, 2.6, 2.5));
        actor.act([
          { name: 'LookTablet', hold: 2.1 },
          { name: 'Point', hold: 1.8 },
          { name: 'Nod', hold: 1.1 },
        ]);
      },
    });
    setSelected(stand);
    return true;
  }

  function fitCamera() {
    if (!fitBox) return;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const center = fitBox.getCenter(new THREE.Vector3());
    const size = fitBox.getSize(new THREE.Vector3());
    const target = new THREE.Vector3(center.x, 2.7, 2.8);
    const direction = new THREE.Vector3(0.62, 0.5, 1.6).normalize();
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const fitX = size.x / (2 * Math.tan(vfov / 2) * Math.max(0.7, camera.aspect));
    const fitY = size.y / (2 * Math.tan(vfov / 2));
    const distance = Math.max(fitX, fitY) * 1.12 + 5;
    camera.position.copy(target).addScaledVector(direction, distance);
    controls.target.copy(target);
    controls.update();
    fitted = container.clientWidth > 1 && container.clientHeight > 1;
  }
  function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width < 2 || height < 2) {
      // 面板被关闭/隐藏：停止渲染，下次显示时重新取景。
      fitted = false;
      active = false;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      return;
    }
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    if (!active) {
      active = true;
      clock.getDelta();
      if (!frame && !disposed) animate();
    }
    if (!fitted) fitCamera();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  function onPointerDown(event) {
    down = { x: event.clientX, y: event.clientY };
  }
  function onPointerUp(event) {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) {
      down = null;
      return;
    }
    down = null;
    if (!model) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      (event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const roots = [model];
    if (propGroup) roots.push(propGroup);
    if (actor) roots.push(actor.group);
    const hits = raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      let node = hit.object;
      while (node && !node.userData?.stand) node = node.parent;
      if (node?.userData?.stand) {
        onSelectStand?.(node.userData.stand);
        setSelected(node.userData.stand);
        break;
      }
    }
  }
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);



  function animate() {
    if (disposed || !active) return;
    frame = requestAnimationFrame(animate);
    const dt = Math.min(0.05, clock.getDelta());
    if (actor) actor.update(dt);
    controls.update();
    renderer.render(scene, camera);
    syncPlaybackButton();
  }
  function setActive(value) {
    active = !!value;
    if (active) {
      resize();
      clock.getDelta();
      if (!frame && !disposed) animate();
    } else if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }

  const lease = acquireModel(() => {});
  lease.promise.then(async (template) => {
    if (disposed) return;
    templateInstance = createModelInstance(template);
    model = templateInstance.root;
    finishes = prepareIndustrialMaterials(model, envRT.texture);
    scene.add(model);
    model.updateMatrixWorld(true);

    const boxes = new Map();
    for (const child of model.children) {
      const stand = child.userData?.stand;
      if (!STANDS.includes(stand)) continue;
      const box = new THREE.Box3().setFromObject(child);
      if (box.isEmpty()) continue;
      if (!boxes.has(stand)) boxes.set(stand, new THREE.Box3());
      boxes.get(stand).union(box);
    }
    const anchors = {};
    for (const [stand, box] of boxes) {
      standBounds.set(stand, box.clone());
      anchors[stand] = { x: box.getCenter(new THREE.Vector3()).x };
    }

    const full = new THREE.Box3();
    for (const box of boxes.values()) full.union(box);
    full.expandByPoint(new THREE.Vector3(-12, 0, 12.5));
    full.expandByPoint(new THREE.Vector3(12, 0, 12.5));
    fitBox = full;
    fitCamera();
    setSelected(selectedStand);

    propGroup = new THREE.Group();
    propGroup.name = 'TwinDock_Pulpits';
    scene.add(propGroup);
    loadPulpits('/assets/', anchors, propGroup).catch(error => console.warn('[twin-dock] pulpits', error));

    const dock = container.closest('.twin-dock');
    dock?.querySelector('.twin-dock-loading')?.classList.add('is-hidden');
    dock?.querySelector('.twin-dock-status')?.classList.add('is-ready');
    onReady?.();

    const person = new Character({ mask: false, visor: false });
    try {
      await person.load('/assets/engineer-f-v1_mo.glb');
      if (disposed) return;
      actor = person;
      actor.group.position.set(-7.6, 0, 11.0);
      actor.face(new THREE.Vector3(0, 2.6, 2.5));
      scene.add(actor.group);
    } catch (error) {
      console.warn('[twin-dock] character', error);
    }
  }).catch(error => {
    console.warn('[twin-dock] factory model', error);
    const loading = container.closest('.twin-dock')?.querySelector('.twin-dock-loading');
    if (loading) loading.textContent = '三维载入失败，请打开工作台';
  });

  function dispose() {
    disposed = true;
    active = false;
    cancelAnimationFrame(frame);
    observer.disconnect();
    renderer.domElement.removeEventListener('pointerdown', onPointerDown);
    renderer.domElement.removeEventListener('pointerup', onPointerUp);
    controls.dispose();
    if (highlight) {
      scene.remove(highlight);
      highlight.geometry.dispose();
      highlight.material.dispose();
    }
    if (actor) scene.remove(actor.group);
    if (propGroup) scene.remove(propGroup);
    if (model) scene.remove(model);
    finishes?.dispose?.();
    templateInstance?.dispose();
    lease.release();
    scene.remove(floor);
    floor.geometry.dispose();
    floorMat.dispose();
    scene.remove(aisle);
    aisle.geometry.dispose();
    aisleMat.dispose();
    pmrem.dispose();
    envRT.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    playbackButton.remove();
  }

  return { setSelected, inspectStand, resize, setActive, dispose };
}
