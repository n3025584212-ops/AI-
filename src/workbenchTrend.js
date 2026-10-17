import { modelInputFingerprint } from './modelInputs.js';
import { trendActualValue } from './s5ActualDisplay.js';
export const WORKBENCH_VIEW_MODE=Object.freeze({CURRENT:'CURRENT',PREVIEW:'PREVIEW'});
export function demoDisplayValue(input,modelHash){
 const source=input?.importProvenance,gate=source?.s5_quality_gate;
 return !!modelHash&&source?.source_type==='DEMO'&&source.S5_SOURCE==='SYNTHETIC_DEMO'&&gate?.passed===true
  &&source.sample_id===input.id&&gate.model_hash===modelHash&&gate.input_fingerprint===modelInputFingerprint(input)
  &&Number.isFinite(source.synthetic_s5_value)?source.synthetic_s5_value:null;
}
export function baselineActualValue(frame){
 if(frame.result?.inputContext&&(frame.result.inputContext.id!==frame.input?.id||modelInputFingerprint(frame.result.inputContext)!==modelInputFingerprint(frame.input)))return null;
 return trendActualValue(frame)??demoDisplayValue(frame.input,frame.result?.model_hash||frame.model_hash);
}
export function projectWorkbenchTrend(frames,options={}){
 if(options.mode!=='PREVIEW')return {mode:'CURRENT',keys:['observed','predicted'],predictedLabel:'原预测',
  frames:frames.map(frame=>({...frame,displayActual:baselineActualValue(frame)}))};
 const {policyLabel,policySeries=[]}=options;
 const actualAvailable=baselineActualValue(frames.at(-1)||{})!==null;
 return {mode:'PREVIEW',keys:actualAvailable?['observed','predicted','policyPrediction']:['predicted','policyPrediction'],predictedLabel:'原预测',policyLabel,
  frames:frames.map(frame=>{const point=policySeries.find(point=>point.frame.time===frame.time&&point.frame.input.id===frame.input.id);
   const bound=!frame.result?.snapshot_id||point?.baselineSnapshotId===frame.result.snapshot_id;
   return {...frame,displayActual:baselineActualValue(frame),
    predicted:bound&&Number.isFinite(point?.baselinePrediction)?point.baselinePrediction:frame.predicted,
    policySearchStatus:bound?point?.searchStatus:'STALE',policyPrediction:bound?point?.policyPrediction??null:null};})};
}

// Display only completed comparisons. Pending and future samples never enter
// the playback, and unavailable winners retain an honest gap in the plan line.
export function processedComparisonFrames(frames){
 return frames.filter(frame=>Number.isFinite(frame.predicted)&&(Number.isFinite(frame.policyPrediction)
  ||['READY','FAILED','TIMEOUT','CANCELLED'].includes(frame.policySearchStatus)));
}
export function comparisonPlaybackWindow(frames,cursor,range,sequence=false){
 const position=Math.max(0,Math.min(Math.trunc(cursor)||0,frames.length-1)),reached=frames.slice(0,position+1);
 return sequence?reached.slice(-range):reached.filter(frame=>frame.time>=reached.at(-1).time-range*1000);
}
