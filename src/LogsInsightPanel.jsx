import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { LOG_LEVEL_LABELS, LOG_LEVEL_TONES } from './logsInsight.js';

const signed = value => (Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(3)}` : '—');
const fixed = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : '—');
const clock = value => (Number.isFinite(value) ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '—');

// The chart is drawn in device pixels so stroke widths and dots stay undistorted.
// Both dimensions come from the container so CSS decides the chart height.
function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function DeviationChart({ prediction, loading }) {
  const host = useRef(null);
  const { width, height } = useElementSize(host);
  const gradientId = useId().replace(/:/g, '');
  const pad = { left: 38, right: 12, top: 12, bottom: 16 };
  const points = prediction?.points || [];
  const bounds = prediction?.range || { lowerBound: -50, upperBound: 50 };
  const innerWidth = Math.max(0, width - pad.left - pad.right);
  const innerHeight = Math.max(6, height - pad.top - pad.bottom);
  const boundEdge = Math.max(Math.abs(bounds.lowerBound), Math.abs(bounds.upperBound), 1);
  const observed = points.reduce((max, point) => Math.max(max, Math.abs(point.deviation)), 0);
  // Zoom to the signal so a healthy run still shows its shape; when a point
  // leaves the allowed band the domain grows and the band becomes visible.
  const domain = Math.max(observed * 1.35, 1);
  const bandVisible = boundEdge <= domain;
  const tick = value => (value >= 10 ? value.toFixed(0) : value.toFixed(1));
  const at = index => (points.length > 1 ? pad.left + (innerWidth * index) / (points.length - 1) : pad.left + innerWidth / 2);
  const rate = value => pad.top + innerHeight / 2 - (value / domain) * (innerHeight / 2);
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${at(index).toFixed(1)},${rate(point.deviation).toFixed(1)}`).join(' ');
  const area = points.length > 1
    ? `${line} L${at(points.length - 1).toFixed(1)},${rate(0).toFixed(1)} L${at(0).toFixed(1)},${rate(0).toFixed(1)} Z`
    : '';
  const last = points[points.length - 1];

  return (
    <div className="logs-chart-plot" ref={host}>
      {width > 0 && height > 0 && (
        <svg width={width} height={height} role="img"
          aria-label={`预测偏差走势：最近 ${points.length} 次预测，允许偏差 ${bounds.lowerBound} 至 ${bounds.upperBound} 吨`}>
          <defs>
            <linearGradient id={`logs-area-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5ed3e8" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#5ed3e8" stopOpacity="0" />
            </linearGradient>
          </defs>
          {bandVisible && <rect x={pad.left} y={rate(bounds.upperBound)} width={innerWidth}
            height={Math.max(1, rate(bounds.lowerBound) - rate(bounds.upperBound))}
            className="logs-chart-band" />}
          {bandVisible && <line x1={pad.left} x2={pad.left + innerWidth} y1={rate(bounds.upperBound)} y2={rate(bounds.upperBound)} className="logs-chart-edge" />}
          {bandVisible && <line x1={pad.left} x2={pad.left + innerWidth} y1={rate(bounds.lowerBound)} y2={rate(bounds.lowerBound)} className="logs-chart-edge" />}
          <line x1={pad.left} x2={pad.left + innerWidth} y1={rate(domain)} y2={rate(domain)} className="logs-chart-grid" />
          <line x1={pad.left} x2={pad.left + innerWidth} y1={rate(-domain)} y2={rate(-domain)} className="logs-chart-grid" />
          <line x1={pad.left} x2={pad.left + innerWidth} y1={rate(0)} y2={rate(0)} className="logs-chart-zero" />
          {[domain, 0, -domain].map(value => (
            <text key={value} x={pad.left - 7} y={rate(value) + 3.5} textAnchor="end" className="logs-chart-axis">
              {value > 0 ? `+${tick(value)}` : value < 0 ? `-${tick(-value)}` : '0'}
            </text>
          ))}
          {area && <path d={area} fill={`url(#logs-area-${gradientId})`} />}
          {points.length > 1 && <path d={line} className="logs-chart-line" />}
          {points.map((point, index) => (point.inRange === false
            ? <circle key={point.id || index} cx={at(index)} cy={rate(point.deviation)} r={3} className="logs-chart-dot is-breach">
                <title>{`${clock(point.time)} · 预测 ${fixed(point.rawPrediction, 3)} t · 实际 ${fixed(point.actualValue, 3)} t · 偏差 ${signed(point.deviation)} t`}</title>
              </circle>
            : null))}
          {last && (
            <>
              <circle cx={at(points.length - 1)} cy={rate(last.deviation)} r={5} className="logs-chart-ring" />
              <text x={Math.min(pad.left + innerWidth, at(points.length - 1) + 8)} y={Math.max(11, rate(last.deviation) - 8)}
                textAnchor="end" className={`logs-chart-last${last.inRange === false ? ' is-breach' : ''}`}>
                {signed(last.deviation)} t
              </text>
            </>
          )}
          {points.length > 1 && (
            <>
              <text x={pad.left} y={height - 3} className="logs-chart-axis">{clock(points[0].time)}</text>
              <text x={pad.left + innerWidth} y={height - 3} textAnchor="end" className="logs-chart-axis">{clock(last.time)}</text>
            </>
          )}
        </svg>
      )}
      {!loading && points.length < 2 && <p className="logs-chart-empty">暂无可绘制的预测记录</p>}
      {loading && points.length < 2 && <p className="logs-chart-empty"><Loader2 size={13} className="spin" />正在读取记录</p>}
    </div>
  );
}

const LEVEL_SEGMENTS = ['critical', 'error', 'warning', 'success', 'info'];

export function LevelFilterChips({ levels, level, onLevelChange }) {
  return (
    <div className="logs-level-list" role="group" aria-label="按日志级别筛选">
      {LEVEL_SEGMENTS.map(key => {
        const count = levels?.[key] || 0;
        const active = level === key;
        return (
          <button key={key} type="button" aria-pressed={active}
            className={`logs-level-row${active ? ' is-active' : ''}${count ? '' : ' is-zero'}`}
            style={{ '--chip-tone': LOG_LEVEL_TONES[key] }}
            title={`${LOG_LEVEL_LABELS[key]}：${count} 条 · 点击${active ? '取消' : '筛选'}`}
            onClick={() => onLevelChange?.(active ? '' : key)}>
            <i aria-hidden="true" /><span>{LOG_LEVEL_LABELS[key]}</span><b>{count.toLocaleString('zh-CN')}</b>
          </button>
        );
      })}
    </div>
  );
}

export function LogsInsightPanel({ insight, loading, error, level, onLevelChange, scopeLabel, collapsed, onToggle }) {
  const prediction = insight?.predictions;
  const total = insight?.total ?? 0;
  const sampleSize = insight?.sampleSize ?? insight?.total ?? 0;
  const passRate = prediction?.passRate;
  const passText = Number.isFinite(passRate) ? (passRate * 100).toFixed(passRate >= 0.995 ? 0 : 1) : '—';
  const warnings = (insight?.levels?.warning || 0);
  const errorCount = insight?.levels?.error || 0;
  const criticalCount = insight?.levels?.critical || 0;
  const sampleNote = sampleSize && sampleSize < total ? `概览样本 ${sampleSize.toLocaleString('zh-CN')} 条` : scopeLabel;

  if (collapsed) {
    return (
      <section className="logs-insight is-collapsed" aria-label="运行态势（已收起）">
        <strong>运行态势</strong>
        <span>{scopeLabel} · {total} 条</span>
        <span>合格率 <b>{passText}{Number.isFinite(passRate) ? '%' : ''}</b></span>
        <button type="button" aria-pressed={level === 'warning'} className={level === 'warning' ? 'is-active is-warning' : 'is-warning'}
          onClick={() => onLevelChange?.(level === 'warning' ? '' : 'warning')}>警告 <b>{warnings}</b></button>
        <button type="button" aria-pressed={level === 'error'} className={level === 'error' ? 'is-active is-danger' : 'is-danger'}
          onClick={() => onLevelChange?.(level === 'error' ? '' : 'error')}>错误 <b>{errorCount}</b></button>
        <button type="button" className="logs-insight-toggle" onClick={onToggle} aria-expanded="false">展开<ChevronDown size={13} /></button>
      </section>
    );
  }

  return (
    <section className="logs-insight" aria-label="运行态势">
      <div className="logs-kpis">
        <div className="logs-kpi">
          <span>记录总数</span>
          <strong>{total.toLocaleString('zh-CN')}</strong>
          <small>{sampleNote}</small>
        </div>
        <div className={`logs-kpi${Number.isFinite(passRate) && passRate < 0.98 ? ' is-warning' : ''}`}>
          <span>预测合格率</span>
          <strong>{passText}<em>{Number.isFinite(passRate) ? '%' : ''}</em></strong>
          <small>{prediction?.paired ? `${prediction.normal}/${prediction.paired} 次在允许偏差内` : '暂无成对预测记录'}</small>
        </div>
        <div className="logs-kpi">
          <span>平均 |偏差|</span>
          <strong>{fixed(prediction?.meanAbs)}<em> t</em></strong>
          <small>最大 {fixed(prediction?.maxAbs)} t</small>
        </div>
        <div className={`logs-kpi${prediction?.breaches ? ' is-danger' : ''}`}>
          <span>超限预测</span>
          <strong>{prediction?.breaches ?? 0}<em> 次</em></strong>
          <small>错误 {errorCount} 条 · 严重 {criticalCount} 条</small>
        </div>
      </div>

      <div className="logs-chart">
        <header>
          <strong>预测偏差走势</strong>
          <span>最近 {prediction?.points?.length || 0} 次预测 · 允许 {prediction?.range ? (prediction.range.lowerBound === -prediction.range.upperBound ? `±${prediction.range.upperBound}` : `${prediction.range.lowerBound} ～ ${prediction.range.upperBound}`) : '±50'} t</span>
          {error && <em className="logs-chart-error">{error}</em>}
          <button type="button" className="logs-insight-toggle" onClick={onToggle} aria-expanded="true">收起<ChevronUp size={13} /></button>
        </header>
        <DeviationChart prediction={prediction} loading={loading} />
      </div>
    </section>
  );
}
