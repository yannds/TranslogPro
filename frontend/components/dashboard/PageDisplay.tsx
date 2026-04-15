/**
 * PageDisplay — Gestion des écrans d'affichage gare (données mock)
 *
 * Future intégration : GET /api/v1/tenants/:id/display/screens
 */
import { cn }             from '../../lib/utils';
import type { ScreenItem } from './types';

// ─── Données mock ─────────────────────────────────────────────────────────────

const SCREENS: ScreenItem[] = [
  { name: 'Grand Hall — Tableaux Départs',  type: 'DepartureBoard', status: 'En ligne',   last: '14:22:01' },
  { name: 'Quai A — Écran Bus',             type: 'BusScreen',      status: 'En ligne',   last: '14:22:18' },
  { name: 'Quai B — Écran Bus',             type: 'BusScreen',      status: 'En ligne',   last: '14:21:55' },
  { name: 'Quai C — Écran Quai',            type: 'QuaiScreen',     status: 'En ligne',   last: '14:22:10' },
  { name: 'Salle Attente — Infos',          type: 'InfoBoard',      status: 'Hors ligne', last: '10:15:44' },
  { name: 'Entrée — Kiosque',               type: 'Kiosk',          status: 'En ligne',   last: '14:21:58' },
];

// ─── Composant ────────────────────────────────────────────────────────────────

export function PageDisplay() {
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-white">Écrans &amp; Afficheurs</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {SCREENS.map((s, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-colors">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="font-semibold text-white text-sm">{s.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">{s.type}</p>
              </div>
              <span className={cn(
                'text-xs font-semibold',
                s.status === 'En ligne' ? 'text-emerald-400' : 'text-red-400',
              )}>
                {s.status}
              </span>
            </div>
            <p className="text-xs text-slate-600">Dernière mise à jour : {s.last}</p>
            <button className="mt-3 w-full text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 py-1.5 rounded-lg transition-colors">
              Configurer
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
