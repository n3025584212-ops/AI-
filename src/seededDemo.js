import { MODEL_FEATURES, modelInputValues, modelInputFingerprint } from './modelInputs.js';
import { effectiveRangeProjection } from './effectiveRangeProjection.js';

export const DEMO_RANDOM_SEED = 20261005;
export const SEEDED_DEMO_URL = '/assets/real-seed-demo.json';
export const SEEDED_DEMO_SOURCE = '工业数据';
export const SEED_SOURCE_SHA256 = '4ef1f84db39f55cd5b12674d25de0735d98d05a47c83fe1a47335a086bbfde4f';
export const DEMO_SOURCE_MAPPING = Object.freeze(MODEL_FEATURES.map(feature=>Object.freeze({
 canonical_field:feature.key,source_field:feature.key,mapping_status:'EXACT_HEADER'
})));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const fail = (code,message) => { throw Object.assign(new Error(message),{code}); };

export function validateDemoFrames(frames,effectiveRanges) {
 const modelRanges=effectiveRanges.filter(range=>range.is_model_input!==false);
 if(frames.length!==60||modelRanges.length!==25)fail('DEMO_BUILD_FAIL','必须提供60帧、每帧25维。');
 let validated=0,rangeViolations=0;
 for(const frame of frames){
  const values=modelInputValues(frame.input);
  values.forEach((value,index)=>{
   const range=modelRanges[index];
   if(!finite(value))fail('DEMO_RANGE_REJECTED','工况模型输入须为有限数值：'+frame.sequence+' '+MODEL_FEATURES[index].key);
   if(finite(range.effective_lower)&&value<range.effective_lower||finite(range.effective_upper)&&value>range.effective_upper)rangeViolations++;
   validated++;
  });
  if(!finite(frame.s5_value)||!finite(frame.dk_qkar_prediction))fail('DEMO_S5_MISSING','S5值或正式预测不完整。');
  const source=frame.input.importProvenance;
  if(frame.s5_value_source==='SYNTHETIC_FROM_REAL_SEED'){
   const gate=source?.s5_quality_gate;
   if(frame.actual!==null||frame.observed!==null||source?.observedAvailable!==false||frame.input.stands[4].force!==null)
    fail('FAKE_ACTUAL_REJECTED','扩张帧不得进入真实测量证据通道。');
   if(!gate?.passed||gate.input_fingerprint!==modelInputFingerprint(frame.input)||gate.model_hash!==frame.model_hash
    ||gate.prediction!==frame.dk_qkar_prediction||source.synthetic_s5_value!==frame.s5_value
    ||Math.abs(frame.s5_value-frame.dk_qkar_prediction)>gate.real_seed_abs_error_p95+1e-9
    ||frame.s5_value<gate.real_s5_min||frame.s5_value>gate.real_s5_max)
    fail('DEMO_QUALITY_REJECTED','扩张帧未通过真实Seed残差质量门。');
  }else if(frame.s5_value_source==='REAL_EXCEL_MEASUREMENT'){
   if(frame.actual!==frame.s5_value||source?.observed!==frame.s5_value||source?.observedAvailable!==true)
    fail('REAL_ACTUAL_MISMATCH','真实Seed实际值必须保留Excel原值。');
   if(frame.canonical25&&JSON.stringify(values)!==JSON.stringify(frame.canonical25))
    fail('REAL_INPUT_MISMATCH','真实工况输入与源记录不一致。');
  }else fail('DEMO_SOURCE_INVALID','S5来源不可识别。');
 }
 return {validatedValues:validated,missingValues:0,invalidValues:0,rangeViolations};
}

// Replay validated, model-computed inputs rather than re-generating unchecked
// variants at startup. A changed constraint rejects the asset; it never clips.
export function generateSeededDemo(asset,{caseData,table,limits={}}={}){
 if(asset?.schema!==3||asset.source?.sha256!==SEED_SOURCE_SHA256||asset.source.record_count!==13767
  ||!asset.dataset_id||!asset.dataset_version||asset.frames?.length!==60||asset.synthetic_s5_count!==0
  ||asset.frames.some(frame=>frame.dataset_version!==asset.dataset_version||!frame.frame_identity
   ||!frame.input25_hash||frame.input.importProvenance?.stream_id!==asset.dataset_version
   ||frame.input.importProvenance?.frame_identity!==frame.frame_identity||frame.s5_value_source!=='REAL_EXCEL_MEASUREMENT'))
  fail('DEMO_SOURCE_INVALID','真实工业工况数据集或记录身份不完整。');
 const {effectiveRanges}=effectiveRangeProjection(caseData,table,limits);
 const frames=structuredClone(asset.frames);
 if(frames.some(frame=>frame.model_hash!==asset.model_hash))fail('DEMO_MODEL_MISMATCH','工况预测与当前模型身份不一致。');
 frames.forEach(frame=>{frame.input.target=caseData.target;frame.target=caseData.target;frame.predicted=null;delete frame.result;});
 const validation=validateDemoFrames(frames,effectiveRanges);
 return {frames,effectiveRanges,validation,sourceName:SEEDED_DEMO_SOURCE,
  sourceId:asset.dataset_version,datasetVersion:asset.dataset_version};
}
export async function loadSeededDemoReplay({modelHash,caseData,table,limits={},signal,fetchImpl=globalThis.fetch}={}){
 const response=await fetchImpl(SEEDED_DEMO_URL,{signal});
 if(!response.ok)fail('DEMO_SOURCE_UNAVAILABLE','工业工况数据暂不可用。');
 const asset=await response.json();
 if(!modelHash||asset.model_hash!==modelHash)fail('DEMO_MODEL_MISMATCH','种子工况与当前模型身份不一致。');
 return generateSeededDemo(asset,{caseData,table,limits});
}
export function syntheticS5Value(input){
 const source=input?.importProvenance;
 return source?.source_type==='DEMO'&&source.S5_SOURCE==='SYNTHETIC_DEMO'&&source.observedAvailable===false
  &&source.observed===null&&source.s5_quality_gate?.passed===true&&finite(source.synthetic_s5_value)?source.synthetic_s5_value:null;
}
export function visibleReplayFrames(frames,cursor){return frames.slice(0,Math.max(0,Math.trunc(cursor)+1));}
