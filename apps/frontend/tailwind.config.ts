import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0b0c0f',
          panel: '#111317',
          subtle: '#161a20',
          hover: '#1c2127',
        },
        border: {
          DEFAULT: '#23272f',
        },
        fg: {
          DEFAULT: '#e6e8eb',
          muted: '#9aa3af',
          subtle: '#6b7280',
        },
        accent: {
          DEFAULT: '#d97757',
          hover: '#c66344',
          2: '#e8a87c',
          glow: 'rgba(217,119,87,0.35)',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 32px -8px var(--tw-shadow-color)',
        'inset-border': 'inset 0 0 0 1px rgba(255,255,255,0.04)',
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        fadeInUp: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'none' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        gradientShift: {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '200% 50%' },
        },
        pulseDot: {
          '0%, 100%': { transform: 'scale(0.85)', opacity: '0.7' },
          '50%': { transform: 'scale(1.15)', opacity: '1' },
        },
        slideInRight: {
          from: { opacity: '0', transform: 'translateX(20px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        blink: 'blink 1s steps(1) infinite',
        fadeInUp: 'fadeInUp 180ms ease-out',
        shimmer: 'shimmer 1.6s linear infinite',
        gradientShift: 'gradientShift 1.6s linear infinite',
        pulseDot: 'pulseDot 1.6s ease-in-out infinite',
        slideInRight: 'slideInRight 220ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
