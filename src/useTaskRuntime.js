import { useCallback, useEffect, useRef, useState } from 'react';

export const TASK_TERMINAL = new Set(['succeeded','completed','failed','cancelled','partial']);
export const taskId = task => task?.taskId || task?.id;
export const taskStepId = step => step?.stepId || step?.id;
export const taskStatus = task => task?.status || 'queued';
export async function downloadTaskArtifact(artifact) {
  if(typeof artifact?.content!=='string')throw new Error('任务成果没有可下载的实际内容。');
  const bytes=new TextEncoder().encode(artifact.content);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(value=>value.toString(16).padStart(2,'0')).join('');
  if(artifact.sha256&&String(artifact.sha256).toLowerCase()!==digest)throw new Error('任务成果内容与校验值不一致，下载未执行。');
  if(Number.isFinite(artifact.bytes)&&artifact.bytes!==bytes.byteLength)throw new Error('任务成果内容长度与回执不一致，下载未执行。');
  const filename=String(artifact.filename||artifact.name||'QCDKR-任务成果.txt').replace(/[\\/:*?"<>|]/g,'_');
  const url=URL.createObjectURL(new Blob([bytes],{type:artifact.mimeType||'text/plain;charset=utf-8'}));
  try{const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();}
  finally{setTimeout(()=>URL.revokeObjectURL(url),0);}
  return {downloadRequested:true,fileSaved:false,artifact:{filename,sha256:digest,bytes:bytes.byteLength}};
}
export function taskActionKey(task, step) {
  return [taskId(task), taskStepId(step), step?.argumentsDigest].join(':');
}
const receiptStorageKey=key=>'qcdkr.native-ui-step.v1:'+key;
export function readStoredTaskReceipt(key,storage=globalThis.sessionStorage){
  const raw=storage?.getItem(receiptStorageKey(key));if(!raw)return null;
  try{return JSON.parse(raw);}catch{throw new Error('先前界面动作的本机会话回执格式异常，未重复执行。');}
}
export function storeTaskReceipt(key,value,storage=globalThis.sessionStorage){
  if(!storage)throw new Error('本机会话存储不可用，未开始可能重复的界面动作。');
  storage.setItem(receiptStorageKey(key),JSON.stringify(value));
}
export function assertTaskApproval(task,step) {
  const identity=task?.contextIdentity,approval=step?.approval;
  if(!identity||!approval?.approved||approval.argumentsDigest!==step.argumentsDigest
    ||JSON.stringify(approval.contextIdentity)!==JSON.stringify(identity))throw Object.assign(new Error('这次操作没有匹配对象、参数和版本的确认。'),{definitiveNoEffect:true});
  return true;
}
export function assertTaskWriteBinding(task,step,{contextFingerprint,operationScope}) {
  assertTaskApproval(task,step);const identity=task.contextIdentity;
  // A request revision is transport state, not condition identity. A prediction
  // refresh can bump it without changing the case the user approved. Reject on
  // a different session or a different input/context fingerprint instead.
  const sameSession=identity.operationScope?.session_id===operationScope?.session_id;
  if(identity.contextFingerprint!==contextFingerprint||!sameSession)throw Object.assign(new Error('当前工况版本已变化，旧确认未执行；请基于当前工况重新发起任务。'),{definitiveNoEffect:true});
  return true;
}
export function sceneActionMatches(action,state,before={}) {
  if(!state)return false;
  switch(action.type){
    case 'select_stand': return state.selectedStand===action.stand&&state.scope==='line';
    case 'set_view': return state.view===action.view&&state.sceneReady===true;
    case 'set_shell': return state.shell===action.mode&&state.sceneReady===true;
    case 'set_lighting': return state.lighting===action.mode&&state.sceneReady===true;
    case 'set_walk': return state.walkMode===action.on&&state.sceneReady===true;
    case 'set_scope': return state.scope==='line'&&(action.scope==='line'||action.scope==='s5'&&state.selectedStand==='S5');
    case 'set_stream': return state.streamRunning===action.playing;
    case 'set_fullscreen': return state.expanded===action.expanded;
    case 'set_explode': return state.explode===action.expanded&&state.sceneReady===true;
    case 'set_matrix': return state.matrixOpen===action.open;
    case 'set_motion': return action.playing===true&&state.motionPlaying===true;
    case 'reset_camera': return state.sceneReady===true&&state.cameraReset!==before.cameraReset;
    case 'zoom': return state.sceneReady===true&&state.camera!==before.camera;
    case 'focus-measurement': return state.highlightedStand===action.stand&&state.highlightedMeasurement===action.measurement;
    default:return false;
  }
}
export function pendingTaskStep(task) {
  // Reconciliation is an unknown outcome, not permission to repeat the action.
  if (taskStatus(task) !== 'waiting_ui') return null;
  return task.steps?.find(step => step.uiAction && step.status === 'waiting_ui')
    || task.steps?.find(step => step.uiAction && task.pending?.stepId === taskStepId(step)) || null;
}
function unwrap(value) { return value?.task || value; }
export async function requestTask(path, body, { signal } = {}) {
  const response = await fetch('/api/tasks' + path, {
    credentials:'same-origin', signal,
    ...(body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),
  });
  let data; try { data = await response.json(); } catch { throw new Error('任务服务没有返回有效结果，任务状态尚未确认。'); }
  if (response.status === 401) window.dispatchEvent(new Event('dkqkar-session-expired'));
  if (!response.ok) throw Object.assign(new Error(data.error?.message || data.message || data.error || '任务请求未完成。'), {status:response.status,details:data});
  return data;
}

/** The server owns task state. A UI operation is executed once per signed step;
 * failed receipt delivery re-sends the observed receipt, never the operation. */
export function useTaskRuntime({ getContext, executeUI, enabled = true, accessMode = 'APPROVAL' }) {
  const [tasks,setTasks] = useState([]), [selectedId,setSelectedId] = useState(null);
  const [error,setError] = useState(''), [submitting,setSubmitting] = useState(false);
  const callbacks=useRef({getContext,executeUI,accessMode}); callbacks.current={getContext,executeUI,accessMode};
  const alive=useRef(true), pendingCreate=useRef(null), unconfirmedCreate=useRef(null), requests=useRef(new Set());
  const localReceipts=useRef(new Map()), dispatching=useRef(new Set()), mutation=useRef(new Set()), uiControllers=useRef(new Map());
  const merge=useCallback(value=>{
    const task=unwrap(value); if(!taskId(task)||!alive.current)return task;
    setTasks(items=>{
      const current=items.find(item=>taskId(item)===taskId(task));
      if(current?.version>task.version||current?.revision>task.revision)return items;
      if(current?.updatedAt&&task.updatedAt&&Date.parse(current.updatedAt)>Date.parse(task.updatedAt))return items;
      return [task,...items.filter(item=>taskId(item)!==taskId(task))];
    });return task;
  },[]);
  const call=useCallback(async(path,body)=>{
    const controller=new AbortController();requests.current.add(controller);
    try{return await requestTask(path,body,{signal:controller.signal});}finally{requests.current.delete(controller);}
  },[]);
  const refresh=useCallback(async()=>{
    try {
      const response=await call('');
      if(!alive.current)return;
      for(const task of [...(response.items||[])].reverse())merge(task);
      setError('');
    }catch(failure){if(alive.current&&failure.name!=='AbortError')setError(failure.message);}
  },[call,merge]);
  useEffect(()=>{
    alive.current=true;if(!enabled)return;
    let stopped=false,timer;
    const poll=async()=>{await refresh();if(!stopped)timer=setTimeout(poll,1200);};
    void poll();
    return()=>{stopped=true;alive.current=false;clearTimeout(timer);for(const controller of requests.current)controller.abort();for(const controller of uiControllers.current.values())controller.abort();};
  },[enabled,refresh]);
  useEffect(()=>{
    if(!enabled)return;
    for(const [key,controller] of uiControllers.current){
      const current=tasks.find(task=>key.startsWith(taskId(task)+':'));
      if(current&&taskStatus(current)==='cancelled')controller.abort(new DOMException('任务已取消，停止等待界面回执。','AbortError'));
    }
    for(const task of tasks){
      const step=pendingTaskStep(task);if(!step)continue;
      const key=taskActionKey(task,step);if(dispatching.current.has(key))continue;
      dispatching.current.add(key);
      void(async()=>{
        try {
          const latest=unwrap(await call('/'+encodeURIComponent(taskId(task))));merge(latest);
          const active=pendingTaskStep(latest);
          if(!active||taskActionKey(latest,active)!==key)return;
          let ack=localReceipts.current.get(key);
          const saved=readStoredTaskReceipt(key);
          if(!ack&&saved?.receipt)ack=saved.receipt;
          if(!ack&&saved?.intent)ack={success:false,verified:false,unknownOutcome:true,argumentsDigest:active.argumentsDigest,contextIdentity:latest.contextIdentity,error:{message:'先前页面已开始此动作但没有保存终态回执；实际结果待核对，未重复执行。'}};
          if(!ack){
            storeTaskReceipt(key,{intent:true,argumentsDigest:active.argumentsDigest,contextIdentity:latest.contextIdentity});
            const controller=new AbortController();uiControllers.current.set(key,controller);
            try {
              const result=await callbacks.current.executeUI(active.uiAction,{task:latest,step:active,signal:controller.signal});
              ack={success:true,verified:true,argumentsDigest:active.argumentsDigest,contextIdentity:latest.contextIdentity,result};
            }catch(failure){const writes=['write','write_current','config','delete','WRITE_CURRENT','CONFIG','DELETE'].includes(active.effect);ack={success:false,verified:false,...(writes&&failure.definitiveNoEffect!==true?{unknownOutcome:true}:{}),argumentsDigest:active.argumentsDigest,contextIdentity:latest.contextIdentity,error:{message:failure.message}};}
            finally{uiControllers.current.delete(key);}
            localReceipts.current.set(key,ack);
            try{storeTaskReceipt(key,{intent:true,receipt:ack});}catch(failure){if(alive.current)setError('界面结果已取得，但本机会话回执未保存：'+failure.message);}
          }
          if(alive.current)merge(await call('/'+encodeURIComponent(taskId(task))+'/actions/'+encodeURIComponent(taskStepId(active))+'/ack',ack));
        }catch(failure){if(alive.current&&failure.name!=='AbortError')setError('执行回执尚未确认：'+failure.message);}
        finally{dispatching.current.delete(key);}
      })();
    }
  },[tasks,enabled,call,merge]);
  const start=useCallback(async goal=>{
    const text=String(goal||'').trim();if(!text||pendingCreate.current)return null;
    const mode=callbacks.current.accessMode||'APPROVAL';
    const request=unconfirmedCreate.current?.goal===text&&unconfirmedCreate.current?.access_mode===mode ? unconfirmedCreate.current
      : {goal:text,context:callbacks.current.getContext(text),clientRequestId:crypto.randomUUID(),access_mode:mode};
    pendingCreate.current=request;setSubmitting(true);setError('');
    unconfirmedCreate.current=request;
    try{const task=merge(await call('',request));unconfirmedCreate.current=null;setSelectedId(taskId(task));return task;}
    catch(failure){
      if(failure.status>=400&&failure.status<500&&failure.status!==408)unconfirmedCreate.current=null;
      if(failure.name!=='AbortError')setError(failure.message+(unconfirmedCreate.current?' 再次发送同一目标时会核对原请求，不重复创建。':''));throw failure;
    }
    finally{pendingCreate.current=null;if(alive.current)setSubmitting(false);}
  },[call,merge]);
  const mutate=useCallback(async(task,action,body={})=>{
    const id=taskId(task);if(mutation.current.has(id))return;
    mutation.current.add(id);setError('');
    try{return merge(await call('/'+encodeURIComponent(id)+'/'+action,body));}
    catch(failure){if(failure.name!=='AbortError')setError(failure.message);throw failure;}
    finally{mutation.current.delete(id);}
  },[call,merge]);
  const selected=tasks.find(task=>taskId(task)===selectedId)||tasks[0]||null;
  return {tasks,selected,select:setSelectedId,error,submitting,start,refresh,
    cancel:task=>{for(const [key,controller] of uiControllers.current)if(key.startsWith(taskId(task)+':'))controller.abort(new DOMException('用户已取消任务。','AbortError'));return mutate(task,'cancel');},
    resume:(task,input={})=>mutate(task,'resume',input),
    approve:task=>{
      const step=task.steps?.find(item=>item.status==='waiting_approval'||item.status==='needs_approval');
      if(!step)return Promise.reject(new Error('当前没有等待确认的操作。'));
      return mutate(task,'resume',{approval:{stepId:taskStepId(step),argumentsDigest:step.argumentsDigest,contextIdentity:task.contextIdentity}});
    },
  };
}
