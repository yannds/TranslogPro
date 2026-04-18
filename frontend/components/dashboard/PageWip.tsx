/**
 * PageWip — Placeholder pour les pages en cours de développement.
 *
 * Compat light/dark via tokens sémantiques, role=status pour lecteurs d'écran.
 */
import { NavIcon } from './NavIcon';
import { useI18n } from '../../lib/i18n/useI18n';

export interface PageWipProps {
  title: string;
}

export function PageWip({ title }: PageWipProps) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-live="polite"
      className="p-6 flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center"
    >
      <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-slate-800 flex items-center justify-center">
        <NavIcon name="Puzzle" className="w-8 h-8 t-text-3" aria-hidden="true" />
      </div>
      <h1 className="text-xl font-bold t-text">{title}</h1>
      <p className="t-text-2 max-w-sm text-sm">
        {t('wip.description')}
      </p>
      <span className="text-xs t-badge-wip px-3 py-1 rounded-full font-semibold">
        {t('wip.badge')}
      </span>
    </div>
  );
}
