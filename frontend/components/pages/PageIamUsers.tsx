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
  Users, Plus, Pencil, Trash2, Search, X, Check,
  AlertTriangle, UserCircle,
} from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPost, apiPut, apiDelete } from '../../lib/api';
import { useAuth } from '../../lib/auth/auth.context';
import { Card, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { Dialog } from '../ui/Dialog';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoleSummary { id: string; name: string }
interface AgencySummary { id: string; name: string }
interface UserRow {
  id:        string;
  email:     string;
  name:      string | null;
  userType:  string;
  roleId:    string | null;
  agencyId:  string | null;
  createdAt: string;
  role?:     RoleSummary | null;
  agency?:   AgencySummary | null;
}

interface CreateForm {
  email:     string;
  name:      string;
  password:  string;
  roleId:    string;
  agencyId:  string;
  userType:  'STAFF' | 'DRIVER';
}

interface EditForm {
  name:     string;
  roleId:   string;
  agencyId: string;
}

// ─── Ligne utilisateur ────────────────────────────────────────────────────────

function UserRow({
  user, onEdit, onDelete, currentUserId,
}: {
  user:          UserRow;
  onEdit:        (u: UserRow) => void;
  onDelete:      (u: UserRow) => void;
  currentUserId: string;
}) {
  const isSelf = user.id === currentUserId;
  return (
    <tr className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
            <UserCircle className="w-5 h-5 text-slate-400" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
              {user.name ?? '—'}
              {isSelf && <span className="ml-2 text-[10px] text-blue-500">(vous)</span>}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        {user.role
          ? <Badge variant="info">{user.role.name}</Badge>
          : <span className="text-xs text-slate-400">—</span>}
      </td>
      <td className="px-4 py-3">
        <Badge variant={user.userType === 'DRIVER' ? 'warning' : 'default'}>
          {user.userType}
        </Badge>
      </td>
      <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
        {user.agency?.name ?? '—'}
      </td>
      <td className="px-4 py-3 text-xs text-slate-400">
        {new Date(user.createdAt).toLocaleDateString('fr-FR')}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 justify-end">
          <Button size="sm" variant="ghost" onClick={() => onEdit(user)} aria-label={`Modifier ${user.name}`}>
            <Pencil className="w-3.5 h-3.5" aria-hidden />
          </Button>
          {!isSelf && (
            <Button size="sm" variant="ghost" onClick={() => onDelete(user)} aria-label={`Supprimer ${user.name}`}
              className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
              <Trash2 className="w-3.5 h-3.5" aria-hidden />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Formulaire création ──────────────────────────────────────────────────────

function CreateUserForm({ roles, onSubmit, onCancel, busy, error }: {
  roles:    RoleSummary[];
  onSubmit: (f: CreateForm) => void;
  onCancel: () => void;
  busy:     boolean;
  error:    string | null;
}) {
  const [f, setF] = useState<CreateForm>({ email: '', name: '', password: '', roleId: '', agencyId: '', userType: 'STAFF' });
  const set = <K extends keyof CreateForm>(k: K, v: CreateForm[K]) => setF(p => ({ ...p, [k]: v }));

  const inp = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50';

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      {error && <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 px-3 py-2 text-sm text-red-600">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Email <span aria-hidden className="text-red-500">*</span></label>
          <input type="email" required value={f.email} onChange={e => set('email', e.target.value)} className={inp} disabled={busy} placeholder="user@example.com" />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Nom complet <span aria-hidden className="text-red-500">*</span></label>
          <input type="text" required value={f.name} onChange={e => set('name', e.target.value)} className={inp} disabled={busy} placeholder="Jean Dupont" />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Mot de passe <span aria-hidden className="text-red-500">*</span></label>
          <input type="password" required minLength={8} value={f.password} onChange={e => set('password', e.target.value)} className={inp} disabled={busy} placeholder="8 caractères min." />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Rôle</label>
          <select value={f.roleId} onChange={e => set('roleId', e.target.value)} className={inp} disabled={busy}>
            <option value="">— Aucun rôle —</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Type</label>
          <select value={f.userType} onChange={e => set('userType', e.target.value as 'STAFF' | 'DRIVER')} className={inp} disabled={busy}>
            <option value="STAFF">STAFF</option>
            <option value="DRIVER">DRIVER</option>
          </select>
        </div>
      </div>
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}><X className="w-4 h-4 mr-1.5" aria-hidden />Annuler</Button>
        <Button type="submit" disabled={busy}><Check className="w-4 h-4 mr-1.5" aria-hidden />{busy ? 'Création…' : 'Créer'}</Button>
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
  const [f, setF] = useState<EditForm>({ name: user.name ?? '', roleId: user.roleId ?? '', agencyId: user.agencyId ?? '' });
  const set = <K extends keyof EditForm>(k: K, v: EditForm[K]) => setF(p => ({ ...p, [k]: v }));
  const inp = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50';

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      {error && <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 px-3 py-2 text-sm text-red-600">{error}</div>}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Nom complet</label>
          <input type="text" value={f.name} onChange={e => set('name', e.target.value)} className={inp} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Rôle</label>
          <select value={f.roleId} onChange={e => set('roleId', e.target.value)} className={inp} disabled={busy}>
            <option value="">— Aucun rôle —</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div className="space-y-1.5 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2">
          <p>Email : <span className="font-mono">{user.email}</span></p>
          <p>Type  : {user.userType}</p>
        </div>
      </div>
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}><X className="w-4 h-4 mr-1.5" aria-hidden />Annuler</Button>
        <Button type="submit" disabled={busy}><Check className="w-4 h-4 mr-1.5" aria-hidden />{busy ? 'Enregistrement…' : 'Enregistrer'}</Button>
      </div>
    </form>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function PageIamUsers() {
  const { user: me } = useAuth();
  const tenantId = me?.tenantId ?? '';
  const base     = `/api/v1/tenants/${tenantId}/iam`;

  const { data: users,  loading, error, refetch } = useFetch<UserRow[]>(`${base}/users`, [tenantId]);
  const { data: roles }                            = useFetch<{ id: string; name: string; permissions: { permission: string }[]; _count: { users: number } }[]>(`${base}/roles`, [tenantId]);

  const roleList: RoleSummary[] = (roles ?? []).map(r => ({ id: r.id, name: r.name }));

  const [search,      setSearch]      = useState('');
  const [filterRole,  setFilterRole]  = useState('');
  const [showCreate,  setShowCreate]  = useState(false);
  const [editUser,    setEditUser]    = useState<UserRow | null>(null);
  const [deleteUser,  setDeleteUser]  = useState<UserRow | null>(null);
  const [busy,        setBusy]        = useState(false);
  const [actionErr,   setActionErr]   = useState<string | null>(null);

  const filtered = (users ?? []).filter(u => {
    if (filterRole && u.roleId !== filterRole) return false;
    if (search && !u.email.toLowerCase().includes(search.toLowerCase()) && !u.name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleCreate = async (f: CreateForm) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPost(`${base}/users`, {
        email:    f.email,
        name:     f.name,
        password: f.password,
        roleId:   f.roleId   || undefined,
        agencyId: f.agencyId || undefined,
        userType: f.userType,
      });
      setShowCreate(false); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleEdit = async (f: EditForm) => {
    if (!editUser) return;
    setBusy(true); setActionErr(null);
    try {
      await apiPut(`${base}/users/${editUser.id}`, {
        name:    f.name     || undefined,
        roleId:  f.roleId   || null,
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
            <p className="text-sm text-slate-500 dark:text-slate-400">{users ? `${users.length} utilisateur(s)` : 'Gestion des comptes'}</p>
          </div>
        </div>
        <Button onClick={() => { setShowCreate(true); setActionErr(null); }}>
          <Plus className="w-4 h-4 mr-2" aria-hidden />Nouvel utilisateur
        </Button>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher…"
            className="pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-slate-900 dark:text-slate-100" />
        </div>
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30">
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
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    {['Utilisateur', 'Rôle', 'Type', 'Agence', 'Créé le', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                      {users?.length === 0 ? 'Aucun utilisateur.' : 'Aucun résultat.'}
                    </td></tr>
                  ) : filtered.map(u => (
                    <UserRow key={u.id} user={u}
                      onEdit={u => { setEditUser(u); setActionErr(null); }}
                      onDelete={u => { setDeleteUser(u); setActionErr(null); }}
                      currentUserId={me?.id ?? ''}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal Créer */}
      <Dialog open={showCreate} onOpenChange={o => { if (!o) setShowCreate(false); }}
        title="Nouvel utilisateur" description="Créez un compte dans votre organisation." size="md">
        <CreateUserForm roles={roleList} onSubmit={handleCreate} onCancel={() => setShowCreate(false)} busy={busy} error={actionErr} />
      </Dialog>

      {/* Modal Éditer */}
      <Dialog open={!!editUser} onOpenChange={o => { if (!o) setEditUser(null); }}
        title="Modifier l'utilisateur" description={editUser?.email} size="md">
        {editUser && <EditUserForm user={editUser} roles={roleList} onSubmit={handleEdit} onCancel={() => setEditUser(null)} busy={busy} error={actionErr} />}
      </Dialog>

      {/* Modal Supprimer */}
      <Dialog open={!!deleteUser} onOpenChange={o => { if (!o) setDeleteUser(null); }}
        title="Supprimer l'utilisateur"
        description={`Supprimer "${deleteUser?.name ?? deleteUser?.email}" ? Toutes ses sessions seront révoquées.`}
        footer={
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setDeleteUser(null)} disabled={busy}><X className="w-4 h-4 mr-1.5" aria-hidden />Annuler</Button>
            <Button onClick={handleDelete} disabled={busy} className="bg-red-600 hover:bg-red-700 text-white border-red-600">
              <Trash2 className="w-4 h-4 mr-1.5" aria-hidden />{busy ? 'Suppression…' : 'Supprimer'}
            </Button>
          </div>
        }>
        {actionErr && <p className="text-sm text-red-600 dark:text-red-400">{actionErr}</p>}
        <div />
      </Dialog>
    </div>
  );
}
