/**
 * PageShipments — « Expéditions groupées »
 *
 * Permet de grouper plusieurs colis sur un même trajet (Shipment).
 * Workflow : choisir un trajet → créer un shipment (destination + capacité)
 * → consulter les colis groupés.
 *
 * API :
 *   GET  /api/tenants/:tid/trips
 *   GET  /api/tenants/:tid/shipments/trips/:tripId
 *   POST /api/tenants/:tid/shipments                 body: CreateShipmentDto
 *   POST /api/tenants/:tid/shipments/:id/parcels/:parcelId
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Boxes, Plus, Package, ArrowRight } from 'lucide-react';
import { useAuth }                       from '../../lib/auth/auth.context';
import { useI18n }                        from '../../lib/i18n/useI18n';
import { useFetch }                      from '../../lib/hooks/useFetch';
import { apiPost }                       from '../../lib/api';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge }                         from '../ui/Badge';
import { Skeleton }                      from '../ui/Skeleton';
import { Button }                        from '../ui/Button';
import { Dialog }                        from '../ui/Dialog';
import { ErrorAlert }                    from '../ui/ErrorAlert';
import { FormFooter }                    from '../ui/FormFooter';
import { inputClass as inp }             from '../ui/inputClass';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TripRow {
  id:    string;
  status: string;
  departureScheduled?: string;
  route?: { name?: string; origin?: { name: string }; destination?: { name: string } };
}

interface ParcelLite {
  id:           string;
  trackingCode: string;
  status:       string;
  weight:       number;
}

interface Shipment {
  id:              string;
  tripId:          string;
  destinationId:   string;
  totalWeight:     number;
  remainingWeight: number;
  status:          string;
  parcels?:        ParcelLite[];
}

interface StationRow { id: string; name: string; city: string; }

interface FormValues {
  tripId:         string;
  destinationId:  string;
  maxWeightKg:    string;
}

const EMPTY_FORM: FormValues = { tripId: '', destinationId: '', maxWeightKg: '500' };


// ─── Page ─────────────────────────────────────────────────────────────────────

export function PageShipments() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/tenants/${tenantId}`;

  const { data: trips,    loading: tripsLoading, error: tripsError } =
    useFetch<TripRow[]>(tenantId ? `${base}/trips` : null, [tenantId]);
  const { data: stations } =
    useFetch<StationRow[]>(tenantId ? `${base}/stations` : null, [tenantId]);

  const [tripId, setTripId] = useState<string | null>(null);

  const { data: shipments, loading: shipLoading, error: shipError, refetch: refetchShip } =
    useFetch<Shipment[]>(
      tenantId && tripId ? `${base}/shipments/trips/${tripId}` : null,
      [tenantId, tripId],
    );

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  useEffect(() => {
    if (!tripId && trips && trips.length > 0) setTripId(trips[0].id);
  }, [trips, tripId]);

  const patch = (p: Partial<FormValues>) => setForm(prev => ({ ...prev, ...p }));

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, tripId: tripId ?? '' });
    setActionErr(null);
    setShowCreate(true);
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setActionErr(null);
    try {
      await apiPost(`${base}/shipments`, {
        tripId:        form.tripId,
        destinationId: form.destinationId,
        maxWeightKg:   Number(form.maxWeightKg),
      });
      setShowCreate(false);
      if (form.tripId !== tripId) setTripId(form.tripId);
      else refetchShip();
    } catch (err) { setActionErr((err as Error).message); }
    finally { setBusy(false); }
  };

  const tripLabel = (t: TripRow) => {
    const r = t.route;
    const orig = r?.origin?.name ?? '?';
    const dest = r?.destination?.name ?? '?';
    const dt   = t.departureScheduled
      ? new Date(t.departureScheduled).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '';
    return `${orig} → ${dest}${dt ? ` · ${dt}` : ''}`;
  };

  const selectedTrip = useMemo(
    () => trips?.find(t => t.id === tripId) ?? null,
    [trips, tripId],
  );

  return (
    <main className="p-6 space-y-6" role="main" aria-label={t('shipments.groupShipments')}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
            <Boxes className="w-5 h-5 text-purple-600 dark:text-purple-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('shipments.groupShipments')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {t('shipments.subtitle')}
            </p>
          </div>
        </div>
        <Button onClick={openCreate} disabled={!tenantId}>
          <Plus className="w-4 h-4 mr-2" aria-hidden />
          {t('shipments.newGroup')}
        </Button>
      </div>

      <ErrorAlert error={tripsError || shipError} icon />

      <Card>
        <CardHeader heading={t('shipments.tripSelection')} />
        <CardContent>
          {tripsLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : !trips || trips.length === 0 ? (
            <p className="text-sm text-slate-500">{t('shipments.noTrip')}</p>
          ) : (
            <select value={tripId ?? ''}
              onChange={e => setTripId(e.target.value || null)}
              className={inp}>
              {trips.map(t => (
                <option key={t.id} value={t.id}>{tripLabel(t)} ({t.status})</option>
              ))}
            </select>
          )}
        </CardContent>
      </Card>

      {selectedTrip && (
        <Card>
          <CardHeader
            heading={`${t('shipments.groups')} — ${tripLabel(selectedTrip)}`}
            description={`${shipments?.length ?? 0} shipment${(shipments?.length ?? 0) > 1 ? 's' : ''}`}
          />
          <CardContent className="p-0">
            {shipLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
              </div>
            ) : !shipments || shipments.length === 0 ? (
              <div className="py-16 text-center text-slate-500 dark:text-slate-400">
                <Boxes className="w-10 h-10 mx-auto mb-3 text-slate-300" aria-hidden />
                <p className="font-medium">{t('shipments.noGroupOnTrip')}</p>
                <p className="text-sm mt-1">{t('shipments.createGroupToStart')}</p>
              </div>
            ) : (
              <ul role="list" className="divide-y divide-slate-100 dark:divide-slate-800">
                {shipments.map(s => {
                  const used = s.totalWeight - s.remainingWeight;
                  const pct  = s.totalWeight > 0 ? Math.round((used / s.totalWeight) * 100) : 0;
                  const station = stations?.find(st => st.id === s.destinationId);
                  return (
                    <li key={s.id} className="px-6 py-4">
                      <div className="flex items-center gap-3 flex-wrap">
                        <Boxes className="w-4 h-4 text-purple-500" aria-hidden />
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {station ? `${station.name} — ${station.city}` : s.destinationId.slice(0, 8)}
                        </span>
                        <Badge size="sm" variant={s.status === 'OPEN' ? 'warning' : 'default'}>
                          {s.status}
                        </Badge>
                        <span className="text-xs text-slate-500 tabular-nums ml-auto">
                          {used.toLocaleString('fr-FR')} / {s.totalWeight.toLocaleString('fr-FR')} kg ({pct}%)
                        </span>
                      </div>
                      <div className="h-1.5 mt-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full ${pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-purple-500'}`}
                          style={{ width: `${Math.min(100, pct)}%` }}
                          aria-hidden
                        />
                      </div>
                      {s.parcels && s.parcels.length > 0 && (
                        <ul className="mt-3 space-y-1">
                          {s.parcels.map(p => (
                            <li key={p.id} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                              <Package className="w-3 h-3 text-slate-400" aria-hidden />
                              <span className="font-mono tabular-nums">{p.trackingCode}</span>
                              <ArrowRight className="w-3 h-3 text-slate-400" aria-hidden />
                              <Badge size="sm" variant="outline">{p.status}</Badge>
                              <span className="ml-auto tabular-nums">{p.weight} kg</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={showCreate}
        onOpenChange={o => { if (!o) setShowCreate(false); }}
        title={t('shipments.newGroupDialog')}
        description={t('shipments.dialogDesc')}
        size="lg"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <ErrorAlert error={actionErr} />
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('shipments.trip')} <span aria-hidden className="text-red-500">*</span>
            </label>
            <select required value={form.tripId}
              onChange={e => patch({ tripId: e.target.value })}
              className={inp} disabled={busy}>
              <option value="">{t('common.select')}</option>
              {(trips ?? []).map(tr => (
                <option key={tr.id} value={tr.id}>{tripLabel(tr)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('shipments.destStation')} <span aria-hidden className="text-red-500">*</span>
            </label>
            <select required value={form.destinationId}
              onChange={e => patch({ destinationId: e.target.value })}
              className={inp} disabled={busy}>
              <option value="">{t('common.select')}</option>
              {(stations ?? []).map(s => (
                <option key={s.id} value={s.id}>{s.name} — {s.city}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('shipments.maxWeight')} <span aria-hidden className="text-red-500">*</span>
            </label>
            <input type="number" min={1} required value={form.maxWeightKg}
              onChange={e => patch({ maxWeightKg: e.target.value })}
              className={inp} disabled={busy} />
          </div>
          <FormFooter onCancel={() => setShowCreate(false)} busy={busy}
            submitLabel={t('shipments.createGroup')} pendingLabel={t('shipments.creating')} />
        </form>
      </Dialog>
    </main>
  );
}
