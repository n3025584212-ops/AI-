import './no3d-viewer.css';

/**
 * Flat mascot used in place of the WebGL engineer avatar. Same footprint and
 * data attributes as the three.js scene so the dock, drag and caption
 * behaviour stay untouched while no 3D asset is requested.
 */
export default function AssistantAvatarScene2D({ model = 'engineer', engaged = false, hovered = false, dragging = false, taskPhase = 'IDLE' }) {
  const accent = taskPhase === 'FAILED' ? '#e8a08a'
    : taskPhase === 'NEEDS_CONFIRMATION' || taskPhase === 'NEEDS_INPUT' || taskPhase === 'PARTIAL' ? '#e6c684'
    : taskPhase === 'LISTENING' ? '#a8dcf2'
    : engaged ? '#7fe4ff' : '#63d6f2';
  return <span
    className="assistant-avatar-scene"
    aria-hidden="true"
    data-renderer="svg-2d"
    data-model={model}
    data-task-state={taskPhase}
    data-engaged={engaged ? 'true' : 'false'}
    data-hovered={hovered ? 'true' : 'false'}
    data-dragging={dragging ? 'true' : 'false'}
  >
    <svg className="no3d-avatar-svg" viewBox="0 0 88 104" role="presentation">
      <defs>
        <radialGradient id="no3d-avatar-shell" cx=".36" cy=".28" r=".85">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".55" stopColor="#e7f0f6" />
          <stop offset="1" stopColor="#a8bccb" />
        </radialGradient>
        <linearGradient id="no3d-avatar-visor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1d2d3d" />
          <stop offset="1" stopColor="#060d15" />
        </linearGradient>
        <radialGradient id="no3d-avatar-core" cx=".5" cy=".4" r=".65">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".45" stopColor={accent} />
          <stop offset="1" stopColor="#1275a0" />
        </radialGradient>
        <filter id="no3d-avatar-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="2.4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <ellipse cx="44" cy="97" rx="25" ry="4.4" fill={accent} opacity=".22" filter="url(#no3d-avatar-glow)" />
      <ellipse cx="44" cy="97" rx="13" ry="2.2" fill={accent} opacity=".4" />
      <g className="no3d-avatar-bob">
        <line x1="44" y1="11" x2="44" y2="4" stroke="#cfe4f0" strokeWidth="2" strokeLinecap="round" />
        <circle cx="44" cy="3" r="2.6" fill={accent} filter="url(#no3d-avatar-glow)" />
        <circle cx="17.5" cy="35" r="4.4" fill="#b9cedb" stroke="#8fa5b4" strokeWidth=".8" />
        <circle cx="70.5" cy="35" r="4.4" fill="#b9cedb" stroke="#8fa5b4" strokeWidth=".8" />
        <circle cx="44" cy="34" r="26.5" fill="url(#no3d-avatar-shell)" stroke="#8ba0ae" strokeWidth="1" />
        <ellipse cx="44" cy="35" rx="19.5" ry="15.5" fill="url(#no3d-avatar-visor)" stroke="#39505f" strokeWidth="1.2" />
        <ellipse cx="44" cy="30.5" rx="13" ry="5" fill="#ffffff" opacity=".07" />
        <ellipse cx="37.4" cy="35.4" rx="3.4" ry="4.6" fill={accent} filter="url(#no3d-avatar-glow)" />
        <ellipse cx="50.6" cy="35.4" rx="3.4" ry="4.6" fill={accent} filter="url(#no3d-avatar-glow)" />
        <path d="M35.5 44.5q8.5 3.6 17 0" fill="none" stroke="#3d5b6d" strokeWidth="1.3" strokeLinecap="round" opacity=".9" />
        <rect x="31.5" y="57" width="25" height="27" rx="9" fill="url(#no3d-avatar-shell)" stroke="#8ba0ae" strokeWidth="1" />
        <circle cx="44" cy="70.5" r="6.2" fill="url(#no3d-avatar-core)" filter="url(#no3d-avatar-glow)" />
        <circle cx="44" cy="70.5" r="2.2" fill="#ffffff" opacity=".85" />
        <rect x="24.4" y="60.5" width="6.4" height="16" rx="3.2" fill="#c9d9e4" stroke="#8ba0ae" strokeWidth=".8" transform="rotate(-16 27.6 68.5)" />
        <rect x="57.2" y="60.5" width="6.4" height="16" rx="3.2" fill="#c9d9e4" stroke="#8ba0ae" strokeWidth=".8" transform="rotate(16 60.4 68.5)" />
        <rect x="37.6" y="84" width="5.6" height="9" rx="2.8" fill="#bccfdb" stroke="#8ba0ae" strokeWidth=".8" />
        <rect x="44.8" y="84" width="5.6" height="9" rx="2.8" fill="#bccfdb" stroke="#8ba0ae" strokeWidth=".8" />
      </g>
    </svg>
  </span>;
}
