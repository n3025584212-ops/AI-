// Signed model predictions and in-flight work only. Target and Actual never
// participate in this store; projections and selection belong to other caches.
export function createActionPredictionCache({evaluate,isActive,now=Date.now,batchSize=24,maxEntries=128}) {
 if(!Number.isInteger(batchSize)||batchSize<1||batchSize>48||!Number.isInteger(maxEntries)||maxEntries<1)throw Error('候选缓存配置无效。');
 const entries=new Map(),queue=[];let pumping=false,closed=false;
 const priority=run=>run.execution_path==='USER_INITIATED_SEARCH'?300-run.current_level:run.execution_path==='BACKGROUND_PREFETCH'?200:100;
 const consumers=task=>[...task.consumers].filter(isActive);
 function remove(task){for(const [tuple,value] of task.entry.actions)if(value===task)task.entry.actions.delete(tuple);task.entry.inputs.delete(task.inputKey);}
 function fail(task,error){remove(task);task.reject(error);}
 async function pump(){
  if(pumping||closed)return;pumping=true;
  try{
   while(queue.length&&!closed){
    for(let i=queue.length-1;i>=0;i--)if(!consumers(queue[i]).length){const [task]=queue.splice(i,1);fail(task,Error('搜索身份已失效。'));}
    queue.sort((a,b)=>Math.max(...consumers(b).map(priority))-Math.max(...consumers(a).map(priority))||a.order-b.order);
    const batch=queue.splice(0,batchSize);if(!batch.length)break;
    // A running batch completes before the next priority decision. Each tuple
    // is registered before scheduling, so every consumer awaits this promise.
    const charged=new Set();
    for(const task of batch){task.state='RUNNING';const owner=consumers(task).sort((a,b)=>priority(b)-priority(a))[0];
     if(owner){owner.dk_qkar_inference_count++;charged.add(owner);}task.inferredBy=owner;}
    for(const run of charged)run.inference_batch_count++;
    try{
     const predictions=await evaluate(batch.map(task=>task.input));
     if(predictions.length!==batch.length)throw Error('模型未完成整个候选批次。');
     for(let i=0;i<batch.length;i++){
      const task=batch[i],prediction=predictions[i],identity=task.entry.identity;
      if(prediction?.mode!=='formal'||prediction.model_hash!==identity.modelHash||prediction.model_version!==identity.modelIdentity
       ||!Number.isFinite(prediction.value)||!prediction.receipt||JSON.stringify(prediction.input_snapshot?.values)!==task.inputKey)
       throw Error('候选模型身份、输入或输出无效。');
     }
     batch.forEach((task,index)=>{task.state='READY';task.prediction=structuredClone(predictions[index]);task.input=null;task.inferredBy=null;task.completedAt=now();task.consumers.clear();task.resolve(task);});
    }catch(error){batch.forEach(task=>fail(task,error));}
   }
  }finally{pumping=false;}
 }
 let sequence=0;
 return {
  entry(key,identity){
   if(!entries.has(key)){
    if(entries.size>=maxEntries){const old=[...entries].find(([,entry])=>[...entry.actions.values()].every(task=>task.state==='READY'));if(old)entries.delete(old[0]);}
    entries.set(key,{identity:structuredClone(identity),actions:new Map(),inputs:new Map()});
   }
   return entries.get(key);
  },
  request(entry,candidate,run){
   const tuple=JSON.stringify(candidate.action_steps_percent),existing=entry.actions.get(tuple)||entry.inputs.get(candidate.input_key);
   run.prediction_cache_total++;
   if(existing){if(existing.state!=='READY')existing.consumers.add(run);entry.actions.set(tuple,existing);run.prediction_cache_hits++;run.cache_hit_count++;
    if(existing.state!=='READY')run.inflight_reuse_count++;if(run.current_level===1)run.level1_cache_hit=true;return existing.promise;}
   const task={entry,tuple,inputKey:candidate.input_key,input:candidate.input,consumers:new Set([run]),state:'QUEUED',order:sequence++};
   task.promise=new Promise((resolve,reject)=>{task.resolve=resolve;task.reject=reject;});
   entry.actions.set(tuple,task);entry.inputs.set(candidate.input_key,task);queue.push(task);
   queueMicrotask(()=>void pump());return task.promise;
  },
  close(){closed=true;for(const task of queue.splice(0))fail(task,Error('候选计算已关闭。'));entries.clear();}
 };
}
