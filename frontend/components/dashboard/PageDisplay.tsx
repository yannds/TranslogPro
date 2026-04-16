/**
 * PageDisplay — Gestion des écrans d'affichage gare (données mock)
 *
 * Future intégration : GET /api/v1/tenants/:id/display/screens
 */
import { cn }             from '../../lib/utils';
import { useI18n }        from '../../lib/i18n/useI18n';

// ─── Données mock ─────────────────────────────────────────────────────────────

const SCREEN_KEYS: { nameKey: string; type: string; online: boolean; last: string }[] = [
  { nameKey: 'hallDepart',  type: 'DepartureBoard', online: true,  last: '14:22:01' },
  { nameKey: 'quaiABus',    type: 'BusScreen',      online: true,  last: '14:22:18' },
  { nameKey: 'quaiBBus',    type: 'BusScreen',      online: true,  last: '14:21:55' },
  { nameKey: 'quaiCScreen', type: 'QuaiScreen',     online: true,  last: '14:22:10' },
  { nameKey: 'waitingInfo', type: 'InfoBoard',       online: false, last: '10:15:44' },
  { nameKey: 'entryKiosk',  type: 'Kiosk',          online: true,  last: '14:21:58' },
];

// ─── Composant ────────────────────────────────────────────────────────────────

export function PageDisplay() {
  const { t } = useI18n();

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-white">{t('display.heading')}</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {SCREEN_KEYS.map((s, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-colors">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="font-semibold text-white text-sm">{t(`display.${s.nameKey}`)}</p>
                <p className="text-xs text-slate-500 mt-0.5">{s.type}</p>
              </div>
              <span className={cn(
                'text-xs font-semibold',
                s.online ? 'text-emerald-400' : 'text-red-400',
              )}>
                {s.online ? t('display.online') : t('display.offline')}
              </span>
            </div>
            <p className="text-xs text-slate-600">{t('display.lastUpdate')} : {s.last}</p>
            <button className="mt-3 w-full text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 py-1.5 rounded-lg transition-colors">
              {t('display.configure')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
