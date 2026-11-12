import type { Config } from 'tailwindcss';

/** The only colours allowed (doc 08). Default Tailwind colours are removed on purpose. */
export const palette = {
  white: '#FFFFFF',
  mist: '#F3F5F8',
  hairline: '#DCE2EA',
  deep: '#0F2A47',
  tide: '#1F5F99',
  brown: '#8A5A2B',
  slate: '#5B6878',
  success: '#1E7B4F',
  caution: '#A66A12',
  danger: '#B3261E',
};

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    colors: { transparent: 'transparent', current: 'currentColor', inherit: 'inherit', ...palette },
    fontFamily: { sans: ['"IBM Plex Sans"', '"Segoe UI"', 'system-ui', 'sans-serif'] },
    fontSize: {
      meta: ['12px', { lineHeight: '16px' }],
      th: ['12.5px', { lineHeight: '16px' }],
      sm: ['13px', { lineHeight: '18px' }],
      base: ['14px', { lineHeight: '20px' }],
      section: ['16px', { lineHeight: '22px' }],
      title: ['20px', { lineHeight: '28px' }],
      kpi: ['28px', { lineHeight: '34px' }],
      login: ['40px', { lineHeight: '1.15' }],
    },
    borderRadius: { none: '0', ctl: '6px', panel: '8px', dialog: '12px', full: '9999px' },
    boxShadow: { none: 'none', float: '0 8px 24px rgba(0, 0, 0, 0.10)' },
    extend: {
      transitionTimingFunction: { std: 'cubic-bezier(0.2, 0, 0, 1)' },
      transitionDuration: { 120: '120ms', 180: '180ms', 240: '240ms' },
      width: { sidebar: '232px' },
    },
  },
  plugins: [],
} satisfies Config;
