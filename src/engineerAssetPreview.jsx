import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Character } from './factoryCharacter.js';
import { ENGINEER_MODEL_URL } from './engineerWebAsset.js';

function Preview() {
  const host = useRef(null), actor = useRef(null);
  const [status, setStatus] = useState('正在加载工程技术员…');
  const initialClip = new URLSearchParams(window.location.search).get('motion') === 'walk' ? 'Walk' : 'Idle';
  const [clip, setClip] = useState(initialClip);
  useEffect(() => {
    let alive = true;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#646b72');
    const camera = new THREE.PerspectiveCamera(32, 1, .01, 100);
    camera.position.set(2.5, 1.3, 3.2);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    host.current.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, .88, 0); controls.enableDamping = true;
    const hemi = new THREE.HemisphereLight('#ffffff', '#6d7c8e', 1.8);scene.add(hemi);
    const key = new THREE.DirectionalLight('#fff5e9', 2.2);key.position.set(-2,4,4);scene.add(key);
    const fill = new THREE.DirectionalLight('#dceaff', 1.2);fill.position.set(3,2,-1);scene.add(fill);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4,64),new THREE.MeshStandardMaterial({ color:'#6a7076', roughness:1 }));
    floor.rotation.x=-Math.PI/2;floor.position.y=-.145;scene.add(floor);
    const character = new Character({ mask:false, visor:false });
    actor.current = character;
    character.load(ENGINEER_MODEL_URL).then(() => {
      if (!alive) return;
      character.group.position.y = -.14;
      scene.add(character.group);
      character.play(initialClip);
      setStatus('已接入当前绑定版');
      let skins=0,morphTargets=0;character.model.traverse(o=>{if(o.isSkinnedMesh)skins++;if(o.morphTargetInfluences)morphTargets=Math.max(morphTargets,o.morphTargetInfluences.length);});
      window.__engineerPreview={character,scene,camera,renderer,controls,report:{url:ENGINEER_MODEL_URL,skins,morphTargets,clips:Object.keys(character.actions)}};
      document.body.dataset.engineer='ready';
    }).catch(e=>{setStatus(`加载失败：${e.message}`);document.body.dataset.engineer='error';});
    const resize=()=>{const w=host.current.clientWidth,h=host.current.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();};
    const observer=new ResizeObserver(resize);observer.observe(host.current);resize();
    const clock=new THREE.Clock();renderer.setAnimationLoop(()=>{character.update(Math.min(clock.getDelta(),.08));controls.update();renderer.render(scene,camera);});
    return()=>{alive=false;observer.disconnect();renderer.setAnimationLoop(null);controls.dispose();renderer.dispose();renderer.domElement.remove();delete window.__engineerPreview;};
  },[]);
  const names={Idle:'待机',Walk:'行走',Nod:'点头',LookTablet:'查看',Point:'指向',Wave:'招手'};
  return <main style={{height:'100vh',background:'#20272e',color:'#e8edf1',fontFamily:'system-ui',display:'flex',flexDirection:'column'}}>
    <header style={{padding:'15px 22px',display:'flex',gap:20,alignItems:'center',flexWrap:'wrap'}}><strong>冷轧工程技术员</strong><span style={{fontSize:13,color:'#aab8c3'}}>{status}</span><a href="/" style={{color:'#bdd9ec',marginLeft:'auto'}}>返回工厂软件</a></header>
    <div ref={host} style={{flex:1,minHeight:0}}/>
    <footer style={{padding:'12px 20px',display:'flex',alignItems:'center',gap:9,flexWrap:'wrap'}}>{Object.entries(names).map(([id,title])=><button key={id} onClick={()=>{actor.current?.play(id);setClip(id);}} style={{border:'1px solid #526170',borderRadius:5,padding:'8px 15px',background:clip===id?'#416479':'#2b3540',color:'#eef5fa',cursor:'pointer'}}>{title}</button>)}<span style={{fontSize:12,color:'#aab8c3',marginLeft:'auto'}}>拖动旋转 · 滚轮缩放</span></footer>
  </main>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
