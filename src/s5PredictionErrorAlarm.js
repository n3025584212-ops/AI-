import { completedPredictionValues } from './predictionSnapshot.js';
import { currentActualValue } from './s5ActualDisplay.js';
import { demoDisplayValue } from './workbenchTrend.js';
import { predictionErrorAlarm } from './predictionErrorAlarm.js';

// The card and independent dialog read the same current-snapshot values and
// READY gate. A pending/foreign frame cannot supply an alarm.
export function currentPredictionErrorAlarm({caseData,result,resultSample,predictionState,dirty=false,observationMatches=true,holding=false},range) {
  const actualValue=holding?null:currentActualValue({caseData,result,resultSample,dirty,observationMatches})
    ?? (dirty?null:demoDisplayValue(caseData,result?.model_hash));
  const {value}=completedPredictionValues(result,caseData,resultSample);
  const rawPrediction=!dirty&&!holding&&result?.mode==='formal'&&(!predictionState||predictionState==='READY')?value:null;
  return {...predictionErrorAlarm(rawPrediction,actualValue,range),actualValue,rawPrediction};
}
