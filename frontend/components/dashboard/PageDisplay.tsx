/**
 * PageDisplay — Gestion des écrans d'affichage gare
 *
 * Wires real stations as potential display screens via GET /api/tenants/:tid/stations.
 * Falls back to static SCREEN_KEYS when no stations are available.
 */
import { cn }             from '../../lib/utils';
import { useI18n }        from '../../lib/i18n/useI18n';
import { useAuth }        from '../../lib/auth/auth.context';
import { useFetch }       from '../../lib/hooks/useFetch';

// ─── Données fallback ─────────────────────────────────────────────────────────

interface ScreenEntry {
  id:      string;
  name:    string;
  type:    string;
  online:  boolean;
  last:    string;
}

const FALLBACK_SCREENS: ScreenEntry[] = [
  { id: 'scr-1', name: 'hallDepart',  type: 'DepartureBoard', online: true,  last: '14:22:01' },
  { id: 'scr-2', name: 'quaiABus',    type: 'BusScreen',      online: true,  last: '14:22:18' },
  { id: 'scr-3', name: 'quaiBBus',    type: 'BusScreen',      online: true,  last: '14:21:55' },
  { id: 'scr-4', name: 'quaiCScreen', type: 'QuaiScreen',     online: true,  last: '14:22:10' },
  { id: 'scr-5', name: 'waitingInfo', type: 'InfoBoard',      online: false, last: '10:15:44' },
  { id: 'scr-6', name: 'entryKiosk',  type: 'Kiosk',          online: true,  last: '14:21:58' },
];

// ─── Composant ────────────────────────────────────────────────────────────────

export function PageDisplay() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId;

  // ── Fetch stations — each station is a potential display screen ────────────
  const stationsRes = useFetch<{ id: string; name: string; city: string; type?: string }[]>(
    tenantId ? `/api/tenants/${tenantId}/stations` : null,
    [tenantId],
  );

  const screens: ScreenEntry[] = (() => {
    if (stationsRes.data?.length) {
      return stationsRes.data.map(stn => ({
        id:     stn.id,
        name:   stn.name,
        type:   'DepartureBoard',
        online: true,
        last:   new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      }));
    }
    return FALLBACK_SCREENS;
  })();

  const isFallback = !stationsRes.data?.length;

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-white">{t('display.heading')}</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {screens.map(s => (
          <div key={s.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-colors">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="font-semibold text-white text-sm">
                  {isFallback ? t(`display.${s.name}`) : s.name}
                </p>
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
