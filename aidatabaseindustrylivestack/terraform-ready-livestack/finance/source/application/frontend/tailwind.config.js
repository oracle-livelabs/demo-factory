/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Oracle Redwood Design System — neutral dark grays
        redwood: {
          50: '#FAFAFA', 100: '#EDEDED', 200: '#E0E0E0', 300: '#C0C0C0',
          400: '#999999', 500: '#666666', 600: '#3A3A3A', 700: '#2A2A2A',
          800: '#1E1E1E', 900: '#161616',
        },
        signal: { green: '#2D9F5E', amber: '#D4760A', red: '#C74634', blue: '#1B84ED' },
        oracle: { red: '#C74634', dark: '#161616' },
      },
      fontFamily: {
        display: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};
