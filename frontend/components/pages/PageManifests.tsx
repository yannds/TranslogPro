/**
 * PageManifests — Manifestes de trajet (admin)
 *
 * Workflow :
 *   1. Sélection du trajet
 *   2. Génération du manifeste → POST /api/tenants/:tid/manifests/trips/:tripId
 *   3. Signature → PATCH /api/tenants/:tid/manifests/:id/sign (via apiPost)
 *
 * API :
 *   GET  /api/tenants/:tid/trips
 *   POST /api/tenants/:tid/manifests/trips/:tripId
 *   POST /api/tenants/:tid/manifests/:id/sign   (PATCH mapped to POST)
 */

import { useState } from 'react';
import { FileText, CheckCircle, Download } from 'lucide-react';
import { useAuth }                       from '../../lib/auth/auth.context';
import { useI18n }                        from '../../lib/i18n/useI18n';
import { useOfflineList }                from '../../lib/hooks/useOfflineList';
import { apiPost }                       from '../../lib/api';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge }                         from '../ui/Badge';
import { Button }                        from '../ui/Button';
import { ErrorAlert }                    from '../ui/ErrorAlert';
import { Skeleton }                      from '../ui/Skeleton';
import { inputClass as inp }             from '../ui/inputClass';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TripRow {
  id: string;
  status: string;
  departureScheduled?: string;
  route?: { origin?: { name: string }; destination?: { name: string } };
}

interface Manifest {
  id?: string;
  tripId: string;
  storageKey: string;
  status: string;
  passengerCount?: number;
  parcelCount?: number;
  generatedById?: string;
  signedById?: string;
  signedAt?: string;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function PageManifests() {
  const { user } = useAuth();
  const { t }    = useI18n();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/tenants/${tenantId}`;

  const {
    items: tripsItems,
    loading: tripsLoading,
    error: tripsError,
    fromCache: tripsFromCache,
  } = useOfflineList<TripRow>({
    table:    'trips',
    tenantId,
    url:      tenantId ? `${base}/trips` : null,
    toRecord: (t) => ({ id: t.id }),
    deps:     [tenantId],
  });
  const trips = tripsItems;

  const [tripId, setTripId]       = useState<string | null>(null);
  const [manifest, setManifest]   = useState<Manifest | null>(null);
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const tripLabel = (trip: TripRow) => {
    const orig = trip.route?.origin?.name ?? '?';
    const dest = trip.route?.destination?.name ?? '?';
    const dt = trip.departureScheduled
      ? new Date(trip.departureScheduled).toLocaleString('fr-FR', {
          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        })
      : '';
    return `${orig} → ${dest}${dt ? ` · ${dt}` : ''} (${trip.status})`;
  };

  const handleGenerate = async () => {
    if (!tripId) return;
    setBusy(true); setError(null);
    try {
      const m = await apiPost<Manifest>(`${base}/manifests/trips/${tripId}`, {});
      setManifest(m);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const handleSign = async () => {
    if (!manifest?.storageKey) return;
    setBusy(true); setError(null);
    try {
      const m = await apiPost<Manifest>(`${base}/manifests/${manifest.storageKey}/sign`, {});
      setManifest(prev => prev ? { ...prev, ...m, status: 'SIGNED' } : prev);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const selectedTrip = trips?.find(t => t.id === tripId) ?? null;

  return (
    <main className="p-6 space-y-6 max-w-3xl mx-auto" role="main" aria-label={t('manifests.title')}>
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
          <FileText className="w-5 h-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('manifests.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t('manifests.subtitle')}</p>
        </div>
      </div>

      {tripsFromCache && (
        <div
          role="note"
          className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
        >
          {t('offline.cachedData')}
        </div>
      )}

      <ErrorAlert error={tripsError || error} icon />

      {/* Trip selector */}
      <Card>
        <CardHeader heading={t('manifests.selectTrip')} />
        <CardContent>
          {tripsLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : !trips || trips.length === 0 ? (
            <p className="text-sm text-slate-500">{t('manifests.noTrip')}</p>
          ) : (
            <div className="flex gap-3">
              <select
                value={tripId ?? ''}
                onChange={e => { setTripId(e.target.value || null); setManifest(null); }}
                className={inp}
                aria-label={t('manifests.selectTrip')}
              >
                <option value="">{t('manifests.selectTrip')}</option>
                {trips.map(trip => (
                  <option key={trip.id} value={trip.id}>{tripLabel(trip)}</option>
                ))}
              </select>
              <Button onClick={handleGenerate} disabled={!tripId || busy}>
                <FileText className="w-4 h-4 mr-1.5" aria-hidden />
                {busy ? t('manifests.generating') : t('manifests.generate')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manifest details */}
      {manifest && (
        <Card>
          <CardHeader
            heading={t('manifests.manifestInfo')}
            description={selectedTrip ? tripLabel(selectedTrip) : ''}
          />
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{t('manifests.status')}</p>
                <Badge variant={manifest.status === 'SIGNED' ? 'success' : 'warning'}>
                  {manifest.status}
                </Badge>
              </div>
              {manifest.passengerCount != null && (
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{t('manifests.passengers')}</p>
                  <p className="tabular-nums font-medium text-slate-900 dark:text-slate-100">{manifest.passengerCount}</p>
                </div>
              )}
              {manifest.parcelCount != null && (
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{t('manifests.parcels')}</p>
                  <p className="tabular-nums font-medium text-slate-900 dark:text-slate-100">{manifest.parcelCount}</p>
                </div>
              )}
              {manifest.signedAt && (
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{t('manifests.signedAt')}</p>
                  <time className="text-slate-700 dark:text-slate-300">
                    {new Date(manifest.signedAt).toLocaleString('fr-FR')}
                  </time>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              {manifest.status === 'DRAFT' && (
                <Button onClick={handleSign} disabled={busy}>
                  <CheckCircle className="w-4 h-4 mr-1.5" aria-hidden />
                  {busy ? t('manifests.signing') : t('manifests.sign')}
                </Button>
              )}
              {manifest.status === 'SIGNED' && (
                <Button variant="outline" onClick={() => window.open(`${base}/manifests/${manifest.storageKey}/download`, '_blank')}>
                  <Download className="w-4 h-4 mr-1.5" aria-hidden />
                  {t('manifests.download')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {tripId && !manifest && !busy && (
        <Card>
          <CardContent className="py-16 text-center text-slate-500 dark:text-slate-400">
            <FileText className="w-10 h-10 mx-auto mb-3 text-slate-300" aria-hidden />
            <p className="font-medium">{t('manifests.noManifest')}</p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
