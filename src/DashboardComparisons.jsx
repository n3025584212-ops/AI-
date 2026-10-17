import { readableConditionName } from './userVisibleText.js';
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, ChevronRight, History } from 'lucide-react';
import { toDisplay } from './engineeringUnits.js';
import { observationDisplay } from './workbenchDisplay.js';
import { currentActualValue } from './s5ActualDisplay.js';
import './dashboard-comparisons.css';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const format = (value, digits = 1) => finite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
const signed = value => finite(value) ? `${value > 0 ? '+' : ''}${format(toDisplay('force', value), 3)} t` : '—';
const standForce = (input, id) => input?.stands?.find(stand => stand.id === id)?.force;
const chartSeries = [{ key: 'current', color: 'blue' }, { key: 'reference', color: 'orange' }];

function Legend({ current, reference }) {
  return <div className="dc-legend"><span><i />{current}</span>{reference && <span><i />{reference}</span>}</div>;
}

function ForceChart({ rows, currentLabel, referenceLabel, label }) {
  rows = rows.map(row => ({ ...row, current: toDisplay('force', row.current), reference: toDisplay('force', row.reference) }));
  const id = useId().replace(/:/g, '');
  const chart = useRef(null);
  const [size, setSize] = useState({ width: 480, height: 142 });
  const [active, setActive] = useState(null);
  useEffect(() => {
    if (!chart.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(220, Math.round(entry.contentRect.width));
      const height = Math.max(96, Math.round(entry.contentRect.height));
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(chart.current);
    return () => observer.disconnect();
  }, []);
  const width = size.width, height = size.height;
  const left = width < 400 ? 37 : 43, right = width - 12, top = 19, bottom = height - 23;
  const values = rows.flatMap(row => chartSeries.map(series => row[series.key])).filter(finite);
  const rawStep = Math.max(1, ...values) * 1.13 / 4;
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const step = ([1, 2, 2.5, 5, 10].find(multiplier => multiplier * power >= rawStep) || 10) * power;
  const maximum = step * 4;
  const y = value => bottom - value / maximum * (bottom - top);
  const groupWidth = (right - left) / Math.max(1, rows.length);
  const barWidth = Math.max(9, Math.min(21, groupWidth * .2));
  const visibleBars = rows.flatMap((row, rowIndex) => {
    const series = chartSeries.filter(item => finite(row[item.key]));
    const center = left + groupWidth * (rowIndex + .5);
    return series.map((item, seriesIndex) => ({ ...item, rowIndex, name: row.label, value: row[item.key],
      x: center + (series.length > 1 ? (seriesIndex === 0 ? -barWidth - 2 : 2) : -barWidth / 2),
      pair: series.length > 1, seriesIndex, seriesLabel: item.key === 'current' ? row.currentLabel || currentLabel : referenceLabel,
      tooltip: item.key === 'current' ? row.currentTooltip : null,
    }));
  });
  const hovered = visibleBars.find(bar => `${bar.rowIndex}-${bar.key}` === active);
  return <div ref={chart} className="dc-chart">
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label} onPointerLeave={() => setActive(null)}>
      <defs>
        <linearGradient id={`${id}-blue`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#41d6ff" stopOpacity=".58"/><stop offset=".28" stopColor="#0fb9ff" stopOpacity=".2"/><stop offset=".8" stopColor="#0587db" stopOpacity=".1"/><stop offset="1" stopColor="#4ce5ff" stopOpacity=".48"/>
        </linearGradient>
        <linearGradient id={`${id}-orange`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#ffd397" stopOpacity=".57"/><stop offset=".3" stopColor="#ffac44" stopOpacity=".2"/><stop offset=".85" stopColor="#ff9025" stopOpacity=".09"/><stop offset="1" stopColor="#ffce80" stopOpacity=".45"/>
        </linearGradient>
      </defs>
      <text className="dc-axis" x={left - 8} y="10" textAnchor="end">t</text>
      {[0, 1, 2, 3, 4].map(index => <g key={index}><line className="dc-grid-line" x1={left} x2={right} y1={y(step * index)} y2={y(step * index)}/><text className="dc-axis" x={left - 8} y={y(step * index) + 3.5} textAnchor="end">{format(step * index, 1)}</text></g>)}
      <line className="dc-baseline" x1={left} x2={right} y1={bottom} y2={bottom}/>
      {rows.map((row, index) => <text key={row.label} className="dc-category" x={left + groupWidth * (index + .5)} y={height - 6} textAnchor="middle">{row.label}</text>)}
      {visibleBars.map(bar => {
        const key = `${bar.rowIndex}-${bar.key}`;
        const position = y(bar.value), selected = active === key;
        const labelX = bar.x + barWidth / 2;
        const anchor = bar.pair ? bar.seriesIndex === 0 ? 'end' : 'start' : 'middle';
        return <g key={key} tabIndex={0} role="button" aria-label={`${bar.name}，${bar.seriesLabel} ${format(bar.value, 2)}`} onPointerEnter={() => setActive(key)} onFocus={() => setActive(key)} onBlur={() => setActive(null)} onClick={() => setActive(selected ? null : key)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActive(selected ? null : key); } }} className={`dc-bar-group ${selected ? 'dc-active' : ''}`}>
          {bar.tooltip && <title>{bar.tooltip}</title>}
          <rect className="dc-bar-hit" x={bar.x - 5} y={top} width={barWidth + 10} height={bottom - top} fill="transparent"/>
          <rect className={`dc-bar dc-bar-${bar.color} dc-hologram-body dc-hologram-${bar.color}`} x={bar.x} y={position} width={barWidth} height={Math.max(0, bottom - position)} rx="1.2" fill={`url(#${id}-${bar.color})`}/>
          {bottom - position > 3 && <>
            <ellipse className="dc-holo-floor" cx={labelX} cy={bottom} rx={barWidth*.82} ry="3" fill={bar.color==='blue'?'#2fcaff22':'#ffc46b22'} stroke={bar.color==='blue'?'#38cfff':'#ffbd67'} strokeWidth=".7"/>
            {Array.from({length:Math.min(11,Math.floor((bottom-position)/7))},(_,index)=>{const scanY=position+5+index*7;return <line className="dc-holo-scan" key={index} x1={bar.x+1} x2={bar.x+barWidth-1} y1={scanY} y2={scanY} stroke={bar.color==='blue'?'#65deff':'#ffd09a'}/>;})}
            <ellipse className="dc-holo-top" cx={labelX} cy={position} rx={barWidth/2} ry="2.3" fill={bar.color==='blue'?'#76deff66':'#ffcd8266'} stroke={bar.color==='blue'?'#a0edff':'#ffe2b0'} strokeWidth=".8"/>

            <line className={`dc-bar-cap dc-cap-${bar.color}`} x1={bar.x + 1.5} x2={bar.x + barWidth - 1.5} y1={position + .65} y2={position + .65}/>
            <line className={`dc-bar-edge dc-edge-${bar.color}`} x1={bar.x + .65} x2={bar.x + .65} y1={position + 2} y2={bottom - .75}/>
          </>}
          <text className={`dc-bar-value dc-value-${bar.color}`} x={labelX} y={Math.max(12, position - 6)} textAnchor={anchor}>{format(bar.value, 2)}</text>
        </g>;
      })}
      {!visibleBars.length && <text className="dc-waiting" x={(left + right) / 2} y={(top + bottom) / 2} textAnchor="middle">等待工况数据</text>}
    </svg>
    {hovered && <div className="dc-tooltip" role="status" title={hovered.tooltip || undefined} style={{ left: Math.max(65, Math.min(width - 65, hovered.x + barWidth / 2)), top: Math.max(1, y(hovered.value) - 47) }}><span>{hovered.name} · {hovered.seriesLabel}</span><strong>{format(hovered.value, 3)} t</strong></div>}
  </div>;
}

/** Only saved input/prediction snapshots and explicitly sourced S5 observations become bars. */
export default function DashboardComparisons({ caseData, result, resultSample, pendingStreamProjection, cases = [], onHistory, dirty = false, observationMatches = true, secondaryPanel }) {
  const [selectedId, setSelectedId] = useState('');
  // App supplies its already identity-checked completed row for presentation
  // while the next stream row is pending. Replace the entire pair together;
  // an old S5 prediction must never be paired with the new S1–S4 values.
  const holding = dirty && !!pendingStreamProjection;
  if (holding) {
    ({ caseData, result, sample: resultSample } = pendingStreamProjection);
    observationMatches = true;
  }
  const savedCases = (Array.isArray(cases) ? cases : []).filter(item => item && Array.isArray(item.input?.stands) && (['S1', 'S2', 'S3', 'S4'].some(id => finite(standForce(item.input, id))) || finite(item.prediction?.value)));
  const selectedCase = savedCases.find(item => String(item.id) === selectedId) || savedCases[0];
  const evidence = resultSample ?? caseData?.importProvenance;
  const observed = currentActualValue({caseData,result,resultSample:evidence,dirty:dirty&&!holding,observationMatches});
  const prediction = finite(result?.value) ? result.value : null;
  const observationText = observationDisplay(evidence);
  const observedName = observationText.caption;
  const upstream = ['S1', 'S2', 'S3', 'S4'].map(id => ({ label: id, current: standForce(caseData, id) }));
  const lineRows = [...upstream, { label: 'S5', reference: prediction }];
  const historyName = readableConditionName(selectedCase?.name || selectedCase?.input?.id, '已保存工况');
  const historyRows = selectedCase ? [...upstream.map(row => ({ ...row, reference: standForce(selectedCase.input, row.label) })), { label: 'S5 预测', current: prediction, reference: selectedCase.prediction?.value }]
    : observed !== null ? [...upstream, { label: 'S5 实际值', current: observed, currentLabel: observedName, currentTooltip: observationText.tooltip }, { label: 'S5 预测', reference: prediction }]
      : [...upstream, { label: 'S5 预测', current: prediction }];
  const currentLabel = selectedCase || observed === null ? '当前工况' : '工况轧制力 / S5 实际值';
  const referenceLabel = selectedCase ? historyName : observed !== null ? '模型预测' : null;
  const comparisonDelta = selectedCase && finite(prediction) && finite(selectedCase.prediction?.value) ? prediction - selectedCase.prediction.value : null;
  return <div className="dc-comparisons">
    <section className="dc-panel" aria-labelledby="dc-line-title" aria-busy={holding} data-display-snapshot-id={result?.snapshot_id}>
      <div className="dc-heading"><h3 id="dc-line-title">各机架轧制力对照</h3>{holding&&<span className="dc-updating" role="status" title="保留上一条已完成工况，当前工况预测完成后一起更新">正在更新</span>}<Legend current="S1–S4 轧制力" reference="S5 预测"/></div>
      <ForceChart rows={lineRows} currentLabel={holding?'上次工况轧制力':'工况轧制力'} referenceLabel={holding?'上次 S5 预测 · 正在更新':'S5 预测'} label={holding?'上一条已完成工况轧制力对照，当前工况正在更新':'S1、S2、S3、S4 轧制力与 S5 预测对照'}/>
    </section>
    {secondaryPanel || <section className="dc-panel dc-history-panel" aria-labelledby="dc-history-title">
      <div className="dc-heading"><h3 id="dc-history-title">已保存工况对比</h3><div className="dc-history-tools">{selectedCase && <select aria-label="选择已保存对比工况" value={String(selectedCase.id)} onChange={event => setSelectedId(event.target.value)}>{savedCases.map(item => <option key={item.id} value={String(item.id)}>{readableConditionName(item.name || item.input?.id || item.id)}</option>)}</select>}<button className="dc-history-link" onClick={onHistory} disabled={!onHistory} title="已保存工况" aria-label="已保存工况"><History size={13}/><ChevronRight size={11}/></button></div></div>
      <div className="dc-history-legend"><Legend current={currentLabel} reference={referenceLabel}/>{comparisonDelta !== null && <span className="dc-difference">S5 {comparisonDelta < 0 ? <ArrowDownRight size={11}/> : <ArrowUpRight size={11}/>}{signed(comparisonDelta)}</span>}</div>
      <ForceChart rows={historyRows} currentLabel={currentLabel} referenceLabel={referenceLabel} label={selectedCase ? `当前工况与 ${historyName} 的轧制力对比` : observed !== null ? '当前样本 S5 实际值与预测对照' : '当前工况轧制力，尚未保存已保存工况'}/>
      <div className="dc-foot"><span>{selectedCase ? <><i className="dc-record-dot"/>{historyName}{!finite(standForce(selectedCase.input, 'S4')) && ' · 已保存 S4：—（未保存）'}</> : '尚未保存已保存工况'}</span><button className="dc-text-link" onClick={onHistory} disabled={!onHistory}>{selectedCase ? '查看记录' : '管理工况'}<ChevronRight size={11}/></button></div>
    </section>}
  </div>;
}
