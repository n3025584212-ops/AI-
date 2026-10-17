import { convertUnit, ENGINEERING_UNIT_SYSTEM } from './engineeringUnits.js';

// A software preference, never a model feature or a calibrated process rule.
export const DEFAULT_TARGET_REFERENCE_T = 10;
export const MIN_TARGET_REFERENCE_T = convertUnit(0.01, 'MN', 't');
export const MAX_TARGET_REFERENCE_T = convertUnit(2, 'MN', 't');
export const TARGET_REFERENCE_SOURCE = Object.freeze({NONE:'NONE',SOFTWARE_PRESET_UNVALIDATED:'SOFTWARE_PRESET_UNVALIDATED',USER_CUSTOM_OVERRIDE:'USER_CUSTOM_OVERRIDE',HISTORICAL_CALIBRATED_REFERENCE:'HISTORICAL_CALIBRATED_REFERENCE',FORMAL_PROCESS_RULE:'FORMAL_PROCESS_RULE'});
export const TARGET_REFERENCE_STORAGE_KEY = 'dkqkar.target-reference.custom.v2';
const LEGACY_STORAGE_KEY = 'dkqkar.target-reference.custom.v1';
export const TARGET_REFERENCE_VERSION = 'target-reference-v2-t';
const preset=()=>({source:TARGET_REFERENCE_SOURCE.SOFTWARE_PRESET_UNVALIDATED,revision:0});
export function validateCustomTargetReference(value) {
  if(typeof value!=='number'&&typeof value!=='string'||typeof value==='string'&&(!value.trim()||!/^\d+(?:\.\d+)?$/.test(value.trim())))return null;
  const number=Number(value);
  return Number.isFinite(number)&&number>=MIN_TARGET_REFERENCE_T&&number<=MAX_TARGET_REFERENCE_T?number:null;
}
export function normalizeTargetReference(preference) {
  const revision=Number.isSafeInteger(preference?.revision)&&preference.revision>=0?preference.revision:0;
  if(preference?.source===TARGET_REFERENCE_SOURCE.USER_CUSTOM_OVERRIDE){
    const raw=preference.custom_t ?? (typeof preference.custom_mn==='number'?convertUnit(preference.custom_mn,'MN','t'):null);
    const value=validateCustomTargetReference(raw);
    if(value!==null)return {source:preference.source,custom_t:value,revision};
  }
  return {...preset(),revision};
}
export function readTargetReference(storage) {
  try{
    const current=storage?.getItem(TARGET_REFERENCE_STORAGE_KEY);
    if(current)return normalizeTargetReference(JSON.parse(current));
    const legacy=storage?.getItem(LEGACY_STORAGE_KEY);
    if(!legacy)return preset();
    const migrated=normalizeTargetReference(JSON.parse(legacy));
    storage?.setItem(TARGET_REFERENCE_STORAGE_KEY,JSON.stringify(migrated));
    return migrated;
  }catch{return preset();}
}
export function changeTargetReference(previous,source,value,storage) {
  if(![TARGET_REFERENCE_SOURCE.SOFTWARE_PRESET_UNVALIDATED,TARGET_REFERENCE_SOURCE.USER_CUSTOM_OVERRIDE].includes(source))return null;
  const custom=source===TARGET_REFERENCE_SOURCE.USER_CUSTOM_OVERRIDE?validateCustomTargetReference(value):null;
  if(source===TARGET_REFERENCE_SOURCE.USER_CUSTOM_OVERRIDE&&custom===null)return null;
  const next={source,revision:normalizeTargetReference(previous).revision+1,...(custom===null?{}:{custom_t:custom})};
  // Store an explicit source so a genuine custom value can never be migrated as a preset.
  storage?.setItem(TARGET_REFERENCE_STORAGE_KEY,JSON.stringify(next));
  return next;
}
export function effectiveTargetReference(preference) {
  const value=normalizeTargetReference(preference),tons=value.source===TARGET_REFERENCE_SOURCE.USER_CUSTOM_OVERRIDE?value.custom_t:DEFAULT_TARGET_REFERENCE_T;
  return {effective_target_reference_t:tons,unit:'t',unit_system:ENGINEERING_UNIT_SYSTEM,target_reference_source:value.source,calibration_status:'UNVALIDATED',
    reference_version:TARGET_REFERENCE_VERSION,reference_revision:value.revision,
    reference_identity:JSON.stringify([TARGET_REFERENCE_VERSION,value.revision,value.source,tons])};
}
export function targetReferenceProjection(prediction,target,preference,snapshotId=null) {
  const reference=effectiveTargetReference(preference),valid=Number.isFinite(prediction)&&Number.isFinite(target);
  const signed=valid?prediction-target:null,absolute=valid?Math.abs(signed):null;
  return {...reference,absolute_target_gap_t:absolute,direction:valid?signed===0?'EQUAL':signed>0?'ABOVE_TARGET':'BELOW_TARGET':null,
    target_reference_status:absolute===null?'UNAVAILABLE':absolute<=reference.effective_target_reference_t?'WITHIN_REFERENCE':'OUTSIDE_REFERENCE',
    target_value:valid?target:null,target_identity:JSON.stringify([snapshotId,Number.isFinite(target)?target:null]),snapshot_id:snapshotId};
}
export function targetReferenceStatusLabel(reference) {
  if(reference.target_reference_status==='UNAVAILABLE')return '暂不可比较';
  const custom=reference.target_reference_source===TARGET_REFERENCE_SOURCE.USER_CUSTOM_OVERRIDE;
  return reference.target_reference_status==='WITHIN_REFERENCE'?(custom?'自定义参考值内':'参考值内'):(custom?'超出自定义参考值':'超出参考值');
}
export function targetReferenceSourceLabel(reference) {
  return (reference.target_reference_source===TARGET_REFERENCE_SOURCE.USER_CUSTOM_OVERRIDE?'用户自定义':'软件预设')+' ±'+reference.effective_target_reference_t.toFixed(3)+' t';
}
export function targetReferenceMatches(generated,current) {
  return Boolean(generated&&current&&generated.reference_identity===current.reference_identity&&generated.reference_version===current.reference_version
    &&generated.effective_target_reference_t===current.effective_target_reference_t&&generated.target_reference_source===current.target_reference_source
    &&generated.target_identity===current.target_identity&&generated.snapshot_id===current.snapshot_id);
}
// Project historical metadata without changing the stored message or its text.
export function targetReferenceMessage(message,current) {
  const generated=message.target_reference_context||message.question_facts?.target_reference;
  // Snapshot replacement remains governed by the existing Finding/stale gate.
  if(!generated||generated.snapshot_id!==current?.snapshot_id||targetReferenceMatches(generated,current))return message;
  return {...message,historical:true,ai_explanation_state:'STALE_REFERENCE',ai_explanation_status:'STALE_REFERENCE',
    reference_history_note:'该解读基于生成时的旧目标参考值。'};
}
