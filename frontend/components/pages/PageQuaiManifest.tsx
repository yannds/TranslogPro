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

import { useCallback, useEffect, useState } from 'react';
import { FileText, Users, Package, FileSignature, CheckCircle2, Download, Loader2 } from 'lucide-react';
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
