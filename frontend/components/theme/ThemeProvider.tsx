/**
 * ThemeProvider — Light Mode par défaut, Dark-Ready
 *
 * Stratégie :
 *   1. Lecture du localStorage au premier mount (SSR-safe)
 *   2. Défaut : 'light' (exigence PRD v1.0)
 *   3. La classe 'dark' sur <html> active les Tailwind dark: variants
 *   4. toggle() bascule entre light ↔ dark et persiste dans localStorage
 */
import {
  createContext, useContext, useEffect, useState, useCallback,
  type ReactNode,
} from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Theme = 'light' | 'dark';

interface ThemeCtx {
  theme:  Theme;
  toggle: () => void;
}

// ─── Contexte ─────────────────────────────────────────────────────────────────

const Ctx = createContext<ThemeCtx>({
  theme:  'light',
  toggle: () => undefined,
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('translog-theme') as Theme | null) ?? 'light';
    } catch {
      return 'light';
    }
  });

  // Synchronise la classe <html> et persiste à chaque changement
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
    }
    try { localStorage.setItem('translog-theme', theme); } catch { /* ignore */ }
  }, [theme]);

  const toggle = useCallback(() => setTheme(t => t === 'dark' ? 'light' : 'dark'), []);

  return (
    <Ctx.Provider value={{ theme, toggle }}>
      {children}
    </Ctx.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTheme(): ThemeCtx {
  return useContext(Ctx);
}
