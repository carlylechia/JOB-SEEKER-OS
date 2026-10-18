'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme, type Theme } from './theme-provider';
import { useRadioGroup } from './use-radio-group';

type Option = {
  value: Theme;
  label: string;
  Icon: typeof Sun;
  /** Two-tone chip previewing that theme's canvas + accent. */
  swatch: string;
};

const OPTIONS: Option[] = [
  {
    value: 'light',
    label: 'Light',
    Icon: Sun,
    // warm canvas on the left, gold accent on the right
    swatch: 'linear-gradient(105deg,#FAFAF7 0 52%,#D4AF37 52% 100%)',
  },
  {
    value: 'dark',
    label: 'Dark',
    Icon: Moon,
    // navy canvas on the left, blue accent on the right
    swatch: 'linear-gradient(105deg,#08111f 0 52%,#4F8CFF 52% 100%)',
  },
];

const SIZES = {
  /** Tiny navbar variant: icon-only, no chips, still a clear two-slot pill. */
  xs: {
    wrap: 'gap-0.5 p-0.5',
    slot: 'h-8 w-8 justify-center',
    icon: 'h-4 w-4',
    chip: 'hidden',
    // Container padding 0.125rem, gap 0.125rem -> each column is 50% - 0.1875rem.
    thumb: 'w-[calc(50%-0.1875rem)]',
    shift: 'translate-x-[calc(100%+0.125rem)]',
  },
  sm: {
    wrap: 'p-1 gap-1',
    slot: 'h-8 gap-1.5 px-2.5 text-xs',
    icon: 'h-3.5 w-3.5',
    chip: 'h-2.5 w-3.5',
    // Container padding 0.25rem, gap 0.25rem -> each column is 50% - 0.375rem.
    thumb: 'w-[calc(50%-0.375rem)]',
    // Shifting by its own width plus the 0.25rem gap lands on column two.
    shift: 'translate-x-[calc(100%+0.25rem)]',
  },
  md: {
    wrap: 'p-1.5 gap-1',
    slot: 'h-9 gap-2 px-3 text-sm',
    icon: 'h-4 w-4',
    chip: 'h-3 w-4',
    // Container padding 0.375rem, gap 0.25rem -> each column is 50% - 0.5rem.
    thumb: 'w-[calc(50%-0.5rem)]',
    shift: 'translate-x-[calc(100%+0.25rem)]',
  },
} as const;

export type ThemeSwitchSize = keyof typeof SIZES;

/**
 * Segmented light/dark switch.
 *
 * Both options are always on screen. The inactive one keeps a faint outline and
 * its own colour chip, so the control reads as a two-way choice instead of a
 * lone selected value, and a thumb slides between the two slots.
 * Implemented as a real radiogroup: arrow keys and screen readers both work.
 */
export function ThemeSwitch({ size = 'md', className = '' }: { size?: ThemeSwitchSize; className?: string }) {
  const { theme, setTheme, mounted } = useTheme();
  const s = SIZES[size];
  const active = mounted ? theme : 'light';
  const { register, onKeyDown } = useRadioGroup(OPTIONS.length);
  // Only the roomy variants have space for a written label.
  const showLabel = size === 'md';

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={`relative inline-grid shrink-0 grid-cols-2 items-center rounded-full border border-line bg-surface ${s.wrap} ${className}`}
    >
      {/* Thumb carries the active state and animates between the two slots. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-1 left-1 rounded-full bg-accent shadow-sm transition-transform duration-300 ease-out ${s.thumb} ${
          active === 'dark' ? s.shift : 'translate-x-0'
        }`}
      />

      {OPTIONS.map(({ value, label, Icon, swatch }, index) => {
        const selected = active === value;
        return (
          <button
            key={value}
            ref={register(index)}
            type="button"
            role="radio"
            aria-checked={selected}
            // Roving tabindex: only the active option is a tab stop.
            tabIndex={selected ? 0 : -1}
            title={`Switch to ${label.toLowerCase()} theme`}
            onClick={() => setTheme(value)}
            onKeyDown={(event) => onKeyDown(event, index, (i) => setTheme(OPTIONS[i].value))}
            className={`relative z-10 inline-flex items-center justify-center rounded-full border font-medium transition-colors ${s.slot} ${
              selected
                ? 'border-transparent text-accent-ink'
                : 'border-line bg-transparent text-muted hover:text-ink'
            }`}
          >
            <Icon className={`${s.icon} shrink-0`} aria-hidden />
            {showLabel ? <span className="leading-none">{label}</span> : null}
            {/* Faint outline + palette chip so the unselected theme still reads
                as a real, available option. */}
            <span
              aria-hidden
              className={`shrink-0 rounded-[3px] border transition-opacity ${
                selected ? 'border-accent-ink/40 opacity-80' : 'border-line-strong/70 opacity-90'
              } ${s.chip}`}
              style={{ backgroundImage: swatch }}
            />
            <span className="sr-only">{label} theme</span>
          </button>
        );
      })}
    </div>
  );
}