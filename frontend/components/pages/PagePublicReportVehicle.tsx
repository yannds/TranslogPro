/**
 * PagePublicReportVehicle — Module U PRD : portail citoyen de signalement.
 *
 * Page publique sans authentification. Permet à un citoyen de signaler un
 * véhicule (immatriculation ou numéro de parc) pour conduite dangereuse,
 * accident, panne, etc.
 *
 * Endpoints :
 *   - POST /api/public/report      (tenantId résolu via Host header)
 *   - POST /api/public/:tid/report (tenantId via path — fallback / lien direct)
 *
 * Sécurité (PRD §IV.16) :
 *   - Rate-limit 5 signalements / heure / IP (backend)
 *   - CAPTCHA Cloudflare Turnstile (CaptchaWidget)
 *   - Validation géo-temporelle côté backend (correlation)
 *   - Aucune session, aucune PII attendue côté serveur (sauf GPS optionnel)
 *
 * Qualité : i18n fr+en, WCAG AA, mobile-first (cible : citoyens en mobilité),
 * dark+light, security first.
 */
import { useState, type FormEvent } from 'react';
import { ShieldAlert, MapPin, Send, Check } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useI18n, tm } from '../../lib/i18n/useI18n';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import { ErrorAlert } from '../ui/ErrorAlert';
import { CaptchaWidget } from '../ui/CaptchaWidget';

const REPORT_TYPES = ['DANGEROUS_DRIVING', 'ACCIDENT', 'BREAKDOWN', 'OTHER'] as const;
type ReportType = typeof REPORT_TYPES[number];

const PLATE_MIN_LEN = 3;
const DESCRIPTION_MIN_LEN = 10;
const DESCRIPTION_MAX_LEN = 1000;

interface DraftReport {
  plateOrParkNumber: string;
  type:              ReportType;
  description:       string;
  reporterGpsLat:    number | null;
  reporterGpsLng:    number | null;
}

const EMPTY_DRAFT: DraftReport = {
  plateOrParkNumber: '',
  type:              'DANGEROUS_DRIVING',
  description:       '',
  reporterGpsLat:    null,
  reporterGpsLng:    null,
};

export function PagePublicReportVehicle() {
  const { t } = useI18n();

  const [draft, setDraft] = useState<DraftReport>({ ...EMPTY_DRAFT });
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);

  const T = {
    title:        t(tm('Signaler un véhicule', 'Report a vehicle')),
    subtitle:     t(tm('Aidez à améliorer la sécurité du transport public. Votre signalement reste anonyme.',
                       'Help improve public transport safety. Your report stays anonymous.')),
    plateLabel:   t(tm('Immatriculation ou numéro de parc', 'Plate number or fleet ID')),
    platePlaceholder: t(tm('ex. CG-AB-1234 ou BUS-042', 'e.g. CG-AB-1234 or BUS-042')),
    typeLabel:    t(tm('Type d\'incident', 'Incident type')),
    typeDangerous: t(tm('Conduite dangereuse', 'Dangerous driving')),
    typeAccident:  t(tm('Accident', 'Accident')),
    typeBreakdown: t(tm('Panne / blocage de la route', 'Breakdown / road block')),
    typeOther:     t(tm('Autre', 'Other')),
    descLabel:    t(tm('Description (lieu, heure, faits)', 'Description (location, time, facts)')),
    descHint:     t(tm('10 à 1000 caractères. Restez factuel.',
                       '10 to 1000 characters. Stick to facts.')),
    gpsBtn:       t(tm('Joindre ma position actuelle (facultatif)',
                       'Attach my current location (optional)')),
    gpsAttached:  t(tm('Position attachée', 'Location attached')),
    gpsBusy:      t(tm('Localisation en cours…', 'Locating…')),
    gpsError:     t(tm('Position non disponible (autorisation refusée ?)',
                       'Location unavailable (permission denied?)')),
    submit:       t(tm('Envoyer le signalement', 'Send report')),
    submitting:   t(tm('Envoi en cours…', 'Sending…')),
    successTitle: t(tm('Merci pour votre signalement.', 'Thank you for your report.')),
    successText:  t(tm('Notre équipe sécurité va examiner votre alerte. En cas d\'urgence, contactez le 112 / 117.',
                       'Our safety team will review your alert. In case of emergency, dial 112 / 911.')),
    newReport:    t(tm('Faire un autre signalement', 'Submit another report')),
    plateError:   t(tm('Veuillez saisir une immatriculation valide.', 'Please enter a valid plate number.')),
    descError:    t(tm('La description doit contenir entre 10 et 1000 caractères.',
                       'Description must be between 10 and 1000 characters.')),
    privacy:      t(tm('Confidentialité : vos données GPS sont supprimées sous 24h (RGPD).',
                       'Privacy: your GPS data is deleted within 24h (GDPR-compliant).')),
  };

  const typeOptions = [
    { value: 'DANGEROUS_DRIVING', label: T.typeDangerous },
    { value: 'ACCIDENT',          label: T.typeAccident  },
    { value: 'BREAKDOWN',         label: T.typeBreakdown },
    { value: 'OTHER',             label: T.typeOther     },
  ];

  const captureGps = () => {
    if (!('geolocation' in navigator)) {
      setSubmitError(T.gpsError);
      return;
    }
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDraft({
          ...draft,
          reporterGpsLat: pos.coords.latitude,
          reporterGpsLng: pos.coords.longitude,
        });
        setGpsBusy(false);
      },
      () => {
        setSubmitError(T.gpsError);
        setGpsBusy(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (draft.plateOrParkNumber.trim().length < PLATE_MIN_LEN) {
      setSubmitError(T.plateError);
      return;
    }
    const desc = draft.description.trim();
    if (desc.length < DESCRIPTION_MIN_LEN || desc.length > DESCRIPTION_MAX_LEN) {
      setSubmitError(T.descError);
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        plateOrParkNumber: draft.plateOrParkNumber.trim(),
        type:              draft.type,
        description:       desc,
      };
      if (draft.reporterGpsLat !== null && draft.reporterGpsLng !== null) {
        body.reporterGpsLat = draft.reporterGpsLat;
        body.reporterGpsLng = draft.reporterGpsLng;
      }
      // Endpoint Host-resolved (tenantId via TenantHostMiddleware).
      // Le sub-domaine du portail public a déjà résolu le tenant.
      await apiFetch('/api/public/report', {
        method:        'POST',
        body,
        captchaToken,
      });
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setDraft({ ...EMPTY_DRAFT });
    setSubmitted(false);
    setSubmitError(null);
    setCaptchaToken(null);
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-950">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-6 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center mb-4">
            <Check className="w-6 h-6 text-green-700 dark:text-green-400" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">{T.successTitle}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">{T.successText}</p>
          <Button onClick={reset} variant="outline">{T.newReport}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 bg-slate-50 dark:bg-slate-950 py-10">
      <div className="max-w-md mx-auto">
        <header className="mb-6 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center mb-3">
            <ShieldAlert className="w-6 h-6 text-amber-700 dark:text-amber-400" aria-hidden />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{T.title}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">{T.subtitle}</p>
        </header>

        <form
          onSubmit={submit}
          className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-5 space-y-4"
          aria-label={T.title}
        >
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="plate">{T.plateLabel}</label>
            <Input
              id="plate"
              required
              placeholder={T.platePlaceholder}
              value={draft.plateOrParkNumber}
              onChange={(e) => setDraft({ ...draft, plateOrParkNumber: e.target.value.toUpperCase() })}
              autoCapitalize="characters"
              minLength={PLATE_MIN_LEN}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="type">{T.typeLabel}</label>
            <Select
              id="type"
              value={draft.type}
              onChange={(e) => setDraft({ ...draft, type: e.target.value as ReportType })}
              options={typeOptions}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="desc">{T.descLabel}</label>
            <Textarea
              id="desc"
              required
              rows={4}
              minLength={DESCRIPTION_MIN_LEN}
              maxLength={DESCRIPTION_MAX_LEN}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{T.descHint}</p>
          </div>

          <div>
            {draft.reporterGpsLat !== null && draft.reporterGpsLng !== null ? (
              <p className="inline-flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400">
                <Check className="w-4 h-4" aria-hidden /> {T.gpsAttached}
              </p>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={captureGps}
                disabled={gpsBusy}
                loading={gpsBusy}
              >
                <MapPin className="w-4 h-4 mr-1.5" aria-hidden />
                {gpsBusy ? T.gpsBusy : T.gpsBtn}
              </Button>
            )}
          </div>

          <CaptchaWidget onToken={setCaptchaToken} />

          {submitError && <ErrorAlert error={submitError} icon />}

          <Button type="submit" className="w-full" disabled={submitting} loading={submitting}>
            <Send className="w-4 h-4 mr-1.5" aria-hidden />
            {submitting ? T.submitting : T.submit}
          </Button>

          <p className="text-xs text-slate-500 dark:text-slate-400 text-center">{T.privacy}</p>
        </form>
      </div>
    </div>
  );
}
