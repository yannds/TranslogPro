/**
 * PageFleetDocs — Documents réglementaires & consommables véhicules
 *
 * Module Fleet Docs : suivi des documents (assurance, carte grise, CT…)
 * et consommables (pneus, vidange…) avec alertes prédictives.
 *
 * TODO (données) :
 *   - GET /tenants/:tid/fleet-docs/documents/alerts      → docs expirés/expirant
 *   - GET /tenants/:tid/fleet-docs/buses/:busId/documents → docs par bus
 *   - GET /tenants/:tid/fleet-docs/buses/:busId/consumables → consommables par bus
 *   - GET /tenants/:tid/fleet-docs/document-types         → types de documents configurés
 *   - GET /tenants/:tid/fleet-docs/consumable-types        → types de consommables configurés
 *
 * Accessibilité : WCAG 2.1 AA — aria-labels, rôles, focus visible, contrast 4.5:1
 * Dark mode : classes Tailwind dark: — automatique via ThemeProvider
 */

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, FileText, Wrench, Plus } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';

// ─── Types provisoires (remplacer par les types générés depuis l'API) ──────────

interface DocAlertItem {
  id:          string;
  busPlate:    string;
  busModel:    string;
  typeName:    string;
  typeCode:    string;
  status:      'EXPIRED' | 'EXPIRING' | 'MISSING';
  expiresAt:   string | null;
  referenceNo: string | null;
}

interface ConsumableItem {
  id:             string;
  busPlate:       string;
  typeName:       string;
  typeCode:       string;
  status:         'OK' | 'ALERT' | 'OVERDUE';
  currentKm:      number;
  nextDueKm:      number | null;
  lastReplacedKm: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function docStatusVariant(s: string): 'danger' | 'warning' | 'default' {
  if (s === 'EXPIRED' || s === 'MISSING') return 'danger';
  if (s === 'EXPIRING') return 'warning';
  return 'default';
}

function docStatusLabel(s: string): string {
  if (s === 'EXPIRED')  return 'Expiré';
  if (s === 'EXPIRING') return 'Expire bientôt';
  if (s === 'MISSING')  return 'Manquant';
  return s;
}

function consumableVariant(s: string): 'danger' | 'warning' | 'success' {
  if (s === 'OVERDUE') return 'danger';
  if (s === 'ALERT')   return 'warning';
  return 'success';
}

function consumableLabel(s: string): string {
  if (s === 'OVERDUE') return 'Dépassé';
  if (s === 'ALERT')   return 'Alerte';
  return 'OK';
}

// ─── Composant statistiques rapides ──────────────────────────────────────────

interface StatCardProps {
  label:     string;
  value:     number | string;
  icon:      React.ReactNode;
  highlight?: 'danger' | 'warning' | 'success' | 'neutral';
  loading?:  boolean;
}

function StatCard({ label, value, icon, highlight = 'neutral', loading }: StatCardProps) {
  const colorMap = {
    danger:  'text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20',
    warning: 'text-amber-500 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20',
    success: 'text-emerald-500 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20',
    neutral: 'text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800',
  };

  return (
    <article
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-center gap-4"
      aria-label={`${label}: ${loading ? 'chargement' : value}`}
    >
      <div className={cn('p-3 rounded-lg shrink-0', colorMap[highlight])} aria-hidden>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wide">{label}</p>
        {loading
          ? <Skeleton className="h-7 w-16 mt-1" />
          : <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{value}</p>
        }
      </div>
    </article>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

type Tab = 'alerts' | 'consumables' | 'types';

// ─── Page principale ──────────────────────────────────────────────────────────

export function PageFleetDocs() {
  const [tab, setTab] = useState<Tab>('alerts');

  // TODO: remplacer par useSWR / React Query sur l'API fleet-docs
  const loading = false;

  // TODO: données depuis API
  const docAlerts: DocAlertItem[] = [];
  const consumables: ConsumableItem[] = [];

  const expiredCount  = docAlerts.filter(d => d.status === 'EXPIRED').length;
  const expiringCount = docAlerts.filter(d => d.status === 'EXPIRING').length;
  const missingCount  = docAlerts.filter(d => d.status === 'MISSING').length;
  const overdueCount  = consumables.filter(c => c.status === 'OVERDUE').length;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'alerts',      label: 'Documents en alerte' },
    { id: 'consumables', label: 'Consommables' },
    { id: 'types',       label: 'Configuration' },
  ];

  return (
    <main className="p-6 space-y-6" role="main" aria-label="Documents réglementaires véhicules">
      {/* ── En-tête ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Documents &amp; Consommables
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Suivi réglementaire et maintenance prédictive de la flotte
          </p>
        </div>
        <Button aria-label="Ajouter un document véhicule">
          <Plus className="w-4 h-4 mr-2" aria-hidden />
          Nouveau document
        </Button>
      </div>

      {/* ── KPIs ── */}
      <section aria-label="Indicateurs clés documents">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Expirés"
            value={expiredCount}
            icon={<AlertTriangle className="w-5 h-5" aria-hidden />}
            highlight="danger"
            loading={loading}
          />
          <StatCard
            label="Expirent bientôt"
            value={expiringCount}
            icon={<Clock className="w-5 h-5" aria-hidden />}
            highlight="warning"
            loading={loading}
          />
          <StatCard
            label="Manquants"
            value={missingCount}
            icon={<FileText className="w-5 h-5" aria-hidden />}
            highlight="danger"
            loading={loading}
          />
          <StatCard
            label="Consommables dépassés"
            value={overdueCount}
            icon={<Wrench className="w-5 h-5" aria-hidden />}
            highlight={overdueCount > 0 ? 'danger' : 'success'}
            loading={loading}
          />
        </div>
      </section>

      {/* ── Tabs ── */}
      <nav aria-label="Sections documents" role="tablist">
        <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
          {tabs.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`tabpanel-${t.id}`}
              id={`tab-${t.id}`}
              onClick={() => setTab(t.id)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                tab === t.id
                  ? 'border-teal-600 text-teal-600 dark:border-teal-400 dark:text-teal-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {/* ── Panneau Documents en alerte ── */}
      {tab === 'alerts' && (
        <section
          id="tabpanel-alerts"
          role="tabpanel"
          aria-labelledby="tab-alerts"
          aria-live="polite"
        >
          <Card>
            <CardHeader
              heading="Documents en alerte"
              description="Documents expirés, expirant sous 30 jours ou manquants"
              action={
                <Button variant="ghost" size="sm" aria-label="Exporter la liste des alertes documents">
                  Exporter
                </Button>
              }
            />
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6 space-y-3" aria-busy="true" aria-label="Chargement des alertes">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : docAlerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-500 dark:text-slate-400" role="status">
                  <CheckCircle2 className="w-12 h-12 mb-3 text-emerald-500" aria-hidden />
                  <p className="font-medium">Tous les documents sont à jour</p>
                  <p className="text-sm mt-1">Aucune alerte documentaire active</p>
                </div>
              ) : (
                <div role="table" aria-label="Liste des documents en alerte">
                  <div role="rowgroup">
                    <div
                      role="row"
                      className="grid grid-cols-5 px-6 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50"
                    >
                      <div role="columnheader">Bus</div>
                      <div role="columnheader">Type de document</div>
                      <div role="columnheader">Référence</div>
                      <div role="columnheader">Expiration</div>
                      <div role="columnheader">Statut</div>
                    </div>
                  </div>
                  <div role="rowgroup">
                    {docAlerts.map(doc => (
                      <div
                        key={doc.id}
                        role="row"
                        className="grid grid-cols-5 px-6 py-3 items-center border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        <div role="cell">
                          <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{doc.busPlate}</p>
                          <p className="text-xs text-slate-500">{doc.busModel}</p>
                        </div>
                        <div role="cell" className="text-sm text-slate-700 dark:text-slate-300">{doc.typeName}</div>
                        <div role="cell" className="text-sm font-mono text-slate-500">{doc.referenceNo ?? '—'}</div>
                        <div role="cell" className="text-sm tabular-nums text-slate-700 dark:text-slate-300">
                          {doc.expiresAt ? new Date(doc.expiresAt).toLocaleDateString('fr-FR') : '—'}
                        </div>
                        <div role="cell">
                          <Badge variant={docStatusVariant(doc.status)}>{docStatusLabel(doc.status)}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Panneau Consommables ── */}
      {tab === 'consumables' && (
        <section
          id="tabpanel-consumables"
          role="tabpanel"
          aria-labelledby="tab-consumables"
          aria-live="polite"
        >
          <Card>
            <CardHeader
              heading="Suivi consommables"
              description="Pneus, vidange, filtres — alertes basées sur le kilométrage réel"
              action={
                <Button size="sm" aria-label="Enregistrer un remplacement de consommable">
                  <Plus className="w-4 h-4 mr-1" aria-hidden />
                  Remplacement
                </Button>
              }
            />
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6 space-y-3" aria-busy="true">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : consumables.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-500 dark:text-slate-400" role="status">
                  <CheckCircle2 className="w-12 h-12 mb-3 text-emerald-500" aria-hidden />
                  <p className="font-medium">Aucun consommable en alerte</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list" aria-label="Consommables véhicules">
                  {consumables.map(c => {
                    const progress = c.lastReplacedKm !== null && c.nextDueKm
                      ? Math.min(100, Math.round(((c.currentKm - c.lastReplacedKm) / (c.nextDueKm - c.lastReplacedKm)) * 100))
                      : 0;
                    return (
                      <li key={c.id} className="px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        <div className="flex items-center justify-between gap-4 mb-2">
                          <div>
                            <span className="font-medium text-sm text-slate-900 dark:text-slate-100">{c.busPlate}</span>
                            <span className="mx-2 text-slate-400">·</span>
                            <span className="text-sm text-slate-600 dark:text-slate-400">{c.typeName}</span>
                          </div>
                          <Badge variant={consumableVariant(c.status)}>{consumableLabel(c.status)}</Badge>
                        </div>
                        <div className="flex items-center gap-3">
                          <div
                            className="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden"
                            role="progressbar"
                            aria-valuenow={progress}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`Usure ${c.typeName}: ${progress}%`}
                          >
                            <div
                              className={cn(
                                'h-full rounded-full transition-all',
                                progress >= 100 ? 'bg-red-500' :
                                progress >= 80  ? 'bg-amber-500' :
                                'bg-emerald-500',
                              )}
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <span className="text-xs tabular-nums text-slate-500 shrink-0">
                            {c.currentKm.toLocaleString()} / {c.nextDueKm?.toLocaleString() ?? '?'} km
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Panneau Configuration ── */}
      {tab === 'types' && (
        <section
          id="tabpanel-types"
          role="tabpanel"
          aria-labelledby="tab-types"
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader
                heading="Types de documents"
                description="Catalogue réglementaire configuré pour ce tenant"
                action={
                  <Button size="sm" aria-label="Créer un nouveau type de document">
                    <Plus className="w-4 h-4 mr-1" aria-hidden /> Ajouter
                  </Button>
                }
              />
              <CardContent>
                {/* TODO: liste des VehicleDocumentType depuis GET /fleet-docs/document-types */}
                <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">
                  TODO — charger depuis l'API
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader
                heading="Types de consommables"
                description="Pneus, vidange, filtres avec seuils kilométriques"
                action={
                  <Button size="sm" aria-label="Créer un nouveau type de consommable">
                    <Plus className="w-4 h-4 mr-1" aria-hidden /> Ajouter
                  </Button>
                }
              />
              <CardContent>
                {/* TODO: liste des ConsumableType depuis GET /fleet-docs/consumable-types */}
                <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">
                  TODO — charger depuis l'API
                </p>
              </CardContent>
            </Card>
          </div>
        </section>
      )}
    </main>
  );
}
