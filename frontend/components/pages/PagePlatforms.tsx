/**
 * PagePlatforms — Gestion des quais de gare
 *
 * API :
 *   GET    /api/tenants/:tid/platforms
 *   POST   /api/tenants/:tid/platforms
 *   PATCH  /api/tenants/:tid/platforms/:id
 *   DELETE /api/tenants/:tid/platforms/:id
 *   POST   /api/tenants/:tid/platforms/:id/assign
 *   POST   /api/tenants/:tid/platforms/:id/release
 */

import { useState, type FormEvent } from 'react';
import {
  MapPinned, Plus, Pencil, Wrench, Trash2, LogIn, LogOut, Link2,
} from 'lucide-react';
import { useAuth }       from '../../lib/auth/auth.context';
import { useFetch }      from '../../lib/hooks/useFetch';
import { apiPost, apiPatch, apiDelete } from '../../lib/api';
import { useI18n }       from '../../lib/i18n/useI18n';
import { Badge }         from '../ui/Badge';
import { Button }        from '../ui/Button';
import { Dialog }        from '../ui/Dialog';
import { ErrorAlert }    from '../ui/ErrorAlert';
import { FormFooter }    from '../ui/FormFooter';
import { inputClass as inp } from '../ui/inputClass';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

// ─── Types ────────────────────────────────────────────────────────────────────

type PlatformStatus = 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE' | 'CLOSED';

interface PlatformRow {
  id:            string;
  stationId:     string;
  name:          string;
  code:          string;
  capacity:      number;
  status:        PlatformStatus;
  currentTripId: string | null;
  notes:         string | null;
  station?:      { id: string; name: string; city: string };
}

interface StationRow { id: string; name: string; city: string; }

interface TripLite {
  id: string;
  status: string;
  departureScheduled?: string;
  route?: {
    origin?: { id: string; name: string; city?: string };
    destination?: { id: string; name: string; city?: string };
    originId?: string;
  };
  bus?: { plateNumber?: string | null };
}

const STATUS_VARIANT: Record<PlatformStatus, 'success' | 'warning' | 'danger' | 'default'> = {
  AVAILABLE:   'success',
  OCCUPIED:    'warning',
  MAINTENANCE: 'danger',
  CLOSED:      'default',
};

// ─── Build Columns ────────────────────────────────────────────────────────────

function buildColumns(t: (k: string) => string): Column<PlatformRow>[] {
  return [
    {
      key: 'name', header: t('platforms.colName'), sortable: true,
      cellRenderer: (_v, row) => (
        <div className="flex items-center gap-2">
          <MapPinned className="w-4 h-4 text-teal-500" />
          <span className="font-medium text-slate-900 dark:text-slate-100">{row.name}</span>
          <span className="text-xs font-mono text-slate-400">({row.code})</span>
        </div>
      ),
    },
    {
      key: 'station.name' as keyof PlatformRow, header: t('platforms.colStation'), sortable: true,
      cellRenderer: (_v, row) => row.station ? `${row.station.name} — ${row.station.city}` : '—',
    },
    { key: 'capacity', header: t('platforms.colCapacity'), sortable: true },
    {
      key: 'status', header: t('platforms.colStatus'),
      cellRenderer: (_v, row) => (
        <Badge variant={STATUS_VARIANT[row.status]}>
          {t(`platforms.status${row.status.charAt(0) + row.status.slice(1).toLowerCase()}`)}
        </Badge>
      ),
    },
    {
      key: 'currentTripId', header: t('platforms.colTrip'),
      cellRenderer: (v) => (v as string) ? <span className="font-mono text-xs">{(v as string).slice(0, 8)}…</span> : '—',
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PagePlatforms() {
  const { user: me } = useAuth();
  const { t }        = useI18n();
  const tenantId     = me?.tenantId ?? '';
  const base         = `/api/tenants/${tenantId}/platforms`;

  const { data: platforms, loading, refetch } = useFetch<PlatformRow[]>(tenantId ? base : null, [tenantId]);
  const { data: stations } = useFetch<StationRow[]>(tenantId ? `/api/tenants/${tenantId}/stations` : null, [tenantId]);

  const [showCreate, setShowCreate]     = useState(false);
  const [editTarget,   setEditTarget]   = useState<PlatformRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlatformRow | null>(null);
  const [assignTarget, setAssignTarget] = useState<PlatformRow | null>(null);
  const [busy, setBusy]     = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  // Chargement paresseux des trajets candidats — uniquement quand le dialog assign est ouvert
  const { data: assignableTrips } = useFetch<TripLite[]>(
    assignTarget && tenantId
      ? `/api/tenants/${tenantId}/trips?status=PLANNED&status=OPEN&status=BOARDING`
      : null,
    [assignTarget?.id, tenantId],
  );

  // Filtrer par station : on propose d'abord les trajets dont l'origine est la
  // même que la station du quai (logique métier : un quai sert les départs
  // depuis sa gare). Fallback : tous les trajets actifs si aucun match.
  const tripsForTarget: TripLite[] = (() => {
    if (!assignableTrips || !assignTarget) return [];
    const sameStation = assignableTrips.filter(
      t => t.route?.originId === assignTarget.stationId
        || t.route?.origin?.id === assignTarget.stationId,
    );
    return sameStation.length > 0 ? sameStation : assignableTrips;
  })();

  const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true); setActionErr(null);
    try {
      await apiPost(base, {
        stationId: fd.get('stationId'),
        name:      fd.get('name'),
        code:      fd.get('code'),
        capacity:  parseInt(fd.get('capacity') as string) || 1,
        notes:     fd.get('notes') || undefined,
      });
      setShowCreate(false); refetch();
    } catch (err) { setActionErr((err as Error).message); }
    finally { setBusy(false); }
  };

  const handleRelease = async (row: PlatformRow) => {
    try { await apiPost(`${base}/${row.id}/release`, {}); refetch(); }
    catch (err) { setActionErr((err as Error).message); }
  };

  const handleAssign = async (tripId: string) => {
    if (!assignTarget) return;
    setBusy(true); setActionErr(null);
    try {
      await apiPost(`${base}/${assignTarget.id}/assign`, { tripId });
      setAssignTarget(null);
      refetch();
    } catch (err) { setActionErr((err as Error).message); }
    finally { setBusy(false); }
  };

  const handleEdit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editTarget) return;
    const fd = new FormData(e.currentTarget);
    setBusy(true); setActionErr(null);
    try {
      await apiPatch(`${base}/${editTarget.id}`, {
        name:      fd.get('name'),
        code:      fd.get('code'),
        capacity:  parseInt(fd.get('capacity') as string) || 1,
        notes:     fd.get('notes') || null,
      });
      setEditTarget(null); refetch();
    } catch (err) { setActionErr((err as Error).message); }
    finally { setBusy(false); }
  };

  const handleStatusChange = async (row: PlatformRow, status: string) => {
    try { await apiPatch(`${base}/${row.id}`, { status }); refetch(); }
    catch (err) { setActionErr((err as Error).message); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true); setActionErr(null);
    try { await apiDelete(`${base}/${deleteTarget.id}`); setDeleteTarget(null); refetch(); }
    catch (err) { setActionErr((err as Error).message); }
    finally { setBusy(false); }
  };

  const rowActions: RowAction<PlatformRow>[] = [
    {
      label: t('common.edit'), icon: <Pencil size={13} />,
      onClick: (row) => { setEditTarget(row); setActionErr(null); },
    },
    {
      label: t('platforms.assignTrip'), icon: <Link2 size={13} />,
      onClick: (row) => { setAssignTarget(row); setActionErr(null); },
      hidden: (row) => row.status === 'MAINTENANCE' || row.status === 'CLOSED' || row.status === 'OCCUPIED',
    },
    {
      label: t('platforms.release'), icon: <LogOut size={13} />,
      onClick: (row) => handleRelease(row),
      hidden: (row) => row.status !== 'OCCUPIED',
    },
    {
      label: t('platforms.setMaintenance'), icon: <Wrench size={13} />,
      onClick: (row) => handleStatusChange(row, 'MAINTENANCE'),
      hidden: (row) => row.status === 'MAINTENANCE',
    },
    {
      label: t('platforms.setAvailable'), icon: <LogIn size={13} />,
      onClick: (row) => handleStatusChange(row, 'AVAILABLE'),
      hidden: (row) => row.status === 'AVAILABLE' || row.status === 'OCCUPIED',
    },
    {
      label: t('common.delete'), icon: <Trash2 size={13} />,
      variant: 'danger' as const,
      onClick: (row) => { setDeleteTarget(row); setActionErr(null); },
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('platforms.title')}</h1>
        <Button onClick={() => { setShowCreate(true); setActionErr(null); }}>
          <Plus className="w-4 h-4 mr-2" />{t('platforms.newPlatform')}
        </Button>
      </div>

      <DataTableMaster<PlatformRow>
        columns={buildColumns(t)}
        data={platforms ?? []}
        loading={loading}
        rowActions={rowActions}
        onRowClick={(row) => { setEditTarget(row); setActionErr(null); }}
        defaultSort={{ key: 'name', dir: 'asc' }}
        defaultPageSize={25}
        searchPlaceholder={t('platforms.searchPlaceholder')}
        emptyMessage={t('platforms.emptyMsg')}
        exportFormats={['csv', 'json', 'xls']}
        exportFilename="quais"
        stickyHeader
      />

      {/* Dialog édition */}
      <Dialog
        open={!!editTarget}
        onOpenChange={o => { if (!o) { setEditTarget(null); setActionErr(null); } }}
        title={editTarget ? `${t('common.edit')} — ${editTarget.name}` : t('common.edit')}
        size="md"
      >
        {editTarget && (
          <form onSubmit={handleEdit} className="space-y-4">
            <ErrorAlert error={actionErr} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium">{t('platforms.station')}</label>
                <select name="stationId" defaultValue={editTarget.stationId} className={inp} disabled={busy}>
                  {(stations ?? []).map(s => <option key={s.id} value={s.id}>{s.name} — {s.city}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium">{t('platforms.name')} <span className="text-red-500">*</span></label>
                <input name="name" required defaultValue={editTarget.name} className={inp} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium">{t('platforms.code')} <span className="text-red-500">*</span></label>
                <input name="code" required defaultValue={editTarget.code} className={inp} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium">{t('platforms.capacity')}</label>
                <input name="capacity" type="number" min="1" defaultValue={editTarget.capacity} className={inp} disabled={busy} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="block text-sm font-medium">{t('platforms.notes')}</label>
                <input name="notes" defaultValue={editTarget.notes ?? ''} className={inp} disabled={busy} />
              </div>
            </div>
            <FormFooter
              busy={busy}
              submitLabel={t('common.save')}
              pendingLabel={t('common.saving')}
              onCancel={() => { setEditTarget(null); setActionErr(null); }}
            />
          </form>
        )}
      </Dialog>

      {/* Dialog création */}
      <Dialog open={showCreate} onOpenChange={o => { if (!o) setShowCreate(false); }} title={t('platforms.newPlatform')} size="md">
        <form onSubmit={handleCreate} className="space-y-4">
          <ErrorAlert error={actionErr} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('platforms.station')} <span className="text-red-500">*</span></label>
              <select name="stationId" required className={inp} disabled={busy}>
                <option value="">{t('platforms.selectStation')}</option>
                {(stations ?? []).map(s => <option key={s.id} value={s.id}>{s.name} — {s.city}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('platforms.name')} <span className="text-red-500">*</span></label>
              <input name="name" required className={inp} disabled={busy} placeholder="Quai A" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('platforms.code')} <span className="text-red-500">*</span></label>
              <input name="code" required className={inp} disabled={busy} placeholder="A" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('platforms.capacity')}</label>
              <input name="capacity" type="number" min="1" defaultValue="1" className={inp} disabled={busy} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className="block text-sm font-medium">{t('platforms.notes')}</label>
              <input name="notes" className={inp} disabled={busy} />
            </div>
          </div>
          <FormFooter
            busy={busy}
            submitLabel={t('common.create')}
            pendingLabel={t('common.creating')}
            onCancel={() => setShowCreate(false)}
          />
        </form>
      </Dialog>

      {/* Dialog assignation trajet */}
      <Dialog
        open={!!assignTarget}
        onOpenChange={o => { if (!o) setAssignTarget(null); }}
        title={assignTarget ? `${t('platforms.assignTrip')} — ${assignTarget.name}` : t('platforms.assignTrip')}
        size="lg"
      >
        <div className="space-y-3">
          <ErrorAlert error={actionErr} />
          {tripsForTarget.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              {t('platforms.noAssignableTrip')}
            </p>
          ) : (
            <ul role="list" className="divide-y divide-slate-100 dark:divide-slate-800 max-h-96 overflow-y-auto">
              {tripsForTarget.map(tr => {
                const origin = tr.route?.origin?.city ?? tr.route?.origin?.name ?? '?';
                const dest   = tr.route?.destination?.city ?? tr.route?.destination?.name ?? '?';
                const dt = tr.departureScheduled
                  ? new Date(tr.departureScheduled).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                  : '';
                return (
                  <li key={tr.id} className="flex items-center justify-between gap-3 py-3 px-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {origin} → {dest}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {dt}{tr.bus?.plateNumber ? ` · ${tr.bus.plateNumber}` : ''}
                      </p>
                    </div>
                    <Badge size="sm" variant="default">{tr.status}</Badge>
                    <Button size="sm" disabled={busy} onClick={() => handleAssign(tr.id)}>
                      <Link2 className="w-3.5 h-3.5 mr-1" aria-hidden />
                      {t('platforms.assignAction')}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Dialog>

      {/* Dialog suppression */}
      <Dialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null); }} title={t('platforms.confirmDelete')} size="sm">
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
          {t('platforms.deleteMsg')} <strong>{deleteTarget?.name}</strong> ?
        </p>
        <ErrorAlert error={actionErr} />
        <FormFooter busy={busy} submitLabel={t('common.delete')} pendingLabel={t('common.deleting')} onCancel={() => setDeleteTarget(null)} onSubmit={handleDelete} variant="danger" />
      </Dialog>
    </div>
  );
}
