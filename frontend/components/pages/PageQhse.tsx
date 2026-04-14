/**
 * PageQhse — QHSE & Accidents : rapports, litiges, procédures
 *
 * Module QHSE : gestion complète des accidents, suivi des litiges assurance/
 * gré-à-gré et exécution des procédures QHSE pas-à-pas.
 *
 * TODO (données) :
 *   - GET /tenants/:tid/qhse/accidents?status=OPEN                → rapports ouverts
 *   - GET /tenants/:tid/qhse/accidents/:id                        → détail complet
 *   - GET /tenants/:tid/qhse/accidents/:id/dispute                → litige
 *   - GET /tenants/:tid/qhse/procedures                           → procédures configurées
 *   - GET /tenants/:tid/qhse/severity-types                       → catalogue sévérités
 *   - GET /tenants/:tid/qhse/hospitals                            → hôpitaux référencés
 *
 * Accessibilité : WCAG 2.1 AA — aria-live pour mises à jour, landmark roles
 * Dark mode : Tailwind dark:
 */

import { useState } from 'react';
import {
  AlertOctagon, Gavel, ClipboardCheck, Plus,
  MapPin, Clock, Users, ChevronRight,
  CheckCircle2,
} from 'lucide-react';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';

// ─── Types provisoires ────────────────────────────────────────────────────────

interface AccidentSummary {
  id:           string;
  busId:        string | null;
  busPlate:     string | null;
  severityCode: string;
  severityColor: string;
  status:       string;
  occurredAt:   string;
  location:     string | null;
  injuryCount:  number;
  hasDispute:   boolean;
}

interface ProcedureSummary {
  id:          string;
  name:        string;
  triggerCode: string;
  stepCount:   number;
  isActive:    boolean;
}

type Tab = 'accidents' | 'disputes' | 'procedures' | 'config';

// ─── Statut accident → variant badge ─────────────────────────────────────────

function accidentStatusVariant(s: string): 'danger' | 'warning' | 'info' | 'default' {
  if (s === 'OPEN')               return 'danger';
  if (s === 'UNDER_INVESTIGATION') return 'warning';
  if (s === 'LEGAL')              return 'info';
  return 'default';
}

function accidentStatusLabel(s: string): string {
  const labels: Record<string, string> = {
    OPEN:                'Ouvert',
    UNDER_INVESTIGATION: 'En cours',
    LEGAL:               'Juridique',
    SETTLED:             'Réglé',
    CLOSED:              'Clôturé',
  };
  return labels[s] ?? s;
}

// ─── Page principale ──────────────────────────────────────────────────────────

export function PageQhse() {
  const [tab, setTab] = useState<Tab>('accidents');

  // TODO: fetch API
  const loading    = false;
  const accidents: AccidentSummary[]    = [];
  const procedures: ProcedureSummary[]  = [];

  const openCount   = accidents.filter(a => a.status === 'OPEN').length;
  const injuredTotal = accidents.reduce((sum, a) => sum + a.injuryCount, 0);
  const disputeCount = accidents.filter(a => a.hasDispute).length;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'accidents',  label: "Rapports d'accidents" },
    { id: 'disputes',   label: 'Litiges' },
    { id: 'procedures', label: 'Procédures QHSE' },
    { id: 'config',     label: 'Configuration' },
  ];

  return (
    <main className="p-6 space-y-6" role="main" aria-label="QHSE — Accidents et procédures">
      {/* ── En-tête ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">QHSE &amp; Accidents</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Rapports d'accidents, suivi des litiges assureurs, procédures QHSE
          </p>
        </div>
        <Button variant="destructive" aria-label="Déclarer un accident">
          <Plus className="w-4 h-4 mr-2" aria-hidden />
          Déclarer accident
        </Button>
      </div>

      {/* ── KPIs ── */}
      <section aria-label="Indicateurs QHSE">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Accidents ouverts',  value: openCount,     icon: <AlertOctagon className="w-5 h-5" />, hl: openCount > 0 ? 'danger' : 'success' },
            { label: 'Blessés (total)',    value: injuredTotal,  icon: <Users className="w-5 h-5" />,        hl: injuredTotal > 0 ? 'warning' : 'success' },
            { label: 'Litiges en cours',   value: disputeCount,  icon: <Gavel className="w-5 h-5" />,        hl: disputeCount > 0 ? 'warning' : 'success' },
            { label: 'Procédures config.', value: procedures.length, icon: <ClipboardCheck className="w-5 h-5" />, hl: 'neutral' },
          ].map(({ label, value, icon, hl }) => (
            <article
              key={label}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-center gap-4"
              aria-label={`${label}: ${loading ? 'chargement' : value}`}
            >
              <div className={cn('p-3 rounded-lg shrink-0', {
                'bg-red-50 dark:bg-red-900/20 text-red-500':       hl === 'danger',
                'bg-amber-50 dark:bg-amber-900/20 text-amber-500': hl === 'warning',
                'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500': hl === 'success',
                'bg-slate-100 dark:bg-slate-800 text-slate-500':   hl === 'neutral',
              })} aria-hidden>
                {icon}
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
                {loading ? <Skeleton className="h-7 w-8 mt-1" /> : (
                  <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{value}</p>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ── Tabs ── */}
      <nav aria-label="Sections QHSE" role="tablist">
        <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`tabpanel-qhse-${t.id}`}
              id={`tab-qhse-${t.id}`}
              onClick={() => setTab(t.id)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                tab === t.id
                  ? 'border-teal-600 text-teal-600 dark:border-teal-400 dark:text-teal-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
              )}
            >
              {t.label}
              {t.id === 'accidents' && openCount > 0 && (
                <span
                  className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold"
                  aria-label={`${openCount} accidents ouverts`}
                >
                  {openCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* ── Panneau Accidents ── */}
      {tab === 'accidents' && (
        <section
          id="tabpanel-qhse-accidents"
          role="tabpanel"
          aria-labelledby="tab-qhse-accidents"
          aria-live="polite"
        >
          <Card>
            <CardHeader
              heading="Rapports d'accidents"
              description="Tous les incidents déclarés — filtrés par statut et période"
              action={
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" aria-label="Filtrer les accidents">Filtrer</Button>
                  <Button variant="ghost" size="sm" aria-label="Exporter les rapports">Exporter</Button>
                </div>
              }
            />
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6 space-y-3" aria-busy="true">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              ) : accidents.length === 0 ? (
                <div className="flex flex-col items-center py-16 text-slate-500 dark:text-slate-400" role="status">
                  <CheckCircle2 className="w-12 h-12 mb-3 text-emerald-500" aria-hidden />
                  <p className="font-medium">Aucun accident enregistré</p>
                  <p className="text-sm mt-1">Utilisez le bouton « Déclarer accident » en cas d'incident</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list" aria-label="Liste des accidents">
                  {accidents.map(acc => (
                    <li
                      key={acc.id}
                      className="px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4 min-w-0">
                          <div
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: acc.severityColor }}
                            aria-hidden
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-sm text-slate-900 dark:text-slate-100">
                                {acc.busPlate ?? 'Bus non précisé'}
                              </p>
                              <Badge variant={accidentStatusVariant(acc.status)} size="sm">
                                {accidentStatusLabel(acc.status)}
                              </Badge>
                              {acc.hasDispute && <Badge variant="info" size="sm">Litige ouvert</Badge>}
                            </div>
                            <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" aria-hidden />
                                {new Date(acc.occurredAt).toLocaleString('fr-FR')}
                              </span>
                              {acc.location && (
                                <span className="flex items-center gap-1">
                                  <MapPin className="w-3 h-3" aria-hidden />
                                  {acc.location}
                                </span>
                              )}
                              {acc.injuryCount > 0 && (
                                <span className="flex items-center gap-1 text-red-500">
                                  <Users className="w-3 h-3" aria-hidden />
                                  {acc.injuryCount} blessé(s)
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <button
                          className="shrink-0 p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                          aria-label={`Voir le détail de l'accident ${acc.id}`}
                        >
                          <ChevronRight className="w-4 h-4 text-slate-400" aria-hidden />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Panneau Litiges ── */}
      {tab === 'disputes' && (
        <section id="tabpanel-qhse-disputes" role="tabpanel" aria-labelledby="tab-qhse-disputes">
          <Card>
            <CardHeader
              heading="Suivi des litiges"
              description="Assurance vs gré-à-gré — frais et dédommagements"
            />
            <CardContent>
              {/* TODO: fetch depuis GET /qhse/accidents?hasDispute=true avec dispute inclus */}
              <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
                TODO — charger les litiges en cours depuis l'API
              </p>
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Panneau Procédures QHSE ── */}
      {tab === 'procedures' && (
        <section id="tabpanel-qhse-procedures" role="tabpanel" aria-labelledby="tab-qhse-procedures">
          <Card>
            <CardHeader
              heading="Procédures QHSE"
              description="Procédures pas-à-pas déclenchées automatiquement selon la sévérité de l'accident"
              action={
                <Button size="sm" aria-label="Créer une nouvelle procédure QHSE">
                  <Plus className="w-4 h-4 mr-1" aria-hidden /> Procédure
                </Button>
              }
            />
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6 space-y-3" aria-busy="true">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
                </div>
              ) : procedures.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 py-12 text-center">
                  Aucune procédure configurée — créez des procédures liées aux codes de sévérité
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
                  {procedures.map(p => (
                    <li key={p.id} className="flex items-center justify-between px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <div>
                        <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{p.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs font-mono text-slate-500">{p.triggerCode}</span>
                          <span className="text-xs text-slate-400">·</span>
                          <span className="text-xs text-slate-500">{p.stepCount} étapes</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant={p.isActive ? 'success' : 'default'} size="sm">
                          {p.isActive ? 'Actif' : 'Inactif'}
                        </Badge>
                        <button
                          className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                          aria-label={`Modifier la procédure ${p.name}`}
                        >
                          <ChevronRight className="w-4 h-4 text-slate-400" aria-hidden />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Panneau Configuration ── */}
      {tab === 'config' && (
        <section id="tabpanel-qhse-config" role="tabpanel" aria-labelledby="tab-qhse-config">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader
                heading="Types de sévérité"
                description="Léger, Lourd, Mortel — configurables par tenant"
                action={<Button size="sm" aria-label="Ajouter un type de sévérité"><Plus className="w-4 h-4 mr-1" />Type</Button>}
              />
              <CardContent>
                {/* TODO: fetch GET /qhse/severity-types */}
                <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">TODO — charger les types</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader
                heading="Hôpitaux référencés"
                description="Établissements hospitaliers pour suivi des blessés"
                action={<Button size="sm" aria-label="Ajouter un hôpital"><Plus className="w-4 h-4 mr-1" />Hôpital</Button>}
              />
              <CardContent>
                {/* TODO: fetch GET /qhse/hospitals */}
                <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">TODO — charger les hôpitaux</p>
              </CardContent>
            </Card>
          </div>
        </section>
      )}
    </main>
  );
}
