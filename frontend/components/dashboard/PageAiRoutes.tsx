/**
 * PageAiRoutes — Recommandations IA sur la rentabilité des lignes
 *
 * Future intégration : GET /api/v1/tenants/:id/analytics/ai-routes
 */
import { cn }           from '../../lib/utils';
import { useI18n }      from '../../lib/i18n/useI18n';
import type { AiRoute } from './types';

// ─── Données mock ─────────────────────────────────────────────────────────────

const AI_ROUTES: AiRoute[] = [
  { route: 'BZV → PNR', score: 94, marge: '+38%', freq: '8x/j', conseil: 'Augmenter la fréquence le vendredi soir. Envisager un bus premium.' },
  { route: 'BZV → DOL', score: 78, marge: '+22%', freq: '4x/j', conseil: 'Taux remplissage 82%. Ajouter 1 départ à 17h pour capter retour travail.' },
  { route: 'PNR → DOL', score: 71, marge: '+18%', freq: '2x/j', conseil: "Faible concurrence. Potentiel d'augmentation tarifaire de 10-15%." },
  { route: 'BZV → NKY', score: 62, marge: '+12%', freq: '3x/j', conseil: 'Envisager bus de 30 places au lieu de 50. Économies carburant +8%.' },
  { route: 'BZV → OUE', score: 41, marge: '-4%',  freq: '1x/j', conseil: 'Ligne déficitaire. Recommandation : supprimer ou réduire à 3x/semaine.' },
];

// ─── Composant ────────────────────────────────────────────────────────────────

export function PageAiRoutes() {
  const { t } = useI18n();

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-white">{t('aiRoutes.title')}</h1>
      <div className="grid gap-4">
        {AI_ROUTES.map((r, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className="font-bold text-white text-lg">{r.route}</span>
                  <span className={cn(
                    'text-xs font-semibold px-2 py-0.5 rounded-full',
                    r.marge.startsWith('+') ? 'bg-emerald-900/60 text-emerald-400' : 'bg-red-900/60 text-red-400',
                  )}>
                    {r.marge} {t('aiRoutes.margin')}
                  </span>
                  <span className="text-xs text-slate-500">{r.freq}</span>
                </div>
                <p className="text-slate-400 text-sm">{r.conseil}</p>
              </div>
              <div className="shrink-0 text-right">
                <div className={cn(
                  'text-3xl font-black tabular-nums',
                  r.score >= 80 ? 'text-emerald-400' : r.score >= 60 ? 'text-amber-400' : 'text-red-400',
                )}>
                  {r.score}
                </div>
                <div className="text-xs text-slate-600">{t('aiRoutes.score')}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
