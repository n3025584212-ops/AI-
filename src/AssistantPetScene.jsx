import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { createEngineerModel } from './assistantEngineerModel.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ENGINEER_MODEL_URL, ENGINEER_MODEL_ID, prepareEngineerAsset } from './engineerWebAsset.js';

export default function AssistantPetScene({model='engineer',engaged=false,hovered=false,dragging=false,taskPhase='IDLE'}) {
  const host=useRef(null),latest=useRef({engaged,hovered,dragging,state:taskPhase}),[failed,setFailed]=useState(false);
  latest.current={engaged,hovered,dragging,state:taskPhase};
  useEffect(()=>{
    setFailed(false);
    const element=host.current;let renderer,avatar,observer,frames=0,last=-Infinity,sceneExpanded=false,disposed=false,mixer=null;
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
    const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-.95,.95,2.48,-.25,.1,30);
    camera.position.set(3,2.4,7);camera.lookAt(0,1.12,0);
    const hemisphere=new THREE.HemisphereLight('#e8f5ff','#5d6872',2.4);scene.add(hemisphere);
    const key=new THREE.DirectionalLight('#fff4e6',3.3);key.position.set(-3,5,5);scene.add(key);
    const fill=new THREE.DirectionalLight('#b7d8ef',1.8);fill.position.set(4,2,3);scene.add(fill);
    const draw=time=>{
      if(!renderer||document.hidden||sceneExpanded)return;
      if(time-last<1000/24)return;last=time;
      avatar.animate(reduced.matches?0:time/1000,latest.current);renderer.render(scene,camera);
      element.dataset.frames=String(++frames);element.dataset.model=model;element.dataset.meshes=String(renderer.info.render.calls);
    };
    const schedule=()=>{if(!renderer)return;renderer.setAnimationLoop(null);if(document.hidden||sceneExpanded)return;last=-Infinity;draw(performance.now());if(!reduced.matches)renderer.setAnimationLoop(draw);};
    const expanded=e=>{sceneExpanded=!!e.detail;schedule();};
    const lost=e=>{e.preventDefault();renderer?.setAnimationLoop(null);setFailed(true);};
    const restored=()=>{setFailed(false);schedule();};
    try {
      renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));
      renderer.setClearColor(0x000000,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
      avatar=model==='engineer'?{root:new THREE.Group(),animate(){},dispose(){this.root.clear();}}:createEngineerModel(model);scene.add(avatar.root);element.appendChild(renderer.domElement);element.dataset.renderer='realtime-webgl';
      if(model==='engineer'){
        new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(ENGINEER_MODEL_URL,gltf=>{
          if(disposed)return;
          const root=prepareEngineerAsset(gltf.scene);
          root.traverse(o=>{if(o.isMesh){o.frustumCulled=false;}});
          const b0=new THREE.Box3().setFromObject(root);const h0=Math.max(.001,b0.max.y-b0.min.y);const sc=2.32/h0;
          root.scale.setScalar(sc);
          const b1=new THREE.Box3().setFromObject(root);
          root.position.set(-(b1.min.x+b1.max.x)/2,-b1.min.y,-(b1.min.z+b1.max.z)/2);
          root.rotation.y=-.18;
          scene.remove(avatar.root);avatar.dispose();scene.add(root);
          mixer=new THREE.AnimationMixer(root);
          const idle=gltf.animations.find(c=>c.name==='Idle')||gltf.animations[0];
          if(idle)mixer.clipAction(idle).play();
          let prev=0;
          avatar={root,animate:t=>{if(mixer){const dt=Math.max(0,Math.min(.12,t-prev));mixer.update(dt);}prev=t;},dispose:()=>{mixer?.stopAllAction();mixer=null;root.clear();}};
          element.dataset.avatar=ENGINEER_MODEL_ID;
        },undefined,err=>{console.warn('工程师模型加载失败',err);setFailed(true);});
      }
      const resize=()=>{const w=Math.max(1,element.clientWidth),h=Math.max(1,element.clientHeight);renderer.setSize(w,h);const extent=2.73;camera.left=-extent*w/h/2;camera.right=extent*w/h/2;camera.top=extent/2;camera.bottom=-extent/2;camera.updateProjectionMatrix();last=-Infinity;draw(performance.now());};
      observer=new ResizeObserver(resize);observer.observe(element);resize();schedule();
      renderer.domElement.addEventListener('webglcontextlost',lost);renderer.domElement.addEventListener('webglcontextrestored',restored);
      document.addEventListener('visibilitychange',schedule);window.addEventListener('dkqkar-scene-expanded',expanded);reduced.addEventListener('change',schedule);
    } catch {setFailed(true);}
    return()=>{disposed=true;observer?.disconnect();document.removeEventListener('visibilitychange',schedule);window.removeEventListener('dkqkar-scene-expanded',expanded);reduced.removeEventListener('change',schedule);renderer?.setAnimationLoop(null);renderer?.domElement.removeEventListener('webglcontextlost',lost);renderer?.domElement.removeEventListener('webglcontextrestored',restored);avatar?.dispose();renderer?.dispose();renderer?.forceContextLoss();renderer?.domElement.remove();};
  },[model]);
  return <span ref={host} className="assistant-pet-scene" aria-hidden="true">{failed&&<span className="assistant-pet-render-fallback">3D形象暂未就绪</span>}</span>;
}
