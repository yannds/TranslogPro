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

import { useMemo, useState, type FormEvent } from 'react';
import {
  MapPin, Plus, Pencil, Trash2, Building2, Link as LinkIcon,
} from 'lucide-react';
import { useAuth }                          from '../../lib/auth/auth.context';
import { useFetch }                         from '../../lib/hooks/useFetch';
import { apiPost, apiPatch, apiDelete }     from '../../lib/api';
import { Card, CardHeader, CardContent }    from '../ui/Card';
import { Badge }                            from '../ui/Badge';
import { Skeleton }                         from '../ui/Skeleton';
import { Button }                           from '../ui/Button';
import { Dialog }                           from '../ui/Dialog';
import { ErrorAlert }                       from '../ui/ErrorAlert';
import { FormFooter }                       from '../ui/FormFooter';
import { inputClass as inp }                from '../ui/inputClass';
import { LocationPicker }                   from '../ui/LocationPicker';

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
  const [f, setF] = useState<StationFormValues>(initial);
  const patch = (p: Partial<StationFormValues>) => setF(prev => ({ ...prev, ...p }));

  return (
    <form
      onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}
      className="space-y-4"
    >
      <ErrorAlert error={error} />

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Nom de la station <span aria-hidden className="text-red-500">*</span>
        </label>
        <input type="text" required value={f.name}
          onChange={e => patch({ name: e.target.value })}
          className={inp} disabled={busy} placeholder="ex. Gare centrale" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Ville <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="text" required value={f.city}
            onChange={e => patch({ city: e.target.value })}
            className={inp} disabled={busy} placeholder="ex. Brazzaville" />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Type <span aria-hidden className="text-red-500">*</span>
          </label>
          <select required value={f.type}
            onChange={e => patch({ type: e.target.value as StationType })}
            className={inp} disabled={busy}>
            <option value="PRINCIPALE">Principale</option>
            <option value="RELAIS">Relais</option>
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

  const sortedStations = useMemo(
    () => [...(stations ?? [])].sort((a, b) =>
      a.city.localeCompare(b.city) || a.name.localeCompare(b.name),
    ),
    [stations],
  );

  return (
    <main className="p-6 space-y-6" role="main" aria-label="Gares et stations">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
            <MapPin className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Gares &amp; Stations</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Points d'origine et de destination pour lignes, colis et voyageurs.
            </p>
          </div>
        </div>
        <Button onClick={() => { setActionErr(null); setShowCreate(true); }}>
          <Plus className="w-4 h-4 mr-2" aria-hidden />
          Nouvelle station
        </Button>
      </div>

      <ErrorAlert error={error || actionErr} icon />

      {/* KPIs */}
      <section aria-label="Indicateurs stations" className="grid grid-cols-3 gap-4">
        <Kpi label="Stations"         value={kpi.total}     icon={<MapPin     className="w-5 h-5" />} />
        <Kpi label="Principales"      value={kpi.principal} icon={<Building2  className="w-5 h-5" />} />
        <Kpi label="Villes couvertes" value={kpi.cities}    icon={<LinkIcon   className="w-5 h-5" />} />
      </section>

      {/* Liste */}
      <Card>
        <CardHeader
          heading={`${sortedStations.length} station${sortedStations.length > 1 ? 's' : ''}`}
          description="Triées par ville puis par nom"
        />
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : sortedStations.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-slate-500 dark:text-slate-400" role="status">
              <MapPin className="w-10 h-10 mb-3 text-slate-300 dark:text-slate-600" aria-hidden />
              <p className="font-medium">Aucune station enregistrée</p>
              <p className="text-sm mt-1">Cliquez sur « Nouvelle station » pour commencer.</p>
            </div>
          ) : (
            <div role="table" aria-label="Liste des stations">
              <div
                role="row"
                className="grid grid-cols-[1fr_140px_110px_140px_120px] gap-3 px-6 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50"
              >
                <div role="columnheader">Station</div>
                <div role="columnheader">Ville</div>
                <div role="columnheader">Type</div>
                <div role="columnheader" className="text-right">Références</div>
                <div role="columnheader" className="text-right">Actions</div>
              </div>
              <ul role="rowgroup" className="divide-y divide-slate-100 dark:divide-slate-800">
                {sortedStations.map(s => {
                  const refs = refsCount(s._count);
                  return (
                    <li
                      key={s.id}
                      role="row"
                      className="grid grid-cols-[1fr_140px_110px_140px_120px] gap-3 px-6 py-3 items-center"
                    >
                      <div role="cell" className="flex items-center gap-2 min-w-0">
                        <MapPin className="w-4 h-4 text-teal-500 shrink-0" aria-hidden />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{s.name}</p>
                          <p className="text-[11px] text-slate-500 truncate tabular-nums">
                            {s.coordinates.lat.toFixed(4)}, {s.coordinates.lng.toFixed(4)}
                          </p>
                        </div>
                      </div>
                      <div role="cell" className="text-sm text-slate-600 dark:text-slate-400 truncate">
                        {s.city}
                      </div>
                      <div role="cell">
                        <Badge variant={s.type === 'PRINCIPALE' ? 'success' : 'info'} size="sm">
                          {s.type === 'PRINCIPALE' ? 'Principale' : 'Relais'}
                        </Badge>
                      </div>
                      <div role="cell" className="text-right">
                        <Badge variant={refs > 0 ? 'warning' : 'default'} size="sm">{refs}</Badge>
                      </div>
                      <div role="cell" className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => { setActionErr(null); setEditTarget(s); }}
                          className="p-1.5 rounded-md text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                          aria-label={`Modifier ${s.name}`}
                          title="Modifier"
                        >
                          <Pencil className="w-4 h-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => { setActionErr(null); setDeleteTarget(s); }}
                          className="p-1.5 rounded-md text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                          aria-label={`Supprimer ${s.name}`}
                          title="Supprimer"
                        >
                          <Trash2 className="w-4 h-4" aria-hidden />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal créer */}
      <Dialog
        open={showCreate}
        onOpenChange={o => { if (!o) setShowCreate(false); }}
        title="Nouvelle station"
        description="Ajoutez une gare ou un relais au tenant."
        size="lg"
      >
        <StationForm
          tenantId={tenantId}
          initial={EMPTY_FORM}
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
          busy={busy}
          error={actionErr}
          submitLabel="Créer"
          pendingLabel="Création…"
        />
      </Dialog>

      {/* Modal éditer */}
      <Dialog
        open={!!editTarget}
        onOpenChange={o => { if (!o) setEditTarget(null); }}
        title="Modifier la station"
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
            submitLabel="Enregistrer"
            pendingLabel="Enregistrement…"
          />
        )}
      </Dialog>

      {/* Modal supprimer */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={o => { if (!o) setDeleteTarget(null); }}
        title="Supprimer la station"
        description={
          deleteTarget
            ? `Supprimer « ${deleteTarget.name} » ? Cette action est irréversible.`
            : undefined
        }
        footer={
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={busy}>
              Annuler
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
        <ErrorAlert error={actionErr} />
        {deleteTarget && refsCount(deleteTarget._count) > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Attention : {refsCount(deleteTarget._count)} objet(s) référencent cette station.
            La suppression sera refusée par le serveur tant qu'ils n'auront pas été réaffectés.
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
