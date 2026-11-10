import { MODEL_FEATURES, modelInputValues } from './modelInputs.js';
import { formatEngineering } from './engineeringUnits.js';
import { DEFAULT_KEY_PARAMETER_FIELDS, sanitizeKeyParameterFields, keyParameterRangeLabel } from './keyParameterDisplay.js';
import './key-parameters.css';

export default function KeyParameterSummary({caseData, checked, visibleFields=DEFAULT_KEY_PARAMETER_FIELDS, dirty=false, onEdit, preview=false, screeningAction}) {
  const values=modelInputValues(caseData), keys=sanitizeKeyParameterFields(visibleFields);
  return <section className="dc-panel key-parameter-panel" aria-label={preview?'方案关键参数':'当前关键参数'}>
    <div className="dc-heading key-parameter-heading"><h3 title={preview?'方案只读参数':dirty?'当前输入 · 待预测':'当前输入'}>{preview?'方案关键参数':'当前关键参数'}</h3>{!preview&&<div className="key-parameter-actions">{screeningAction}<button type="button" className="key-parameter-edit" onClick={onEdit} disabled={!onEdit}>参数编辑 <span aria-hidden="true">›</span></button></div>}</div>
    <div className="key-parameter-items">
      {keys.map(key=>{
        const feature=MODEL_FEATURES.find(item=>item.key===key), row=checked?.rows?.find(item=>item.key===key), status=keyParameterRangeLabel(row);
        return <div className="key-parameter-item" key={key} data-feature-key={key}>
          <span className="key-parameter-label" title={feature.label}>{feature.label}</span>
          <strong>{formatEngineering(feature.field,values[feature.index],['entrySetThickness','entryThickness','width'].includes(feature.field)?4:3)}</strong>
          <small className={`key-parameter-status data-check-${status.tone}`}>{status.text}</small>
        </div>;
      })}
      {!keys.length&&<span className="key-parameter-empty">在参数编辑中选择“面板显示”项</span>}
    </div>
  </section>;
}
