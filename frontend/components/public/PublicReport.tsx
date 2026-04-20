/**
 * PublicReport — Portail citoyen simple pour signaler (dénoncer) un incident.
 *
 * Public, sans authentification — tenantId résolu depuis le sous-domaine
 * (backend : TenantHostMiddleware → req.resolvedHostTenant).
 *
 * Endpoints :
 *   GET  /api/public/report/tenant-info
 *   POST /api/public/report                (rate-limit 5/h/IP côté serveur)
 *
 * UX :
 *   - Mobile-first (le citoyen est presque toujours au téléphone)
 *   - Light mode first + dark: compatible
 *   - Formulaire minimal : plaque, type, description (+ GPS facultatif)
 *   - Confirmation avec id de référence pour suivi
 *   - RGPD : mention explicite GPS supprimé sous 24 h
 *   - i18n : toutes les chaînes via t()
 *   - A11y : aria-required, aria-describedby, focus visible, erreurs annoncées
 */

import { useState, useEffect, useId } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Shield, MapPin } from 'lucide-react';
import { useI18n } from '../../lib/i18n/useI18n';
import { apiGet, apiPost, ApiError } from '../../lib/api';
import { PublicLayout } from './PublicLayout';
import { CaptchaWidget } from '../ui/CaptchaWidget';

const REPORT_TYPES = ['DANGEROUS_DRIVING', 'ACCIDENT', 'BREAKDOWN', 'OTHER'] as const;
type ReportType = (typeof REPORT_TYPES)[number];

interface TenantInfo {
  tenantId: string;
  slug:     string | null;
}

interface SubmitResult {
  id:                string;
  status:            string;
  verificationScore: number;
}

export function PublicReport() {
  const { t } = useI18n();
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [tenantError, setTenantError] = useState<string | null>(null);

  const [plate,        setPlate]        = useState('');
  const [type,         setType]         = useState<ReportType>('DANGEROUS_DRIVING');
  const [description,  setDescription]  = useState('');
  const [useGps,       setUseGps]       = useState(false);
  const [captcha,      setCaptcha]      = useState<string | null>(null);
  const [gps,          setGps]          = useState<{ lat: number; lng: number } | null>(null);
  const [busy,         setBusy]         = useState(false);
  const [formError,    setFormError]    = useState<string | null>(null);
  const [result,       setResult]       = useState<SubmitResult | null>(null);

  const plateId = useId();
  const typeId  = useId();
  const descId  = useId();
  const descHintId = useId();

  // ── Résolution du tenant courant depuis le host ──
  useEffect(() => {
    apiGet<TenantInfo>('/api/public/report/tenant-info', { skipRedirectOn401: true })
      .then(setTenant)
      .catch((err: unknown) => {
        setTenantError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  // ── Géolocalisation : opt-in, 15 s max, échec silencieux ──
  useEffect(() => {
    if (!useGps || typeof navigator === 'undefined' || !navigator.geolocation) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      pos => {
        if (cancelled) return;
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => { /* refus utilisateur ou GPS indispo → on continue sans */ },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
    return () => { cancelled = true; };
  }, [useGps]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tenant) return;
    if (plate.trim().length < 2)       { setFormError(t('publicReport.errorPlate'));       return; }
    if (description.trim().length < 10) { setFormError(t('publicReport.errorDescription')); return; }

    setBusy(true);
    setFormError(null);
    try {
      const res = await apiPost<SubmitResult>('/api/public/report', {
        plateOrParkNumber: plate.trim().toUpperCase(),
        type,
        description:       description.trim(),
        reporterGpsLat:    useGps && gps ? gps.lat : undefined,
        reporterGpsLng:    useGps && gps ? gps.lng : undefined,
      }, { skipRedirectOn401: true, captchaToken: captcha });
      setResult(res);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setFormError(t('publicReport.errorRateLimit'));
      } else {
        setFormError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  // ── Écran de confirmation ──
  if (result) {
    return (
      <PublicLayout>
        <section className="mx-auto max-w-xl px-4 py-12 sm:py-16">
          <div
            role="status"
            aria-live="polite"
            className="rounded-xl border border-teal-200 bg-teal-50 p-6 md:p-8 dark:border-teal-900 dark:bg-teal-950/30"
          >
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-teal-600 dark:text-teal-400" aria-hidden />
            <h1 className="text-center text-xl md:text-2xl font-bold text-slate-900 dark:text-white">
              {t('publicReport.thankTitle')}
            </h1>
            <p className="mt-2 text-center text-sm text-slate-700 dark:text-slate-300">
              {t('publicReport.thankDesc')}
            </p>
            <dl className="mt-5 grid grid-cols-1 gap-2 text-sm">
              <div className="flex justify-between border-b border-teal-200 dark:border-teal-900 pb-1">
                <dt className="text-slate-600 dark:text-slate-400">{t('publicReport.referenceId')}</dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100">{result.id.slice(0, 8)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600 dark:text-slate-400">{t('publicReport.status')}</dt>
                <dd className="text-slate-900 dark:text-slate-100">{t(`publicReport.statusVal_${result.status}`)}</dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setPlate('');
                setDescription('');
                setType('DANGEROUS_DRIVING');
                setGps(null);
                setUseGps(false);
              }}
              className="mt-6 block w-full rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              {t('publicReport.submitAnother')}
            </button>
          </div>
        </section>
      </PublicLayout>
    );
  }

  // ── Formulaire principal ──
  return (
    <PublicLayout>
      <section className="mx-auto max-w-xl px-4 py-8 sm:py-12">
        <header className="mb-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-red-50 dark:bg-red-950/30 px-3 py-1 text-xs font-semibold text-red-700 dark:text-red-300">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {t('publicReport.pill')}
          </div>
          <h1 className="mt-3 text-2xl md:text-3xl font-bold text-slate-900 dark:text-white">
            {t('publicReport.title')}
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {t('publicReport.lede')}
          </p>
        </header>

        {tenantError && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
          >
            {t('publicReport.errorUnknownDomain')}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 md:p-6 shadow-sm"
          aria-busy={busy}
        >
          {/* Plaque */}
          <div>
            <label htmlFor={plateId} className="block text-sm font-medium text-slate-800 dark:text-slate-200">
              {t('publicReport.plateLabel')}{' '}
              <span aria-hidden className="text-red-600">*</span>
            </label>
            <input
              id={plateId}
              type="text"
              required
              aria-required="true"
              value={plate}
              onChange={e => setPlate(e.target.value)}
              placeholder={t('publicReport.platePlaceholder')}
              className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-base uppercase tracking-wide focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
              autoComplete="off"
              inputMode="text"
            />
          </div>

          {/* Type */}
          <div>
            <label htmlFor={typeId} className="block text-sm font-medium text-slate-800 dark:text-slate-200">
              {t('publicReport.typeLabel')}{' '}
              <span aria-hidden className="text-red-600">*</span>
            </label>
            <select
              id={typeId}
              required
              aria-required="true"
              value={type}
              onChange={e => setType(e.target.value as ReportType)}
              className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-base focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              {REPORT_TYPES.map(v => (
                <option key={v} value={v}>{t(`publicReport.typeVal_${v}`)}</option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label htmlFor={descId} className="block text-sm font-medium text-slate-800 dark:text-slate-200">
              {t('publicReport.descriptionLabel')}{' '}
              <span aria-hidden className="text-red-600">*</span>
            </label>
            <textarea
              id={descId}
              required
              aria-required="true"
              aria-describedby={descHintId}
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              minLength={10}
              maxLength={1_000}
              placeholder={t('publicReport.descriptionPlaceholder')}
              className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-base focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <p id={descHintId} className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('publicReport.descriptionHint')} — {description.length}/1000
            </p>
          </div>

          {/* GPS opt-in */}
          <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={useGps}
                onChange={e => setUseGps(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm">
                <span className="inline-flex items-center gap-1 font-medium text-slate-800 dark:text-slate-200">
                  <MapPin className="h-4 w-4" aria-hidden />
                  {t('publicReport.gpsLabel')}
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {t('publicReport.gpsHint')}
                </span>
                {useGps && gps && (
                  <span className="block text-xs text-teal-700 dark:text-teal-400 mt-1">
                    {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
                  </span>
                )}
              </span>
            </label>
          </div>

          {/* Erreur globale */}
          {formError && (
            <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
              {formError}
            </p>
          )}

          {/* CAPTCHA (silencieux si pas de site-key) */}
          <CaptchaWidget onToken={setCaptcha} />

          {/* Actions */}
          <button
            type="submit"
            disabled={busy || !tenant}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-red-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-red-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {busy ? t('publicReport.submitting') : t('publicReport.submit')}
          </button>

          {/* Mention RGPD */}
          <p className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Shield className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
            <span>{t('publicReport.rgpdNotice')}</span>
          </p>
        </form>
      </section>
    </PublicLayout>
  );
}
