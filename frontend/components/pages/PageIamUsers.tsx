/**
 * PageIamUsers — Gestion des utilisateurs du tenant
 *
 * CRUD : lister · créer · modifier (nom, rôle, agence) · supprimer
 *
 * Données :
 *   GET    /api/v1/tenants/:tid/iam/users
 *   POST   /api/v1/tenants/:tid/iam/users
 *   PATCH  /api/v1/tenants/:tid/iam/users/:id
 *   DELETE /api/v1/tenants/:tid/iam/users/:id
 *   GET    /api/v1/tenants/:tid/iam/roles   (pour le sélecteur de rôle)
 */

import { useState, type FormEvent } from 'react';
import {
  Users, Plus, Pencil, Trash2, X, Check,
  AlertTriangle, UserCircle, LogOut, Eye,
  UserX, UserCheck,
} from 'lucide-react';
import { UserDetailDialog } from '../iam/UserDetailDialog';
import { useFetch }            from '../../lib/hooks/useFetch';
import { apiPost, apiPatch, apiDelete } from '../../lib/api';
import { useAuth }             from '../../lib/auth/auth.context';
import { useI18n }              from '../../lib/i18n/useI18n';
import { Button }              from '../ui/Button';
import { Badge }               from '../ui/Badge';
import { Dialog }              from '../ui/Dialog';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

// ─── i18n (string-key based — see locales/fr.ts → iamUsers) ──────────────────

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoleSummary   { id: string; name: string }
interface AgencySummary { id: string; name: string }

interface UserRow {
  id:        string;
  email:     string;
  name:      string | null;
  roleId:    string | null;
  agencyId:  string | null;
  isActive:  boolean;
  createdAt: string;
  role?:     RoleSummary | null;
  agency?:   AgencySummary | null;
}

interface CreateForm {
  email:    string;
  name:     string;
  password: string;
  roleId:   string;
  agencyId: string;
}

interface EditForm {
  name:     string;
  roleId:   string;
  agencyId: string;
}

// ─── Colonnes DataTableMaster ─────────────────────────────────────────────────

function buildColumns(currentUserId: string, t: (key: string) => string): Column<UserRow>[] {
  return [
    {
      key: 'name',
      header: t('iamUsers.colUser'),
      sortable: true,
      cellRenderer: (_v, row) => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
            <UserCircle className="w-5 h-5 text-slate-400" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
              {row.name ?? '—'}
              {row.id === currentUserId && (
                <span className="ml-2 text-[10px] text-blue-500">{t('iamUsers.you')}</span>
              )}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{row.email}</p>
          </div>
        </div>
      ),
      csvValue: (_v, row) => `${row.name ?? ''} <${row.email}>`,
    },
    {
      key: 'role',
      header: t('common.role'),
      sortable: true,
      cellRenderer: (_v, row) => row.role
        ? <Badge variant="info">{row.role.name}</Badge>
        : <span className="text-xs text-slate-400">—</span>,
      csvValue: (_v, row) => row.role?.name ?? '',
    },
    {
      key: 'agency',
      header: t('common.agency'),
      sortable: true,
      cellRenderer: (_v, row) => (
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {row.agency?.name ?? '—'}
        </span>
      ),
      csvValue: (_v, row) => row.agency?.name ?? '',
    },
    {
      key: 'isActive',
      header: t('iamUsers.colStatus'),
      sortable: true,
      width: '100px',
      cellRenderer: (v) => (
        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${v ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
          {v ? t('iamUsers.active') : t('iamUsers.inactive')}
        </span>
      ),
      csvValue: (v) => v ? 'Active' : 'Inactive',
    },
    {
      key: 'createdAt',
      header: t('iamUsers.colCreatedAt'),
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

// ─── Formulaire création ──────────────────────────────────────────────────────

function CreateUserForm({ roles, onSubmit, onCancel, busy, error }: {
  roles:    RoleSummary[];
  onSubmit: (f: CreateForm) => void;
  onCancel: () => void;
  busy:     boolean;
  error:    string | null;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<CreateForm>({
    email: '', name: '', password: '', roleId: '', agencyId: '',
  });
  const set = <K extends keyof CreateForm>(k: K, v: CreateForm[K]) =>
    setF(p => ({ ...p, [k]: v }));

  const inp = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50';

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('common.email')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="email" required value={f.email}
            onChange={e => set('email', e.target.value)}
            className={inp} disabled={busy} placeholder="user@example.com" />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('iamUsers.fullName')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="text" required value={f.name}
            onChange={e => set('name', e.target.value)}
            className={inp} disabled={busy} placeholder="Jean Dupont" />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('common.password')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="password" required minLength={8} value={f.password}
            onChange={e => set('password', e.target.value)}
            className={inp} disabled={busy} placeholder={t('iamUsers.minChars')} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{t('common.role')}</label>
          <select value={f.roleId} onChange={e => set('roleId', e.target.value)}
            className={inp} disabled={busy}>
            <option value="">{t('iamUsers.noRole')}</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
      </div>
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          <X className="w-4 h-4 mr-1.5" aria-hidden />{t('common.cancel')}
        </Button>
        <Button type="submit" disabled={busy}>
          <Check className="w-4 h-4 mr-1.5" aria-hidden />{busy ? t('common.creating') : t('common.create')}
        </Button>
      </div>
    </form>
  );
}

// ─── Formulaire édition ───────────────────────────────────────────────────────

function EditUserForm({ user, roles, onSubmit, onCancel, busy, error }: {
  user:     UserRow;
  roles:    RoleSummary[];
  onSubmit: (f: EditForm) => void;
  onCancel: () => void;
  busy:     boolean;
  error:    string | null;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<EditForm>({
    name: user.name ?? '', roleId: user.roleId ?? '', agencyId: user.agencyId ?? '',
  });
  const set = <K extends keyof EditForm>(k: K, v: EditForm[K]) =>
    setF(p => ({ ...p, [k]: v }));

  const inp = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50';

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{t('iamUsers.fullName')}</label>
          <input type="text" value={f.name}
            onChange={e => set('name', e.target.value)}
            className={inp} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{t('common.role')}</label>
          <select value={f.roleId} onChange={e => set('roleId', e.target.value)}
            className={inp} disabled={busy}>
            <option value="">{t('iamUsers.noRole')}</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2">
          <p>{t('common.email')} : <span className="font-mono">{user.email}</span></p>
        </div>
      </div>
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          <X className="w-4 h-4 mr-1.5" aria-hidden />{t('common.cancel')}
        </Button>
        <Button type="submit" disabled={busy}>
          <Check className="w-4 h-4 mr-1.5" aria-hidden />{busy ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </form>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function PageIamUsers() {
  const { user: me } = useAuth();
  const { t } = useI18n();
  const tenantId = me?.tenantId ?? '';
  const base     = `/api/v1/tenants/${tenantId}/iam`;

  const { data: users, loading, error, refetch } = useFetch<UserRow[]>(`${base}/users`, [tenantId]);
  const { data: roles }                           = useFetch<{
    id: string; name: string;
    permissions: { permission: string }[];
    _count: { users: number };
  }[]>(`${base}/roles`, [tenantId]);

  const roleList: RoleSummary[] = (roles ?? []).map(r => ({ id: r.id, name: r.name }));

  const [filterRole, setFilterRole] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [viewUser,   setViewUser]   = useState<UserRow | null>(null);
  const [editUser,   setEditUser]   = useState<UserRow | null>(null);
  const [deleteUser, setDeleteUser] = useState<UserRow | null>(null);
  const [busy,       setBusy]       = useState(false);
  const [actionErr,  setActionErr]  = useState<string | null>(null);

  // Seul le filtre de rôle est externe — DataTableMaster gère la recherche textuelle
  const tableData = (users ?? []).filter(u =>
    !filterRole || u.roleId === filterRole,
  );

  const handleCreate = async (f: CreateForm) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPost(`${base}/users`, {
        email:    f.email,
        name:     f.name,
        password: f.password,
        roleId:   f.roleId   || undefined,
        agencyId: f.agencyId || undefined,
      });
      setShowCreate(false); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleEdit = async (f: EditForm) => {
    if (!editUser) return;
    setBusy(true); setActionErr(null);
    try {
      await apiPatch(`${base}/users/${editUser.id}`, {
        name:   f.name   || undefined,
        roleId: f.roleId || null,
      });
      setEditUser(null); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleDelete = async () => {
    if (!deleteUser) return;
    setBusy(true); setActionErr(null);
    try {
      await apiDelete(`${base}/users/${deleteUser.id}`);
      setDeleteUser(null); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleRevokeSessions = async (row: UserRow) => {
    if (!confirm(t('iamUsers.forceDisconnect').replace('{name}', row.name ?? row.email))) return;
    setBusy(true); setActionErr(null);
    try {
      await apiPost(`${base}/users/${row.id}/revoke-sessions`);
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleToggleActive = async (row: UserRow) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPatch(`${base}/users/${row.id}/toggle-active`);
      refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const columns    = buildColumns(me?.id ?? '', t);
  const rowActions: RowAction<UserRow>[] = [
    {
      label:    t('common.view'),
      icon:     <Eye size={13} />,
      onClick:  (row) => { setViewUser(row); setActionErr(null); },
    },
    {
      label:    t('common.edit'),
      icon:     <Pencil size={13} />,
      onClick:  (row) => { setEditUser(row); setActionErr(null); },
    },
    {
      label:    (row) => row.isActive ? t('iamUsers.deactivate') : t('iamUsers.activate'),
      icon:     (row) => row.isActive ? <UserX size={13} /> : <UserCheck size={13} />,
      hidden:   (row) => row.id === (me?.id ?? ''),
      onClick:  handleToggleActive,
    },
    {
      label:    t('iamUsers.forceReconnect'),
      icon:     <LogOut size={13} />,
      hidden:   (row) => row.id === (me?.id ?? ''),
      onClick:  handleRevokeSessions,
    },
    {
      label:    t('common.delete'),
      icon:     <Trash2 size={13} />,
      danger:   true,
      hidden:   (row) => row.id === (me?.id ?? ''),
      onClick:  (row) => { setDeleteUser(row); setActionErr(null); },
    },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
            <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('iamUsers.users')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {users ? `${users.length} ${t('iamUsers.userCount')}` : t('iamUsers.accountManagement')}
            </p>
          </div>
        </div>
        <Button onClick={() => { setShowCreate(true); setActionErr(null); }}>
          <Plus className="w-4 h-4 mr-2" aria-hidden />{t('iamUsers.newUser')}
        </Button>
      </div>

      {/* Filtre rôle (côté client, complète la recherche DataTableMaster) */}
      <div className="flex flex-wrap gap-3">
        <select
          value={filterRole}
          onChange={e => setFilterRole(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        >
          <option value="">{t('iamUsers.allRoles')}</option>
          {roleList.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>

      {(error || actionErr) && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />{error ?? actionErr}
        </div>
      )}

      {/* Tableau */}
      <DataTableMaster<UserRow>
        columns={columns}
        data={tableData}
        loading={loading}
        rowActions={rowActions}
        defaultSort={{ key: 'createdAt', dir: 'desc' }}
        defaultPageSize={25}
        searchPlaceholder={t('iamUsers.searchPlaceholder')}
        emptyMessage={users?.length === 0 ? t('iamUsers.emptyNoUsers') : t('iamUsers.emptyNoResult')}
        exportFormats={['csv', 'json', 'xls']}
        exportFilename={t('iamUsers.exportFilename')}
        onRowClick={(row) => { setViewUser(row); setActionErr(null); }}
        stickyHeader
      />

      {/* Modal Détails (voir) */}
      <UserDetailDialog
        tenantId={tenantId}
        userId={viewUser?.id ?? null}
        open={!!viewUser}
        onClose={() => setViewUser(null)}
      />

      {/* Modal Créer */}
      <Dialog
        open={showCreate}
        onOpenChange={o => { if (!o) setShowCreate(false); }}
        title={t('iamUsers.newUser')}
        description={t('iamUsers.createDesc')}
        size="lg"
      >
        <CreateUserForm
          roles={roleList}
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
          busy={busy}
          error={actionErr}
        />
      </Dialog>

      {/* Modal Éditer */}
      <Dialog
        open={!!editUser}
        onOpenChange={o => { if (!o) setEditUser(null); }}
        title={t('iamUsers.editUser')}
        description={editUser?.email}
        size="md"
      >
        {editUser && (
          <EditUserForm
            user={editUser}
            roles={roleList}
            onSubmit={handleEdit}
            onCancel={() => setEditUser(null)}
            busy={busy}
            error={actionErr}
          />
        )}
      </Dialog>

      {/* Modal Supprimer */}
      <Dialog
        open={!!deleteUser}
        onOpenChange={o => { if (!o) setDeleteUser(null); }}
        title={t('iamUsers.deleteUser')}
        description={t('iamUsers.deleteDesc').replace('{name}', deleteUser?.name ?? deleteUser?.email ?? '')}
        footer={
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setDeleteUser(null)} disabled={busy}>
              <X className="w-4 h-4 mr-1.5" aria-hidden />{t('common.cancel')}
            </Button>
            <Button
              onClick={handleDelete}
              disabled={busy}
              className="bg-red-600 hover:bg-red-700 text-white border-red-600"
            >
              <Trash2 className="w-4 h-4 mr-1.5" aria-hidden />
              {busy ? t('common.deleting') : t('common.delete')}
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
