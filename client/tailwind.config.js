/** @type {import('tailwindcss').Config} */
// StrikeCapital design tokens — "Swiss editorial private bank": warm paper, ink navy, hairlines,
// orange only where it means something (active, focus, the key action).
const ink = {
  DEFAULT: '#0D2654',
  50: '#EEF1F7',
  100: '#D9DFEC',
  200: '#B3BED6',
  300: '#8696BB',
  400: '#5A6E9E',
  500: '#3A5083',
  600: '#1F3A6E',
  700: '#162E5D',
  800: '#0D2654',
  900: '#0A1D41',
  950: '#06132C',
};

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Nunito', 'system-ui', '"Segoe UI"', 'sans-serif'],
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        // Numbers in tables: the same grotesk with tabular figures (see index.css), not a typewriter face
        mono: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
      },
      colors: {
        gray: {
          50: '#FAF8F4', 100: '#F2EFE8', 200: '#E4DFD4', 300: '#CFC8B9', 400: '#A39C8E',
          500: '#7E776B', 600: '#6F6A61', 700: '#4F4A42', 800: '#36322C', 900: '#221F1B',
        },
        ink,
        primary: ink, // legacy `primary-*` classes resolve to ink
        paper: { DEFAULT: '#F5F3EE', deep: '#ECE8DF' },
        line: { DEFAULT: '#E4DFD4', strong: '#CFC8B9' },
        accent: { DEFAULT: '#F06010', soft: '#FDEEE4', deep: '#C94A06' },
        muted: '#6F6A61',
        // Calmer, deeper gains / losses than Tailwind's defaults
        green: { 50: '#EEF7F2', 100: '#D6EDE0', 500: '#169064', 600: '#0E7A53', 700: '#0A6343', 800: '#084D34' },
        red: { 50: '#FBF0EC', 100: '#F5D9D0', 500: '#C9543A', 600: '#B4432B', 700: '#963521', 800: '#76291A' },
      },
      letterSpacing: {
        eyebrow: '0.14em',
      },
      boxShadow: {
        lift: '0 1px 0 rgba(13,38,84,0.04), 0 12px 32px -18px rgba(13,38,84,0.28)',
        float: '0 24px 64px -24px rgba(6,19,44,0.45)',
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // Ends on transform: none and fills backwards only, so nothing is left transformed afterwards
        // (a transformed ancestor would break position: fixed pop-overs inside pages)
        rise: {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'none' },
        },
        'draw-line': {
          '0%': { strokeDashoffset: '1200' },
          '100%': { strokeDashoffset: '0' },
        },
        'scale-check': {
          '0%': { transform: 'scale(0)' },
          '50%': { transform: 'scale(1.2)' },
          '100%': { transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.8)', opacity: '1' },
          '100%': { transform: 'scale(2)', opacity: '0' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.4s ease-out both',
        rise: 'rise 0.7s cubic-bezier(0.16, 1, 0.3, 1) backwards',
        'draw-line': 'draw-line 2.4s cubic-bezier(0.65, 0, 0.35, 1) both',
        'scale-check': 'scale-check 0.4s ease-out both',
        shimmer: 'shimmer 1.5s infinite',
        'pulse-ring': 'pulse-ring 1.5s cubic-bezier(0.215, 0.61, 0.355, 1) infinite',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
