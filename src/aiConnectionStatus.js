export const AI_STATUS_LABELS=Object.freeze({READY:'可用',STARTING:'正在启动',SERVICE_OFFLINE:'服务未启动',MODEL_MISSING:'模型未找到',MODEL_LOADING:'模型加载中',MODEL_ERROR:'模型加载失败',REQUEST_ERROR:'请求失败'});
export function aiConnectionState(status={}){
 status=status||{};
 const code=({OFFLINE:'SERVICE_OFFLINE',ERROR:'REQUEST_ERROR'})[status.providerStatus]||status.providerStatus;
 const ready=code==='READY'&&status.available===true&&status.inferenceTest==='PASS';
 return {code:ready?'READY':code==='READY'?'UNKNOWN':code,available:ready,label:ready?'可用':code==='READY'?'推理状态待确认':AI_STATUS_LABELS[code]||'连接状态待确认',tone:ready?'good':['SERVICE_OFFLINE','MODEL_MISSING','MODEL_ERROR','REQUEST_ERROR'].includes(code)?'error':'idle',latencyMs:ready&&Number.isFinite(status.latencyMs)?status.latencyMs:null};
}
export function safeAiEndpoint(value){
 try{const url=new URL(value);if(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&!url.username&&!url.password&&!url.search&&!url.hash)return url.origin;}catch{}
 return null;
}
