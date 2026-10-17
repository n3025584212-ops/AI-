import { predictionErrorAlarm } from '../src/predictionErrorAlarm.js';

export const AI_ANALYSIS_BATCH_SIZE = 20;
export const LOG_RETENTION_DAYS = 30;
export const AI_ANALYSIS_RETENTION_DAYS = 30;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const average = values => values.length ? values.reduce((sum,value)=>sum+value,0)/values.length : null;
export function aggregateAnalysis(records, range, sourceLogs = []) {
 const successful=records.filter(row=>finite(row.rawPrediction));
 const paired=successful.filter(row=>finite(row.actualValue));
 const errors=paired.map(row=>row.rawPrediction-row.actualValue);
 const alarms=paired.map(row=>({...row,predictionError:row.rawPrediction-row.actualValue,alarmRange:{...range},
  alarm:predictionErrorAlarm(row.rawPrediction,row.actualValue,range)})).filter(row=>row.alarm.status!=='NORMAL');
 const durations=successful.map(row=>row.inferenceTimeMs).filter(value=>finite(value)&&value>=0);
 const failures=sourceLogs.filter(row=>row.level==='error'||row.level==='critical');
 const warnings=sourceLogs.filter(row=>row.level==='warning'||row.level==='warn');
 const out=records.filter(row=>row.rangeIssues?.length).length;
 const metrics={RECORD_COUNT:records.length,SUCCESS_COUNT:successful.length,FAIL_COUNT:records.length-successful.length+failures.filter(row=>row.category==='prediction').length,
  ACTUAL_AVAILABLE_COUNT:paired.length,ACTUAL_MISSING_COUNT:records.length-paired.length,
  ME:average(errors),MAE:average(errors.map(Math.abs)),RMSE:errors.length?Math.sqrt(average(errors.map(value=>value*value))):null,
  MIN_ERROR:errors.length?Math.min(...errors):null,MAX_ERROR:errors.length?Math.max(...errors):null,MAX_ABS_ERROR:errors.length?Math.max(...errors.map(Math.abs)):null,
  POSITIVE_ERROR_COUNT:errors.filter(value=>value>0).length,NEGATIVE_ERROR_COUNT:errors.filter(value=>value<0).length,
  IN_RANGE_COUNT:paired.length-alarms.length,OUT_OF_RANGE_COUNT:alarms.length,IN_RANGE_RATE:paired.length?(paired.length-alarms.length)/paired.length:null,
  ALARM_COUNT:alarms.length,INPUT_OUT_OF_RANGE_COUNT:out,AVERAGE_INFERENCE_TIME:average(durations),MAX_INFERENCE_TIME:durations.length?Math.max(...durations):null};
 const overallStatus=metrics.FAIL_COUNT||failures.some(row=>row.level==='critical')?'SEVERE':alarms.length||out||warnings.length||metrics.ACTUAL_MISSING_COUNT?'ATTENTION':'NORMAL';
 const logFacts=Object.values(sourceLogs.reduce((groups,row)=>{
  const key=JSON.stringify([row.category,row.level,row.message]);groups[key]??={module:row.category,level:row.level,message:row.message,count:0,sourceLogIds:[]};
  groups[key].count++;groups[key].sourceLogIds.push(row.id);return groups;
 },{}));
 return {metrics,overallStatus,runSummary:{recordCount:records.length,predictionSuccess:metrics.SUCCESS_COUNT,predictionFailures:metrics.FAIL_COUNT,
  actualAvailable:paired.length,actualMissing:metrics.ACTUAL_MISSING_COUNT,inputOutOfRange:out,alarmCount:alarms.length,
  averageInferenceTime:metrics.AVERAGE_INFERENCE_TIME,maxInferenceTime:metrics.MAX_INFERENCE_TIME,overallStatus},
  alarms:alarms.map(row=>({timestamp:row.timestamp,recordId:row.recordId,frameId:row.frameId,taskId:row.taskId||null,module:'prediction',
   rawPrediction:row.rawPrediction,actualValue:row.actualValue,predictionError:row.predictionError,alarmRange:row.alarmRange,
   errorCode:row.alarm.status,sourceLogId:row.sourceLogId,exceedance:row.alarm.exceedance})),warnings,failures,logFacts};
}

// Local calendar boundaries also handle DST without converting "yesterday" to UTC midnight.
export function localDateWindow(value, clock=Date.now()) {
 const date=new Date(clock);
 if(value==='昨天'){date.setDate(date.getDate()-1);date.setHours(0,0,0,0);const end=new Date(date);end.setDate(end.getDate()+1);return {from:date.toISOString(),to:new Date(end.getTime()-1).toISOString()};}
 if(value==='今天'){date.setHours(0,0,0,0);return {from:date.toISOString(),to:new Date(clock).toISOString()};}
 return {};
}
