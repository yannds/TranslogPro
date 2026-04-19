/**
 * PageDriverManifest — Manifestes passagers + colis du trajet actif
 *
 * Depuis 2026-04-19 : le chauffeur signe **deux manifestes distincts** en
 * acknowledgment du trajet — un pour les passagers embarqués, un pour les
 * colis chargés. Les deux sont générés et signés indépendamment, et le PDF
 * signé est produit automatiquement côté backend au moment de la signature.
 *
 * API :
 *   GET  /flight-deck/active-trip
 *   GET  /flight-deck/trips/:tripId/passengers
 *   GET  /manifests/trips/:tripId                   → liste kinds déjà signés
 *   POST /manifests/trips/:tripId      body { kind }
 *   POST /manifests/:storageKey/sign   body { kind }
 *   GET  /manifests/:storageKey/download            → URL signée PDF figé
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Users, Package, FileSignature, CheckCircle2, Download, Loader2 } from 'lucide-react';
import { useAuth }      from '../../lib/auth/auth.context';
import { useI18n }      from '../../lib/i18n/useI18n';
import { useFetch }     from '../../lib/hooks/useFetch';
import { apiPost, apiFetch, ApiError } from '../../lib/api';
import { Badge }        from '../ui/Badge';
import { Button }       from '../ui/Button';
import { ErrorAlert }   from '../ui/ErrorAlert';
import DataTableMaster, { type Column } from '../DataTableMaster';
import { SignatureDialog } from '../ui/SignatureDialog';

const P_MANIFEST_SIGN     = 'data.manifest.sign.agency';
const P_MANIFEST_GENERATE = 'data.manifest.generate.agency';

type ManifestKind = 'PASSENGERS' | 'PARCELS';
const KINDS: readonly ManifestKind[] = ['PASSENGERS', 'PARCELS'] as const;

/* ── Types ──────────────────────────────────────────────────────────── */

interface ActiveTrip {
  id:           string;
  reference?:   string | null;
  route?:       { name?: string; origin?: { name: string } | null; destination?: { name: string } | null } | null;
  bus?:         { plateNumber: string; model?: string | null } | null;
  departureScheduled?: string | null;
  travelers?:   { id: string }[];
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

interface Passenger {
  id:             string;
  passengerName:  string;
  passengerPhone: string | null;
  seatNumber:     string | null;
  fareClass:      string | null;
  status:         string;
  luggageKg:      number | null;
  checkedInAt:    string | null;
  boardedAt:      string | null;
}

/* ── Helpers ────────────────────────────────────────────────────────── */

type BadgeVariant = 'success' | 'info' | 'warning' | 'danger' | 'default';

const STATUS_MAP: Record<string, { labelKey: string; variant: BadgeVariant }> = {
  CHECKED_IN: { labelKey: 'driverManifest.statusCheckedIn',  variant: 'info'    },
  BOARDED:    { labelKey: 'driverManifest.statusBoarded',     variant: 'success' },
  NO_SHOW:    { labelKey: 'driverManifest.statusNoShow',      variant: 'danger'  },
  CANCELLED:  { labelKey: 'driverManifest.statusCancelled',   variant: 'warning' },
  CONFIRMED:  { labelKey: 'driverManifest.statusConfirmed',   variant: 'default' },
};

function StatusBadgeCell({ status }: { status: string }) {
  const { t } = useI18n();
  const s = STATUS_MAP[status] ?? { labelKey: status, variant: 'default' as BadgeVariant };
  return <Badge variant={s.variant} size="sm">{t(s.labelKey)}</Badge>;
}

/* ── Columns ────────────────────────────────────────────────────────── */

const columns: Column<Passenger>[] = [
  { key: 'seatNumber',     header: 'Siège',     sortable: true, width: '80px',  cellRenderer: v => v ?? '—' },
  { key: 'passengerName',  header: 'Nom',       sortable: true },
  { key: 'passengerPhone', header: 'Téléphone', sortable: false, cellRenderer: v => (v as string | null) ?? '—' },
  { key: 'fareClass',      header: 'Classe',    sortable: true, width: '100px', cellRenderer: v => (v as string | null) ?? '—' },
  { key: 'luggageKg',      header: 'Bagages (kg)', sortable: true, align: 'right', width: '110px',
    cellRenderer: v => (v as number | null) != null ? `${(v as number).toLocaleString('fr-FR')} kg` : '—',
    csvValue:     v => (v as number | null) != null ? String(v) : '',
  },
  { key: 'status', header: 'Statut', sortable: true, width: '130px',
    cellRenderer: v => <StatusBadgeCell status={v as string} />,
    csvValue:     v => String(v),
  },
];

/* ── Component ──────────────────────────────────────────────────────── */

export function PageDriverManifest() {
  const { t }    = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const base     = tenantId ? `/api/tenants/${tenantId}` : '';

  const { data: trip, loading: loadingTrip, error: errorTrip } =
    useFetch<ActiveTrip>(tenantId ? `${base}/flight-deck/active-trip` : null, [tenantId]);

  const { data: passengers, loading: loadingPax, error: errorPax } =
    useFetch<Passenger[]>(
      trip?.id ? `${base}/flight-deck/trips/${trip.id}/passengers` : null,
      [tenantId, trip?.id],
    );

  // Liste de tous les manifestes pour ce trajet (par kind)
  const listUrl = trip?.id ? `${base}/manifests/trips/${trip.id}` : null;
  const { data: manifestList, refetch: refetchList } =
    useFetch<ManifestDto[]>(listUrl, [listUrl]);

  const canSign     = (user?.permissions ?? []).includes(P_MANIFEST_SIGN);
  const canGenerate = (user?.permissions ?? []).includes(P_MANIFEST_GENERATE);

  const [state, setState]       = useState<Record<ManifestKind, KindState>>({ PASSENGERS: {}, PARCELS: {} });
  const [busyKind, setBusyKind] = useState<ManifestKind | null>(null);
  const [error, setError]       = useState<string | null>(null);

  // Rafraîchit l'état local à partir de la liste backend
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

  // Reset state quand on change de trajet (rare sur cette page mais safe)
  useEffect(() => {
    setState({ PASSENGERS: {}, PARCELS: {} });
  }, [trip?.id]);

  const handleGenerate = useCallback(async (kind: ManifestKind) => {
    if (!trip?.id) return;
    setBusyKind(kind); setError(null);
    try {
      const m = await apiPost<ManifestDto>(`${base}/manifests/trips/${trip.id}`, { kind });
      setState(prev => ({ ...prev, [kind]: { manifest: m } }));
    } catch (e) {
      setError(e instanceof ApiError
        ? String((e.body as { message?: string })?.message ?? e.message)
        : String(e));
    } finally { setBusyKind(null); }
  }, [trip?.id, base]);

  // signingKind — kind en cours de signature (dialog ouvert). Null = pas de signature en cours.
  const [signingKind, setSigningKind] = useState<ManifestKind | null>(null);

  const handleSign = useCallback(async (kind: ManifestKind, signatureSvg: string | null) => {
    const current = state[kind].manifest;
    if (!current?.id) return;
    setBusyKind(kind); setError(null);
    try {
      // signatureSvg optionnel — le backend accepte l'absence (fallback no-touch UI).
      // Quand présent, stocké avec le manifeste pour impression / audit.
      const body = signatureSvg ? { signatureSvg } : {};
      const m = await apiPost<ManifestDto>(`${base}/manifests/${current.id}/sign`, body);
      setState(prev => ({ ...prev, [kind]: { manifest: m } }));
      setSigningKind(null);
      refetchList();
    } catch (e) {
      setError(e instanceof ApiError
        ? String((e.body as { message?: string })?.message ?? e.message)
        : String(e));
    } finally { setBusyKind(null); }
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
    } catch (e) {
      setError(e instanceof ApiError
        ? String((e.body as { message?: string })?.message ?? e.message)
        : String(e));
    }
  }, [state, base]);

  const paxList = useMemo(() => passengers ?? [], [passengers]);
  const boardedCount   = useMemo(() => paxList.filter(p => p.status === 'BOARDED').length, [paxList]);
  const checkedInCount = useMemo(() => paxList.filter(p => p.status === 'CHECKED_IN').length, [paxList]);
  const noShowCount    = useMemo(() => paxList.filter(p => p.status === 'NO_SHOW').length, [paxList]);

  const errorTop = errorTrip || errorPax;
  const loading  = loadingTrip || loadingPax;

  return (
    <main className="p-6 space-y-6" role="main" aria-label={t('driverManifest.pageTitle')}>
      {/* ── Header ── */}
      <header className="flex items-center gap-3">
        <FileText className="w-7 h-7 text-teal-600 dark:text-teal-400 shrink-0" aria-hidden />
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('driverManifest.pageTitle')}</h1>
          {trip && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {trip.reference && <span className="font-medium text-slate-700 dark:text-slate-300">{trip.reference}</span>}
              {trip.route?.name && <span> — {trip.route.name}</span>}
            </p>
          )}
        </div>
      </header>

      <ErrorAlert error={errorTop || error} />

      {/* ── Empty state ── */}
      {!loading && !trip && !errorTop && (
        <div className="flex flex-col items-center py-20 text-slate-500 dark:text-slate-400" role="status">
          <FileText className="w-12 h-12 mb-4 text-slate-300 dark:text-slate-600" aria-hidden />
          <p className="text-base font-medium">{t('driverManifest.noActiveTrip')}</p>
          <p className="text-sm mt-1">{t('driverManifest.noActiveTripMsg')}</p>
        </div>
      )}

      {/* ── Trip summary ── */}
      {trip && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: t('driverManifest.reference'), value: trip.reference ?? '—' },
            { label: t('driverManifest.route'),     value: trip.route?.name ?? '—' },
            { label: t('driverManifest.bus'),       value: trip.bus?.plateNumber ?? '—' },
            { label: t('driverManifest.departureLabel'), value: trip.departureScheduled ? new Date(trip.departureScheduled).toLocaleString('fr-FR') : '—' },
          ].map(item => (
            <div key={item.label} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{item.label}</p>
              <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{item.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── KPI passagers ── */}
      {trip && !loading && (
        <div className="flex flex-wrap gap-4">
          <KpiPill icon={<Users className="w-4 h-4" aria-hidden />} label={t('driverManifest.total')} value={paxList.length} />
          <KpiPill label={t('driverManifest.boarded')}   value={boardedCount}   className="text-green-700 dark:text-green-400" />
          <KpiPill label={t('driverManifest.checkedIn')} value={checkedInCount} className="text-blue-700 dark:text-blue-400" />
          <KpiPill label={t('driverManifest.absent')}    value={noShowCount}    className="text-red-700 dark:text-red-400" />
        </div>
      )}

      {/* ── Signatures — un manifeste par kind ── */}
      {trip && !loading && (canSign || canGenerate) && (
        <section aria-label={t('driverManifest.signatureLabel')} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {KINDS.map(kind => (
            <SignatureCard
              key={kind}
              kind={kind}
              state={state[kind]}
              busy={busyKind === kind}
              canGenerate={canGenerate}
              canSign={canSign}
              onGenerate={() => handleGenerate(kind)}
              onSign={() => setSigningKind(kind)}
              onDownload={() => handleDownload(kind)}
            />
          ))}
        </section>
      )}

      {/* Dialog signature tactile — s'ouvre quand on clique sur "Signer" dans
          un SignatureCard. Le SVG est passé à handleSign qui fait le POST. */}
      {signingKind && (
        <SignatureDialog
          open
          title={t('driverManifest.signDialogTitle')}
          description={signingKind === 'PASSENGERS'
            ? t('driverManifest.passengersManifest')
            : t('driverManifest.parcelsManifest')}
          onConfirm={(svg) => handleSign(signingKind, svg)}
          onClose={() => setSigningKind(null)}
        />
      )}

      {/* ── Passenger table ── */}
      {trip && (
        <DataTableMaster<Passenger>
          columns={columns}
          data={paxList}
          loading={loading}
          emptyMessage={t('driverManifest.emptyMsg')}
          exportFormats={['csv', 'pdf']}
          exportFilename="manifeste"
        />
      )}
    </main>
  );
}

/* ── Sub-component : signature card (passengers / parcels) ──────────── */

function SignatureCard({
  kind, state, busy, canGenerate, canSign, onGenerate, onSign, onDownload,
}: {
  kind:        ManifestKind;
  state:       KindState;
  busy:        boolean;
  canGenerate: boolean;
  canSign:     boolean;
  onGenerate:  () => void;
  onSign:      () => void;
  onDownload:  () => void;
}) {
  const { t } = useI18n();
  const Icon = kind === 'PASSENGERS' ? Users : Package;
  const titleKey = kind === 'PASSENGERS'
    ? 'driverManifest.passengersManifest'
    : 'driverManifest.parcelsManifest';
  const descKey  = kind === 'PASSENGERS'
    ? 'driverManifest.passengersDesc'
    : 'driverManifest.parcelsDesc';

  const m = state.manifest;
  const isSigned     = m?.status === 'SIGNED' || m?.status === 'ARCHIVED';
  const isSubmitted  = m?.status === 'SUBMITTED';
  const needGenerate = !m || m.status === 'REJECTED';

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30 shrink-0">
          <Icon className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">{t(titleKey)}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t(descKey)}</p>
        </div>
        <Badge
          variant={isSigned ? 'success' : isSubmitted ? 'warning' : 'default'}
          size="sm"
        >
          {isSigned    ? t('driverManifest.statusSigned')
           : isSubmitted ? t('driverManifest.statusDraft')
           : t('driverManifest.statusNone')}
        </Badge>
      </div>

      {m?.signedAt && (
        <p className="text-xs text-slate-500 dark:text-slate-400 pl-11">
          <CheckCircle2 className="inline w-3.5 h-3.5 text-emerald-500 mr-1 -mt-0.5" aria-hidden />
          {t('driverManifest.signedAt')} <time>{new Date(m.signedAt).toLocaleString('fr-FR')}</time>
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
        {needGenerate && canGenerate && (
          <Button
            onClick={onGenerate}
            disabled={busy}
            className="min-h-[44px]"
            leftIcon={busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          >
            {busy ? t('common.creating') : t('driverManifest.generate')}
          </Button>
        )}
        {isSubmitted && canSign && (
          <Button
            onClick={onSign}
            disabled={busy}
            className="min-h-[44px]"
            leftIcon={busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSignature className="w-4 h-4" />}
          >
            {busy ? t('common.saving') : t('driverManifest.signAction')}
          </Button>
        )}
        {isSigned && (
          <Button
            variant="outline"
            onClick={onDownload}
            disabled={!m?.signedPdfStorageKey}
            className="min-h-[44px]"
            leftIcon={<Download className="w-4 h-4" />}
          >
            {m?.signedPdfStorageKey ? t('driverManifest.download') : t('driverManifest.pdfPending')}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ── Internal KPI pill ──────────────────────────────────────────────── */

function KpiPill({ icon, label, value, className = '' }: {
  icon?: React.ReactNode;
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 ${className}`}>
      {icon}
      <span>{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}
