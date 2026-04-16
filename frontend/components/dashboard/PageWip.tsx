/**
 * PageWip — Placeholder pour les pages en cours de développement
 */
import { NavIcon } from './NavIcon';
import { useI18n } from '../../lib/i18n/useI18n';

export interface PageWipProps {
  title: string;
}

export function PageWip({ title }: PageWipProps) {
  const { t } = useI18n();
  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center">
        <NavIcon name="Puzzle" className="w-8 h-8 text-slate-500" />
      </div>
      <h1 className="text-xl font-bold text-white">{title}</h1>
      <p className="text-slate-500 max-w-sm text-sm">
        {t('wip.description')}
      </p>
      <span className="text-xs bg-amber-900/40 text-amber-400 px-3 py-1 rounded-full font-semibold">
        {t('wip.badge')}
      </span>
    </div>
  );
}
