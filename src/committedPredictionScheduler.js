export const AUTO_PREDICT_DEBOUNCE_MS = 250;
export const PREDICTION_STATUS_TEXT = Object.freeze({
  STALE: '当前输入已变化 · 正在准备重新预测',
  PREDICTING: 'QCDKR正在计算当前工况',
  READY: '当前工况预测已更新',
  FAILED: '当前工况预测暂未完成',
});

/** One natural-completion request and one replaceable committed snapshot.
 * Superseding revokes eligibility only; it never aborts a shared calculation.
 */
export function createCommittedPredictionScheduler({execute,accept,onState=()=>{},onTrace=()=>{},
  setTimer=setTimeout,clearTimer=clearTimeout,now=()=>performance.now()}={}) {
  let active=null,pending=null,inFlight=null,timer=null,stopped=false,version=0,readyKey=null;
  const trace=(stage,job,extra={})=>onTrace({stage,request_id:job?.request_id,commit_identity:job?.key,...extra});
  const clear=()=>{if(timer!==null)clearTimer(timer);timer=null;};
  const current=job=>!stopped&&active===job&&job.version===version;
  const arm=()=>{
    clear();if(stopped||inFlight||!pending)return;
    timer=setTimer(run,Math.max(0,pending.enqueuedAt+AUTO_PREDICT_DEBOUNCE_MS-now()));
  };
  async function run(){
    timer=null;if(stopped||inFlight||!pending)return;
    const job=pending;pending=null;if(!current(job))return;
    inFlight=job;const requestStarted=now();onState('PREDICTING',job);
    try {
      const result=await execute(job,()=>current(job),event=>trace(event.stage,job,event));
      trace('PREDICT_EXECUTION_COMPLETED',job,{request_duration_ms:now()-requestStarted});
      if(!current(job)){trace('STALE_RESULT_DISCARDED',job);return;}
      const received=now();await accept(result,job,()=>current(job),event=>trace(event.stage,job,event));
      if(!current(job)){trace('STALE_RESULT_DISCARDED',job);return;}
      readyKey=job.key;onState('READY',job);
      trace('CURRENT_PREDICTION_STATE_READY',job,{snapshot_id:job.snapshot?.snapshot_id});
      trace('UI_READY_COMMITTED',job,{response_to_ready_ms:now()-received});
    }catch(error){if(current(job)){onState('FAILED',job,error);trace('PREDICT_FAILED',job,{code:error.code||'PREDICTION_FAILED'});}else trace('STALE_RESULT_DISCARDED',job);}
    finally{inFlight=null;arm();}
  }
  return {
    submit(value,{force=false}={}){
      if(stopped||!value?.key)return false;
      if(!force&&(active?.key===value.key||readyKey===value.key))return false;
      const job={...value,version:++version,enqueuedAt:now(),request_id:crypto.randomUUID()};
      active=job;pending=job;trace('COMMITTED_INPUT',job);onState('STALE',job);arm();return true;
    },
    invalidate(){version++;active=null;pending=null;readyKey=null;clear();},
    state:()=>({inFlight:inFlight?1:0,pending:pending?1:0,activeKey:active?.key,readyKey}),
    stop(){stopped=true;version++;pending=null;active=null;clear();},
  };
}
