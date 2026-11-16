/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'] },
      colors: {
        base: '#081625', panel: '#10243B', surface: '#17334D', line: '#21405E',
        ink: '#F4F7FB', muted: '#94A8BD', fire: '#F97316', danger: '#EF4444',
        modis: '#FB923C', viirs: '#67D8F2',
        amber: { DEFAULT: '#FBBF24' }, teal: { DEFAULT: '#14B8A6' }, sky: { DEFAULT: '#38BDF8' },
      },
    },
  },
  plugins: [],
}
