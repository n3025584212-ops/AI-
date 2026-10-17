import {useEffect,useRef,useState} from 'react';
import {parseVoiceCommand} from './voiceCommands.js';
import {wakeCommand} from './voiceWake.js';
import {mergeVoiceChunks,resampleVoicePcm,encodeVoiceWav,voiceBytesToBase64,voiceBase64ToBlob,splitVoiceReply} from './voiceAudio.js';
import workletUrl from './voicePcmWorklet.js?url&no-inline';
import './voice-assistant.css';

const busyPhases=new Set(['preparing','recording','recognizing','executing','thinking','speaking']);
const phaseLabels={idle:'语音待命',preparing:'准备聆听',recording:'小迪待命',recognizing:'正在识别',executing:'正在执行',thinking:'正在回答',speaking:'正在播报',done:'小迪待命',error:'语音暂不可用'};
async function voiceRequest(path,body,signal){
  const response=await fetch('/api/voice/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal});
  let data;try{data=await response.json();}catch{throw new Error('语音服务暂时不可用。');}
  if(!response.ok)throw new Error(data.error||data.message||'语音服务暂时不可用。');
  return data;
}
function microphoneError(error){
  if(error?.name==='NotAllowedError')return '麦克风未获许可，请允许麦克风后重试。';
  if(error?.name==='NotFoundError')return '没有找到麦克风，请连接后重试。';
  if(error?.name==='NotReadableError')return '麦克风正在被占用，请稍后重试。';
  return error?.message||'语音输入失败，请重试。';
}


export default function VoiceAssistant({onCommand,onQuestion}){
  const [phase,setPhase]=useState('idle'),[wakeEnabled,setWakeEnabled]=useState(false);
  const [feedback,setFeedback]=useState(''),[hint,setHint]=useState(''),[level,setLevel]=useState(0),[following,setFollowing]=useState(false);
  const mounted=useRef(false),generation=useRef(0),session=useRef(null),network=useRef(null),speechNetwork=useRef(null),playback=useRef(null),statusRequest=useRef(null);
  const callbacks=useRef({onCommand,onQuestion}),speakPreference=useRef(true),statusRef=useRef(null),phaseRef=useRef(phase);
  const wakeRef=useRef(false),blocked=useRef(false),gestureRetried=useRef(false),awaitingCommand=useRef(false),hintTimer=useRef(null),seenHints=useRef(new Set()),refreshing=useRef(null);
  callbacks.current={onCommand,onQuestion};phaseRef.current=phase;
  const current=id=>mounted.current&&generation.current===id;
  const changePhase=value=>{phaseRef.current=value;if(mounted.current)setPhase(value);};
  const showHint=message=>{if(!mounted.current||!message||seenHints.current.has(message))return;seenHints.current.add(message);setHint(message);clearTimeout(hintTimer.current);hintTimer.current=setTimeout(()=>{if(mounted.current)setHint('');},6500);};
  const openAssistant=()=>window.dispatchEvent(new Event('dkqkar-assistant-open'));
  const chat=(role,text)=>window.dispatchEvent(new CustomEvent('dkqkar-voice-turn',{detail:{role,text}}));
  function releaseCapture(active=session.current){
    if(!active)return;
    clearTimeout(active.deadline);active.flushResolve?.();
    active.stream?.getTracks().forEach(track=>track.stop());
    if(active.node){active.node.port.onmessage=null;active.node.onprocessorerror=null;try{active.node.disconnect();active.node.port.close();}catch{}}
    try{active.source?.disconnect();active.mute?.disconnect();}catch{}
    if(active.context&&active.context.state!=='closed')active.context.close().catch(()=>{});
    if(session.current===active)session.current=null;
  }
  function stopPlayback(){
    speechNetwork.current?.abort();speechNetwork.current=null;
    const active=playback.current;
    if(active){active.audio.onended=null;active.audio.onerror=null;active.audio.pause();active.audio.removeAttribute('src');URL.revokeObjectURL(active.url);playback.current=null;active.finish?.(false);}
  }
  function stopAll({disable=false}={}){
    generation.current++;network.current?.abort();network.current=null;releaseCapture();stopPlayback();
    awaitingCommand.current=false;
    if(disable){wakeRef.current=false;if(mounted.current)setWakeEnabled(false);}
    if(mounted.current){setLevel(0);setFollowing(false);changePhase('idle');}
  }
  async function refreshStatus(){
    if(refreshing.current)return refreshing.current;
    const controller=new AbortController();statusRequest.current=controller;
    const timer=setTimeout(()=>controller.abort(),8000);
    const request=(async()=>{
      try{const result=await voiceRequest('status',null,controller.signal);if(mounted.current)statusRef.current=result;return result;}
      catch(error){const result={available:false,recognitionAvailable:false,synthesisAvailable:false,reason:error.name==='AbortError'?'语音服务连接超时':microphoneError(error)};if(mounted.current)statusRef.current=result;return result;}
      finally{clearTimeout(timer);if(statusRequest.current===controller)statusRequest.current=null;refreshing.current=null;}
    })();refreshing.current=request;return request;
  }
  async function arm({gesture=false,deviceChange=false}={}){
    const service=await refreshStatus();if(!mounted.current)return;
    if(!service.recognitionAvailable){stopAll({disable:true});setFeedback(service.reason||'语音暂不可用');if(!/关闭/.test(service.reason||''))showHint(service.reason);return;}
    if(deviceChange)blocked.current=false;
    if(gesture&&blocked.current&&!gestureRetried.current){blocked.current=false;gestureRetried.current=true;}
    if(blocked.current||busyPhases.has(phaseRef.current))return;
    wakeRef.current=true;setWakeEnabled(true);startRecording(!awaitingCommand.current);
  }
  useEffect(()=>{
    mounted.current=true;arm();
    const leave=()=>stopAll({disable:true});
    const interact=()=>{session.current?.context?.resume().catch(()=>{});if(!busyPhases.has(phaseRef.current))arm({gesture:true});};
    const activate=()=>{gestureRetried.current=false;interact();};
    const deviceChange=()=>arm({deviceChange:true});
    const settings=()=>arm();
    const cancel=()=>{stopAll();if(wakeRef.current)changePhase('done');};
    const poll=setInterval(()=>arm(),15000);
    window.addEventListener('pagehide',leave);window.addEventListener('pointerdown',interact,{once:true});
    window.addEventListener('dkqkar-voice-activate',activate);window.addEventListener('dkqkar-voice-settings-changed',settings);window.addEventListener('dkqkar-voice-cancel',cancel);
    navigator.mediaDevices?.addEventListener('devicechange',deviceChange);
    return()=>{mounted.current=false;clearInterval(poll);clearTimeout(hintTimer.current);generation.current++;statusRequest.current?.abort();network.current?.abort();releaseCapture();stopPlayback();window.removeEventListener('pagehide',leave);window.removeEventListener('pointerdown',interact);window.removeEventListener('dkqkar-voice-activate',activate);window.removeEventListener('dkqkar-voice-settings-changed',settings);window.removeEventListener('dkqkar-voice-cancel',cancel);navigator.mediaDevices?.removeEventListener('devicechange',deviceChange);};
  },[]);
  async function speak(text,id){
    if(!speakPreference.current||!statusRef.current?.synthesisAvailable||!current(id)){if(current(id))changePhase('done');return;}
    const controller=new AbortController();speechNetwork.current=controller;changePhase('speaking');
    try{
      for(const chunk of splitVoiceReply(text)){
        if(!current(id)||!speakPreference.current||controller.signal.aborted)return;
        const timer=setTimeout(()=>controller.abort(),30000);
        let data;
        try{data=await voiceRequest('speak',{text:chunk},controller.signal);}finally{clearTimeout(timer);}
        if(!current(id)||!speakPreference.current||controller.signal.aborted)return;
        if(typeof data.wavBase64!=='string'||!data.wavBase64)throw new Error('没有收到播报音频');
        const url=URL.createObjectURL(voiceBase64ToBlob(data.wavBase64,data.mimeType||'audio/wav'));
        const audio=new Audio(url);
        const played=await new Promise((resolve,reject)=>{
          let settled=false;
          const finish=(ok,error)=>{
            if(settled)return;settled=true;audio.onended=null;audio.onerror=null;
            if(playback.current?.audio===audio)playback.current=null;
            URL.revokeObjectURL(url);if(error)reject(error);else resolve(ok);
          };
          playback.current={audio,url,finish};
          audio.onended=()=>finish(true);audio.onerror=()=>finish(false,new Error('播报音频播放失败'));
          audio.play().catch(error=>finish(false,error));
        });
        if(!played||!current(id)||!speakPreference.current)return;
      }
      if(current(id))changePhase('done');
    }catch(error){
      if(current(id)){changePhase('done');if(speakPreference.current)setFeedback(value=>value+'\n播报暂不可用，结果已显示。');stopPlayback();}
    }finally{if(speechNetwork.current===controller)speechNetwork.current=null;}
  }

  async function handleText(text,confidence,id,signal,wakeMode){
    if(!current(id))return;
    if(Number.isFinite(confidence)&&confidence<.45){if(!wakeMode)showHint('没有听清，请再说一次。');changePhase('done');return;}
    if(wakeMode){
      const command=wakeCommand(text);
      if(command===null){changePhase('done');return;}
      openAssistant();
      if(!command){awaitingCommand.current=true;setFollowing(true);chat('user',text);chat('assistant','我在，请说。');setFeedback('我在，请说。');await speak('我在，请说。',id);return;}
      text=command;
    }
    awaitingCommand.current=false;setFollowing(false);openAssistant();
    const parsed=parseVoiceCommand(text);
    if(parsed.kind==='unsupported'){chat('user',text);chat('assistant',parsed.message);setFeedback(parsed.message);await speak(parsed.message,id);return;}
    let result='';const completed=[];
    const isCommand=parsed.kind==='commands';
    if(isCommand)chat('user',text);
    try{
      if(isCommand){
        changePhase('executing');
        if(typeof callbacks.current.onCommand!=='function')throw new Error('当前页面未接入语音操作。');
        for(const action of parsed.actions){
          if(!current(id))return;
          const message=await callbacks.current.onCommand(action,{signal});
          if(!current(id))return;
          if(typeof message!=='string'||!message.trim())throw new Error('操作未完成，请重试。');
          completed.push(message.trim());setFeedback(completed.join('。'));
        }
        result=completed.join('。');chat('assistant',result);
      }else{
        changePhase('thinking');
        if(typeof callbacks.current.onQuestion!=='function')throw new Error('工艺问答暂不可用。');
        result=await callbacks.current.onQuestion(text,{signal});
        if(!current(id))return;
        if(typeof result!=='string'||!result.trim())throw new Error('没有收到答复，请重试。');
        result=result.trim();setFeedback(result);
      }
      if(current(id))await speak(result,id);
    }catch(error){if(current(id)){const message=[...completed,microphoneError(error)].join('。');setFeedback(message);if(isCommand)chat('assistant',message);else showHint(microphoneError(error));changePhase('done');}}
  }
  async function finishRecording(active=session.current){
    if(!active||active.ending||!current(active.id))return;
    active.ending=true;clearTimeout(active.deadline);changePhase('recognizing');
    try{
      await new Promise(resolve=>{
        const timer=setTimeout(resolve,250);active.flushResolve=()=>{clearTimeout(timer);resolve();};
        try{active.node.port.postMessage({type:'flush'});}catch{active.flushResolve();}
      });
      const chunks=active.chunks,rate=active.sampleRate,speech=active.heardSpeech;
      releaseCapture(active);if(!current(active.id))return;setLevel(0);
      if(!speech||!chunks.length){awaitingCommand.current=false;setFollowing(false);changePhase('done');return;}
      const pcm=resampleVoicePcm(mergeVoiceChunks(chunks),rate);
      const controller=new AbortController();network.current=controller;
      const timer=setTimeout(()=>controller.abort(),45000);
      try{
        const result=await voiceRequest('transcribe',{wavBase64:voiceBytesToBase64(encodeVoiceWav(pcm))},controller.signal);
        clearTimeout(timer);if(!current(active.id))return;
        if(typeof result.text!=='string'||!result.text.trim()){changePhase('done');return;}
        await handleText(result.text.trim(),result.confidence,active.id,controller.signal,active.wakeMode);
      }finally{clearTimeout(timer);if(network.current===controller)network.current=null;}
    }catch(error){releaseCapture(active);if(current(active.id)){setFeedback(microphoneError(error));showHint(error.name==='AbortError'?'识别超时，稍后自动重试。':microphoneError(error));changePhase('done');}}
  }
  async function startRecording(wakeMode=true){
    generation.current++;network.current?.abort();network.current=null;releaseCapture();stopPlayback();
    const id=generation.current;changePhase('preparing');setLevel(0);
    let active;
    try{
      if(!statusRef.current?.recognitionAvailable)throw new Error(statusRef.current?.reason||'语音暂不可用');
      if(!navigator.mediaDevices?.getUserMedia||!window.AudioContext||!window.AudioWorkletNode)throw new Error('当前环境不支持麦克风输入。');
      const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:{ideal:1},echoCancellation:true,noiseSuppression:false,autoGainControl:false},video:false});
      if(!current(id)){stream.getTracks().forEach(track=>track.stop());return;}
      active={id,stream,chunks:[],samples:0,lastVoiceAt:0,heardSpeech:false,ending:false,wakeMode};session.current=active;
      const context=new AudioContext();Object.assign(active,{context,sampleRate:context.sampleRate});
      if(!context.audioWorklet)throw new Error('当前环境不支持麦克风输入。');
      await context.audioWorklet.addModule(workletUrl);if(!current(id)){releaseCapture(active);return;}
      const node=new AudioWorkletNode(context,'dkqkar-voice-pcm',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:1});
      const source=context.createMediaStreamSource(stream),mute=context.createGain();mute.gain.value=0;Object.assign(active,{node,source,mute});
      node.port.onmessage=({data})=>{
        if(session.current!==active||!current(id))return;
        if(data?.type==='flushed'){active.flushResolve?.();return;}
        if(data?.type!=='samples'||!(data.samples instanceof Float32Array))return;
        active.chunks.push(data.samples);active.samples+=data.samples.length;
        if(data.rms>.012){active.heardSpeech=true;active.lastVoiceAt=active.samples/active.sampleRate;}
        // Passive silence retains a short pre-roll; it never closes the microphone on a timer.
        if(wakeMode&&!active.heardSpeech){while(active.chunks.length>1&&active.samples-active.chunks[0].length>active.sampleRate*.45)active.samples-=active.chunks.shift().length;}
        const duration=active.samples/active.sampleRate;
        if(!active.ending){setLevel(Math.min(1,data.rms*9));if((active.heardSpeech&&duration-active.lastVoiceAt>=1.1)||(active.heardSpeech&&duration>=20))finishRecording(active);}
      };
      node.onprocessorerror=()=>{if(current(id)){releaseCapture(active);setFeedback('麦克风采集失败');showHint('麦克风采集失败，请检查设备。');blocked.current=true;wakeRef.current=false;setWakeEnabled(false);changePhase('error');}};
      stream.getAudioTracks().forEach(track=>{track.onended=()=>{if(session.current===active&&current(id)){releaseCapture(active);blocked.current=true;wakeRef.current=false;setWakeEnabled(false);setFeedback('麦克风已断开');showHint('麦克风已断开，连接后会自动恢复。');changePhase('error');}};});
      source.connect(node);node.connect(mute);mute.connect(context.destination);
      let resumeTimer;
      try{await Promise.race([context.resume(),new Promise((_,reject)=>{resumeTimer=setTimeout(()=>reject(new Error('点击助手后即可使用语音。')),2500);})]);}finally{clearTimeout(resumeTimer);}
      if(!current(id)){releaseCapture(active);return;}
      if(!wakeMode)active.deadline=setTimeout(()=>finishRecording(active),12000);
      blocked.current=false;setFeedback('');changePhase('recording');
    }catch(error){releaseCapture(active);if(current(id)){blocked.current=true;wakeRef.current=false;setWakeEnabled(false);setFeedback(microphoneError(error));showHint(microphoneError(error));changePhase('error');}}
  }
  useEffect(()=>{
    if(!wakeEnabled||phase!=='done')return;
    const timer=setTimeout(()=>{if(wakeRef.current&&mounted.current&&!blocked.current)startRecording(!awaitingCommand.current);},400);
    return()=>clearTimeout(timer);
  },[wakeEnabled,phase]);
  const label=wakeEnabled?(following&&phase==='recording'?'正在聆听':phaseLabels[phase]):/关闭/.test(feedback)?'语音已关闭':phase==='preparing'?'准备聆听':'语音未就绪';
  return <div className="voice-ambient" data-phase={phase} data-wake-enabled={wakeEnabled} data-following={following}>
    <span className={'voice-ambient-status '+(wakeEnabled?'is-enabled ':'')+(busyPhases.has(phase)&&phase!=='recording'&&phase!=='preparing'?'is-working':'')} title={feedback||'说“小迪”，然后说出要做的操作'} aria-label={label}><i style={{'--voice-level':level}} aria-hidden="true"/><span>{label}</span></span>
    {hint&&<span className="voice-ambient-hint" role="status">{hint}</span>}
  </div>;
}
