/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // WhatsApp Web's stack: Segoe UI on Windows, Helvetica Neue on Apple, then the usual system fallbacks
      fontFamily: {
        sans: ['"Segoe UI"', '"Helvetica Neue"', 'Helvetica', '"Lucida Grande"', 'Arial', 'Ubuntu', 'Cantarell', '"Fira Sans"', 'sans-serif', '"Apple Color Emoji"', '"Segoe UI Emoji"'],
      },
      colors: {
        wa: {
          // Light mode surfaces
          light: '#f8fafc',
          lightHeader: 'rgb(var(--wa-green-dark) / <alpha-value>)',
          lightPanel: '#ffffff',
          lightSecondary: '#f0f2f5',
          lightBorder: '#e9edef',
          lightText: '#111b21',
          lightTextSecondary: '#667781',
          // Dark mode surfaces and text: WhatsApp Web's, defined once as CSS variables in index.css
          dark: 'rgb(var(--bg-app) / <alpha-value>)',
          darkPanel: 'rgb(var(--bg-app) / <alpha-value>)',
          darkRail: 'rgb(var(--bg-rail) / <alpha-value>)',
          darkSecondary: 'rgb(var(--bg-input) / <alpha-value>)',
          darkInput: 'rgb(var(--bg-input) / <alpha-value>)',
          darkSearch: 'rgb(var(--bg-search) / <alpha-value>)',
          darkHover: 'rgb(var(--bg-hover) / <alpha-value>)',
          darkBorder: 'rgb(var(--border) / <alpha-value>)',
          darkBubbleIn: 'rgb(var(--bubble-in) / <alpha-value>)',
          darkPill: 'rgb(var(--system-pill) / <alpha-value>)',
          darkText: 'rgb(var(--text-primary) / <alpha-value>)',
          darkTextSecondary: 'rgb(var(--text-secondary) / <alpha-value>)',
          // read receipts (double ticks)
          tick: '#53bdeb',
          // Accent (green by default; Settings > Appearance can switch it, see --wa-green in index.css)
          green: 'rgb(var(--wa-green) / <alpha-value>)',
          greenDark: 'rgb(var(--wa-green-dark) / <alpha-value>)',
          greenLight: 'rgb(var(--wa-green-light) / <alpha-value>)',
          // Status colors
          live: '#f15c6d',
          busy: '#ffb74d',
          quiet: '#8696a0',
        },
      },
      animation: {
        'pulse-dot': 'pulseDot 1.5s ease-in-out infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        pulseDot: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.5', transform: 'scale(0.85)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
