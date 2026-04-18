/**
 * PageAiFleet — Recommandations IA sur l'optimisation de la flotte.
 *
 * Future intégration : GET /api/v1/tenants/:id/analytics/ai-fleet
 * - Rightsizing véhicule (bus 50 vs 30 places vs sprinter)
 * - Affectation optimale bus ↔ ligne
 * - Planning maintenance (predictive vs preventive)
 *
 * UI : tokens sémantiques, compat light/dark, WCAG 2.1 AA, ARIA.
 */
import { useMemo, useState } from 'react';
import { Bus, Wrench, Route, Gauge, Sparkles, Filter } from 'lucide-react';
import { cn }      from '../../lib/utils';
import { useI18n } from '../../lib/i18n/useI18n';

// ─── Types & données ──────────────────────────────────────────────────────────

interface FleetAdvice {
  id:        string;
  category:  'rightsize' | 'assignment' | 'maintenance';
  vehicle:   string;
  title:     string;
  detail:    string;
  impact:    string;      // "+8% économie carburant", "-12% temps immobilisation"
  score:     number;      // 0-100 confiance IA
}

const ADVICES: FleetAdvice[] = [
  { id: '1', category: 'rightsize',   vehicle: 'KA-4421-B', title: 'Remplacer par un 30 places',
    detail: 'Taux remplissage moyen 58% sur 90j. Un bus 30 places couvrirait la demande et réduirait la consommation.',
    impact: '+8% économie carburant', score: 88 },
  { id: '2', category: 'assignment',  vehicle: 'KA-0312-A', title: 'Réaffecter sur BZV → PNR',
    detail: 'Ce bus haut de gamme est affecté sur une ligne à taux remplissage 62%. Le déplacer sur BZV→PNR optimiserait le ROI.',
    impact: '+14% marge estimée', score: 81 },
  { id: '3', category: 'maintenance', vehicle: 'KA-1108-C', title: 'Maintenance prédictive — freins',
    detail: 'Analyse vibration + km parcourus : usure freins projetée à 3 semaines. Planifier 2 semaines en avance.',
    impact: '-12% coût réparation',  score: 76 },
  { id: '4', category: 'rightsize',   vehicle: 'KA-7712-B', title: 'Sprinter suffisant en basse saison',
    detail: 'De juin à sept, le remplissage descend à 34%. Basculer sur un sprinter 12 places 3 jours/semaine.',
    impact: '+22% marge saisonnière', score: 72 },
  { id: '5', category: 'assignment',  vehicle: 'KA-5501-D', title: 'Affecter au fret',
    detail: 'Faible demande passagers sur ce créneau. Reconversion fret BZV→OUE couvrirait la demande colis existante.',
    impact: '+6% revenus fret',       score: 64 },
  { id: '6', category: 'maintenance', vehicle: 'KA-0812-A', title: 'Vidange anticipée recommandée',
    detail: 'Km parcourus +18% vs mois précédent. Anticiper vidange de 800 km pour préserver le moteur.',
    impact: '-5% risque panne',       score: 58 },
];

const CAT_ICON = { rightsize: Gauge, assignment: Route, maintenance: Wrench } as const;

// ─── Composant ────────────────────────────────────────────────────────────────

type FilterKey = 'all' | FleetAdvice['category'];

export function PageAiFleet() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<FilterKey>('all');

  const visible = useMemo(
    () => filter === 'all' ? ADVICES : ADVICES.filter(a => a.category === filter),
    [filter],
  );

  const CAT_LABEL: Record<FilterKey, string> = {
    all:         t('aiFleet.filterAll'),
    rightsize:   t('aiFleet.catRightsize'),
    assignment:  t('aiFleet.catAssignment'),
    maintenance: t('aiFleet.catMaintenance'),
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
            <h1 className="text-2xl font-bold t-text">{t('aiFleet.title')}</h1>
          </div>
          <p className="text-sm t-text-2 mt-1">{t('aiFleet.subtitle')}</p>
        </div>

        <div
          role="tablist"
          aria-label={t('aiFleet.filter')}
          className="inline-flex items-center gap-1 rounded-lg p-1 t-card-bordered overflow-x-auto max-w-full"
        >
          <Filter className="w-4 h-4 t-text-3 ml-2 shrink-0" aria-hidden="true" />
          {(['all', 'rightsize', 'assignment', 'maintenance'] as FilterKey[]).map(f => {
            const active = filter === f;
            return (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f)}
                className={cn(
                  'shrink-0 whitespace-nowrap text-xs font-semibold px-3 py-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                  active
                    ? 'bg-teal-600 text-white'
                    : 't-text-body hover:bg-gray-100 dark:hover:bg-slate-800',
                )}
              >
                {CAT_LABEL[f]}
              </button>
            );
          })}
        </div>
      </header>

      {/* Top KPIs */}
      <section aria-labelledby="ai-fleet-kpi-title">
        <h2 id="ai-fleet-kpi-title" className="sr-only">{t('aiFleet.kpisTitle')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="t-card-bordered rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Bus className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
              <p className="text-xs font-semibold t-text-2 uppercase tracking-wider">{t('aiFleet.kpiActiveBuses')}</p>
            </div>
            <p className="text-3xl font-black t-text tabular-nums">24</p>
            <p className="text-xs t-text-3 mt-1">{t('aiFleet.kpiActiveBusesSub')}</p>
          </div>
          <div className="t-card-bordered rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Gauge className="w-4 h-4 text-amber-600 dark:text-amber-500" aria-hidden="true" />
              <p className="text-xs font-semibold t-text-2 uppercase tracking-wider">{t('aiFleet.kpiAvgFill')}</p>
            </div>
            <p className="text-3xl font-black t-text tabular-nums">72%</p>
            <p className="text-xs t-text-3 mt-1">{t('aiFleet.kpiAvgFillSub')}</p>
          </div>
          <div className="t-card-bordered rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Wrench className="w-4 h-4 text-red-600 dark:text-red-400" aria-hidden="true" />
              <p className="text-xs font-semibold t-text-2 uppercase tracking-wider">{t('aiFleet.kpiMaintBacklog')}</p>
            </div>
            <p className="text-3xl font-black t-text tabular-nums">3</p>
            <p className="text-xs t-text-3 mt-1">{t('aiFleet.kpiMaintBacklogSub')}</p>
          </div>
        </div>
      </section>

      {/* Conseils */}
      <section aria-labelledby="ai-fleet-advice-title">
        <h2 id="ai-fleet-advice-title" className="text-sm font-semibold t-text mb-3">{t('aiFleet.adviceTitle')}</h2>
        <div className="grid gap-4" role="list">
          {visible.map(a => {
            const Icon = CAT_ICON[a.category];
            return (
              <article
                key={a.id}
                role="listitem"
                aria-labelledby={`ai-fleet-title-${a.id}`}
                className="t-card-bordered rounded-2xl p-4 sm:p-5"
              >
                <div className="flex items-start justify-between gap-3 sm:gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-teal-500/10 flex items-center justify-center text-teal-600 dark:text-teal-400 shrink-0">
                      <Icon className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span id={`ai-fleet-title-${a.id}`} className="font-bold t-text break-words">{a.title}</span>
                        <span className="text-xs t-text-3 font-mono">{a.vehicle}</span>
                        <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full t-delta-up">
                          {a.impact}
                        </span>
                      </div>
                      <p className="t-text-body text-sm break-words">{a.detail}</p>
                    </div>
                  </div>
                  <div
                    className="shrink-0 text-right"
                    role="progressbar"
                    aria-valuenow={a.score}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${t('aiFleet.confidence')} ${a.vehicle}`}
                  >
                    <div className={cn(
                      'text-xl sm:text-2xl font-black tabular-nums',
                      a.score >= 80 ? 'text-emerald-600 dark:text-emerald-400'
                        : a.score >= 60 ? 'text-amber-600 dark:text-amber-500'
                        : 'text-red-600 dark:text-red-400',
                    )}>
                      {a.score}
                    </div>
                    <div className="text-[10px] t-text-3 uppercase tracking-wider">{t('aiFleet.confidence')}</div>
                  </div>
                </div>
              </article>
            );
          })}
          {visible.length === 0 && (
            <p className="text-sm t-text-2 text-center py-8">{t('aiFleet.emptyFilter')}</p>
          )}
        </div>
      </section>
    </div>
  );
}
