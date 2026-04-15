/**
 * PageSafety — Alertes sécurité & incidents actifs (données mock)
 *
 * Future intégration : GET /api/v1/tenants/:id/safety/incidents?status=active
 */
import { NavIcon } from './NavIcon';

// ─── Composant ────────────────────────────────────────────────────────────────

export function PageSafety() {
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-white">Sécurité &amp; Incidents</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Alerte critique */}
        <div className="bg-red-950/30 border border-red-900/50 rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-red-900/60 flex items-center justify-center">
              <NavIcon name="Siren" className="text-red-400" />
            </div>
            <div>
              <p className="font-semibold text-white text-sm">Alerte active — RN1 km 145</p>
              <p className="text-xs text-red-400">Il y a 18 minutes</p>
            </div>
          </div>
          <p className="text-sm text-slate-300">
            Ralentissement important dû à des travaux. 3 bus TranslogPro actuellement
            sur ce tronçon. Délai estimé : +30 min.
          </p>
        </div>

        {/* Signalement */}
        <div className="bg-amber-950/20 border border-amber-900/30 rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-amber-900/40 flex items-center justify-center">
              <NavIcon name="AlertTriangle" className="text-amber-400" />
            </div>
            <div>
              <p className="font-semibold text-white text-sm">Signalement — Bus KA-4421-B</p>
              <p className="text-xs text-amber-400">Il y a 1h 42min</p>
            </div>
          </div>
          <p className="text-sm text-slate-300">
            Chauffeur Mabou signale une vibration anormale. Bus redirigé vers
            Dolisie pour inspection technique.
          </p>
        </div>
      </div>
    </div>
  );
}
