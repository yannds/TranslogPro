/**
 * useSidebarCollapsed — État "rail d'icônes" partagé des 3 shells
 * (AdminDashboard, CustomerDashboard, PortalShell).
 *
 * Persisté en localStorage (`tp.sidebar.collapsed`) pour retrouver la
 * préférence utilisateur entre sessions. Défaut : false (sidebar large).
 *
 * Comportement :
 *   - Desktop (lg+)  : bascule w-64 ↔ w-14 via la classe CSS du shell.
 *   - Mobile (<lg)   : non utilisé — le drawer overlay reste géré séparément.
 */
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'tp.sidebar.collapsed';

function readInitial(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persist(v: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, v ? '1' : '0');
  } catch {
    // localStorage peut être bloqué (mode privé Safari, quota) — on ignore.
  }
}

export function useSidebarCollapsed() {
  const [collapsed, setCollapsedState] = useState<boolean>(readInitial);

  // Synchro multi-onglets : si l'utilisateur ouvre 2 fenêtres TP et change
  // l'état dans l'une, l'autre suit. Évite un UX incohérent.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setCollapsedState(e.newValue === '1');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setCollapsed = useCallback((v: boolean) => {
    persist(v);
    setCollapsedState(v);
  }, []);

  const toggle = useCallback(() => {
    setCollapsedState(prev => {
      const next = !prev;
      persist(next);
      return next;
    });
  }, []);

  return { collapsed, setCollapsed, toggle };
}
