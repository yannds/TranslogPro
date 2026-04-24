/**
 * PageFleetDocs — Documents réglementaires & consommables véhicules
 *
 * Module Fleet Docs : suivi des documents (assurance, carte grise, CT…)
 * et consommables (pneus, vidange…) avec alertes prédictives.
 *
 * Accessibilité : WCAG 2.1 AA — aria-labels, rôles, focus visible, contrast 4.5:1
 * Dark mode : classes Tailwind dark: — automatique via ThemeProvider
 */

import { useState, useEffect, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, Clock, FileText, Wrench, Plus, Upload } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPost } from '../../lib/api';
import { useI18n } from '../../lib/i18n/useI18n';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { ErrorAlert } from '../ui/ErrorAlert';
import { FormFooter } from '../ui/FormFooter';
import { inputClass } from '../ui/inputClass';
import { cn } from '../../lib/utils';
import { UploadScanDialog } from '../upload/UploadScanDialog';

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface DocumentType {
  id:          string;
  name:        string;
  code:        string;
  isMandatory: boolean;
  validityDays: number | null;
}

interface ConsumableType {
  id:                string;
  name:              string;
  code:              string;
  replacementKm:     number;
  alertThresholdKm:  number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function docStatusVariant(s: string): 'danger' | 'warning' | 'default' {
  if (s === 'EXPIRED' || s === 'MISSING') return 'danger';
  if (s === 'EXPIRING') return 'warning';
  return 'default';
}

function docStatusLabel(s: string, t: (keyOrMap: string | Record<string, string | undefined>) => string): string {
  if (s === 'EXPIRED')  return t('fleetDocs.statusExpired');
  if (s === 'EXPIRING') return t('fleetDocs.statusExpiring');
  if (s === 'MISSING')  return t('fleetDocs.statusMissing');
  return s;
}

function consumableVariant(s: string): 'danger' | 'warning' | 'success' {
  if (s === 'OVERDUE') return 'danger';
  if (s === 'ALERT')   return 'warning';
  return 'success';
}

function consumableLabel(s: string, t: (keyOrMap: string | Record<string, string | undefined>) => string): string {
  if (s === 'OVERDUE') return t('fleetDocs.statusOverdue');
  if (s === 'ALERT')   return t('fleetDocs.statusAlert');
  return 'OK';
}

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
      aria-label={`${label}: ${loading ? '…' : value}`}
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

type Tab = 'alerts' | 'consumables' | 'types';

// ─── Bus ──────────────────────────────────────────────────────────────────────

interface BusLite { id: string; plateNumber: string; model?: string | null }

// ─── Formulaires CRUD ─────────────────────────────────────────────────────────

interface DocTypeValues { name: string; code: string; alertDaysBeforeExpiry: number; isMandatory: boolean }
function DocumentTypeForm({ onSubmit, onCancel, busy, error }: {
  onSubmit: (v: DocTypeValues) => void; onCancel: () => void; busy: boolean; error: string | null;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<DocTypeValues>({ name: '', code: '', alertDaysBeforeExpiry: 30, isMandatory: true });
  return (
    <form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}>
      <ErrorAlert error={error} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2 space-y-1.5">
          <label htmlFor="dt-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('common.name')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input id="dt-name" type="text" required value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))}
            className={inputClass} disabled={busy} placeholder="Carte grise" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="dt-code" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('fleetDocs.code')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input id="dt-code" type="text" required value={f.code}
            onChange={e => setF(p => ({ ...p, code: e.target.value.toUpperCase() }))}
            className={cn(inputClass, 'font-mono')} disabled={busy} placeholder="CARTE_GRISE" maxLength={32} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="dt-alert" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('fleetDocs.alertDaysBefore')}
          </label>
          <input id="dt-alert" type="number" min={1} value={f.alertDaysBeforeExpiry}
            onChange={e => setF(p => ({ ...p, alertDaysBeforeExpiry: Math.max(1, Number(e.target.value)) }))}
            className={inputClass} disabled={busy} />
        </div>
        <label className="sm:col-span-2 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input type="checkbox" checked={f.isMandatory} onChange={e => setF(p => ({ ...p, isMandatory: e.target.checked }))}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500" disabled={busy} />
          {t('fleetDocs.mandatoryDoc')}
        </label>
      </div>
      <FormFooter onCancel={onCancel} busy={busy} submitLabel={t('common.create')} pendingLabel={t('common.creating')} />
    </form>
  );
}

interface ConsTypeValues { name: string; code: string; nominalLifetimeKm: number; alertKmBefore: number }
function ConsumableTypeForm({ onSubmit, onCancel, busy, error }: {
  onSubmit: (v: ConsTypeValues) => void; onCancel: () => void; busy: boolean; error: string | null;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<ConsTypeValues>({ name: '', code: '', nominalLifetimeKm: 50000, alertKmBefore: 2000 });
  return (
    <form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}>
      <ErrorAlert error={error} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2 space-y-1.5">
          <label htmlFor="ct-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('common.name')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input id="ct-name" type="text" required value={f.name}
            onChange={e => setF(p => ({ ...p, name: e.target.value }))}
            className={inputClass} disabled={busy} placeholder="Pneus avant" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ct-code" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('fleetDocs.code')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input id="ct-code" type="text" required value={f.code}
            onChange={e => setF(p => ({ ...p, code: e.target.value.toUpperCase() }))}
            className={cn(inputClass, 'font-mono')} disabled={busy} placeholder="PNEU_AV" maxLength={32} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ct-life" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('fleetDocs.nominalLifetimeKm')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input id="ct-life" type="number" min={1} required value={f.nominalLifetimeKm}
            onChange={e => setF(p => ({ ...p, nominalLifetimeKm: Math.max(1, Number(e.target.value)) }))}
            className={inputClass} disabled={busy} />
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <label htmlFor="ct-alert" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('fleetDocs.alertKmBefore')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input id="ct-alert" type="number" min={0} required value={f.alertKmBefore}
            onChange={e => setF(p => ({ ...p, alertKmBefore: Math.max(0, Number(e.target.value)) }))}
            className={inputClass} disabled={busy} />
        </div>
      </div>
      <FormFooter onCancel={onCancel} busy={busy} submitLabel={t('common.create')} pendingLabel={t('common.creating')} />
    </form>
  );
}

interface DocValues { busId: string; typeId: string; referenceNo: string; issuedAt: string; expiresAt: string; notes: string }
function VehicleDocumentForm({ buses, docTypes, onSubmit, onCancel, busy, error }: {
  buses: BusLite[]; docTypes: DocumentType[];
  onSubmit: (v: DocValues) => void; onCancel: () => void; busy: boolean; error: string | null;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<DocValues>({
    busId: buses[0]?.id ?? '', typeId: docTypes[0]?.id ?? '',
    referenceNo: '', issuedAt: '', expiresAt: '', notes: '',
  });
  useEffect(() => {
    if (!f.busId  && buses.length    > 0) setF(p => ({ ...p, busId:  buses[0].id    }));
  }, [buses,    f.busId]);
  useEffect(() => {
    if (!f.typeId && docTypes.length > 0) setF(p => ({ ...p, typeId: docTypes[0].id }));
  }, [docTypes, f.typeId]);
  return (
    <form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}>
      <ErrorAlert error={error} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="doc-bus" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('fleetDocs.vehicle')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <select id="doc-bus" required value={f.busId} onChange={e => setF(p => ({ ...p, busId: e.target.value }))}
            className={inputClass} disabled={busy || buses.length === 0}>
            {buses.length === 0 && <option value="">{t('fleetDocs.noVehicle')}</option>}
            {buses.map(b => <option key={b.id} value={b.id}>{b.plateNumber}{b.model ? ` — ${b.model}` : ''}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="doc-type" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('common.type')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <select id="doc-type" required value={f.typeId} onChange={e => setF(p => ({ ...p, typeId: e.target.value }))}
            className={inputClass} disabled={busy || docTypes.length === 0}>
            {docTypes.length === 0 && <option value="">{t('fleetDocs.noType')}</option>}
            {docTypes.map(dt => <option key={dt.id} value={dt.id}>{dt.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <label htmlFor="doc-ref" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('fleetDocs.reference')}
          </label>
          <input id="doc-ref" type="text" value={f.referenceNo}
            onChange={e => setF(p => ({ ...p, referenceNo: e.target.value }))}
            className={cn(inputClass, 'font-mono')} disabled={busy} placeholder={t('fleetDocs.refPlaceholder')} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="doc-issued" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('fleetDocs.issuedAt')}
          </label>
          <input id="doc-issued" type="date" value={f.issuedAt}
            onChange={e => setF(p => ({ ...p, issuedAt: e.target.value }))}
            className={inputClass} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="doc-expires" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('fleetDocs.expiresAt')}
          </label>
          <input id="doc-expires" type="date" value={f.expiresAt}
            onChange={e => setF(p => ({ ...p, expiresAt: e.target.value }))}
            className={inputClass} disabled={busy} />
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <label htmlFor="doc-notes" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('fleetDocs.notes')}
          </label>
          <textarea id="doc-notes" rows={2} value={f.notes}
            onChange={e => setF(p => ({ ...p, notes: e.target.value }))}
            className={inputClass} disabled={busy} />
        </div>
      </div>
      <FormFooter onCancel={onCancel} busy={busy} submitLabel={t('common.save')} pendingLabel={t('common.saving')} />
    </form>
  );
}

interface ReplaceValues { busId: string; typeId: string; replacedAtKm: number }
function ReplacementForm({ buses, consTypes, onSubmit, onCancel, busy, error }: {
  buses: BusLite[]; consTypes: ConsumableType[];
  onSubmit: (v: ReplaceValues) => void; onCancel: () => void; busy: boolean; error: string | null;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<ReplaceValues>({
    busId: buses[0]?.id ?? '', typeId: consTypes[0]?.id ?? '', replacedAtKm: 0,
  });
  useEffect(() => {
    if (!f.busId  && buses.length     > 0) setF(p => ({ ...p, busId:  buses[0].id     }));
  }, [buses,     f.busId]);
  useEffect(() => {
    if (!f.typeId && consTypes.length > 0) setF(p => ({ ...p, typeId: consTypes[0].id }));
  }, [consTypes, f.typeId]);
  return (
    <form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}>
      <ErrorAlert error={error} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="rep-bus" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('fleetDocs.vehicle')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <select id="rep-bus" required value={f.busId} onChange={e => setF(p => ({ ...p, busId: e.target.value }))}
            className={inputClass} disabled={busy || buses.length === 0}>
            {buses.length === 0 && <option value="">{t('fleetDocs.noVehicle')}</option>}
            {buses.map(b => <option key={b.id} value={b.id}>{b.plateNumber}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="rep-type" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('fleetDocs.consumable')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <select id="rep-type" required value={f.typeId} onChange={e => setF(p => ({ ...p, typeId: e.target.value }))}
            className={inputClass} disabled={busy || consTypes.length === 0}>
            {consTypes.length === 0 && <option value="">{t('fleetDocs.noConsumable')}</option>}
            {consTypes.map(ct => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <label htmlFor="rep-km" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('fleetDocs.mileageAtReplacement')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input id="rep-km" type="number" min={0} required value={f.replacedAtKm}
            onChange={e => setF(p => ({ ...p, replacedAtKm: Math.max(0, Number(e.target.value)) }))}
            className={inputClass} disabled={busy} />
        </div>
      </div>
      <FormFooter onCancel={onCancel} busy={busy} submitLabel={t('common.save')} pendingLabel={t('common.saving')} />
    </form>
  );
}

export interface PageFleetDocsProps {
  /** Onglet initial piloté par la navigation sidebar (fleet-docs-alerts → 'alerts', etc.) */
  initialTab?: Tab;
}

// ─── Page principale ──────────────────────────────────────────────────────────

export function PageFleetDocs({ initialTab = 'alerts' }: PageFleetDocsProps = {}) {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId ?? '';
  const [tab, setTab] = useState<Tab>(initialTab);

  // CRUD state
  const [showDocForm,      setShowDocForm]      = useState(false);
  const [showDocTypeForm,  setShowDocTypeForm]  = useState(false);
  const [showConsTypeForm, setShowConsTypeForm] = useState(false);
  const [showReplaceForm,  setShowReplaceForm]  = useState(false);
  const [uploadTargetId,   setUploadTargetId]   = useState<string | null>(null);
  const [busy,             setBusy]             = useState(false);
  const [actionError,      setActionError]      = useState<string | null>(null);

  const base = `/api/tenants/${tenantId}/fleet-docs`;

  const { data: docAlerts,      loading: loadingAlerts, refetch: refetchAlerts } = useFetch<DocAlertItem[]>(`${base}/documents/alerts`, [tenantId]);
  const { data: consumables,    loading: loadingConsumables }  = useFetch<ConsumableItem[]>(
    tab === 'consumables' ? `${base}/buses/all/consumables` : null,
    [tenantId, tab],
  );
  const { data: documentTypes,  loading: loadingDocTypes, refetch: refetchDocTypes } = useFetch<DocumentType[]>(
    tab === 'types' || showDocForm ? `${base}/document-types` : null,
    [tenantId, tab, showDocForm],
  );
  const { data: consumableTypes, loading: loadingConsTypes, refetch: refetchConsTypes } = useFetch<ConsumableType[]>(
    tab === 'types' || showReplaceForm ? `${base}/consumable-types` : null,
    [tenantId, tab, showReplaceForm],
  );
  const { data: buses } = useFetch<BusLite[]>(
    showDocForm || showReplaceForm ? `/api/tenants/${tenantId}/fleet/buses` : null,
    [tenantId, showDocForm, showReplaceForm],
  );

  // CRUD handlers
  const wrap = async <TVal,>(fn: () => Promise<TVal>, close: () => void, afterSuccess?: () => void) => {
    setBusy(true); setActionError(null);
    try { await fn(); close(); afterSuccess?.(); }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Unknown error'); }
    finally { setBusy(false); }
  };

  const submitDocType = (v: DocTypeValues) =>
    wrap(() => apiPost(`${base}/document-types`, v), () => setShowDocTypeForm(false), refetchDocTypes);
  const submitConsType = (v: ConsTypeValues) =>
    wrap(() => apiPost(`${base}/consumable-types`, v), () => setShowConsTypeForm(false), refetchConsTypes);
  const submitDoc = (v: DocValues) => {
    if (!v.busId || !v.typeId) { setActionError(t('fleetDocs.errorMissingRequired')); return; }
    return wrap(() => apiPost(`${base}/documents`, {
      busId: v.busId, typeId: v.typeId,
      referenceNo: v.referenceNo || undefined,
      issuedAt:    v.issuedAt    || undefined,
      expiresAt:   v.expiresAt   || undefined,
      notes:       v.notes       || undefined,
    }), () => setShowDocForm(false), refetchAlerts);
  };
  const submitReplace = (v: ReplaceValues) => {
    if (!v.busId || !v.typeId) { setActionError(t('fleetDocs.errorMissingRequired')); return; }
    return wrap(() => apiPost(`${base}/consumables/replacement`, v), () => setShowReplaceForm(false));
  };

  const expiredCount  = docAlerts?.filter(d => d.status === 'EXPIRED').length  ?? 0;
  const expiringCount = docAlerts?.filter(d => d.status === 'EXPIRING').length ?? 0;
  const missingCount  = docAlerts?.filter(d => d.status === 'MISSING').length  ?? 0;
  const overdueCount  = consumables?.filter(c => c.status === 'OVERDUE').length ?? 0;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'alerts',      label: t('fleetDocs.tabAlerts') },
    { id: 'consumables', label: t('fleetDocs.tabConsumables') },
    { id: 'types',       label: t('fleetDocs.tabConfig') },
  ];

  return (
    <main className="p-6 space-y-6" role="main" aria-label={t('fleetDocs.pageTitle')}>
      {/* ── En-tête ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {t('fleetDocs.pageTitle')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t('fleetDocs.pageSubtitle')}
          </p>
        </div>
        <Button
          onClick={() => { setShowDocForm(true); setActionError(null); }}
          aria-label={t('fleetDocs.newDocument')}
        >
          <Plus className="w-4 h-4 mr-2" aria-hidden />
          {t('fleetDocs.newDocument')}
        </Button>
      </div>

      {/* ── KPIs ── */}
      <section aria-label={t('fleetDocs.pageTitle')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label={t('fleetDocs.expired')}              value={expiredCount}  icon={<AlertTriangle className="w-5 h-5" />} highlight="danger"                                   loading={loadingAlerts} />
          <StatCard label={t('fleetDocs.expiringSoon')}         value={expiringCount} icon={<Clock className="w-5 h-5" />}        highlight="warning"                                  loading={loadingAlerts} />
          <StatCard label={t('fleetDocs.missing')}              value={missingCount}  icon={<FileText className="w-5 h-5" />}     highlight="danger"                                   loading={loadingAlerts} />
          <StatCard label={t('fleetDocs.consumablesOverdue')}   value={overdueCount}  icon={<Wrench className="w-5 h-5" />}      highlight={overdueCount > 0 ? 'danger' : 'success'}  loading={loadingConsumables} />
        </div>
      </section>

      {/* ── Tabs ── */}
      <nav aria-label={t('fleetDocs.pageTitle')} role="tablist">
        <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
          {tabs.map(tb => (
            <button
              key={tb.id}
              role="tab"
              aria-selected={tab === tb.id}
              aria-controls={`tabpanel-${tb.id}`}
              id={`tab-${tb.id}`}
              onClick={() => setTab(tb.id)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
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

      {/* ── Documents en alerte ── */}
      {tab === 'alerts' && (
        <section id="tabpanel-alerts" role="tabpanel" aria-labelledby="tab-alerts" aria-live="polite">
          <Card>
            <CardHeader
              heading={t('fleetDocs.alertsHeading')}
              description={t('fleetDocs.alertsDescription')}
              action={
                <Button variant="ghost" size="sm" aria-label={t('fleetDocs.exportLabel')}>
                  {t('fleetDocs.exportLabel')}
                </Button>
              }
            />
            <CardContent className="p-0">
              {loadingAlerts ? (
                <div className="p-6 space-y-3" aria-busy="true" aria-label={t('fleetDocs.loading')}>
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : !docAlerts || docAlerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-500 dark:text-slate-400" role="status">
                  <CheckCircle2 className="w-12 h-12 mb-3 text-emerald-500" aria-hidden />
                  <p className="font-medium">{t('fleetDocs.allUpToDate')}</p>
                  <p className="text-sm mt-1">{t('fleetDocs.noActiveAlert')}</p>
                </div>
              ) : (
                <div role="table" aria-label={t('fleetDocs.alertsHeading')}>
                  <div role="rowgroup">
                    <div
                      role="row"
                      className="grid grid-cols-[1.5fr_1.5fr_1fr_1fr_0.8fr_auto] gap-3 px-6 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50"
                    >
                      <div role="columnheader">{t('fleetDocs.colBus')}</div>
                      <div role="columnheader">{t('fleetDocs.colDocType')}</div>
                      <div role="columnheader">{t('fleetDocs.colReference')}</div>
                      <div role="columnheader">{t('fleetDocs.colExpiration')}</div>
                      <div role="columnheader">{t('fleetDocs.colStatus')}</div>
                      <div role="columnheader" className="sr-only">{t('common.actions')}</div>
                    </div>
                  </div>
                  <div role="rowgroup">
                    {docAlerts.map(doc => (
                      <div
                        key={doc.id}
                        role="row"
                        className="grid grid-cols-[1.5fr_1.5fr_1fr_1fr_0.8fr_auto] gap-3 px-6 py-3 items-center border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
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
                          <Badge variant={docStatusVariant(doc.status)}>{docStatusLabel(doc.status, t)}</Badge>
                        </div>
                        <div role="cell" className="flex justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setUploadTargetId(doc.id)}
                            aria-label={t('fleetDocs.uploadScan')}
                          >
                            <Upload className="w-4 h-4 mr-1" aria-hidden />
                            {t('fleetDocs.uploadScan')}
                          </Button>
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

      {/* ── Consommables ── */}
      {tab === 'consumables' && (
        <section id="tabpanel-consumables" role="tabpanel" aria-labelledby="tab-consumables" aria-live="polite">
          <Card>
            <CardHeader
              heading={t('fleetDocs.consumablesHeading')}
              description={t('fleetDocs.consumablesDescription')}
              action={
                <Button
                  size="sm"
                  onClick={() => { setShowReplaceForm(true); setActionError(null); }}
                  aria-label={t('fleetDocs.replacement')}
                >
                  <Plus className="w-4 h-4 mr-1" aria-hidden />
                  {t('fleetDocs.replacement')}
                </Button>
              }
            />
            <CardContent className="p-0">
              {loadingConsumables ? (
                <div className="p-6 space-y-3" aria-busy="true">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
                </div>
              ) : !consumables || consumables.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-500 dark:text-slate-400" role="status">
                  <CheckCircle2 className="w-12 h-12 mb-3 text-emerald-500" aria-hidden />
                  <p className="font-medium">{t('fleetDocs.noConsumableAlert')}</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list" aria-label={t('fleetDocs.tabConsumables')}>
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
                          <Badge variant={consumableVariant(c.status)}>{consumableLabel(c.status, t)}</Badge>
                        </div>
                        <div className="flex items-center gap-3">
                          <div
                            className="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden"
                            role="progressbar"
                            aria-valuenow={progress}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${c.typeName}: ${progress}%`}
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

      {/* ── Configuration ── */}
      {tab === 'types' && (
        <section id="tabpanel-types" role="tabpanel" aria-labelledby="tab-types">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader
                heading={t('fleetDocs.docTypesHeading')}
                description={t('fleetDocs.docTypesDescription')}
                action={
                  <Button
                    size="sm"
                    onClick={() => { setShowDocTypeForm(true); setActionError(null); }}
                    aria-label={t('fleetDocs.newDocTypeTitle')}
                  >
                    <Plus className="w-4 h-4 mr-1" aria-hidden /> {t('common.add')}
                  </Button>
                }
              />
              <CardContent className="p-0">
                {loadingDocTypes ? (
                  <div className="p-6 space-y-3" aria-busy="true">
                    {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                  </div>
                ) : !documentTypes || documentTypes.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">
                    {t('fleetDocs.noDocType')}
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
                    {documentTypes.map(dt => (
                      <li key={dt.id} className="flex items-center justify-between px-4 py-3">
                        <div>
                          <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{dt.name}</p>
                          <p className="text-xs text-slate-500 font-mono">{dt.code}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {dt.validityDays && (
                            <span className="text-xs text-slate-400">{dt.validityDays}j</span>
                          )}
                          <Badge variant={dt.isMandatory ? 'warning' : 'default'} size="sm">
                            {dt.isMandatory ? t('fleetDocs.mandatory') : t('fleetDocs.optional')}
                          </Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader
                heading={t('fleetDocs.consTypesHeading')}
                description={t('fleetDocs.consTypesDescription')}
                action={
                  <Button
                    size="sm"
                    onClick={() => { setShowConsTypeForm(true); setActionError(null); }}
                    aria-label={t('fleetDocs.newConsTypeTitle')}
                  >
                    <Plus className="w-4 h-4 mr-1" aria-hidden /> {t('common.add')}
                  </Button>
                }
              />
              <CardContent className="p-0">
                {loadingConsTypes ? (
                  <div className="p-6 space-y-3" aria-busy="true">
                    {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                  </div>
                ) : !consumableTypes || consumableTypes.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">
                    {t('fleetDocs.noConsType')}
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
                    {consumableTypes.map(ct => (
                      <li key={ct.id} className="flex items-center justify-between px-4 py-3">
                        <div>
                          <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{ct.name}</p>
                          <p className="text-xs text-slate-500 font-mono">{ct.code}</p>
                        </div>
                        <span className="text-xs text-slate-400 tabular-nums">{ct.replacementKm.toLocaleString()} km</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* ── Modals CRUD ── */}
      <Dialog
        open={showDocTypeForm}
        onOpenChange={o => { if (!o) setShowDocTypeForm(false); }}
        title={t('fleetDocs.newDocTypeTitle')}
        description={t('fleetDocs.newDocTypeDesc')}
        size="lg"
      >
        {showDocTypeForm && (
          <DocumentTypeForm onSubmit={submitDocType} onCancel={() => setShowDocTypeForm(false)} busy={busy} error={actionError} />
        )}
      </Dialog>

      <Dialog
        open={showConsTypeForm}
        onOpenChange={o => { if (!o) setShowConsTypeForm(false); }}
        title={t('fleetDocs.newConsTypeTitle')}
        description={t('fleetDocs.newConsTypeDesc')}
        size="lg"
      >
        {showConsTypeForm && (
          <ConsumableTypeForm onSubmit={submitConsType} onCancel={() => setShowConsTypeForm(false)} busy={busy} error={actionError} />
        )}
      </Dialog>

      <Dialog
        open={showDocForm}
        onOpenChange={o => { if (!o) setShowDocForm(false); }}
        title={t('fleetDocs.newDocTitle')}
        description={t('fleetDocs.newDocDesc')}
        size="lg"
      >
        {showDocForm && (
          <VehicleDocumentForm
            buses={buses ?? []}
            docTypes={documentTypes ?? []}
            onSubmit={submitDoc}
            onCancel={() => setShowDocForm(false)}
            busy={busy}
            error={actionError}
          />
        )}
      </Dialog>

      <Dialog
        open={showReplaceForm}
        onOpenChange={o => { if (!o) setShowReplaceForm(false); }}
        title={t('fleetDocs.newReplacementTitle')}
        description={t('fleetDocs.newReplacementDesc')}
        size="md"
      >
        {showReplaceForm && (
          <ReplacementForm
            buses={buses ?? []}
            consTypes={consumableTypes ?? []}
            onSubmit={submitReplace}
            onCancel={() => setShowReplaceForm(false)}
            busy={busy}
            error={actionError}
          />
        )}
      </Dialog>

      <UploadScanDialog
        open={uploadTargetId !== null}
        onClose={() => setUploadTargetId(null)}
        uploadUrlEndpoint={uploadTargetId ? `${base}/documents/${uploadTargetId}/upload-url` : ''}
        onUploaded={async () => { await refetchAlerts(); }}
        accept=".pdf,.jpg,.jpeg,.png,.webp"
      />
    </main>
  );
}
