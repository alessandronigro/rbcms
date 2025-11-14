/** @type {import('tailwindcss').Config} */
export default {
  darkMode: false, // ❌ disattiva completamente la dark mode
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    fontFamily: {
      sans: ['Inter', 'system-ui', 'sans-serif'],
      mono: ['JetBrains Mono', 'monospace'],
    },
    extend: {
      colors: {
        // 🎨 Palette base chiara
        background: '#ffffff',     // bianco puro
        foreground: '#111111',     // nero puro
        card: {
          DEFAULT: '#ffffff',
          foreground: '#111111',
        },
        primary: {
          DEFAULT: '#10b981',      // emerald 500
          hover: '#059669',        // emerald 600
          foreground: '#ffffff',
        },
        secondary: {
          DEFAULT: '#f3f4f6',      // gray 100
          foreground: '#111827',
        },
        muted: {
          DEFAULT: '#f9fafb',      // gray 50
          foreground: '#4b5563',   // gray 600
        },
        accent: {
          DEFAULT: '#d1fae5',      // emerald 100
          foreground: '#064e3b',   // emerald 900
        },
        border: '#e5e7eb',
        input: '#ffffff',
        ring: '#10b981',
      },
      borderRadius: {
        lg: '12px',
        md: '8px',
        sm: '4px',
      },
      boxShadow: {
        soft: '0 2px 10px rgba(0, 0, 0, 0.05)',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
    require('@tailwindcss/typography'),
  ],
};
