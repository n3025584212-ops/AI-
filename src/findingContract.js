// Shared semantics only. HMAC verification and the sole issuer remain on the server.
const freeze = value => {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
};
export const TARGET_ORDER = freeze(['S1','T12','S2','T23','S3','T34','S4','T45','S5']);
export const TARGET_METADATA = freeze(Object.fromEntries(TARGET_ORDER.map(target => [target, {
  target, spatial_type: target.startsWith('S') ? 'STAND' : 'INTERSTAND', locatable_3d: target.startsWith('S'),
}])));
export const FINDING_KINDS = freeze({
  S5_TARGET_DIFFERENCE: { title:'S5预测与目标差异', targets:['S5'], observation_bound:false },
  S5_PREDICTION_OBSERVATION_DIFFERENCE: { title:'S5预测与观测差异', targets:['S5'], observation_bound:true },
  S5_OBSERVATION_MISSING: { title:'S5观测尚不可用', targets:['S5'], observation_bound:true },
  DRAFT_PREDICTION_DIFFERENCE: { title:'工况草案预测对比', targets:['S5'], observation_bound:false },
});
export const EVENT_RULES = freeze({
  'prediction-error': { event_kind:'prediction-error', finding_kind:'S5_PREDICTION_OBSERVATION_DIFFERENCE', default_targets:['S5'], mode:'LINK_EXISTING_ONLY' },
});
const reject = () => { const error = new Error('Finding 合同或证据作用域不合法。'); error.code='EVIDENCE_SCOPE'; error.status=409; throw error; };
const text = value => typeof value === 'string' && value.trim().length > 0;
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export function normalizeTargets(targets) {
  if (!Array.isArray(targets) || !targets.length || Array.from(targets).some(target => typeof target !== 'string' || !Object.hasOwn(TARGET_METADATA,target))) reject();
  return TARGET_ORDER.filter(target => targets.includes(target));
}
export function findingKind(kind) {
  if (typeof kind !== 'string' || !Object.hasOwn(FINDING_KINDS,kind)) reject();
  return FINDING_KINDS[kind];
}
const required = ['finding_id','snapshot_id','kind','statement','evidence_ids','status','created_by','created_at','receipt'];
const optional = ['observation_id','source_event_id','tool_call_id'];
export function validateFinding(finding, { persisted = false } = {}) {
  if (!finding || typeof finding !== 'object' || Array.isArray(finding)) reject();
  const metadata = findingKind(finding.kind), legacy = finding.schema_version === undefined;
  const fields = legacy ? required.concat('observation_id') : required.concat(optional,'schema_version','title','targets');
  if (Object.keys(finding).some(key => !fields.includes(key)) || required.some(key => !Object.hasOwn(finding,key))) reject();
  if (!text(finding.finding_id) || !finding.finding_id.startsWith('FD-') || !text(finding.snapshot_id)
    || !text(finding.statement) || !text(finding.created_at) || !Number.isFinite(Date.parse(finding.created_at))
    || !/^[a-f0-9]{64}$/.test(finding.receipt || '') || !['SYSTEM','TOOL'].includes(finding.created_by)
    || !(persisted ? ['VALID'] : ['VALID','PENDING','STALE']).includes(finding.status)
    || !Array.isArray(finding.evidence_ids) || !finding.evidence_ids.length
    || finding.evidence_ids.some(id => !text(id) || !id.startsWith('EV-'))
    || new Set(finding.evidence_ids).size !== finding.evidence_ids.length) reject();
  if (!legacy && (persisted ? finding.schema_version !== 'finding-v2' : !['finding-v1','finding-v2'].includes(finding.schema_version))) reject();
  if (!legacy && (finding.title !== metadata.title || !same(finding.targets,normalizeTargets(finding.targets)) || !same(finding.targets,metadata.targets))) reject();
  if (metadata.observation_bound ? !text(finding.observation_id) : finding.observation_id != null) reject();
  for (const key of ['source_event_id','tool_call_id']) if (Object.hasOwn(finding,key) && !text(finding[key])) reject();
  return metadata;
}
// Call only after authenticating the ORIGINAL persisted record. Never write this view back.
export function projectFinding(finding, status) {
  const metadata = validateFinding(finding,{persisted:true});
  if (!['VALID','PENDING','STALE'].includes(status)) reject();
  return { ...finding, schema_version:finding.schema_version || 'finding-v1', title:metadata.title, targets:[...metadata.targets], evidence_ids:[...finding.evidence_ids], status };
}
export function findingEvidenceMatches(finding, evidence) {
  const metadata = validateFinding(finding);
  const refs = finding.evidence_ids.map(id => evidence.find(e => e.evidence_id === id));
  if (refs.some(e => !e || e.snapshot_id !== finding.snapshot_id || !/^[a-f0-9]{64}$/.test(e.receipt || ''))) return false;
  if (refs.some(e => ['input_hash','model_hash','model_version'].some(key => !text(e[key]) || e[key] !== refs[0][key]))) return false;
  if (refs.some(e => e.type === 'OBSERVATION' && (!metadata.observation_bound || e.observation_id !== finding.observation_id))) return false;
  const types = new Set(refs.map(e => e.type));
  const expected = {
    S5_TARGET_DIFFERENCE:['PREDICTION'], S5_PREDICTION_OBSERVATION_DIFFERENCE:['PREDICTION','OBSERVATION'],
    S5_OBSERVATION_MISSING:['OBSERVATION'], DRAFT_PREDICTION_DIFFERENCE:['DRAFT_COMPARISON'],
  }[finding.kind];
  return expected.every(type => types.has(type)) && [...types].every(type => expected.includes(type));
}
// Pure matching of already authenticated inputs; not an issuer or an event parser.
// The store supplies a persisted Event, signed Finding/Evidence views and verified business receipts.
export function linkExistingEventFinding(event, bundle, identity) {
  const rule = typeof event?.type === 'string' && Object.hasOwn(EVENT_RULES,event.type) ? EVENT_RULES[event.type] : null;
  const proof = event?.evidence?.identity;
  const keys = ['snapshot_id','observation_id','input_hash','model_hash','model_version','prediction_receipt','observation_receipt'];
  if (!rule || !text(event.id) || bundle?.status !== 'VALID' || keys.some(key => !text(identity?.[key]) || proof?.[key] !== identity[key])) return null;
  const finding = (bundle.findings || []).find(f => {
    try {
      if (f.kind !== rule.finding_kind || f.status !== 'VALID' || f.snapshot_id !== identity.snapshot_id || f.observation_id !== identity.observation_id
        || !findingEvidenceMatches(f,bundle.evidence || [])) return false;
      return f.evidence_ids.every(id => {
        const e = bundle.evidence.find(e => e.evidence_id === id);
        return e.status === 'VALID' && ['input_hash','model_hash','model_version'].every(key => e[key] === identity[key])
          && e.source_ref === (e.type === 'PREDICTION' ? `prediction:${identity.snapshot_id}:${identity.prediction_receipt}` : `observation:${identity.observation_id}:${identity.observation_receipt}`);
      });
    } catch { return false; }
  });
  return finding ? { event_id:event.id, finding_id:finding.finding_id, mode:rule.mode } : null;
}
