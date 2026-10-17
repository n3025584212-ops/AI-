import {freezeReportPayload} from './predictionSnapshot.js';
import {buildAssistantFactPacket} from './assistantFacts.js';
const id=()=>globalThis.crypto.randomUUID();
export function createAssistantTurn(question,context,{retryOf}={}){
 const request_id=id(),user_message_id=retryOf?.user_message_id||id();
 const frozen=freezeReportPayload(context);
 return {request_id,user_message_id,request_snapshot_id:frozen.request_snapshot_id??frozen.input_snapshot?.snapshot_id??null,
  retry_of_request_id:retryOf?.request_id??null,response_version:(retryOf?.response_version||0)+1,
  question,context:frozen,fact_packet:buildAssistantFactPacket(frozen,{request_id,user_message_id}),attempt:1,settled:false,started:false};
}
export const assistantTurnIdentity=turn=>({request_id:turn.request_id,user_message_id:turn.user_message_id,
 request_snapshot_id:turn.request_snapshot_id,retry_of_request_id:turn.retry_of_request_id,response_version:turn.response_version});
export const assistantTurnRequest=turn=>({...assistantTurnIdentity(turn),request_capture:true});
export function startAssistantTurn(messages,turn){
 if(turn.retry_of_request_id)return messages;
 return [...messages,{role:'user',text:turn.question,...assistantTurnIdentity(turn)}];
}
export function startAssistantFallback(turn){if(turn.settled)return null;turn.attempt++;return turn.attempt;}
// The slot belongs to a user message, not its text or a transport event.
// Streaming, polling, fallback and retry replace this one slot.
export function writeAssistantResponse(messages,turn,patch,{attempt=turn.attempt,final=false,accepted=false}={}){
 if(!accepted&&(turn.settled||attempt!==turn.attempt))return messages;
 const at=messages.findIndex(m=>m.role==='assistant'&&m.user_message_id===turn.user_message_id);
 const prior=at<0?{}:messages[at];
 const update=typeof patch==='function'?patch(prior):patch;
 const value={...prior,...update,role:'assistant',fact_packet:update.fact_packet||prior.fact_packet||turn.fact_packet,...assistantTurnIdentity(turn),final_response:final};
 if(at<0)return [...messages,value];
 return messages.map((m,index)=>index===at?value:m);
}
// Reserve the transition before scheduling a React updater. The updater itself
// is pure, including when React evaluates it twice in development mode.
export function assistantResponseUpdate(turn,patch,options={}){
 if(turn.settled||(options.attempt??turn.attempt)!==turn.attempt)return messages=>messages;
 if(options.final)turn.settled=true;
 return messages=>writeAssistantResponse(messages,turn,patch,{...options,accepted:true});
}
