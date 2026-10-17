import React, {useEffect,useState} from 'react';
import {effectiveTargetReference,targetReferenceSourceLabel,targetReferenceStatusLabel,TARGET_REFERENCE_SOURCE,MIN_TARGET_REFERENCE_T,MAX_TARGET_REFERENCE_T} from './targetReference.js';

export default function TargetReferenceSettings({preference,projection,onChange}) {
  const reference=projection||effectiveTargetReference(preference);
  const [source,setSource]=useState(reference.target_reference_source),[value,setValue]=useState(String(reference.effective_target_reference_t)),[error,setError]=useState('');
  useEffect(()=>{setSource(reference.target_reference_source);setValue(String(reference.effective_target_reference_t));setError('');},[reference.reference_identity]);
  const save=(kind=source)=>{if(onChange(kind,value)===false)setError('请输入 '+MIN_TARGET_REFERENCE_T.toFixed(3)+'～'+MAX_TARGET_REFERENCE_T.toFixed(3)+' t 的有限正数。');else setError('');};
  return <details className="target-reference-settings" open>
    <summary><span>目标参考值</span><span>{targetReferenceSourceLabel(reference)}</span>{projection&&<b className={projection.target_reference_status==='OUTSIDE_REFERENCE'?'target-reference-outside':''}>{targetReferenceStatusLabel(projection)}</b>}<span>设置</span></summary>
    <div className="target-reference-form"><p>来源：{reference.target_reference_source===TARGET_REFERENCE_SOURCE.USER_CUSTOM_OVERRIDE?'用户自定义':'软件预设参考值（未标定，可修改）'}</p>
      <label><input type="radio" name="target-reference-source" checked={source===TARGET_REFERENCE_SOURCE.SOFTWARE_PRESET_UNVALIDATED} onChange={()=>setSource(TARGET_REFERENCE_SOURCE.SOFTWARE_PRESET_UNVALIDATED)}/>使用软件预设值</label>
      <label><input type="radio" name="target-reference-source" checked={source===TARGET_REFERENCE_SOURCE.USER_CUSTOM_OVERRIDE} onChange={()=>setSource(TARGET_REFERENCE_SOURCE.USER_CUSTOM_OVERRIDE)}/>使用自定义值</label>
      <label>自定义值<input aria-label="自定义目标参考值" type="text" inputMode="decimal" disabled={source!==TARGET_REFERENCE_SOURCE.USER_CUSTOM_OVERRIDE} value={value} onChange={event=>setValue(event.target.value)}/>t</label>
      <div><button type="button" onClick={()=>save()}>保存</button><button type="button" onClick={()=>save(TARGET_REFERENCE_SOURCE.SOFTWARE_PRESET_UNVALIDATED)}>恢复预设值</button></div>
      {error&&<p role="alert">{error}</p>}
    </div>
  </details>;
}
