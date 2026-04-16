/**
 * PageRoutes — « Lignes & Routes »
 *
 * CRUD complet des lignes exploitées.
 *
 * API :
 *   GET    /api/tenants/:tid/routes
 *   GET    /api/tenants/:tid/routes/stations/available
 *   POST   /api/tenants/:tid/routes            body: { name, originId, destinationId, distanceKm, basePrice }
 *   PATCH  /api/tenants/:tid/routes/:id        body: partial
 *   DELETE /api/tenants/:tid/routes/:id        409 si trajets rattachés
 */

import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate }                      from 'react-router-dom';
import {
  Route as RouteIcon, Plus, Pencil, Trash2, X, Check, MapPin, TrendingUp,
} from 'lucide-react';
import { useAuth }                          from '../../lib/auth/auth.context';
import { useI18n }                      from '../../lib/i18n/useI18n';
import { useFetch }                         from '../../lib/hooks/useFetch';
import { useTenantConfig }                  from '../../providers/TenantConfigProvider';
import { apiPost, apiPatch, apiDelete }     from '../../lib/api';
import { Card, CardHeader, CardContent }    from '../ui/Card';
import { Badge }                            from '../ui/Badge';
import { Skeleton }                         from '../ui/Skeleton';
import { Button }                           from '../ui/Button';
import { Dialog }                           from '../ui/Dialog';
import { ErrorAlert }                       from '../ui/ErrorAlert';
import { RouteDetailDialog }                from './RouteDetailDialog';

// ─── i18n ─────────────────────────────────────────────────────────────────────

const T = {
  pageTitle:          tm('Lignes & Routes', 'Routes & Lines'),
  pageDesc:           tm('Catalogue des itinéraires exploités — création, édition, suppression.', 'Catalogue of operated routes — create, edit, delete.'),
  newRoute:           tm('Nouvelle ligne', 'New Route'),
  routeName:          tm('Nom de la ligne', 'Route Name'),
  origin:             tm('Origine', 'Origin'),
  destination:        tm('Destination', 'Destination'),
  distanceKm:         tm('Distance (km)', 'Distance (km)'),
  baseFare:           tm('Tarif de base', 'Base Fare'),
  sameODError:        tm("L'origine et la destination doivent être différentes.", 'Origin and destination must be different.'),
  editRoute:          tm('Modifier la ligne', 'Edit Route'),
  deleteRoute:        tm('Supprimer la ligne', 'Delete Route'),
  deleteConfirm:      tm('Supprimer', 'Delete'),
  noStationsWarning:  tm(
    "Aucune station n'est enregistrée pour ce tenant — impossible de créer une ligne. Ajoutez au moins deux stations (origine / destination) avant de configurer les lignes.",
    'No stations registered for this tenant — cannot create a route. Add at least two stations (origin / destination) before configuring routes.',
  ),
  createStation:      tm('Créer une station', 'Create Station'),
  noStationsBtn:      tm("Créez d'abord au moins deux stations", 'First create at least two stations'),
  dialogNewDesc:      tm("Définissez l'itinéraire, la distance et le tarif de base.", 'Define the route, distance and base fare.'),
  activeRoutes:       tm('Lignes actives', 'Active Routes'),
  cumulativeTrips:    tm('Trajets cumulés', 'Cumulative Trips'),
  cumulativeDistance: tm('Distance cumulée', 'Cumulative Distance'),
  routeHeader:        tm('Ligne', 'Route'),
  distanceHeader:     tm('Distance', 'Distance'),
  baseFareHeader:     tm('Tarif base', 'Base Fare'),
  tripsHeader:        tm('Trajets', 'Trips'),
  actionsHeader:      tm('Actions', 'Actions'),
  sortedByTrips:      tm('Triées par nombre de trajets décroissant', 'Sorted by trip count descending'),
  noRoutes:           tm('Aucune ligne enregistrée', 'No routes registered'),
  noRoutesCta:        tm('Cliquez sur « Nouvelle ligne » pour commencer.', 'Click "New Route" to get started.'),
  deleteDesc:         tm('Cette action est irréversible.', 'This action is irreversible.'),
  deleteWarning:      tm(
    'La suppression sera refusée par le serveur tant qu\'ils n\'auront pas été réaffectés.',
    'Deletion will be refused by the server until they are reassigned.',
  ),
  tripsBound:         tm('trajet(s) sont rattachés à cette ligne.', 'trip(s) are linked to this route.'),
  placeholder:        tm('ex. Brazzaville → Pointe-Noire', 'e.g. Brazzaville → Pointe-Noire'),
  placeholderDist:    tm('ex. 510', 'e.g. 510'),
  placeholderPrice:   tm('ex. 12000', 'e.g. 12000'),
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface StationLite {
  id:   string;
  name: string;
  city: string;
  type?: string;
}

interface RouteRow {
  id:            string;
  tenantId:      string;
  name:          string;
  originId:      string;
  destinationId: string;
  distanceKm:    number;
  basePrice:     number;
  origin?:      { id: string; name: string; city: string } | null;
  destination?: { id: string; name: string; city: string } | null;
  _count?:      { trips: number };
}

interface RouteFormValues {
  name:          string;
  originId:      string;
  destinationId: string;
  distanceKm:    string; // controlled as string for input
  basePrice:     string;
}

const EMPTY_FORM: RouteFormValues = {
  name: '', originId: '', destinationId: '', distanceKm: '', basePrice: '',
};

const inp = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50';

function formatXof(n: number | null | undefined, currency = 'XAF'): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('fr-FR').format(n) + ` ${currency}`;
}

function formatStation(s: { name: string; city: string } | null | undefined) {
  if (!s) return '—';
  return s.city ? `${s.name} (${s.city})` : s.name;
}

// ─── Formulaire ───────────────────────────────────────────────────────────────

function RouteForm({
  initial, stations, onSubmit, onCancel, busy, error, submitLabel,
}: {
  initial:     RouteFormValues;
  stations:    StationLite[];
  onSubmit:    (v: RouteFormValues) => void;
  onCancel:    () => void;
  busy:        boolean;
  error:       string | null;
  submitLabel: string;
}) {
  const { operational } = useTenantConfig();
  const { t } = useI18n();
  const [f, setF] = useState<RouteFormValues>(initial);
  const patch = (p: Partial<RouteFormValues>) => setF(prev => ({ ...prev, ...p }));

  const sameOD = f.originId && f.destinationId && f.originId === f.destinationId;

  return (
    <form
      onSubmit={(e: FormEvent) => { e.preventDefault(); if (!sameOD) onSubmit(f); }}
      className="space-y-4"
    >
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('LRoutes.routeName')} <span aria-hidden className="text-red-500">*</span>
        </label>
        <input type="text" required value={f.name}
          onChange={e => patch({ name: e.target.value })}
          className={inp} disabled={busy} placeholder={t('LRoutes.placeholder')} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LRoutes.origin')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <select required value={f.originId}
            onChange={e => patch({ originId: e.target.value })}
            className={inp} disabled={busy}>
            <option value="">{t('common.select')}</option>
            {stations.map(s => (
              <option key={s.id} value={s.id}>{formatStation(s)}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LRoutes.destination')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <select required value={f.destinationId}
            onChange={e => patch({ destinationId: e.target.value })}
            className={inp} disabled={busy}>
            <option value="">{t('common.select')}</option>
            {stations.map(s => (
              <option key={s.id} value={s.id}>{formatStation(s)}</option>
            ))}
          </select>
        </div>
      </div>

      {sameOD && (
        <p className="text-xs text-red-600">
          {t('LRoutes.sameODError')}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LRoutes.distanceKm')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="number" min={0} step="0.1" required value={f.distanceKm}
            onChange={e => patch({ distanceKm: e.target.value })}
            className={inp} disabled={busy} placeholder={t('LRoutes.placeholderDist')} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LRoutes.baseFare')} ({operational.currency}) <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="number" min={0} step="50" required value={f.basePrice}
            onChange={e => patch({ basePrice: e.target.value })}
            className={inp} disabled={busy} placeholder={t('LRoutes.placeholderPrice')} />
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          <X className="w-4 h-4 mr-1.5" aria-hidden />{t('common.cancel')}
        </Button>
        <Button type="submit" disabled={busy || !!sameOD}>
          <Check className="w-4 h-4 mr-1.5" aria-hidden />
          {busy ? t('common.saving') : submitLabel}
        </Button>
      </div>
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function PageRoutes() {
  const { user }  = useAuth();
  const navigate  = useNavigate();
  const { t } = useI18n();
  const tenantId  = user?.tenantId ?? '';
  const { operational } = useTenantConfig();
  const base      = `/api/tenants/${tenantId}/routes`;

  const { data: routes, loading, error, refetch } = useFetch<RouteRow[]>(
    tenantId ? base : null,
    [tenantId],
  );
  const { data: stations } = useFetch<StationLite[]>(
    tenantId ? `${base}/stations/available` : null,
    [tenantId],
  );

  const [showCreate,   setShowCreate]   = useState(false);
  const [editTarget,   setEditTarget]   = useState<RouteRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RouteRow | null>(null);
  const [detailRouteId, setDetailRouteId] = useState<string | null>(null);
  const [busy,         setBusy]         = useState(false);
  const [actionErr,    setActionErr]    = useState<string | null>(null);

  const kpi = useMemo(() => {
    const list = routes ?? [];
    return {
      routes:        list.length,
      totalDistance: list.reduce((s, r) => s + (r.distanceKm ?? 0), 0),
      totalTrips:    list.reduce((s, r) => s + (r._count?.trips ?? 0), 0),
    };
  }, [routes]);

  const toPayload = (f: RouteFormValues) => ({
    name:          f.name.trim(),
    originId:      f.originId,
    destinationId: f.destinationId,
    distanceKm:    Number(f.distanceKm),
    basePrice:     Number(f.basePrice),
  });

  const handleCreate = async (f: RouteFormValues) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPost(base, toPayload(f));
      setShowCreate(false); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleEdit = async (f: RouteFormValues) => {
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

  const sortedRoutes = useMemo(() =>
    [...(routes ?? [])].sort((a, b) => (b._count?.trips ?? 0) - (a._count?.trips ?? 0)),
    [routes],
  );

  const noStations = (stations?.length ?? 0) === 0;

  return (
    <main className="p-6 space-y-6" role="main" aria-label={t('LRoutes.pageTitle')}>
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
            <RouteIcon className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('LRoutes.pageTitle')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {t('LRoutes.pageDesc')}
            </p>
          </div>
        </div>
        <Button
          onClick={() => { setActionErr(null); setShowCreate(true); }}
          disabled={noStations}
          title={noStations ? t('LRoutes.noStationsBtn') : undefined}
        >
          <Plus className="w-4 h-4 mr-2" aria-hidden />
          {t('LRoutes.newRoute')}
        </Button>
      </div>

      <ErrorAlert error={error || actionErr} icon />

      {noStations && !loading && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 px-4 py-3 text-sm text-amber-800 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <span>
            {t('LRoutes.noStationsWarning')}
          </span>
          <Button variant="outline" onClick={() => navigate('/admin/stations')}>
            <MapPin className="w-4 h-4 mr-1.5" aria-hidden />
            {t('LRoutes.createStation')}
          </Button>
        </div>
      )}

      {/* KPIs */}
      <section aria-label={t('LRoutes.pageTitle')} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Kpi label={t('LRoutes.activeRoutes')}       value={kpi.routes}        icon={<RouteIcon className="w-5 h-5" />} />
        <Kpi label={t('LRoutes.cumulativeTrips')}    value={kpi.totalTrips}    icon={<TrendingUp className="w-5 h-5" />} />
        <Kpi label={t('LRoutes.cumulativeDistance')} value={kpi.totalDistance} icon={<MapPin className="w-5 h-5" />} suffix="km" />
      </section>

      {/* Liste */}
      <Card>
        <CardHeader
          heading={`${sortedRoutes.length} ${sortedRoutes.length > 1 ? t('LRoutes.pageTitle') : t('LRoutes.routeHeader')}`}
          description={t('LRoutes.sortedByTrips')}
        />
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : sortedRoutes.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-slate-500 dark:text-slate-400" role="status">
              <RouteIcon className="w-10 h-10 mb-3 text-slate-300 dark:text-slate-600" aria-hidden />
              <p className="font-medium">{t('LRoutes.noRoutes')}</p>
              <p className="text-sm mt-1">{t('LRoutes.noRoutesCta')}</p>
            </div>
          ) : (
            <div role="table" aria-label={t('LRoutes.pageTitle')}>
              <div
                role="row"
                className="grid grid-cols-[1fr_120px_120px_100px_130px] gap-3 px-6 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50"
              >
                <div role="columnheader">{t('LRoutes.routeHeader')}</div>
                <div role="columnheader" className="text-right">{t('LRoutes.distanceHeader')}</div>
                <div role="columnheader" className="text-right">{t('LRoutes.baseFareHeader')}</div>
                <div role="columnheader" className="text-right">{t('LRoutes.tripsHeader')}</div>
                <div role="columnheader" className="text-right">{t('LRoutes.actionsHeader')}</div>
              </div>
              <ul role="rowgroup" className="divide-y divide-slate-100 dark:divide-slate-800">
                {sortedRoutes.map(r => (
                  <li
                    key={r.id}
                    role="row"
                    onClick={() => setDetailRouteId(r.id)}
                    className="grid grid-cols-[1fr_120px_120px_100px_130px] gap-3 px-6 py-3 items-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <div role="cell" className="flex items-center gap-2 min-w-0">
                      <MapPin className="w-4 h-4 text-teal-500 shrink-0" aria-hidden />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{r.name}</p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {formatStation(r.origin)} → {formatStation(r.destination)}
                        </p>
                      </div>
                    </div>
                    <div role="cell" className="text-right text-sm tabular-nums text-slate-600 dark:text-slate-400">
                      {r.distanceKm.toLocaleString('fr-FR')} km
                    </div>
                    <div role="cell" className="text-right text-sm tabular-nums text-slate-600 dark:text-slate-400">
                      {formatXof(r.basePrice, operational.currency)}
                    </div>
                    <div role="cell" className="text-right">
                      <Badge variant="info" size="sm">{r._count?.trips ?? 0}</Badge>
                    </div>
                    <div role="cell" className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); setActionErr(null); setEditTarget(r); }}
                        className="p-1.5 rounded-md text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                        aria-label={`${t('common.edit')} ${r.name}`}
                        title={t('common.edit')}
                      >
                        <Pencil className="w-4 h-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); setActionErr(null); setDeleteTarget(r); }}
                        className="p-1.5 rounded-md text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                        aria-label={`${t('common.delete')} ${r.name}`}
                        title={t('common.delete')}
                      >
                        <Trash2 className="w-4 h-4" aria-hidden />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal créer */}
      <Dialog
        open={showCreate}
        onOpenChange={o => { if (!o) setShowCreate(false); }}
        title={t('LRoutes.newRoute')}
        description={t('LRoutes.dialogNewDesc')}
        size="lg"
      >
        <RouteForm
          initial={EMPTY_FORM}
          stations={stations ?? []}
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
          busy={busy}
          error={actionErr}
          submitLabel={t('common.create')}
        />
      </Dialog>

      {/* Modal éditer */}
      <Dialog
        open={!!editTarget}
        onOpenChange={o => { if (!o) setEditTarget(null); }}
        title={t('LRoutes.editRoute')}
        description={editTarget?.name}
        size="lg"
      >
        {editTarget && (
          <RouteForm
            initial={{
              name:          editTarget.name,
              originId:      editTarget.originId,
              destinationId: editTarget.destinationId,
              distanceKm:    String(editTarget.distanceKm ?? ''),
              basePrice:     String(editTarget.basePrice  ?? ''),
            }}
            stations={stations ?? []}
            onSubmit={handleEdit}
            onCancel={() => setEditTarget(null)}
            busy={busy}
            error={actionErr}
            submitLabel={t('common.save')}
          />
        )}
      </Dialog>

      {/* Modal détail — escales & tarifs */}
      <RouteDetailDialog
        routeId={detailRouteId}
        tenantId={tenantId}
        stations={stations ?? []}
        onClose={() => setDetailRouteId(null)}
        onEditRoute={(id) => {
          setDetailRouteId(null);
          const target = routes?.find(r => r.id === id);
          if (target) { setActionErr(null); setEditTarget(target); }
        }}
        onSaved={refetch}
      />

      {/* Modal supprimer */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={o => { if (!o) setDeleteTarget(null); }}
        title={t('LRoutes.deleteRoute')}
        description={
          deleteTarget
            ? `${t('common.delete')} « ${deleteTarget.name} » ? ${t('LRoutes.deleteDesc')}`
            : undefined
        }
        footer={
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={busy}>
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
        {(deleteTarget?._count?.trips ?? 0) > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            {deleteTarget?._count?.trips} {t('LRoutes.tripsBound')} {t('LRoutes.deleteWarning')}
          </p>
        )}
        <div />
      </Dialog>
    </main>
  );
}

function Kpi({ label, value, icon, suffix }: { label: string; value: number; icon: React.ReactNode; suffix?: string }) {
  return (
    <article
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center gap-3"
      aria-label={`${label}: ${value}${suffix ? ' ' + suffix : ''}`}
    >
      <div className="p-2.5 rounded-lg bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400 shrink-0" aria-hidden>
        {icon}
      </div>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        <p className="text-xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">
          {value.toLocaleString('fr-FR')}{suffix && ` ${suffix}`}
        </p>
      </div>
    </article>
  );
}
