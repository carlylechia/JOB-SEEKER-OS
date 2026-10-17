'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type Theme } from './theme-provider';

const OPTIONS: { value: Theme; label: string; Icon: typeof Sun; hint: string }[] = [
  { value: 'light', label: 'Light', Icon: Sun, hint: 'Warm white with gold accents' },
  { value: 'dark', label: 'Dark', Icon: Moon, hint: 'Deep navy with blue accents' },
];

/**
 * Settings-page appearance control. Uses a radiogroup so keyboard and screen
 * reader users get the current selection announced, while each swatch previews
 * the palette it will switch to.
 */
export function ThemePicker() {
  const { theme, setTheme, mounted } = useTheme();

  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Colour theme"
        className="grid gap-3 sm:grid-cols-2"
      >
        {OPTIONS.map(({ value, label, Icon, hint }) => {
          const selected = mounted && theme === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTheme(value)}
              className={`group flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors ${
                selected
                  ? 'border-accent bg-accent/[0.08]'
                  : 'border-line bg-surface hover:bg-surface-hover'
              }`}
            >
              {/* Miniature of the target theme */}
              <span
                aria-hidden
                className={`mt-0.5 flex h-11 w-11 shrink-0 flex-col gap-1 overflow-hidden rounded-xl border p-1.5 ${
                  value === 'light' ? 'border-[#D9DDE3] bg-[#FAFAF7]' : 'border-[#22314d] bg-[#08111f]'
                }`}
              >
                <span
                  className={`h-1.5 w-full rounded-full ${
                    value === 'light' ? 'bg-[#D4AF37]' : 'bg-[#4f8cff]'
                  }`}
                />
                <span
                  className={`flex-1 w-full rounded ${
                    value === 'light' ? 'bg-white' : 'bg-[#0f1a2e]'
                  }`}
                />
              </span>

              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <Icon className="h-4 w-4 text-muted" aria-hidden />
                  {label}
                </span>
                <span className="mt-0.5 block text-xs text-muted">{hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-4 flex items-center gap-2 text-sm text-muted">
        <Monitor className="h-4 w-4 shrink-0" aria-hidden />
        Saved on this device. Until you pick one, teChia Jobs follows your system setting.
      </p>
    </div>
  );
}