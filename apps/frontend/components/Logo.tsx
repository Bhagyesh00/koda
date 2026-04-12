'use client';

interface Props {
  size?: number;
  animated?: boolean;
  className?: string;
}

/**
 * Koda's K monogram. Inline SVG so it inherits CSS color, scales crisp,
 * and (when `animated`) gently shifts the gradient hue for an "alive" feel.
 */
export function Logo({ size = 32, animated = false, className }: Props) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Koda"
    >
      <defs>
        <linearGradient id="koda-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f0a47c">
            {animated && (
              <animate
                attributeName="stop-color"
                values="#f0a47c;#f5b48a;#f0a47c"
                dur="6s"
                repeatCount="indefinite"
              />
            )}
          </stop>
          <stop offset="55%" stopColor="#d97757">
            {animated && (
              <animate
                attributeName="stop-color"
                values="#d97757;#e88663;#d97757"
                dur="6s"
                repeatCount="indefinite"
              />
            )}
          </stop>
          <stop offset="100%" stopColor="#a8462a" />
        </linearGradient>
        <linearGradient id="koda-shine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.25)" />
          <stop offset="40%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        <filter id="koda-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="0.6" floodColor="#000" floodOpacity="0.25" />
        </filter>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#koda-bg)" />
      <rect width="64" height="64" rx="15" fill="url(#koda-shine)" />
      <rect
        x="0.75"
        y="0.75"
        width="62.5"
        height="62.5"
        rx="14.25"
        fill="none"
        stroke="rgba(255,255,255,0.15)"
        strokeWidth="1"
      />
      <g filter="url(#koda-shadow)">
        <path d="M22 14 L22 50" stroke="#fff" strokeWidth="5.5" strokeLinecap="round" />
        <path d="M22 32 L41 14" stroke="#fff" strokeWidth="5.5" strokeLinecap="round" />
        <path d="M22 32 L43 50" stroke="#fff" strokeWidth="5.5" strokeLinecap="round" />
        <circle cx="22" cy="32" r="2.6" fill="#fff" />
      </g>
    </svg>
  );
}
