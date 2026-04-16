/**
 * PageIamRoles — Gestion des rôles et permissions du tenant
 *
 * Fonctionnalités :
 *   - Liste des rôles avec compteur d'utilisateurs (DataTableMaster)
 *   - Créer / renommer / supprimer un rôle (non-système)
 *   - Éditer les permissions d'un rôle (checklist groupée par module)
 */
import { useState, useCallback } from 'react';
import {
  Shield, Plus, Pencil, Trash2, ChevronDown, ChevronRight, Check,
  UserCircle, UserMinus, UserPlus, Mail, RefreshCw,
} from 'lucide-react';
import { useAuth }    from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch }   from '../../lib/hooks/useFetch';
import { apiPost, apiPatch, apiPut, apiDelete, ApiError } from '../../lib/api';
import { Dialog }     from '../ui/Dialog';
import { Button }     from '../ui/Button';
import { Input }      from '../ui/Input';
import { Badge }      from '../ui/Badge';
import { Skeleton }   from '../ui/Skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/Tabs';
import DataTableMaster from '../DataTableMaster';
import type { Column, RowAction } from '../DataTableMaster';

// ─── i18n (string-key based — see locales/fr.ts → iamRoles) ─────────────────

// ─── Types pour les membres du rôle ──────────────────────────────────────────

interface RoleMemberRow {
  id:        string;
  email:     string;
  name:      string | null;
  roleId:    string | null;
  role?:     { id: string; name: string } | null;
}

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

const PERMISSION_GROUPS: { i18nKey: string; perms: string[] }[] = [
  {
    i18nKey: 'iamRoles.iamAccess',
    perms: [
      'control.iam.manage.tenant',
      'control.iam.audit.tenant',
      'data.session.revoke.tenant',
      'data.session.revoke.own',
      'data.user.read.agency',
    ],
  },
  {
    i18nKey: 'iamRoles.ticketing',
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
    i18nKey: 'iamRoles.tripsRoutes',
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
    i18nKey: 'iamRoles.parcelsShipments',
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
    i18nKey: 'iamRoles.fleetMaintenance',
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
    i18nKey: 'iamRoles.manifests',
    perms: [
      'data.manifest.read.own',
      'data.manifest.generate.agency',
      'data.manifest.sign.agency',
      'data.manifest.print.agency',
    ],
  },
  {
    i18nKey: 'iamRoles.financeCashier',
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
    i18nKey: 'iamRoles.sav',
    perms: [
      'data.sav.report.own',
      'data.sav.report.agency',
      'data.sav.deliver.agency',
      'data.sav.claim.tenant',
    ],
  },
  {
    i18nKey: 'iamRoles.staffHr',
    perms: [
      'control.staff.manage.tenant',
      'data.staff.read.agency',
      'control.driver.manage.tenant',
      'data.driver.profile.agency',
      'data.driver.rest.own',
    ],
  },
  {
    i18nKey: 'iamRoles.crmCampaigns',
    perms: [
      'data.crm.read.tenant',
      'control.campaign.manage.tenant',
      'data.feedback.submit.own',
    ],
  },
  {
    i18nKey: 'iamRoles.crewSecurity',
    perms: [
      'data.crew.manage.tenant',
      'control.qhse.manage.tenant',
      'data.accident.report.own',
    ],
  },
  {
    i18nKey: 'iamRoles.analyticsDisplay',
    perms: [
      'control.stats.read.tenant',
      'data.display.update.agency',
      'data.notification.read.own',
    ],
  },
  {
    i18nKey: 'iamRoles.workflowStudio',
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
    i18nKey: 'iamRoles.settingsModules',
    perms: [
      'control.settings.manage.tenant',
      'control.module.install.tenant',
      'control.integration.setup.tenant',
    ],
  },
  {
    i18nKey: 'iamRoles.docsTemplates',
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
  const { t } = useI18n();
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
        const groupLabel    = t(group.i18nKey);
        const groupSelected = group.perms.filter(p => selected.has(p)).length;
        const allSelected   = groupSelected === group.perms.length;
        const isOpen        = expanded.has(groupLabel);

        return (
          <div key={groupLabel} className="rounded-lg t-border border overflow-hidden">
            <button
              type="button"
              onClick={() => toggle(groupLabel)}
              className="w-full flex items-center gap-2 px-3 py-2 t-surface t-nav-hover transition-colors"
            >
              <input
                type="checkbox"
                checked={allSelected}
                ref={el => { if (el) el.indeterminate = groupSelected > 0 && !allSelected; }}
                onChange={() => toggleGroup(group.perms)}
                onClick={e => e.stopPropagation()}
                className="rounded cursor-pointer"
              />
              <span className="flex-1 text-left text-sm font-medium t-text">{groupLabel}</span>
              <span className="text-xs t-text-2">{groupSelected}/{group.perms.length}</span>
              {isOpen
                ? <ChevronDown size={14} className="t-text-3" />
                : <ChevronRight size={14} className="t-text-3" />}
            </button>

            {isOpen && (
              <div className="px-3 py-2 space-y-1 t-card">
                {group.perms.map(perm => (
                  <label key={perm} className="flex items-center gap-2 cursor-pointer py-0.5">
                    <input
                      type="checkbox"
                      checked={selected.has(perm)}
                      onChange={() => togglePerm(perm)}
                      className="rounded"
                    />
                    <span className="text-xs t-text-body font-mono">{permLabel(perm)}</span>
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
  const { t } = useI18n();
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
  const [permTab, setPermTab]           = useState<'perms' | 'members'>('perms');

  // Membres du rôle
  const [showAddMember, setShowAddMember] = useState(false);
  const [membersRev, setMembersRev]       = useState(0);
  const [memberBusy, setMemberBusy]       = useState<string | null>(null); // userId en cours
  const [memberErr, setMemberErr]         = useState('');
  const reloadMembers = useCallback(() => setMembersRev(r => r + 1), []);

  // Tous les utilisateurs du tenant (chargés uniquement quand la modale est ouverte)
  const { data: allUsers, loading: usersLoading } = useFetch<RoleMemberRow[]>(
    permRole ? `${base}/users` : null,
    [permRole?.id, membersRev],
  );

  const members    = (allUsers ?? []).filter(u => u.roleId === permRole?.id);
  const nonMembers = (allUsers ?? []).filter(u => u.roleId !== permRole?.id);

  // Delete
  const [deleteRole, setDeleteRole]     = useState<Role | null>(null);
  const [deleting, setDeleting]         = useState(false);

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function handleCreate() {
    if (!createName.trim()) { setCreateErr(t('iamRoles.nameRequired')); return; }
    setCreating(true); setCreateErr('');
    try {
      await apiPost(`${base}/roles`, { name: createName.trim() });
      setShowCreate(false); setCreateName(''); reload();
    } catch (e) {
      setCreateErr(e instanceof ApiError ? String((e.body as any)?.message ?? e.message) : t('iamRoles.errorGeneric'));
    } finally { setCreating(false); }
  }

  async function handleRename() {
    if (!editName.trim()) { setEditErr(t('iamRoles.nameRequired')); return; }
    setSaving(true); setEditErr('');
    try {
      await apiPatch(`${base}/roles/${editRole!.id}`, { name: editName.trim() });
      setEditRole(null); reload();
    } catch (e) {
      setEditErr(e instanceof ApiError ? String((e.body as any)?.message ?? e.message) : t('iamRoles.errorGeneric'));
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
      setPermErr(e instanceof ApiError ? String((e.body as any)?.message ?? e.message) : t('iamRoles.errorGeneric'));
    } finally { setSavingPerms(false); }
  }

  async function handleRemoveMember(userId: string) {
    if (!permRole) return;
    setMemberBusy(userId); setMemberErr('');
    try {
      await apiPatch(`${base}/users/${userId}`, { roleId: null });
      reloadMembers(); reload();
    } catch (e) {
      setMemberErr(e instanceof ApiError ? String((e.body as any)?.message ?? e.message) : t('iamRoles.errorGeneric'));
    } finally { setMemberBusy(null); }
  }

  async function handleAddMember(userId: string) {
    if (!permRole) return;
    setMemberBusy(userId); setMemberErr('');
    try {
      await apiPatch(`${base}/users/${userId}`, { roleId: permRole.id });
      reloadMembers(); reload();
    } catch (e) {
      setMemberErr(e instanceof ApiError ? String((e.body as any)?.message ?? e.message) : t('iamRoles.errorGeneric'));
    } finally { setMemberBusy(null); }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await apiDelete(`${base}/roles/${deleteRole!.id}`);
      setDeleteRole(null); reload();
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e instanceof ApiError ? String((e.body as any)?.message ?? e.message) : t('iamRoles.errorGeneric'));
    } finally { setDeleting(false); }
  }

  // ── Colonnes DataTableMaster ───────────────────────────────────────────────

  const COLUMNS: Column<Role>[] = [
    {
      key: 'name',
      header: t('common.name'),
      sortable: true,
      cellRenderer: (_, row) => (
        <div className="flex items-center gap-2">
          <span className="t-text font-medium">{row.name}</span>
          {row.isSystem && (
            <Badge variant="outline" className="text-xs normal-case">{t('iamRoles.system')}</Badge>
          )}
        </div>
      ),
    },
    {
      key: 'permissions',
      header: t('iamRoles.permissions'),
      sortable: false,
      cellRenderer: (_, row) => (
        <button
          type="button"
          onClick={() => {
            setPermRole(row);
            setPermSet(new Set(row.permissions.map(p => p.permission)));
            setPermErr('');
          }}
          className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 transition-colors"
        >
          <Check size={13} />
          <span>{row.permissions.length} perm{row.permissions.length !== 1 ? 's' : ''}</span>
        </button>
      ),
      csvValue: (_, row) => String(row.permissions.length),
    },
    {
      key: '_count',
      header: t('iamRoles.colUsers'),
      sortable: true,
      align: 'right',
      cellRenderer: (_, row) => (
        <span className="t-text-2 tabular-nums">{row._count.users}</span>
      ),
      csvValue: (_, row) => String(row._count.users),
    },
  ];

  const ROW_ACTIONS: RowAction<Role>[] = [
    {
      label: t('iamRoles.permissions'),
      icon: <Check size={14} />,
      onClick: (row) => {
        setPermRole(row);
        setPermSet(new Set(row.permissions.map(p => p.permission)));
        setPermErr('');
      },
    },
    {
      label: t('iamRoles.rename'),
      icon: <Pencil size={14} />,
      hidden: (row) => row.isSystem,
      onClick: (row) => { setEditRole(row); setEditName(row.name); setEditErr(''); },
    },
    {
      label: t('common.delete'),
      icon: <Trash2 size={14} />,
      hidden: (row) => row.isSystem,
      onClick: (row) => setDeleteRole(row),
    },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold t-text flex items-center gap-2">
            <Shield size={24} className="text-indigo-600 dark:text-indigo-400" />
            {t('iamRoles.rolesAndPermissions')}
          </h1>
          <p className="t-text-2 text-sm mt-1">{t('iamRoles.manageRolesDesc')}</p>
        </div>
        <Button size="sm" onClick={() => { setCreateName(''); setCreateErr(''); setShowCreate(true); }}>
          <Plus size={15} className="mr-1" /> {t('iamRoles.newRole')}
        </Button>
      </div>

      {/* Table */}
      <DataTableMaster<Role>
        columns={COLUMNS}
        data={roles}
        loading={false}
        rowActions={ROW_ACTIONS}
        emptyMessage={t('iamRoles.noRoleDefined')}
        exportFormats={['csv', 'json']}
        exportFilename="roles"
        onRowClick={(row) => {
          setPermRole(row);
          setPermSet(new Set(row.permissions.map(p => p.permission)));
          setPermErr('');
        }}
      />

      {/* Create dialog */}
      <Dialog
        open={showCreate}
        onOpenChange={o => { if (!o) setShowCreate(false); }}
        title={t('iamRoles.newRole')}
        description={t('iamRoles.createRoleDesc')}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>{t('common.cancel')}</Button>
            <Button size="sm" onClick={handleCreate} disabled={creating}>
              {creating ? t('common.creating') : t('common.create')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            placeholder={t('iamRoles.placeholderRoleName')}
            value={createName}
            onChange={e => setCreateName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            autoFocus
          />
          {createErr && <p className="text-xs text-red-500 dark:text-red-400">{createErr}</p>}
        </div>
      </Dialog>

      {/* Rename dialog */}
      <Dialog
        open={!!editRole}
        onOpenChange={o => { if (!o) setEditRole(null); }}
        title={t('iamRoles.renameRole')}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditRole(null)}>{t('common.cancel')}</Button>
            <Button size="sm" onClick={handleRename} disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
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
          {editErr && <p className="text-xs text-red-500 dark:text-red-400">{editErr}</p>}
        </div>
      </Dialog>

      {/* Permissions + Membres dialog */}
      <Dialog
        open={!!permRole}
        onOpenChange={o => { if (!o) { setPermRole(null); setPermTab('perms'); } }}
        title={`${t('iamRoles.rolePrefix')}${permRole?.name ?? ''}`}
        description={t('iamRoles.permRoleDesc')}
        size="2xl"
        footer={
          permTab === 'perms' ? (
            <>
              <span className="flex-1 text-xs t-text-2">{permSet.size} {t('iamRoles.permSelected')}</span>
              <Button variant="ghost" size="sm" onClick={() => setPermRole(null)}>{t('common.cancel')}</Button>
              <Button size="sm" onClick={handleSavePerms} disabled={savingPerms}>
                {savingPerms ? t('common.saving') : t('common.save')}
              </Button>
            </>
          ) : (
            <>
              <span className="flex-1 text-xs t-text-2">{members.length} {t('iamRoles.usersAssigned')}</span>
              <Button variant="ghost" size="sm" onClick={() => setPermRole(null)}>{t('common.close')}</Button>
            </>
          )
        }
      >
        <Tabs value={permTab} onValueChange={v => setPermTab(v as 'perms' | 'members')}>
          <TabsList>
            <TabsTrigger value="perms">
              <Check size={14} className="inline mr-1.5" />
              {t('iamRoles.permissions')}
              <Badge variant="outline" className="ml-2 text-[10px] normal-case">{permSet.size}</Badge>
            </TabsTrigger>
            <TabsTrigger value="members">
              <UserCircle size={14} className="inline mr-1.5" />
              {t('iamRoles.members')}
              <Badge variant="outline" className="ml-2 text-[10px] normal-case">{members.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="perms">
            <div className="space-y-3">
              <PermissionEditor selected={permSet} onChange={setPermSet} />
              {permErr && <p className="text-xs text-red-500 dark:text-red-400">{permErr}</p>}
            </div>
          </TabsContent>

          <TabsContent value="members">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium t-text">
                    {t('iamRoles.membersOfRole').replace('{name}', permRole?.name ?? '')}
                  </h3>
                  <button
                    type="button"
                    onClick={reloadMembers}
                    className="inline-flex items-center gap-1 text-xs t-text-2 hover:t-text"
                    title={t('iamRoles.refresh')}
                  >
                    <RefreshCw size={12} /> {t('iamRoles.refresh')}
                  </button>
                </div>
                <Button size="sm" onClick={() => setShowAddMember(true)}>
                  <UserPlus size={14} className="mr-1.5" /> {t('iamRoles.addMember')}
                </Button>
              </div>

              {memberErr && (
                <p className="text-xs text-red-500 dark:text-red-400">{memberErr}</p>
              )}

              <DataTableMaster<RoleMemberRow>
                loading={usersLoading}
                data={members}
                columns={[
                  {
                    key: 'name',
                    header: t('iamRoles.colUser'),
                    sortable: true,
                    cellRenderer: (_, row) => (
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                          <UserCircle className="w-4 h-4 text-slate-400" aria-hidden />
                        </div>
                        <span className="text-sm t-text">{row.name ?? '—'}</span>
                      </div>
                    ),
                    csvValue: (_, row) => row.name ?? '',
                  },
                  {
                    key: 'email',
                    header: t('common.email'),
                    sortable: true,
                    cellRenderer: (_, row) => (
                      <span className="inline-flex items-center gap-1.5 text-xs t-text-2">
                        <Mail size={12} /> {row.email}
                      </span>
                    ),
                  },
                ]}
                rowActions={[{
                  label: t('common.remove'),
                  icon: <UserMinus size={13} />,
                  danger: true,
                  onClick: (row) => handleRemoveMember(row.id),
                  disabled: (row) => memberBusy === row.id,
                }]}
                searchPlaceholder={t('iamRoles.searchMember')}
                emptyMessage={t('iamRoles.noMemberAssigned')}
                defaultPageSize={10}
              />
            </div>
          </TabsContent>
        </Tabs>
      </Dialog>

      {/* Sous-modale : Ajouter des membres au rôle */}
      <Dialog
        open={showAddMember}
        onOpenChange={o => { if (!o) setShowAddMember(false); }}
        title={t('iamRoles.addMembers')}
        description={permRole ? t('iamRoles.addMemberDesc').replace('{name}', permRole.name) : undefined}
        size="xl"
        footer={
          <Button variant="ghost" size="sm" onClick={() => setShowAddMember(false)}>{t('common.close')}</Button>
        }
      >
        <div className="space-y-3">
          {memberErr && (
            <p className="text-xs text-red-500 dark:text-red-400">{memberErr}</p>
          )}
          <DataTableMaster<RoleMemberRow>
            loading={usersLoading}
            data={nonMembers}
            columns={[
              {
                key: 'name',
                header: t('iamRoles.colUser'),
                sortable: true,
                cellRenderer: (_, row) => (
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                      <UserCircle className="w-4 h-4 text-slate-400" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm t-text truncate">{row.name ?? '—'}</p>
                      <p className="text-xs t-text-2 truncate">{row.email}</p>
                    </div>
                  </div>
                ),
                csvValue: (_, row) => `${row.name ?? ''} <${row.email}>`,
              },
              {
                key: 'role',
                header: t('iamRoles.colCurrentRole'),
                sortable: true,
                cellRenderer: (_, row) => row.role
                  ? <Badge variant="outline" className="text-xs normal-case">{row.role.name}</Badge>
                  : <span className="text-xs t-text-3">{t('iamRoles.noRoleLabel')}</span>,
                csvValue: (_, row) => row.role?.name ?? '',
              },
            ]}
            rowActions={[{
              label: t('common.add'),
              icon: <UserPlus size={13} />,
              onClick: (row) => handleAddMember(row.id),
              disabled: (row) => memberBusy === row.id,
            }]}
            searchPlaceholder={t('iamRoles.searchAllUsers')}
            emptyMessage={t('iamRoles.allUsersHaveRole')}
            defaultPageSize={10}
          />
        </div>
      </Dialog>

      {/* Delete confirm */}
      <Dialog
        open={!!deleteRole}
        onOpenChange={o => { if (!o) setDeleteRole(null); }}
        title={t('iamRoles.deleteRole')}
        description={t('iamRoles.deleteRoleDesc').replace('{name}', deleteRole?.name ?? '')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleteRole(null)}>{t('common.cancel')}</Button>
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
              {deleting ? t('common.deleting') : t('common.delete')}
            </Button>
          </>
        }
      >
        {deleteRole?._count.users ? (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            {t('iamRoles.roleAssignedTo').replace('{count}', String(deleteRole._count.users))}
          </p>
        ) : (
          <p className="text-sm t-text-2">{t('iamRoles.cannotUndo')}</p>
        )}
      </Dialog>
    </div>
  );
}
