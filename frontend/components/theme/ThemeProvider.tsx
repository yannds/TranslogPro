/**
 * ThemeProvider — Dark Mode exclusif, Zéro Flash Blanc
 *
 * TranslogPro est 100% dark — pas de mode clair.
 *
 * Stratégie :
 *   1. Script inline dans <head> applique 'dark' sur <html> avant le premier paint
 *   2. ThemeProvider React garantit la classe 'dark' en permanence
 *   3. Classe 'dark' sur <html> drive Tailwind dark: variants
 *
 * Le toggle light/dark est intentionnellement supprimé.
 */
import {
  createContext, useContext, useEffect,
  type ReactNode,
} from 'react';

interface ThemeCtx {
  /** Toujours 'dark' */
  resolved: 'dark';
}

const Ctx = createContext<ThemeCtx>({ resolved: 'dark' });

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Garantit que la classe 'dark' est toujours présente (pas de flash clair)
  useEffect(() => {
    document.documentElement.classList.add('dark');
    // Supprimer light si jamais elle traîne d'une ancienne version
    document.documentElement.classList.remove('light');
    // Effacer l'ancien token de localStorage pour ne pas revenir en mode clair
    try { localStorage.removeItem('translog-theme'); } catch { /* ignore */ }
  }, []);

  return (
    <Ctx.Provider value={{ resolved: 'dark' }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTheme(): ThemeCtx {
  return useContext(Ctx);
}
