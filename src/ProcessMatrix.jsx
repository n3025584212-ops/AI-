import { readableConditionName, userVisibleText } from './userVisibleText.js';
import UserVisibleText from './UserVisibleText.jsx';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, CircleAlert, Loader2, SlidersHorizontal } from 'lucide-react';
import { toDisplay, fromDisplay, unitFor } from './engineeringUnits.js';
import { isModelInput, MODEL_FEATURES, MODEL_INPUT_COUNT, modelInputValues } from './modelInputs.js';
import { KEY_PARAMETER_LIMIT, keyParameterRangeLabel } from './keyParameterDisplay.js';
import './process-matrix.css';

const FIELDS = [
  { key: 'entryThickness', label: '入口厚度', unit: 'mm', min: .01, max: 20, step: .01 },
  { key: 'exitThickness', label: '出口厚度', unit: 'mm', min: .01, max: 20, step: .01 },
  { key: 'force', label: '轧制力', min: 1, max: 10000, step: 1 },
  { key: 'tension', label: '后张力', min: 0, max: 200, step: .1 },
  { key: 'frontTension', label: '前张力', min: 0, max: 200, step: .1 },
  { key: 'bendingForce', label: '弯辊力', min: 0, max: 1000, step: 1 },
  { key: 'speed', label: '速度', ariaLabel: '轧制速度', min: 0, max: 3000, step: 1 },
  { key: 'temperature', label: '温度', min: -100, max: 2000, step: .1 },
];
const CASE_NUMBER_OPTIONS = {width:{min:100,max:3000,step:1},entrySetThickness:{min:.01,max:20,step:.01}};
const toValue = (field, raw) => raw === '' ? '' : fromDisplay(field, Number(raw));
const info = '此参数不进入 25 维模型；用于工况显示或实际值对照。';
const Info = () => <span className="pm-info" tabIndex={0} title={info} aria-label={info}>ⓘ</span>;
const optionalProcessLabel = (stand, field) => stand === 'S5' ? field === 'force' ? '提供实际值' : field === 'frontTension' ? '提供该参数' : null : null;
function OptionalProcessToggle({ stand, field, onFieldChange }) {
  const label = optionalProcessLabel(stand.id, field);
  if (!label) return null;
  return <label className="pm-process-option"><input type="checkbox" aria-label={`${stand.id} ${field === 'force' ? '轧制力' : '前张力'}${label}`} checked={stand[field] != null} disabled={!onFieldChange} onChange={event => onFieldChange?.(stand.id, field, event.target.checked ? '' : null)}/>{label}</label>;
}

// Format only the idle display. Focusing restores every stored decimal; neither
// focus nor blur writes a value back through the model-input change handlers.
function EngineeringNumberInput({ field, value, onFocus, onBlur, ...props }) {
  const [focused, setFocused] = useState(false);
  const converted = toDisplay(field, value);
  const digits = ['entryThickness','exitThickness','entrySetThickness','width'].includes(field) ? 4 : field === 'temperature' ? 1 : 3;
  const displayed = converted === null ? '' : focused ? converted : Number(converted.toFixed(digits));
  return <input {...props} type="number" value={displayed}
    onFocus={event => { setFocused(true); onFocus?.(event); }}
    onBlur={event => { setFocused(false); onBlur?.(event); }}/>
}


export default function ProcessMatrix({ caseData, selected = 'S5', onSelectStand, onFieldChange, onCaseFieldChange, dirty = false, errors = [], focusRequest, layout='matrix', visibleFields=[], onVisibleFieldChange, historicalChecked }) {
  const [expanded, setExpanded] = useState(true);
  const [preferenceError,setPreferenceError]=useState('');
  const contentId = useId();
  const errorId = useId();
  const matrixRef = useRef(null);
  const stands = caseData?.stands || [];
  const columnMaxima = useMemo(() => Object.fromEntries(FIELDS.map(({ key }) => [key,
    Math.max(1, ...stands.map(stand => typeof stand[key] === 'number' && Number.isFinite(stand[key]) ? Math.max(0, stand[key]) : 0)),
  ])), [stands]);
  const steelGrades = [...new Set([caseData?.steelGrade || 'DC01', 'DC01', 'DC04', 'Q235', 'SPCC'])];
  const issue = errors[0];
  const changeCaseNumber = (key, event) => onCaseFieldChange?.(key, toValue(key, event.target.value));
  const contextRow = (stand, field) => <div className="pm-context-control" key={field.key}>
    <label className="pm-parameter-value pm-context-row"><span>{stand.id} {field.label}</span><span className="pm-parameter-number"><EngineeringNumberInput field={field.key} data-stand={stand.id} data-field={field.key} aria-label={`${stand.id} ${field.ariaLabel || field.label}`} step={field.key === 'force' ? .001 : field.step} value={stand[field.key]} disabled={!!optionalProcessLabel(stand.id, field.key) && stand[field.key] == null} readOnly={!onFieldChange} onFocus={()=>onSelectStand?.(stand.id)} onChange={event=>onFieldChange?.(stand.id,field.key,toValue(field.key,event.target.value))}/><small>{unitFor(field.key)}</small><Info/></span></label>
    <OptionalProcessToggle stand={stand} field={field.key} onFieldChange={onFieldChange}/>
  </div>;

  useEffect(() => {
    if (focusRequest?.field) setExpanded(true);
  }, [focusRequest?.stand, focusRequest?.field, focusRequest?.revision]);

  useEffect(() => {
    if (!expanded || !focusRequest?.field) return;
    const frame = requestAnimationFrame(() => {
      const inputs = Array.from(matrixRef.current?.querySelectorAll('input, select') || []);
      const target = inputs.find(input => input.dataset.field === focusRequest.field && input.dataset.stand === focusRequest.stand)
        || inputs.find(input => input.dataset.caseField === focusRequest.field);
      if (!target) return;
      const context = target.closest('.pm-context-fields');
      if (context) context.open = true;
      target.focus({ preventScroll: true });
      // Reveal only inside the matrix's horizontal scroller; never move the scene/page.
      const region = target.closest(layout==='vertical'?'.parameter-drawer':'.pm-table-scroll, .pm-case-fields');
      if (!region) return;
      const bounds = target.getBoundingClientRect(), viewport = region.getBoundingClientRect();
      if(layout==='vertical'){
        if(bounds.top<viewport.top+70)region.scrollTop+=bounds.top-viewport.top-70;
        else if(bounds.bottom>viewport.bottom-10)region.scrollTop+=bounds.bottom-viewport.bottom+10;
        return;
      }
      if (bounds.left < viewport.left + 10) region.scrollLeft += bounds.left - viewport.left - 10;
      else if (bounds.right > viewport.right - 10) region.scrollLeft += bounds.right - viewport.right + 10;
    });
    return () => cancelAnimationFrame(frame);
  }, [expanded, focusRequest?.stand, focusRequest?.field, focusRequest?.revision, layout]);

  const caseFields=<div className="pm-case-fields" aria-label="当前工况设置">
    <div className="pm-case-id"><span>工况</span><span>{readableConditionName(caseData?.id)}</span><details className="user-technical-text"><summary>查看技术信息</summary><label>工况编号<input data-case-field="id" aria-label="工况编号" value={caseData?.id ?? ''} onChange={event => onCaseFieldChange?.('id', event.target.value)} readOnly={!onCaseFieldChange} /><Info /></label></details></div>
    <label className="pm-case-grade"><span>钢种</span><input data-case-field="steelGrade" list={`${contentId}-grades`} aria-label="钢种" value={caseData?.steelGrade ?? ''} onChange={event => onCaseFieldChange?.('steelGrade', event.target.value)} readOnly={!onCaseFieldChange}/><datalist id={`${contentId}-grades`}>{steelGrades.map(grade => <option key={grade} value={grade}/>)}</datalist><Info /></label>
    {layout!=='vertical'&&<>
      <label className="pm-case-width"><span>带钢宽度</span><EngineeringNumberInput field="width" data-case-field="width" aria-label="带钢宽度" step={CASE_NUMBER_OPTIONS.width.step} value={caseData?.width ?? ''} onChange={event => changeCaseNumber('width', event)} readOnly={!onCaseFieldChange} /><small>{unitFor('width')}</small></label>
      <label className="pm-case-entry"><span>入口设定</span><EngineeringNumberInput field="entrySetThickness" data-case-field="entrySetThickness" aria-label="入口设定厚度" step={CASE_NUMBER_OPTIONS.entrySetThickness.step} value={caseData?.entrySetThickness ?? caseData?.stands?.[0]?.entryThickness ?? ''} onChange={event => changeCaseNumber('entrySetThickness', event)} readOnly={!onCaseFieldChange} /><small>{unitFor('entrySetThickness')}</small></label>
    </>}
    <label className="pm-case-target"><span>S5 目标</span><EngineeringNumberInput field="target" data-case-field="target" aria-label="S5 目标轧制力" min={toDisplay('target', 1)} max={toDisplay('target', 10000)} step="0.01" value={caseData?.target} onChange={event => changeCaseNumber('target', event)} readOnly={!onCaseFieldChange}/><small>{unitFor('target')}</small><Info /></label>
  </div>;

  if(layout==='vertical'){
    const values=modelInputValues(caseData),groups=new Map();
    for(const feature of MODEL_FEATURES){const group=feature.stand || '来料参数';if(!groups.has(group))groups.set(group,[]);groups.get(group).push(feature);}
    return <section ref={matrixRef} className="process-matrix pm-vertical" aria-label={`${MODEL_INPUT_COUNT}维正式参数编辑`}>
      <header className="pm-vertical-heading"><b>关键参数面板显示</b><span>{visibleFields.length} / {KEY_PARAMETER_LIMIT} 项</span></header>
      <p className="pm-vertical-note">勾选最多6项显示在关键参数面板；替换时先取消一项。编辑数值沿用当前预测流程。</p>
      {preferenceError&&<p className="pm-preference-error" role="status">{preferenceError}</p>}
      {issue&&<div className="pm-error" role="alert" id={errorId} title={userVisibleText(errors.join('\n'))}><CircleAlert size={12}/><UserVisibleText value={issue}/></div>}
      <div className="pm-vertical-groups">
        {[...groups].map(([group,features])=><fieldset className="pm-parameter-group" key={group}><legend>{group}</legend>
          {features.map(feature=>{
            const options=FIELDS.find(item=>item.key===feature.field) || CASE_NUMBER_OPTIONS[feature.field], row=historicalChecked?.rows?.find(item=>item.key===feature.key),status=keyParameterRangeLabel(row),shown=visibleFields.includes(feature.key);
            const fieldError=errors.find(error=>String(error).includes(feature.label));
            return <div className="pm-parameter-row" key={feature.key} data-feature-key={feature.key}>
              <label className="pm-parameter-value"><span>{feature.label}</span><span className="pm-parameter-number"><EngineeringNumberInput field={feature.field} data-stand={feature.stand || undefined} data-field={feature.stand?feature.field:undefined} data-case-field={!feature.stand?feature.field:undefined} aria-label={feature.label} step={feature.field==='force'?.01:options.step} value={values[feature.index]} readOnly={feature.stand?!onFieldChange:!onCaseFieldChange} aria-invalid={!!fieldError || undefined} aria-describedby={fieldError?errorId:undefined} onFocus={()=>feature.stand&&onSelectStand?.(feature.stand)} onChange={event=>feature.stand?onFieldChange?.(feature.stand,feature.field,toValue(feature.field,event.target.value)):changeCaseNumber(feature.field,event)}/><small>{unitFor(feature.field)}</small></span></label>
              <div className="pm-parameter-options"><small className={`data-check-${status.tone}`}>{status.text}</small><label className="pm-home-selection"><input type="checkbox" aria-label={`${feature.label}关键参数面板显示`} checked={shown} disabled={!onVisibleFieldChange || (!shown&&visibleFields.length>=KEY_PARAMETER_LIMIT)} onChange={event=>{const outcome=onVisibleFieldChange?.(feature.key,event.target.checked);setPreferenceError(outcome?.error || '');}}/>面板显示</label></div>
            </div>;
          })}
        </fieldset>)}
      </div>
      <details className="pm-context-fields"><summary>显示与工程上下文 · 非25维输入</summary>{caseFields}
        {stands.map(stand=><fieldset className="pm-parameter-group" key={stand.id}><legend>{stand.id} · 其它参数</legend>
          {FIELDS.filter(field=>!isModelInput(stand.id,field.key)).map(field=>['S4','S5'].includes(stand.id)?contextRow(stand,field):<label className="pm-parameter-value pm-context-row" key={field.key}><span>{field.label}</span><span className="pm-parameter-number"><EngineeringNumberInput field={field.key} data-stand={stand.id} data-field={field.key} aria-label={`${stand.id} ${field.ariaLabel || field.label}`} step={field.key==='force'?.01:field.step} value={stand[field.key]} readOnly={!onFieldChange} onFocus={()=>onSelectStand?.(stand.id)} onChange={event=>onFieldChange?.(stand.id,field.key,toValue(field.key,event.target.value))}/><small>{unitFor(field.key)}</small><Info/></span></label>)}
        </fieldset>)}
      </details>
    </section>;
  }

  return <section ref={matrixRef} className={`process-matrix ${expanded ? 'pm-expanded' : 'pm-collapsed'}`} aria-label="五机架工况参数">
    <header className="pm-heading">
      <button type="button" className="pm-collapse" aria-expanded={expanded} aria-controls={contentId} aria-label={expanded ? '收起工况参数' : '展开工况参数'} onClick={() => setExpanded(value => !value)}><SlidersHorizontal size={14} aria-hidden="true" /><strong>工况参数</strong>{expanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronUp size={13} aria-hidden="true" />}</button>
      <span className="pm-scope">S1—S5</span>
      {caseFields}
      <span className={`pm-sync ${issue ? 'pm-invalid' : dirty ? 'pm-pending' : ''}`} role="status">{issue ? <CircleAlert size={12} aria-hidden="true" /> : dirty ? <Loader2 size={12} className="spin" aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}<span>{issue ? String(issue).startsWith('自动预测暂未完成') ? '连接中断' : `${errors.length} 项待修正` : dirty ? '计算中' : '已同步'}</span></span>
    </header>
    <div className="pm-content" id={contentId} hidden={!expanded}>

      <div className="pm-table-scroll" tabIndex={0} aria-label="工况参数表，可横向滚动">
        <table className="pm-table" aria-label="S1 至 S5 可编辑工况矩阵">
          <thead><tr><th scope="col">机架</th>{FIELDS.map(field => <th scope="col" key={field.key}>{field.label}<small>{unitFor(field.key)}</small></th>)}</tr></thead>
          <tbody>{stands.map(stand => <tr key={stand.id} className={`${stand.id === 'S5' ? 'pm-target-row' : ''} ${selected === stand.id ? 'pm-selected-row' : ''}`}>
            <th scope="row"><button type="button" onClick={() => onSelectStand?.(stand.id)} aria-label={`选择 ${stand.id} 工况`} aria-pressed={selected === stand.id}><b>{stand.id}</b>{stand.id === 'S5' && <span>预测目标</span>}</button></th>
            {FIELDS.map(field => {
              const value = stand[field.key];
              const amount = typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value) / columnMaxima[field.key] * 100) : 0;
              const fieldError = errors.find(error => String(error).includes(`${stand.id} ${field.label}`));
              return <td key={field.key} className={optionalProcessLabel(stand.id,field.key)?'pm-optional-cell':undefined}><div className={`pm-value ${!isModelInput(stand.id, field.key) ? 'pm-context-value' : ''}`} style={{ '--pm-amount': `${amount}%` }}><EngineeringNumberInput field={field.key} data-stand={stand.id} data-field={field.key} type="number" step={field.key === 'force' ? .001 : field.step} value={value} aria-label={`${stand.id} ${field.ariaLabel || field.label}`} aria-invalid={fieldError ? true : undefined} aria-describedby={fieldError ? errorId : undefined} title={fieldError ? userVisibleText(fieldError) : `${stand.id} ${field.label} / ${unitFor(field.key)}`} readOnly={!onFieldChange} disabled={!!optionalProcessLabel(stand.id,field.key)&&value==null} onFocus={() => onSelectStand?.(stand.id)} onChange={event => onFieldChange?.(stand.id, field.key, toValue(field.key, event.target.value))} />{!isModelInput(stand.id, field.key) && <Info />}</div><OptionalProcessToggle stand={stand} field={field.key} onFieldChange={onFieldChange}/></td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
      {issue && <div className="pm-error" role="alert" id={errorId} title={userVisibleText(errors.join('\n'))}><CircleAlert size={12} aria-hidden="true" /><UserVisibleText value={issue}/>{errors.length > 1 && <small>另 {errors.length - 1} 项</small>}</div>}
    </div>
  </section>;
}
