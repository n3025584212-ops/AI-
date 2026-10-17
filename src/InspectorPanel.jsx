import { ArrowRight, Bot, SlidersHorizontal, WandSparkles } from 'lucide-react';
import { toDisplay, fromDisplay, unitFor, formatEngineering } from './engineeringUnits.js';
import { isModelInput } from './modelInputs.js';

const PARAMETERS = [
  { field: 'force', label: '轧制力', min: 1, max: 10000 },
  { field: 'tension', label: '后张力', min: 0, max: 200 },
  { field: 'frontTension', label: '前张力', min: 0, max: 200 },
  { field: 'bendingForce', label: '弯辊力', min: 0, max: 1000 },
  { field: 'speed', label: '轧制速度', min: 0, max: 3000 },
  { field: 'entryThickness', label: '入口厚度', min: .01, max: 20 },
  { field: 'exitThickness', label: '出口厚度', min: .01, max: 20 },
  { field: 'temperature', label: '温度', min: -100, max: 2000 },
];

const number = value => typeof value === 'number' && Number.isFinite(value)
  ? value.toLocaleString('zh-CN', { maximumFractionDigits: 3 })
  : '—';

export default function InspectorPanel({
  caseData,
  result,
  selected = 'S5',
  setSelected,
  onFieldChange,
  onOpenAI,
  onOptimize,
  dirty = false,
}) {
  const stands = caseData?.stands || [];
  const stand = stands.find(item => item.id === selected);
  const deviation = result?.deviation;
  const hasPrediction = Number.isFinite(result?.value) && Number.isFinite(result?.target);
  const leading = result?.drivers?.[0];
  const localDriver = result?.drivers?.find(item => item.stand === selected);
  const tendency = deviation > 0 ? '高于' : deviation < 0 ? '低于' : '等于';
  const explanation = dirty
    ? '参数已变化，预测正在更新。下方保留上次有效结果；输入不完整时会等待修正。'
    : hasPrediction
      ? `S5 估算${tendency}目标${deviation ? ` ${number(Math.abs(deviation))}%` : ''}。${localDriver ? `当前机架的主要敏感参数为${localDriver.name.replace(`${selected} `, '')}。` : leading ? `主要敏感参数为${leading.name}。` : ''}`
      : '补齐工况参数后，系统会自动更新 S5 预测与参数解释。';

  const changeField = (field, rawValue) => {
    if (!stand) return;
    if (rawValue === '') onFieldChange?.(stand.id, field, '');
    else {
      const value = Number(rawValue);
      if (Number.isFinite(value)) onFieldChange?.(stand.id, field, fromDisplay(field, value));
    }
  };

  return <aside className="inspector-panel" aria-label="机架参数检查器">
    <header className="inspector-heading">
      <SlidersHorizontal size={15} aria-hidden="true" />
      <h2>机架检查器</h2>
      <span className={`inspector-sync ${dirty ? 'inspector-sync-pending' : 'inspector-sync-ready'}`}>
        {dirty ? '待同步' : '已同步'}
      </span>
    </header>

    <div className="inspector-stand-switch" role="group" aria-label="选择检查机架">
      {stands.map(item => <button key={item.id} type="button"
        className={`inspector-stand-button ${selected === item.id ? 'inspector-stand-selected' : ''}`}
        aria-label={`检查 ${item.id} 机架`} aria-pressed={selected === item.id}
        onClick={() => setSelected?.(item.id)}>{item.id}</button>)}
    </div>

    <section className="inspector-parameters" aria-label={`${selected} 工况参数`}>
      <div className="inspector-section-heading">
        <h3>{selected} 工况参数</h3>
      </div>
      {stand ? <>
        <div className="inspector-field-list">
          {PARAMETERS.map(({ field, label, min, max }) => <label className="inspector-field" key={field}>
            <span>{label} <small>{unitFor(field)}</small>{!isModelInput(selected, field) && <span title="此参数不进入 25 维模型；修改不会重新预测。" aria-label="此参数不进入 25 维模型；修改不会重新预测。"> ⓘ</span>}</span>
            <input type="number" step="any" min={toDisplay(field, min)} max={toDisplay(field, max)}
              aria-label={`${selected} 检查器 ${label}`}
              value={toDisplay(field, stand[field]) ?? ''}
              onChange={event => changeField(field, event.target.value)} />
          </label>)}
        </div>
        <div className="inspector-tension-control">
          <div className="inspector-slider-label"><span>后张力微调</span><span>0 — 200 t</span></div>
          <input className="inspector-tension-slider" type="range" min="0" max="200" step="any"
            aria-label={`${selected} 后张力微调滑块`}
            value={Number.isFinite(stand.tension) ? Math.max(0, Math.min(200, stand.tension)) : 0}
            disabled={!Number.isFinite(stand.tension)}
            onChange={event => changeField('tension', event.target.value)} />
        </div>
      </> : <p className="inspector-empty">请选择已载入的机架。</p>}
    </section>

    <section className="inspector-prediction" aria-label="S5 自动预测">
      <div className="inspector-section-heading"><h3>S5 预测反馈</h3><span>{dirty ? '上次有效结果' : '自动更新'}</span></div>
      <dl className="inspector-prediction-values">
        <div><dt>{result?.mode === 'formal' ? '模型预测' : '演示预测'}</dt><dd>{formatEngineering('force', result?.value, 3)}</dd></div>
        <div><dt>目标设定</dt><dd>{formatEngineering('target', caseData?.target, 3)}</dd></div>
      </dl>
      <div className="inspector-deviation"><span>目标偏差</span><strong>
        {Number.isFinite(deviation) ? `${deviation > 0 ? '+' : ''}${number(deviation)}%` : '—'}
      </strong></div>
    </section>

    <section className="inspector-assistant" aria-label="DK 当前工况解释">
      <div className="inspector-section-heading"><h3><Bot size={15} aria-hidden="true" />DK 工艺 Agent</h3></div>
      <p className="inspector-explanation" aria-live="polite">{explanation}</p>
      <div className="inspector-actions">
        <button className="inspector-ai-button" type="button" onClick={onOpenAI}>
          询问 DK 工艺 Agent<ArrowRight size={13} aria-hidden="true" />
        </button>
        <button className="inspector-optimize-button" type="button" onClick={onOptimize}
          disabled={dirty || !hasPrediction}>
          <WandSparkles size={13} aria-hidden="true" />生成候选方案
        </button>
      </div>
    </section>
  </aside>;
}
