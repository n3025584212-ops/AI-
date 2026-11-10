import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Original, local geometry: no remote model, GIF or license-dependent character.
export function createEngineerModel(variant = 'engineer') {
  const root = new THREE.Group(); root.name = 'DK_AI_Engineer';
  const resources = new Set();
  const material = (color, roughness = .65, metalness = 0) => { const m = new THREE.MeshStandardMaterial({ color, roughness, metalness }); resources.add(m); return m; };
  const skin = material('#dca883'), navy = material('#26465e'), pants = material('#243647'), boots = material('#342b28');
  const helmet = material(variant === 'worker' ? '#e9a039' : '#e5edf0', .32, .08);
  const trim = material('#bad3dc', .45, .25), vest = material(variant === 'worker' ? '#dc922b' : '#376d88');
  const dark = material('#263137'), screen = material('#6faac0', .35), hair = material('#443631');
  function mesh(geometry, mat, xyz, parent = root, name = '') {
    resources.add(geometry); const m = new THREE.Mesh(geometry, mat); m.position.set(...xyz); m.name = name; parent.add(m); return m;
  }
  const box = (w,h,d,r,mat,xyz,parent=root,name='') => mesh(new RoundedBoxGeometry(w,h,d,3,r),mat,xyz,parent,name);
  const ball = (r,mat,xyz,parent=root) => mesh(new THREE.SphereGeometry(r,20,14),mat,xyz,parent);
  const body = new THREE.Group(); root.add(body);
  box(.66,.75,.4,.13,navy,[0,1.02,0],body,'WorkJacket');
  box(.55,.18,.36,.06,pants,[0,.59,0],body);
  for(const side of [-1,1]) {
    box(.2,.52,.25,.06,pants,[side*.17,.29,0],root,'WorkTrouser');
    box(.26,.18,.43,.06,boots,[side*.18,.02,.08],root,'SafetyBoot');
    box(.18,.56,.045,.035,vest,[side*.19,1.06,.216],body,'JacketPanel');
    box(.18,.045,.055,.012,trim,[side*.19,1.08,.245],body,'ReflectiveTrim');
  }
  box(.027,.56,.04,.01,trim,[0,1.08,.225],body,'JacketZip');
  box(.12,.12,.035,.015,trim,[.17,1.27,.247],body,'EngineerBadge');
  mesh(new THREE.CylinderGeometry(.085,.09,.13,16),skin,[0,1.46,0],body);
  const head = new THREE.Group(); head.position.set(0,1.77,0); body.add(head);
  const face = ball(.245,skin,[0,0,0],head); face.scale.set(.88,1.12,.9);
  const backHair = ball(.247,hair,[0,.065,-.055],head); backHair.scale.set(.89,.83,.75);
  // Face remains visible in front of hair and helmet.
  for(const side of [-1,1]) {
    const ear=ball(.048,skin,[side*.215,-.01,-.01],head); ear.scale.set(.5,1,.7);
    const eye=ball(.019,dark,[side*.078,.015,.202],head); eye.scale.set(.8,1,.45);
    box(.06,.014,.018,.005,hair,[side*.078,.065,.202],head);
  }
  const nose=ball(.038,skin,[0,-.025,.224],head); nose.scale.set(.65,.9,1.2);
  box(.075,.012,.015,.005,hair,[0,-.11,.192],head,'Mouth');
  const hat=ball(.29,helmet,[0,.2,-.012],head); hat.scale.set(1,.62,.92);
  const brim=mesh(new THREE.CylinderGeometry(.32,.32,.035,32),helmet,[0,.16,.025],head); brim.scale.z=1.12;
  box(.06,.12,.025,.015,trim,[0,.25,.255],head,'HelmetBadge');
  const arms=[];
  for(const side of [-1,1]) {
    const arm=new THREE.Group();arm.position.set(side*.36,1.3,0);body.add(arm);arms.push(arm);
    box(.18,.4,.23,.07,navy,[side*.035,-.18,0],arm);
    box(.17,.3,.21,.06,navy,[side*.06,-.46,.05],arm);
    const hand=ball(.09,skin,[side*.06,-.64,.07],arm);hand.scale.set(.85,1,.72);
    arm.rotation.z=side*.08;
  }
  arms[0].rotation.x=-.6;
  // A project engineer carries a tablet; the worker carries a compact inspection board.
  const tablet=new THREE.Group();tablet.position.set(-.27,.93,.29);tablet.rotation.set(-.12,-.12,.12);body.add(tablet);
  box(.32,.4,.05,.035,dark,[0,0,0],tablet,'InspectionTablet');
  box(.26,.31,.016,.018,screen,[0,.015,.033],tablet);
  for(let i=0;i<3;i++)box(.17-i*.025,.012,.01,.003,trim,[-.015,.09-i*.065,.046],tablet);
  const shadowMat=new THREE.MeshBasicMaterial({color:'#080e15',transparent:true,opacity:.22,depthWrite:false});resources.add(shadowMat);
  const shadow=mesh(new THREE.CircleGeometry(.45,32),shadowMat,[0,-.08,0]);shadow.rotation.x=-Math.PI/2;shadow.scale.y=.72;
  root.rotation.y=-.22;
  return { root, animate(seconds,{engaged=false,hovered=false,dragging=false,state='IDLE'}={}) {
    body.position.y=Math.sin(seconds*1.7)*.012;
    head.rotation.y=Math.sin(seconds*.55)*.055+(hovered ? .1 : 0);
    head.rotation.z=dragging?-.09:state==='LISTENING'?.1:Math.sin(seconds*.9)*.018;
    head.rotation.x=['EXECUTING','VERIFYING','PLANNING'].includes(state)?.12:0;
    arms[1].rotation.z=.08+(hovered?-.55+Math.sin(seconds*4)*.12:['NEEDS_INPUT','NEEDS_CONFIRMATION','ATTENTION'].includes(state)?-.35:Math.sin(seconds*1.7)*.025);
    arms[0].rotation.x=['EXECUTING','VERIFYING','PLANNING'].includes(state)?-.78:-.6;
    root.rotation.z=dragging?-.035:0;
  }, dispose(){for(const r of resources)r.dispose();resources.clear();root.clear();} };
}
