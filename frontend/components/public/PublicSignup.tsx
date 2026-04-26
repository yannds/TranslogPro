/**
 * PublicSignup — Wizard public d'inscription SaaS (3 étapes).
 *
 * Flux :
 *   Étape 1 — Admin (name, email, password)
 *   Étape 2 — Company (name, slug auto-dérivé, country, activity)
 *   Étape 3 — Plan (sélection depuis /api/public/plans)
 *
 * À la soumission → POST /api/public/signup → redirection vers le
 * sous-domaine tenant `{slug}.translogpro.com/login` avec un message de
 * succès. Aucune carte bancaire, trial 30 j par défaut.
 *
 * Anti-abus : honeypot `company_website`, rate-limit 3/h/IP côté backend,
 * validation stricte côté DTO.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight, ArrowLeft, Check, Loader2, AlertTriangle,
  User, Building2, Package, Ticket, Shuffle, Star, ExternalLink,
} from 'lucide-react';
import { PublicLayout } from './PublicLayout';
import { useI18n } from '../../lib/i18n/useI18n';
import { apiFetch, ApiError } from '../../lib/api';
import { CaptchaWidget } from '../ui/CaptchaWidget';
import { newIdempotencyKey } from '../../lib/captcha/useTurnstile';
import { cn } from '../../lib/utils';
import { PLATFORM_BASE_DOMAIN } from '../../lib/tenancy/host';

// ─── Types ───────────────────────────────────────────────────────────────────

type Activity = 'TICKETING' | 'PARCELS' | 'MIXED';

interface PublicPlan {
  id:           string;
  slug:         string;
  name:         string;
  description:  string | null;
  price:        number;
  currency:     string;
  billingCycle: string;
  trialDays:    number;
  limits:       unknown;
  sortOrder:    number;
}

// Pays supportés — synchronisé avec COUNTRY_DEFAULTS côté backend onboarding.
const COUNTRIES: Array<{ code: string; name: { fr: string; en: string } }> = [
  { code: 'CG', name: { fr: 'Congo (Brazzaville)', en: 'Congo (Brazzaville)' } },
  { code: 'CD', name: { fr: 'RD Congo',             en: 'DR Congo' } },
  { code: 'CM', name: { fr: 'Cameroun',             en: 'Cameroon' } },
  { code: 'GA', name: { fr: 'Gabon',                en: 'Gabon' } },
  { code: 'SN', name: { fr: 'Sénégal',              en: 'Senegal' } },
  { code: 'CI', name: { fr: "Côte d'Ivoire",        en: "Côte d'Ivoire" } },
  { code: 'ML', name: { fr: 'Mali',                 en: 'Mali' } },
  { code: 'BF', name: { fr: 'Burkina Faso',         en: 'Burkina Faso' } },
  { code: 'NE', name: { fr: 'Niger',                en: 'Niger' } },
  { code: 'TG', name: { fr: 'Togo',                 en: 'Togo' } },
  { code: 'BJ', name: { fr: 'Bénin',                en: 'Benin' } },
  { code: 'GN', name: { fr: 'Guinée',               en: 'Guinea' } },
  { code: 'NG', name: { fr: 'Nigéria',              en: 'Nigeria' } },
  { code: 'GH', name: { fr: 'Ghana',                en: 'Ghana' } },
  { code: 'MA', name: { fr: 'Maroc',                en: 'Morocco' } },
  { code: 'TN', name: { fr: 'Tunisie',              en: 'Tunisia' } },
  { code: 'KE', name: { fr: 'Kenya',                en: 'Kenya' } },
  { code: 'FR', name: { fr: 'France',               en: 'France' } },
];

// ─── Shell ───────────────────────────────────────────────────────────────────

export function PublicSignup() {
  return (
    <PublicLayout>
      <SignupWizard />
    </PublicLayout>
  );
}

// ─── Wizard ──────────────────────────────────────────────────────────────────

function SignupWizard() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedPlan = searchParams.get('plan') ?? undefined;

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Form state ----------------------------------------------------------------
  const [adminName,     setAdminName]     = useState('');
  const [adminEmail,    setAdminEmail]    = useState('');
  const [password,      setPassword]      = useState('');

  const [companyName,   setCompanyName]   = useState('');
  const [slug,          setSlug]          = useState('');
  const [slugTouched,   setSlugTouched]   = useState(false);
  const [country,       setCountry]       = useState('CG');
  const [activity,      setActivity]      = useState<Activity>('TICKETING');

  const [planSlug,      setPlanSlug]      = useState<string | undefined>(preselectedPlan);
  const [honeypot,      setHoneypot]      = useState(''); // doit rester vide
  const [captcha,       setCaptcha]       = useState<string | null>(null);

  // Field-level errors (client side) ------------------------------------------
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting,  setSubmitting]  = useState(false);

  // Success state -------------------------------------------------------------
  const [success, setSuccess] = useState<null | {
    slug: string;
    trialDays: number;
  }>(null);

  // Auto-slug depuis companyName jusqu'à ce que l'utilisateur édite le slug.
  useEffect(() => {
    if (slugTouched) return;
    const derived = slugify(companyName);
    setSlug(derived);
  }, [companyName, slugTouched]);

  // Step validators -----------------------------------------------------------
  function validateStep(s: 1 | 2 | 3): boolean {
    const newErrors: Record<string, string> = {};
    if (s === 1) {
      if (adminName.trim().length < 2) newErrors.adminName = t('signup.admin.nameError');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail.trim())) newErrors.adminEmail = t('signup.admin.emailError');
      if (password.length < 8) newErrors.password = t('signup.admin.passwordError');
    }
    if (s === 2) {
      if (companyName.trim().length < 2) newErrors.companyName = t('signup.admin.nameError');
      if (!/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/.test(slug)) newErrors.slug = t('signup.company.slugInvalid');
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function onNext(e?: FormEvent) {
    e?.preventDefault();
    if (!validateStep(step)) return;
    if (step < 3) setStep((step + 1) as 1 | 2 | 3);
    else onSubmit();
  }

  function onBack() {
    if (step > 1) setStep((step - 1) as 1 | 2 | 3);
  }

  async function onSubmit() {
    if (!validateStep(1) || !validateStep(2)) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = {
        adminEmail: adminEmail.trim().toLowerCase(),
        adminName:  adminName.trim(),
        password,
        companyName: companyName.trim(),
        slug,
        country,
        language: lang,
        activity,
        planSlug,
        company_website: honeypot,
      };
      const res = await apiFetch<{
        ok: boolean; tenantSlug: string; trialDays: number;
      }>('/api/public/signup', {
        method: 'POST',
        body:   payload,
        skipRedirectOn401: true,
        captchaToken:      captcha,
        idempotencyKey:    newIdempotencyKey(),
      });
      setSuccess({ slug: res.tenantSlug, trialDays: res.trialDays });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) setSubmitError(t('signup.error.slugTaken'));
        else if (err.status === 429) setSubmitError(t('signup.error.rateLimit'));
        else setSubmitError(t('signup.error.generic'));
      } else {
        setSubmitError(t('signup.error.generic'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Success screen ------------------------------------------------------------
  if (success) {
    return <SuccessScreen slug={success.slug} trialDays={success.trialDays} />;
  }

  // Wizard body ---------------------------------------------------------------
  return (
    <section className="relative overflow-hidden py-12 lg:py-20">
      <div className="absolute inset-0 -z-10" aria-hidden>
        <div className="absolute inset-0 bg-gradient-to-b from-teal-50/60 via-white to-white dark:from-teal-950/40 dark:via-slate-950 dark:to-slate-950" />
      </div>

      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <header className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
            {t('signup.title')}
          </h1>
          <p className="mt-3 text-lg text-slate-600 dark:text-slate-300">{t('signup.tagline')}</p>
        </header>

        <StepIndicator step={step} />

        <form
          onSubmit={onNext}
          className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-800 dark:bg-slate-900"
          noValidate
        >
          {/* Honeypot anti-bot — name volontairement opaque pour neutraliser
              les heuristiques d'autofill (Chrome / 1Password / LastPass). La
              clé JSON envoyée au backend reste `company_website`. */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', top: 'auto', width: '1px', height: '1px', overflow: 'hidden' }}>
            <label htmlFor="trp-hp-field">Ne pas remplir</label>
            <input
              id="trp-hp-field"
              type="text"
              name="trp_hp_field"
              value={honeypot}
              onChange={e => setHoneypot(e.target.value)}
              autoComplete="off"
              tabIndex={-1}
            />
          </div>

          {step === 1 && (
            <StepAdmin
              adminName={adminName} setAdminName={setAdminName}
              adminEmail={adminEmail} setAdminEmail={setAdminEmail}
              password={password} setPassword={setPassword}
              errors={errors} setErrors={setErrors}
            />
          )}
          {step === 2 && (
            <StepCompany
              companyName={companyName} setCompanyName={setCompanyName}
              slug={slug} setSlug={(v) => { setSlug(v); setSlugTouched(true); }}
              country={country} setCountry={setCountry}
              activity={activity} setActivity={setActivity}
              errors={errors} setErrors={setErrors}
            />
          )}
          {step === 3 && (
            <StepPlan
              planSlug={planSlug}
              setPlanSlug={setPlanSlug}
            />
          )}

          {submitError && (
            <div
              role="alert"
              className="mt-6 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{submitError}</span>
            </div>
          )}

          {/* CAPTCHA rendu sur la dernière étape (avant le submit final). */}
          {step === 3 && (
            <div className="mt-4 flex justify-center">
              <CaptchaWidget onToken={setCaptcha} />
            </div>
          )}

          <div className="mt-8 flex items-center justify-between gap-3">
            {step > 1 ? (
              <button
                type="button"
                onClick={onBack}
                disabled={submitting}
                className="inline-flex h-11 items-center gap-1.5 rounded-lg px-4 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus-visible:ring-offset-slate-900"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                {t('signup.back')}
              </button>
            ) : <span />}

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-teal-600 px-6 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 disabled:opacity-60 dark:focus-visible:ring-offset-slate-900"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {t('signup.submitting')}
                </>
              ) : step === 3 ? (
                <>
                  {t('signup.submit')}
                  <Check className="h-4 w-4" aria-hidden />
                </>
              ) : (
                <>
                  {t('signup.continue')}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </>
              )}
            </button>
          </div>

          <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-400">
            {t('signup.terms.prefix')}{' '}
            <a href="#" className="underline hover:text-teal-600 dark:hover:text-teal-400">{t('signup.terms.terms')}</a>
            {' '}{t('signup.terms.and')}{' '}
            <a href="#" className="underline hover:text-teal-600 dark:hover:text-teal-400">{t('signup.terms.privacy')}</a>.
          </p>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400">
          <Link to="/" className="hover:text-teal-600 dark:hover:text-teal-400" onClick={e => { e.preventDefault(); navigate(-1); }}>
            ← {t('landing.nav.product')}
          </Link>
        </p>
      </div>
    </section>
  );
}

// ─── Step indicator ──────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const { t } = useI18n();
  const steps: Array<{ n: 1 | 2 | 3; labelKey: string; Icon: typeof User }> = [
    { n: 1, labelKey: 'signup.stepAdmin',   Icon: User      },
    { n: 2, labelKey: 'signup.stepCompany', Icon: Building2 },
    { n: 3, labelKey: 'signup.stepPlan',    Icon: Star      },
  ];
  return (
    <ol
      className="mt-10 flex items-center justify-center gap-2"
      aria-label={t('signup.aria.stepIndicator')}
    >
      {steps.map(({ n, labelKey, Icon }, i) => {
        const isActive   = n === step;
        const isComplete = n < step;
        return (
          <li key={n} className="flex items-center gap-2">
            <div
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                isActive   && 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300',
                isComplete && 'border-teal-500/50 bg-teal-500/10 text-teal-700 dark:text-teal-300',
                !isActive && !isComplete && 'border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400',
              )}
              aria-current={isActive ? 'step' : undefined}
            >
              {isComplete ? (
                <Check className="h-4 w-4" aria-hidden />
              ) : (
                <Icon className="h-4 w-4" aria-hidden />
              )}
              <span className="hidden sm:inline">{t(labelKey)}</span>
              <span className="sm:hidden">{n}</span>
            </div>
            {i < steps.length - 1 && (
              <span
                className={cn(
                  'h-px w-6 sm:w-12',
                  n < step ? 'bg-teal-500' : 'bg-slate-200 dark:bg-slate-800',
                )}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ─── Step 1 — Admin ──────────────────────────────────────────────────────────

interface StepAdminProps {
  adminName:     string;
  setAdminName:  (v: string) => void;
  adminEmail:    string;
  setAdminEmail: (v: string) => void;
  password:      string;
  setPassword:   (v: string) => void;
  errors:        Partial<Record<string, string>>;
  setErrors:     (e: Partial<Record<string, string>>) => void;
}

function StepAdmin(p: StepAdminProps) {
  const { t } = useI18n();
  return (
    <div>
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('signup.admin.intro')}</p>

      <div className="mt-6 space-y-5">
        <Field id="admin-name" label={t('signup.admin.name')} error={p.errors.adminName}>
          <input
            id="admin-name"
            type="text"
            value={p.adminName}
            onChange={e => { p.setAdminName(e.target.value); if (p.errors.adminName) p.setErrors({ ...p.errors, adminName: undefined }); }}
            autoComplete="name"
            required
            className={inputCls(!!p.errors.adminName)}
          />
        </Field>

        <Field id="admin-email" label={t('signup.admin.email')} error={p.errors.adminEmail}>
          <input
            id="admin-email"
            type="email"
            value={p.adminEmail}
            onChange={e => { p.setAdminEmail(e.target.value); if (p.errors.adminEmail) p.setErrors({ ...p.errors, adminEmail: undefined }); }}
            autoComplete="email"
            required
            className={inputCls(!!p.errors.adminEmail)}
          />
        </Field>

        <Field
          id="admin-password"
          label={t('signup.admin.password')}
          hint={t('signup.admin.passwordHint')}
          error={p.errors.password}
        >
          <input
            id="admin-password"
            type="password"
            value={p.password}
            onChange={e => { p.setPassword(e.target.value); if (p.errors.password) p.setErrors({ ...p.errors, password: undefined }); }}
            autoComplete="new-password"
            required
            minLength={8}
            className={inputCls(!!p.errors.password)}
          />
        </Field>
      </div>
    </div>
  );
}

// ─── Step 2 — Company ────────────────────────────────────────────────────────

interface StepCompanyProps {
  companyName: string; setCompanyName: (v: string) => void;
  slug:        string; setSlug:        (v: string) => void;
  country:     string; setCountry:     (v: string) => void;
  activity:    Activity; setActivity:  (v: Activity) => void;
  errors:      Partial<Record<string, string>>;
  setErrors:   (e: Partial<Record<string, string>>) => void;
}

function StepCompany(p: StepCompanyProps) {
  const { t, lang } = useI18n();
  const activities: Array<{ value: Activity; Icon: typeof Ticket; labelKey: string }> = [
    { value: 'TICKETING', Icon: Ticket,  labelKey: 'signup.company.activityTicketing' },
    { value: 'PARCELS',   Icon: Package, labelKey: 'signup.company.activityParcels'   },
    { value: 'MIXED',     Icon: Shuffle, labelKey: 'signup.company.activityMixed'     },
  ];

  return (
    <div>
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('signup.company.intro')}</p>

      <div className="mt-6 space-y-5">
        <Field id="company-name" label={t('signup.company.name')} error={p.errors.companyName}>
          <input
            id="company-name"
            type="text"
            value={p.companyName}
            onChange={e => { p.setCompanyName(e.target.value); if (p.errors.companyName) p.setErrors({ ...p.errors, companyName: undefined }); }}
            placeholder={t('signup.company.namePlaceholder')}
            autoComplete="organization"
            required
            className={inputCls(!!p.errors.companyName)}
          />
        </Field>

        <Field
          id="company-slug"
          label={t('signup.company.slug')}
          hint={t('signup.company.slugHint').replace('{host}', p.slug || 'votre-nom').replace('{baseDomain}', PLATFORM_BASE_DOMAIN)}
          error={p.errors.slug}
        >
          <div className="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-800">
            <input
              id="company-slug"
              type="text"
              value={p.slug}
              onChange={e => { p.setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-')); if (p.errors.slug) p.setErrors({ ...p.errors, slug: undefined }); }}
              pattern="[a-z0-9-]{3,32}"
              autoComplete="off"
              required
              className="flex-1 border-0 bg-transparent px-3 py-2 text-sm text-slate-900 outline-none dark:text-white"
            />
            <span className="pointer-events-none border-l border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              .{PLATFORM_BASE_DOMAIN}
            </span>
          </div>
        </Field>

        <Field id="company-country" label={t('signup.company.country')} hint={t('signup.company.countryHint')}>
          <select
            id="company-country"
            value={p.country}
            onChange={e => p.setCountry(e.target.value)}
            className={inputCls(false)}
          >
            {COUNTRIES.map(c => (
              <option key={c.code} value={c.code}>
                {(c.name as Record<string, string>)[lang] ?? c.name.fr}
              </option>
            ))}
          </select>
        </Field>

        <fieldset>
          <legend className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('signup.company.activity')}
          </legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {activities.map(({ value, Icon, labelKey }) => (
              <label
                key={value}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm transition-colors',
                  p.activity === value
                    ? 'border-teal-500 bg-teal-50 text-teal-900 dark:bg-teal-950/40 dark:text-teal-100'
                    : 'border-slate-200 bg-white hover:border-teal-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-teal-700',
                )}
              >
                <input
                  type="radio"
                  name="activity"
                  value={value}
                  checked={p.activity === value}
                  onChange={() => p.setActivity(value)}
                  className="sr-only"
                />
                <Icon
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0',
                    p.activity === value ? 'text-teal-600 dark:text-teal-400' : 'text-slate-500',
                  )}
                  aria-hidden
                />
                <span className="font-medium">{t(labelKey)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  );
}

// ─── Step 3 — Plan ───────────────────────────────────────────────────────────

function StepPlan({ planSlug, setPlanSlug }: { planSlug?: string; setPlanSlug: (v?: string) => void }) {
  const { t, lang } = useI18n();
  const [plans,   setPlans]   = useState<PublicPlan[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);

  useEffect(() => {
    apiFetch<{ plans: PublicPlan[] }>('/api/public/plans', { skipRedirectOn401: true })
      .then(r => setPlans(r.plans))
      .catch(() => setLoadErr(true));
  }, []);

  // Préselection : le premier plan avec price > 0 (croissance) > premier public.
  useEffect(() => {
    if (!plans || planSlug) return;
    const featured = plans.find(p => p.price > 0) ?? plans[0];
    if (featured) setPlanSlug(featured.slug);
  }, [plans, planSlug, setPlanSlug]);

  // Hook appelé inconditionnellement — jamais après un early-return (Rules of Hooks).
  const numberFmt = useMemo(
    () => new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'fr-FR', { maximumFractionDigits: 0 }),
    [lang],
  );

  if (loadErr) {
    return (
      <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        {t('signup.plan.loadError')}
      </div>
    );
  }
  if (!plans) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <span>{/* No skeleton: volontairement minimaliste */}…</span>
      </div>
    );
  }
  if (plans.length === 0) {
    return <p className="text-sm text-slate-600 dark:text-slate-400">{t('signup.plan.empty')}</p>;
  }

  return (
    <div>
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('signup.plan.intro')}</p>

      <ul className="mt-6 grid gap-4 md:grid-cols-3">
        {plans.map(plan => {
          const selected = plan.slug === planSlug;
          const priceLabel = plan.price === 0
            ? t('signup.plan.free')
            : `${numberFmt.format(plan.price)} ${plan.currency}`;
          const periodLabel = plan.billingCycle === 'YEARLY'
            ? t('signup.plan.perYear')
            : plan.billingCycle === 'MONTHLY'
              ? t('signup.plan.perMonth')
              : '';
          return (
            <li key={plan.id}>
              <button
                type="button"
                onClick={() => setPlanSlug(plan.slug)}
                aria-pressed={selected}
                className={cn(
                  'relative flex w-full flex-col rounded-xl border p-5 text-left transition-all',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900',
                  selected
                    ? 'border-teal-500 ring-2 ring-teal-500 bg-teal-50/50 dark:border-teal-500 dark:bg-teal-950/30'
                    : 'border-slate-200 bg-white hover:border-teal-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-teal-700',
                )}
              >
                {selected && (
                  <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-teal-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                    <Check className="h-3 w-3" aria-hidden />
                    {t('signup.plan.selected')}
                  </span>
                )}
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">{plan.name}</h3>
                {plan.description && (
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{plan.description}</p>
                )}
                <p className="mt-4 text-2xl font-bold text-slate-900 dark:text-white">
                  {priceLabel}
                  <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">{periodLabel}</span>
                </p>
                {plan.trialDays > 0 && (
                  <p className="mt-2 text-xs font-medium text-teal-700 dark:text-teal-400">
                    {t('signup.plan.trial').replace('{days}', String(plan.trialDays))}
                  </p>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Success screen ──────────────────────────────────────────────────────────

function SuccessScreen({ slug, trialDays }: { slug: string; trialDays: number }) {
  const { t } = useI18n();
  const tenantUrl = buildTenantLoginUrl(slug);
  // Signal dev-only : le slug vient d'être créé en DB, mais /etc/hosts n'est
  // pas encore à jour → le CTA mènerait à un host non résolu. On affiche la
  // commande à lancer. Condition : domaine de base == translog.test (conv. dev).
  const isDevDomain =
    (import.meta.env.VITE_PLATFORM_BASE_DOMAIN ?? 'translog.test') === 'translog.test';
  return (
    <section className="relative overflow-hidden py-20 lg:py-28">
      <div className="absolute inset-0 -z-10" aria-hidden>
        <div className="absolute inset-0 bg-gradient-to-b from-teal-50/60 via-white to-white dark:from-teal-950/40 dark:via-slate-950 dark:to-slate-950" />
        <div className="absolute left-1/2 top-0 h-[500px] w-[900px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-teal-400/20 blur-3xl dark:bg-teal-500/10" />
      </div>

      <div className="mx-auto max-w-2xl px-4 text-center sm:px-6 lg:px-8">
        <span className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-teal-600 text-white shadow-lg shadow-teal-600/30">
          <Check className="h-8 w-8" aria-hidden />
        </span>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
          {t('signup.success.title')}
        </h1>
        <p className="mt-5 text-lg text-slate-600 dark:text-slate-300">
          {t('signup.success.subtitle').replace('{slug}', slug).replace('{baseDomain}', PLATFORM_BASE_DOMAIN)}
        </p>
        {trialDays > 0 && (
          <p className="mt-3 text-sm font-medium text-teal-700 dark:text-teal-400">
            {t('signup.success.trialInfo').replace('{days}', String(trialDays))}
          </p>
        )}
        {isDevDomain && (
          <div
            role="alert"
            className="mx-auto mt-6 max-w-xl rounded-lg border border-amber-300 bg-amber-50 p-4 text-left text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <p className="font-semibold">
              <AlertTriangle className="mr-1.5 inline h-4 w-4 align-[-2px]" aria-hidden />
              {t('signup.success.devHostsTitle')}
            </p>
            <p className="mt-1">
              {t('signup.success.devHostsBody').replace('{slug}', slug)}
            </p>
            <pre className="mt-3 overflow-x-auto rounded bg-amber-100 px-3 py-2 font-mono text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
npm run dev:sync-hosts
            </pre>
          </div>
        )}
        <div className="mt-8 flex justify-center">
          <a
            href={tenantUrl}
            className="inline-flex h-12 items-center gap-2 rounded-lg bg-teal-600 px-6 text-base font-semibold text-white shadow-lg shadow-teal-600/20 transition-colors hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
          >
            {t('signup.success.cta')}
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        </div>
      </div>
    </section>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

function buildTenantLoginUrl(slug: string): string {
  // Même logique que frontend/lib/tenancy/host.ts buildTenantUrl, sans importer
  // pour éviter une dépendance circulaire host.ts → PublicLayout.
  const base = import.meta.env.VITE_PLATFORM_BASE_DOMAIN ?? 'translog.test';
  const proto = typeof window !== 'undefined' && window.location?.protocol ? window.location.protocol : 'https:';
  const port  = typeof window !== 'undefined' && window.location?.port ? `:${window.location.port}` : '';
  return `${proto}//${slug}.${base}${port}/login`;
}

function inputCls(hasError: boolean): string {
  return cn(
    'block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400',
    'focus:outline-none focus:ring-2 focus:ring-teal-500/20',
    'dark:bg-slate-800 dark:text-white',
    hasError
      ? 'border-red-400 focus:border-red-500 dark:border-red-700'
      : 'border-slate-300 focus:border-teal-500 dark:border-slate-700',
  );
}

function Field({
  id, label, hint, error, children,
}: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      {error && (
        <p className="mt-1 flex items-center gap-1 text-xs text-red-600 dark:text-red-400" role="alert">
          <AlertTriangle className="h-3 w-3" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
