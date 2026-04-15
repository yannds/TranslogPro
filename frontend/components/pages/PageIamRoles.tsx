/**
 * PageIamRoles — Gestion des rôles et permissions du tenant
 *
 * Fonctionnalités :
 *   - Liste des rôles avec compteur d'utilisateurs
 *   - Créer / renommer / supprimer un rôle (non-système)
 *   - Éditer les permissions d'un rôle (checklist groupée par module)
 */
import { useState, useCallback } from 'react';
import { Shield, Plus, Pencil, Trash2, ChevronDown, ChevronRight, Check } from 'lucide-react';
import { useAuth }    from '../../lib/auth/auth.context';
import { useFetch }   from '../../lib/hooks/useFetch';
import { apiPost, apiPatch, apiPut, apiDelete, ApiError } from '../../lib/api';
import { Dialog }     from '../ui/Dialog';
import { Button }     from '../ui/Button';
import { Input }      from '../ui/Input';
import { Badge }      from '../ui/Badge';
import { Skeleton }   from '../ui/Skeleton';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RolePermission { permission: string }
interface Role {
  id:          string;
  name:        string;
  isSystem:    boolean;
  permissions: RolePermission[];
  _count:      { users: number };
}

// ─── All permission strings grouped by module ─────────────────────────────────

const PERMISSION_GROUPS: { label: string; perms: string[] }[] = [
  {
    label: 'IAM & Accès',
    perms: [
      'control.iam.manage.tenant',
      'control.iam.audit.tenant',
      'data.session.revoke.tenant',
      'data.session.revoke.own',
      'data.user.read.agency',
    ],
  },
  {
    label: 'Billetterie',
    perms: [
      'data.ticket.create.agency',
      'data.ticket.cancel.agency',
      'data.ticket.scan.agency',
      'data.ticket.read.agency',
      'data.ticket.read.tenant',
      'data.ticket.print.agency',
      'data.traveler.verify.agency',
      'data.luggage.weigh.agency',
    ],
  },
  {
    label: 'Trajets & Routes',
    perms: [
      'data.trip.create.tenant',
      'data.trip.read.own',
      'data.trip.update.agency',
      'data.trip.check.own',
      'data.trip.report.own',
      'control.trip.delay.agency',
      'control.trip.cancel.tenant',
      'control.trip.log_event.own',
      'control.route.manage.tenant',
    ],
  },
  {
    label: 'Colis & Expéditions',
    perms: [
      'data.parcel.create.agency',
      'data.parcel.scan.agency',
      'data.parcel.update.agency',
      'data.parcel.update.tenant',
      'data.parcel.report.agency',
      'data.parcel.print.agency',
      'data.shipment.group.agency',
    ],
  },
  {
    label: 'Flotte & Maintenance',
    perms: [
      'control.fleet.manage.tenant',
      'control.fleet.layout.tenant',
      'control.bus.capacity.tenant',
      'data.fleet.status.agency',
      'data.maintenance.update.own',
      'data.maintenance.approve.tenant',
    ],
  },
  {
    label: 'Manifestes',
    perms: [
      'data.manifest.read.own',
      'data.manifest.generate.agency',
      'data.manifest.sign.agency',
      'data.manifest.print.agency',
    ],
  },
  {
    label: 'Finance & Caisse',
    perms: [
      'control.pricing.manage.tenant',
      'control.pricing.yield.tenant',
      'data.pricing.read.agency',
      'data.cashier.open.own',
      'data.cashier.transaction.own',
      'data.cashier.close.agency',
      'data.invoice.print.agency',
    ],
  },
  {
    label: 'SAV',
    perms: [
      'data.sav.report.own',
      'data.sav.report.agency',
      'data.sav.deliver.agency',
      'data.sav.claim.tenant',
    ],
  },
  {
    label: 'Staff & RH',
    perms: [
      'control.staff.manage.tenant',
      'data.staff.read.agency',
      'control.driver.manage.tenant',
      'data.driver.profile.agency',
      'data.driver.rest.own',
    ],
  },
  {
    label: 'CRM & Campagnes',
    perms: [
      'data.crm.read.tenant',
      'control.campaign.manage.tenant',
      'data.feedback.submit.own',
    ],
  },
  {
    label: 'Crew & Sécurité',
    perms: [
      'data.crew.manage.tenant',
      'control.qhse.manage.tenant',
      'data.accident.report.own',
    ],
  },
  {
    label: 'Analytique & Affichage',
    perms: [
      'control.stats.read.tenant',
      'data.display.update.agency',
      'data.notification.read.own',
    ],
  },
  {
    label: 'Workflow Studio',
    perms: [
      'control.workflow.config.tenant',
      'control.workflow.studio.read.tenant',
      'control.workflow.studio.write.tenant',
      'control.workflow.marketplace.read.tenant',
      'control.workflow.blueprint.import.tenant',
      'control.workflow.simulate.tenant',
    ],
  },
  {
    label: 'Paramètres & Modules',
    perms: [
      'control.settings.manage.tenant',
      'control.module.install.tenant',
      'control.integration.setup.tenant',
    ],
  },
  {
    label: 'Documents & Templates',
    perms: [
      'data.template.read.agency',
      'data.template.write.agency',
      'data.template.delete.agency',
    ],
  },
];

// ─── Permission label ─────────────────────────────────────────────────────────

function permLabel(perm: string): string {
  const parts = perm.split('.');
  // control.iam.manage.tenant → manage · tenant
  return parts.slice(2).join(' · ');
}

// ─── PermissionEditor ─────────────────────────────────────────────────────────

function PermissionEditor({
  selected,
  onChange,
}: {
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (g: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(g) ? next.delete(g) : next.add(g);
      return next;
    });
  };

  const togglePerm = (perm: string) => {
    const next = new Set(selected);
    next.has(perm) ? next.delete(perm) : next.add(perm);
    onChange(next);
  };

  const toggleGroup = (perms: string[]) => {
    const allSelected = perms.every(p => selected.has(p));
    const next = new Set(selected);
    perms.forEach(p => allSelected ? next.delete(p) : next.add(p));
    onChange(next);
  };

  return (
    <div className="space-y-1 max-h-[55vh] overflow-y-auto pr-1">
      {PERMISSION_GROUPS.map(group => {
        const groupSelected = group.perms.filter(p => selected.has(p)).length;
        const allSelected   = groupSelected === group.perms.length;
        const isOpen        = expanded.has(group.label);

        return (
          <div key={group.label} className="rounded-lg border border-slate-700 overflow-hidden">
            <button
              type="button"
              onClick={() => toggle(group.label)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700/60 transition-colors"
            >
              <input
                type="checkbox"
                checked={allSelected}
                ref={el => { if (el) el.indeterminate = groupSelected > 0 && !allSelected; }}
                onChange={() => toggleGroup(group.perms)}
                onClick={e => e.stopPropagation()}
                className="rounded border-slate-500 bg-slate-700 text-indigo-500 cursor-pointer"
              />
              <span className="flex-1 text-left text-sm font-medium text-slate-200">{group.label}</span>
              <span className="text-xs text-slate-400">{groupSelected}/{group.perms.length}</span>
              {isOpen
                ? <ChevronDown size={14} className="text-slate-400" />
                : <ChevronRight size={14} className="text-slate-400" />}
            </button>

            {isOpen && (
              <div className="px-3 py-2 space-y-1 bg-slate-900/40">
                {group.perms.map(perm => (
                  <label key={perm} className="flex items-center gap-2 cursor-pointer py-0.5">
                    <input
                      type="checkbox"
                      checked={selected.has(perm)}
                      onChange={() => togglePerm(perm)}
                      className="rounded border-slate-500 bg-slate-700 text-indigo-500"
                    />
                    <span className="text-xs text-slate-300 font-mono">{permLabel(perm)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function PageIamRoles() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/v1/tenants/${tenantId}/iam`;

  const [rev, setRev]                   = useState(0);
  const reload                          = useCallback(() => setRev(r => r + 1), []);

  const { data: rolesData, loading }    = useFetch<Role[]>(`${base}/roles`, [rev]);
  const roles                           = rolesData ?? [];

  // Create
  const [showCreate, setShowCreate]     = useState(false);
  const [createName, setCreateName]     = useState('');
  const [createErr, setCreateErr]       = useState('');
  const [creating, setCreating]         = useState(false);

  // Rename
  const [editRole, setEditRole]         = useState<Role | null>(null);
  const [editName, setEditName]         = useState('');
  const [editErr, setEditErr]           = useState('');
  const [saving, setSaving]             = useState(false);

  // Permissions
  const [permRole, setPermRole]         = useState<Role | null>(null);
  const [permSet, setPermSet]           = useState<Set<string>>(new Set());
  const [savingPerms, setSavingPerms]   = useState(false);
  const [permErr, setPermErr]           = useState('');

  // Delete
  const [deleteRole, setDeleteRole]     = useState<Role | null>(null);
  const [deleting, setDeleting]         = useState(false);

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function handleCreate() {
    if (!createName.trim()) { setCreateErr('Nom requis'); return; }
    setCreating(true); setCreateErr('');
    try {
      await apiPost(`${base}/roles`, { name: createName.trim() });
      setShowCreate(false); setCreateName(''); reload();
    } catch (e) {
      setCreateErr(e instanceof ApiError ? String((e.body as any)?.message ?? e.message) : 'Erreur');
    } finally { setCreating(false); }
  }

  async function handleRename() {
    if (!editName.trim()) { setEditErr('Nom requis'); return; }
    setSaving(true); setEditErr('');
    try {
      await apiPatch(`${base}/roles/${editRole!.id}`, { name: editName.trim() });
      setEditRole(null); reload();
    } catch (e) {
      setEditErr(e instanceof ApiError ? String((e.body as any)?.message ?? e.message) : 'Erreur');
    } finally { setSaving(false); }
  }

  async function handleSavePerms() {
    setSavingPerms(true); setPermErr('');
    try {
      await apiPut(`${base}/roles/${permRole!.id}/permissions`, {
        permissions: Array.from(permSet),
      });
      setPermRole(null); reload();
    } catch (e) {
      setPermErr(e instanceof ApiError ? String((e.body as any)?.message ?? e.message) : 'Erreur');
    } finally { setSavingPerms(false); }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await apiDelete(`${base}/roles/${deleteRole!.id}`);
      setDeleteRole(null); reload();
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e instanceof ApiError ? String((e.body as any)?.message ?? e.message) : 'Erreur');
    } finally { setDeleting(false); }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield size={24} className="text-indigo-400" />
            Rôles & Permissions
          </h1>
          <p className="text-slate-400 text-sm mt-1">Gérez les rôles et leurs permissions</p>
        </div>
        <Button size="sm" onClick={() => { setCreateName(''); setCreateErr(''); setShowCreate(true); }}>
          <Plus size={15} className="mr-1" /> Nouveau rôle
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-slate-400">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Nom</th>
              <th className="text-left px-4 py-3 font-medium">Permissions</th>
              <th className="text-left px-4 py-3 font-medium">Utilisateurs</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading && Array.from({ length: 4 }).map((_, i) => (
              <tr key={i} className="bg-slate-900">
                <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
                <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
                <td className="px-4 py-3"><Skeleton className="h-4 w-10" /></td>
                <td className="px-4 py-3" />
              </tr>
            ))}
            {!loading && roles.map(role => (
              <tr key={role.id} className="bg-slate-900 hover:bg-slate-800/60 transition-colors">
                <td className="px-4 py-3 font-medium text-white">
                  <div className="flex items-center gap-2">
                    {role.name}
                    {role.isSystem && (
                      <Badge variant="outline" className="text-xs normal-case">système</Badge>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => {
                      setPermRole(role);
                      setPermSet(new Set(role.permissions.map(p => p.permission)));
                      setPermErr('');
                    }}
                    className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    <Check size={13} />
                    <span>{role.permissions.length} perm{role.permissions.length !== 1 ? 's' : ''}</span>
                  </button>
                </td>
                <td className="px-4 py-3 text-slate-400">{role._count.users}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 justify-end">
                    {!role.isSystem && (
                      <>
                        <button
                          type="button"
                          onClick={() => { setEditRole(role); setEditName(role.name); setEditErr(''); }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                          title="Renommer"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteRole(role)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-900/20 transition-colors"
                          title="Supprimer"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && roles.length === 0 && (
              <tr className="bg-slate-900">
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  Aucun rôle défini
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create dialog */}
      <Dialog
        open={showCreate}
        onOpenChange={o => { if (!o) setShowCreate(false); }}
        title="Nouveau rôle"
        description="Créez un rôle personnalisé — vous pourrez lui assigner des permissions ensuite."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Annuler</Button>
            <Button size="sm" onClick={handleCreate} disabled={creating}>
              {creating ? 'Création…' : 'Créer'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            placeholder="Ex. : Responsable Billetterie"
            value={createName}
            onChange={e => setCreateName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            autoFocus
          />
          {createErr && <p className="text-xs text-red-400">{createErr}</p>}
        </div>
      </Dialog>

      {/* Rename dialog */}
      <Dialog
        open={!!editRole}
        onOpenChange={o => { if (!o) setEditRole(null); }}
        title="Renommer le rôle"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditRole(null)}>Annuler</Button>
            <Button size="sm" onClick={handleRename} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleRename()}
            autoFocus
          />
          {editErr && <p className="text-xs text-red-400">{editErr}</p>}
        </div>
      </Dialog>

      {/* Permissions dialog */}
      <Dialog
        open={!!permRole}
        onOpenChange={o => { if (!o) setPermRole(null); }}
        title={`Permissions — ${permRole?.name ?? ''}`}
        description="Cochez les permissions à accorder. Les modifications sont appliquées immédiatement."
        size="xl"
        footer={
          <>
            <span className="flex-1 text-xs text-slate-400">{permSet.size} permission(s) sélectionnée(s)</span>
            <Button variant="ghost" size="sm" onClick={() => setPermRole(null)}>Annuler</Button>
            <Button size="sm" onClick={handleSavePerms} disabled={savingPerms}>
              {savingPerms ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <PermissionEditor selected={permSet} onChange={setPermSet} />
          {permErr && <p className="text-xs text-red-400">{permErr}</p>}
        </div>
      </Dialog>

      {/* Delete confirm */}
      <Dialog
        open={!!deleteRole}
        onOpenChange={o => { if (!o) setDeleteRole(null); }}
        title="Supprimer le rôle"
        description={`Êtes-vous sûr de vouloir supprimer "${deleteRole?.name}" ? Cette action est irréversible.`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleteRole(null)}>Annuler</Button>
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Suppression…' : 'Supprimer'}
            </Button>
          </>
        }
      >
        {deleteRole?._count.users ? (
          <p className="text-sm text-amber-400">
            Ce rôle est assigné à {deleteRole._count.users} utilisateur(s).
            Réassignez-les d'abord.
          </p>
        ) : (
          <p className="text-sm text-slate-400">Cette opération ne peut pas être annulée.</p>
        )}
      </Dialog>
    </div>
  );
}
