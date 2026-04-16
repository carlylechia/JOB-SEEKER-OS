'use client';

import type { PointerEvent } from 'react';
import { useCallback, useMemo, useState } from 'react';

type SpinnerStyle = 'glide' | 'wobble' | 'snap' | 'reverse';

type FidgetSpinnerProps = {
  size?: number;
  style?: SpinnerStyle;
  className?: string;
};

function clampStyle(value: SpinnerStyle | undefined): SpinnerStyle {
  return value ?? 'glide';
}

export function FidgetSpinner({ size = 520, style, className }: FidgetSpinnerProps) {
  const spinStyle = clampStyle(style);

  const styleClass = useMemo(() => {
    switch (spinStyle) {
      case 'wobble':
        return 'spinner-spin-wobble';
      case 'snap':
        return 'spinner-spin-snap';
      case 'reverse':
        return 'spinner-spin-reverse';
      case 'glide':
      default:
        return 'spinner-spin-glide';
    }
  }, [spinStyle]);

  const [hovered, setHovered] = useState(false);

  const onPointerEnter = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    setHovered(true);
  }, []);

  const onPointerLeave = useCallback(() => {
    setHovered(false);
  }, []);

  return (
    <div
      className={`relative cursor-pointer transition-transform duration-200 ease-out hover:scale-[1.01] ${className ?? ''}`.trim()}
      style={{ width: size, height: size, willChange: 'transform' }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      aria-hidden
    >
      <svg
        viewBox="-120 -120 1440 1440"
        className={`h-full w-full ${styleClass}`}
        style={{
          overflow: 'visible',
          filter: hovered
            ? 'drop-shadow(0 0 18px rgba(34,211,238,0.22)) drop-shadow(0 0 28px rgba(99,102,241,0.14))'
            : undefined,
        }}
        role="img"
        aria-label="Animated fidget spinner"
      >
        <defs>
          <linearGradient id="sp-metal" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#d7deea" stopOpacity="0.78" />
            <stop offset="26%" stopColor="#6e7f9a" stopOpacity="0.78" />
            <stop offset="62%" stopColor="#1b273a" stopOpacity="0.92" />
            <stop offset="100%" stopColor="#c9d3e6" stopOpacity="0.7" />
          </linearGradient>

          <linearGradient id="sp-glow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(34,211,238,0.85)" />
            <stop offset="52%" stopColor="rgba(56,189,248,0.55)" />
            <stop offset="100%" stopColor="rgba(167,139,250,0.45)" />
          </linearGradient>

          <radialGradient id="sp-bear" cx="48%" cy="40%" r="70%">
            <stop offset="0%" stopColor="#0b1324" />
            <stop offset="60%" stopColor="#060b15" />
            <stop offset="100%" stopColor="#020510" />
          </radialGradient>

          <filter id="sp-soft-shadow" filterUnits="userSpaceOnUse" x="-300" y="-300" width="1800" height="1800">
            <feGaussianBlur stdDeviation="18" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="0 0 0 0 0
                      0 0 0 0 0
                      0 0 0 0 0
                      0 0 0 0.55 0"
            />
            <feOffset dx="0" dy="28" result="off" />
            <feMerge>
              <feMergeNode in="off" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="sp-bloom" filterUnits="userSpaceOnUse" x="-300" y="-300" width="1800" height="1800">
            <feGaussianBlur stdDeviation="12" result="b" />
            <feColorMatrix
              in="b"
              type="matrix"
              values="1 0 0 0 0
                      0 1 0 0 0
                      0 0 1 0 0
                      0 0 0 0.45 0"
            />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <mask id="sp-hole">
            <rect x="-120" y="-120" width="1440" height="1440" fill="white" />
            <circle cx="600" cy="600" r="146" fill="black" />
          </mask>
        </defs>

        {/* spinner body */}
        <g filter="url(#sp-soft-shadow)">
          <g mask="url(#sp-hole)">
            {/* arms */}
            <path
              d="M600 340c92 0 166 74 166 166 0 45-18 86-47 116l150 258c20 34 9 78-25 98-34 20-78 9-98-25l-150-258c-18 4-37 6-56 6s-38-2-56-6L334 933c-20 34-64 45-98 25-34-20-45-64-25-98l150-258c-29-30-47-71-47-116 0-92 74-166 166-166 50 0 95 22 126 57 31-35 76-57 126-57Z"
              fill="url(#sp-metal)"
              opacity="0.94"
            />

            {/* inner face glow */}
            <path
              d="M600 384c68 0 122 55 122 122 0 35-14 67-38 90l118 204c12 20 5 46-15 58-20 12-46 5-58-15l-118-204c-4 1-7 1-11 1s-8 0-11-1L471 843c-12 20-38 27-58 15-20-12-27-38-15-58l118-204c-24-23-38-55-38-90 0-68 55-122 122-122 43 0 80 22 100 56 20-34 57-56 100-56Z"
              fill="url(#sp-glow)"
              opacity={hovered ? 0.42 : 0.28}
              filter="url(#sp-bloom)"
            />

            {/* edge highlight */}
            <path
              d="M600 340c92 0 166 74 166 166 0 45-18 86-47 116l150 258c20 34 9 78-25 98-34 20-78 9-98-25l-150-258c-18 4-37 6-56 6s-38-2-56-6L334 933c-20 34-64 45-98 25-34-20-45-64-25-98l150-258c-29-30-47-71-47-116 0-92 74-166 166-166 50 0 95 22 126 57 31-35 76-57 126-57Z"
              fill="none"
              stroke="rgba(255,255,255,0.22)"
              strokeWidth="2"
              opacity={hovered ? 0.75 : 0.55}
            />
          </g>

          {/* bearings */}
          {[0, 120, 240].map((deg) => (
            <g key={deg} transform={`rotate(${deg} 600 600)`}>
              <circle cx="600" cy="318" r="86" fill="url(#sp-bear)" opacity="0.92" />
              <circle cx="600" cy="318" r="66" fill="rgba(255,255,255,0.06)" />
              <circle cx="600" cy="318" r="44" fill="rgba(0,0,0,0.72)" />
              <circle cx="600" cy="318" r="18" fill="rgba(255,255,255,0.08)" />
              <circle cx="600" cy="318" r="86" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="2" />
            </g>
          ))}

          {/* center bearing */}
          <circle cx="600" cy="600" r="168" fill="url(#sp-bear)" opacity="0.96" />
          <circle cx="600" cy="600" r="134" fill="rgba(255,255,255,0.06)" />
          <circle cx="600" cy="600" r="98" fill="rgba(0,0,0,0.74)" />
          <circle cx="600" cy="600" r="58" fill="rgba(255,255,255,0.06)" />
          <circle cx="600" cy="600" r="168" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />

          {/* specular sweep */}
          <path
            d="M120 520c240-260 560-320 960-180"
            stroke={hovered ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.14)'}
            strokeWidth="12"
            strokeLinecap="round"
            fill="none"
            className="spinner-sheen"
          />
        </g>
      </svg>
    </div>
  );
}
