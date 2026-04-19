/**
 * PageQuaiScan — scan ticket ou colis, action en un clic, feedback immédiat.
 *
 * Flow :
 *   1. QrScannerWeb détecte un code (QR caméra ou saisie manuelle)
 *   2. On résout automatiquement le type via GET /scan/ticket puis /scan/parcel
 *      (les 2 endpoints sont scoped au tenant et retournent une 404 si pas
 *      trouvé — on tente ticket en premier car c'est le scan majoritaire)
 *   3. On affiche une carte avec l'entité + `nextAction` calculée côté backend
 *      depuis le blueprint (CHECK_IN / BOARD / LOAD / ARRIVE / DELIVER / refus)
 *   4. Clic sur le bouton d'action → appel du bon endpoint WorkflowEngine
 *      (flight-deck/check-in|board pour tickets, parcels/:id/scan pour colis)
 *   5. Toast de succès + reset automatique du scanner pour le code suivant
 *
 * Fallback « Comme billet / Comme colis » : exposé uniquement si la détection
 * auto échoue (ex: code court saisi à la main qui ressemble ni à une URL
 * ticket ni à un trackingCode reconnu).
 *
 * Permissions : TICKET_SCAN_AGENCY et/ou PARCEL_SCAN_AGENCY + TRAVELER_VERIFY_AGENCY.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ScanLine, Package, Ticket, CheckCircle2, RotateCcw } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { apiGet, apiPost, apiPatch, ApiError } from '../../lib/api';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { QrScannerWeb } from '../ui/QrScannerWeb';
import { cn } from '../../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────

type TicketNextAction = 'CHECK_IN' | 'BOARD' | 'ALREADY_CHECKED_IN' | 'ALREADY_BOARDED' | 'TICKET_CANCELLED' | 'TICKET_EXPIRED' | 'TICKET_PENDING';
type ParcelNextAction = 'LOAD' | 'ARRIVE' | 'DELIVER' | 'ALREADY_LOADED' | 'ALREADY_DELIVERED' | 'CANCELLED' | 'NEEDS_SHIPMENT' | 'PACK';

interface TicketLookup {
  kind:     'TICKET';
  ticket:   { id: string; qrCode: string; passengerName: string; seatNumber: string | null; fareClass: string; status: string };
  trip:     { id: string; status: string; departureScheduled: string | null; routeLabel: string; busPlate: string | null } | null;
  traveler: { id: string; status: string } | null;
  nextAction: TicketNextAction;
}

interface ParcelLookup {
  kind:   'PARCEL';
  parcel: { id: string; trackingCode: string; weight: number; status: string; destinationCity: string | null };
  trip:   { id: string; status: string; departureScheduled: string | null; routeLabel: string; busPlate: string | null } | null;
  nextAction: ParcelNextAction;
}

type Lookup = TicketLookup | ParcelLookup;
type ToastKind = 'success' | 'error' | 'info';
interface Toast { kind: ToastKind; message: string }

// ─── Code extraction ──────────────────────────────────────────────────────
// Les QR imprimés encodent une URL publique de vérification :
//   Billet : /verify/ticket/:id?q=HMAC
//   Colis  : /verify/parcel/:trackingCode
// Les endpoints `/scan/ticket?code` et `/scan/parcel?code` acceptent id, qrCode
// ou trackingCode. On extrait le meilleur candidat selon le format détecté.

function extractTicketCode(raw: string): string {
  const m = raw.match(/\/verify\/ticket\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : raw.trim();
}

function extractParcelCode(raw: string): string {
  const m = raw.match(/\/verify\/parcel\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : raw.trim();
}

function isTicketUrl(raw: string): boolean { return /\/verify\/ticket\//.test(raw); }
function isParcelUrl(raw: string): boolean { return /\/verify\/parcel\//.test(raw); }

// ─── Action metadata (même schéma que StationAgentApp pour cohérence UX) ─

const TICKET_META: Record<TicketNextAction, { tone: 'ok' | 'warn' | 'error'; icon: string; labelKey: string; cta?: 'CHECK_IN' | 'BOARD' }> = {
  CHECK_IN:           { tone: 'ok',    icon: '✓', labelKey: 'quaiScan.statusCheckInReady',  cta: 'CHECK_IN' },
  BOARD:              { tone: 'ok',    icon: '→', labelKey: 'quaiScan.statusReadyToBoard',  cta: 'BOARD' },
  ALREADY_CHECKED_IN: { tone: 'warn',  icon: '✓', labelKey: 'quaiScan.statusAlreadyCheckedIn' },
  ALREADY_BOARDED:    { tone: 'warn',  icon: '⚠', labelKey: 'quaiScan.statusAlreadyBoarded' },
  TICKET_CANCELLED:   { tone: 'error', icon: '✕', labelKey: 'quaiScan.statusCancelled' },
  TICKET_EXPIRED:     { tone: 'error', icon: '⏱', labelKey: 'quaiScan.statusExpired' },
  TICKET_PENDING:     { tone: 'warn',  icon: '⏸', labelKey: 'quaiScan.statusPending' },
};

const PARCEL_META: Record<ParcelNextAction, { tone: 'ok' | 'warn' | 'error'; icon: string; labelKey: string; cta?: 'LOAD' | 'ARRIVE' | 'DELIVER'; ctaKey?: string }> = {
  PACK:              { tone: 'warn',  icon: '?',  labelKey: 'quaiScan.parcelNotReady' },
  NEEDS_SHIPMENT:    { tone: 'warn',  icon: '📋', labelKey: 'quaiScan.parcelNeedsShipment' },
  LOAD:              { tone: 'ok',    icon: '✓',  labelKey: 'quaiScan.parcelReadyLoad',   cta: 'LOAD',    ctaKey: 'quaiScan.ctaLoad' },
  ALREADY_LOADED:    { tone: 'warn',  icon: '⏳', labelKey: 'quaiScan.parcelAlreadyLoaded' },
  ARRIVE:            { tone: 'ok',    icon: '→',  labelKey: 'quaiScan.parcelInTransit',   cta: 'ARRIVE',  ctaKey: 'quaiScan.ctaArrive' },
  DELIVER:           { tone: 'ok',    icon: '📬', labelKey: 'quaiScan.parcelArrived',     cta: 'DELIVER', ctaKey: 'quaiScan.ctaDeliver' },
  ALREADY_DELIVERED: { tone: 'warn',  icon: '✓✓', labelKey: 'quaiScan.parcelDelivered' },
  CANCELLED:         { tone: 'error', icon: '✕',  labelKey: 'quaiScan.parcelCancelled' },
};

const TONE_CLS: Record<'ok' | 'warn' | 'error', string> = {
  ok:    'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200',
  warn:  'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-700 text-amber-900 dark:text-amber-200',
  error: 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-700 text-red-900 dark:text-red-200',
};

// ─── Composant ────────────────────────────────────────────────────────────

interface ScanCapabilities {
  canCheckIn: boolean;
  canBoard:   boolean;
}

export function PageQuaiScan() {
  const { t }    = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const [detectedCode, setDetectedCode] = useState<string | null>(null);
  const [lookup, setLookup]             = useState<Lookup | null>(null);
  const [busy, setBusy]                 = useState(false);
  const [toast, setToast]               = useState<Toast | null>(null);
  const [error, setError]               = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Capabilities : dit quelles actions le user a le droit de faire (perm + blueprint).
  // null = pas encore chargé ; {canCheckIn:false,canBoard:false} = rien de permis.
  const [caps, setCaps] = useState<ScanCapabilities | null>(null);
  // Mode courant : par défaut check-in (comportement agent gare classique).
  // L'utilisateur peut basculer sur 'board' si caps.canBoard = true.
  const [mode, setMode] = useState<'check-in' | 'board'>('check-in');

  useEffect(() => {
    if (!tenantId) return;
    void apiGet<ScanCapabilities>(`/api/tenants/${tenantId}/scan/capabilities`)
      .then(setCaps)
      .catch(() => setCaps({ canCheckIn: true, canBoard: false })); // fallback safe
  }, [tenantId]);

  const showToast = useCallback((kind: ToastKind, message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ kind, message });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const reset = useCallback(() => {
    setDetectedCode(null);
    setLookup(null);
    setError(null);
  }, []);

  /**
   * Appelle /scan/ticket OU /scan/parcel. Si le code est une URL reconnue
   * (`/verify/ticket/...` ou `/verify/parcel/...`), on appelle directement le
   * bon endpoint. Sinon on tente `ticket` puis `parcel` pour trouver l'entité.
   *
   * `forceKind` : bypass la détection auto (utile pour les boutons fallback).
   */
  const lookupCode = useCallback(async (code: string, forceKind?: 'ticket' | 'parcel') => {
    if (!tenantId || !code) return;
    setBusy(true);
    setError(null);
    setLookup(null);
    try {
      const tryTicket = forceKind !== 'parcel' && (forceKind === 'ticket' || isTicketUrl(code) || !isParcelUrl(code));
      const tryParcel = forceKind !== 'ticket' && (forceKind === 'parcel' || isParcelUrl(code) || !isTicketUrl(code));

      if (tryTicket) {
        try {
          // L'intent est dicté par le mode courant (check-in ou board). Le
          // mode board n'est proposé dans l'UI que si caps.canBoard (permission
          // + blueprint actif) — donc pas de chemin de triche côté client.
          const res = await apiGet<TicketLookup>(
            `/api/tenants/${tenantId}/scan/ticket?code=${encodeURIComponent(extractTicketCode(code))}&intent=${mode}`,
          );
          setLookup(res);
          return;
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 404 || !tryParcel) throw e;
        }
      }
      if (tryParcel) {
        const res = await apiGet<ParcelLookup>(
          `/api/tenants/${tenantId}/scan/parcel?code=${encodeURIComponent(extractParcelCode(code))}`,
        );
        setLookup(res);
        return;
      }
      throw new Error(t('quaiScan.errNotFound'));
    } catch (e) {
      const msg = e instanceof ApiError
        ? String((e.body as { message?: string })?.message ?? e.message)
        : e instanceof Error ? e.message : String(e);
      setError(msg);
      showToast('error', msg);
    } finally {
      setBusy(false);
    }
  }, [tenantId, mode, showToast, t]);

  /** Appelé par QrScannerWeb à chaque détection (caméra ou saisie manuelle). */
  const handleDetected = useCallback((code: string) => {
    setDetectedCode(code);
    void lookupCode(code);
  }, [lookupCode]);

  /** Exécute la transition associée au `nextAction` courant. */
  const runAction = useCallback(async () => {
    if (!lookup) return;
    setBusy(true);
    try {
      if (lookup.kind === 'TICKET') {
        if (!lookup.trip) throw new Error(t('quaiScan.errNoTrip'));
        const meta = TICKET_META[lookup.nextAction];
        if (!meta.cta) return;
        const url = meta.cta === 'CHECK_IN'
          ? `/api/tenants/${tenantId}/flight-deck/trips/${lookup.trip.id}/passengers/${lookup.ticket.id}/check-in`
          : `/api/tenants/${tenantId}/flight-deck/trips/${lookup.trip.id}/passengers/${lookup.ticket.id}/board`;
        const idempotencyKey = `${meta.cta === 'CHECK_IN' ? 'check-in' : 'board'}:${lookup.ticket.id}`;
        const headers = { 'idempotency-key': idempotencyKey };
        if (meta.cta === 'CHECK_IN') {
          await apiPost(url, {}, { headers });
        } else {
          await apiPatch(url, {}, { headers });
        }
        showToast('success', meta.cta === 'CHECK_IN'
          ? t('quaiScan.toastCheckInOk')
          : t('quaiScan.toastBoardOk'));
      } else {
        const meta = PARCEL_META[lookup.nextAction];
        if (!meta.cta) return;
        const url = `/api/tenants/${tenantId}/parcels/${lookup.parcel.id}/scan`;
        // stationId vide : le backend applique les guards blueprint du tenant.
        // Si le tenant exige un stationId, l'endpoint remontera une 400 claire.
        await apiPost(url, { action: meta.cta, stationId: '' }, {
          headers: { 'idempotency-key': `parcel-${meta.cta}:${lookup.parcel.id}` },
        });
        showToast('success', t('quaiScan.toastParcelOk'));
      }
      reset();
    } catch (e) {
      const msg = e instanceof ApiError
        ? String((e.body as { message?: string })?.message ?? e.message)
        : e instanceof Error ? e.message : String(e);
      showToast('error', msg);
    } finally {
      setBusy(false);
    }
  }, [lookup, tenantId, showToast, t, reset]);

  // ── Rendu ────────────────────────────────────────────────────────────
  return (
    <main className="p-4 sm:p-6 space-y-6 max-w-lg mx-auto" role="main">
      <header className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30 shrink-0">
          <ScanLine className="w-5 h-5 text-purple-600 dark:text-purple-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold t-text">{t('quaiScan.title')}</h1>
          <p className="text-sm t-text-2 mt-0.5">{t('quaiScan.subtitle')}</p>
        </div>
      </header>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'rounded-lg border-2 px-4 py-3 font-semibold text-sm shadow-sm',
            toast.kind === 'success' && 'bg-emerald-600 border-emerald-500 text-white',
            toast.kind === 'error'   && 'bg-red-600 border-red-500 text-white',
            toast.kind === 'info'    && 'bg-slate-700 border-slate-600 text-white',
          )}
        >
          {toast.message}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-4">
        <ErrorAlert error={error} icon />

        {/* Mode toggle — visible uniquement si l'utilisateur a à la fois
            la permission check-in ET la permission board + blueprint actif.
            Sinon on force check-in (comportement agent gare) ou board (driver)
            sans laisser le choix — pas d'option "fausse" qui échouerait au scan. */}
        {caps?.canCheckIn && caps?.canBoard && (
          <div
            role="radiogroup"
            aria-label={t('quaiScan.modeLabel')}
            className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-1"
          >
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'check-in'}
              onClick={() => setMode('check-in')}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-semibold transition-colors inline-flex items-center gap-1.5',
                mode === 'check-in'
                  ? 'bg-emerald-600 text-white'
                  : 't-text-2 hover:bg-slate-100 dark:hover:bg-slate-800',
              )}
            >
              <Ticket className="w-3.5 h-3.5" aria-hidden />
              {t('quaiScan.modeCheckIn')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'board'}
              onClick={() => setMode('board')}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-semibold transition-colors inline-flex items-center gap-1.5',
                mode === 'board'
                  ? 'bg-teal-600 text-white'
                  : 't-text-2 hover:bg-slate-100 dark:hover:bg-slate-800',
              )}
            >
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
              {t('quaiScan.modeBoard')}
            </button>
          </div>
        )}

        <QrScannerWeb
          onDetected={handleDetected}
          manualPlaceholder={t('quaiScan.codePh')}
        />
        <p className="text-xs t-text-3">{t('quaiScan.codeHint')}</p>

        {/* Résultat du lookup — carte d'action */}
        {lookup && lookup.kind === 'TICKET' && (() => {
          const meta = TICKET_META[lookup.nextAction];
          return (
            <div className={cn('rounded-xl border p-4 space-y-3', TONE_CLS[meta.tone])}>
              <div className="flex items-center gap-3">
                <span className="text-3xl" aria-hidden>{meta.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-black uppercase text-sm tracking-wide">{t(meta.labelKey)}</p>
                  <p className="text-xs opacity-80">{t('quaiScan.kindTicket')}</p>
                </div>
              </div>
              <dl className="text-sm space-y-1">
                <DtDd label={t('quaiScan.passenger')} value={lookup.ticket.passengerName} />
                {lookup.trip      && <DtDd label={t('quaiScan.trip')} value={lookup.trip.routeLabel} />}
                {lookup.ticket.seatNumber && <DtDd label={t('quaiScan.seat')} value={lookup.ticket.seatNumber} />}
                {lookup.traveler  && <DtDd label={t('quaiScan.currentState')} value={lookup.traveler.status} />}
              </dl>
              {meta.cta && (
                <Button onClick={runAction} disabled={busy} className="w-full min-h-[44px] justify-center"
                  leftIcon={<CheckCircle2 className="w-4 h-4" aria-hidden />}>
                  {busy ? '…' : t(meta.cta === 'CHECK_IN' ? 'quaiScan.ctaCheckIn' : 'quaiScan.ctaBoard')}
                </Button>
              )}
              <Button onClick={reset} variant="outline" className="w-full min-h-[40px] justify-center"
                leftIcon={<RotateCcw className="w-4 h-4" aria-hidden />}>
                {t('quaiScan.scanNext')}
              </Button>
            </div>
          );
        })()}

        {lookup && lookup.kind === 'PARCEL' && (() => {
          const meta = PARCEL_META[lookup.nextAction];
          return (
            <div className={cn('rounded-xl border p-4 space-y-3', TONE_CLS[meta.tone])}>
              <div className="flex items-center gap-3">
                <span className="text-3xl" aria-hidden>{meta.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-black uppercase text-sm tracking-wide">{t(meta.labelKey)}</p>
                  <p className="text-xs opacity-80">{t('quaiScan.kindParcel')}</p>
                </div>
              </div>
              <dl className="text-sm space-y-1">
                <DtDd label={t('quaiScan.trackingCode')} value={lookup.parcel.trackingCode} />
                {lookup.parcel.destinationCity && <DtDd label={t('quaiScan.destination')} value={lookup.parcel.destinationCity} />}
                <DtDd label={t('quaiScan.weight')} value={`${lookup.parcel.weight} kg`} />
                <DtDd label={t('quaiScan.currentState')} value={lookup.parcel.status} />
                {lookup.trip && <DtDd label={t('quaiScan.trip')} value={lookup.trip.routeLabel} />}
              </dl>
              {meta.cta && meta.ctaKey && (
                <Button onClick={runAction} disabled={busy} className="w-full min-h-[44px] justify-center"
                  leftIcon={<CheckCircle2 className="w-4 h-4" aria-hidden />}>
                  {busy ? '…' : t(meta.ctaKey)}
                </Button>
              )}
              <Button onClick={reset} variant="outline" className="w-full min-h-[40px] justify-center"
                leftIcon={<RotateCcw className="w-4 h-4" aria-hidden />}>
                {t('quaiScan.scanNext')}
              </Button>
            </div>
          );
        })()}

        {/* Fallback manuel : visible uniquement si un code a été détecté mais
            que la détection auto a échoué (lookup=null && !busy && code présent). */}
        {detectedCode && !lookup && !busy && error && (
          <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <p className="text-xs t-text-3">{t('quaiScan.fallbackHint')}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline"
                onClick={() => lookupCode(detectedCode, 'ticket')}
                className="min-h-[40px] justify-center"
                leftIcon={<Ticket className="w-4 h-4" aria-hidden />}>
                {t('quaiScan.asTicket')}
              </Button>
              <Button variant="outline"
                onClick={() => lookupCode(detectedCode, 'parcel')}
                className="min-h-[40px] justify-center"
                leftIcon={<Package className="w-4 h-4" aria-hidden />}>
                {t('quaiScan.asParcel')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function DtDd({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-sm">
      <dt className="opacity-70 min-w-24">{label}</dt>
      <dd className="font-semibold flex-1 break-all">{value}</dd>
    </div>
  );
}
