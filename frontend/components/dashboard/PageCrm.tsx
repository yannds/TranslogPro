/**
 * PageCrm — Vue CRM clients (données mock)
 *
 * Future intégration : GET /api/v1/tenants/:id/crm/clients
 */
import { cn }           from '../../lib/utils';
import { KpiCard }      from './KpiCard';
import type { CrmClient } from './types';

// ─── Données mock ─────────────────────────────────────────────────────────────

const CLIENTS: CrmClient[] = [
  { name: 'Alphonse Moubamba', tel: '+242 06 123 4567', trips: 24, points: 2400, tier: 'Gold'     },
  { name: 'Berthe Louzolo',    tel: '+242 05 987 6543', trips: 8,  points: 800,  tier: 'Silver'   },
  { name: 'Constant Nkounkou', tel: '+242 06 456 7890', trips: 42, points: 4200, tier: 'Platinum' },
  { name: 'Denise Batsimba',   tel: '+242 05 321 0987', trips: 3,  points: 300,  tier: 'Bronze'   },
];

const TIER_CLASSES: Record<string, string> = {
  Platinum: 'bg-purple-900/60 text-purple-300',
  Gold:     'bg-amber-900/60 text-amber-300',
  Silver:   'bg-slate-700 text-slate-300',
  Bronze:   'bg-amber-950/40 text-amber-700',
};

// ─── Composant ────────────────────────────────────────────────────────────────

export function PageCrm() {
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-white">CRM — Clients</h1>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Clients actifs"     value="18 432" sub="ce mois"        icon="Users2"       accent="teal"    />
        <KpiCard label="Nouveaux ce mois"   value="1 284"  sub="+12% vs N-1"    icon="TrendingUp"   accent="emerald" />
        <KpiCard label="NPS Score"          value="72"     sub="cible : 75"     icon="Star"         accent="amber"   />
        <KpiCard label="Réclamations"       value="48"     sub="7 non résolues" icon="MessageCircle" accent="red"    />
      </div>

      {/* Table clients */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Clients récents
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left p-3 text-slate-500 font-medium">Nom</th>
              <th className="text-left p-3 text-slate-500 font-medium">Téléphone</th>
              <th className="text-left p-3 text-slate-500 font-medium">Trajets</th>
              <th className="text-left p-3 text-slate-500 font-medium">Fidélité</th>
            </tr>
          </thead>
          <tbody>
            {CLIENTS.map((c, i) => (
              <tr key={i} className="border-b border-slate-800/60 hover:bg-slate-800/40 transition-colors">
                <td className="p-3 text-slate-100 font-medium">{c.name}</td>
                <td className="p-3 text-slate-400 tabular-nums">{c.tel}</td>
                <td className="p-3 text-slate-400 tabular-nums">{c.trips}</td>
                <td className="p-3">
                  <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', TIER_CLASSES[c.tier] ?? 'bg-slate-700 text-slate-300')}>
                    {c.tier}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
