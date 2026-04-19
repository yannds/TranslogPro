/**
 * PageManifests — Manifestes de trajet (admin)
 *
 * Depuis 2026-04-19 : les manifestes sont persistés en DB (table `manifests`)
 * et leur cycle de vie est gouverné par le blueprint `manifest-standard` via
 * WorkflowEngine. Deux kinds coexistent par trajet : PASSENGERS et PARCELS,
 * chacun signé indépendamment. La signature déclenche la génération du PDF
 * figé côté backend.
 *
 * API :
 *   GET  /api/tenants/:tid/trips
 *   GET  /api/tenants/:tid/manifests/trips/:tripId   → liste des manifestes du trajet
 *   POST /api/tenants/:tid/manifests/trips/:tripId   body: { kind }
 *                                                    → crée DRAFT + submit = SUBMITTED
 *   POST /api/tenants/:tid/manifests/:id/sign        body: { signatureSvg? }
 *                                                    → SUBMITTED → SIGNED + PDF figé
 *   GET  /api/tenants/:tid/manifests/:id/download    → URL signée du PDF
 */

import { useCallback, useEffect, useState } from 'react';
import { FileText, CheckCircle, Download, Users, Package } from 'lucide-react';
import { useAuth }                       from '../../lib/auth/auth.context';
import { useI18n }                       from '../../lib/i18n/useI18n';
import { useOfflineList }                from '../../lib/hooks/useOfflineList';
import { useFetch }                      from '../../lib/hooks/useFetch';
import { apiPost, apiFetch }             from '../../lib/api';
import { cn }                            from '../../lib/utils';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge }                         from '../ui/Badge';
import { Button }                        from '../ui/Button';
import { ErrorAlert }                    from '../ui/ErrorAlert';
import { Skeleton }                      from '../ui/Skeleton';
import { inputClass as inp }             from '../ui/inputClass';

// ─── Types ────────────────────────────────────────────────────────────────────

type ManifestKind = 'PASSENGERS' | 'PARCELS';
const KINDS: readonly ManifestKind[] = ['PASSENGERS', 'PARCELS'] as const;

interface TripRow {
  id: string;
  status: string;
  departureScheduled?: string;
  route?: { origin?: { name: string }; destination?: { name: string } };
}

interface ManifestDto {
  id:                  string;
  tenantId:            string;
  tripId:              string;
  kind:                ManifestKind | 'ALL';
  status:              'DRAFT' | 'SUBMITTED' | 'SIGNED' | 'REJECTED' | 'ARCHIVED';
  storageKey:          string | null;
  signedPdfStorageKey: string | null;
  passengerCount:      number;
  parcelCount:         number;
  signedAt:            string | null;
  signedById:          string | null;
  generatedAt:         string;
  generatedById:       string;
  version:             number;
}

type KindState = { manifest?: ManifestDto };

// ─── Page ─────────────────────────────────────────────────────────────────────

export function PageManifests() {
  const { user } = useAuth();
  const { t }    = useI18n();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/tenants/${tenantId}`;

  const {
    items:   tripsItems,
    loading: tripsLoading,
    error:   tripsError,
    fromCache: tripsFromCache,
  } = useOfflineList<TripRow>({
    table:    'trips',
    tenantId,
    url:      tenantId ? `${base}/trips` : null,
    toRecord: (tp) => ({ id: tp.id }),
    deps:     [tenantId],
  });
  const trips = tripsItems;

  const [tripId, setTripId]   = useState<string | null>(null);
  const [state, setState]     = useState<Record<ManifestKind, KindState>>({ PASSENGERS: {}, PARCELS: {} });
  const [busyKind, setBusyKind] = useState<ManifestKind | null>(null);
  const [error, setError]     = useState<string | null>(null);

  // Pré-sélection si chauffeur/hôtesse sur un trajet actif
  const { data: activeTrip } = useFetch<{ id: string } | null>(
    tenantId ? `${base}/flight-deck/active-trip` : null,
    [tenantId],
  );
  useEffect(() => {
    if (!tripId && activeTrip?.id && trips?.some(tp => tp.id === activeTrip.id)) {
      setTripId(activeTrip.id);
    }
  }, [activeTrip?.id, trips, tripId]);

  // Charge tous les manifestes existants pour le trip sélectionné
  const listUrl = tripId ? `${base}/manifests/trips/${tripId}` : null;
  const { data: manifestList, refetch: refetchList } = useFetch<ManifestDto[]>(listUrl, [listUrl]);

  useEffect(() => {
    if (!manifestList) return;
    setState(prev => {
      const next = { PASSENGERS: { ...prev.PASSENGERS }, PARCELS: { ...prev.PARCELS } };
      for (const kind of KINDS) {
        const match = manifestList.find(m => m.kind === kind);
        next[kind].manifest = match;
      }
      return next;
    });
  }, [manifestList]);

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

  const handleGenerate = useCallback(async (kind: ManifestKind) => {
    if (!tripId) return;
    setBusyKind(kind); setError(null);
    try {
      const m = await apiPost<ManifestDto>(`${base}/manifests/trips/${tripId}`, { kind });
      setState(prev => ({ ...prev, [kind]: { manifest: m } }));
    } catch (err) { setError((err as Error).message); }
    finally { setBusyKind(null); }
  }, [tripId, base]);

  const handleSign = useCallback(async (kind: ManifestKind) => {
    const current = state[kind].manifest;
    if (!current?.id) return;
    setBusyKind(kind); setError(null);
    try {
      const m = await apiPost<ManifestDto>(`${base}/manifests/${current.id}/sign`, {});
      setState(prev => ({ ...prev, [kind]: { manifest: m } }));
      refetchList();
    } catch (err) { setError((err as Error).message); }
    finally { setBusyKind(null); }
  }, [state, base, refetchList]);

  const handleDownload = useCallback(async (kind: ManifestKind) => {
    const current = state[kind].manifest;
    if (!current?.id || !current.signedPdfStorageKey) return;
    try {
      const res = await apiFetch<string | { downloadUrl?: string }>(
        `${base}/manifests/${current.id}/download`,
      );
      const url = typeof res === 'string' ? res : res?.downloadUrl;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) { setError((err as Error).message); }
  }, [state, base]);

  const selectedTrip = trips?.find(tp => tp.id === tripId) ?? null;

  return (
    <main className="p-6 space-y-6 max-w-4xl mx-auto" role="main" aria-label={t('manifests.title')}>
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
        <div role="note" className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
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
            <select
              value={tripId ?? ''}
              onChange={e => { setTripId(e.target.value || null); setState({ PASSENGERS: {}, PARCELS: {} }); }}
              className={inp}
              aria-label={t('manifests.selectTrip')}
            >
              <option value="">{t('manifests.selectTrip')}</option>
              {trips.map(trip => (
                <option key={trip.id} value={trip.id}>{tripLabel(trip)}</option>
              ))}
            </select>
          )}
        </CardContent>
      </Card>

      {/* Deux manifestes : PASSENGERS + PARCELS */}
      {tripId && selectedTrip && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {KINDS.map(kind => (
            <ManifestCard
              key={kind}
              kind={kind}
              state={state[kind]}
              busy={busyKind === kind}
              onGenerate={() => handleGenerate(kind)}
              onSign={() => handleSign(kind)}
              onDownload={() => handleDownload(kind)}
            />
          ))}
        </div>
      )}
    </main>
  );
}

// ─── Sous-composant : carte d'un manifeste (PASSENGERS ou PARCELS) ──────────

function ManifestCard({
  kind, state, busy, onGenerate, onSign, onDownload,
}: {
  kind: ManifestKind;
  state: KindState;
  busy: boolean;
  onGenerate: () => void;
  onSign:     () => void;
  onDownload: () => void;
}) {
  const { t } = useI18n();
  const Icon = kind === 'PASSENGERS' ? Users : Package;
  const headingKey = kind === 'PASSENGERS' ? 'manifests.passengersManifest' : 'manifests.parcelsManifest';
  const descKey    = kind === 'PASSENGERS' ? 'manifests.passengersDesc'     : 'manifests.parcelsDesc';

  const m = state.manifest;
  const isSigned     = m?.status === 'SIGNED' || m?.status === 'ARCHIVED';
  const canSign      = m?.status === 'SUBMITTED';
  const needGenerate = !m || m.status === 'REJECTED';

  const badgeVariant = isSigned ? 'success' : canSign ? 'warning' : 'outline';
  const badgeLabel   = isSigned   ? t('manifests.statusSigned')
                     : canSign    ? t('manifests.statusDraft')
                     : t('manifests.statusNone');

  return (
    <Card>
      <CardHeader
        heading={
          <span className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-slate-500 dark:text-slate-400" aria-hidden />
            {t(headingKey)}
          </span>
        }
        description={t(descKey)}
      />
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('manifests.status')}
          </span>
          <Badge variant={badgeVariant}>{badgeLabel}</Badge>
        </div>

        {m && (m.status === 'SUBMITTED' || m.status === 'DRAFT') && (
          <div className="grid grid-cols-2 gap-3 text-xs text-slate-600 dark:text-slate-300">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">{t('manifests.passengers')}</p>
              <p className="tabular-nums font-semibold text-slate-900 dark:text-slate-100">{m.passengerCount}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">{t('manifests.parcels')}</p>
              <p className="tabular-nums font-semibold text-slate-900 dark:text-slate-100">{m.parcelCount}</p>
            </div>
          </div>
        )}

        {m?.signedAt && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('manifests.signedAt')} : <time>{new Date(m.signedAt).toLocaleString('fr-FR')}</time>
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          {needGenerate && (
            <Button onClick={onGenerate} disabled={busy}>
              <FileText className="w-4 h-4 mr-1.5" aria-hidden />
              {busy ? t('manifests.generating') : t('manifests.generate')}
            </Button>
          )}
          {canSign && (
            <Button onClick={onSign} disabled={busy}>
              <CheckCircle className="w-4 h-4 mr-1.5" aria-hidden />
              {busy ? t('manifests.signing') : t('manifests.sign')}
            </Button>
          )}
          {isSigned && (
            <Button
              variant="outline"
              onClick={onDownload}
              disabled={!m?.signedPdfStorageKey}
              className={cn(!m?.signedPdfStorageKey && 'opacity-60')}
            >
              <Download className="w-4 h-4 mr-1.5" aria-hidden />
              {m?.signedPdfStorageKey ? t('manifests.download') : t('manifests.pdfPending')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
