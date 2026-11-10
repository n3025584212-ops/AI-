import { useEffect, useId } from 'react';
import { toDisplay, unitFor } from '../engineeringUnits.js';
import './no3d-viewer.css';

const STANDS = ['S1', 'S2', 'S3', 'S4', 'S5'];
const SIDE_X = [252, 404, 556, 708, 860];
const TOP_X = [252, 404, 556, 708, 860];
const VIEW_LABEL = { perspective: '机组斜视', front: '操作侧', drive: '传动侧', top: '俯视', hall: '车间全景' };

const forceText = (raw, digits = 1) => {
  const value = toDisplay('force', raw);
  return Number.isFinite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
};

function StandGroup({ x, id, active, muted, data, onSelect, top, glow, shell }) {
  const force = data?.force;
  const speed = data?.speed;
  const label = Number.isFinite(toDisplay('force', force)) ? `${forceText(force)} t` : '—';
  const common = {
    className: `no3d-stand${active ? ' is-active' : ''}${muted ? ' is-muted' : ''}`,
    role: 'button',
    tabIndex: 0,
    'aria-label': `选择 ${id} 机架`,
    'aria-pressed': active,
    onClick: () => onSelect?.(id),
    onKeyDown: event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect?.(id); }
    },
  };
  const stroke = active ? '#6fe0ff' : '#5d7a8e';
  const housingFill = active ? 'url(#no3d-housing-active)' : 'url(#no3d-housing)';
  if (top) {
    return <g {...common}>
      <rect className="no3d-hit" x={x - 30} y={188} width={60} height={224} rx={4} fill="transparent" stroke="none" />
      <text x={x} y={176} textAnchor="middle" className="no3d-stand-id" fill={active ? '#bff2ff' : '#9fc1d3'}>{id}</text>
      <rect x={x - 22} y={204} width={44} height={192} rx={4} fill={housingFill} fillOpacity={shell === 'solid' ? 1 : .82} stroke={stroke} strokeWidth={active ? 1.8 : 1} filter={active ? glow : undefined} />
      {[0, 1, 2, 3].map(i => <line key={i} x1={x - 15} x2={x + 15} y1={228 + i * 44} y2={228 + i * 44} stroke={active ? '#8fe6ff' : '#587287'} strokeWidth="1.4" opacity=".65" />)}
      <rect x={x - 9} y={214} width={18} height={172} fill="#0b1d2b" opacity=".5" />
      <text x={x} y={424} textAnchor="middle" className="no3d-stand-value" fill={active ? '#d4f6ff' : '#a8c6d7'}>{label}</text>
      {Number.isFinite(speed) && <text x={x} y={440} textAnchor="middle" className="no3d-stand-unit">{Math.round(speed)} m/min</text>}
    </g>;
  }
  return <g {...common}>
    <rect className="no3d-hit" x={x - 64} y={150} width={128} height={310} rx={6} fill="transparent" stroke="none" />
    <text x={x} y={132} textAnchor="middle" className="no3d-stand-id" fill={active ? '#bff2ff' : '#9fc1d3'}>{id}</text>
    <text x={x} y={148} textAnchor="middle" className="no3d-stand-value" fill={active ? '#d4f6ff' : '#a8c6d7'}>{label}</text>
    <rect x={x - 52} y={172} width={104} height={272} rx={7} fill={housingFill} fillOpacity={shell === 'solid' ? 1 : .82} stroke={stroke} strokeWidth={active ? 1.8 : 1} filter={active ? glow : undefined} />
    {[-34, 34].map(px => <rect key={px} x={x + px - 5} y={180} width={10} height={256} rx={2} fill="#0d2231" opacity=".85" />)}
    <rect x={x - 44} y={228} width={88} height={144} rx={4} fill="#071724" opacity=".5" />
    <rect x={x - 46} y={216} width={92} height={10} rx={2} fill="#0c2030" />
    <rect x={x - 46} y={378} width={92} height={10} rx={2} fill="#0c2030" />
    <line x1={x - 40} y1={236} x2={x + 40} y2={372} stroke="#2c485c" strokeWidth="1" opacity=".5" />
    <line x1={x + 40} y1={236} x2={x - 40} y2={372} stroke="#2c485c" strokeWidth="1" opacity=".5" />
    <rect x={x - 38} y={272} width={16} height={64} rx={2} fill="#10293b" stroke="#3f6076" strokeWidth=".8" />
    <rect x={x + 22} y={272} width={16} height={64} rx={2} fill="#10293b" stroke="#3f6076" strokeWidth=".8" />
    <circle cx={x} cy={289} r={13} fill="#16394f" stroke={active ? '#9beeff' : '#6f93a9'} strokeWidth="1.6" />
    <circle cx={x} cy={319} r={13} fill="#16394f" stroke={active ? '#9beeff' : '#6f93a9'} strokeWidth="1.6" />
    <line x1={x - 40} x2={x + 40} y1={289} y2={289} stroke={active ? '#7fd8ee' : '#5f8094'} strokeWidth="1.2" opacity=".7" />
    <line x1={x - 40} x2={x + 40} y1={319} y2={319} stroke={active ? '#7fd8ee' : '#5f8094'} strokeWidth="1.2" opacity=".7" />
    <rect x={x - 16} y={300} width={32} height={7} rx={2} fill="#84d7ec" opacity={active ? .95 : .55} />
    <rect x={x - 38} y={436} width={76} height={8} rx={2} fill="#0a1b28" />
    {Number.isFinite(speed) && <text x={x} y={466} textAnchor="middle" className="no3d-stand-unit">{Math.round(speed)} m/min</text>}
  </g>;
}

/**
 * Drop-in replacement for the WebGL five-stand viewer. Renders the same
 * process data as a flat SVG elevation so the dashboard keeps working while
 * every three.js module, GLB asset and WebGL context stays out of the build.
 */
export default function ThreeViewer2D({
  selectedStand = 'S5', onSelectStand, view = 'perspective', focusMode = 'line',
  shellMode = 'transparent', lighting = 'workshop', compact = false, expanded = false, processSpeed = 0,
  processData, showStrip = true, onSceneReady, onAnchorsChange,
}) {
  const uid = useId().replaceAll(':', '');
  const glowId = `no3d-glow-${uid}`;
  const housingId = `no3d-housing-${uid}`;
  const housingActiveId = `no3d-housing-active-${uid}`;
  const top = view === 'top';
  const stands = processData?.stands || [];
  const byId = id => stands.find(stand => stand.id === id);
  const selected = byId(selectedStand) || {};
  const running = Number(processSpeed) > 0;
  const speedText = Number.isFinite(Number(processSpeed)) ? `${Math.round(Number(processSpeed))} m/min` : '—';
  const xs = top ? TOP_X : SIDE_X;

  useEffect(() => { onSceneReady?.(); onAnchorsChange?.([]); });

  return <div
    className="three-host no3d-mill"
    data-renderer="svg-2d"
    data-camera={view}
    data-lighting={lighting}
    data-shell-opacity={shellMode === 'solid' ? '1' : '0.35'}
    data-visible-stands="S1,S2,S3,S4,S5"
    data-selected-stand={selectedStand}
    data-focus-mode={focusMode}
    data-expanded={expanded ? 'true' : 'false'}
    style={{ minHeight: compact ? 240 : 300, filter: lighting === 'inspection' ? 'brightness(1.16) saturate(1.05)' : undefined }}
  >
    <svg className="no3d-mill-svg" viewBox="0 0 1200 520" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`五机架冷轧机组二维示意图，当前选择 ${selectedStand} 机架`}>
      <defs>
        <linearGradient id={housingId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a465b" />
          <stop offset="1" stopColor="#122a3c" />
        </linearGradient>
        <linearGradient id={housingActiveId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#33617c" />
          <stop offset="1" stopColor="#153a4f" />
        </linearGradient>
        <linearGradient id={`no3d-strip-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#9fb6c6" />
          <stop offset=".5" stopColor="#dfeef7" />
          <stop offset="1" stopColor="#9fb6c6" />
        </linearGradient>
        <filter id={glowId} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <style>{`
        .no3d-stand-id{font:600 17px 'Bahnschrift','Segoe UI',sans-serif;letter-spacing:1.2px}
        .no3d-stand-value{font:500 13px 'Bahnschrift','Segoe UI',sans-serif;letter-spacing:.2px;font-variant-numeric:tabular-nums}
        .no3d-stand-unit{font:400 11px 'Segoe UI',sans-serif;fill:#7d9aac;letter-spacing:.3px}
        .no3d-axis{font:400 11px 'Segoe UI',sans-serif;fill:#6f8b9e}
      `}</style>

      {/* floor / mill line */}
      <line x1="40" y1={top ? 470 : 486} x2="1160" y2={top ? 470 : 486} stroke="#2c4b60" strokeWidth="2" />
      <line x1="40" y1={top ? 470 : 486} x2="1160" y2={top ? 470 : 486} stroke="#79d3ea" strokeWidth="1" opacity=".25" strokeDasharray="3 9" />

      {/* entry / exit coils */}
      <g opacity=".92">
        <circle cx="92" cy={top ? 300 : 306} r="62" fill="#0d2334" stroke="#4d6c80" strokeWidth="1.6" />
        <circle cx="92" cy={top ? 300 : 306} r="40" fill="none" stroke="#5e8298" strokeWidth="1.2" opacity=".8" />
        <circle cx="92" cy={top ? 300 : 306} r="14" fill="#183549" stroke="#6d93aa" strokeWidth="1.2" />
        <text x="92" y={top ? 386 : 392} textAnchor="middle" className="no3d-axis">入口钢卷</text>
        <circle cx="1108" cy={top ? 300 : 306} r="62" fill="#0d2334" stroke="#4d6c80" strokeWidth="1.6" />
        <circle cx="1108" cy={top ? 300 : 306} r="40" fill="none" stroke="#5e8298" strokeWidth="1.2" opacity=".8" />
        <circle cx="1108" cy={top ? 300 : 306} r="14" fill="#183549" stroke="#6d93aa" strokeWidth="1.2" />
        <text x="1108" y={top ? 386 : 392} textAnchor="middle" className="no3d-axis">出口钢卷</text>
      </g>

      {/* strip */}
      {showStrip && (top
        ? <g>
          <rect x="150" y="244" width="900" height="112" rx="3" fill={`url(#no3d-strip-${uid})`} opacity=".16" />
          <rect x="150" y="244" width="900" height="112" rx="3" fill="none" stroke="#9fc4d6" strokeWidth="1.2" opacity=".55" />
          <line x1="150" y1="270" x2="1050" y2="270" stroke="#bfe6f6" strokeWidth="1.4" opacity=".5" />
          <line x1="150" y1="330" x2="1050" y2="330" stroke="#bfe6f6" strokeWidth="1.4" opacity=".5" />
          <text x="600" y="486" textAnchor="middle" className="no3d-axis">带钢运行方向  S1 → S5 →</text>
        </g>
        : <g>
          <rect x="40" y="296" width="1120" height="20" rx="2" fill={`url(#no3d-strip-${uid})`} opacity=".82" />
          <rect x="40" y="296" width="1120" height="20" rx="2" fill="none" stroke="#e4f4ff" strokeWidth=".8" opacity=".35" />
          {running && <line className="no3d-flow" x1="70" y1="306" x2="1130" y2="306" stroke="#bff3ff" strokeWidth="2" opacity=".8" />}
        </g>)}

      {STANDS.map((id, index) => <StandGroup
        key={id}
        id={id}
        x={xs[index]}
        active={selectedStand === id}
        muted={focusMode === 's5' && selectedStand !== id}
        data={byId(id)}
        onSelect={onSelectStand}
        top={top}
        shell={shellMode}
        glow={`url(#${glowId})`}
      />)}

      <g transform="translate(600,40)" textAnchor="middle">
        <text className="no3d-axis" x="0" y="0" style={{ fontSize: 12, letterSpacing: 1 }}>
          {VIEW_LABEL[view] || '机组斜视'} · {shellMode === 'solid' ? '实体轮廓' : '透壳轮廓'} · {lighting === 'inspection' ? '检视灯光' : '车间灯光'}
        </text>
        <text className="no3d-axis" x="0" y="20" style={{ fill: running ? '#8ef0d0' : '#93a9b8' }}>
          {running ? `运行中 · ${speedText}` : '机组静止'} · S5 轧制力 {forceText(selected.force)} {unitFor('force')}
        </text>
      </g>
    </svg>
    <div className="no3d-badge"><i className={running ? '' : 'is-idle'} />二维示意 · 未加载三维资源</div>
  </div>;
}
