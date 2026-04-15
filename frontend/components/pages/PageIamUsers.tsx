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
  AlertTriangle, UserCircle, LogOut,
} from 'lucide-react';
import { useFetch }            from '../../lib/hooks/useFetch';
import { apiPost, apiPatch, apiDelete } from '../../lib/api';
import { useAuth }             from '../../lib/auth/auth.context';
import { Button }              from '../ui/Button';
import { Badge }               from '../ui/Badge';
import { Dialog }              from '../ui/Dialog';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoleSummary   { id: string; name: string }
interface AgencySummary { id: string; name: string }

interface UserRow {
  id:        string;
  email:     string;
  name:      string | null;
  roleId:    string | null;
  agencyId:  string | null;
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

function buildColumns(currentUserId: string): Column<UserRow>[] {
  return [
    {
      key: 'name',
      header: 'Utilisateur',
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
                <span className="ml-2 text-[10px] text-blue-500">(vous)</span>
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
      header: 'Rôle',
      sortable: true,
      cellRenderer: (_v, row) => row.role
        ? <Badge variant="info">{row.role.name}</Badge>
        : <span className="text-xs text-slate-400">—</span>,
      csvValue: (_v, row) => row.role?.name ?? '',
    },
    {
      key: 'agency',
      header: 'Agence',
      sortable: true,
      cellRenderer: (_v, row) => (
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {row.agency?.name ?? '—'}
        </span>
      ),
      csvValue: (_v, row) => row.agency?.name ?? '',
    },
    {
      key: 'createdAt',
      header: 'Créé le',
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
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Email <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="email" required value={f.email}
            onChange={e => set('email', e.target.value)}
            className={inp} disabled={busy} placeholder="user@example.com" />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Nom complet <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="text" required value={f.name}
            onChange={e => set('name', e.target.value)}
            className={inp} disabled={busy} placeholder="Jean Dupont" />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Mot de passe <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="password" required minLength={8} value={f.password}
            onChange={e => set('password', e.target.value)}
            className={inp} disabled={busy} placeholder="8 caractères min." />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Rôle</label>
          <select value={f.roleId} onChange={e => set('roleId', e.target.value)}
            className={inp} disabled={busy}>
            <option value="">— Aucun rôle —</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
      </div>
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          <X className="w-4 h-4 mr-1.5" aria-hidden />Annuler
        </Button>
        <Button type="submit" disabled={busy}>
          <Check className="w-4 h-4 mr-1.5" aria-hidden />{busy ? 'Création…' : 'Créer'}
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
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Nom complet</label>
          <input type="text" value={f.name}
            onChange={e => set('name', e.target.value)}
            className={inp} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Rôle</label>
          <select value={f.roleId} onChange={e => set('roleId', e.target.value)}
            className={inp} disabled={busy}>
            <option value="">— Aucun rôle —</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2">
          <p>Email : <span className="font-mono">{user.email}</span></p>
        </div>
      </div>
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          <X className="w-4 h-4 mr-1.5" aria-hidden />Annuler
        </Button>
        <Button type="submit" disabled={busy}>
          <Check className="w-4 h-4 mr-1.5" aria-hidden />{busy ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </form>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function PageIamUsers() {
  const { user: me } = useAuth();
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
    if (!confirm(`Forcer la déconnexion de "${row.name ?? row.email}" ? Toutes ses sessions actives seront révoquées.`)) return;
    setBusy(true); setActionErr(null);
    try {
      await apiPost(`${base}/users/${row.id}/revoke-sessions`);
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const columns    = buildColumns(me?.id ?? '');
  const rowActions: RowAction<UserRow>[] = [
    {
      label:    'Modifier',
      icon:     <Pencil size={13} />,
      onClick:  (row) => { setEditUser(row); setActionErr(null); },
    },
    {
      label:    'Forcer reconnexion',
      icon:     <LogOut size={13} />,
      hidden:   (row) => row.id === (me?.id ?? ''),
      onClick:  handleRevokeSessions,
    },
    {
      label:    'Supprimer',
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
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Utilisateurs</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {users ? `${users.length} utilisateur(s)` : 'Gestion des comptes'}
            </p>
          </div>
        </div>
        <Button onClick={() => { setShowCreate(true); setActionErr(null); }}>
          <Plus className="w-4 h-4 mr-2" aria-hidden />Nouvel utilisateur
        </Button>
      </div>

      {/* Filtre rôle (côté client, complète la recherche DataTableMaster) */}
      <div className="flex flex-wrap gap-3">
        <select
          value={filterRole}
          onChange={e => setFilterRole(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        >
          <option value="">Tous les rôles</option>
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
        searchPlaceholder="Rechercher (nom, email, rôle, agence…)"
        emptyMessage={users?.length === 0 ? 'Aucun utilisateur.' : 'Aucun résultat pour ce rôle.'}
        exportFormats={['csv', 'json', 'xls']}
        exportFilename="utilisateurs"
        onRowClick={(row) => { setEditUser(row); setActionErr(null); }}
        stickyHeader
      />

      {/* Modal Créer */}
      <Dialog
        open={showCreate}
        onOpenChange={o => { if (!o) setShowCreate(false); }}
        title="Nouvel utilisateur"
        description="Créez un compte dans votre organisation."
        size="md"
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
        title="Modifier l'utilisateur"
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
        title="Supprimer l'utilisateur"
        description={`Supprimer "${deleteUser?.name ?? deleteUser?.email}" ? Toutes ses sessions seront révoquées.`}
        footer={
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setDeleteUser(null)} disabled={busy}>
              <X className="w-4 h-4 mr-1.5" aria-hidden />Annuler
            </Button>
            <Button
              onClick={handleDelete}
              disabled={busy}
              className="bg-red-600 hover:bg-red-700 text-white border-red-600"
            >
              <Trash2 className="w-4 h-4 mr-1.5" aria-hidden />
              {busy ? 'Suppression…' : 'Supprimer'}
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
