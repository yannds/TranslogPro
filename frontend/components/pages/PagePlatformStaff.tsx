/**
 * PagePlatformStaff — Gestion du staff interne TranslogPro (tenant plateforme)
 *
 * Seuls les rôles systèmes SUPER_ADMIN, SUPPORT_L1, SUPPORT_L2 peuvent exister
 * dans le tenant plateforme. Cette page n'expose jamais les rôles des tenants
 * clients (TENANT_ADMIN, DRIVER, etc.).
 *
 * Données :
 *   GET    /api/platform/staff             (control.platform.staff.global)
 *   POST   /api/platform/staff             body: { email, name, roleName }
 *   DELETE /api/platform/staff/:id         403 si dernier SUPER_ADMIN ou self
 *
 * Invariants (renvoyés 403 par le backend) :
 *   - Impossible de supprimer son propre compte
 *   - Impossible de supprimer le dernier SUPER_ADMIN
 *
 * Note password : la création ne définit pas encore le mot de passe ici ;
 * l'agent reçoit un magic link de configuration comme pour le bootstrap.
 * Le frontend n'envoie donc pas de password et affiche l'info.
 */

import { useState, type FormEvent } from 'react';
import {
  UserCog, Plus, Trash2, X, Check, AlertTriangle, ShieldCheck, Bug,
  UserCircle, Mail,
} from 'lucide-react';
import { useFetch }                   from '../../lib/hooks/useFetch';
import { apiPost, apiDelete }          from '../../lib/api';
import { useAuth }                    from '../../lib/auth/auth.context';
import { useI18n }                     from '../../lib/i18n/useI18n';
import { Button }                     from '../ui/Button';
import { Badge }                      from '../ui/Badge';
import { Dialog }                     from '../ui/Dialog';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

// ─── Types ───────────────────────────────────────────────────────────────────

type PlatformRole = 'SUPER_ADMIN' | 'SUPPORT_L1' | 'SUPPORT_L2';

interface StaffRow {
  id:        string;
  email:     string;
  name:      string | null;
  roleName:  string | null;
  userType:  string;
  createdAt: string;
}

interface CreateForm {
  email:    string;
  name:     string;
  roleName: PlatformRole;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const inp = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30 disabled:opacity-50';

function roleVariant(role: string | null): 'success' | 'warning' | 'info' | 'default' {
  switch (role) {
    case 'SUPER_ADMIN': return 'success';
    case 'SUPPORT_L2':  return 'warning';
    case 'SUPPORT_L1':  return 'info';
    default:            return 'default';
  }
}

function roleIcon(role: string | null) {
  if (role === 'SUPER_ADMIN') return <ShieldCheck className="w-3.5 h-3.5" aria-hidden />;
  if (role === 'SUPPORT_L2')  return <Bug         className="w-3.5 h-3.5" aria-hidden />;
  return <UserCog className="w-3.5 h-3.5" aria-hidden />;
}

// ─── Colonnes ────────────────────────────────────────────────────────────────

function buildColumns(
  meId: string | undefined,
  t: (k: string) => string,
  dateLocale: string,
): Column<StaffRow>[] {
  return [
    {
      key: 'name',
      header: t('platformStaff.colMember'),
      sortable: true,
      cellRenderer: (_v, row) => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
            <UserCircle className="w-5 h-5 text-slate-400" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium t-text truncate">
              {row.name ?? '—'}
              {row.id === meId && (
                <span className="ml-2 text-[10px] text-teal-500">{t('platformStaff.you')}</span>
              )}
            </p>
            <p className="text-xs t-text-3 truncate">{row.email}</p>
          </div>
        </div>
      ),
      csvValue: (_v, row) => `${row.name ?? ''} <${row.email}>`,
    },
    {
      key: 'roleName',
      header: t('common.role'),
      sortable: true,
      width: '160px',
      cellRenderer: (v) => v ? (
        <Badge variant={roleVariant(String(v))} size="sm" className="inline-flex items-center gap-1">
          {roleIcon(String(v))}
          {String(v)}
        </Badge>
      ) : <span className="text-xs t-text-3">—</span>,
      csvValue: (v) => String(v ?? ''),
    },
    {
      key: 'createdAt',
      header: t('platformStaff.colCreatedAt'),
      sortable: true,
      width: '140px',
      cellRenderer: (v) => (
        <span className="text-xs t-text-3">
          {new Date(String(v)).toLocaleDateString(dateLocale)}
        </span>
      ),
      csvValue: (v) => new Date(String(v)).toLocaleDateString(dateLocale),
    },
  ];
}

// ─── Formulaire création ─────────────────────────────────────────────────────

const ROLE_OPTIONS: { value: PlatformRole; labelKey: string; descKey: string }[] = [
  { value: 'SUPER_ADMIN', labelKey: 'platformStaff.roleSA',   descKey: 'platformStaff.roleSADesc' },
  { value: 'SUPPORT_L1',  labelKey: 'platformStaff.roleL1',   descKey: 'platformStaff.roleL1Desc' },
  { value: 'SUPPORT_L2',  labelKey: 'platformStaff.roleL2',   descKey: 'platformStaff.roleL2Desc' },
];

function CreateStaffForm({ onSubmit, onCancel, busy, error }: {
  onSubmit: (f: CreateForm) => void;
  onCancel: () => void;
  busy:     boolean;
  error:    string | null;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<CreateForm>({ email: '', name: '', roleName: 'SUPPORT_L1' });
  const set = <K extends keyof CreateForm>(k: K, v: CreateForm[K]) =>
    setF(p => ({ ...p, [k]: v }));

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="lg:col-span-2 space-y-1.5">
          <label htmlFor="ps-email" className="block text-sm font-medium t-text">
            {t('common.email')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input
            id="ps-email" type="email" required value={f.email}
            onChange={e => set('email', e.target.value)}
            className={inp} disabled={busy} placeholder="support@translogpro.com"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ps-name" className="block text-sm font-medium t-text">
            {t('platformStaff.fullName')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input
            id="ps-name" type="text" required minLength={2} maxLength={100} value={f.name}
            onChange={e => set('name', e.target.value)}
            className={inp} disabled={busy} placeholder="Marie Martin"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ps-role" className="block text-sm font-medium t-text">
            {t('common.role')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <select
            id="ps-role" value={f.roleName} required
            onChange={e => set('roleName', e.target.value as PlatformRole)}
            className={inp} disabled={busy}
          >
            {ROLE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
            ))}
          </select>
          <p className="text-[11px] t-text-3">
            {t(ROLE_OPTIONS.find(o => o.value === f.roleName)!.descKey)}
          </p>
        </div>
      </div>
      <div role="note" className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 px-3 py-2 text-xs text-blue-800 dark:text-blue-300 flex items-start gap-2">
        <Mail className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
        <span>{t('platformStaff.setupLinkHint')}</span>
      </div>
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          <X className="w-4 h-4 mr-1.5" aria-hidden />{t('common.cancel')}
        </Button>
        <Button type="submit" disabled={busy}>
          <Check className="w-4 h-4 mr-1.5" aria-hidden />
          {busy ? t('common.creating') : t('common.create')}
        </Button>
      </div>
    </form>
  );
}

// ─── Composant principal ─────────────────────────────────────────────────────

export function PagePlatformStaff() {
  const { user: me } = useAuth();
  const { t, dateLocale } = useI18n();

  const { data: staff, loading, error, refetch } =
    useFetch<StaffRow[]>('/api/platform/staff');

  const [showCreate,    setShowCreate]    = useState(false);
  const [deleteTarget,  setDeleteTarget]  = useState<StaffRow | null>(null);
  const [busy,          setBusy]          = useState(false);
  const [actionErr,     setActionErr]     = useState<string | null>(null);

  const saCount = (staff ?? []).filter(s => s.roleName === 'SUPER_ADMIN').length;

  const handleCreate = async (f: CreateForm) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPost('/api/platform/staff', f);
      setShowCreate(false);
      refetch();
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true); setActionErr(null);
    try {
      await apiDelete(`/api/platform/staff/${deleteTarget.id}`);
      setDeleteTarget(null);
      refetch();
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const columns = buildColumns(me?.id, t, dateLocale);
  const rowActions: RowAction<StaffRow>[] = [
    {
      label:    t('common.delete'),
      icon:     <Trash2 size={13} />,
      danger:   true,
      disabled: (row) =>
        row.id === me?.id || (row.roleName === 'SUPER_ADMIN' && saCount <= 1),
      onClick:  (row) => { setDeleteTarget(row); setActionErr(null); },
    },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
            <UserCog className="w-5 h-5 text-teal-700 dark:text-teal-300" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold t-text">{t('platformStaff.title')}</h1>
            <p className="text-sm t-text-2">
              {staff ? `${staff.length} ${t('platformStaff.membersCount')}` : t('platformStaff.subtitle')}
            </p>
          </div>
        </div>
        <Button onClick={() => { setShowCreate(true); setActionErr(null); }}>
          <Plus className="w-4 h-4 mr-2" aria-hidden />{t('platformStaff.newStaff')}
        </Button>
      </div>

      {/* Rappel invariant */}
      <div className="rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-3 text-xs t-text-2 flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden />
        <span>{t('platformStaff.invariantNote')}</span>
      </div>

      {(error || actionErr) && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />
          {error ?? actionErr}
        </div>
      )}

      <DataTableMaster<StaffRow>
        columns={columns}
        data={staff ?? []}
        loading={loading}
        rowActions={rowActions}
        defaultSort={{ key: 'createdAt', dir: 'asc' }}
        defaultPageSize={25}
        searchPlaceholder={t('platformStaff.searchPlaceholder')}
        emptyMessage={t('platformStaff.emptyMsg')}
        exportFormats={['csv', 'json']}
        exportFilename="platform-staff"
        stickyHeader
      />

      {/* Modal Créer */}
      <Dialog
        open={showCreate}
        onOpenChange={o => { if (!o) setShowCreate(false); }}
        title={t('platformStaff.newStaff')}
        description={t('platformStaff.createDesc')}
        size="lg"
      >
        <CreateStaffForm
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
          busy={busy}
          error={actionErr}
        />
      </Dialog>

      {/* Modal Supprimer */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={o => { if (!o) setDeleteTarget(null); }}
        title={t('platformStaff.deleteStaff')}
        description={deleteTarget ? `${deleteTarget.name ?? deleteTarget.email}` : ''}
        footer={
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={busy}>
              <X className="w-4 h-4 mr-1.5" aria-hidden />{t('common.cancel')}
            </Button>
            <Button
              onClick={handleDelete}
              disabled={busy}
              className="bg-red-600 hover:bg-red-700 text-white border-red-600"
            >
              <Trash2 className="w-4 h-4 mr-1.5" aria-hidden />
              {busy ? t('platformStaff.deleting') : t('common.delete')}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div role="alert" className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
            <span>{t('platformStaff.deleteWarning')}</span>
          </div>
          {actionErr && <p className="text-sm text-red-600 dark:text-red-400">{actionErr}</p>}
        </div>
      </Dialog>
    </div>
  );
}
