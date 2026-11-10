import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { ENGINEER_MODEL_URL, prepareEngineerAsset } from './engineerWebAsset.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
// 所有 GLB 统一走 meshopt 解码：压缩资产必需，普通 GLB 不受影响。
const loadGltf = url => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
const AISLE_Z = 6.9;
export const FLOOR_Y = -0.14;
export const ENGINEER_AISLE_Z = 12.15;

// 当前短黑发工服工程师：原生绑定导出，带待机/巡检/手势动画。
// 有限状态机：IDLE → WALK(路径) → ACT(动作队列) → IDLE。
const CLIPS = ['Idle', 'LookTablet', 'Nod', 'Point', 'Wave', 'Walk'];
const gltfCache = new Map();

export class Character {
  constructor({ mask = true, visor = true } = {}) {
    this.useMask = mask;
    this.useVisor = visor;
    this.group = new THREE.Group();
    this.group.name = 'EngineerB';
    this.mixer = null;
    this.actions = {};
    this.active = 'Idle';
    this.stats = { inspections: 0, distance: 0 };
    this.state = 'IDLE';
    this.curve = null; this.t = 0; this.dur = 1;
    this.onArrive = null; this.onActionDone = null;
    this.queue = [];
    this._bobT = 0;
    this.tablet = null;
    this._lookTarget = new THREE.Object3D();
    this.walkReferenceSpeed = 1.5;
    this.walkCruiseSpeed = 2.0;
    this.nativeGait = false;
  }

  async load(url) {
    let gltf = gltfCache.get(url);
    if (!gltf) {
      gltf = await loadGltf(url);
      gltfCache.set(url, gltf);
    }
    // 骨骼动画实例必须用 SkeletonUtils.clone；几何与材质仍共享缓存。
    this.model = cloneSkeleton(gltf.scene);
    if (url === ENGINEER_MODEL_URL) prepareEngineerAsset(this.model);
    this.model.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      // 角色被派工/瞬移时，蒙皮网格的绑定包围球可能落后于 group 位置，
      // 导致被视锥剔除；单角色关掉剔除，保证任何站位都能渲染。
      if (o.isSkinnedMesh) o.frustumCulled = false;
    });
    // 归一化：角色原始 1.75m，脚底在 y=0，直接放地坪上
    const box = new THREE.Box3().setFromObject(this.model);
    const h = box.max.y - box.min.y;
    const s = 1.75 / h;
    this.model.scale.setScalar(s);
    this.model.position.y = -box.min.y * s;
    // 这个 GLB 的原生正面是 +Z；不要再整体转 180°，否则移动方向会和脸相反。
    // 朝向统一由 group 的 quaternion（walkTo / face）控制。
    this.model.rotation.y = 0;
    this.group.add(this.model);

    // 平板是 GLB 的独立根节点。手骨局部轴与导出姿态不一致，直接挂到 handL
    // 会把平板埋进大腿/胯部。改为固定在胸前，并且只在 LookTablet 动作时显示，
    // 这样行走和待命时都不会出现平板穿模。
    const tablet = this.model.getObjectByName('Inspection_Tablet');
    if (tablet) {
      this.model.add(tablet);
      tablet.position.set(0, 1.16, 0.34);
      tablet.rotation.set(-Math.PI / 2 + 0.28, 0, 0);
      tablet.scale.setScalar(1.8);
      tablet.visible = false;
      this.tablet = tablet;
    }

    // 原模型的脸是固定的卡通微笑；现场工程师戴 Blender 呼吸面罩，
    // 遮住笑容并跟随 head 骨骼，保持严肃的实体作业形象。
    if (this.useMask) try {
      const maskGltf = loadGltf('/assets/engineer_mask_mo.glb');
      const maskScene = (await maskGltf).scene;
      maskScene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const head = this.model.getObjectByName('head');
      if (head) {
        head.add(maskScene);
        // head 骨局部 +Z 指向后脑；面罩要放到局部 -Z 并翻转 180°，
        // 才能罩住正面的嘴/鼻，而不是藏在后脑。
        maskScene.position.set(0, 0.08, -0.10);
        maskScene.rotation.y = Math.PI;
        maskScene.scale.setScalar(1);
        this.mask = maskScene;
      }
    } catch (error) {
      console.warn('[character] 面罩载入失败', error);
    }

    // 面屏直接挂在角色 group 的面部位置，保证覆盖正脸；不依赖 head 骨局部轴。
    if (this.useVisor) try {
      const visorGltf = loadGltf('/assets/engineer_visor_mo.glb');
      const visor = (await visorGltf).scene;
      visor.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.renderOrder = 4; } });
      visor.position.set(0, 1.52, 0.16);
      this.group.add(visor);
      this.visor = visor;
    } catch (error) {
      console.warn('[character] 面屏载入失败', error);
    }

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of gltf.animations) {
      if (CLIPS.includes(clip.name)) this.actions[clip.name] = this.mixer.clipAction(clip);
    }
    let gaitMetadata;
    this.model.traverse(object => {
      if (object.userData.walk_cycle_source_distance) gaitMetadata = object.userData;
    });
    if (gaitMetadata && this.actions.Walk) {
      this.walkReferenceSpeed = gaitMetadata.walk_cycle_source_distance * s / this.actions.Walk.getClip().duration;
      this.walkCruiseSpeed = .9;
      this.nativeGait = true;
    }
    // 静态模型（无骨骼/无动画）没有 Idle 片段，此时角色保持 A-pose 站位。
    this.actions.Idle?.play();
    return this;
  }

  get position() { return this.group.position; }

  // 3D 卡通模型没有面部/口型骨骼，语音采用音频播放 + 手势；不做口型同步。
  async speak(text) {
    if (!text) return false;
    try {
      const res = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error('voice HTTP ' + res.status);
      const j = await res.json();
      const audioBase64 = j.wavBase64 || j.audio;
      if (j.error || !audioBase64) throw new Error(j.error || 'no audio');
      const audio = new Audio('data:' + (j.mimeType || j.mime || 'audio/wav') + ';base64,' + audioBase64);
      await new Promise(resolve => {
        let done = false;
        const finish = () => { if (done) return; done = true; resolve(); };
        audio.onended = finish;
        audio.onerror = finish;
        audio.play().catch(finish);
        setTimeout(finish, 15000);
      });
      return true;
    } catch (e) {
      console.warn('[character] 服务端语音不可用，改用浏览器本地语音', e);
      return this.speakLocal(text);
    }
  }

  // 离线兜底：系统语音合成，不依赖云端 TTS。
  async speakLocal(text) {
    try {
      const synth = globalThis.speechSynthesis;
      if (!synth || typeof globalThis.SpeechSynthesisUtterance === 'undefined') return false;
      await new Promise(resolve => {
        let done = false;
        const finish = () => { if (done) return; done = true; resolve(); };
        const utterance = new globalThis.SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN';
        utterance.rate = 0.95;
        utterance.pitch = 1;
        utterance.onend = finish;
        utterance.onerror = finish;
        synth.cancel();
        synth.speak(utterance);
        setTimeout(finish, 15000);
      });
      return true;
    } catch {
      return false;
    }
  }

  play(name, { fade = .28, once = false, speed = 1 } = {}) {
    const next = this.actions[name];
    if (!next) return;
    const prev = this.actions[this.active];
    next.reset();
    next.setEffectiveWeight(1);
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.timeScale = speed;
    next.play();
    if (prev && prev !== next) prev.crossFadeTo(next, fade, false);
    this.active = name;
    if (this.tablet) this.tablet.visible = name === 'LookTablet';
  }

  // 步频按照本模型的实测步幅匹配位移；到位后回到自然待机。
  walkTo(target, { speed = this.walkCruiseSpeed, onArrive } = {}) {
    const travelSpeed = this.nativeGait ? Math.min(speed, this.walkReferenceSpeed * 1.6) : speed;
    const from = this.group.position.clone();
    const to = target.clone();
    const mid1 = new THREE.Vector3().lerpVectors(from, to, .4); mid1.y = FLOOR_Y;
    const mid2 = new THREE.Vector3().lerpVectors(from, to, .75); mid2.y = FLOOR_Y;
    mid1.z += (to.z - from.z) * .06;
    this.curve = new THREE.CatmullRomCurve3([from, mid1, mid2, to], false, 'catmullrom', .2);
    this.len = this.curve.getLength();
    this.dur = Math.max(.8, this.len / travelSpeed);
    this.t = 0;
    this.state = 'WALK';
    this.onArrive = onArrive;
    this.play('Walk', { fade: .3, speed: Math.min(1.8, travelSpeed / this.walkReferenceSpeed) });
  }

  face(target) {
    const d = target.clone().sub(this.group.position);
    d.y = 0;
    if (d.lengthSq() < 1e-6) return;
    this.group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(d.x, d.z));
  }

  // 动作序列：[{name, hold}] 依次播放，最后回调
  act(sequence, onDone) {
    this.queue = [...sequence];
    this.onActionDone = onDone;
    this.state = 'ACT';
    this._nextAct();
  }

  _nextAct() {
    const step = this.queue.shift();
    if (!step) {
      this.play('Idle');
      this.state = 'IDLE';
      this.onActionDone && this.onActionDone();
      return;
    }
    this.play(step.name, { once: true });
    this._actTimer = (step.hold ?? 1) ;
  }

  update(dt) {
    if (!this.mixer) return;
    this.mixer.update(dt);
    if (this.state === 'WALK' && this.curve) {
      this.t = Math.min(1, this.t + dt / this.dur);
      const p = this.curve.getPointAt(this.t);
      p.y = FLOOR_Y;
      this.stats.distance += this.curve.getPointAt(Math.min(1, this.t + dt / this.dur)).distanceTo(p) || 0;
      this.group.position.copy(p);
      const look = this.curve.getPointAt(Math.min(1, this.t + .015));
      const d = look.clone().sub(p);
      if (d.lengthSq() > 1e-6) {
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(d.x, d.z));
        this.group.quaternion.slerp(q, Math.min(1, dt * 7));
      }
      if (this.t >= 1) {
        this.group.position.y = FLOOR_Y;
        const cb = this.onArrive; this.onArrive = null;
        this.state = 'IDLE';
        this.play('Idle');
        cb && cb();
      }
    } else if (this.state === 'ACT') {
      this._actTimer -= dt;
      const a = this.actions[this.active];
      const finished = a && a.clampWhenFinished && a.time >= a.getClip().duration - .02;
      if (this._actTimer <= 0 || finished) this._nextAct();
    }
  }
}
