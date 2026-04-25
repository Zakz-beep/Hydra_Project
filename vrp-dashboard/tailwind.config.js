/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['var(--font-mono)', 'JetBrains Mono', 'Fira Code', 'monospace'],
        display: ['var(--font-display)', 'Syne', 'sans-serif'],
        body: ['var(--font-body)', 'DM Sans', 'sans-serif'],
      },
      colors: {
        bg:      '#080C10',
        surface: '#0D1218',
        border:  '#1A2230',
        muted:   '#2A3545',
        dim:     '#4A5E75',
        text:    '#C8D8E8',
        bright:  '#E8F4FF',
        accent:  '#00D4FF',
        green:   '#00FF9C',
        orange:  '#FF8C00',
        red:     '#FF3B5C',
        yellow:  '#FFD700',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in':    'fadeIn 0.5s ease forwards',
        'slide-up':   'slideUp 0.4s ease forwards',
        'flicker':    'flicker 4s ease-in-out infinite',
        'scan':       'scan 8s linear infinite',
      },
      keyframes: {
        fadeIn:  { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: { from: { opacity: 0, transform: 'translateY(12px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        flicker: {
          '0%, 100%': { opacity: 1 },
          '50%':      { opacity: 0.85 },
          '75%':      { opacity: 0.95 },
        },
        scan: {
          '0%':   { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
      },
    },
  },
  plugins: [],
}
