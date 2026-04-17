'use client';

import type { PointerEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import {
  LazyMotion,
  domAnimation,
  m,
  useAnimationFrame,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion';

type SpinnerHeroProps = {
  className?: string;
};

const TILT_MAX_DEG = 8;

function SpinnerHero({ className }: SpinnerHeroProps) {
  const shouldReduceMotion = useReducedMotion();
  const [tiltEnabled, setTiltEnabled] = useState(false);
  const [hovered, setHovered] = useState(false);

  // -0.5..0.5 pointer position inside the spinner bounds
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);

  // Spin speed (deg/sec) accelerates smoothly on hover.
  const spin = useMotionValue(0);
  const spinSpeedTarget = useMotionValue(shouldReduceMotion ? 0 : 72);
  const spinSpeed = useSpring(spinSpeedTarget, {
    stiffness: 260,
    damping: 34,
    mass: 0.55,
  });

  useEffect(() => {
    if (shouldReduceMotion) {
      spin.set(0);
      spinSpeedTarget.set(0);
      return;
    }

    spinSpeedTarget.set(hovered ? 210 : 72);
  }, [hovered, shouldReduceMotion, spin, spinSpeedTarget]);

  useAnimationFrame((_, delta) => {
    if (shouldReduceMotion) return;

    const next = (spin.get() + spinSpeed.get() * (delta / 1000)) % 360;
    spin.set(next);
  });

  const rotateY = useSpring(useTransform(pointerX, [-0.5, 0.5], [-TILT_MAX_DEG, TILT_MAX_DEG]), {
    stiffness: 220,
    damping: 28,
    mass: 0.5,
  });
  const rotateX = useSpring(useTransform(pointerY, [-0.5, 0.5], [TILT_MAX_DEG, -TILT_MAX_DEG]), {
    stiffness: 220,
    damping: 28,
    mass: 0.5,
  });

  const sheenX = useSpring(useTransform(pointerX, [-0.5, 0.5], [-18, 18]), {
    stiffness: 180,
    damping: 26,
    mass: 0.5,
  });
  const sheenY = useSpring(useTransform(pointerY, [-0.5, 0.5], [-14, 14]), {
    stiffness: 180,
    damping: 26,
    mass: 0.5,
  });

  useEffect(() => {
    if (shouldReduceMotion) {
      setTiltEnabled(false);
      setHovered(false);
      return;
    }

    const mql = window.matchMedia('(hover: hover) and (pointer: fine)');

    function update() {
      setTiltEnabled(mql.matches);
      if (!mql.matches) setHovered(false);
    }

    update();
    mql.addEventListener('change', update);

    return () => {
      mql.removeEventListener('change', update);
    };
  }, [shouldReduceMotion]);

  const onPointerEnter = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (shouldReduceMotion) return;
      if (e.pointerType && e.pointerType !== 'mouse') return;
      setHovered(true);
    },
    [shouldReduceMotion],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!tiltEnabled || shouldReduceMotion) return;
      if (e.pointerType && e.pointerType !== 'mouse') return;

      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;

      pointerX.set(Math.max(-0.5, Math.min(0.5, x)));
      pointerY.set(Math.max(-0.5, Math.min(0.5, y)));
    },
    [pointerX, pointerY, shouldReduceMotion, tiltEnabled],
  );

  const onPointerLeave = useCallback(() => {
    setHovered(false);
    pointerX.set(0);
    pointerY.set(0);
  }, [pointerX, pointerY]);

  return (
    <LazyMotion features={domAnimation}>
      <div className={`flex items-center justify-center min-h-[260px] ${className ?? ''}`.trim()}>
        <m.div
          initial={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.98 }}
          animate={shouldReduceMotion ? undefined : { opacity: 1, scale: 1 }}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
          style={{ willChange: 'transform, opacity' }}
        >
          <m.div
            className="relative h-[260px] w-[260px]"
            onPointerEnter={onPointerEnter}
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeave}
            style={{
              rotateX: tiltEnabled && !shouldReduceMotion ? rotateX : 0,
              rotateY: tiltEnabled && !shouldReduceMotion ? rotateY : 0,
              transformPerspective: 900,
              willChange: 'transform',
            }}
          >
            {/* background glow (static gradients + transform-only animation) */}
            <m.div
              aria-hidden
              className="pointer-events-none absolute -inset-10 rounded-full"
              style={{
                background:
                  'radial-gradient(circle at 50% 45%, rgba(34,211,238,0.14), transparent 58%), radial-gradient(circle at 60% 55%, rgba(99,102,241,0.16), transparent 62%)',
                filter: 'blur(22px)',
                transform: 'translateZ(0)',
                willChange: 'transform, opacity',
              }}
              initial={false}
              animate={
                shouldReduceMotion
                  ? { opacity: 0.85, scale: 1 }
                  : hovered
                    ? { opacity: 1, scale: 1.06 }
                    : {
                        opacity: [0.72, 0.95, 0.78],
                        scale: [1, 1.03, 1],
                      }
              }
              transition={
                shouldReduceMotion
                  ? undefined
                  : hovered
                    ? { duration: 0.22, ease: [0.22, 1, 0.36, 1] }
                    : {
                        duration: 7.5,
                        repeat: Infinity,
                        ease: [0.42, 0, 0.58, 1],
                      }
              }
            />

            {/* interactive specular sheen (transform-only, follows pointer) */}
            <m.div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{
                x: sheenX,
                y: sheenY,
                background:
                  'radial-gradient(circle at 40% 35%, rgba(255,255,255,0.10), transparent 55%), radial-gradient(circle at 60% 65%, rgba(255,255,255,0.05), transparent 60%)',
                mixBlendMode: 'screen',
                opacity: hovered ? 0.72 : 0.55,
                filter: 'blur(1px)',
                transform: 'translateZ(0)',
                willChange: 'transform',
              }}
            />

            {/* smooth rotation driven by a motion value so we can change speed instantly on hover */}
            <m.div
              className="absolute inset-0 flex items-center justify-center"
              style={{ rotate: shouldReduceMotion ? 0 : spin, transform: 'translateZ(0)', willChange: 'transform' }}
            >
              <SpinnerSvg />
            </m.div>
          </m.div>
        </m.div>
      </div>
    </LazyMotion>
  );
}

export default SpinnerHero;
export { SpinnerHero };

function SpinnerSvg() {
  const C = 100;
  const angles = [0, 120, 240] as const;

  const hubPlateR = 26;
  const hubCapR = 20;

  // Keep the full geometry inside the 200×200 viewBox to avoid edge slicing while rotating.
  const armDistance = 68;
  const outerY = C - armDistance;

  const lobeR = 30;
  const bearingR = 16;

  const bridgeW = 26;
  const bridgeX = C - bridgeW / 2;
  const bridgeY = outerY + lobeR - 10;
  const bridgeH = C - hubPlateR - bridgeY;

  return (
    <svg
      viewBox="0 0 200 200"
      preserveAspectRatio="xMidYMid meet"
      className="w-[260px] h-[260px]"
      overflow="visible"
      role="img"
      aria-label="Animated fidget spinner"
      focusable="false"
    >
      <defs>
        <radialGradient id="sp-body" cx="30%" cy="18%" r="85%">
          <stop offset="0%" stopColor="#f0f4ff" stopOpacity="0.16" />
          <stop offset="38%" stopColor="#2a3a55" stopOpacity="0.92" />
          <stop offset="100%" stopColor="#0a1120" stopOpacity="1" />
        </radialGradient>

        <linearGradient id="sp-edge" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.04)" />
          <stop offset="40%" stopColor="rgba(255,255,255,0.20)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.06)" />
        </linearGradient>

        <radialGradient id="sp-bearing" cx="42%" cy="36%" r="75%">
          <stop offset="0%" stopColor="#0c1628" />
          <stop offset="62%" stopColor="#050b16" />
          <stop offset="100%" stopColor="#02050f" />
        </radialGradient>

        <radialGradient id="sp-hub" cx="45%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#0e1a30" />
          <stop offset="58%" stopColor="#050c18" />
          <stop offset="100%" stopColor="#020611" />
        </radialGradient>

        <filter id="sp-shadow" filterUnits="userSpaceOnUse" x="-40" y="-40" width="280" height="280">
          <feDropShadow dx="0" dy="10" stdDeviation="9" floodColor="rgba(0,0,0,0.65)" />
        </filter>

        <filter id="sp-trail" filterUnits="userSpaceOnUse" x="-40" y="-40" width="280" height="280">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feColorMatrix
            in="b"
            type="matrix"
            values="1 0 0 0 0
                    0 1 0 0 0
                    0 0 1 0 0
                    0 0 0 0.28 0"
          />
        </filter>
      </defs>

      <g>
        {/* motion trail / ghost layer */}
        <use href="#sp-shape" opacity="0.26" filter="url(#sp-trail)" transform={`rotate(-10 ${C} ${C})`} />

        {/* main spinner */}
        <use href="#sp-shape" filter="url(#sp-shadow)" />
      </g>

      <g id="sp-shape">
        {/* arms: perfectly symmetric, 120° apart */}
        {angles.map((angle) => (
          <g key={angle} transform={`rotate(${angle} ${C} ${C})`}>
            {/* lobe */}
            <circle cx={C} cy={outerY} r={lobeR} fill="url(#sp-body)" />
            <circle cx={C} cy={outerY} r={lobeR} fill="none" stroke="url(#sp-edge)" strokeWidth="0.9" opacity="0.85" />

            {/* bridge to center */}
            <rect x={bridgeX} y={bridgeY} width={bridgeW} height={bridgeH} rx={bridgeW / 2} fill="url(#sp-body)" />
            <rect
              x={bridgeX}
              y={bridgeY}
              width={bridgeW}
              height={bridgeH}
              rx={bridgeW / 2}
              fill="none"
              stroke="rgba(255,255,255,0.10)"
              strokeWidth="0.9"
              opacity="0.7"
            />

            {/* outer bearing stack */}
            <circle cx={C} cy={outerY} r={bearingR} fill="url(#sp-bearing)" opacity="0.96" />
            <circle cx={C} cy={outerY} r={bearingR - 4} fill="rgba(255,255,255,0.06)" />
            <circle cx={C} cy={outerY} r={bearingR - 8} fill="rgba(0,0,0,0.74)" />
            <circle cx={C} cy={outerY} r={bearingR - 12} fill="rgba(255,255,255,0.08)" />
            <circle cx={C} cy={outerY} r={bearingR} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
          </g>
        ))}

        {/* center hub */}
        <circle cx={C} cy={C} r={hubPlateR} fill="url(#sp-body)" opacity="0.98" />
        <circle cx={C} cy={C} r={hubPlateR} fill="none" stroke="url(#sp-edge)" strokeWidth="1" opacity="0.75" />

        <circle cx={C} cy={C} r={hubCapR} fill="url(#sp-hub)" opacity="0.98" />
        <circle cx={C} cy={C} r={hubCapR} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1" opacity="0.7" />

        {/* center bearing */}
        <circle cx={C} cy={C} r={14} fill="url(#sp-bearing)" opacity="0.98" />
        <circle cx={C} cy={C} r={10} fill="rgba(255,255,255,0.06)" />
        <circle cx={C} cy={C} r={6} fill="rgba(0,0,0,0.76)" />
      </g>
    </svg>
  );
}
