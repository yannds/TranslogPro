/**
 * PageAgencies — Gestion des agences du tenant
 *
 * CRUD : lister · créer · renommer · supprimer (sauf la dernière)
 *
 * Données :
 *   GET    /api/tenants/:tid/agencies
 *   POST   /api/tenants/:tid/agencies        body: { name, stationId? }
 *   PATCH  /api/tenants/:tid/agencies/:id    body: { name?, stationId? }
 *   DELETE /api/tenants/:tid/agencies/:id    409 si dernière agence
 *
 * Invariant protégé côté backend (AgencyService.remove) — on affiche simplement
 * l'erreur 409 si l'utilisateur tente de supprimer la dernière.
 */

import { useState, type FormEvent } from 'react';
import {
  Building2, Plus, Pencil, Trash2, X, Check, AlertTriangle,
} from 'lucide-react';
import { useFetch }                        from '../../lib/hooks/useFetch';
import { apiPost, apiPatch, apiDelete }    from '../../lib/api';
import { useAuth }                         from '../../lib/auth/auth.context';
import { Button }                          from '../ui/Button';
import { Dialog }                          from '../ui/Dialog';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgencyRow {
  id:         string;
  name:       string;
  stationId:  string | null;
}

interface CreateForm { name: string }
interface EditForm   { name: string }

// ─── Colonnes DataTableMaster ─────────────────────────────────────────────────

function buildColumns(): Column<AgencyRow>[] {
  return [
    {
      key: 'name',
      header: 'Nom',
      sortable: true,
      cellRenderer: (_v, row) => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
            <Building2 className="w-4 h-4 text-blue-600 dark:text-blue-400" aria-hidden />
          </div>
          <span className="text-sm font-medium text-slate-900 dark:text-white truncate">
            {row.name}
          </span>
        </div>
      ),
      csvValue: (_v, row) => row.name,
    },
    {
      key: 'stationId',
      header: 'Station liée',
      sortable: false,
      cellRenderer: (v) => (
        <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
          {v ? String(v) : '—'}
        </span>
      ),
      csvValue: (v) => (v ? String(v) : ''),
    },
  ];
}

// ─── Formulaires ──────────────────────────────────────────────────────────────

const inp = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50';

function CreateAgencyForm({ onSubmit, onCancel, busy, error }: {
  onSubmit: (f: CreateForm) => void;
  onCancel: () => void;
  busy:     boolean;
  error:    string | null;
}) {
  const [f, setF] = useState<CreateForm>({ name: '' });
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Nom de l'agence <span aria-hidden className="text-red-500">*</span>
        </label>
        <input type="text" required value={f.name}
          onChange={e => setF({ name: e.target.value })}
          className={inp} disabled={busy} placeholder="ex. Agence Pointe-Noire" />
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

function EditAgencyForm({ agency, onSubmit, onCancel, busy, error }: {
  agency:   AgencyRow;
  onSubmit: (f: EditForm) => void;
  onCancel: () => void;
  busy:     boolean;
  error:    string | null;
}) {
  const [f, setF] = useState<EditForm>({ name: agency.name });
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Nom de l'agence <span aria-hidden className="text-red-500">*</span>
        </label>
        <input type="text" required value={f.name}
          onChange={e => setF({ name: e.target.value })}
          className={inp} disabled={busy} />
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

export function PageAgencies() {
  const { user: me } = useAuth();
  const tenantId = me?.tenantId ?? '';
  const base     = `/api/tenants/${tenantId}/agencies`;

  const { data: agencies, loading, error, refetch } = useFetch<AgencyRow[]>(
    tenantId ? base : null,
    [tenantId],
  );

  const [showCreate,    setShowCreate]    = useState(false);
  const [editTarget,    setEditTarget]    = useState<AgencyRow | null>(null);
  const [deleteTarget,  setDeleteTarget]  = useState<AgencyRow | null>(null);
  const [busy,          setBusy]          = useState(false);
  const [actionErr,     setActionErr]     = useState<string | null>(null);

  const isLast = (agencies?.length ?? 0) <= 1;

  const handleCreate = async (f: CreateForm) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPost(base, { name: f.name });
      setShowCreate(false); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleEdit = async (f: EditForm) => {
    if (!editTarget) return;
    setBusy(true); setActionErr(null);
    try {
      await apiPatch(`${base}/${editTarget.id}`, { name: f.name });
      setEditTarget(null); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true); setActionErr(null);
    try {
      await apiDelete(`${base}/${deleteTarget.id}`);
      setDeleteTarget(null); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const columns = buildColumns();
  const rowActions: RowAction<AgencyRow>[] = [
    {
      label:   'Renommer',
      icon:    <Pencil size={13} />,
      onClick: (row) => { setEditTarget(row); setActionErr(null); },
    },
    {
      label:    'Supprimer',
      icon:     <Trash2 size={13} />,
      danger:   true,
      disabled: () => isLast,
      onClick:  (row) => { setDeleteTarget(row); setActionErr(null); },
    },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
            <Building2 className="w-5 h-5 text-blue-600 dark:text-blue-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Agences</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {agencies ? `${agencies.length} agence(s)` : 'Gestion des agences du tenant'}
            </p>
          </div>
        </div>
        <Button onClick={() => { setShowCreate(true); setActionErr(null); }}>
          <Plus className="w-4 h-4 mr-2" aria-hidden />Nouvelle agence
        </Button>
      </div>

      {/* Rappel invariant */}
      <div className="rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
        Un tenant possède toujours au moins une agence — la dernière ne peut pas être supprimée.
        Les utilisateurs rattachés à une agence supprimée sont détachés automatiquement et devront être réaffectés.
      </div>

      {(error || actionErr) && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />{error ?? actionErr}
        </div>
      )}

      {/* Tableau */}
      <DataTableMaster<AgencyRow>
        columns={columns}
        data={agencies ?? []}
        loading={loading}
        rowActions={rowActions}
        defaultSort={{ key: 'name', dir: 'asc' }}
        defaultPageSize={25}
        searchPlaceholder="Rechercher une agence…"
        emptyMessage="Aucune agence."
        exportFormats={['csv', 'json', 'xls']}
        exportFilename="agences"
        onRowClick={(row) => { setEditTarget(row); setActionErr(null); }}
        stickyHeader
      />

      {/* Modal Créer */}
      <Dialog
        open={showCreate}
        onOpenChange={o => { if (!o) setShowCreate(false); }}
        title="Nouvelle agence"
        description="Créez une nouvelle agence pour votre tenant."
        size="md"
      >
        <CreateAgencyForm
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
          busy={busy}
          error={actionErr}
        />
      </Dialog>

      {/* Modal Renommer */}
      <Dialog
        open={!!editTarget}
        onOpenChange={o => { if (!o) setEditTarget(null); }}
        title="Renommer l'agence"
        description={editTarget?.name}
        size="md"
      >
        {editTarget && (
          <EditAgencyForm
            agency={editTarget}
            onSubmit={handleEdit}
            onCancel={() => setEditTarget(null)}
            busy={busy}
            error={actionErr}
          />
        )}
      </Dialog>

      {/* Modal Supprimer */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={o => { if (!o) setDeleteTarget(null); }}
        title="Supprimer l'agence"
        description={`Supprimer "${deleteTarget?.name}" ? Les utilisateurs rattachés seront détachés.`}
        footer={
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={busy}>
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
