import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Clock3, Loader2 } from 'lucide-react';
import { validateCase } from './domain.js';
import { summarizeModelInputs } from './modelInputs.js';
import { completedPredictionValues } from './predictionSnapshot.js';
import { toDisplay, fromDisplay } from './engineeringUnits.js';
import './prediction-panels.css';
import { currentActualValue } from './s5ActualDisplay.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const format = (value, digits = 2) => finite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
const signed = (value, digits = 2) => finite(value) ? `${value > 0 ? '+' : ''}${format(value, digits)}` : '—';
const force = (value, digits = 3) => format(toDisplay('force', value), digits);
const signedForce = value => finite(value) ? `${value > 0 ? '+' : ''}${force(value)}` : '—';
const clock = value => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString('zh-CN', { hour12: false }) : '—';
};
const stable = value => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
/** A history entry is a completed calculation, never a timer-generated sample. */
export function usePredictionHistory({ result, resultCase, resultSample, dirty, sessionKey = 0 }) {
  const [record, setRecord] = useState({ caseId: null, sessionKey, points: [] });
  const caseId = resultCase?.id ?? null;
  const inputSignature = useMemo(() => stable(resultCase), [resultCase]);
  const resultSignature = finite(result?.value) ? `${result.value}|${result.target}|${resultSample?.sample_timestamp}|${resultSample?.observed}` : null;
  useEffect(() => {
    const valid = !dirty && finite(result?.value) && finite(result?.target)
      && result?.target === resultCase?.target && (result?.mode==='formal'?summarizeModelInputs(resultCase).valid:validateCase(resultCase).length === 0);
    setRecord(previous => {
      const sameSession = previous.caseId === caseId && previous.sessionKey === sessionKey;
      const points = sameSession ? previous.points : [];
      if (!valid) return sameSession ? previous : { caseId, sessionKey, points: [] };
      const signature = `${inputSignature}|${resultSignature}`;
      if (points.at(-1)?.signature === signature) return previous;
      const snapshot = structuredClone(resultCase);
      const point = {
        ...completedPredictionValues(result, snapshot, resultSample), signature, input: snapshot,
        time: resultSample?.sample_timestamp || new Date().toISOString(), sequence: (points.at(-1)?.sequence ?? 0) + 1,
      };
      return { caseId, sessionKey, points: [...points, point].slice(-24) };
    });
  }, [caseId, sessionKey, inputSignature, resultSignature, dirty, result, resultCase, resultSample]);
  return record.caseId === caseId && record.sessionKey === sessionKey ? record.points : [];
}

export function PredictionSummary({ result, resultCase, resultSample, caseData, dirty = false, observationMatches = true, errors = [], autoStatus, onTargetChange, lastUpdated }) {
  const values = completedPredictionValues(result, caseData || resultCase, resultSample);
  const observed = currentActualValue({caseData:caseData||resultCase,result,resultSample,dirty,observationMatches});
  const observedDelta = finite(values.value) && finite(observed) ? values.value - observed : null;
  const status = dirty ? ['连接中断', '预测失败'].includes(autoStatus) ? autoStatus : errors.length ? '参数待修正' : '正在更新' : '已更新';
  return <section className={`prediction-ribbon ${dirty ? 'is-stale' : ''}`} aria-label="S5 轧制力预测结果">
    <div className="prediction-primary">
      <span className="prediction-eyebrow">S5 轧制力预测 <small className="prediction-mode" title={result?.mode==='formal'?'QCDKR 已训练模型':'当前使用演示计算，尚未加载正式训练权重'}>{result?.mode==='formal'?'模型':result?.mode==='pending'?'等待':'演示'}</small></span>
      <strong className="prediction-value">{force(values.value)} <small>t</small></strong>
    </div>
    <label className="prediction-target">
      <span>目标轧制力 / t <span title="目标不进入 25 维模型；修改不会重新预测。">ⓘ</span></span>
      <input aria-label="S5 目标轧制力" type="number" min={toDisplay('target', 1)} max={toDisplay('target', 10000)} step="0.01" value={toDisplay('target', caseData?.target) ?? ''} disabled={!onTargetChange} onChange={event => onTargetChange?.(event.target.value === '' ? '' : fromDisplay('target', Number(event.target.value)))} />
    </label>
    <div className="prediction-metric prediction-target-delta">
      <span>目标偏差 / t</span>
      <div><strong>{signedForce(dirty ? null : values.delta)}</strong><small>{dirty ? '—' : signed(values.percent)}%</small></div>
    </div>
    {observed!==null&&<div className="prediction-metric prediction-observed">
      <span>实际值 / t</span>
      <div><strong>{force(observed)}</strong><small title="模型预测减去匹配实际值，单位 t">预测－实际值 {signedForce(observedDelta)}</small></div>
    </div>}
    <div className={`prediction-status ${dirty ? 'is-pending' : ''}`} role="status" title={dirty ? errors[0] || `${status}，当前展示上次有效计算结果` : `计算更新时间 ${clock(lastUpdated)}`}>
      {dirty ? <Loader2 size={13} className={errors.length || autoStatus === '连接中断' ? '' : 'spin'} /> : <Check size={13} />}
      <span>{dirty ? '上次结果' : status}<small>{dirty ? status : clock(lastUpdated)}</small></span>
    </div>
  </section>;
}

function extent(values, fraction = .18) {
  const usable = values.filter(finite);
  if (!usable.length) return [0, 1];
  const lo = Math.min(...usable), hi = Math.max(...usable);
  const pad = Math.max((hi - lo) * fraction, Math.abs(hi) * .003, .1);
  const span = hi - lo + pad * 2;
  const step = 10 ** Math.floor(Math.log10(span)) / 2;
  return [Math.floor((lo - pad) / step) * step, Math.ceil((hi + pad) / step) * step];
}

function Comparison({ values }) {
  const { value, target, observed } = values;
  const [low, high] = extent([value, target, observed]);
  const x = number => 8 + (number - low) / (high - low) * 186;
  const axisDigits = high - low < 10 ? 1 : 0;
  return <svg className="prediction-comparison" viewBox="0 0 202 124" role="img" aria-label={`S5 预测 ${force(value)}，目标 ${force(target)}${finite(observed)?'，实际值 '+force(observed):''}`}>
    {[8, 54.5, 101, 147.5, 194].map(position => <line key={position} x1={position} x2={position} y1="23" y2="83" className="prediction-gridline" />)}
    {finite(target) && <line x1={x(target)} x2={x(target)} y1="23" y2="86" className="prediction-target-line" />}
    <text x="0" y="12" className="prediction-svg-label">预测</text><text x="202" y="12" textAnchor="end" className="prediction-svg-number prediction-svg-forecast">{force(value)}</text>
    <line x1="8" x2="194" y1="33" y2="33" className="prediction-track" />
    {finite(value) && <><line x1={finite(target) ? x(target) : 8} x2={x(value)} y1="33" y2="33" className="prediction-forecast-line" /><circle cx={x(value)} cy="33" r="4" className="prediction-forecast-dot" /></>}
    {finite(observed)&&<><text x="0" y="63" className="prediction-svg-label">实际值</text><text x="202" y="63" textAnchor="end" className="prediction-svg-number">{force(observed)}</text>
    <line x1="8" x2="194" y1="80" y2="80" className="prediction-track" /></>}
    {finite(observed) && <><line x1={finite(target) ? x(target) : 8} x2={x(observed)} y1="80" y2="80" className="prediction-observed-line" /><circle cx={x(observed)} cy="80" r="3.5" className="prediction-observed-dot" /></>}
    <text x="8" y="102" className="prediction-axis">{force(low, axisDigits)}</text><text x="194" y="102" textAnchor="end" className="prediction-axis">{force(high, axisDigits)}</text>
    <text x="101" y="121" textAnchor="middle" className="prediction-svg-target">目标 {force(target)}</text>
  </svg>;
}

function HistoryPlot({ history }) {
  const [inspected, setInspected] = useState(null);
  const [low, high] = extent(history.flatMap(point => [point.value, point.target]), .12);
  const x = index => 7 + index / Math.max(1, history.length - 1) * 188;
  const y = value => 67 - (value - low) / (high - low) * 54;
  const selected = history.find(point => point.sequence === inspected) || history.at(-1);
  return <div className="prediction-history">
    <div className="prediction-section-heading"><span>本次计算</span><small>{history.length} 次</small></div>
    <svg viewBox="0 0 202 83" role="group" aria-label="当前工况各次有效计算的预测与目标趋势" onMouseLeave={() => setInspected(null)}>
      {[15, 40, 67].map(position => <line key={position} x1="7" x2="195" y1={position} y2={position} className="prediction-gridline" />)}
      <polyline points={history.map((point, index) => `${x(index)},${y(point.target)}`).join(' ')} className="prediction-history-target" />
      <polyline points={history.map((point, index) => `${x(index)},${y(point.value)}`).join(' ')} className="prediction-history-forecast" />
      {history.map((point, index) => <g key={`${point.sequence}-${point.signature}`} role="button" tabIndex={0} aria-label={`第 ${point.sequence} 次，${clock(point.time)}，预测 ${force(point.value)}，目标 ${force(point.target)}`} onMouseEnter={() => setInspected(point.sequence)} onFocus={() => setInspected(point.sequence)} onBlur={() => setInspected(null)} onClick={() => setInspected(point.sequence)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setInspected(point.sequence); } }}>
        <title>{`第 ${point.sequence} 次 · ${clock(point.time)}\n预测 ${force(point.value)} · 目标 ${force(point.target)}`}</title>
        <circle cx={x(index)} cy={y(point.value)} r="8" fill="transparent" />
        <circle cx={x(index)} cy={y(point.value)} r={point === selected ? 3.5 : 2} className="prediction-forecast-dot" />
      </g>)}
      <text x="7" y="81" className="prediction-axis">#{history[0].sequence}</text><text x="195" y="81" textAnchor="end" className="prediction-axis">#{history.at(-1).sequence}</text>
    </svg>
    <div className="prediction-history-readout"><span>{clock(selected?.time)}</span><strong>{force(selected?.value)}</strong><span className="prediction-history-target-value" title="本次目标">{force(selected?.target)}</span></div>
    <div className="prediction-legend"><span><i />预测</span><span><i />目标</span></div>
  </div>;
}

export function PredictionTrace({ history = [], result, resultCase, resultSample, dirty = false }) {
  const values = {...completedPredictionValues(result,resultCase,resultSample),observed:currentActualValue({caseData:resultCase,result,resultSample,dirty})};
  return <section className={`prediction-trace ${dirty ? 'is-stale' : ''}`} aria-label="S5 预测对比与计算趋势（t）">
    <div className="prediction-panel-heading"><h3>预测对比 <small>t</small></h3>{dirty && <small>上次结果</small>}</div>
    <Comparison values={values} />
    {history.length > 1 ? <HistoryPlot history={history} /> : <div className="prediction-initial-result"><Clock3 size={12} /><span>最近计算</span><time>{history[0] ? clock(history[0].time) : '—'}</time></div>}
  </section>;
}

export function PredictionInfluence({ result, dirty = false, onSelectParameter }) {
  const drivers = (Array.isArray(result?.drivers) ? result.drivers : []).filter(driver => finite(driver.value) && driver.value >= 0).slice().sort((a, b) => b.value - a.value).slice(0, 5);
  const largest = Math.max(1, ...drivers.map(driver => driver.value));
  return <section className={`prediction-influence ${dirty ? 'is-stale' : ''}`} aria-label="S5 预测参数影响">
    <div className="prediction-panel-heading"><h3>参数影响</h3><small title={result?.sensitivityMethod||'演示公式内的相对敏感度；非模型准确率'}>{result?.sensitivityLabel||'相对敏感度'}</small></div>
    <div className="prediction-drivers">{drivers.map(driver => <button key={`${driver.stand}-${driver.name}`} className="prediction-driver" disabled={!onSelectParameter} onClick={() => onSelectParameter?.(driver)} title={`${result?.mode==='formal'?'模型参数响应':'演示公式敏感度'} ${format(driver.value, 1)}%；参数增加时预测${driver.direction === 'negative' ? '下降' : '上升'}。点击定位输入。`}>
      <span className="prediction-driver-top"><span>{driver.name}</span><b>{format(driver.value, 1)}<small>%</small></b></span>
      <span className="prediction-driver-bottom"><span className="prediction-driver-track"><i style={{ width: `${driver.value / largest * 100}%` }} /></span>{driver.direction === 'negative' ? <ArrowDown size={12} aria-label="增加此参数时预测下降" /> : <ArrowUp size={12} aria-label="增加此参数时预测上升" />}</span>
    </button>)}</div>
    {dirty && <div className="prediction-influence-stale">上次计算结果</div>}
  </section>;
}
