import { assertPredictionBinding, assertObservationBinding } from './predictionSnapshot.js';

// Read-only presentation of the last accepted complete stream row. This does
// not make that row current, change dirty/readiness, or authorize any action.
export function pendingStreamPredictionDisplay({dirty,predictionState,stream,completed,modelStatus}) {
 if(!dirty||!['STALE','PREDICTING'].includes(predictionState)
  ||(!stream?.reviewing&&(!stream?.mode||stream.mode==='manual'))
  ||!completed?.activeSnapshot||!Number.isFinite(completed.result?.value)
  ||!modelStatus?.available||completed.result.model_hash!==modelStatus.model_hash
  ||completed.result.model_version!==modelStatus.model_version)return null;
 try {
  assertPredictionBinding(completed.result,completed.caseData,{input_snapshot:completed.activeSnapshot,mode:'formal',
   model_hash:modelStatus.model_hash,model_version:modelStatus.model_version});
  assertObservationBinding(completed.observation,completed.activeSnapshot);
  if(completed.sample?.observation?.observation_id!==completed.observation.observation_id
   ||completed.sample?.observation_id!==completed.observation.observation_id)return null;
  return completed;
 } catch { return null; }
}
