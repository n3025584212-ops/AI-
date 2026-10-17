// One eligible Candidate Review at a time, with no queue. Cancellation revokes
// result eligibility and cancels only the existing agent Run, never a service.
export function createCandidateReviewClient(request,{timeoutMs=185000,pollMs=450,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 let active=null;
 const discard=job=>{
  if(job.runId&&!job.cancelSent){job.cancelSent=true;void request('/agent/runs/'+job.runId+'/cancel',{method:'POST',body:'{}'}).catch(()=>{});}
 };
 function stop(job,reason){
  if(job.reason)return;
  job.reason=reason;discard(job);job.controller.abort();
 }
 const cancel=(reason='CANCELLED')=>{if(active)stop(active,reason);};
 async function review({body,identity,current,prepare=async()=>{},validate=()=>true,onState=()=>{},onLock=()=>{}}){
  if(active)return {status:'BUSY'};
  const job={identity,controller:new AbortController(),runId:null,reason:null};active=job;onLock(true);onState({status:'requesting'});
  const valid=()=>active===job&&!job.reason&&current(job.identity);
  const timer=setTimeout(()=>stop(job,'TIMEOUT'),timeoutMs);
  const aborted=new Promise(resolve=>job.controller.signal.addEventListener('abort',()=>resolve(null),{once:true}));
  async function execute(){
   await prepare(job.controller.signal);
   if(!valid()){stop(job,'STALE');return null;}
   let response=await request('/agent/runs',{method:'POST',signal:job.controller.signal,body:JSON.stringify(body)});
   job.runId=response.runId;
   if(!valid()){discard(job);return null;}
   const terminal=['completed','partial','failed','cancelled','stale_context','needs_input'];
   while(!terminal.includes(response.status)){
    if(!valid()){stop(job,'STALE');return null;}
    await Promise.race([wait(pollMs),aborted]);
    if(!valid()){stop(job,'STALE');return null;}
    response=await request('/agent/runs/'+job.runId,{signal:job.controller.signal});
   }
   if(!valid()||!validate(response,job.identity)){stop(job,'STALE');return null;}
   return response;
  }
  try{
   const response=await Promise.race([execute(),aborted]);
   if(!response||!valid()){
    onState({status:'unavailable',reason:job.reason||'STALE'});return {status:job.reason||'STALE'};
   }
   const ready=response.status==='completed'&&Boolean(response.explanation_text);
   onState({status:ready?'ready':'unavailable',text:response.explanation_text,facts:response.server_fact_fields,
    boundary:response.evidence_boundary,reason:ready?undefined:response.error?.code||'AI_FAILED'});
   return response;
  }catch(error){
   stop(job,job.reason||(!current(job.identity)?'STALE':error.code||'FAILED'));
   onState({status:'unavailable',reason:job.reason});return {status:job.reason};
  }finally{
   clearTimeout(timer);
   if(active===job){active=null;onLock(false);}
  }
 }
 return {review,cancel,isBusy:()=>Boolean(active),identity:()=>active?.identity};
}
