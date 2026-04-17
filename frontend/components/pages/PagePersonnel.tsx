/**
 * PagePersonnel — Gestion du personnel (Staff)
 *
 * CRUD : lister · créer · modifier · suspendre/réactiver · archiver · gérer affectations
 *        · promouvoir depuis IAM
 *
 * Phase 4 (DESIGN_Staff_Assignment.md §6) : un Staff est l'enveloppe RH ;
 * ses postes occupés sont des StaffAssignment[] gérables via Dialog dédié.
 *
 * Données :
 *   GET    /api/tenants/:tid/staff                          liste (avec assignments[])
 *   POST   /api/tenants/:tid/staff                          créer Staff (+ User)
 *   GET    /api/tenants/:tid/staff/eligible-users           users IAM sans Staff
 *   POST   /api/tenants/:tid/staff/from-user/:userId        promouvoir un user IAM
 *   PATCH  /api/tenants/:tid/staff/:userId                  modifier
 *   PATCH  /api/tenants/:tid/staff/:userId/suspend          suspendre
 *   PATCH  /api/tenants/:tid/staff/:userId/reactivate       réactiver
 *   DELETE /api/tenants/:tid/staff/:userId                  archiver
 *   POST   /api/tenants/:tid/staff/:userId/assignments      ajouter affectation
 *   PATCH  /api/tenants/:tid/assignments/:id/close          clore affectation
 */

import { useState, type FormEvent } from 'react';
import {
  IdCard, Plus, Pencil, Power, Archive, X, UserCircle, Briefcase, Users, Globe2, MapPin,
} from 'lucide-react';
import { useFetch }                from '../../lib/hooks/useFetch';
import { apiPost, apiPatch, apiDelete } from '../../lib/api';
import { useAuth }                 from '../../lib/auth/auth.context';
import { useI18n }             from '../../lib/i18n/useI18n';
import { Button }                  from '../ui/Button';
import { Badge }                   from '../ui/Badge';
import { Dialog }                  from '../ui/Dialog';
import { ErrorAlert }              from '../ui/ErrorAlert';
import { FormFooter }              from '../ui/FormFooter';
import { inputClass as inp }       from '../ui/inputClass';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';
import { DocumentAttachments } from '../document/DocumentAttachments';
import { DriverLicensePanel } from '../drivers/DriverLicensePanel';

// ─── Types ────────────────────────────────────────────────────────────────────

type StaffRole   = 'DRIVER' | 'HOSTESS' | 'MECHANIC' | 'AGENT' | 'CONTROLLER' | 'SUPERVISOR';
type StaffStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

interface AssignmentSummary {
  id:          string;
  role:        string;
  agencyId:    string | null;
  status:      string;
  isAvailable: boolean;
  startDate:   string;
}

interface StaffRow {
  id:            string;
  userId:        string;
  tenantId:      string;
  agencyId:      string | null;
  status:        StaffStatus | string;
  hireDate:      string;
  createdAt:     string;
  assignments?:  AssignmentSummary[];          // postes actifs (lus depuis StaffAssignment)
  user: {
    id:    string;
    email: string;
    name:  string | null;
  };
}

interface AssignmentSummary {
  id:          string;
  role:        string;
  agencyId:    string | null;
  status:      string;
  isAvailable: boolean;
  startDate:   string;
}

interface AssignmentDetail {
  id:          string;
  role:        string;
  agencyId:    string | null;
  status:      string;
  isAvailable: boolean;
  startDate:   string;
  endDate:     string | null;
  agency:      { id: string; name: string } | null;
  coverageAgencies: { agencyId: string; agency: { id: string; name: string } }[];
}

interface EligibleUser {
  id:       string;
  email:    string;
  name:     string | null;
  agencyId: string | null;
  agency:   { id: string; name: string } | null;
}

type Coverage = 'mono' | 'tenant' | 'multi';

interface NewAssignmentForm {
  role:              StaffRole;
  coverage:          Coverage;
  agencyId:          string;
  coverageAgencyIds: string[];
}

interface PromoteForm {
  userId:   string;
  role:     StaffRole;
  agencyId: string;
}

interface CreateForm {
  email:    string;
  name:     string;
  role:     StaffRole;
  agencyId: string;   // '' = aucune
}

interface AgencyOption { id: string; name: string }

interface EditForm {
  name:     string;
  agencyId: string;   // home administrative — rôle/dispo gérés via AssignmentsManager
}

const ROLE_OPTIONS: { value: StaffRole; label: string }[] = [
  { value: 'DRIVER',     label: 'personnel.roleDriver' },
  { value: 'HOSTESS',    label: 'personnel.roleHostess' },
  { value: 'MECHANIC',   label: 'personnel.roleMechanic' },
  { value: 'AGENT',      label: 'personnel.roleAgent' },
  { value: 'CONTROLLER', label: 'personnel.roleController' },
  { value: 'SUPERVISOR', label: 'personnel.roleSupervisor' },
];

// ─── Colonnes ─────────────────────────────────────────────────────────────────

function buildColumns(t: (k: string | Record<string, string | undefined>) => string): Column<StaffRow>[] {
  const roleLabel = (value: string): string =>
    t(ROLE_OPTIONS.find(r => r.value === value)?.label ?? value);

  return [
    {
      key: 'user',
      header: t('personnel.member'),
      sortable: true,
      cellRenderer: (_v, row) => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
            <UserCircle className="w-5 h-5 text-slate-400" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
              {row.user?.name ?? '—'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{row.user?.email}</p>
          </div>
        </div>
      ),
      csvValue: (_v, row) => `${row.user?.name ?? ''} <${row.user?.email ?? ''}>`,
    },
    {
      key: 'assignments',
      header: t('personnel.assignments'),
      cellRenderer: (_v, row) => {
        const list = row.assignments ?? [];
        if (list.length === 0) {
          return <span className="text-xs text-slate-400 italic">{t('personnel.noActiveAssignment')}</span>;
        }
        return (
          <div className="flex flex-wrap gap-1.5">
            {list.map(a => (
              <Badge key={a.id} variant={a.isAvailable ? 'info' : 'default'}>
                {roleLabel(a.role)}
              </Badge>
            ))}
          </div>
        );
      },
      csvValue: (_v, row) => (row.assignments ?? []).map(a => roleLabel(a.role)).join(', '),
    },
    {
      key: 'status',
      header: t('personnel.statusLabel'),
      sortable: true,
      width: '120px',
      cellRenderer: (v) => {
        const s = String(v);
        if (s === 'ACTIVE')    return <Badge variant="success">{t('personnel.statusActive')}</Badge>;
        if (s === 'SUSPENDED') return <Badge variant="warning">{t('personnel.statusSuspended')}</Badge>;
        if (s === 'ARCHIVED')  return <Badge variant="default">{t('personnel.statusArchived')}</Badge>;
        return <Badge variant="default">{s}</Badge>;
      },
      csvValue: (v) => String(v),
    },
    {
      key: 'availability',
      header: t('personnel.available'),
      width: '90px',
      align: 'center',
      cellRenderer: (_v, row) => {
        const available = row.assignments?.some(a => a.isAvailable) ?? false;
        return (
          <span
            aria-label={available ? 'Disponible' : 'Indisponible'}
            className={
              'inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ' +
              (available
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400')
            }
          >
            <span className={'h-1.5 w-1.5 rounded-full ' + (available ? 'bg-emerald-500' : 'bg-slate-400')} aria-hidden />
            {available ? t('common.yes') : t('common.no')}
          </span>
        );
      },
      csvValue: (_v, row) => (row.assignments?.some(a => a.isAvailable) ? 'oui' : 'non'),
    },
    {
      key: 'createdAt',
      header: t('personnel.hired'),
      sortable: true,
      width: '110px',
      cellRenderer: (v) => (
        <span className="text-xs text-slate-400">
          {new Date(String(v)).toLocaleDateString('fr-FR')}
        </span>
      ),
      csvValue: (v) => new Date(String(v)).toLocaleDateString('fr-FR'),
    },
  ];
}

// ─── Form base ────────────────────────────────────────────────────────────────

function CreateStaffForm({ onSubmit, onCancel, busy, error, agencies }: {
  onSubmit: (f: CreateForm) => void;
  onCancel: () => void;
  busy:     boolean;
  error:    string | null;
  agencies: AgencyOption[];
}) {
  const { t } = useI18n();
  const [f, setF] = useState<CreateForm>({
    email: '', name: '', role: 'DRIVER', agencyId: '',
  });
  const set = <K extends keyof CreateForm>(k: K, v: CreateForm[K]) =>
    setF(p => ({ ...p, [k]: v }));

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      <ErrorAlert error={error} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('common.email')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="email" required value={f.email}
            onChange={e => set('email', e.target.value)}
            className={inp} disabled={busy} placeholder="prenom.nom@example.com"
            autoComplete="email" />
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('personnel.fullName')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="text" required value={f.name}
            onChange={e => set('name', e.target.value)}
            className={inp} disabled={busy} placeholder="Jean Dupont"
            autoComplete="name" />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('personnel.function_')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <select value={f.role}
            onChange={e => set('role', e.target.value as StaffRole)}
            className={inp} disabled={busy}>
            {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{t(r.label)}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('common.agency')}
          </label>
          <select value={f.agencyId}
            onChange={e => set('agencyId', e.target.value)}
            className={inp} disabled={busy}>
            <option value="">{t('personnel.noAgency')}</option>
            {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>
      <FormFooter onCancel={onCancel} busy={busy} submitLabel={t('personnel.createFooter')} pendingLabel={t('personnel.creatingFooter')} />
    </form>
  );
}

function EditStaffForm({ staff, tenantId, onSubmit, onCancel, busy, error, agencies, onPreviewChange }: {
  staff:    StaffRow;
  tenantId: string;
  onSubmit: (f: EditForm) => void;
  onCancel: () => void;
  busy:     boolean;
  error:    string | null;
  agencies: AgencyOption[];
  onPreviewChange?: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<EditForm>({
    name:     staff.user?.name ?? '',
    agencyId: staff.agencyId ?? '',
  });
  const set = <K extends keyof EditForm>(k: K, v: EditForm[K]) =>
    setF(p => ({ ...p, [k]: v }));

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      <ErrorAlert error={error} />
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{t('personnel.fullName')}</label>
          <input type="text" value={f.name}
            onChange={e => set('name', e.target.value)}
            className={inp} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('personnel.homeAgency')}
          </label>
          <select value={f.agencyId}
            onChange={e => set('agencyId', e.target.value)}
            className={inp} disabled={busy}>
            <option value="">{t('personnel.noAgency')}</option>
            {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <p className="text-xs text-slate-400">
            {t('personnel.editHint')}
          </p>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2">
          <p>{t('personnel.emailLabel')} : <span className="font-mono">{staff.user?.email}</span></p>
          <p>{t('personnel.statusLabel')} : {staff.status}</p>
        </div>

        {/* Permis de conduire (source unique) */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
          <DriverLicensePanel
            tenantId={tenantId}
            staffId={staff.id}
            staffLabel={staff.user?.name ?? staff.user?.email}
          />
        </div>

        {/* Pièces jointes (contrat, certifications — hors permis) */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">{t('personnel.attachments')}</h3>
          <DocumentAttachments
            tenantId={tenantId}
            entityType="STAFF"
            entityId={staff.userId}
            allowedKinds={['CONTRACT', 'ID_CARD', 'CERTIFICATE', 'PHOTO', 'OTHER']}
            onPreviewChange={onPreviewChange}
          />
        </div>
      </div>
      <FormFooter onCancel={onCancel} busy={busy} submitLabel={t('common.save')} pendingLabel={t('common.saving')} />
    </form>
  );
}

// ─── Dialog : Gérer les affectations d'un Staff ──────────────────────────────

function AssignmentsManager({ staff, tenantId, agencies, busy, onAction, onError }: {
  staff:     StaffRow;
  tenantId:  string;
  agencies:  AgencyOption[];
  busy:      boolean;
  onAction:  () => void;                       // callback after mutation pour refetch
  onError:   (msg: string) => void;
}) {
  const { t } = useI18n();
  const roleLabel = (value: string): string =>
    t(ROLE_OPTIONS.find(r => r.value === value)?.label ?? value);

  const url = `/api/tenants/${tenantId}/staff/${staff.userId}/assignments`;
  const { data: list, refetch } = useFetch<AssignmentDetail[]>(url, [staff.userId]);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<NewAssignmentForm>({
    role: 'DRIVER', coverage: 'mono', agencyId: '', coverageAgencyIds: [],
  });

  const setF = <K extends keyof NewAssignmentForm>(k: K, v: NewAssignmentForm[K]) =>
    setForm(p => ({ ...p, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    onError('');
    try {
      const body: Record<string, unknown> = { role: form.role };
      if (form.coverage === 'mono') {
        if (!form.agencyId) { onError(t('personnel.selectError')); return; }
        body.agencyId = form.agencyId;
      } else if (form.coverage === 'multi') {
        if (form.coverageAgencyIds.length === 0) { onError(t('personnel.selectMultiError')); return; }
        body.coverageAgencyIds = form.coverageAgencyIds;
      } // tenant : rien à envoyer

      await apiPost(url, body);
      setShowAdd(false);
      setForm({ role: 'DRIVER', coverage: 'mono', agencyId: '', coverageAgencyIds: [] });
      refetch();
      onAction();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const close = async (id: string) => {
    onError('');
    try {
      await apiPatch(`/api/tenants/${tenantId}/assignments/${id}/close`);
      refetch();
      onAction();
    } catch (err) { onError((err as Error).message); }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {(list ?? []).map(a => {
          const closed = a.status === 'CLOSED';
          const coverageLabel = a.agencyId
            ? a.agency?.name ?? a.agencyId
            : a.coverageAgencies.length > 0
              ? a.coverageAgencies.map(c => c.agency.name).join(', ')
              : t('personnel.allTenant');
          const CoverageIcon = a.agencyId ? MapPin : a.coverageAgencies.length > 0 ? Users : Globe2;

          return (
            <div key={a.id}
              className={'flex items-center justify-between gap-3 rounded-lg border p-3 ' +
                (closed
                  ? 'border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50 opacity-60'
                  : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800')}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="info">{roleLabel(a.role)}</Badge>
                  {a.status === 'SUSPENDED' && <Badge variant="warning">{t('personnel.suspendedBadge')}</Badge>}
                  {a.status === 'CLOSED'    && <Badge variant="default">{t('personnel.closedBadge')}</Badge>}
                  {a.status === 'ACTIVE' && !a.isAvailable && <Badge variant="default">{t('personnel.unavailableBadge')}</Badge>}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                  <CoverageIcon className="w-3.5 h-3.5" aria-hidden /> {coverageLabel}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {t('personnel.sinceDate')} {new Date(a.startDate).toLocaleDateString('fr-FR')}
                  {a.endDate && ` — ${t('personnel.closedDate')} ${new Date(a.endDate).toLocaleDateString('fr-FR')}`}
                </p>
              </div>
              {!closed && (
                <Button variant="outline" onClick={() => close(a.id)} disabled={busy}>
                  <Archive className="w-3.5 h-3.5 mr-1" aria-hidden /> {t('personnel.closeAssignment')}
                </Button>
              )}
            </div>
          );
        })}
        {(list ?? []).length === 0 && (
          <p className="text-sm text-slate-500 italic text-center py-4">
            {t('personnel.noAssignment')}
          </p>
        )}
      </div>

      {!showAdd && (
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4 mr-1.5" aria-hidden /> {t('personnel.addAssignment')}
        </Button>
      )}

      {showAdd && (
        <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 p-4 bg-slate-50 dark:bg-slate-900/50">
          <h4 className="text-sm font-semibold">{t('personnel.newAssignment')}</h4>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium">{t('common.role')}</label>
            <select value={form.role} onChange={e => setF('role', e.target.value as StaffRole)}
              className={inp} disabled={busy}>
              {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{t(r.label)}</option>)}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium">{t('personnel.coverage')}</label>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="cov" checked={form.coverage === 'mono'}
                  onChange={() => setF('coverage', 'mono')} disabled={busy} />
                {t('personnel.monoAgency')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="cov" checked={form.coverage === 'tenant'}
                  onChange={() => setF('coverage', 'tenant')} disabled={busy} />
                {t('personnel.tenantWide')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="cov" checked={form.coverage === 'multi'}
                  onChange={() => setF('coverage', 'multi')} disabled={busy} />
                {t('personnel.multiAgency')}
              </label>
            </div>
          </div>

          {form.coverage === 'mono' && (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('common.agency')}</label>
              <select value={form.agencyId} onChange={e => setF('agencyId', e.target.value)}
                className={inp} disabled={busy}>
                <option value="">{t('personnel.selectAgency')}</option>
                {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}

          {form.coverage === 'multi' && (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('personnel.coveredAgencies')}</label>
              <div className="max-h-40 overflow-y-auto space-y-1 rounded border border-slate-200 dark:border-slate-700 p-2">
                {agencies.map(a => (
                  <label key={a.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox"
                      checked={form.coverageAgencyIds.includes(a.id)}
                      onChange={e => {
                        const set = new Set(form.coverageAgencyIds);
                        if (e.target.checked) set.add(a.id); else set.delete(a.id);
                        setF('coverageAgencyIds', Array.from(set));
                      }}
                      disabled={busy} />
                    {a.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          <FormFooter onCancel={() => setShowAdd(false)} busy={busy} submitLabel={t('personnel.addFooter')} pendingLabel={t('personnel.addingFooter')} />
        </form>
      )}
    </div>
  );
}

// ─── Dialog : Promouvoir un user IAM en Staff ────────────────────────────────

function PromoteFromIamForm({ tenantId, agencies, busy, onSubmit, onCancel, error }: {
  tenantId: string;
  agencies: AgencyOption[];
  busy:     boolean;
  onSubmit: (f: PromoteForm) => void;
  onCancel: () => void;
  error:    string | null;
}) {
  const { t } = useI18n();
  const { data: users, loading } = useFetch<EligibleUser[]>(
    `/api/tenants/${tenantId}/staff/eligible-users`, [tenantId],
  );
  const [f, setF] = useState<PromoteForm>({ userId: '', role: 'DRIVER', agencyId: '' });
  const set = <K extends keyof PromoteForm>(k: K, v: PromoteForm[K]) =>
    setF(p => ({ ...p, [k]: v }));

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      <ErrorAlert error={error} />
      {loading && <p className="text-sm text-slate-500">{t('personnel.loadingIamUsers')}</p>}
      {!loading && (users ?? []).length === 0 && (
        <p className="text-sm text-slate-500">
          {t('personnel.noEligibleUsers')}
        </p>
      )}
      {!loading && (users ?? []).length > 0 && (
        <p className="text-xs text-slate-400">
          {(users ?? []).length} {t('personnel.eligibleCount')}
        </p>
      )}
      {!loading && (users ?? []).length > 0 && (
        <>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium">{t('personnel.iamUser')}</label>
            <select value={f.userId} onChange={e => set('userId', e.target.value)}
              className={inp} required disabled={busy}>
              <option value="">{t('personnel.selectAgency')}</option>
              {(users ?? []).map(u => (
                <option key={u.id} value={u.id}>
                  {u.name ?? u.email} ({u.email}{u.agency ? ` · ${u.agency.name}` : ''})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('personnel.initialRole')}</label>
              <select value={f.role} onChange={e => set('role', e.target.value as StaffRole)}
                className={inp} disabled={busy}>
                {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{t(r.label)}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('personnel.homeAgency')}</label>
              <select value={f.agencyId} onChange={e => set('agencyId', e.target.value)}
                className={inp} disabled={busy}>
                <option value="">{t('personnel.noAgencyShort')}</option>
                {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
        </>
      )}
      <FormFooter onCancel={onCancel} busy={busy} submitLabel={t('personnel.promote')} pendingLabel="..." />
    </form>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function PagePersonnel() {
  const { user: me } = useAuth();
  const { t } = useI18n();
  const tenantId = me?.tenantId ?? '';
  const base     = `/api/tenants/${tenantId}/staff`;

  const { data: staffList, loading, error, refetch } = useFetch<StaffRow[]>(
    tenantId ? base : null,
    [tenantId],
  );
  const { data: agencies } = useFetch<AgencyOption[]>(
    tenantId ? `/api/tenants/${tenantId}/agencies` : null,
    [tenantId],
  );
  const agencyOptions: AgencyOption[] = agencies ?? [];

  const [filterRole,    setFilterRole]    = useState<string>('');
  const [filterStatus,  setFilterStatus]  = useState<string>('');
  const [showCreate,    setShowCreate]    = useState(false);
  const [showPromote,   setShowPromote]   = useState(false);
  const [editTarget,    setEditTarget]    = useState<StaffRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<StaffRow | null>(null);
  const [assignmentsTarget, setAssignmentsTarget] = useState<StaffRow | null>(null);
  const [busy,          setBusy]          = useState(false);
  const [actionErr,     setActionErr]     = useState<string | null>(null);
  const [editPreviewOpen, setEditPreviewOpen] = useState(false);

  const data = (staffList ?? []).filter(s => {
    if (filterRole && !(s.assignments ?? []).some(a => a.role === filterRole)) return false;
    if (filterStatus && s.status !== filterStatus) return false;
    return true;
  });

  const handleCreate = async (f: CreateForm) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPost(base, {
        email:    f.email,
        name:     f.name,
        role:     f.role,
        agencyId: f.agencyId,
      });
      setShowCreate(false); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleEdit = async (f: EditForm) => {
    if (!editTarget) return;
    setBusy(true); setActionErr(null);
    try {
      await apiPatch(`${base}/${editTarget.userId}`, {
        name:     f.name,
        agencyId: f.agencyId || null,
      });
      setEditTarget(null); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleToggleSuspend = async (row: StaffRow) => {
    setBusy(true); setActionErr(null);
    try {
      const action = row.status === 'SUSPENDED' ? 'reactivate' : 'suspend';
      await apiPatch(`${base}/${row.userId}/${action}`);
      refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handlePromote = async (f: PromoteForm) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPost(`${base}/from-user/${f.userId}`, {
        role:     f.role,
        agencyId: f.agencyId || null,
      });
      setShowPromote(false); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    setBusy(true); setActionErr(null);
    try {
      await apiDelete(`${base}/${archiveTarget.userId}`);
      setArchiveTarget(null); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const columns = buildColumns(t);
  const rowActions: RowAction<StaffRow>[] = [
    {
      label:   t('personnel.assignments'),
      icon:    <Briefcase size={13} />,
      onClick: (row) => { setAssignmentsTarget(row); setActionErr(null); },
    },
    {
      label:   t('common.edit'),
      icon:    <Pencil size={13} />,
      onClick: (row) => { setEditTarget(row); setActionErr(null); },
    },
    {
      label:   t('personnel.suspendAction'),
      icon:    <Power size={13} />,
      hidden:  (row) => row.status !== 'ACTIVE',
      onClick: (row) => void handleToggleSuspend(row),
    },
    {
      label:   t('personnel.reactivateAction'),
      icon:    <Power size={13} />,
      hidden:  (row) => row.status !== 'SUSPENDED',
      onClick: (row) => void handleToggleSuspend(row),
    },
    {
      label:   t('personnel.archiveAction'),
      icon:    <Archive size={13} />,
      danger:  true,
      hidden:  (row) => row.status === 'ARCHIVED',
      onClick: (row) => { setArchiveTarget(row); setActionErr(null); },
    },
  ];

  const filterCls =
    'rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 ' +
    'px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500/30';

  return (
    <div className="p-6 space-y-6 bg-gray-50 dark:bg-slate-950 min-h-full">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
            <IdCard className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('personnel.pageTitle')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {staffList ? `${staffList.length} ${t('personnel.staffCount')}` : t('personnel.staffManagement')}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setShowPromote(true); setActionErr(null); }}>
            <Users className="w-4 h-4 mr-2" aria-hidden />{t('personnel.fromIam')}
          </Button>
          <Button onClick={() => { setShowCreate(true); setActionErr(null); }}>
            <Plus className="w-4 h-4 mr-2" aria-hidden />{t('personnel.newMember')}
          </Button>
        </div>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-3">
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)} className={filterCls}
          aria-label={t('personnel.filterByFunction')}>
          <option value="">{t('personnel.allFunctions')}</option>
          {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{t(r.label)}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={filterCls}
          aria-label={t('personnel.filterByStatus')}>
          <option value="">{t('personnel.allStatuses')}</option>
          <option value="ACTIVE">{t('personnel.statusActive')}</option>
          <option value="SUSPENDED">{t('personnel.statusSuspended')}</option>
          <option value="ARCHIVED">{t('personnel.statusArchived')}</option>
        </select>
      </div>

      <ErrorAlert error={error ?? actionErr} icon />

      {/* Tableau */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2">
        <DataTableMaster<StaffRow>
          columns={columns}
          data={data}
          loading={loading}
          rowActions={rowActions}
          defaultSort={{ key: 'createdAt', dir: 'desc' }}
          defaultPageSize={25}
          searchPlaceholder={t('personnel.searchPlaceholder')}
          emptyMessage={staffList?.length === 0 ? t('personnel.emptyFirst') : t('personnel.emptySearch')}
          exportFormats={['csv', 'json', 'xls']}
          exportFilename="personnel"
          onRowClick={(row) => { setEditTarget(row); setActionErr(null); }}
          stickyHeader
        />
      </div>

      {/* Modal Créer */}
      <Dialog
        open={showCreate}
        onOpenChange={o => { if (!o) setShowCreate(false); }}
        title={t('personnel.createDialogTitle')}
        description={t('personnel.createDialogDesc')}
        size="lg"
      >
        <CreateStaffForm
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
          busy={busy}
          error={actionErr}
          agencies={agencyOptions}
        />
      </Dialog>

      {/* Modal Éditer */}
      <Dialog
        open={!!editTarget}
        onOpenChange={o => { if (!o) { setEditPreviewOpen(false); setEditTarget(null); } }}
        title={t('personnel.editMember')}
        description={editTarget?.user?.email}
        size={editPreviewOpen ? '3xl' : 'lg'}
      >
        {editTarget && (
          <EditStaffForm
            staff={editTarget}
            tenantId={tenantId}
            onSubmit={handleEdit}
            onCancel={() => { setEditPreviewOpen(false); setEditTarget(null); }}
            busy={busy}
            error={actionErr}
            agencies={agencyOptions}
            onPreviewChange={setEditPreviewOpen}
          />
        )}
      </Dialog>

      {/* Modal Affectations (Phase 4) */}
      <Dialog
        open={!!assignmentsTarget}
        onOpenChange={o => { if (!o) setAssignmentsTarget(null); }}
        title={`${t('personnel.assignments')} — ${assignmentsTarget?.user?.name ?? assignmentsTarget?.user?.email ?? ''}`}
        description={t('personnel.assignDialogDesc')}
        size="xl"
      >
        {assignmentsTarget && (
          <div className="space-y-3">
            <ErrorAlert error={actionErr} />
            <AssignmentsManager
              staff={assignmentsTarget}
              tenantId={tenantId}
              agencies={agencyOptions}
              busy={busy}
              onAction={refetch}
              onError={setActionErr}
            />
          </div>
        )}
      </Dialog>

      {/* Modal Promouvoir depuis IAM (Phase 4) */}
      <Dialog
        open={showPromote}
        onOpenChange={o => { if (!o) setShowPromote(false); }}
        title={t('personnel.promoteDialogTitle')}
        description={t('personnel.promoteDialogDesc')}
        size="lg"
      >
        <PromoteFromIamForm
          tenantId={tenantId}
          agencies={agencyOptions}
          busy={busy}
          error={actionErr}
          onSubmit={handlePromote}
          onCancel={() => setShowPromote(false)}
        />
      </Dialog>

      {/* Modal Archiver */}
      <Dialog
        open={!!archiveTarget}
        onOpenChange={o => { if (!o) setArchiveTarget(null); }}
        title={t('personnel.archiveDialogTitle')}
        description={`${t('personnel.archiveConfirmPre')}${archiveTarget?.user?.name ?? archiveTarget?.user?.email}${t('personnel.archiveConfirmPost')}`}
        footer={
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setArchiveTarget(null)} disabled={busy}>
              <X className="w-4 h-4 mr-1.5" aria-hidden />{t('common.cancel')}
            </Button>
            <Button
              onClick={handleArchive}
              disabled={busy}
              loading={busy}
              variant="destructive"
            >
              <Archive className="w-4 h-4 mr-1.5" aria-hidden />
              {busy ? t('personnel.archiveBusy') : t('personnel.archiveAction')}
            </Button>
          </div>
        }
      >
        {actionErr && <p className="text-sm text-red-600 dark:text-red-400">{actionErr}</p>}
        <div />
      </Dialog>

    </div>
  );
}
