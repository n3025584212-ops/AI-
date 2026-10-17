// Display filtering only: issuance and authenticity checks live on the backend.
import { findingKind, validateFinding, findingEvidenceMatches } from './findingContract.js';
const compatibleFinding = f => { try { validateFinding(f); return true; } catch { return false; } };
export function evidenceForIdentity(bundle, prediction, observation = prediction?.observation) {
  if (!prediction?.snapshot_id || prediction.mode !== 'formal' || bundle?.evidence_status !== 'VALID' && bundle?.status !== 'VALID') return {status:'UNAVAILABLE',evidence:[],findings:[]};
  const evidence = [...new Map((bundle.evidence || []).map(e=>[e.evidence_id,e])).values()].filter(e => /^EV-/.test(e.evidence_id || '') && /^[a-f0-9]{64}$/.test(e.receipt || '')
    && e.snapshot_id === prediction.snapshot_id && e.input_hash === prediction.input_hash && e.model_hash === prediction.model_hash && e.model_version === prediction.model_version
    && ['PREDICTION','OBSERVATION','DRAFT_COMPARISON'].includes(e.type) && ['VALID','PENDING'].includes(e.status)
    && (e.type !== 'OBSERVATION' || e.observation_id === observation?.observation_id)
    && (e.type !== 'DRAFT_COMPARISON' || e.target_snapshot_id === prediction.snapshot_id && e.baseline_snapshot_id !== e.target_snapshot_id && e.candidate_preview_snapshot_id !== e.target_snapshot_id));
  const findings = [...new Map((bundle.findings || []).map(f=>[f.finding_id,f])).values()].filter(f => compatibleFinding(f) && /^FD-/.test(f.finding_id || '') && /^[a-f0-9]{64}$/.test(f.receipt || '')
    && f.snapshot_id === prediction.snapshot_id && ['SYSTEM','TOOL'].includes(f.created_by) && ['VALID','PENDING'].includes(f.status)
    && (!findingKind(f.kind).observation_bound || f.observation_id === observation?.observation_id) && findingEvidenceMatches(f,evidence)
    && f.evidence_ids.every(id => evidence.some(e => e.evidence_id === id && (f.status !== 'VALID' || e.status === 'VALID'))));
  return {status:'VALID',evidence,findings};
}

export function messageEvidence(message, binding) {
  const records = evidenceForIdentity(message,{snapshot_id:message.snapshot_id,input_hash:message.input_hash,model_hash:message.model_hash,model_version:message.model_version,mode:message.prediction_mode || 'formal'},{observation_id:message.observation_id});
  const historical = !binding?.valid || ['snapshot_id','input_hash','model_hash','model_version'].some(key=>binding[key]!==message[key]) || binding.contextFingerprint && message.contextFingerprint && binding.contextFingerprint!==message.contextFingerprint;
  const status = (e,bound) => historical || bound && binding.observation_id !== e.observation_id ? 'STALE' : e.status;
  return {...records,evidence:records.evidence.map(e=>({...e,status:status(e,e.type==='OBSERVATION')})),findings:records.findings.map(f=>({...f,status:status(f,findingKind(f.kind).observation_bound)}))};
}
