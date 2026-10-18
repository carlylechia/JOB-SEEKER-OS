import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // ── teChia Jobs brand palette (fixed, theme-independent) ─────────
        obsidian: '#111318',
        graphite: '#242831',
        charcoal: '#17191E',
        silver: '#C9CED6',
        silverlight: '#E8EBF0',
        gold: '#D4AF37',
        champagne: '#F1D78A',
        warmwhite: '#FAFAF7',
        slate: '#686F7B',

        // ── Themed semantic tokens ──────────────────────────────────────
        // Every value is a CSS custom property declared in globals.css and
        // re-declared under [data-theme="dark"], so a single markup tree
        // renders correctly in both themes.
        background: 'rgb(var(--bg) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        sidebar: 'rgb(var(--sidebar) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        'line-strong': 'rgb(var(--line-strong) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        'ink-2': 'rgb(var(--ink-2) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',

        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-hover': 'rgb(var(--accent-hover) / <alpha-value>)',
        'accent-ink': 'rgb(var(--accent-ink) / <alpha-value>)',
        'accent-text': 'rgb(var(--accent-text) / <alpha-value>)',

        success: 'rgb(var(--success) / <alpha-value>)',
        'success-text': 'rgb(var(--success-text) / <alpha-value>)',
        'success-solid': 'rgb(var(--success-solid) / <alpha-value>)',
        'success-ink': 'rgb(var(--success-ink) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        'warn-text': 'rgb(var(--warn-text) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        'danger-text': 'rgb(var(--danger-text) / <alpha-value>)',
        'danger-solid': 'rgb(var(--danger-solid) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
        'info-text': 'rgb(var(--info-text) / <alpha-value>)',

        // Status hues used by badges/priority chips. Light gets deepened
        // values for WCAG contrast on white; dark gets the original
        // pre-redesign tints.
        'sky-text': 'rgb(var(--sky-text) / <alpha-value>)',
        'indigo-text': 'rgb(var(--indigo-text) / <alpha-value>)',
        'violet-text': 'rgb(var(--violet-text) / <alpha-value>)',
        'magenta-text': 'rgb(var(--magenta-text) / <alpha-value>)',
        'orange-text': 'rgb(var(--orange-text) / <alpha-value>)',

        // Translucent surfaces. Alpha is baked into the variable because the
        // same utility is used at different opacities per theme.
        surface: 'rgb(var(--surface))',
        'surface-hover': 'rgb(var(--surface-hover))',
        'surface-sunken': 'rgb(var(--surface-sunken))',
        'surface-sunken-hover': 'rgb(var(--surface-sunken-hover))',
        field: 'rgb(var(--field))',
        'field-select': 'rgb(var(--field-select))',
      },
      boxShadow: {
        soft: 'var(--shadow-soft)',
        lift: 'var(--shadow-lift)',
        nav: 'var(--shadow-nav)',
      },
      borderRadius: {
        xl: '0.9rem',
      },
    },
  },
  plugins: [
    plugin(function ({ addUtilities }) {
      addUtilities({
        '.scrollbar-none': {
          '-ms-overflow-style': 'none',
          'scrollbar-width': 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        },
      });
    }),
  ],
} satisfies Config;