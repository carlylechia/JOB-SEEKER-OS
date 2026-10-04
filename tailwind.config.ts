import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── teChia Jobs brand palette ─────────────────────────────
        obsidian: '#111318',
        graphite: '#242831',
        charcoal: '#17191E',
        silver: '#C9CED6',
        silverlight: '#E8EBF0',
        gold: '#D4AF37',
        champagne: '#F1D78A',
        warmwhite: '#FAFAF7',
        slate: '#686F7B',
        // ── Semantic app tokens (mapped onto the brand palette) ───
        background: '#FAFAF7',
        card: '#FFFFFF',
        line: '#D9DDE3',
        ink: '#17191E',
        muted: '#686F7B',
        accent: '#D4AF37',
        success: '#1F9D68',
        warn: '#D98E04',
        danger: '#D64545',
        info: '#5B6472',
      },
      boxShadow: {
        soft: '0 12px 30px rgba(17, 19, 24, 0.08)',
      },
      borderRadius: {
        xl: '0.9rem',
      },
    },
  },
  plugins: [
    plugin(function({ addUtilities }) {
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
