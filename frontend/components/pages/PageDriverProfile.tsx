/**
 * PageDriverProfile — Dossier chauffeur, temps de repos, formations, remédiation
 *
 * Module Driver & HR : suivi complet du personnel de conduite.
 *
 * Accessibilité : WCAG 2.1 AA
 * Dark mode : Tailwind dark:
 */

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UserCheck, AlertTriangle, Plus, Settings, Pencil, Trash2, CheckCircle2,
  ChevronRight, Shield, Coffee, GraduationCap, Mail,
} from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPost, apiPatch, apiDelete } from '../../lib/api';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { ErrorAlert } from '../ui/ErrorAlert';
import { FormFooter } from '../ui/FormFooter';
import { inputClass } from '../ui/inputClass';
import { cn } from '../../lib/utils';
import { DocumentAttachments } from '../document/DocumentAttachments';

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

interface LicenseRow {
  id:           string;
  staffId:      string;
  category:     string;
  licenseNo:    string;
  issuedAt:     string;
  expiresAt:    string;
  issuingState?: string | null;
  status:       string;
  staff:        { user: { email: string; name?: string | null } };
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
  name?:               string;
  actionType:          string;
  scoreBelowThreshold: number;
  isActive:            boolean;
}

interface TrainingType {
  id:   string;
  name: string;
  code: string;
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
  drivers, initial, onSubmit, onCancel, busy, error,
}: {
  drivers: DriverSummary[];
  initial?: Partial<LicenseValues>;
  onSubmit: (v: LicenseValues) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<LicenseValues>({
    staffId: initial?.staffId     ?? drivers[0]?.id ?? '',
    category: initial?.category   ?? 'D',
    licenseNo: initial?.licenseNo ?? '',
    issuedAt: initial?.issuedAt   ?? '',
    expiresAt: initial?.expiresAt ?? '',
    issuingState: initial?.issuingState ?? '',
  });
  return (
    <form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}>
      <ErrorAlert error={error} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2 space-y-1.5">
          <label htmlFor="lic-staff" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('driverProfile.driver')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <select id="lic-staff" required value={f.staffId} onChange={e => setF(p => ({ ...p, staffId: e.target.value }))}
            className={inputClass} disabled={busy || drivers.length === 0}>
            {drivers.length === 0 && <option value="">{t('driverProfile.noDriver')}</option>}
            {drivers.map(d => (
              <option key={d.id} value={d.id}>
                {d.user.displayName ?? d.user.email}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="lic-cat" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('driverProfile.category')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input id="lic-cat" type="text" required value={f.category}
            onChange={e => setF(p => ({ ...p, category: e.target.value.toUpperCase() }))}
            className={inputClass} disabled={busy} placeholder="D" maxLength={8} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="lic-no" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('driverProfile.licenseNo')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input id="lic-no" type="text" required value={f.licenseNo}
            onChange={e => setF(p => ({ ...p, licenseNo: e.target.value }))}
            className={cn(inputClass, 'font-mono')} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="lic-issued" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('driverProfile.issuedAt')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input id="lic-issued" type="date" required value={f.issuedAt}
            onChange={e => setF(p => ({ ...p, issuedAt: e.target.value }))}
            className={inputClass} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="lic-expires" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('driverProfile.expiresAt')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input id="lic-expires" type="date" required value={f.expiresAt}
            onChange={e => setF(p => ({ ...p, expiresAt: e.target.value }))}
            className={inputClass} disabled={busy} />
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <label htmlFor="lic-state" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('driverProfile.issuingState')}
          </label>
          <input id="lic-state" type="text" value={f.issuingState}
            onChange={e => setF(p => ({ ...p, issuingState: e.target.value }))}
            className={inputClass} disabled={busy} placeholder="CG" />
        </div>
      </div>
      <FormFooter onCancel={onCancel} busy={busy} submitLabel={t('common.save')} pendingLabel={t('common.saving')} />
    </form>
  );
}

// ─── Formulaire : planifier une formation ────────────────────────────────────

interface TrainingValues {
  staffId: string; typeId: string; scheduledAt: string;
  trainerName: string; locationName: string;
}

function TrainingForm({
  drivers, types, onSubmit, onCancel, busy, error,
}: {
  drivers: DriverSummary[];
  types:   TrainingType[];
  onSubmit: (v: TrainingValues) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<TrainingValues>({
    staffId: drivers[0]?.id ?? '', typeId: types[0]?.id ?? '',
    scheduledAt: '', trainerName: '', locationName: '',
  });
  return (
    <form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}>
      <ErrorAlert error={error} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2 space-y-1.5">
          <label htmlFor="tr-staff" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('driverProfile.driver')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <select id="tr-staff" required value={f.staffId} onChange={e => setF(p => ({ ...p, staffId: e.target.value }))}
            className={inputClass} disabled={busy || drivers.length === 0}>
            {drivers.length === 0 && <option value="">{t('driverProfile.noDriver')}</option>}
            {drivers.map(d => (
              <option key={d.id} value={d.id}>{d.user.displayName ?? d.user.email}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <label htmlFor="tr-type" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('driverProfile.trainingType')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <select id="tr-type" required value={f.typeId} onChange={e => setF(p => ({ ...p, typeId: e.target.value }))}
            className={inputClass} disabled={busy || types.length === 0}>
            {types.length === 0 && <option value="">{t('driverProfile.noTrainingType')}</option>}
            {types.map(tb => <option key={tb.id} value={tb.id}>{tb.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <label htmlFor="tr-date" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('driverProfile.scheduledDate')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input id="tr-date" type="date" required value={f.scheduledAt}
            onChange={e => setF(p => ({ ...p, scheduledAt: e.target.value }))} className={inputClass} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="tr-trainer" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('driverProfile.trainer')}
          </label>
          <input id="tr-trainer" type="text" value={f.trainerName}
            onChange={e => setF(p => ({ ...p, trainerName: e.target.value }))} className={inputClass} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="tr-loc" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('driverProfile.location')}
          </label>
          <input id="tr-loc" type="text" value={f.locationName}
            onChange={e => setF(p => ({ ...p, locationName: e.target.value }))} className={inputClass} disabled={busy} />
        </div>
      </div>
      <FormFooter onCancel={onCancel} busy={busy} submitLabel={t('driverProfile.planFooter')} pendingLabel={t('driverProfile.planningFooter')} />
    </form>
  );
}

// ─── Formulaire : règle de remédiation ────────────────────────────────────────

interface RuleValues {
  name: string; scoreBelowThreshold: number; actionType: string;
  suspensionDays?: number; priority?: number;
}

function RemediationRuleForm({
  initial, onSubmit, onCancel, busy, error,
}: {
  initial?: Partial<RuleValues>;
  onSubmit: (v: RuleValues) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<RuleValues>({
    name:                initial?.name                ?? '',
    scoreBelowThreshold: initial?.scoreBelowThreshold ?? 50,
    actionType:          initial?.actionType          ?? 'WARNING',
    suspensionDays:      initial?.suspensionDays,
    priority:            initial?.priority            ?? 0,
  });
  return (
    <form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}>
      <ErrorAlert error={error} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2 space-y-1.5">
          <label htmlFor="r-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('common.name')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input id="r-name" type="text" required value={f.name}
            onChange={e => setF(p => ({ ...p, name: e.target.value }))} className={inputClass} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="r-score" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('driverProfile.crmThreshold')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input id="r-score" type="number" min={0} max={100} required value={f.scoreBelowThreshold}
            onChange={e => setF(p => ({ ...p, scoreBelowThreshold: parseInt(e.target.value || '0', 10) }))}
            className={inputClass} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="r-action" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('driverProfile.action')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <select id="r-action" required value={f.actionType}
            onChange={e => setF(p => ({ ...p, actionType: e.target.value }))}
            className={inputClass} disabled={busy}>
            <option value="WARNING">{t('driverProfile.actionWarning')}</option>
            <option value="TRAINING">{t('driverProfile.actionTraining')}</option>
            <option value="SUSPENSION">{t('driverProfile.actionSuspension')}</option>
          </select>
        </div>
        {f.actionType === 'SUSPENSION' && (
          <div className="space-y-1.5">
            <label htmlFor="r-susp" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('driverProfile.suspensionDays')}
            </label>
            <input id="r-susp" type="number" min={1} value={f.suspensionDays ?? ''}
              onChange={e => setF(p => ({ ...p, suspensionDays: e.target.value ? parseInt(e.target.value, 10) : undefined }))}
              className={inputClass} disabled={busy} />
          </div>
        )}
        <div className="space-y-1.5">
          <label htmlFor="r-prio" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('driverProfile.priority')}
          </label>
          <input id="r-prio" type="number" min={0} value={f.priority ?? 0}
            onChange={e => setF(p => ({ ...p, priority: parseInt(e.target.value || '0', 10) }))}
            className={inputClass} disabled={busy} />
        </div>
      </div>
      <FormFooter onCancel={onCancel} busy={busy} submitLabel={t('common.save')} pendingLabel={t('common.saving')} />
    </form>
  );
}

// ─── Formulaire : configuration repos ─────────────────────────────────────────

function RestConfigForm({
  initial, onSubmit, onCancel, busy, error,
}: {
  initial: RestConfig;
  onSubmit: (v: RestConfig) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<RestConfig>(initial);
  return (
    <form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}>
      <ErrorAlert error={error} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[
          { k: 'minRestMinutes',           label: t('driverProfile.restConfigMin') },
          { k: 'maxDrivingMinutesPerDay',  label: t('driverProfile.maxDrivingDayMin') },
          { k: 'maxDrivingMinutesPerWeek', label: t('driverProfile.maxDrivingWeekMin') },
          { k: 'alertBeforeEndRestMin',    label: t('driverProfile.alertBeforeRestMin') },
        ].map(({ k, label }) => (
          <div key={k} className="space-y-1.5">
            <label htmlFor={`rc-${k}`} className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {label} <span aria-hidden className="text-red-500">*</span>
            </label>
            <input id={`rc-${k}`} type="number" min={0} required
              value={f[k as keyof RestConfig]}
              onChange={e => setF(p => ({ ...p, [k]: parseInt(e.target.value || '0', 10) }))}
              className={inputClass} disabled={busy} />
          </div>
        ))}
      </div>
      <FormFooter onCancel={onCancel} busy={busy} submitLabel={t('common.save')} pendingLabel={t('common.saving')} />
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

// ─── Modale : fiche synthétique d'un chauffeur ────────────────────────────────

function DriverDetailPanel({ driver, tenantId, licAlerts, overdueTrainings }: {
  driver:           DriverSummary;
  tenantId:         string;
  licAlerts:        LicenseAlert[]   | null;
  overdueTrainings: OverdueTraining[] | null;
}) {
  const { t } = useI18n();
  const name = driver.user.displayName ?? driver.user.email;
  const myLicenses         = (licAlerts ?? []).filter(a => a.staffId === driver.id);
  const myOverdueTrainings = (overdueTrainings ?? []).filter(tb => tb.staffId === driver.id);

  return (
    <div className="space-y-5">
      {/* Entête */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center text-xl font-bold text-teal-700 dark:text-teal-300">
          {name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-base font-semibold text-slate-900 dark:text-white truncate">{name}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Mail className="w-3.5 h-3.5" aria-hidden /> {driver.user.email}
          </p>
          <div className="flex gap-2 mt-1">
            {driver.isAvailable
              ? <Badge variant="success" size="sm">{t('driverProfile.available')}</Badge>
              : <Badge variant="warning" size="sm">{t('driverProfile.resting')}</Badge>}
            {myLicenses.length > 0 && (
              <Badge variant="danger" size="sm">{myLicenses.length} {t('driverProfile.licensesExpired')}</Badge>
            )}
            {myOverdueTrainings.length > 0 && (
              <Badge variant="warning" size="sm">{myOverdueTrainings.length} {t('driverProfile.trainingOverdue')}</Badge>
            )}
          </div>
        </div>
      </div>

      {/* Alertes synthétiques */}
      {myLicenses.length > 0 && (
        <section className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20 p-3">
          <h3 className="text-sm font-semibold text-red-800 dark:text-red-300 mb-2 flex items-center gap-1.5">
            <Shield className="w-4 h-4" aria-hidden /> {t('driverProfile.licenseAlertSection')}
          </h3>
          <ul className="space-y-1 text-xs text-red-800 dark:text-red-200">
            {myLicenses.map(l => (
              <li key={l.id}>
                {l.category} n°{l.licenseNo} — {l.daysUntilExpiry < 0
                  ? `${t('driverProfile.expiredAgo')} ${-l.daysUntilExpiry}${t('driverProfile.days')}`
                  : `${t('driverProfile.expiresIn')} ${l.daysUntilExpiry}${t('driverProfile.days')}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {myOverdueTrainings.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20 p-3">
          <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-2 flex items-center gap-1.5">
            <GraduationCap className="w-4 h-4" aria-hidden /> {t('driverProfile.overdueTrainingSection')}
          </h3>
          <ul className="space-y-1 text-xs text-amber-800 dark:text-amber-200">
            {myOverdueTrainings.map(tb => (
              <li key={tb.id}>{tb.typeName} — {t('driverProfile.scheduledFor')} {new Date(tb.scheduledAt).toLocaleDateString('fr-FR')}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Documents */}
      <section className="pt-4 border-t border-slate-100 dark:border-slate-800">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">{t('driverProfile.attachments')}</h3>
        <DocumentAttachments
          tenantId={tenantId}
          entityType="STAFF"
          entityId={driver.id}
          allowedKinds={['CONTRACT', 'ID_CARD', 'LICENSE', 'CERTIFICATE', 'PHOTO', 'OTHER']}
        />
      </section>
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export function PageDriverProfile({ initialTab = 'overview' }: PageDriverProfileProps = {}) {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId ?? '';

  const [tab, setTab]         = useState<Tab>(initialTab);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);

  const [showLicenseForm, setShowLicenseForm]     = useState(false);
  const [editingLicense, setEditingLicense]       = useState<LicenseAlert | null>(null);
  const [showTrainingForm, setShowTrainingForm]   = useState(false);
  const [showRuleForm, setShowRuleForm]           = useState(false);
  const [editingRule, setEditingRule]             = useState<RemediationRule | null>(null);
  const [showRestConfigForm, setShowRestConfigForm] = useState(false);
  const [busy,            setBusy]            = useState(false);
  const [actionError,     setActionError]     = useState<string | null>(null);

  async function confirmAndRun(message: string, fn: () => Promise<unknown>, refetch: () => void) {
    if (!window.confirm(message)) return;
    setActionError(null);
    try { await fn(); refetch(); }
    catch (e) { setActionError(e instanceof Error ? e.message : t('driverProfile.unknownError')); }
  }

  const handleDeleteLicense = (id: string) =>
    confirmAndRun(t('driverProfile.confirmDeleteLicense'), () => apiDelete(`${base}/driver-profile/licenses/${id}`), () => { refetchLic(); refetchAllLic(); });

  const handleDeleteTraining = (id: string) =>
    confirmAndRun(t('driverProfile.confirmDeleteTraining'), () => apiDelete(`${base}/driver-profile/trainings/${id}`), refetchTrainings);

  const handleCompleteTraining = (id: string) =>
    confirmAndRun(
      t('driverProfile.confirmCompleteTraining'),
      () => apiPatch(`${base}/driver-profile/trainings/${id}/complete`, { completedAt: new Date().toISOString().slice(0, 10) }),
      refetchTrainings,
    );

  const handleDeleteRule = (id: string) =>
    confirmAndRun(t('driverProfile.confirmDeleteRule'), () => apiDelete(`${base}/driver-profile/remediation-rules/${id}`), refetchRemediations);

  const navigate = useNavigate();
  const base = `/api/tenants/${tenantId}`;

  const { data: drivers,     loading: loadingDrivers }    = useFetch<DriverSummary[]>(`${base}/staff?role=DRIVER`, [tenantId]);
  const { data: allLicenses, loading: loadingAllLic, refetch: refetchAllLic } = useFetch<LicenseRow[]>(
    tab === 'licenses' ? `${base}/driver-profile/licenses` : null,
    [tenantId, tab],
  );
  const { data: licAlerts,   loading: loadingLic, refetch: refetchLic } = useFetch<LicenseAlert[]>(`${base}/driver-profile/licenses/alerts`, [tenantId]);
  const { data: overdueTrainings, loading: loadingTrainings, refetch: refetchTrainings } = useFetch<OverdueTraining[]>(`${base}/driver-profile/trainings/overdue`, [tenantId]);
  const { data: trainingTypes } = useFetch<TrainingType[]>(`${base}/driver-profile/training-types`, [tenantId]);
  const { data: restConfig,  loading: loadingRest, refetch: refetchRest } = useFetch<RestConfig>(`${base}/driver-profile/rest-config`, [tenantId]);
  const { data: remediations, loading: loadingRemediation, refetch: refetchRemediations } = useFetch<RemediationRule[]>(
    tab === 'remediation' ? `${base}/driver-profile/remediation-rules` : null,
    [tenantId, tab],
  );

  const loading = loadingDrivers || loadingLic;

  const licenseAlertCount    = licAlerts?.length    ?? 0;
  const overdueTrainingCount = overdueTrainings?.length ?? 0;
  const remediationCount     = remediations?.length ?? 0;
  const restBlockedCount     = 0; // requires per-driver rest-compliance calls

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview',    label: t('driverProfile.tabOverview') },
    { id: 'licenses',    label: t('driverProfile.tabLicenses') },
    { id: 'rest',        label: t('driverProfile.tabRest') },
    { id: 'trainings',   label: t('driverProfile.tabTrainings') },
    { id: 'remediation', label: t('driverProfile.tabRemediation') },
  ];

  return (
    <main className="p-6 space-y-6" role="main" aria-label={t('driverProfile.pageTitle')}>
      {/* ── En-tête ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('driverProfile.pageTitle')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t('driverProfile.pageSubtitle')}
          </p>
        </div>
        {tab === 'overview' && (
          <Button
            onClick={() => navigate('/admin/staff')}
            aria-label={t('driverProfile.newDriver')}
          >
            <Plus className="w-4 h-4 mr-2" aria-hidden /> {t('driverProfile.newDriver')}
          </Button>
        )}
        {tab === 'licenses' && (
          <Button
            onClick={() => { setShowLicenseForm(true); setActionError(null); }}
            aria-label={t('driverProfile.newLicense')}
          >
            <Plus className="w-4 h-4 mr-2" aria-hidden /> {t('driverProfile.newLicense')}
          </Button>
        )}
        {tab === 'rest' && (
          <Button
            onClick={() => { setShowRestConfigForm(true); setActionError(null); }}
            aria-label={t('driverProfile.configureRest')}
            disabled={!restConfig}
          >
            <Settings className="w-4 h-4 mr-2" aria-hidden /> {t('driverProfile.configureRest')}
          </Button>
        )}
        {tab === 'trainings' && (
          <Button
            onClick={() => { setShowTrainingForm(true); setActionError(null); }}
            aria-label={t('driverProfile.planTraining')}
          >
            <Plus className="w-4 h-4 mr-2" aria-hidden /> {t('driverProfile.planTraining')}
          </Button>
        )}
        {tab === 'remediation' && (
          <Button
            onClick={() => { setShowRuleForm(true); setActionError(null); }}
            aria-label={t('driverProfile.newRule')}
          >
            <Plus className="w-4 h-4 mr-2" aria-hidden /> {t('driverProfile.newRule')}
          </Button>
        )}
      </div>

      {/* ── KPIs ── */}
      <section aria-label="Indicateurs chauffeurs">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label={t('driverProfile.licenseAlerts')}      value={licenseAlertCount}    icon={<Shield className="w-5 h-5" />}         highlight={licenseAlertCount > 0 ? 'danger' : 'success'} loading={loadingLic} />
          <KpiCard label={t('driverProfile.driversBlocked')}    value={restBlockedCount}     icon={<Coffee className="w-5 h-5" />}         highlight={restBlockedCount > 0 ? 'warning' : 'success'} loading={false} />
          <KpiCard label={t('driverProfile.remediationActions')}   value={remediationCount}     icon={<AlertTriangle className="w-5 h-5" />}  highlight={remediationCount > 0 ? 'danger' : 'success'} loading={loadingRemediation} />
          <KpiCard label={t('driverProfile.overdueTrainings')}  value={overdueTrainingCount} icon={<GraduationCap className="w-5 h-5" />} highlight={overdueTrainingCount > 0 ? 'warning' : 'success'} loading={loadingTrainings} />
        </div>
      </section>

      {/* ── Tabs ── */}
      <nav aria-label="Sections dossiers chauffeurs" role="tablist">
        <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
          {tabs.map(tb => (
            <button
              key={tb.id}
              role="tab"
              aria-selected={tab === tb.id}
              aria-controls={`tabpanel-driver-${tb.id}`}
              id={`tab-driver-${tb.id}`}
              onClick={() => setTab(tb.id)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                tab === tb.id
                  ? 'border-teal-600 text-teal-600 dark:border-teal-400 dark:text-teal-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
              )}
            >
              {tb.label}
            </button>
          ))}
        </div>
      </nav>

      {/* ── Vue d'ensemble ── */}
      {tab === 'overview' && (
        <section id="tabpanel-driver-overview" role="tabpanel" aria-labelledby="tab-driver-overview">
          <Card>
            <CardHeader
              heading={t('driverProfile.driverList')}
              description={t('driverProfile.driverListDesc')}
            />
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6 space-y-3" aria-busy="true">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
                </div>
              ) : !drivers || drivers.length === 0 ? (
                <div className="py-16 text-center text-slate-500 dark:text-slate-400" role="status">
                  <UserCheck className="w-12 h-12 mx-auto mb-3 text-slate-300 dark:text-slate-600" aria-hidden />
                  <p className="font-medium">{t('driverProfile.noDriverRegistered')}</p>
                  <p className="text-sm mt-1">{t('driverProfile.addDriverViaStaff')}</p>
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
                          onClick={() => setSelectedDriverId(d.id)}
                          aria-label={`${t('driverProfile.driverProfile')} — ${name}`}
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
                                {hasLicAlert && <Badge variant="danger" size="sm">{t('driverProfile.licenseExpired')}</Badge>}
                                {!d.isAvailable && <Badge variant="warning" size="sm">{t('driverProfile.resting')}</Badge>}
                                {!hasLicAlert && d.isAvailable && (
                                  <Badge variant="success" size="sm">{t('driverProfile.compliant')}</Badge>
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
        <section id="tabpanel-driver-licenses" role="tabpanel" aria-labelledby="tab-driver-licenses" className="space-y-6">
          {/* Alertes (expirant / expirés) */}
          {licAlerts && licAlerts.length > 0 && (
            <Card>
              <CardHeader
                heading={t('driverProfile.alertLicenses')}
                description={t('driverProfile.alertLicensesDesc')}
              />
              <CardContent className="p-0">
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
                  {licAlerts.map(a => (
                    <li key={a.id} className="flex items-center justify-between px-6 py-3">
                      <div>
                        <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{a.staffName}</p>
                        <p className="text-xs text-slate-500 font-mono">{a.licenseNo} · Cat. {a.category}</p>
                      </div>
                      <Badge variant={a.daysUntilExpiry <= 0 ? 'danger' : 'warning'} size="sm">
                        {a.daysUntilExpiry <= 0 ? t('driverProfile.expired') : `J-${a.daysUntilExpiry}`}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Liste complète des permis */}
          <Card>
            <CardHeader
              heading={t('driverProfile.allLicenses')}
              action={
                <Button
                  size="sm"
                  onClick={() => { setShowLicenseForm(true); setActionError(null); }}
                  aria-label={t('driverProfile.driverLicense')}
                >
                  <Plus className="w-4 h-4 mr-1" aria-hidden /> {t('driverProfile.license')}
                </Button>
              }
            />
            <CardContent className="p-0">
              {loadingAllLic ? (
                <div className="p-6 space-y-3" aria-busy="true">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : !allLicenses || allLicenses.length === 0 ? (
                <div className="py-12 text-center text-slate-500 dark:text-slate-400" role="status">
                  <Shield className="w-10 h-10 mx-auto mb-2 text-slate-300 dark:text-slate-600" aria-hidden />
                  <p className="font-medium">{t('driverProfile.noLicense')}</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
                  {allLicenses.map(lic => (
                    <li key={lic.id} className="flex items-center justify-between px-6 py-3">
                      <div>
                        <p className="font-medium text-sm text-slate-900 dark:text-slate-100">
                          {lic.staff.user.name ?? lic.staff.user.email}
                        </p>
                        <p className="text-xs text-slate-500 font-mono">
                          {lic.licenseNo} · Cat. {lic.category}
                          {lic.issuingState ? ` · ${lic.issuingState}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs tabular-nums text-slate-500">
                          {lic.expiresAt ? new Date(lic.expiresAt).toLocaleDateString('fr-FR') : '—'}
                        </span>
                        <Badge
                          variant={lic.status === 'EXPIRED' ? 'danger' : lic.status === 'EXPIRING' ? 'warning' : 'success'}
                          size="sm"
                        >
                          {lic.status}
                        </Badge>
                        <button
                          type="button"
                          onClick={() => handleDeleteLicense(lic.id)}
                          className="p-1.5 rounded text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                          aria-label={`${t('common.delete')} — ${lic.staff.user.name ?? lic.staff.user.email}`}
                          title={t('common.delete')}
                        >
                          <Trash2 className="w-4 h-4" aria-hidden />
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

      {/* ── Repos ── */}
      {tab === 'rest' && (
        <section id="tabpanel-driver-rest" role="tabpanel" aria-labelledby="tab-driver-rest">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader
                heading={t('driverProfile.restConfigHeading')}
                description={t('driverProfile.restConfigDesc')}
                action={
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => { setShowRestConfigForm(true); setActionError(null); }}
                    aria-label={t('driverProfile.restConfigHeading')}
                    disabled={!restConfig}
                  >
                    <Settings className="w-4 h-4 mr-1" aria-hidden /> {t('common.edit')}
                  </Button>
                }
              />
              <CardContent>
                {loadingRest ? (
                  <div className="space-y-3" aria-busy="true">
                    {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                  </div>
                ) : restConfig ? (
                  <dl className="space-y-3 text-sm">
                    {[
                      { label: t('driverProfile.minRest'),         value: `${restConfig.minRestMinutes} min` },
                      { label: t('driverProfile.maxDrivingDay'),      value: `${restConfig.maxDrivingMinutesPerDay} min` },
                      { label: t('driverProfile.maxDrivingWeek'),      value: `${restConfig.maxDrivingMinutesPerWeek} min` },
                      { label: t('driverProfile.alertBeforeRestEnd'), value: `${restConfig.alertBeforeEndRestMin} min` },
                    ].map(item => (
                      <div key={item.label} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
                        <dt className="text-slate-600 dark:text-slate-400">{item.label}</dt>
                        <dd className="font-medium text-slate-900 dark:text-slate-100 tabular-nums">{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">
                    {t('driverProfile.noRestConfig')}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader
                heading={t('driverProfile.driversAvailable')}
                description={t('driverProfile.driversAvailableDesc')}
              />
              <CardContent className="p-0">
                {loadingDrivers ? (
                  <div className="p-6 space-y-3" aria-busy="true">
                    {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : !drivers || drivers.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">{t('driverProfile.noDriver')}</p>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
                    {drivers.map(d => (
                      <li key={d.id} className="flex items-center justify-between px-4 py-3">
                        <span className="text-sm text-slate-800 dark:text-slate-200">
                          {d.user.displayName ?? d.user.email}
                        </span>
                        <Badge variant={d.isAvailable ? 'success' : 'warning'} size="sm">
                          {d.isAvailable ? t('driverProfile.available') : t('driverProfile.resting')}
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
              heading={t('driverProfile.overdueTrainingsHeading')}
              description={t('driverProfile.overdueTrainingsDesc')}
              action={
                <Button
                  size="sm"
                  onClick={() => { setShowTrainingForm(true); setActionError(null); }}
                  aria-label={t('driverProfile.planTraining')}
                >
                  <Plus className="w-4 h-4 mr-1" aria-hidden /> {t('driverProfile.planTrainingAction')}
                </Button>
              }
            />
            <CardContent className="p-0">
              {loadingTrainings ? (
                <div className="p-6 space-y-3" aria-busy="true">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : !overdueTrainings || overdueTrainings.length === 0 ? (
                <div className="py-12 text-center text-slate-500 dark:text-slate-400" role="status">
                  <GraduationCap className="w-10 h-10 mx-auto mb-2 text-emerald-400" aria-hidden />
                  <p className="font-medium">{t('driverProfile.allTrainingsUpToDate')}</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
                  {overdueTrainings.map(tb => (
                    <li key={tb.id} className="flex items-center justify-between px-6 py-3">
                      <div>
                        <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{tb.staffName}</p>
                        <p className="text-xs text-slate-500">{tb.typeName}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="warning" size="sm">
                          {new Date(tb.scheduledAt).toLocaleDateString('fr-FR')}
                        </Badge>
                        <button
                          type="button"
                          onClick={() => handleCompleteTraining(tb.id)}
                          className="p-1.5 rounded text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                          aria-label={`${t('driverProfile.markComplete')} — ${tb.staffName}`}
                          title={t('driverProfile.markComplete')}
                        >
                          <CheckCircle2 className="w-4 h-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTraining(tb.id)}
                          className="p-1.5 rounded text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                          aria-label={`${t('common.delete')} — ${tb.staffName}`}
                          title={t('common.delete')}
                        >
                          <Trash2 className="w-4 h-4" aria-hidden />
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

      {/* ── Modal : Nouveau / Édition permis ── */}
      <Dialog
        open={showLicenseForm || !!editingLicense}
        onOpenChange={o => { if (!o) { setShowLicenseForm(false); setEditingLicense(null); } }}
        title={editingLicense ? t('driverProfile.editLicense') : t('driverProfile.newLicenseDialog')}
        description={t('driverProfile.licenseAlertDesc')}
        size="xl"
      >
        {(showLicenseForm || editingLicense) && (
          <LicenseForm
            drivers={drivers ?? []}
            initial={editingLicense ? {
              staffId:   editingLicense.staffId,
              category:  editingLicense.category,
              licenseNo: editingLicense.licenseNo,
              expiresAt: editingLicense.expiresAt ? editingLicense.expiresAt.slice(0, 10) : '',
            } : undefined}
            busy={busy}
            error={actionError}
            onCancel={() => { setShowLicenseForm(false); setEditingLicense(null); }}
            onSubmit={async (v: LicenseValues) => {
              setBusy(true); setActionError(null);
              try {
                if (editingLicense) {
                  await apiPatch(`${base}/driver-profile/licenses/${editingLicense.id}`, {
                    licenseNo:    v.licenseNo,
                    issuedAt:     v.issuedAt  || undefined,
                    expiresAt:    v.expiresAt || undefined,
                    issuingState: v.issuingState || undefined,
                  });
                } else {
                  await apiPost(`${base}/driver-profile/licenses`, {
                    staffId:      v.staffId,
                    category:     v.category,
                    licenseNo:    v.licenseNo,
                    issuedAt:     v.issuedAt,
                    expiresAt:    v.expiresAt,
                    issuingState: v.issuingState || undefined,
                  });
                }
                setShowLicenseForm(false);
                setEditingLicense(null);
                refetchLic();
                refetchAllLic();
              } catch (e) {
                setActionError(e instanceof Error ? e.message : t('driverProfile.unknownError'));
              } finally { setBusy(false); }
            }}
          />
        )}
      </Dialog>

      {/* ── Modal : Planifier formation ── */}
      <Dialog
        open={showTrainingForm}
        onOpenChange={o => { if (!o) setShowTrainingForm(false); }}
        title={t('driverProfile.planTrainingDialogTitle')}
        description={t('driverProfile.planTrainingDialogDesc')}
        size="xl"
      >
        {showTrainingForm && (
          <TrainingForm
            drivers={drivers ?? []}
            types={trainingTypes ?? []}
            busy={busy}
            error={actionError}
            onCancel={() => setShowTrainingForm(false)}
            onSubmit={async (v: TrainingValues) => {
              setBusy(true); setActionError(null);
              try {
                await apiPost(`${base}/driver-profile/trainings`, {
                  staffId:      v.staffId,
                  typeId:       v.typeId,
                  scheduledAt:  v.scheduledAt,
                  trainerName:  v.trainerName  || undefined,
                  locationName: v.locationName || undefined,
                });
                setShowTrainingForm(false);
                refetchTrainings();
              } catch (e) {
                setActionError(e instanceof Error ? e.message : t('driverProfile.unknownError'));
              } finally { setBusy(false); }
            }}
          />
        )}
      </Dialog>

      {/* ── Modal : Règle de remédiation (créer / éditer) ── */}
      <Dialog
        open={showRuleForm || !!editingRule}
        onOpenChange={o => { if (!o) { setShowRuleForm(false); setEditingRule(null); } }}
        title={editingRule ? t('driverProfile.editRule') : t('driverProfile.newRuleDialog')}
        description={t('driverProfile.ruleDialogDesc')}
        size="xl"
      >
        {(showRuleForm || editingRule) && (
          <RemediationRuleForm
            initial={editingRule ? {
              name:                editingRule.name ?? '',
              scoreBelowThreshold: editingRule.scoreBelowThreshold,
              actionType:          editingRule.actionType,
            } : undefined}
            busy={busy}
            error={actionError}
            onCancel={() => { setShowRuleForm(false); setEditingRule(null); }}
            onSubmit={async (v: RuleValues) => {
              setBusy(true); setActionError(null);
              try {
                if (editingRule) {
                  await apiPatch(`${base}/driver-profile/remediation-rules/${editingRule.id}`, {
                    name:                v.name,
                    scoreBelowThreshold: v.scoreBelowThreshold,
                    actionType:          v.actionType,
                    suspensionDays:      v.suspensionDays,
                    priority:            v.priority,
                  });
                } else {
                  await apiPost(`${base}/driver-profile/remediation-rules`, {
                    name:                v.name,
                    scoreBelowThreshold: v.scoreBelowThreshold,
                    actionType:          v.actionType,
                    suspensionDays:      v.suspensionDays,
                    priority:            v.priority,
                  });
                }
                setShowRuleForm(false);
                setEditingRule(null);
                refetchRemediations();
              } catch (e) {
                setActionError(e instanceof Error ? e.message : t('driverProfile.unknownError'));
              } finally { setBusy(false); }
            }}
          />
        )}
      </Dialog>

      {/* ── Modal : Configuration repos ── */}
      <Dialog
        open={showRestConfigForm}
        onOpenChange={o => { if (!o) setShowRestConfigForm(false); }}
        title={t('driverProfile.restConfigDialogTitle')}
        description={t('driverProfile.restConfigDialogDesc')}
        size="lg"
      >
        {showRestConfigForm && restConfig && (
          <RestConfigForm
            initial={restConfig}
            busy={busy}
            error={actionError}
            onCancel={() => setShowRestConfigForm(false)}
            onSubmit={async (v: RestConfig) => {
              setBusy(true); setActionError(null);
              try {
                await apiPatch(`${base}/driver-profile/rest-config`, v);
                setShowRestConfigForm(false);
                refetchRest();
              } catch (e) {
                setActionError(e instanceof Error ? e.message : t('driverProfile.unknownError'));
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
              heading={t('driverProfile.remediationRules')}
              description={t('driverProfile.remediationRulesDesc')}
              action={
                <Button
                  size="sm"
                  onClick={() => { setShowRuleForm(true); setActionError(null); }}
                  aria-label={t('driverProfile.newRule')}
                >
                  <Plus className="w-4 h-4 mr-1" aria-hidden /> {t('driverProfile.rule')}
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
                  {t('driverProfile.noRemediationRule')}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
                  {remediations.map(r => (
                    <li key={r.id} className="flex items-center justify-between px-6 py-3">
                      <div>
                        <p className="font-medium text-sm text-slate-900 dark:text-slate-100">
                          {r.name ?? r.actionType}
                        </p>
                        <p className="text-xs text-slate-500 font-mono">
                          {r.actionType} · {t('driverProfile.crmScore')}: {r.scoreBelowThreshold}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant={r.isActive ? 'success' : 'default'} size="sm">
                          {r.isActive ? t('driverProfile.active') : t('driverProfile.inactive')}
                        </Badge>
                        <button
                          type="button"
                          onClick={() => { setEditingRule(r); setActionError(null); }}
                          className="p-1.5 rounded text-slate-500 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                          aria-label={`${t('common.edit')} — ${r.name ?? r.actionType}`}
                          title={t('common.edit')}
                        >
                          <Pencil className="w-4 h-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRule(r.id)}
                          className="p-1.5 rounded text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                          aria-label={`${t('driverProfile.deactivate')} — ${r.name ?? r.actionType}`}
                          title={t('driverProfile.deactivate')}
                        >
                          <Trash2 className="w-4 h-4" aria-hidden />
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
      {/* Modale fiche chauffeur — ouverte au clic sur un chauffeur dans la liste */}
      <Dialog
        open={!!selectedDriverId}
        onOpenChange={o => { if (!o) setSelectedDriverId(null); }}
        title={t('driverProfile.driverProfile')}
        description={t('driverProfile.driverProfileDesc')}
        size="lg"
      >
        {selectedDriverId && (() => {
          const d = drivers?.find(x => x.id === selectedDriverId);
          return d ? (
            <DriverDetailPanel
              driver={d}
              tenantId={tenantId}
              licAlerts={licAlerts ?? null}
              overdueTrainings={overdueTrainings ?? null}
            />
          ) : null;
        })()}
      </Dialog>
    </main>
  );
}
