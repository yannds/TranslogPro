/**
 * NotifyToaster — Enveloppe `<Toaster>` de Sonner + bouton « Fermer tout »
 * flottant qui apparaît dès que 2+ toasts sont empilés.
 *
 * - Theme : branché sur notre ThemeProvider ('light'/'dark') — pas de
 *   détection OS séparée, on reste cohérent avec le toggle global du shell.
 * - Position : bas-droite (standard, n'interfère pas avec le menu hamburger
 *   top-left sur mobile). Sur mobile le Toaster prend toute la largeur bas.
 * - closeButton : chaque toast a sa propre croix (demande utilisateur).
 * - richColors : coloration native success/error/warning/info.
 * - Composant mobilisé une fois dans main.tsx — jamais monter plusieurs
 *   instances (sinon double toast).
 */
import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { X } from 'lucide-react';
import { useTheme } from '../theme/ThemeProvider';
import { useI18n } from '../../lib/i18n/useI18n';
import { notify } from '../../lib/notify/notify';

export function NotifyToaster() {
  const { theme } = useTheme();
  const { t } = useI18n();
  const [activeCount, setActiveCount] = useState(0);

  useEffect(() => notify.subscribe(setActiveCount), []);

  return (
    <>
      <Toaster
        theme={theme === 'dark' ? 'dark' : 'light'}
        position="bottom-right"
        richColors
        closeButton
        expand={false}
        visibleToasts={5}
      />

      {activeCount > 1 && (
        <button
          type="button"
          onClick={() => notify.dismissAll()}
          className="fixed z-[9999] bottom-3 right-3 sm:bottom-auto sm:top-3 inline-flex items-center gap-1.5 rounded-full bg-slate-900/90 dark:bg-white/90 text-white dark:text-slate-900 text-xs font-medium px-3 py-1.5 shadow-lg backdrop-blur hover:bg-slate-900 dark:hover:bg-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          aria-label={t('notify.dismissAll')}
        >
          <X className="w-3.5 h-3.5" aria-hidden />
          {t('notify.dismissAll')}
          <span className="ml-1 rounded-full bg-white/20 dark:bg-slate-900/20 px-1.5 text-[10px] leading-none">
            {activeCount}
          </span>
        </button>
      )}
    </>
  );
}
