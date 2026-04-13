/**
 * ThemeProvider — Dark Mode persistant, Zéro Flash Blanc
 *
 * Stratégie :
 *   1. Script inline dans <head> lit localStorage avant le premier paint
 *      → Élimine totalement le FOUC (Flash Of Unstyled Content / White Flash)
 *   2. ThemeProvider React gère le thème en contexte
 *   3. Classe 'dark' sur <html> drive Tailwind dark: variants
 *
 * Usage :
 *   // Dans layout.tsx (Next.js) ou index.html (Vite) :
 *   // <script>{themeInitScript}</script>  ← avant tout style
 *
 *   // Dans _app.tsx / main.tsx :
 *   <ThemeProvider>
 *     <App />
 *   ThemeProvider>
 *
 *   // Dans un composant :
 *   const { theme, toggle } = useTheme();
 */
import {
  createContext, useContext, useEffect, useState, useCallback,
  type ReactNode,
} from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeCtx {
  theme:    Theme;
  resolved: 'light' | 'dark';   // Valeur effective (après résolution 'system')
  setTheme: (t: Theme) => void;
  toggle:   () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

/**
 * Script à injecter AVANT tout CSS dans <head>.
 * Lit localStorage et applique 'dark' sur <html> sans attendre React.
 * Zéro Flash Blanc garanti.
 */
export const themeInitScript = `
  (function() {
    try {
      var t = localStorage.getItem('translog-theme') || 'system';
      var d = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (t === 'dark' || (t === 'system' && d)) {
        document.documentElement.classList.add('dark');
      }
    } catch(e) {}
  })();
`.trim();

function resolveTheme(t: Theme): 'light' | 'dark' {
  if (t === 'dark')  return 'dark';
  if (t === 'light') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children, defaultTheme = 'system' }: {
  children:     ReactNode;
  defaultTheme?: Theme;
}) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return defaultTheme;
    return (localStorage.getItem('translog-theme') as Theme) ?? defaultTheme;
  });

  const resolved = resolveTheme(theme);

  // Synchronise la classe 'dark' sur <html> et localStorage
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem('translog-theme', t);
    const dark = resolveTheme(t) === 'dark';
    document.documentElement.classList.toggle('dark', dark);
  }, []);

  // Réagit aux changements de préférence système
  useEffect(() => {
    if (theme !== 'system') return;
    const mq      = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => document.documentElement.classList.toggle('dark', mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  // Init au premier rendu
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  }, [resolved]);

  const toggle = useCallback(() =>
    setTheme(resolved === 'dark' ? 'light' : 'dark')
  , [resolved, setTheme]);

  return (
    <Ctx.Provider value={{ theme, resolved, setTheme, toggle }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme must be inside ThemeProvider');
  return ctx;
}

/** Bouton toggle Dark/Light autonome */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { resolved, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      className={`p-2 rounded-lg border border-slate-200 dark:border-slate-700
        bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300
        hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${className}`}
      aria-label={resolved === 'dark' ? 'Activer le mode clair' : 'Activer le mode sombre'}
      title={resolved === 'dark' ? 'Mode clair' : 'Mode sombre'}
    >
      {resolved === 'dark' ? '☀' : '☾'}
    </button>
  );
}
