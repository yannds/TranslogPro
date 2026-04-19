/**
 * PageQuaiManifest — gestion manifestes (passagers + colis) au quai.
 *
 * L'agent de quai prépare les manifestes avant arrivée du chauffeur : il
 * choisit un trajet du jour et génère / signe les 2 kinds (PASSENGERS, PARCELS).
 * Le chauffeur pourra ensuite contre-signer ou télécharger depuis son portail.
 *
 * Mêmes endpoints que PageDriverManifest :
 *   GET  /manifests/trips/:tripId
 *   POST /manifests/trips/:tripId            body { kind }
 *   POST /manifests/:storageKey/sign         body { kind }
 *   GET  /manifests/:storageKey/download
 *
 * Permissions agent quai (seed 2026-04-19) :
 *   data.manifest.generate.agency · data.manifest.sign.agency · data.manifest.print.agency
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Users, Package, FileSignature, CheckCircle2, Download, Loader2, Activity } from 'lucide-react';
import { useAuth }   from '../../lib/auth/auth.context';
import { useI18n }  from '../../lib/i18n/useI18n';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPost, apiFetch, ApiError } from '../../lib/api';
import { Badge }      from '../ui/Badge';
import { Button }     from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { SignatureDialog } from '../ui/SignatureDialog';
import { TripPickerForDay } from '../agent/TripPickerForDay';

const P_MANIFEST_SIGN     = 'data.manifest.sign.agency';
const P_MANIFEST_GENERATE = 'data.manifest.generate.agency';

type ManifestKind = 'PASSENGERS' | 'PARCELS';
const KINDS: readonly ManifestKind[] = ['PASSENGERS', 'PARCELS'] as const;

interface SignedManifestEntry {
  kind:                ManifestKind | 'ALL';
  signedPdfStorageKey: string | null;
  signedAt:            string;
  signedBy:            string;
}

interface ManifestDraft {
  tripId:     string;
  kind:       ManifestKind;
  storageKey: string;
  status:     'DRAFT';
}

interface ManifestSigned {
  storageKey:          string;
  signedPdfStorageKey: string | null;
  kind:                ManifestKind;
  status:              'SIGNED';
  signedAt:            string;
}

type KindState = { draft?: ManifestDraft; signed?: SignedManifestEntry };

// ─── Live manifest panel ────────────────────────────────────────────────────
// Vue "manifeste temps réel" — le manifest signé (PDF) est figé à la génération,
// mais l'agent a besoin de voir en direct l'évolution des scans avant de le
// générer. Cette vue s'appuie sur les endpoints déjà utilisés par BusScreen et
// QuaiScreen (flight-deck) — zéro nouveau backend, pas d'état dupliqué.

interface LivePassenger {
  id:             string;
  passengerName:  string;
  seatNumber:     string | null;
  fareClass:      string | null;
  status:         string;   // CONFIRMED | CHECKED_IN | BOARDED | ...
}

interface LiveStats {
  passengersOnBoard:   number;
  passengersCheckedIn: number;
  passengersConfirmed: number;
  parcelsLoaded:       number;
  parcelsTotal:        number;
  busCapacity:         number;
  updatedAt:           string;
}

function LiveManifestPanel({ tenantId, tripId }: { tenantId: string; tripId: string }) {
  const { t } = useI18n();
  const passengersUrl = `/api/tenants/${tenantId}/flight-deck/trips/${tripId}/passengers`;
  const statsUrl      = `/api/tenants/${tenantId}/flight-deck/trips/${tripId}/live-stats`;

  const { data: passengers, refetch: refetchPax }     = useFetch<LivePassenger[]>(passengersUrl, [passengersUrl]);
  const { data: stats,      refetch: refetchStats }   = useFetch<LiveStats>(statsUrl, [statsUrl]);

  // Polling 5s — on veut que l'agent voit les scans de son collègue / chauffeur
  // en direct sans bouton refresh. Cadence volontairement plus rapide que les
  // écrans publics (10s) car c'est une page opérationnelle, avec peu d'users.
  useEffect(() => {
    const id = setInterval(() => {
      refetchPax();
      refetchStats();
    }, 5_000);
    return () => clearInterval(id);
  }, [refetchPax, refetchStats]);

  // Tri : à bord d'abord, puis en gare, puis confirmés restants. Ça met en
  // haut les gens qui viennent d'être scannés (feedback visuel instantané).
  const sorted = useMemo(() => {
    const statusWeight = (s: string) => s === 'BOARDED' ? 0 : s === 'CHECKED_IN' ? 1 : 2;
    return [...(passengers ?? [])].sort((a, b) => {
      const w = statusWeight(a.status) - statusWeight(b.status);
      return w !== 0 ? w : a.passengerName.localeCompare(b.passengerName);
    });
  }, [passengers]);

  const statusBadge = (status: string) => {
    if (status === 'BOARDED')    return <Badge variant="success" size="sm">{t('stationAgent.statusBoarded')}</Badge>;
    if (status === 'CHECKED_IN') return <Badge variant="info"    size="sm">{t('stationAgent.statusCheckedIn')}</Badge>;
    if (status === 'CANCELLED')  return <Badge variant="danger"  size="sm">{t('stationAgent.statusCancelled')}</Badge>;
    return <Badge variant="warning" size="sm">{t('stationAgent.statusConfirmed')}</Badge>;
  };

  return (
    <section
      aria-label={t('quaiManifest.liveTitle')}
      className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-4"
    >
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-emerald-500 animate-pulse" aria-hidden />
        <h2 className="text-sm font-bold t-text uppercase tracking-wider">{t('quaiManifest.liveTitle')}</h2>
        <span className="ml-auto text-[10px] t-text-3 font-mono">{t('quaiManifest.refreshed5s')}</span>
      </div>

      {/* Compteurs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <LiveCounter label={t('stationAgent.statusConfirmed')}  value={stats?.passengersConfirmed ?? 0} tone="slate" />
        <LiveCounter label={t('ui.in_station')}                  value={stats?.passengersCheckedIn ?? 0} tone="info" />
        <LiveCounter label={t('ui.on_board')}                    value={stats?.passengersOnBoard   ?? 0} tone="success" />
        <LiveCounter label={t('col.parcels')}
          value={`${stats?.parcelsLoaded ?? 0}/${stats?.parcelsTotal ?? 0}`}
          tone="purple"
        />
      </div>

      {/* Liste passagers */}
      <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
        {sorted.length === 0 ? (
          <p className="text-sm t-text-3 text-center py-4">{t('quaiManifest.noPassenger')}</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 max-h-96 overflow-y-auto">
            {sorted.map(p => (
              <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="font-medium t-text flex-1 truncate">{p.passengerName}</span>
                <span className="t-text-3 text-xs tabular-nums w-12 text-right">
                  {p.seatNumber ?? '—'}
                </span>
                <div className="w-28 text-right">{statusBadge(p.status)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function LiveCounter({ label, value, tone }: {
  label: string;
  value: number | string;
  tone:  'slate' | 'info' | 'success' | 'purple';
}) {
  const toneCls = {
    slate:   'bg-slate-50 dark:bg-slate-800/50 text-slate-900 dark:text-white',
    info:    'bg-sky-50 dark:bg-sky-900/30 text-sky-900 dark:text-sky-200',
    success: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-200',
    purple:  'bg-purple-50 dark:bg-purple-900/30 text-purple-900 dark:text-purple-200',
  }[tone];
  return (
    <div className={`rounded-lg p-3 ${toneCls}`}>
      <p className="text-[10px] uppercase tracking-widest opacity-70 font-semibold">{label}</p>
      <p className="text-2xl font-black tabular-nums mt-1">{value}</p>
    </div>
  );
}

export function PageQuaiManifest() {
  const { t }    = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/tenants/${tenantId}`;

  const [tripId, setTripId] = useState<string | null>(null);

  const { data: signedList, refetch: refetchSigned } = useFetch<SignedManifestEntry[]>(
    tenantId && tripId ? `${base}/manifests/trips/${tripId}` : null,
    [tenantId, tripId],
  );

  const canSign     = (user?.permissions ?? []).includes(P_MANIFEST_SIGN);
  const canGenerate = (user?.permissions ?? []).includes(P_MANIFEST_GENERATE);

  const [state, setState]       = useState<Record<ManifestKind, KindState>>({ PASSENGERS: {}, PARCELS: {} });
  const [busyKind, setBusyKind] = useState<ManifestKind | null>(null);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => { setState({ PASSENGERS: {}, PARCELS: {} }); }, [tripId]);
  useEffect(() => {
    if (!signedList) return;
    setState(prev => {
      const next = { PASSENGERS: { ...prev.PASSENGERS }, PARCELS: { ...prev.PARCELS } };
      for (const kind of KINDS) {
        const match = signedList.find(s => s.kind === kind);
        next[kind].signed = match;
      }
      return next;
    });
  }, [signedList]);

  const handleGenerate = useCallback(async (kind: ManifestKind) => {
    if (!tripId) return;
    setBusyKind(kind); setError(null);
    try {
      const m = await apiPost<ManifestDraft>(`${base}/manifests/trips/${tripId}`, { kind });
      setState(prev => ({ ...prev, [kind]: { ...prev[kind], draft: m } }));
    } catch (e) {
      setError(e instanceof ApiError ? String((e.body as { message?: string })?.message ?? e.message) : String(e));
    } finally { setBusyKind(null); }
  }, [tripId, base]);

  const [signingKind, setSigningKind] = useState<ManifestKind | null>(null);

  const handleSign = useCallback(async (kind: ManifestKind, signatureSvg: string | null) => {
    const draft = state[kind].draft;
    if (!draft) return;
    setBusyKind(kind); setError(null);
    try {
      const m = await apiPost<ManifestSigned>(
        `${base}/manifests/${encodeURIComponent(draft.storageKey)}/sign`,
        signatureSvg ? { kind, signatureSvg } : { kind },
      );
      setState(prev => ({
        ...prev,
        [kind]: {
          draft:  undefined,
          signed: {
            kind,
            signedPdfStorageKey: m.signedPdfStorageKey,
            signedAt:            m.signedAt ?? new Date().toISOString(),
            signedBy:            user?.id ?? '',
          },
        },
      }));
      setSigningKind(null);
      refetchSigned();
    } catch (e) {
      setError(e instanceof ApiError ? String((e.body as { message?: string })?.message ?? e.message) : String(e));
    } finally { setBusyKind(null); }
  }, [state, base, user?.id, refetchSigned]);

  const handleDownload = useCallback(async (kind: ManifestKind) => {
    const signed = state[kind].signed;
    if (!signed?.signedPdfStorageKey) return;
    try {
      const res = await apiFetch<string | { downloadUrl?: string }>(
        `${base}/manifests/${encodeURIComponent(signed.signedPdfStorageKey)}/download`,
      );
      const url = typeof res === 'string' ? res : res?.downloadUrl;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof ApiError ? String((e.body as { message?: string })?.message ?? e.message) : String(e));
    }
  }, [state, base]);

  return (
    <main className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto" role="main">
      <header className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30 shrink-0">
          <FileText className="w-5 h-5 text-purple-600 dark:text-purple-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold t-text">{t('quaiManifest.title')}</h1>
          <p className="text-sm t-text-2 mt-0.5">{t('quaiManifest.subtitle')}</p>
        </div>
      </header>

      <TripPickerForDay selectedTripId={tripId} onChange={setTripId} />

      <ErrorAlert error={error} icon />

      {!tripId ? (
        <p className="text-sm t-text-3 text-center py-10">{t('quaiManifest.pickTrip')}</p>
      ) : (
        <div className="space-y-4">
        <LiveManifestPanel tenantId={tenantId} tripId={tripId} />
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {KINDS.map(kind => {
            const { draft, signed } = state[kind];
            const isSigned = !!signed;
            const hasDraft = !!draft;
            const busy     = busyKind === kind;
            const Icon     = kind === 'PASSENGERS' ? Users : Package;
            return (
              <div key={kind} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30 shrink-0">
                    <Icon className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold t-text">
                      {kind === 'PASSENGERS' ? t('quaiManifest.passengers') : t('quaiManifest.parcels')}
                    </p>
                  </div>
                  <Badge variant={isSigned ? 'success' : hasDraft ? 'warning' : 'default'} size="sm">
                    {isSigned ? t('quaiManifest.signed') : hasDraft ? t('quaiManifest.draft') : t('quaiManifest.none')}
                  </Badge>
                </div>

                {signed?.signedAt && (
                  <p className="text-xs t-text-3">
                    <CheckCircle2 className="inline w-3.5 h-3.5 text-emerald-500 mr-1 -mt-0.5" aria-hidden />
                    {new Date(signed.signedAt).toLocaleString('fr-FR')}
                  </p>
                )}

                <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  {!isSigned && !hasDraft && canGenerate && (
                    <Button onClick={() => handleGenerate(kind)} disabled={busy}
                      className="min-h-[44px]"
                      leftIcon={busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}>
                      {t('quaiManifest.generate')}
                    </Button>
                  )}
                  {!isSigned && hasDraft && canSign && (
                    <Button onClick={() => setSigningKind(kind)} disabled={busy}
                      className="min-h-[44px]"
                      leftIcon={busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSignature className="w-4 h-4" />}>
                      {t('quaiManifest.sign')}
                    </Button>
                  )}
                  {isSigned && (
                    <Button variant="outline" onClick={() => handleDownload(kind)}
                      disabled={!signed?.signedPdfStorageKey}
                      className="min-h-[44px]"
                      leftIcon={<Download className="w-4 h-4" />}>
                      {signed?.signedPdfStorageKey ? t('quaiManifest.download') : t('quaiManifest.pdfPending')}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </section>
        </div>
      )}

      {/* Dialog signature tactile — même flow que chauffeur */}
      {signingKind && (
        <SignatureDialog
          open
          title={t('quaiManifest.signDialogTitle')}
          description={signingKind === 'PASSENGERS' ? t('quaiManifest.passengers') : t('quaiManifest.parcels')}
          onConfirm={(svg) => handleSign(signingKind, svg)}
          onClose={() => setSigningKind(null)}
        />
      )}
    </main>
  );
}
