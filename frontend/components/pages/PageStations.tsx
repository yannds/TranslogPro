/**
 * PageStations — « Gares & Stations »
 *
 * CRUD complet des stations du tenant (origines/destinations de lignes, colis…).
 *
 * API :
 *   GET    /api/tenants/:tid/stations
 *   POST   /api/tenants/:tid/stations        body: { name, city, type, coordinates }
 *   PATCH  /api/tenants/:tid/stations/:id    body: partial
 *   DELETE /api/tenants/:tid/stations/:id    409 si référencée
 */

import { useMemo, useState, useCallback, type FormEvent } from 'react';
import {
  MapPin, Plus, Pencil, Trash2, Building2, Link as LinkIcon,
} from 'lucide-react';
import { useAuth }                          from '../../lib/auth/auth.context';
import { useI18n }                      from '../../lib/i18n/useI18n';
import { useFetch }                         from '../../lib/hooks/useFetch';
import { apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api';
import { Badge }                            from '../ui/Badge';
import { Button }                           from '../ui/Button';
import { ComboboxEditable, type ComboboxOption } from '../ui/ComboboxEditable';
import { Dialog }                           from '../ui/Dialog';
import { ErrorAlert }                       from '../ui/ErrorAlert';
import { FormFooter }                       from '../ui/FormFooter';
import { inputClass as inp }                from '../ui/inputClass';
import { LocationPicker }                   from '../ui/LocationPicker';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

// ─── Types ────────────────────────────────────────────────────────────────────

type StationType = 'PRINCIPALE' | 'RELAIS';

interface StationRow {
  id:          string;
  tenantId:    string;
  name:        string;
  city:        string;
  type:        StationType;
  coordinates: { lat: number; lng: number };
  _count?: {
    routesOrigin:      number;
    routesDestination: number;
    agencies:          number;
    waypoints:         number;
    parcelsTo:         number;
    shipmentsTo:       number;
    travelersDropoff:  number;
  };
}

interface StationFormValues {
  name: string;
  city: string;
  type: StationType;
  lat:  string;
  lng:  string;
}

const EMPTY_FORM: StationFormValues = {
  name: '', city: '', type: 'PRINCIPALE', lat: '', lng: '',
};

function refsCount(c: StationRow['_count']): number {
  if (!c) return 0;
  return c.routesOrigin + c.routesDestination + c.agencies + c.waypoints
       + c.parcelsTo + c.shipmentsTo + c.travelersDropoff;
}

// ─── Formulaire ───────────────────────────────────────────────────────────────

interface GeoResult { displayName: string; lat: number; lng: number }
interface GeoResponse { results: GeoResult[] }

function StationForm({
  tenantId, initial, onSubmit, onCancel, busy, error, submitLabel, pendingLabel,
}: {
  tenantId:     string;
  initial:      StationFormValues;
  onSubmit:     (v: StationFormValues) => void;
  onCancel:     () => void;
  busy:         boolean;
  error:        string | null;
  submitLabel:  string;
  pendingLabel: string;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<StationFormValues>(initial);
  const patch = (p: Partial<StationFormValues>) => setF(prev => ({ ...prev, ...p }));

  // Recherche Nominatim pour le champ Ville
  const searchCity = useCallback(async (q: string): Promise<ComboboxOption[]> => {
    const data = await apiGet<GeoResponse>(
      `/api/tenants/${tenantId}/geo/search?q=${encodeURIComponent(q)}`,
    );
    return (data.results ?? []).map(r => ({
      value: r.displayName.split(',')[0].trim(),
      label: r.displayName.split(',')[0].trim(),
      hint:  r.displayName.split(',').slice(1).join(',').trim(),
    }));
  }, [tenantId]);

  return (
    <form
      onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}
      className="space-y-4"
    >
      <ErrorAlert error={error} />

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('stations.stationName')} <span aria-hidden className="text-red-500">*</span>
        </label>
        <input type="text" required value={f.name}
          onChange={e => patch({ name: e.target.value })}
          className={inp} disabled={busy} placeholder={t('stations.placeholderName')} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ComboboxEditable
          label={t('stations.city')}
          value={f.city}
          onChange={v => patch({ city: v })}
          onSearch={searchCity}
          allowFreeText
          freeTextWarning={t('stations.cityFreeTextWarning')}
          placeholder={t('stations.placeholderCity')}
          disabled={busy}
          required
        />
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('common.type')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <select required value={f.type}
            onChange={e => patch({ type: e.target.value as StationType })}
            className={inp} disabled={busy}>
            <option value="PRINCIPALE">{t('stations.typePrincipale')}</option>
            <option value="RELAIS">{t('stations.typeRelais')}</option>
          </select>
        </div>
      </div>

      <LocationPicker
        tenantId={tenantId}
        value={{ lat: f.lat, lng: f.lng }}
        onChange={v => patch({ lat: v.lat, lng: v.lng })}
        disabled={busy}
      />

      <FormFooter
        onCancel={onCancel}
        busy={busy}
        submitLabel={submitLabel}
        pendingLabel={pendingLabel}
      />
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function PageStations() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/tenants/${tenantId}/stations`;

  const { data: stations, loading, error, refetch } = useFetch<StationRow[]>(
    tenantId ? base : null,
    [tenantId],
  );

  const [showCreate,   setShowCreate]   = useState(false);
  const [editTarget,   setEditTarget]   = useState<StationRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StationRow | null>(null);
  const [busy,         setBusy]         = useState(false);
  const [actionErr,    setActionErr]    = useState<string | null>(null);

  const kpi = useMemo(() => {
    const list = stations ?? [];
    return {
      total:      list.length,
      principal:  list.filter(s => s.type === 'PRINCIPALE').length,
      cities:     new Set(list.map(s => s.city)).size,
    };
  }, [stations]);

  const toPayload = (f: StationFormValues) => ({
    name: f.name.trim(),
    city: f.city.trim(),
    type: f.type,
    coordinates: { lat: Number(f.lat), lng: Number(f.lng) },
  });

  const handleCreate = async (f: StationFormValues) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPost(base, toPayload(f));
      setShowCreate(false); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleEdit = async (f: StationFormValues) => {
    if (!editTarget) return;
    setBusy(true); setActionErr(null);
    try {
      await apiPatch(`${base}/${editTarget.id}`, toPayload(f));
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

  const stationColumns: Column<StationRow>[] = useMemo(() => [
    {
      key: 'name', header: t('stations.stations'), sortable: true,
      cellRenderer: (_v, row) => (
        <div className="flex items-center gap-2 min-w-0">
          <MapPin className="w-4 h-4 text-teal-500 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium t-text truncate">{row.name}</p>
            <p className="text-[11px] t-text-2 truncate tabular-nums">
              {row.coordinates.lat.toFixed(4)}, {row.coordinates.lng.toFixed(4)}
            </p>
          </div>
        </div>
      ),
    },
    { key: 'city', header: t('stations.city'), sortable: true },
    {
      key: 'type', header: t('common.type'), sortable: true, width: '120px',
      cellRenderer: (v) => (
        <Badge variant={v === 'PRINCIPALE' ? 'success' : 'info'} size="sm">
          {v === 'PRINCIPALE' ? t('stations.typePrincipale') : t('stations.typeRelais')}
        </Badge>
      ),
    },
    {
      key: 'id', header: t('stations.references'), align: 'right' as const, width: '120px',
      cellRenderer: (_v, row) => {
        const refs = refsCount(row._count);
        return <Badge variant={refs > 0 ? 'warning' : 'default'} size="sm">{refs}</Badge>;
      },
    },
  ], [t]);

  const stationRowActions: RowAction<StationRow>[] = useMemo(() => [
    {
      label: t('common.edit'),
      icon: <Pencil className="w-4 h-4" />,
      onClick: row => { setActionErr(null); setEditTarget(row); },
    },
    {
      label: t('common.delete'),
      icon: <Trash2 className="w-4 h-4" />,
      onClick: row => { setActionErr(null); setDeleteTarget(row); },
      danger: true,
    },
  ], [t]);

  return (
    <main className="p-6 space-y-6" role="main" aria-label={t('stations.pageTitle')}>
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
            <MapPin className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('stations.pageTitle')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {t('stations.pageDesc')}
            </p>
          </div>
        </div>
        <Button onClick={() => { setActionErr(null); setShowCreate(true); }}>
          <Plus className="w-4 h-4 mr-2" aria-hidden />
          {t('stations.newStation')}
        </Button>
      </div>

      <ErrorAlert error={error || actionErr} icon />

      {/* KPIs */}
      <section aria-label={t('stations.pageTitle')} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Kpi label={t('stations.stations')}      value={kpi.total}     icon={<MapPin     className="w-5 h-5" />} />
        <Kpi label={t('stations.principales')}   value={kpi.principal} icon={<Building2  className="w-5 h-5" />} />
        <Kpi label={t('stations.citiesCovered')} value={kpi.cities}    icon={<LinkIcon   className="w-5 h-5" />} />
      </section>

      {/* Liste — DataTableMaster (tri, recherche, pagination, export) */}
      <DataTableMaster<StationRow>
        columns={stationColumns}
        data={stations ?? []}
        loading={loading}
        defaultSort={{ key: 'city', dir: 'asc' }}
        searchPlaceholder={t('stations.searchStation')}
        emptyMessage={t('stations.noStations')}
        rowActions={stationRowActions}
        onRowClick={row => { setActionErr(null); setEditTarget(row); }}
        exportFormats={['csv', 'json']}
        exportFilename="stations"
      />

      {/* Modal créer */}
      <Dialog
        open={showCreate}
        onOpenChange={o => { if (!o) setShowCreate(false); }}
        title={t('stations.newStation')}
        description={t('stations.dialogNewDesc')}
        size="lg"
      >
        <StationForm
          tenantId={tenantId}
          initial={EMPTY_FORM}
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
          busy={busy}
          error={actionErr}
          submitLabel={t('common.create')}
          pendingLabel={t('common.creating')}
        />
      </Dialog>

      {/* Modal éditer */}
      <Dialog
        open={!!editTarget}
        onOpenChange={o => { if (!o) setEditTarget(null); }}
        title={t('stations.editStation')}
        description={editTarget?.name}
        size="lg"
      >
        {editTarget && (
          <StationForm
            tenantId={tenantId}
            initial={{
              name: editTarget.name,
              city: editTarget.city,
              type: editTarget.type,
              lat:  String(editTarget.coordinates.lat ?? ''),
              lng:  String(editTarget.coordinates.lng ?? ''),
            }}
            onSubmit={handleEdit}
            onCancel={() => setEditTarget(null)}
            busy={busy}
            error={actionErr}
            submitLabel={t('common.save')}
            pendingLabel={t('common.saving')}
          />
        )}
      </Dialog>

      {/* Modal supprimer */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={o => { if (!o) setDeleteTarget(null); }}
        title={t('stations.deleteStation')}
        description={
          deleteTarget
            ? `${t('common.delete')} « ${deleteTarget.name} » ? ${t('stations.deleteDesc')}`
            : undefined
        }
        footer={
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={busy}>
              {t('common.cancel')}
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
        <ErrorAlert error={actionErr} />
        {deleteTarget && refsCount(deleteTarget._count) > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            {refsCount(deleteTarget._count)} {t('stations.refsWarning')} {t('stations.deleteWarning')}
          </p>
        )}
        <div />
      </Dialog>
    </main>
  );
}

function Kpi({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <article
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center gap-3"
      aria-label={`${label}: ${value}`}
    >
      <div className="p-2.5 rounded-lg bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400 shrink-0" aria-hidden>
        {icon}
      </div>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        <p className="text-xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">
          {value.toLocaleString('fr-FR')}
        </p>
      </div>
    </article>
  );
}
