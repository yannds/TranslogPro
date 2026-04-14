/**
 * PageCrewBriefing — Briefings pré-départ équipages
 *
 * Module Crew Briefing : checklist équipements de sécurité obligatoires
 * avant chaque trajet.
 *
 * TODO (données) :
 *   - GET /tenants/:tid/crew-briefing/briefings/incomplete        → briefings KO
 *   - GET /tenants/:tid/crew-briefing/briefings/history?limit=50  → historique
 *   - GET /tenants/:tid/crew-briefing/equipment-types             → catalogue équipements
 *   - POST /tenants/:tid/crew-briefing/briefings                  → créer briefing
 *
 * Accessibilité : WCAG 2.1 AA — aria-checked sur checkboxes, live regions
 * Dark mode : Tailwind dark:
 */

import { useState } from 'react';
import {
  ShieldCheck, ShieldAlert, ClipboardList, Plus, CheckCircle2,
  XCircle, ChevronDown, ChevronRight,
} from 'lucide-react';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';

// ─── Types provisoires ────────────────────────────────────────────────────────

interface BriefingRecord {
  id:             string;
  assignmentId:   string;
  tripRef:        string;
  conductedBy:    string;
  completedAt:    string;
  allEquipmentOk: boolean;
  missingCodes:   string[];
}

interface EquipmentType {
  id:          string;
  name:        string;
  code:        string;
  requiredQty: number;
  isMandatory: boolean;
}

type Tab = 'incomplete' | 'history' | 'equipment';

// ─── Indicateur de conformité ─────────────────────────────────────────────────

function ConformityIndicator({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
      <CheckCircle2 className="w-4 h-4" aria-hidden />
      Conforme
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400 text-xs font-medium">
      <XCircle className="w-4 h-4" aria-hidden />
      Non conforme
    </span>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export function PageCrewBriefing() {
  const [tab, setTab]       = useState<Tab>('incomplete');
  const [expanded, setExpanded] = useState<string | null>(null);

  // TODO: fetch API
  const loading  = false;
  const incomplete: BriefingRecord[] = [];
  const history: BriefingRecord[]    = [];
  const equipment: EquipmentType[]   = [];

  const tabs: { id: Tab; label: string }[] = [
    { id: 'incomplete', label: 'Non conformes' },
    { id: 'history',    label: 'Historique' },
    { id: 'equipment',  label: 'Équipements' },
  ];

  return (
    <main className="p-6 space-y-6" role="main" aria-label="Briefings équipages pré-départ">
      {/* ── En-tête ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Briefings Équipages</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Checklist sécurité pré-départ — gilets, lampes, trousse, cales, sangles, triangles, cric
          </p>
        </div>
        <Button aria-label="Créer un nouveau briefing pré-départ">
          <Plus className="w-4 h-4 mr-2" aria-hidden />
          Nouveau briefing
        </Button>
      </div>

      {/* ── KPIs ── */}
      <section aria-label="Indicateurs briefings">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <article
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-center gap-4"
            aria-label={`Briefings non conformes: ${incomplete.length}`}
          >
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 shrink-0" aria-hidden>
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Non conformes</p>
              {loading ? <Skeleton className="h-7 w-8 mt-1" /> : (
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{incomplete.length}</p>
              )}
            </div>
          </article>

          <article
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-center gap-4"
            aria-label={`Briefings aujourd'hui: ${history.length}`}
          >
            <div className="p-3 rounded-lg bg-teal-50 dark:bg-teal-900/20 text-teal-500 shrink-0" aria-hidden>
              <ClipboardList className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Ce jour</p>
              {loading ? <Skeleton className="h-7 w-8 mt-1" /> : (
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{history.length}</p>
              )}
            </div>
          </article>

          <article
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-center gap-4"
            aria-label={`Équipements configurés: ${equipment.length}`}
          >
            <div className="p-3 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0" aria-hidden>
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Types équipements</p>
              {loading ? <Skeleton className="h-7 w-8 mt-1" /> : (
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{equipment.length}</p>
              )}
            </div>
          </article>
        </div>
      </section>

      {/* ── Tabs ── */}
      <nav aria-label="Sections briefings" role="tablist">
        <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
          {tabs.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`tabpanel-briefing-${t.id}`}
              id={`tab-briefing-${t.id}`}
              onClick={() => setTab(t.id)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                tab === t.id
                  ? 'border-teal-600 text-teal-600 dark:border-teal-400 dark:text-teal-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
              )}
            >
              {t.label}
              {t.id === 'incomplete' && incomplete.length > 0 && (
                <span
                  className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold"
                  aria-label={`${incomplete.length} non conformes`}
                >
                  {incomplete.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* ── Panneau Non conformes ── */}
      {tab === 'incomplete' && (
        <section
          id="tabpanel-briefing-incomplete"
          role="tabpanel"
          aria-labelledby="tab-briefing-incomplete"
          aria-live="polite"
        >
          <Card>
            <CardHeader
              heading="Briefings non conformes"
              description="Trajets dont au moins un équipement obligatoire est manquant"
            />
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6 space-y-3" aria-busy="true">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              ) : incomplete.length === 0 ? (
                <div className="flex flex-col items-center py-16 text-slate-500 dark:text-slate-400" role="status">
                  <CheckCircle2 className="w-12 h-12 mb-3 text-emerald-500" aria-hidden />
                  <p className="font-medium">Tous les briefings sont conformes</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
                  {incomplete.map(b => (
                    <li key={b.id}>
                      <button
                        className="w-full text-left px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
                        onClick={() => setExpanded(expanded === b.id ? null : b.id)}
                        aria-expanded={expanded === b.id}
                        aria-controls={`briefing-detail-${b.id}`}
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{b.tripRef}</p>
                            <p className="text-xs text-slate-500 mt-0.5">Par {b.conductedBy} — {new Date(b.completedAt).toLocaleString('fr-FR')}</p>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <Badge variant="danger" size="sm">{b.missingCodes.length} manquant(s)</Badge>
                            {expanded === b.id
                              ? <ChevronDown className="w-4 h-4 text-slate-400" aria-hidden />
                              : <ChevronRight className="w-4 h-4 text-slate-400" aria-hidden />
                            }
                          </div>
                        </div>
                      </button>
                      {expanded === b.id && (
                        <div
                          id={`briefing-detail-${b.id}`}
                          className="px-6 pb-4 bg-red-50/50 dark:bg-red-900/10 border-t border-red-100 dark:border-red-900/30"
                        >
                          <p className="text-xs font-semibold text-red-700 dark:text-red-400 mt-3 mb-2 uppercase tracking-wide">
                            Équipements manquants :
                          </p>
                          <ul className="flex flex-wrap gap-2" aria-label="Équipements manquants">
                            {b.missingCodes.map(code => (
                              <li key={code}>
                                <Badge variant="danger" size="sm">{code}</Badge>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Panneau Historique ── */}
      {tab === 'history' && (
        <section id="tabpanel-briefing-history" role="tabpanel" aria-labelledby="tab-briefing-history">
          <Card>
            <CardHeader heading="Historique des briefings" description="50 derniers briefings enregistrés" />
            <CardContent className="p-0">
              {/* TODO: fetch depuis GET /crew-briefing/briefings/history */}
              {loading ? (
                <div className="p-6 space-y-3" aria-busy="true">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : history.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 py-12 text-center">
                  {/* TODO: fetch depuis GET /tenants/:tid/crew-briefing/briefings/history?limit=50 */}
                  Aucun briefing dans l'historique
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
                  {history.map(b => (
                    <li key={b.id} className="flex items-center justify-between px-6 py-3">
                      <div>
                        <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{b.tripRef}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Par {b.conductedBy} — {new Date(b.completedAt).toLocaleString('fr-FR')}
                        </p>
                      </div>
                      <ConformityIndicator ok={b.allEquipmentOk} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Panneau Équipements ── */}
      {tab === 'equipment' && (
        <section id="tabpanel-briefing-equipment" role="tabpanel" aria-labelledby="tab-briefing-equipment">
          <Card>
            <CardHeader
              heading="Catalogue des équipements"
              description="Équipements obligatoires configurés pour ce tenant"
              action={
                <Button size="sm" aria-label="Ajouter un type d'équipement">
                  <Plus className="w-4 h-4 mr-1" aria-hidden /> Équipement
                </Button>
              }
            />
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6 space-y-3" aria-busy="true">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : equipment.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 py-12 text-center">
                  Aucun équipement configuré — cliquez sur « Équipement » pour commencer
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
                  {equipment.map(eq => (
                    <li key={eq.id} className="flex items-center justify-between px-6 py-3">
                      <div>
                        <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{eq.name}</p>
                        <p className="text-xs text-slate-500 font-mono">{eq.code}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-500">Qté requise: {eq.requiredQty}</span>
                        {eq.isMandatory
                          ? <Badge variant="warning" size="sm">Obligatoire</Badge>
                          : <Badge variant="default" size="sm">Optionnel</Badge>
                        }
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      )}
    </main>
  );
}
