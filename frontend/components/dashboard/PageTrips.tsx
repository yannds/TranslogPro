/**
 * PageTrips — Liste des trajets du jour (données mock)
 *
 * Future intégration : GET /api/v1/tenants/:id/trips?date=today
 */
import { cn }      from '../../lib/utils';
import { NavIcon } from './NavIcon';
import type { TripRow } from './types';

// ─── Données mock ─────────────────────────────────────────────────────────────

const TRIPS: TripRow[] = [
  { from: 'Brazzaville', to: 'Pointe-Noire', time: '08:00', quai: 'A2', pax: '48/50', status: 'En route',     color: 'text-blue-400'   },
  { from: 'Brazzaville', to: 'Dolisie',      time: '08:30', quai: 'B3', pax: '32/45', status: 'En route',     color: 'text-blue-400'   },
  { from: 'Brazzaville', to: 'Nkayi',        time: '09:15', quai: 'C1', pax: '50/50', status: 'Embarquement', color: 'text-amber-400'  },
  { from: 'Brazzaville', to: 'Pointe-Noire', time: '10:00', quai: 'A3', pax: '22/50', status: 'Prévu',        color: 'text-sky-400'    },
  { from: 'Pointe-Noire', to: 'Brazzaville', time: '07:00', quai: 'D1', pax: '50/50', status: 'Arrivé',       color: 'text-teal-400'   },
  { from: 'Brazzaville', to: 'Ouesso',       time: '06:00', quai: 'B1', pax: '38/42', status: 'Retard',       color: 'text-orange-400' },
];

// ─── Composant ────────────────────────────────────────────────────────────────

export function PageTrips() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Trajets du jour</h1>
        <button className="flex items-center gap-2 bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          <NavIcon name="MapPin" /> Nouveau trajet
        </button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left p-4 text-slate-500 font-medium">Départ</th>
              <th className="text-left p-4 text-slate-500 font-medium">Destination</th>
              <th className="text-left p-4 text-slate-500 font-medium">Heure</th>
              <th className="text-left p-4 text-slate-500 font-medium">Quai</th>
              <th className="text-left p-4 text-slate-500 font-medium">Pax</th>
              <th className="text-left p-4 text-slate-500 font-medium">Statut</th>
            </tr>
          </thead>
          <tbody>
            {TRIPS.map((r, i) => (
              <tr key={i} className="border-b border-slate-800/60 hover:bg-slate-800/40 transition-colors">
                <td className="p-4 text-slate-300">{r.from}</td>
                <td className="p-4 text-slate-100 font-medium">{r.to}</td>
                <td className="p-4 text-slate-400 tabular-nums">{r.time}</td>
                <td className="p-4 text-slate-400">{r.quai}</td>
                <td className="p-4 text-slate-400 tabular-nums">{r.pax}</td>
                <td className="p-4">
                  <span className={cn('font-medium', r.color)}>{r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
