/**
 * PageDriverProfile — Dossier chauffeur, temps de repos, formations, remédiation
 *
 * Module Driver & HR : suivi complet du personnel de conduite.
 *
 * TODO (données) :
 *   - GET /tenants/:tid/driver-profile/licenses/alerts             → permis expirants
 *   - GET /tenants/:tid/driver-profile/trainings/overdue           → formations en retard
 *   - GET /tenants/:tid/driver-profile/drivers/:id/rest-compliance → statut repos
 *   - GET /tenants/:tid/driver-profile/drivers/:id/remediation/actions
 *   - GET /tenants/:tid/driver-profile/drivers/:id/licenses
 *   - GET /tenants/:tid/driver-profile/drivers/:id/trainings
 *   - GET /tenants/:tid/driver-profile/rest-config                 → config repos tenant
 *
 * Accessibilité : WCAG 2.1 AA
 * Dark mode : Tailwind dark:
 */

import { useState } from 'react';
import {
  UserCheck, Clock, BookOpen, AlertTriangle, Plus,
  ChevronRight, Shield, Coffee, GraduationCap,
} from 'lucide-react';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';

// ─── Types provisoires ────────────────────────────────────────────────────────

interface DriverSummary {
  id:           string;
  name:         string;
  licenseValid: boolean;
  restOk:       boolean;
  remediationPending: boolean;
  trainingOverdue: boolean;
}

type Tab = 'overview' | 'licenses' | 'rest' | 'trainings' | 'remediation';

// ─── Stat Card ────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, icon, highlight = 'neutral', loading,
}: {
  label: string; value: number | string; icon: React.ReactNode;
  highlight?: 'danger' | 'warning' | 'success' | 'neutral'; loading?: boolean;
}) {
  const colors = {
    danger:  'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400',
    warning: 'bg-amber-50 dark:bg-amber-900/20 text-amber-500 dark:text-amber-400',
    success: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500 dark:text-emerald-400',
    neutral: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
  };
  return (
    <article
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-center gap-4"
      aria-label={`${label}: ${loading ? 'chargement' : value}`}
    >
      <div className={cn('p-3 rounded-lg shrink-0', colors[highlight])} aria-hidden>{icon}</div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        {loading
          ? <Skeleton className="h-7 w-12 mt-1" />
          : <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{value}</p>
        }
      </div>
    </article>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export function PageDriverProfile() {
  const [tab, setTab]             = useState<Tab>('overview');
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);

  // TODO: fetch depuis l'API
  const loading       = false;
  const drivers: DriverSummary[] = [];

  const licenseAlertCount     = drivers.filter(d => !d.licenseValid).length;
  const restBlockedCount      = drivers.filter(d => !d.restOk).length;
  const remediationCount      = drivers.filter(d => d.remediationPending).length;
  const overdueTrainingCount  = drivers.filter(d => d.trainingOverdue).length;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview',    label: "Vue d'ensemble" },
    { id: 'licenses',    label: 'Permis' },
    { id: 'rest',        label: 'Temps de repos' },
    { id: 'trainings',   label: 'Formations' },
    { id: 'remediation', label: 'Remédiation' },
  ];

  return (
    <main className="p-6 space-y-6" role="main" aria-label="Dossiers chauffeurs">
      {/* ── En-tête ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dossiers Chauffeurs</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Permis, repos réglementaires, formations et remédiation CRM
          </p>
        </div>
        <Button aria-label="Enregistrer un nouveau permis">
          <Plus className="w-4 h-4 mr-2" aria-hidden /> Nouveau permis
        </Button>
      </div>

      {/* ── KPIs ── */}
      <section aria-label="Indicateurs chauffeurs">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Permis en alerte"      value={licenseAlertCount}    icon={<Shield className="w-5 h-5" />}         highlight={licenseAlertCount > 0 ? 'danger' : 'success'} loading={loading} />
          <KpiCard label="Chauffeurs bloqués"    value={restBlockedCount}     icon={<Coffee className="w-5 h-5" />}         highlight={restBlockedCount > 0 ? 'warning' : 'success'} loading={loading} />
          <KpiCard label="Actions remédiation"   value={remediationCount}     icon={<AlertTriangle className="w-5 h-5" />}  highlight={remediationCount > 0 ? 'danger' : 'success'} loading={loading} />
          <KpiCard label="Formations en retard"  value={overdueTrainingCount} icon={<GraduationCap className="w-5 h-5" />} highlight={overdueTrainingCount > 0 ? 'warning' : 'success'} loading={loading} />
        </div>
      </section>

      {/* ── Tabs ── */}
      <nav aria-label="Sections dossiers chauffeurs" role="tablist">
        <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`tabpanel-driver-${t.id}`}
              id={`tab-driver-${t.id}`}
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
            </button>
          ))}
        </div>
      </nav>

      {/* ── Panneau Vue d'ensemble ── */}
      {tab === 'overview' && (
        <section
          id="tabpanel-driver-overview"
          role="tabpanel"
          aria-labelledby="tab-driver-overview"
        >
          <Card>
            <CardHeader
              heading="Liste des chauffeurs"
              description="Statut global par chauffeur — cliquer pour accéder au dossier complet"
            />
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6 space-y-3" aria-busy="true">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
                </div>
              ) : drivers.length === 0 ? (
                <div className="py-16 text-center text-slate-500 dark:text-slate-400" role="status">
                  {/* TODO: afficher la vraie liste depuis GET /staff?role=DRIVER */}
                  <UserCheck className="w-12 h-12 mx-auto mb-3 text-slate-300 dark:text-slate-600" aria-hidden />
                  <p className="font-medium">Aucun chauffeur enregistré</p>
                  <p className="text-sm mt-1">Ajoutez des chauffeurs via le module Personnel</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
                  {drivers.map(d => (
                    <li key={d.id}>
                      <button
                        className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
                        onClick={() => setSelectedDriver(d.id)}
                        aria-label={`Ouvrir le dossier de ${d.name}`}
                      >
                        <div className="flex items-center gap-4">
                          <div
                            className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-sm font-bold text-slate-700 dark:text-slate-300"
                            aria-hidden
                          >
                            {d.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{d.name}</p>
                            <div className="flex gap-2 mt-0.5">
                              {!d.licenseValid    && <Badge variant="danger"  size="sm">Permis expiré</Badge>}
                              {!d.restOk          && <Badge variant="warning" size="sm">En repos</Badge>}
                              {d.remediationPending && <Badge variant="danger" size="sm">Remédiation</Badge>}
                              {d.trainingOverdue  && <Badge variant="warning" size="sm">Formation due</Badge>}
                              {d.licenseValid && d.restOk && !d.remediationPending && !d.trainingOverdue && (
                                <Badge variant="success" size="sm">Conforme</Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Panneau Permis ── */}
      {tab === 'licenses' && (
        <section id="tabpanel-driver-licenses" role="tabpanel" aria-labelledby="tab-driver-licenses">
          <Card>
            <CardHeader
              heading="Alertes permis"
              description="Permis expirant dans les 30 prochains jours ou déjà expirés"
              action={
                <Button size="sm" aria-label="Enregistrer un permis de conduire">
                  <Plus className="w-4 h-4 mr-1" aria-hidden /> Permis
                </Button>
              }
            />
            <CardContent>
              {/* TODO: fetch depuis GET /driver-profile/licenses/alerts */}
              <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
                TODO — charger les alertes permis depuis l'API
              </p>
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Panneau Repos ── */}
      {tab === 'rest' && (
        <section id="tabpanel-driver-rest" role="tabpanel" aria-labelledby="tab-driver-rest">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader
                heading="Configuration repos"
                description="Seuils minimaux par tenant (11h défaut, configurable)"
                action={
                  <Button variant="ghost" size="sm" aria-label="Modifier la configuration de repos">
                    Modifier
                  </Button>
                }
              />
              <CardContent>
                {/* TODO: fetch depuis GET /driver-profile/rest-config */}
                <dl className="space-y-3 text-sm">
                  {[
                    { label: 'Repos minimum',     key: 'minRestMinutes',          unit: 'min', todo: true },
                    { label: 'Conduite max/jour',  key: 'maxDrivingMinutesPerDay', unit: 'min', todo: true },
                    { label: 'Conduite max/sem.',  key: 'maxDrivingMinutesPerWeek',unit: 'min', todo: true },
                  ].map(item => (
                    <div key={item.key} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
                      <dt className="text-slate-600 dark:text-slate-400">{item.label}</dt>
                      <dd className="font-medium text-slate-900 dark:text-slate-100 tabular-nums">
                        {item.todo ? <Skeleton className="h-4 w-16 inline-block" /> : `— ${item.unit}`}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader
                heading="Chauffeurs en repos"
                description="Périodes de repos actives (endedAt null)"
              />
              <CardContent>
                {/* TODO: fetch depuis GET /driver-profile/drivers/:id/rest-compliance pour chaque chauffeur */}
                <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
                  TODO — charger les périodes actives
                </p>
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* ── Panneau Formations ── */}
      {tab === 'trainings' && (
        <section id="tabpanel-driver-trainings" role="tabpanel" aria-labelledby="tab-driver-trainings">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader
                heading="Formations en retard"
                description="Formations planifiées dont la date est dépassée"
              />
              <CardContent>
                {/* TODO: fetch depuis GET /driver-profile/trainings/overdue */}
                <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
                  TODO — charger les formations overdue
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader
                heading="Catalogue formations"
                description="Types de formations obligatoires"
                action={
                  <Button size="sm" aria-label="Créer un type de formation">
                    <Plus className="w-4 h-4 mr-1" aria-hidden /> Type
                  </Button>
                }
              />
              <CardContent>
                {/* TODO: fetch depuis GET /driver-profile/training-types */}
                <ul className="space-y-2 text-sm" aria-label="Types de formation">
                  <li className="text-slate-500 dark:text-slate-400 py-4 text-center">
                    TODO — charger les types de formation
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* ── Panneau Remédiation ── */}
      {tab === 'remediation' && (
        <section id="tabpanel-driver-remediation" role="tabpanel" aria-labelledby="tab-driver-remediation">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader
                heading="Actions de remédiation en cours"
                description="Déclenchées automatiquement quand le score CRM passe sous le seuil"
              />
              <CardContent>
                {/* TODO: fetch depuis GET /driver-profile/drivers/:id/remediation/actions */}
                <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
                  TODO — charger les actions de remédiation actives
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader
                heading="Règles de remédiation"
                description="Seuils CRM → actions configurées pour ce tenant"
                action={
                  <Button size="sm" aria-label="Créer une règle de remédiation">
                    <Plus className="w-4 h-4 mr-1" aria-hidden /> Règle
                  </Button>
                }
              />
              <CardContent>
                {/* TODO: fetch depuis GET /driver-profile/remediation-rules */}
                <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">
                  TODO — charger les règles
                </p>
              </CardContent>
            </Card>
          </div>
        </section>
      )}
    </main>
  );
}
