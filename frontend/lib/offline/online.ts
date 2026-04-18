/**
 * useOnline — Hook d'état réseau (online/offline).
 *
 * S'abonne aux events `online`/`offline` du browser. Valeur initiale dérivée
 * de `navigator.onLine` (peut être faussement true — la vraie confirmation
 * se fait sur une requête qui échoue → on bascule l'UI côté consommateur).
 */
import { useEffect, useState } from 'react';

export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    function handleOnline()  { setOnline(true);  }
    function handleOffline() { setOnline(false); }
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return online;
}
