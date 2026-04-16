/**
 * PageFleetDocs — Documents réglementaires & consommables véhicules
 *
 * Module Fleet Docs : suivi des documents (assurance, carte grise, CT…)
 * et consommables (pneus, vidange…) avec alertes prédictives.
 *
 * Accessibilité : WCAG 2.1 AA — aria-labels, rôles, focus visible, contrast 4.5:1
 * Dark mode : classes Tailwind dark: — automatique via ThemeProvider
 */

import { useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, Clock, FileText, Wrench, Plus } from 'lucide-react';
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

// ─── i18n ────────────────────────────────────────────────────────────────────

const T = {
  // Page
  pageTitle:              tm('Documents & Consommables', 'Documents & Consumables'),
  pageSubtitle:           tm('Suivi réglementaire et maintenance prédictive de la flotte', 'Regulatory tracking and predictive fleet maintenance'),
  newDocument:            tm('Nouveau document', 'New Document'),
  // KPIs
  expired:                tm('Expirés', 'Expired'),
  expiringSoon:           tm('Expirent bientôt', 'Expiring Soon'),
  missing:                tm('Manquants', 'Missing'),
  consumablesOverdue:     tm('Consommables dépassés', 'Consumables Overdue'),
  // Tabs
  tabAlerts:              tm('Documents en alerte', 'Document Alerts'),
  tabConsumables:         tm('Consommables', 'Consumables'),
  tabConfig:              tm('Configuration', 'Configuration'),
  // Doc status
  statusExpired:          tm('Expiré', 'Expired'),
  statusExpiring:         tm('Expire bientôt', 'Expiring Soon'),
  statusMissing:          tm('Manquant', 'Missing'),
  // Consumable status
  statusOverdue:          tm('Dépassé', 'Overdue'),
  statusAlert:            tm('Alerte', 'Alert'),
  // Alerts section
  alertsHeading:          tm('Documents en alerte', 'Document Alerts'),
  alertsDescription:      tm('Documents expirés, expirant sous 30 jours ou manquants', 'Documents expired, expiring within 30 days, or missing'),
  exportLabel:            tm('Exporter', 'Export'),
  allUpToDate:            tm('Tous les documents sont à jour', 'All documents are up to date'),
  noActiveAlert:          tm('Aucune alerte documentaire active', 'No active document alerts'),
  colBus:                 tm('Bus', 'Bus'),
  colDocType:             tm('Type de document', 'Document Type'),
  colReference:           tm('Référence', 'Reference'),
  colExpiration:          tm('Expiration', 'Expiration'),
  colStatus:              tm('Statut', 'Status'),
  // Consumables section
  consumablesHeading:     tm('Suivi consommables', 'Consumable Tracking'),
  consumablesDescription: tm('Pneus, vidange, filtres — alertes basées sur le kilométrage réel', 'Tires, oil change, filters — alerts based on actual mileage'),
  replacement:            tm('Remplacement', 'Replacement'),
  noConsumableAlert:      tm('Aucun consommable en alerte', 'No consumable alerts'),
  // Config section
  docTypesHeading:        tm('Types de documents', 'Document Types'),
  docTypesDescription:    tm('Catalogue réglementaire configuré pour ce tenant', 'Regulatory catalog configured for this tenant'),
  consTypesHeading:       tm('Types de consommables', 'Consumable Types'),
  consTypesDescription:   tm('Pneus, vidange, filtres avec seuils kilométriques', 'Tires, oil change, filters with mileage thresholds'),
  noDocType:              tm('Aucun type de document configuré', 'No document type configured'),
  noConsType:             tm('Aucun type de consommable configuré', 'No consumable type configured'),
  mandatory:              tm('Obligatoire', 'Mandatory'),
  optional:               tm('Optionnel', 'Optional'),
  mandatoryDoc:           tm('Document obligatoire', 'Mandatory document'),
  // Forms
  code:                   tm('Code', 'Code'),
  alertDaysBefore:        tm('Alerte (j avant expiration)', 'Alert (days before expiry)'),
  nominalLifetimeKm:      tm('Durée nominale (km)', 'Nominal Lifetime (km)'),
  alertKmBefore:          tm('Alerte (km avant expiration)', 'Alert (km before expiry)'),
  vehicle:                tm('Véhicule', 'Vehicle'),
  noVehicle:              tm('Aucun véhicule', 'No vehicle'),
  consumable:             tm('Consommable', 'Consumable'),
  noConsumable:           tm('Aucun consommable', 'No consumable'),
  reference:              tm('Référence', 'Reference'),
  refPlaceholder:         tm("N° d'immatriculation du document", 'Document registration number'),
  issuedAt:               tm('Émis le', 'Issued On'),
  expiresAt:              tm('Expire le', 'Expires On'),
  notes:                  tm('Notes', 'Notes'),
  mileageAtReplacement:   tm('Kilométrage au remplacement', 'Mileage at Replacement'),
  // Dialogs
  newDocTypeTitle:        tm('Nouveau type de document', 'New Document Type'),
  newDocTypeDesc:         tm('Configurer un document véhicule réglementaire pour ce tenant.', 'Configure a regulatory vehicle document for this tenant.'),
  newConsTypeTitle:       tm('Nouveau type de consommable', 'New Consumable Type'),
  newConsTypeDesc:        tm('Seuils kilométriques pour la maintenance prédictive.', 'Mileage thresholds for predictive maintenance.'),
  newDocTitle:            tm('Nouveau document véhicule', 'New Vehicle Document'),
  newDocDesc:             tm('Associer un document (assurance, CT, carte grise…) à un véhicule.', 'Associate a document (insurance, MOT, registration...) with a vehicle.'),
  newReplacementTitle:    tm('Enregistrer un remplacement', 'Record a Replacement'),
  newReplacementDesc:     tm('Pneus, vidange ou filtres — le prochain seuil d\'alerte est recalculé automatiquement.', 'Tires, oil change, or filters — the next alert threshold is recalculated automatically.'),
  noType:                 tm('Aucun type', 'No type'),
  loading:                tm('chargement', 'loading'),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function docStatusVariant(s: string): 'danger' | 'warning' | 'default' {
  if (s === 'EXPIRED' || s === 'MISSING') return 'danger';
  if (s === 'EXPIRING') return 'warning';
  return 'default';
}

function docStatusLabel(s: string, t: (m: Record<string, string>) => string): string {
  if (s === 'EXPIRED')  return t('LFleetDocs.statusExpired');
  if (s === 'EXPIRING') return t('LFleetDocs.statusExpiring');
  if (s === 'MISSING')  return t('LFleetDocs.statusMissing');
  return s;
}

function consumableVariant(s: string): 'danger' | 'warning' | 'success' {
  if (s === 'OVERDUE') return 'danger';
  if (s === 'ALERT')   return 'warning';
  return 'success';
}

function consumableLabel(s: string, t: (m: Record<string, string>) => string): string {
  if (s === 'OVERDUE') return t('LFleetDocs.statusOverdue');
  if (s === 'ALERT')   return t('LFleetDocs.statusAlert');
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
      aria-label={`${label}: ${loading ? T.loading.fr : value}`}
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
            {t('LFleetDocs.code')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input id="dt-code" type="text" required value={f.code}
            onChange={e => setF(p => ({ ...p, code: e.target.value.toUpperCase() }))}
            className={cn(inputClass, 'font-mono')} disabled={busy} placeholder="CARTE_GRISE" maxLength={32} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="dt-alert" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LFleetDocs.alertDaysBefore')}
          </label>
          <input id="dt-alert" type="number" min={1} value={f.alertDaysBeforeExpiry}
            onChange={e => setF(p => ({ ...p, alertDaysBeforeExpiry: Math.max(1, Number(e.target.value)) }))}
            className={inputClass} disabled={busy} />
        </div>
        <label className="sm:col-span-2 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input type="checkbox" checked={f.isMandatory} onChange={e => setF(p => ({ ...p, isMandatory: e.target.checked }))}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500" disabled={busy} />
          {t('LFleetDocs.mandatoryDoc')}
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
            {t('LFleetDocs.code')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input id="ct-code" type="text" required value={f.code}
            onChange={e => setF(p => ({ ...p, code: e.target.value.toUpperCase() }))}
            className={cn(inputClass, 'font-mono')} disabled={busy} placeholder="PNEU_AV" maxLength={32} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ct-life" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LFleetDocs.nominalLifetimeKm')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input id="ct-life" type="number" min={1} required value={f.nominalLifetimeKm}
            onChange={e => setF(p => ({ ...p, nominalLifetimeKm: Math.max(1, Number(e.target.value)) }))}
            className={inputClass} disabled={busy} />
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <label htmlFor="ct-alert" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LFleetDocs.alertKmBefore')} <span aria-hidden className="text-red-500">*</span>
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
  return (
    <form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}>
      <ErrorAlert error={error} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="doc-bus" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LFleetDocs.vehicle')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <select id="doc-bus" required value={f.busId} onChange={e => setF(p => ({ ...p, busId: e.target.value }))}
            className={inputClass} disabled={busy || buses.length === 0}>
            {buses.length === 0 && <option value="">{t('LFleetDocs.noVehicle')}</option>}
            {buses.map(b => <option key={b.id} value={b.id}>{b.plateNumber}{b.model ? ` — ${b.model}` : ''}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="doc-type" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('common.type')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <select id="doc-type" required value={f.typeId} onChange={e => setF(p => ({ ...p, typeId: e.target.value }))}
            className={inputClass} disabled={busy || docTypes.length === 0}>
            {docTypes.length === 0 && <option value="">{t('LFleetDocs.noType')}</option>}
            {docTypes.map(dt => <option key={dt.id} value={dt.id}>{dt.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <label htmlFor="doc-ref" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LFleetDocs.reference')}
          </label>
          <input id="doc-ref" type="text" value={f.referenceNo}
            onChange={e => setF(p => ({ ...p, referenceNo: e.target.value }))}
            className={cn(inputClass, 'font-mono')} disabled={busy} placeholder={t('LFleetDocs.refPlaceholder')} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="doc-issued" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LFleetDocs.issuedAt')}
          </label>
          <input id="doc-issued" type="date" value={f.issuedAt}
            onChange={e => setF(p => ({ ...p, issuedAt: e.target.value }))}
            className={inputClass} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="doc-expires" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LFleetDocs.expiresAt')}
          </label>
          <input id="doc-expires" type="date" value={f.expiresAt}
            onChange={e => setF(p => ({ ...p, expiresAt: e.target.value }))}
            className={inputClass} disabled={busy} />
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <label htmlFor="doc-notes" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LFleetDocs.notes')}
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
  return (
    <form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}>
      <ErrorAlert error={error} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="rep-bus" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LFleetDocs.vehicle')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <select id="rep-bus" required value={f.busId} onChange={e => setF(p => ({ ...p, busId: e.target.value }))}
            className={inputClass} disabled={busy || buses.length === 0}>
            {buses.length === 0 && <option value="">{t('LFleetDocs.noVehicle')}</option>}
            {buses.map(b => <option key={b.id} value={b.id}>{b.plateNumber}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="rep-type" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LFleetDocs.consumable')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <select id="rep-type" required value={f.typeId} onChange={e => setF(p => ({ ...p, typeId: e.target.value }))}
            className={inputClass} disabled={busy || consTypes.length === 0}>
            {consTypes.length === 0 && <option value="">{t('LFleetDocs.noConsumable')}</option>}
            {consTypes.map(ct => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <label htmlFor="rep-km" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LFleetDocs.mileageAtReplacement')} <span aria-hidden className="text-red-500">*</span>
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
  const submitDoc = (v: DocValues) =>
    wrap(() => apiPost(`${base}/documents`, {
      busId: v.busId, typeId: v.typeId,
      referenceNo: v.referenceNo || undefined,
      issuedAt:    v.issuedAt    || undefined,
      expiresAt:   v.expiresAt   || undefined,
      notes:       v.notes       || undefined,
    }), () => setShowDocForm(false), refetchAlerts);
  const submitReplace = (v: ReplaceValues) =>
    wrap(() => apiPost(`${base}/consumables/replacement`, v), () => setShowReplaceForm(false));

  const expiredCount  = docAlerts?.filter(d => d.status === 'EXPIRED').length  ?? 0;
  const expiringCount = docAlerts?.filter(d => d.status === 'EXPIRING').length ?? 0;
  const missingCount  = docAlerts?.filter(d => d.status === 'MISSING').length  ?? 0;
  const overdueCount  = consumables?.filter(c => c.status === 'OVERDUE').length ?? 0;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'alerts',      label: t('LFleetDocs.tabAlerts') },
    { id: 'consumables', label: t('LFleetDocs.tabConsumables') },
    { id: 'types',       label: t('LFleetDocs.tabConfig') },
  ];

  return (
    <main className="p-6 space-y-6" role="main" aria-label={t('LFleetDocs.pageTitle')}>
      {/* ── En-tête ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {t('LFleetDocs.pageTitle')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t('LFleetDocs.pageSubtitle')}
          </p>
        </div>
        <Button
          onClick={() => { setShowDocForm(true); setActionError(null); }}
          aria-label={t('LFleetDocs.newDocument')}
        >
          <Plus className="w-4 h-4 mr-2" aria-hidden />
          {t('LFleetDocs.newDocument')}
        </Button>
      </div>

      {/* ── KPIs ── */}
      <section aria-label={t('LFleetDocs.pageTitle')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label={t('LFleetDocs.expired')}              value={expiredCount}  icon={<AlertTriangle className="w-5 h-5" />} highlight="danger"                                   loading={loadingAlerts} />
          <StatCard label={t('LFleetDocs.expiringSoon')}         value={expiringCount} icon={<Clock className="w-5 h-5" />}        highlight="warning"                                  loading={loadingAlerts} />
          <StatCard label={t('LFleetDocs.missing')}              value={missingCount}  icon={<FileText className="w-5 h-5" />}     highlight="danger"                                   loading={loadingAlerts} />
          <StatCard label={t('LFleetDocs.consumablesOverdue')}   value={overdueCount}  icon={<Wrench className="w-5 h-5" />}      highlight={overdueCount > 0 ? 'danger' : 'success'}  loading={loadingConsumables} />
        </div>
      </section>

      {/* ── Tabs ── */}
      <nav aria-label={t('LFleetDocs.pageTitle')} role="tablist">
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
              heading={t('LFleetDocs.alertsHeading')}
              description={t('LFleetDocs.alertsDescription')}
              action={
                <Button variant="ghost" size="sm" aria-label={t('LFleetDocs.exportLabel')}>
                  {t('LFleetDocs.exportLabel')}
                </Button>
              }
            />
            <CardContent className="p-0">
              {loadingAlerts ? (
                <div className="p-6 space-y-3" aria-busy="true" aria-label={t('LFleetDocs.loading')}>
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : !docAlerts || docAlerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-500 dark:text-slate-400" role="status">
                  <CheckCircle2 className="w-12 h-12 mb-3 text-emerald-500" aria-hidden />
                  <p className="font-medium">{t('LFleetDocs.allUpToDate')}</p>
                  <p className="text-sm mt-1">{t('LFleetDocs.noActiveAlert')}</p>
                </div>
              ) : (
                <div role="table" aria-label={t('LFleetDocs.alertsHeading')}>
                  <div role="rowgroup">
                    <div
                      role="row"
                      className="grid grid-cols-5 px-6 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50"
                    >
                      <div role="columnheader">{t('LFleetDocs.colBus')}</div>
                      <div role="columnheader">{t('LFleetDocs.colDocType')}</div>
                      <div role="columnheader">{t('LFleetDocs.colReference')}</div>
                      <div role="columnheader">{t('LFleetDocs.colExpiration')}</div>
                      <div role="columnheader">{t('LFleetDocs.colStatus')}</div>
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
                          <Badge variant={docStatusVariant(doc.status)}>{docStatusLabel(doc.status, t)}</Badge>
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
              heading={t('LFleetDocs.consumablesHeading')}
              description={t('LFleetDocs.consumablesDescription')}
              action={
                <Button
                  size="sm"
                  onClick={() => { setShowReplaceForm(true); setActionError(null); }}
                  aria-label={t('LFleetDocs.replacement')}
                >
                  <Plus className="w-4 h-4 mr-1" aria-hidden />
                  {t('LFleetDocs.replacement')}
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
                  <p className="font-medium">{t('LFleetDocs.noConsumableAlert')}</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list" aria-label={t('LFleetDocs.tabConsumables')}>
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
                heading={t('LFleetDocs.docTypesHeading')}
                description={t('LFleetDocs.docTypesDescription')}
                action={
                  <Button
                    size="sm"
                    onClick={() => { setShowDocTypeForm(true); setActionError(null); }}
                    aria-label={t('LFleetDocs.newDocTypeTitle')}
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
                    {t('LFleetDocs.noDocType')}
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
                            {dt.isMandatory ? t('LFleetDocs.mandatory') : t('LFleetDocs.optional')}
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
                heading={t('LFleetDocs.consTypesHeading')}
                description={t('LFleetDocs.consTypesDescription')}
                action={
                  <Button
                    size="sm"
                    onClick={() => { setShowConsTypeForm(true); setActionError(null); }}
                    aria-label={t('LFleetDocs.newConsTypeTitle')}
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
                    {t('LFleetDocs.noConsType')}
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
        title={t('LFleetDocs.newDocTypeTitle')}
        description={t('LFleetDocs.newDocTypeDesc')}
        size="lg"
      >
        {showDocTypeForm && (
          <DocumentTypeForm onSubmit={submitDocType} onCancel={() => setShowDocTypeForm(false)} busy={busy} error={actionError} />
        )}
      </Dialog>

      <Dialog
        open={showConsTypeForm}
        onOpenChange={o => { if (!o) setShowConsTypeForm(false); }}
        title={t('LFleetDocs.newConsTypeTitle')}
        description={t('LFleetDocs.newConsTypeDesc')}
        size="lg"
      >
        {showConsTypeForm && (
          <ConsumableTypeForm onSubmit={submitConsType} onCancel={() => setShowConsTypeForm(false)} busy={busy} error={actionError} />
        )}
      </Dialog>

      <Dialog
        open={showDocForm}
        onOpenChange={o => { if (!o) setShowDocForm(false); }}
        title={t('LFleetDocs.newDocTitle')}
        description={t('LFleetDocs.newDocDesc')}
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
        title={t('LFleetDocs.newReplacementTitle')}
        description={t('LFleetDocs.newReplacementDesc')}
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
    </main>
  );
}
