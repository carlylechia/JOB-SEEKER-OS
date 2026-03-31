import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#08111f',
        card: '#0f1a2e',
        line: '#22314d',
        ink: '#e7edf7',
        muted: '#98a7c4',
        accent: '#4f8cff',
        success: '#22c55e',
        warn: '#f59e0b',
        danger: '#ef4444'
      },
      boxShadow: {
        soft: '0 12px 30px rgba(2, 10, 27, 0.25)'
      }
    },
  },
  plugins: [],
} satisfies Config;
