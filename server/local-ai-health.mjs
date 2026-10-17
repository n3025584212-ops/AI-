const LABELS={READY:'可用',STARTING:'正在启动',SERVICE_OFFLINE:'服务未启动',MODEL_MISSING:'模型未找到',MODEL_LOADING:'模型加载中',MODEL_ERROR:'模型加载失败',REQUEST_ERROR:'请求失败'};
export function createLocalAiHealth({configuration,jsonRequest,infer,ensureService,now=Date.now,delay=ms=>new Promise(r=>setTimeout(r,ms)),retryDelayMs=800}){
 let state=null,pending=null,key=null,verified=null,lastProbe=0,revision=0;
 const publish=(status,extra={})=>{state={...state,...extra,providerStatus:status,status:status.toLowerCase(),available:status==='READY',reason:LABELS[status],latencyMs:status==='READY'?extra.latencyMs??state?.latencyMs??null:null};return state;};
 const failure=(error,stage)=>{
  const message=String(error.responseBody||error.cause?.message||error.message||'').slice(0,300);
  if(stage==='MODEL'&&error.code==='MODEL_NOT_FOUND'||error.httpStatus===404&&/model.*not found|not found.*model/i.test(message))return 'MODEL_MISSING';
  if(stage==='INFERENCE'&&/load|runner|memory|allocat|cuda|gpu/i.test(message))return 'MODEL_ERROR';
  if(stage==='SERVICE'&&(!error.httpStatus)&&!['LOCAL_LLM_RESPONSE','LOCAL_LLM_HTTP'].includes(error.code))return 'SERVICE_OFFLINE';
  return 'REQUEST_ERROR';
 };
 async function check(config,manual,identity){
  const current=()=>{if(identity!==revision)throw Object.assign(Error('AI check superseded'),{code:'AI_CHECK_SUPERSEDED'});};
  const started=now();let stage='SERVICE',launchAttempted=false;
  const maxAttempts=manual?3:1;
  for(let attempt=1;attempt<=maxAttempts;attempt++){
   state={...state,retryCount:attempt-1,checkedAt:new Date(now()).toISOString()};
   try{
    stage='SERVICE';const version=await jsonRequest(config,'/api/version');current();
    if(typeof version?.version!=='string')throw Object.assign(Error('Provider返回格式无效。'),{code:'LOCAL_LLM_RESPONSE'});
    state={...state,serviceStatus:'CONNECTED',runtimeVersion:version.version};
    stage='MODEL';const tags=await jsonRequest(config,'/api/tags');current();
    if(!Array.isArray(tags?.models))throw Object.assign(Error('模型列表返回格式无效。'),{code:'LOCAL_LLM_RESPONSE'});
    const model=tags.models.find(m=>m.name===config.model||m.model===config.model);
    if(!model)throw Object.assign(Error('请求的本地模型未找到。'),{code:'MODEL_NOT_FOUND'});
    state={...state,modelAvailability:'AVAILABLE',digest:model.digest??null,sizeBytes:model.size??null,quantization:model.details?.quantization_level??null};
    let loaded=null;try{const ps=await jsonRequest(config,'/api/ps');loaded=ps.models?.find(m=>m.name===config.model||m.model===config.model);}catch{}current();
    const size=loaded?.size||0,sizeVram=loaded?.size_vram||0;
    state={...state,loadStatus:loaded?'LOADED':'UNLOADED',processor:!loaded?'unloaded':sizeVram===0?'cpu':sizeVram>=size*.95?'gpu':'mixed',size,size_vram:sizeVram};
    const same=verified?.key===key&&verified.digest===state.digest;
    if(!manual&&same&&loaded&&now()-verified.at<60000){publish('READY',{inferenceTest:'PASS',latencyMs:verified.latencyMs,lastError:null,failureStage:null});break;}
    // A terminal inference failure is retried only by an explicit check, a new
    // configuration/model, or a genuinely recovered provider connection.
    if(!manual&&state.inferenceTest==='FAIL'&&['MODEL_ERROR','REQUEST_ERROR'].includes(state.providerStatus)&&state.failedDigest===state.digest)break;
    stage='INFERENCE';publish('MODEL_LOADING',{inferenceTest:'RUNNING',lastError:null,failureStage:null});
    const inferenceStarted=now(),result=await infer(config);current();
    if(result.model!==config.model||result.done!==true||typeof result.message?.content!=='string'||!result.message.content.trim()||!(result.eval_count>0))throw Object.assign(Error('最小推理未返回完整有效结果。'),{code:'INVALID_INFERENCE_RESPONSE'});
    verified={key,digest:state.digest,at:now(),latencyMs:Math.max(1,now()-inferenceStarted)};
    state={...state,processor:'unknown'};
    try{const ps=await jsonRequest(config,'/api/ps');current();const active=ps.models?.find(m=>m.name===config.model||m.model===config.model);if(active){const size=active.size||0,vram=active.size_vram||0;state={...state,size,size_vram:vram,processor:vram===0?'cpu':vram>=size*.95?'gpu':'mixed'};}}catch{}current();
    publish('READY',{inferenceTest:'PASS',inferenceCheckedAt:new Date(now()).toISOString(),loadStatus:'LOADED',latencyMs:verified.latencyMs,lastError:null,failureStage:null,failedDigest:null});break;
   }catch(error){
    if(identity!==revision)return {...state};
    const status=failure(error,stage),retryable=status==='SERVICE_OFFLINE'||stage==='INFERENCE'&&(error.code==='LOCAL_LLM_TIMEOUT'||error.name==='TimeoutError');
    verified=null;publish(status,{serviceStatus:stage==='SERVICE'?'DISCONNECTED':'CONNECTED',modelAvailability:status==='MODEL_MISSING'?'MISSING':state.modelAvailability,inferenceTest:stage==='INFERENCE'?'FAIL':'NOT_RUN',failureStage:stage,failedDigest:stage==='INFERENCE'?state.digest:null,lastError:{code:error.code||error.cause?.code||error.name||'AI_CHECK_FAILED',summary:LABELS[status],httpStatus:error.httpStatus??null}});
    if(!retryable||attempt===maxAttempts)break;
    if(status==='SERVICE_OFFLINE'&&manual&&ensureService&&!launchAttempted){
     launchAttempted=true;publish('STARTING');try{const launch=await ensureService(config);current();state={...state,launcherReason:launch?.reason??null};}catch{if(identity!==revision)return {...state};state={...state,launcherReason:'local_runtime_launch_failed'};}
    }
    await delay(retryDelayMs);if(identity!==revision)return {...state};
   }
  }
  lastProbe=now();state={...state,checkedAt:new Date(now()).toISOString(),checkElapsedMs:now()-started};return state;
 }
 async function status({force=false}={}){
  const config=await configuration({statusOnly:true}),nextKey=JSON.stringify([config.provider,config.endpoint,config.model]);
  if(key!==nextKey){revision++;pending=null;key=nextKey;verified=null;lastProbe=0;state={configured:true,mode:'local',provider:config.provider,model:config.model,endpoint:config.endpoint,apiPath:'/api/chat',toolCalling:true,cloudFallback:false,serviceStatus:'UNKNOWN',modelAvailability:'UNKNOWN',loadStatus:'UNKNOWN',inferenceTest:'NOT_RUN'};publish('STARTING');}
  if(pending)return force?pending:{...state};
  if(!force&&lastProbe&&now()-lastProbe<15000)return {...state};
  const initial=!lastProbe;
  const identity=revision;pending=check(config,force||initial,identity).finally(()=>{if(identity===revision)pending=null;});
  return force?pending:{...state};
 }
 function requestFailed(error){if(!state)return;revision++;pending=null;lastProbe=now();verified=null;publish(failure(error,'INFERENCE'),{inferenceTest:'FAIL',failedDigest:state.digest,lastError:{code:error.code||'AI_REQUEST_FAILED',summary:'AI请求失败'},failureStage:'INFERENCE'});}
 return {status,requestFailed};
}
