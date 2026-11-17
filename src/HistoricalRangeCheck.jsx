import { useEffect, useState } from 'react';
import { DEFAULT_INPUT_RANGE_TABLE as rangeTable } from './inputRangeDefaults.js';
import { readCustomLimits, saveCustomLimit, resetCustomLimit, resetAllCustomLimits, RANGE_EXPLANATION, RANGE_LIMITS_CHANGED_EVENT, CUSTOM_LIMITS_KEY } from './historicalRangeCheck.js';
import { rangeBoundSourceLabel } from './formalInputRanges.js';
import { effectiveRangeProjection } from './effectiveRangeProjection.js';

const number = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US',{maximumFractionDigits:6}) : '—';
const range = (min,max,unit) => `${number(min)} ～ ${number(max)}${unit ? ` ${unit}` : ''}`;
const storage = () => { try { return globalThis.localStorage; } catch { return null; } };
const statusText = {NORMAL:'有效范围内',REVIEW_RECOMMENDED:'超出有效范围',INSUFFICIENT_HISTORY:'无可用范围',DEGENERATE:'现有范围固定',NOT_CHECKED:'当前值待补全'};
// Uniform user-facing label; range decisions and origin metadata stay unchanged.
export function rangeConstraintLabel(row) {
  return `下限：${rangeBoundSourceLabel(row?.lowerSource)}；上限：${rangeBoundSourceLabel(row?.upperSource)}`;
}

// Summarize existing classifications only; range decisions stay in the shared check.
export function dataCheckSummary(checked) {
  if (!Array.isArray(checked?.rows) || !checked.rows.length) return null;
  return [
    ['NORMAL','normal',n=>`${n}项正常`,n=>`${n}正常`],
    ['REVIEW_RECOMMENDED','warning',n=>`${n}项超出有效范围`,n=>`${n}超范围`],
    ['INSUFFICIENT_HISTORY','neutral',n=>`${n}项无可用范围`,n=>`${n}无可用范围`],
    ['DEGENERATE','neutral',n=>`${n}项范围固定`,n=>`${n}项固定`],
    ['NOT_CHECKED','neutral',n=>`${n}项待补全`,n=>`${n}待补全`],
  ].map(([status,tone,full,compact])=>{
    const count=checked.rows.filter(row=>row.status===status).length;
    return {status,tone,count,full:full(count),compact:compact(count)};
  }).filter(item=>item.count>0);
}

function DataCheckHeading({items}) {
  return <><b>工况范围检查 · {rangeTable.fields && Object.keys(rangeTable.fields).length}项</b><span className="data-check-status" role="status" aria-label={items ? items.map(item=>item.full).join(' · ') : '参考范围未启用'}>
    {items ? items.map((item,index)=><span key={item.status} className={`data-check-status-item data-check-${item.tone}`}>
      {index>0&&<span className="data-check-separator" aria-hidden="true"> · </span>}<span className="data-check-full" aria-hidden="true">{item.full}</span><span className="data-check-compact" aria-hidden="true">{item.compact}</span>
    </span>) : <span className="data-check-neutral">有效范围未启用</span>}
  </span></>;
}

function RangeEditor({row,onSave,onReset}) {
  const [min,setMin]=useState(row.override?.min?.toString() || ''), [max,setMax]=useState(row.override?.max?.toString() || ''), [error,setError]=useState('');
  useEffect(()=>{setMin(row.override?.min?.toString() || '');setMax(row.override?.max?.toString() || '');setError('');},[row.override?.min,row.override?.max]);
  const save=event=>{event.preventDefault();const outcome=onSave(row.key,min,max);setError(outcome.error || '');};
  const reset=()=>{const outcome=onReset(row.key);setError(outcome.error || '');};
  return <form className="historical-range-editor" onSubmit={save} aria-label={`${row.label}自定义范围`}>
    <div><input aria-label={`${row.label}下限（${row.unit || '—'}）`} inputMode="decimal" value={min} onChange={event=>setMin(event.target.value)} placeholder="下限"/><span>～</span><input aria-label={`${row.label}上限（${row.unit || '—'}）`} inputMode="decimal" value={max} onChange={event=>setMax(event.target.value)} placeholder="上限"/><small>{row.unit || '—'}</small></div>
    <div><button type="submit">保存范围</button><button type="button" disabled={!row.override} onClick={reset}>恢复默认范围</button></div>
    {error && <small role="alert">{error}</small>}
  </form>;
}

// The workbench shares this existing check with its navigation summary.
export function useHistoricalRangeCheck(caseData) {
  const [limits,setLimits]=useState(()=>readCustomLimits(storage())), [error,setError]=useState('');
  useEffect(()=>{
    const refresh=event=>{if(event.type !== 'storage' || event.key === CUSTOM_LIMITS_KEY || event.key === null)setLimits(readCustomLimits(storage()));};
    globalThis.addEventListener?.(RANGE_LIMITS_CHANGED_EVENT,refresh);globalThis.addEventListener?.('storage',refresh);
    return ()=>{globalThis.removeEventListener?.(RANGE_LIMITS_CHANGED_EVENT,refresh);globalThis.removeEventListener?.('storage',refresh);};
  },[]);
  const {checked,effectiveRanges}=effectiveRangeProjection(caseData,rangeTable,limits);
  const save=(key,min,max)=>{const outcome=saveCustomLimit(storage(),limits,key,min,max);if(outcome.ok)setLimits(outcome.limits);return outcome;};
  const reset=key=>{const outcome=resetCustomLimit(storage(),limits,key);if(outcome.ok)setLimits(outcome.limits);return outcome;};
  const resetAll=()=>{const outcome=resetAllCustomLimits(storage(),text=>globalThis.confirm(text));if(outcome.ok)setLimits(outcome.limits);setError(outcome.error || '');};
  return {checked,effectiveRanges,limits,error,save,reset,resetAll};
}

export function HistoricalRangeDetails({checked,limits={},error,save,reset,resetAll,expanded=false}) {
  const items=dataCheckSummary(checked);
  if (!items) return <div className="historical-range-check" aria-label="数据检查"><div className="historical-range-heading status-row">{DataCheckHeading({items:null})}</div></div>;
  const content = <>
    <p className="historical-range-description">{RANGE_EXPLANATION}</p>
    <p className="historical-range-source">默认输入参考范围 · 用户自定义范围优先 · 范围只作提示，不阻断导入或预测</p>
    <div className="historical-range-table-scroll"><table className="historical-range-table">
      <thead><tr><th scope="col">字段 / 工程单位</th><th scope="col">当前值</th><th scope="col">当前参考范围 / 逐侧来源</th><th scope="col">默认范围 / 逐侧来源</th><th scope="col">状态</th><th scope="col">按字段自定义</th></tr></thead>
      <tbody>{checked.sortedRows.map(row=><tr key={row.key} data-range-status={row.status}>
        <th scope="row">{row.label}<small>{row.unit || '—'}{!row.isModelInput && ' · 工艺显示字段'}</small></th><td>{number(row.value)} {row.unit || ''}</td>
        <td className="range-status-source">{range(row.min,row.max,row.unit)}<small>{rangeConstraintLabel(row)}</small></td>
        <td className="range-status-source">{range(row.defaultLower,row.defaultUpper,row.unit)}<small>下限：{rangeBoundSourceLabel(row.defaultLowerSource)}；上限：{rangeBoundSourceLabel(row.defaultUpperSource)}</small></td><td>{statusText[row.status]}</td>
        <td><RangeEditor row={row} onSave={save} onReset={reset}/></td>
      </tr>)}</tbody>
    </table></div>
    <div className="historical-range-reset"><button type="button" disabled={!Object.keys(limits).length} onClick={resetAll}>恢复全部默认范围</button>{error&&<span role="alert">{error}</span>}</div>
  </>;
  if (expanded) return <div className="historical-range-check is-expanded" aria-label="数据检查">
    <div className="historical-range-heading status-row">{DataCheckHeading({items})}<span className="data-check-detail-action">查看详情 <span aria-hidden="true">›</span></span></div>
    {content}
  </div>;
  return <div className="historical-range-check" aria-label="数据检查">
    <details className="historical-range-details"><summary className="historical-range-heading status-row">{DataCheckHeading({items})}<span className="data-check-detail-action">查看详情 <span aria-hidden="true">›</span></span></summary>
      {content}
    </details>
  </div>;
}

export default function HistoricalRangeCheck({caseData}) {
  return HistoricalRangeDetails(useHistoricalRangeCheck(caseData));
}
