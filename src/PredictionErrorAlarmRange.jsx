import { X } from 'lucide-react';
import { useEffect,useState } from 'react';
import { DEFAULT_PREDICTION_ERROR_ALARM_RANGE,MIN_PREDICTION_ERROR_ALARM_BOUND,MAX_PREDICTION_ERROR_ALARM_BOUND,
  validatePredictionErrorAlarmRange,predictionErrorAlarmRangeValidationMessage,formatSignedError,formatPredictionErrorAlarmRange } from './predictionErrorAlarm.js';

export default function PredictionErrorAlarmRange({value=DEFAULT_PREDICTION_ERROR_ALARM_RANGE,alarm,onChange,onClose}) {
  const textOf=range=>({lowerBound:formatSignedError(range.lowerBound),upperBound:formatSignedError(range.upperBound)});
  // Unsaved text edits; App owns the sole effective numeric range.
  const [draft,setDraft]=useState(()=>textOf(value)),[error,setError]=useState(null);
  useEffect(()=>{setDraft(textOf(value));setError(null);},[value.lowerBound,value.upperBound]);
  const validDraft=validatePredictionErrorAlarmRange(draft);
  const change=(key,text)=>{const next={...draft,[key]:text};setDraft(next);setError(predictionErrorAlarmRangeValidationMessage(next));};
  const sliderValue=key=>{const number=Number(draft[key]);return Number.isFinite(number)&&draft[key].trim()?Math.min(MAX_PREDICTION_ERROR_ALARM_BOUND,Math.max(MIN_PREDICTION_ERROR_ALARM_BOUND,number)):value[key];};
  const sliderPercent=bound=>(bound-MIN_PREDICTION_ERROR_ALARM_BOUND)/(MAX_PREDICTION_ERROR_ALARM_BOUND-MIN_PREDICTION_ERROR_ALARM_BOUND)*100;
  const lower=sliderValue('lowerBound'),upper=sliderValue('upperBound');
  const save=event=>{event.preventDefault();const message=predictionErrorAlarmRangeValidationMessage(draft);if(message){setError(message);return;}if(onChange?.(validDraft)===false){setError('无法保存预测误差报警区间。');return;}setDraft(textOf(validDraft));setError(null);};
  const restore=()=>{const next={...DEFAULT_PREDICTION_ERROR_ALARM_RANGE};if(onChange?.(next)===false){setError('无法保存预测误差报警区间。');return;}setDraft(textOf(next));setError(null);};
  const status=alarm?.status??'UNAVAILABLE',isAlarm=status==='LOW_ERROR_ALARM'||status==='HIGH_ERROR_ALARM';
  return <>
    <header><h2>预测误差报警区间</h2><button type="button" aria-label="关闭预测误差报警区间" onClick={onClose}><X size={18}/></button></header>
    <form className="prediction-error-range-form" onSubmit={save} noValidate>
      <p>设置预测值与实际值之间允许的误差区间。当前预测误差位于设定区间内时不报警，低于下限或高于上限时触发报警。</p>
      <div className="prediction-error-range-slider" role="group" aria-label="预测误差报警双端区间">
        <span>−{Math.abs(MIN_PREDICTION_ERROR_ALARM_BOUND)} t</span><div className="prediction-error-range-track" style={{'--range-start':sliderPercent(Math.min(lower,upper))+'%','--range-end':sliderPercent(Math.max(lower,upper))+'%'}}>
          <input type="range" aria-label="误差下限滑块" min={MIN_PREDICTION_ERROR_ALARM_BOUND} max={MAX_PREDICTION_ERROR_ALARM_BOUND} step="0.001" value={lower} onChange={event=>change('lowerBound',event.target.value)}/>
          <input type="range" aria-label="误差上限滑块" min={MIN_PREDICTION_ERROR_ALARM_BOUND} max={MAX_PREDICTION_ERROR_ALARM_BOUND} step="0.001" value={upper} onChange={event=>change('upperBound',event.target.value)}/>
        </div><span>+{MAX_PREDICTION_ERROR_ALARM_BOUND} t</span>
      </div>
      <div className="prediction-error-range-inputs">
        <label>误差下限<input type="text" inputMode="decimal" aria-label="误差下限" value={draft.lowerBound} onChange={event=>change('lowerBound',event.target.value)} onBlur={()=>{if(validDraft)setDraft(textOf(validDraft));}} aria-invalid={!!error} aria-describedby={error?'prediction-error-range-error':undefined}/>t</label>
        <label>误差上限<input type="text" inputMode="decimal" aria-label="误差上限" value={draft.upperBound} onChange={event=>change('upperBound',event.target.value)} onBlur={()=>{if(validDraft)setDraft(textOf(validDraft));}} aria-invalid={!!error} aria-describedby={error?'prediction-error-range-error':undefined}/>t</label>
      </div>
      {error&&<p role="alert" id="prediction-error-range-error">{error}</p>}
      <section className={'prediction-error-range-status is-'+status.toLowerCase()} aria-label="当前预测误差报警状态" data-alarm-state={status}>
        <p>当前预测误差：<strong>{Number.isFinite(alarm?.predictionError)?formatSignedError(alarm.predictionError)+' t':'—'}</strong></p>
        <p>允许区间：<strong>{formatPredictionErrorAlarmRange(value)}</strong></p>
        <p>当前状态：<strong>{status==='NORMAL'?'正常':isAlarm?'报警':alarm?.reason==='ACTUAL_MISSING'?'无法判断 / 暂无实际值':'无法判断 / 等待当前预测'}</strong></p>
        {isAlarm&&<p>{status==='LOW_ERROR_ALARM'?'低于下限':'超过上限'}：<strong>{alarm.exceedance.toFixed(3)} t</strong></p>}
      </section>
      <div className="prediction-error-range-actions"><button type="button" onClick={restore}>恢复默认</button><button type="submit" disabled={!validDraft}>保存</button></div>
    </form>
  </>;
}
