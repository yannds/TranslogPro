/**
 * PageFleet — Vue synthétique de la flotte (données mock)
 *
 * Note : distinct de PageFleetDocs (documents réglementaires).
 * Future intégration : GET /api/v1/tenants/:id/fleet/buses
 */
import { cn }         from '../../lib/utils';
import { NavIcon }    from './NavIcon';
import { useI18n } from '../../lib/i18n/useI18n';
import type { BusItem } from './types';


// ─── Données mock ─────────────────────────────────────────────────────────────

const BUSES: BusItem[] = [
  { id: 'KA-4421-B', model: 'Yutong ZK6122H', capacity: 50, status: 'En route',    km: '124 540', nextMaint: 'dans 2 200 km', color: 'text-blue-400'    },
  { id: 'KA-2218-C', model: 'King Long XMQ',  capacity: 45, status: 'Disponible',  km: '89 320',  nextMaint: 'dans 8 100 km', color: 'text-emerald-400' },
  { id: 'KA-0033-A', model: 'Golden Dragon',  capacity: 42, status: 'Maintenance', km: '201 800', nextMaint: 'En cours',      color: 'text-red-400'     },
  { id: 'KA-1876-D', model: 'Yutong ZK6852H', capacity: 35, status: 'Disponible',  km: '56 000',  nextMaint: 'dans 12 000 km', color: 'text-emerald-400' },
  { id: 'KA-5544-E', model: 'Higer KLQ6122',  capacity: 50, status: 'En route',    km: '148 000', nextMaint: 'dans 500 km',   color: 'text-amber-400'  },
];

// ─── Composant ────────────────────────────────────────────────────────────────

export function PageFleet() {
  const { t } = useI18n();
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">{t('fleetDash.title')}</h1>
        <button className="flex items-center gap-2 bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          <NavIcon name="Bus" /> {t('fleetDash.addBus')}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {BUSES.map((v, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-colors">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="font-bold text-white">{v.id}</p>
                <p className="text-xs text-slate-500 mt-0.5">{v.model}</p>
              </div>
              <span className={cn('text-xs font-semibold', v.color)}>{v.status}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div>
                <p className="text-slate-600 text-xs">{t('fleetDash.capacity')}</p>
                <p className="text-slate-300">{v.capacity} {t('fleetDash.seats')}</p>
              </div>
              <div>
                <p className="text-slate-600 text-xs">{t('fleetDash.mileage')}</p>
                <p className="text-slate-300 tabular-nums">{v.km} km</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-slate-600 text-xs">{t('fleetDash.nextMaint')}</p>
                <p className={cn(
                  'text-sm font-medium',
                  v.nextMaint.includes('500') || v.nextMaint === 'En cours' ? 'text-red-400' : 'text-slate-300',
                )}>
                  {v.nextMaint}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
