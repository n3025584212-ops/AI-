import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { StateError, now } from './local-state.mjs';
import { deepFreeze, reportInputFingerprint } from '../src/predictionSnapshot.js';
import { createDraft, draftBaselineIdentity, validateDraftCandidate, acceptDraftPrediction } from '../src/draftState.js';
import { formatEngineering } from '../src/engineeringUnits.js';
import { findingKind, normalizeTargets, validateFinding, projectFinding, findingEvidenceMatches, linkExistingEventFinding } from '../src/findingContract.js';

export const EVIDENCE_UNAVAILABLE = Object.freeze({ status: 'UNAVAILABLE', evidence: [], findings: [], message: '证据记录暂不可用，无法形成已验证结论。' });
export const EVIDENCE_SOFT_DEADLINE_MS = 2000;
export async function evidenceOrUnavailable(operation, { onSoftDeadline } = {}) {
  let timer;
  // A slow, live verification is still pending. Only a real failure terminates it.
  try { timer=setTimeout(()=>onSoftDeadline?.(),EVIDENCE_SOFT_DEADLINE_MS); return await operation(); }
  catch { return structuredClone(EVIDENCE_UNAVAILABLE); }
  finally { clearTimeout(timer); }
}
const superseded = () => new StateError('诊断采集已被替换或取消。',409,'EVIDENCE_SUPERSEDED');
const checkCapture = ({ signal, current } = {}) => { signal?.throwIfAborted(); if(current && !current())throw superseded(); };
const equal = (a, b) => reportInputFingerprint(a) === reportInputFingerprint(b);
const unsigned = ({ receipt, ...value }) => value;
const invalid = () => { throw new StateError('证据引用不存在、已篡改或不属于该快照。', 409, 'EVIDENCE_SCOPE'); };

/** Metadata references only. Signed business values stay in the existing result/observation. */
export function createEvidenceStore({ state, verifyContext, onCaptureLifecycle }) {
  const sources = new Set(), plans = new Map();
  const currentCaptures = new Map();
  let closed=false,closing;
  const emit = (event, operation, extra = {}) => {
    if(!onCaptureLifecycle)return;
    try { onCaptureLifecycle({event,at_ms:performance.now(),capture_id:operation?.id,snapshot_id:operation?.snapshotId,...extra}); } catch { /* Optional diagnostic observer cannot change verification. */ }
  };
  let key;
  async function signingKey(options = {}) {
    checkCapture(options);
    if (!key) {
      const saved = await state.read('evidence-key.json', null, options);
      checkCapture(options);
      const next = saved || randomBytes(32).toString('hex');
      if (!/^[a-f0-9]{64}$/.test(next)) throw new Error('Evidence key unavailable');
      if (!saved) await state.write('evidence-key.json', next, options);
      checkCapture(options);
      key = next;
    }
    return key;
  }
  const sign = async (value, options) => { const signing = await signingKey(options); checkCapture(options); return { ...value, receipt: createHmac('sha256', signing).update(reportInputFingerprint(value)).digest('hex') }; };
  async function read(options = {}) {
    checkCapture(options);
    const data = await state.read('evidence-records.json', { evidence: [], findings: [] }, options);
    checkCapture(options);
    if (!Array.isArray(data.evidence) || !Array.isArray(data.findings)) throw new Error('Evidence storage unavailable');
    let verifiedCount = 0;
    for (const item of [...data.evidence, ...data.findings]) {
      checkCapture(options);
      // Yield during large archives so request cancellation reaches the queue owner.
      if(++verifiedCount % 32 === 0)await yieldTurn(undefined,{signal:options.signal});
      if (!item.receipt || (await sign(unsigned(item),options)).receipt !== item.receipt) throw new Error('Evidence record modified');
      if (item.evidence_id && (!/^EV-/.test(item.evidence_id) || !['PREDICTION','OBSERVATION','DRAFT_COMPARISON'].includes(item.type))) throw new Error('Evidence schema');
      if (item.finding_id) validateFinding(item,{persisted:true});
    }
    // Per-read index only: every record above is freshly signature/schema checked.
    // Keep the first match, exactly as the contract's Array.find did, and still
    // run the original reference/identity validator on each selected reference.
    const evidenceById = new Map();
    for (const item of data.evidence) if (!evidenceById.has(item.evidence_id)) evidenceById.set(item.evidence_id,item);
    for (const finding of data.findings) {
      checkCapture(options);
      if(++verifiedCount % 32 === 0)await yieldTurn(undefined,{signal:options.signal});
      if (!findingEvidenceMatches(finding,finding.evidence_ids.map(id=>evidenceById.get(id)).filter(Boolean))) throw new Error('Finding reference');
    }
    return data;
  }
  async function audit(task, options = {}) {
    const callerCurrent=options.current;
    options={...options,current:()=>!closed&&(!callerCurrent||callerCurrent())};
    const queuedAt = performance.now();
    emit('QUEUED',options.operation);
    return evidenceOrUnavailable(()=>state.mutate(async () => {
      emit('QUEUE_ACQUIRED',options.operation,{queue_wait_ms:performance.now()-queuedAt});
      try { checkCapture(options); const data=await read(options);checkCapture(options);return await task(data); }
      finally { emit('QUEUE_RELEASED',options.operation); }
    },options),{onSoftDeadline:()=>emit('SOFT_DEADLINE',options.operation,{status:'PENDING'})});
  }
  async function source(prediction, observation = prediction?.observation) {
    // Never enter freezeContext's NEW calculation branch; only authenticate existing records.
    if (!prediction?.snapshot_id || !prediction.input_snapshot || !observation?.observation_id
      || !prediction.inputContext || typeof prediction.inputContext !== 'object' || Array.isArray(prediction.inputContext)) invalid();
    return verifyContext({ caseData: prediction.inputContext, prediction, input_snapshot: prediction.input_snapshot, observation });
  }
  async function evidence(data, fields, options) {
    checkCapture(options);
    const old = data.evidence.find(e => e.source_ref === fields.source_ref);
    if (old) {
      if (!Object.entries(fields).every(([k,v]) => equal(old[k],v))) invalid();
      return old;
    }
    const item = await sign({ evidence_id: `EV-${randomUUID()}`, ...fields, created_at: now(), status: 'VALID' },options);
    checkCapture(options);
    data.evidence.push(item); return item;
  }
  async function finding(data, snapshot, kind, statement, evidenceIds, observationId = null, options) {
    checkCapture(options);
    const metadata = findingKind(kind);
    const fields = { schema_version:'finding-v2', finding_id:`FD-${randomUUID()}`, snapshot_id:snapshot, observation_id:observationId,
      kind, title:metadata.title, targets:normalizeTargets(metadata.targets), statement, evidence_ids:evidenceIds, status:'VALID', created_by:'SYSTEM', created_at:now() };
    validateFinding({...fields,receipt:'0'.repeat(64)},{persisted:true});
    if (!findingEvidenceMatches({...fields,receipt:'0'.repeat(64)},data.evidence)
      || !evidenceIds.every(id => sources.has(data.evidence.find(e => e.evidence_id === id)?.source_ref))) invalid();
    const old = data.findings.find(f => f.kind === kind && equal(f.evidence_ids,evidenceIds));
    if (old) return old;
    const item = await sign(fields,options);
    checkCapture(options);
    data.findings.push(item); return item;
  }
  function projection(data, snapshotId, observationId, history = false) {
    const status = e => e.snapshot_id !== snapshotId || (e.type === 'OBSERVATION' && e.observation_id !== observationId) ? 'STALE' : sources.has(e.source_ref) ? 'VALID' : 'PENDING';
    const evidence = data.evidence.map(e => ({ ...e, status:status(e) })).filter(e => history || e.snapshot_id === snapshotId && (e.type !== 'OBSERVATION' || e.observation_id === observationId));
    const findings = data.findings.map(f => projectFinding(f,f.snapshot_id !== snapshotId || findingKind(f.kind).observation_bound && f.observation_id !== observationId ? 'STALE'
      : f.evidence_ids.every(id => evidence.some(e => e.evidence_id === id && e.status === 'VALID')) ? 'VALID' : 'PENDING'))
      .filter(f => history || f.snapshot_id === snapshotId && (!findingKind(f.kind).observation_bound || f.observation_id === observationId));
    return { status:'VALID', evidence, findings };
  }
  async function captureVerified(context, options = {}) {
    checkCapture(options);
    const p = context.prediction, o = context.observation;
    if (p.mode !== 'formal' || !/^[a-f0-9]{64}$/.test(p.model_hash || '') || !p.model_version || !Number.isFinite(p.value)) return structuredClone(EVIDENCE_UNAVAILABLE);
    const predictionRef = `prediction:${p.snapshot_id}:${p.receipt}`, observationRef = `observation:${o.observation_id}:${o.receipt}`;
    sources.add(predictionRef); sources.add(observationRef);
    return audit(async data => {
      const count = data.evidence.length + data.findings.length;
      const identity = { snapshot_id:p.snapshot_id, input_hash:p.input_hash, model_hash:p.model_hash, model_version:p.model_version };
      const pe = await evidence(data,{...identity,type:'PREDICTION',observation_id:null,source_ref:predictionRef,source_kind:'DK_QKAR_RESULT'},options);
      const oe = await evidence(data,{...identity,type:'OBSERVATION',observation_id:o.observation_id,source_ref:observationRef,source_kind:'S5_OBSERVATION_RECORD',source_label:o.source || 'unknown'},options);
      const target = p.inputContext.target;
      if (Number.isFinite(target)) await finding(data,p.snapshot_id,'S5_TARGET_DIFFERENCE',`S5 预测－目标：${formatEngineering('force',p.value-target,3)}。`,[pe.evidence_id],null,options);
      if (Number.isFinite(o.value)) await finding(data,p.snapshot_id,'S5_PREDICTION_OBSERVATION_DIFFERENCE',`S5 预测－观测：${formatEngineering('force',p.value-o.value,3)}。`,[pe.evidence_id,oe.evidence_id],o.observation_id,options);
      else await finding(data,p.snapshot_id,'S5_OBSERVATION_MISSING','该快照尚无可用 S5 观测。',[oe.evidence_id],o.observation_id,options);
      checkCapture(options);
      if (data.evidence.length + data.findings.length !== count) await state.write('evidence-records.json',data,options);
      checkCapture(options);
      return projection(data,p.snapshot_id,o.observation_id);
    },options);
  }
  function joinCapture(operation, signal) {
    return new Promise((resolve,reject)=>{
      const subscriber={};operation.subscribers.add(subscriber);
      const cleanup=()=>{signal?.removeEventListener('abort',cancel);operation.subscribers.delete(subscriber);};
      const cancel=()=>{cleanup();if(!operation.done&&!operation.subscribers.size)operation.controller.abort(superseded());reject(signal.reason || superseded());};
      if(signal?.aborted){cancel();return;}
      signal?.addEventListener('abort',cancel,{once:true});
      operation.promise.then(resolve,reject).finally(cleanup);
    });
  }
  async function capture(prediction, observation = prediction?.observation, options = {}) {
    if(closed)throw superseded();
    checkCapture(options);
    // Authenticate even duplicate requests before joining any in-flight work.
    const context=deepFreeze(await source(prediction,observation));
    if(closed)throw superseded();
    checkCapture(options);
    if(!options.scope)return captureVerified(context,options);
    if(typeof options.scope!=='string'||!Number.isSafeInteger(options.revision)||options.revision<0)throw new StateError('诊断请求版本无效。',400,'INVALID_REVISION');
    const identity=reportInputFingerprint({prediction:context.prediction,observation:context.observation});
    let session=currentCaptures.get(options.scope);
    if(session && options.revision<session.revision)throw superseded();
    if(session?.operation && session.identity===identity){
      session.revision=Math.max(session.revision,options.revision);
      return joinCapture(session.operation,options.signal);
    }
    session?.operation?.controller.abort(superseded());
    const controller=new AbortController(),operation={id:randomUUID(),snapshotId:context.prediction.snapshot_id,controller,subscribers:new Set(),done:false};
    session={identity,revision:options.revision,operation};currentCaptures.set(options.scope,session);
    const active={signal:controller.signal,operation,current:()=>currentCaptures.get(options.scope)===session && session.operation===operation && session.identity===identity};
    const aborted=()=>emit('SUPERSEDED_ABORT',operation);
    controller.signal.addEventListener('abort',aborted,{once:true});
    emit('CAPTURE_STARTED',operation);
    operation.promise=Promise.resolve().then(()=>captureVerified(context,active)).then(bundle=>{
      if(controller.signal.aborted || !active.current() || reportInputFingerprint({prediction:context.prediction,observation:context.observation})!==identity){emit('LATE_RESULT_DISCARDED',operation);throw superseded();}
      emit('CAPTURE_FINISHED',operation,{status:bundle.status});return bundle;
    }).finally(()=>{
      operation.done=true;controller.signal.removeEventListener('abort',aborted);
      if(session.operation===operation)session.operation=null;
      emit('CAPTURE_CLEANUP',operation);
    });
    operation.promise.catch(()=>{});
    return joinCapture(operation,options.signal);
  }
  function close() {
    if(closing)return closing;
    closed=true;
    const pending=[...currentCaptures.values()].map(session=>session.operation).filter(Boolean);
    for(const operation of pending)operation.controller.abort(superseded());
    return closing=Promise.allSettled(pending.map(operation=>operation.promise)).then(()=>currentCaptures.clear());
  }
  function rememberPlans(rows) {
    for (const plan of rows || []) if (plan.mode === 'formal' && plan.target_snapshot_id) plans.set(plan.target_snapshot_id,deepFreeze(structuredClone(plan)));
  }
  function selectCandidate(reference, prediction) {
    const plan = plans.get(reference?.target_snapshot_id);
    if (!plan || ['id','baseline_snapshot_id','target_snapshot_id'].some(key=>plan[key]!==reference[key])) invalid();
    validateDraftCandidate(plan,prediction,prediction.input_snapshot,{...draftBaselineIdentity(prediction),valid:true});
    return structuredClone(plan);
  }
  async function compare({ baseline, prediction, candidate_preview_snapshot_id, source_plan_id }) {
    const a = (await source(baseline)).prediction, b = (await source(prediction)).prediction;
    const plan = plans.get(candidate_preview_snapshot_id);
    if (!plan || plan.id !== source_plan_id || a.mode !== 'formal' || b.mode !== 'formal' || b.model_hash !== a.model_hash || b.model_version !== a.model_version || b.snapshot_id === a.snapshot_id) invalid();
    const draft = createDraft(plan,a,a.input_snapshot,{...draftBaselineIdentity(a),valid:true});
    if (!equal(draft.input,b.inputContext) || b.observation.value !== null || b.observation.quality !== 'missing') invalid();
    try { acceptDraftPrediction({ ...draft, status: 'PREDICTING' }, b); } catch { invalid(); }
    const captured = await capture(b);
    if (captured.status === 'UNAVAILABLE') return captured;
    const ref = `draft-comparison:${a.snapshot_id}:${b.snapshot_id}:${candidate_preview_snapshot_id}`;
    sources.add(ref);
    return audit(async data => {
      const count = data.evidence.length + data.findings.length;
      const e = await evidence(data,{type:'DRAFT_COMPARISON',snapshot_id:b.snapshot_id,observation_id:null,input_hash:b.input_hash,
        model_hash:b.model_hash,model_version:b.model_version,baseline_snapshot_id:a.snapshot_id,target_snapshot_id:b.snapshot_id,
        candidate_preview_snapshot_id,source_plan_id,source_ref:ref,source_kind:'R3_DRAFT_RESULT_COMPARISON'});
      await finding(data,b.snapshot_id,'DRAFT_PREDICTION_DIFFERENCE',`工况草案 B－来源基线 A 的 S5 预测差：${formatEngineering('force',b.value-a.value,3)}。`,[e.evidence_id]);
      if (data.evidence.length + data.findings.length !== count) await state.write('evidence-records.json',data);
      return projection(data,b.snapshot_id,b.observation.observation_id);
    });
  }
  async function history(snapshotId, observationId) { return audit(async data => projection(data,snapshotId,observationId,true)); }
  // Read-only contract consumer, not exposed as a client-supplied Event/Finding creation endpoint.
  async function linkEvent(eventId, prediction, observation = prediction?.observation) {
    const {prediction:p,observation:o} = await source(prediction,observation);
    sources.add(`prediction:${p.snapshot_id}:${p.receipt}`); sources.add(`observation:${o.observation_id}:${o.receipt}`);
    return audit(async data => {
      const events = await state.read('monitoring-events.json',[]);
      if (!Array.isArray(events)) throw new Error('Event storage unavailable');
      const identity = { snapshot_id:p.snapshot_id, observation_id:o.observation_id, input_hash:p.input_hash, model_hash:p.model_hash, model_version:p.model_version,
        prediction_receipt:p.receipt, observation_receipt:o.receipt };
      return {status:'VALID',link:linkExistingEventFinding(events.find(event => event.id === eventId),projection(data,p.snapshot_id,o.observation_id),identity)};
    });
  }
  async function select(prediction, observation, submitted = {}) {
    const bundle = await capture(prediction,observation);
    if (bundle.status === 'UNAVAILABLE') return bundle;
    for (const [name,idKey] of [['evidence','evidence_id'],['findings','finding_id']]) {
      if(submitted[name] !== undefined && !Array.isArray(submitted[name]))invalid();
      if (submitted[name] !== undefined) for (const item of submitted[name]) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) invalid();
        const existing = bundle[name].find(row => row[idKey] === item[idKey]);
        if (!existing || !equal(existing,item)) invalid();
      }
    }
    return bundle;
  }
  return { capture, rememberPlans, selectCandidate, compare, select, history, linkEvent, close };
}
