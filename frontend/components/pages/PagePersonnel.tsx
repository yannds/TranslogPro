/**
 * PagePersonnel — Gestion du personnel (Staff)
 *
 * CRUD : lister · créer · modifier (rôle, agence, dispo) · suspendre/réactiver · archiver
 * Données :
 *   GET    /api/tenants/:tid/staff
 *   POST   /api/tenants/:tid/staff
 *   PATCH  /api/tenants/:tid/staff/:userId
 *   PATCH  /api/tenants/:tid/staff/:userId/suspend
 *   PATCH  /api/tenants/:tid/staff/:userId/reactivate
 *   DELETE /api/tenants/:tid/staff/:userId
 */

import { useState, type FormEvent } from 'react';
import {
  IdCard, Plus, Pencil, Power, Archive, X, UserCircle,
} from 'lucide-react';
import { useFetch }                from '../../lib/hooks/useFetch';
import { apiPost, apiPatch, apiDelete } from '../../lib/api';
import { useAuth }                 from '../../lib/auth/auth.context';
import { Button }                  from '../ui/Button';
import { Badge }                   from '../ui/Badge';
import { Dialog }                  from '../ui/Dialog';
import { ErrorAlert }              from '../ui/ErrorAlert';
import { FormFooter }              from '../ui/FormFooter';
import { inputClass as inp }       from '../ui/inputClass';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';
import { DocumentAttachments } from '../document/DocumentAttachments';

// ─── Types ────────────────────────────────────────────────────────────────────

type StaffRole   = 'DRIVER' | 'HOSTESS' | 'MECHANIC' | 'AGENT' | 'CONTROLLER' | 'SUPERVISOR';
type StaffStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

interface StaffRow {
  id:            string;
  userId:        string;
  tenantId:      string;
  agencyId:      string | null;
  role:          StaffRole | string;
  status:        StaffStatus | string;
  isAvailable:   boolean;
  licenseData:   Record<string, unknown> | null;
  createdAt:     string;
  user: {
    id:    string;
    email: string;
    name:  string | null;
  };
}

interface CreateForm {
  email:    string;
  name:     string;
  role:     StaffRole;
  agencyId: string;   // '' = aucune
}

interface AgencyOption { id: string; name: string }

interface EditForm {
  name:        string;
  role:        StaffRole | string;
  agencyId:    string;
  isAvailable: boolean;
}

const ROLE_OPTIONS: { value: StaffRole; label: string }[] = [
  { value: 'DRIVER',     label: 'Chauffeur' },
  { value: 'HOSTESS',    label: 'Hôtesse / Steward' },
  { value: 'MECHANIC',   label: 'Mécanicien' },
  { value: 'AGENT',      label: 'Agent de gare' },
  { value: 'CONTROLLER', label: 'Contrôleur' },
  { value: 'SUPERVISOR', label: 'Superviseur' },
];

function roleLabel(value: string): string {
  return ROLE_OPTIONS.find(r => r.value === value)?.label ?? value;
}

// ─── Colonnes ─────────────────────────────────────────────────────────────────

function buildColumns(): Column<StaffRow>[] {
  return [
    {
      key: 'user',
      header: 'Membre',
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
      key: 'role',
      header: 'Fonction',
      sortable: true,
      cellRenderer: (v) => <Badge variant="info">{roleLabel(String(v))}</Badge>,
      csvValue:     (v) => roleLabel(String(v)),
    },
    {
      key: 'status',
      header: 'Statut',
      sortable: true,
      width: '120px',
      cellRenderer: (v) => {
        const s = String(v);
        if (s === 'ACTIVE')    return <Badge variant="success">Actif</Badge>;
        if (s === 'SUSPENDED') return <Badge variant="warning">Suspendu</Badge>;
        if (s === 'ARCHIVED')  return <Badge variant="default">Archivé</Badge>;
        return <Badge variant="default">{s}</Badge>;
      },
      csvValue: (v) => String(v),
    },
    {
      key: 'isAvailable',
      header: 'Dispo',
      sortable: true,
      width: '90px',
      align: 'center',
      cellRenderer: (v) => (
        <span
          aria-label={v ? 'Disponible' : 'Indisponible'}
          className={
            'inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ' +
            (v
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400')
          }
        >
          <span className={'h-1.5 w-1.5 rounded-full ' + (v ? 'bg-emerald-500' : 'bg-slate-400')} aria-hidden />
          {v ? 'Oui' : 'Non'}
        </span>
      ),
      csvValue: (v) => (v ? 'oui' : 'non'),
    },
    {
      key: 'createdAt',
      header: 'Embauché',
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
  const [f, setF] = useState<CreateForm>({
    email: '', name: '', role: 'DRIVER', agencyId: '',
  });
  const set = <K extends keyof CreateForm>(k: K, v: CreateForm[K]) =>
    setF(p => ({ ...p, [k]: v }));

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      <ErrorAlert error={error} />
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Email <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="email" required value={f.email}
            onChange={e => set('email', e.target.value)}
            className={inp} disabled={busy} placeholder="prenom.nom@example.com"
            autoComplete="email" />
        </div>
        <div className="col-span-2 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Nom complet <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="text" required value={f.name}
            onChange={e => set('name', e.target.value)}
            className={inp} disabled={busy} placeholder="Jean Dupont"
            autoComplete="name" />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Fonction <span aria-hidden className="text-red-500">*</span>
          </label>
          <select value={f.role}
            onChange={e => set('role', e.target.value as StaffRole)}
            className={inp} disabled={busy}>
            {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Agence
          </label>
          <select value={f.agencyId}
            onChange={e => set('agencyId', e.target.value)}
            className={inp} disabled={busy}>
            <option value="">— Aucune agence —</option>
            {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>
      <FormFooter onCancel={onCancel} busy={busy} submitLabel="Créer" pendingLabel="Création…" />
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
  const [f, setF] = useState<EditForm>({
    name:        staff.user?.name ?? '',
    role:        staff.role,
    agencyId:    staff.agencyId ?? '',
    isAvailable: staff.isAvailable,
  });
  const set = <K extends keyof EditForm>(k: K, v: EditForm[K]) =>
    setF(p => ({ ...p, [k]: v }));

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      <ErrorAlert error={error} />
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Nom complet</label>
          <input type="text" value={f.name}
            onChange={e => set('name', e.target.value)}
            className={inp} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Fonction</label>
          <select value={f.role}
            onChange={e => set('role', e.target.value as StaffRole)}
            className={inp} disabled={busy}>
            {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Agence</label>
          <select value={f.agencyId}
            onChange={e => set('agencyId', e.target.value)}
            className={inp} disabled={busy}>
            <option value="">— Aucune agence —</option>
            {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input type="checkbox" checked={f.isAvailable}
            onChange={e => set('isAvailable', e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            disabled={busy} />
          Disponible pour affectation
        </label>
        <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2">
          <p>Email : <span className="font-mono">{staff.user?.email}</span></p>
          <p>Statut : {staff.status}</p>
        </div>

        {/* Pièces jointes (contrat, permis, certifications) */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Pièces jointes</h3>
          <DocumentAttachments
            tenantId={tenantId}
            entityType="STAFF"
            entityId={staff.userId}
            allowedKinds={['CONTRACT', 'ID_CARD', 'LICENSE', 'CERTIFICATE', 'PHOTO', 'OTHER']}
            onPreviewChange={onPreviewChange}
          />
        </div>
      </div>
      <FormFooter onCancel={onCancel} busy={busy} submitLabel="Enregistrer" pendingLabel="Enregistrement…" />
    </form>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function PagePersonnel() {
  const { user: me } = useAuth();
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
  const [editTarget,    setEditTarget]    = useState<StaffRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<StaffRow | null>(null);
  const [busy,          setBusy]          = useState(false);
  const [actionErr,     setActionErr]     = useState<string | null>(null);
  const [editPreviewOpen, setEditPreviewOpen] = useState(false);

  const data = (staffList ?? []).filter(s => {
    if (filterRole   && s.role   !== filterRole)   return false;
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
        name:        f.name,
        role:        f.role,
        agencyId:    f.agencyId || null,
        isAvailable: f.isAvailable,
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

  const handleArchive = async () => {
    if (!archiveTarget) return;
    setBusy(true); setActionErr(null);
    try {
      await apiDelete(`${base}/${archiveTarget.userId}`);
      setArchiveTarget(null); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const columns = buildColumns();
  const rowActions: RowAction<StaffRow>[] = [
    {
      label:   'Modifier',
      icon:    <Pencil size={13} />,
      onClick: (row) => { setEditTarget(row); setActionErr(null); },
    },
    {
      label:   'Suspendre',
      icon:    <Power size={13} />,
      hidden:  (row) => row.status !== 'ACTIVE',
      onClick: (row) => void handleToggleSuspend(row),
    },
    {
      label:   'Réactiver',
      icon:    <Power size={13} />,
      hidden:  (row) => row.status !== 'SUSPENDED',
      onClick: (row) => void handleToggleSuspend(row),
    },
    {
      label:   'Archiver',
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
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Personnel</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {staffList ? `${staffList.length} membre(s) du personnel` : 'Gestion du personnel'}
            </p>
          </div>
        </div>
        <Button onClick={() => { setShowCreate(true); setActionErr(null); }}>
          <Plus className="w-4 h-4 mr-2" aria-hidden />Nouveau membre
        </Button>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-3">
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)} className={filterCls}
          aria-label="Filtrer par fonction">
          <option value="">Toutes fonctions</option>
          {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={filterCls}
          aria-label="Filtrer par statut">
          <option value="">Tous statuts</option>
          <option value="ACTIVE">Actif</option>
          <option value="SUSPENDED">Suspendu</option>
          <option value="ARCHIVED">Archivé</option>
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
          searchPlaceholder="Rechercher (nom, email, fonction…)"
          emptyMessage={staffList?.length === 0 ? 'Aucun membre. Cliquez sur « Nouveau membre » pour commencer.' : 'Aucun résultat.'}
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
        title="Nouveau membre du personnel"
        description="Le membre recevra un mot de passe temporaire par email."
        size="md"
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
        title="Modifier le membre"
        description={editTarget?.user?.email}
        size={editPreviewOpen ? '3xl' : 'md'}
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

      {/* Modal Archiver */}
      <Dialog
        open={!!archiveTarget}
        onOpenChange={o => { if (!o) setArchiveTarget(null); }}
        title="Archiver le membre"
        description={`Archiver « ${archiveTarget?.user?.name ?? archiveTarget?.user?.email} » ? Le membre ne sera plus visible mais ses données restent conservées.`}
        footer={
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setArchiveTarget(null)} disabled={busy}>
              <X className="w-4 h-4 mr-1.5" aria-hidden />Annuler
            </Button>
            <Button
              onClick={handleArchive}
              disabled={busy}
              loading={busy}
              variant="destructive"
            >
              <Archive className="w-4 h-4 mr-1.5" aria-hidden />
              {busy ? 'Archivage…' : 'Archiver'}
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
