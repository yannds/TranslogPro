/** @type {import('tailwindcss').Config} */
export default {
  // Dark mode par classe (ThemeProvider applique 'dark' sur <html>)
  darkMode: 'class',

  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './providers/**/*.{ts,tsx}',
  ],

  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      colors: {
        // CSS custom properties injectées par TenantConfigProvider
        primary:   'var(--color-primary,   #0d9488)',
        secondary: 'var(--color-secondary, #0f766e)',
        accent:    'var(--color-accent,    #f59e0b)',
      },
    },
  },

  plugins: [
    // @tailwindcss/forms : reset des inputs (optionnel)
    // require('@tailwindcss/forms'),
  ],
};
