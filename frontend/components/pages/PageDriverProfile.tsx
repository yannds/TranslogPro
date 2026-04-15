/**
 * PageDriverProfile — Dossier chauffeur, temps de repos, formations, remédiation
 *
 * Module Driver & HR : suivi complet du personnel de conduite.
 *
 * Accessibilité : WCAG 2.1 AA
 * Dark mode : Tailwind dark:
 */

import { useState, type FormEvent } from 'react';
import {
  UserCheck, AlertTriangle, Plus,
  ChevronRight, Shield, Coffee, GraduationCap,
} from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPost } from '../../lib/api';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { ErrorAlert } from '../ui/ErrorAlert';
import { FormFooter } from '../ui/FormFooter';
import { inputClass } from '../ui/inputClass';
import { cn } from '../../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LicenseAlert {
  id:          string;
  staffId:     string;
  staffName:   string;
  licenseNo:   string;
  category:    string;
  expiresAt:   string;
  daysUntilExpiry: number;
}

interface DriverSummary {
  id:     string;
  userId: string;
  user:   { email: string; displayName?: string | null };
  isAvailable: boolean;
}

interface OverdueTraining {
  id:         string;
  staffId:    string;
  staffName:  string;
  typeName:   string;
  scheduledAt: string;
}

interface RemediationRule {
  id:                  string;
  actionType:          string;
  crmScoreThreshold:   number;
  isActive:            boolean;
}

interface RestConfig {
  minRestMinutes:             number;
  maxDrivingMinutesPerDay:    number;
  maxDrivingMinutesPerWeek:   number;
  alertBeforeEndRestMin:      number;
}

type Tab = 'overview' | 'licenses' | 'rest' | 'trainings' | 'remediation';

export interface PageDriverProfileProps {
  /** Onglet initial piloté par la navigation (drivers-list → 'overview', driver-licenses → 'licenses', etc.) */
  initialTab?: Tab;
}

// ─── Formulaire : créer un permis ────────────────────────────────────────────

interface LicenseValues {
  staffId: string; category: string; licenseNo: string;
  issuedAt: string; expiresAt: string; issuingState: string;
}

function LicenseForm({
  drivers, onSubmit, onCancel, busy, error,
}: {
  drivers: DriverSummary[];
  onSubmit: (v: LicenseValues) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [f, setF] = useState<LicenseValues>({
    staffId: drivers[0]?.id ?? '', category: 'D',
    licenseNo: '', issuedAt: '', expiresAt: '', issuingState: '',
  });
  return (
    <form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}>
      <ErrorAlert error={error} />
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <label htmlFor="lic-staff" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Chauffeur <span aria-hidden className="text-red-500">*</span>
          </label>
          <select id="lic-staff" required value={f.staffId} onChange={e => setF(p => ({ ...p, staffId: e.target.value }))}
            className={inputClass} disabled={busy || drivers.length === 0}>
            {drivers.length === 0 && <option value="">Aucun chauffeur</option>}
            {drivers.map(d => (
              <option key={d.id} value={d.id}>
                {d.user.displayName ?? d.user.email}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="lic-cat" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Catégorie <span aria-hidden className="text-red-500">*</span>
          </label>
          <input id="lic-cat" type="text" required value={f.category}
            onChange={e => setF(p => ({ ...p, category: e.target.value.toUpperCase() }))}
            className={inputClass} disabled={busy} placeholder="D" maxLength={8} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="lic-no" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            N° de permis <span aria-hidden className="text-red-500">*</span>
          </label>
          <input id="lic-no" type="text" required value={f.licenseNo}
            onChange={e => setF(p => ({ ...p, licenseNo: e.target.value }))}
            className={cn(inputClass, 'font-mono')} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="lic-issued" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Émis le <span aria-hidden className="text-red-500">*</span>
          </label>
          <input id="lic-issued" type="date" required value={f.issuedAt}
            onChange={e => setF(p => ({ ...p, issuedAt: e.target.value }))}
            className={inputClass} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="lic-expires" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Expire le <span aria-hidden className="text-red-500">*</span>
          </label>
          <input id="lic-expires" type="date" required value={f.expiresAt}
            onChange={e => setF(p => ({ ...p, expiresAt: e.target.value }))}
            className={inputClass} disabled={busy} />
        </div>
        <div className="col-span-2 space-y-1.5">
          <label htmlFor="lic-state" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Pays / État émetteur
          </label>
          <input id="lic-state" type="text" value={f.issuingState}
            onChange={e => setF(p => ({ ...p, issuingState: e.target.value }))}
            className={inputClass} disabled={busy} placeholder="CG" />
        </div>
      </div>
      <FormFooter onCancel={onCancel} busy={busy} submitLabel="Enregistrer" pendingLabel="Enregistrement…" />
    </form>
  );
}

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

export function PageDriverProfile({ initialTab = 'overview' }: PageDriverProfileProps = {}) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const [tab, setTab]         = useState<Tab>(initialTab);
  const [_selectedDriver, setSelectedDriver] = useState<string | null>(null);

  const [showLicenseForm, setShowLicenseForm] = useState(false);
  const [busy,            setBusy]            = useState(false);
  const [actionError,     setActionError]     = useState<string | null>(null);

  const base = `/api/tenants/${tenantId}`;

  const { data: drivers,     loading: loadingDrivers }    = useFetch<DriverSummary[]>(`${base}/staff?role=DRIVER`, [tenantId]);
  const { data: licAlerts,   loading: loadingLic, refetch: refetchLic } = useFetch<LicenseAlert[]>(`${base}/driver-profile/licenses/alerts`, [tenantId]);
  const { data: overdueTrainings, loading: loadingTrainings } = useFetch<OverdueTraining[]>(`${base}/driver-profile/trainings/overdue`, [tenantId]);
  const { data: restConfig,  loading: loadingRest }       = useFetch<RestConfig>(`${base}/driver-profile/rest-config`, [tenantId]);
  const { data: remediations, loading: loadingRemediation } = useFetch<RemediationRule[]>(
    tab === 'remediation' ? `${base}/driver-profile/remediation-rules` : null,
    [tenantId, tab],
  );

  const loading = loadingDrivers || loadingLic;

  const licenseAlertCount    = licAlerts?.length    ?? 0;
  const overdueTrainingCount = overdueTrainings?.length ?? 0;
  const remediationCount     = remediations?.length ?? 0;
  const restBlockedCount     = 0; // requires per-driver rest-compliance calls

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
        <Button
          onClick={() => { setShowLicenseForm(true); setActionError(null); }}
          aria-label="Enregistrer un nouveau permis"
        >
          <Plus className="w-4 h-4 mr-2" aria-hidden /> Nouveau permis
        </Button>
      </div>

      {/* ── KPIs ── */}
      <section aria-label="Indicateurs chauffeurs">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Permis en alerte"      value={licenseAlertCount}    icon={<Shield className="w-5 h-5" />}         highlight={licenseAlertCount > 0 ? 'danger' : 'success'} loading={loadingLic} />
          <KpiCard label="Chauffeurs bloqués"    value={restBlockedCount}     icon={<Coffee className="w-5 h-5" />}         highlight={restBlockedCount > 0 ? 'warning' : 'success'} loading={false} />
          <KpiCard label="Actions remédiation"   value={remediationCount}     icon={<AlertTriangle className="w-5 h-5" />}  highlight={remediationCount > 0 ? 'danger' : 'success'} loading={loadingRemediation} />
          <KpiCard label="Formations en retard"  value={overdueTrainingCount} icon={<GraduationCap className="w-5 h-5" />} highlight={overdueTrainingCount > 0 ? 'warning' : 'success'} loading={loadingTrainings} />
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

      {/* ── Vue d'ensemble ── */}
      {tab === 'overview' && (
        <section id="tabpanel-driver-overview" role="tabpanel" aria-labelledby="tab-driver-overview">
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
              ) : !drivers || drivers.length === 0 ? (
                <div className="py-16 text-center text-slate-500 dark:text-slate-400" role="status">
                  <UserCheck className="w-12 h-12 mx-auto mb-3 text-slate-300 dark:text-slate-600" aria-hidden />
                  <p className="font-medium">Aucun chauffeur enregistré</p>
                  <p className="text-sm mt-1">Ajoutez des chauffeurs via le module Personnel</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
                  {drivers.map(d => {
                    const name = d.user.displayName ?? d.user.email;
                    const hasLicAlert = licAlerts?.some(a => a.staffId === d.id) ?? false;
                    return (
                      <li key={d.id}>
                        <button
                          className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
                          onClick={() => setSelectedDriver(d.id)}
                          aria-label={`Ouvrir le dossier de ${name}`}
                        >
                          <div className="flex items-center gap-4">
                            <div
                              className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-sm font-bold text-slate-700 dark:text-slate-300"
                              aria-hidden
                            >
                              {name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{name}</p>
                              <div className="flex gap-2 mt-0.5">
                                {hasLicAlert && <Badge variant="danger" size="sm">Permis expiré</Badge>}
                                {!d.isAvailable && <Badge variant="warning" size="sm">En repos</Badge>}
                                {!hasLicAlert && d.isAvailable && (
                                  <Badge variant="success" size="sm">Conforme</Badge>
                                )}
                              </div>
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Permis ── */}
      {tab === 'licenses' && (
        <section id="tabpanel-driver-licenses" role="tabpanel" aria-labelledby="tab-driver-licenses">
          <Card>
            <CardHeader
              heading="Alertes permis"
              description="Permis expirant dans les 30 prochains jours ou déjà expirés"
              action={
                <Button
                  size="sm"
                  onClick={() => { setShowLicenseForm(true); setActionError(null); }}
                  aria-label="Enregistrer un permis de conduire"
                >
                  <Plus className="w-4 h-4 mr-1" aria-hidden /> Permis
                </Button>
              }
            />
            <CardContent className="p-0">
              {loadingLic ? (
                <div className="p-6 space-y-3" aria-busy="true">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : !licAlerts || licAlerts.length === 0 ? (
                <div className="py-12 text-center text-slate-500 dark:text-slate-400" role="status">
                  <Shield className="w-10 h-10 mx-auto mb-2 text-emerald-400" aria-hidden />
                  <p className="font-medium">Aucune alerte permis active</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
                  {licAlerts.map(a => (
                    <li key={a.id} className="flex items-center justify-between px-6 py-3">
                      <div>
                        <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{a.staffName}</p>
                        <p className="text-xs text-slate-500 font-mono">{a.licenseNo} · Cat. {a.category}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs tabular-nums text-slate-500">
                          {a.expiresAt ? new Date(a.expiresAt).toLocaleDateString('fr-FR') : '—'}
                        </span>
                        <Badge variant={a.daysUntilExpiry <= 0 ? 'danger' : 'warning'} size="sm">
                          {a.daysUntilExpiry <= 0 ? 'Expiré' : `J-${a.daysUntilExpiry}`}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Repos ── */}
      {tab === 'rest' && (
        <section id="tabpanel-driver-rest" role="tabpanel" aria-labelledby="tab-driver-rest">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader
                heading="Configuration repos"
                description="Seuils minimaux par tenant (11h défaut, configurable)"
              />
              <CardContent>
                {loadingRest ? (
                  <div className="space-y-3" aria-busy="true">
                    {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                  </div>
                ) : restConfig ? (
                  <dl className="space-y-3 text-sm">
                    {[
                      { label: 'Repos minimum',         value: `${restConfig.minRestMinutes} min` },
                      { label: 'Conduite max/jour',      value: `${restConfig.maxDrivingMinutesPerDay} min` },
                      { label: 'Conduite max/sem.',      value: `${restConfig.maxDrivingMinutesPerWeek} min` },
                      { label: 'Alerte avant fin repos', value: `${restConfig.alertBeforeEndRestMin} min` },
                    ].map(item => (
                      <div key={item.label} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
                        <dt className="text-slate-600 dark:text-slate-400">{item.label}</dt>
                        <dd className="font-medium text-slate-900 dark:text-slate-100 tabular-nums">{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">
                    Aucune configuration de repos définie
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader
                heading="Chauffeurs disponibles"
                description="Statut de disponibilité actuel"
              />
              <CardContent className="p-0">
                {loadingDrivers ? (
                  <div className="p-6 space-y-3" aria-busy="true">
                    {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : !drivers || drivers.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">Aucun chauffeur</p>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
                    {drivers.map(d => (
                      <li key={d.id} className="flex items-center justify-between px-4 py-3">
                        <span className="text-sm text-slate-800 dark:text-slate-200">
                          {d.user.displayName ?? d.user.email}
                        </span>
                        <Badge variant={d.isAvailable ? 'success' : 'warning'} size="sm">
                          {d.isAvailable ? 'Disponible' : 'En repos'}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* ── Formations ── */}
      {tab === 'trainings' && (
        <section id="tabpanel-driver-trainings" role="tabpanel" aria-labelledby="tab-driver-trainings">
          <Card>
            <CardHeader
              heading="Formations en retard"
              description="Formations planifiées dont la date est dépassée"
            />
            <CardContent className="p-0">
              {loadingTrainings ? (
                <div className="p-6 space-y-3" aria-busy="true">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : !overdueTrainings || overdueTrainings.length === 0 ? (
                <div className="py-12 text-center text-slate-500 dark:text-slate-400" role="status">
                  <GraduationCap className="w-10 h-10 mx-auto mb-2 text-emerald-400" aria-hidden />
                  <p className="font-medium">Toutes les formations sont à jour</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
                  {overdueTrainings.map(t => (
                    <li key={t.id} className="flex items-center justify-between px-6 py-3">
                      <div>
                        <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{t.staffName}</p>
                        <p className="text-xs text-slate-500">{t.typeName}</p>
                      </div>
                      <Badge variant="warning" size="sm">
                        {new Date(t.scheduledAt).toLocaleDateString('fr-FR')}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Modal : Nouveau permis ── */}
      <Dialog
        open={showLicenseForm}
        onOpenChange={o => { if (!o) setShowLicenseForm(false); }}
        title="Nouveau permis de conduire"
        description="Les alertes se déclenchent 30 jours avant l'expiration."
        size="lg"
      >
        {showLicenseForm && (
          <LicenseForm
            drivers={drivers ?? []}
            busy={busy}
            error={actionError}
            onCancel={() => setShowLicenseForm(false)}
            onSubmit={async (v: LicenseValues) => {
              setBusy(true); setActionError(null);
              try {
                await apiPost(`${base}/driver-profile/licenses`, {
                  staffId:      v.staffId,
                  category:     v.category,
                  licenseNo:    v.licenseNo,
                  issuedAt:     v.issuedAt,
                  expiresAt:    v.expiresAt,
                  issuingState: v.issuingState || undefined,
                });
                setShowLicenseForm(false);
                refetchLic();
              } catch (e) {
                setActionError(e instanceof Error ? e.message : 'Erreur inconnue');
              } finally { setBusy(false); }
            }}
          />
        )}
      </Dialog>

      {/* ── Remédiation ── */}
      {tab === 'remediation' && (
        <section id="tabpanel-driver-remediation" role="tabpanel" aria-labelledby="tab-driver-remediation">
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
            <CardContent className="p-0">
              {loadingRemediation ? (
                <div className="p-6 space-y-3" aria-busy="true">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : !remediations || remediations.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
                  Aucune règle de remédiation configurée
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
                  {remediations.map(r => (
                    <li key={r.id} className="flex items-center justify-between px-6 py-3">
                      <div>
                        <p className="font-medium text-sm text-slate-900 dark:text-slate-100">
                          {r.actionType}
                        </p>
                        <p className="text-xs text-slate-500 font-mono">
                          Seuil CRM: {r.crmScoreThreshold}
                        </p>
                      </div>
                      <Badge variant={r.isActive ? 'success' : 'default'} size="sm">
                        {r.isActive ? 'Actif' : 'Inactif'}
                      </Badge>
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
