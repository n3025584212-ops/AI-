export const MIN_PREDICTION_ERROR_ALARM_BOUND = -50;
export const MAX_PREDICTION_ERROR_ALARM_BOUND = 50;
export const DEFAULT_PREDICTION_ERROR_ALARM_RANGE = Object.freeze({lowerBound:-50,upperBound:50});
export const PREDICTION_ERROR_ALARM_STORAGE_KEY = 'dkqkar.prediction-error-alarm-range.v2';
export const LEGACY_PREDICTION_ERROR_ALARM_STORAGE_KEY = 'dkqkar.prediction-error-alarm-tolerance.v1';

const finiteBound = value => {
  if (typeof value !== 'number' && typeof value !== 'string' || typeof value === 'string' && !value.trim()) return null;
  const number=Number(value);
  return Number.isFinite(number) && number>=MIN_PREDICTION_ERROR_ALARM_BOUND && number<=MAX_PREDICTION_ERROR_ALARM_BOUND
    ? Object.is(number,-0)?0:number : null;
};
export function validatePredictionErrorAlarmRange(value) {
  if (!value || typeof value!=='object' || Array.isArray(value)) return null;
  const lowerBound=finiteBound(value.lowerBound),upperBound=finiteBound(value.upperBound);
  return lowerBound!==null && upperBound!==null && lowerBound<upperBound ? {lowerBound,upperBound} : null;
}
export function predictionErrorAlarmRangeValidationMessage(value) {
  const lowerBound=finiteBound(value?.lowerBound),upperBound=finiteBound(value?.upperBound);
  if(lowerBound===null||upperBound===null)return '请输入−50.000～+50.000 t之间的有效误差边界。';
  return lowerBound>=upperBound?'误差下限必须小于误差上限。':null;
}
export const formatSignedError = value => Number.isFinite(value)?(value>=0?'+':'')+value.toFixed(3):'—';
export const formatPredictionErrorAlarmRange = range => formatSignedError(range.lowerBound)+' t ～ '+formatSignedError(range.upperBound)+' t';

export function readPredictionErrorAlarmRange(storage) {
  try {
    const saved=storage?.getItem(PREDICTION_ERROR_ALARM_STORAGE_KEY);
    if(saved!==null && saved!==undefined)return validatePredictionErrorAlarmRange(JSON.parse(saved))??{...DEFAULT_PREDICTION_ERROR_ALARM_RANGE};
    const legacy=storage?.getItem(LEGACY_PREDICTION_ERROR_ALARM_STORAGE_KEY);
    if(legacy!==null&&legacy!==undefined&&String(legacy).trim()) {
      const tolerance=Number(legacy);
      if(Number.isFinite(tolerance)&&tolerance>0&&tolerance<=MAX_PREDICTION_ERROR_ALARM_BOUND)return {lowerBound:-tolerance,upperBound:tolerance};
    }
  } catch {}
  return {...DEFAULT_PREDICTION_ERROR_ALARM_RANGE};
}
export function writePredictionErrorAlarmRange(storage,value) {
  const range=validatePredictionErrorAlarmRange(value);
  if(range===null)return false;
  try {
    if(typeof storage?.setItem!=='function')return false;
    storage.setItem(PREDICTION_ERROR_ALARM_STORAGE_KEY,JSON.stringify(range));
    return true;
  } catch {return false;}
}

// Monitoring only: never writes Prediction, inputs, actual, Candidate, Target
// or frozen Finding/Evidence records. Both boundaries are independent.
export function predictionErrorAlarm(rawPrediction,actualValue,range=DEFAULT_PREDICTION_ERROR_ALARM_RANGE) {
  const unavailable=(reason,label)=>({status:'UNAVAILABLE',predictionError:null,exceedance:null,reason,label});
  if(!Number.isFinite(actualValue))return unavailable('ACTUAL_MISSING','预测误差报警：无法判断 / 暂无实际值');
  if(!Number.isFinite(rawPrediction))return unavailable('PREDICTION_MISSING','预测误差报警：无法判断 / 等待当前预测');
  const bounds=validatePredictionErrorAlarmRange(range);
  if(bounds===null)return unavailable('RANGE_INVALID','预测误差报警：无法判断 / 区间无效');
  const predictionError=rawPrediction-actualValue;
  // Inclusive decimal boundaries must not alarm just because subtraction
  // rounds (600.1 - 600). This does not widen either engineering boundary.
  const below=predictionError<bounds.lowerBound&&rawPrediction<actualValue+bounds.lowerBound;
  const above=predictionError>bounds.upperBound&&rawPrediction>actualValue+bounds.upperBound;
  const status=below?'LOW_ERROR_ALARM':above?'HIGH_ERROR_ALARM':'NORMAL';
  const exceedance=below?bounds.lowerBound-predictionError:above?predictionError-bounds.upperBound:0;
  return {status,predictionError,exceedance,reason:null,label:below?'预测误差报警：低于下限':above?'预测误差报警：高于上限':'预测误差报警：正常'};
}
