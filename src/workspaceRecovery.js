import { predictionIdentity, sameIdentity, reportInputFingerprint } from './predictionSnapshot.js';
import { summarizeModelInputs } from './modelInputs.js';

export const FAST_RETRY_COUNT = 3, SLOW_POLL_COUNT = 12;
export const FAST_RETRY_INTERVAL_MS = 800, SLOW_POLL_INTERVAL_MS = 5000;
export const MAX_AUTOMATIC_RECOVERY_WINDOW_MS = 62400;
export const RECOVERY_CONNECTING = '正在重新连接预测服务…';
export const RECOVERY_UNAVAILABLE = '预测服务暂未就绪，请稍后刷新重试。';
export const RECOVERY_INPUT_CHANGED = '当前工况已变化，等待有效输入后重新预测。';
export const REFRESH_CONFIRMATION = '当前有未确认的操作，刷新后将丢失这些临时修改，是否继续？';

export const formalModelReady = status => status?.available === true && status.mode !== 'demo'
  && !['BLOCKED','FAILED','ERROR'].includes(String(status.status || '').toUpperCase());

export async function requestWorkspaceJson(path, {signal,fetchImpl=globalThis.fetch}={}) {
  try {
    const response=await fetchImpl('/api'+path,{credentials:'same-origin',cache:'no-store',signal,headers:{'Content-Type':'application/json'}});
    if(response.status===401)globalThis.window?.dispatchEvent(new Event('dkqkar-session-expired'));
    const body=await response.text(),type=response.headers.get('content-type') || '';
    if(!response.ok||!body.trim()||!/^application\/(?:json|[\w.+-]+\+json)(?:\s*;|$)/i.test(type))throw Error('service unavailable');
    const value=JSON.parse(body);
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid projection');
    return value;
  }catch(error){if(signal?.aborted)throw signal.reason;throw new Error(RECOVERY_UNAVAILABLE);}
}
export async function probeWorkspaceReadiness({signal,fetchImpl}={}) {
  const [health,model]=await Promise.all([
    requestWorkspaceJson('/health',{signal,fetchImpl}),requestWorkspaceJson('/model/status',{signal,fetchImpl}),
  ]);
  return {backendReady:health.ok===true,modelReady:formalModelReady(model),model};
}

// Existing server-issued snapshot identity; before issuance, use the existing
// current operation scope and context fingerprint used by /predict acceptance.
export function recoveryProjection({input,prediction,input_snapshot,observation,operation_scope}) {
  return {input,prediction,input_snapshot,observation,operation_scope,
    identity:input_snapshot?predictionIdentity(prediction,observation):null,
    contextFingerprint:reportInputFingerprint(input)};
}
export function sameRecoveryProjection(a,b) {
  return Boolean(a&&b)
    && reportInputFingerprint(a.operation_scope)===reportInputFingerprint(b.operation_scope)
    && a.contextFingerprint===b.contextFingerprint
    && (a.identity||b.identity ? sameIdentity(a.identity,b.identity) : true);
}
export function recoveryProjectionValid(projection) {
  const scope=projection?.operation_scope;
  return typeof scope?.session_id==='string'&&!!scope.session_id
    && Number.isSafeInteger(scope.revision)&&scope.revision>=0
    && summarizeModelInputs(projection.input).valid;
}
export function selectRecoveryProjection(pending,current) {
  return {stale:!!pending&&!sameRecoveryProjection(pending,current),current,
    eligible:recoveryProjectionValid(current)};
}

export function dirtyTransientState({candidatePreview=false,trialIntent=false,parameterEdits=false,dataEdits=false}={}) {
  return Boolean(candidatePreview||trialIntent||parameterEdits||dataEdits);
}
export function installWorkspaceRefresh(handler, target=globalThis.window) {
  const invoke=()=>{void Promise.resolve(handler()).catch(()=>{});};
  const keydown=event=>{
    if(event.defaultPrevented||event.isComposing||event.altKey)return;
    if(event.key==='F5'||(event.ctrlKey||event.metaKey)&&event.key?.toLowerCase()==='r'){
      event.preventDefault();invoke();
    }
  };
  target.addEventListener('keydown',keydown);
  const unsubscribe=target.dkqkar?.onRefreshWorkspace?.(invoke);
  return ()=>{target.removeEventListener('keydown',keydown);unsubscribe?.();};
}
export async function reloadWorkspaceRenderer(target=globalThis.window) {
  if(target.dkqkar?.reloadRenderer) {
    const response=await target.dkqkar.reloadRenderer();
    if(response?.error)throw Error(RECOVERY_UNAVAILABLE);
  } else target.location.reload();
}

/** One bounded, cancellable recovery episode; no prediction inside the poller. */
export function createReadinessRecovery({probe=probeWorkspaceReadiness,capture,onReady,onState=()=>{},
  setTimer=setTimeout,clearTimer=clearTimeout,clock=Date.now}={}) {
  let stopped=false,active=null,phase='IDLE',sequence=0;
  const publish=value=>{phase=value;onState(value);};
  function stop(){sequence++;if(active){clearTimer(active.timer);clearTimer(active.deadline);active.controller.abort();active.request?.abort();active=null;}stopped=true;}
  function start({immediate=false}={}) {
    if(active)return;
    stopped=false;const token=++sequence,pending=capture(),started=clock();
    const episode={pending,controller:new AbortController(),index:0,timer:null,deadline:null};active=episode;
    const current=()=>!stopped&&active===episode&&sequence===token;
    const finish=()=>{
      if(!current())return;clearTimer(episode.timer);clearTimer(episode.deadline);episode.controller.abort();episode.request?.abort();active=null;publish('EXHAUSTED');
    };
    const offsets=[800,1600,2400,...Array.from({length:12},(_,i)=>2400+(i+1)*5000)];
    const arm=()=>{
      if(!current())return;
      if(episode.index>=offsets.length){finish();return;}
      publish(episode.index<3?'FAST_RETRY':'SLOW_POLL');
      const at=offsets[episode.index++];
      episode.timer=setTimer(()=>void check(),Math.max(0,started+at-clock()));
    };
    const check=async()=>{
      if(!current())return;
      const request=new AbortController();episode.request=request;
      let timeout;
      try {
        const last=episode.index===offsets.length;
        const timeoutMs=episode.index<=3||last?700:4500;
        const expired=new Promise((_,reject)=>{timeout=setTimer(()=>{request.abort();reject(Error(RECOVERY_UNAVAILABLE));},timeoutMs);});
        const status=await Promise.race([probe({signal:AbortSignal.any([episode.controller.signal,request.signal])}),expired]);
        if(!current())return;
        if(status.backendReady&&status.modelReady){
          clearTimer(episode.timer);clearTimer(episode.deadline);active=null;publish('READY');
          onReady(status,selectRecoveryProjection(pending,capture()),{recovered:episode.index>0});return;
        }
      }catch {if(!current())return;}
      finally{clearTimer(timeout);if(episode.request===request)episode.request=null;}
      arm();
    };
    // End the episode even when a transport ignores AbortSignal or never settles.
    // The last scheduled poll starts at the nominal window boundary.
    episode.deadline=setTimer(finish,MAX_AUTOMATIC_RECOVERY_WINDOW_MS+700);
    if(immediate){publish('CHECKING');void check();}else arm();
  }
  return {start,stop,state:()=>({phase,active:!!active})};
}
