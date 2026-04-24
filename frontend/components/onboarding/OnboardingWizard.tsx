/**
 * OnboardingWizard — parcours post-signup pour le tenant admin.
 *
 * Étapes dynamiques selon `tenant.businessActivity` :
 *   TICKETING : brand → agency → station → route       → team
 *   PARCELS   : brand → agency → station → parcel-info → team
 *   MIXED     : brand → agency → station → route       → team   (parcel dans tips)
 *   null      : brand → agency → station → route       → team
 *
 * Reprise : le wizard appelle `/api/onboarding/state` à chaque montage et
 * détecte les étapes déjà effectuées (station existante → skip, etc.). Tout
 * bouton "Passer" est accepté sans pénalité (finalisation possible tôt).
 */
import { useEffect, useState, type ReactNode, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Check, Loader2, Palette, Building2,
  MapPin, Route as RouteIcon, Package, Users, Plus, X, AlertTriangle, SkipForward,
} from 'lucide-react';
import { useI18n } from '../../lib/i18n/useI18n';
import { useAuth } from '../../lib/auth/auth.context';
import { apiFetch, ApiError } from '../../lib/api';
import { cn } from '../../lib/utils';
import { CityPicker } from '../ui/CityPicker';

type Activity = 'TICKETING' | 'PARCELS' | 'MIXED' | null;

interface OnboardingState {
  tenant: {
    name: string; slug: string; language: string; country: string; currency: string;
    businessActivity: Activity;
    onboardingCompletedAt: string | null;
  };
  steps: { brand: boolean; agency: boolean; station: boolean; route: boolean; team: boolean };
  firstStationId: string | null;
}

type StepKind = 'brand' | 'agency' | 'station' | 'route' | 'parcel' | 'team';

export function OnboardingWizard() {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [state, setState]   = useState<OnboardingState | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [finishing, setFinishing] = useState(false);

  // Chargement initial de l'état backend
  useEffect(() => {
    apiFetch<OnboardingState>('/api/onboarding/state', { skipRedirectOn401: true })
      .then(setState)
      .catch(() => setLoadErr(true));
  }, []);

  if (loadErr) {
    return <ScreenError onRetry={() => window.location.reload()} />;
  }
  if (!state) {
    return <ScreenLoading />;
  }

  // Séquence d'étapes selon l'activité
  const activity: Activity = state.tenant.businessActivity;
  const kinds: StepKind[] = activity === 'PARCELS'
    ? ['brand', 'agency', 'station', 'parcel', 'team']
    : ['brand', 'agency', 'station', 'route',  'team'];

  const currentKind = kinds[stepIdx]!;
  const total       = kinds.length;

  const goNext = () => {
    if (stepIdx < total - 1) setStepIdx(stepIdx + 1);
    else finish();
  };
  const goBack = () => { if (stepIdx > 0) setStepIdx(stepIdx - 1); };
  const skip   = () => goNext();

  const finish = async () => {
    setFinishing(true);
    try {
      await apiFetch('/api/onboarding/complete', { method: 'POST', skipRedirectOn401: true });
      navigate('/welcome', { replace: true });
    } catch {
      setFinishing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-teal-50/60 via-white to-white dark:from-teal-950/40 dark:via-slate-950 dark:to-slate-950">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <header className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
            {t('onb.title')}
          </h1>
          <p className="mt-3 text-lg text-slate-600 dark:text-slate-300">{t('onb.tagline')}</p>
        </header>

        <StepIndicator kinds={kinds} currentIdx={stepIdx} completed={state.steps} />

        <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-400">
            {t('onb.step').replace('{n}', String(stepIdx + 1)).replace('{total}', String(total))}
          </p>

          {currentKind === 'brand' && (
            <StepBrand onSaved={goNext} onSkip={skip} onBack={stepIdx > 0 ? goBack : undefined} />
          )}
          {currentKind === 'agency' && (
            <StepAgency onSaved={goNext} onSkip={skip} onBack={goBack} />
          )}
          {currentKind === 'station' && (
            <StepStation onSaved={(stationId) => { setState(s => s ? ({ ...s, firstStationId: stationId }) : s); goNext(); }} onSkip={skip} onBack={goBack} />
          )}
          {currentKind === 'route' && (
            <StepRoute
              originStationId={state.firstStationId}
              currency={state.tenant.currency}
              onSaved={goNext} onSkip={skip} onBack={goBack}
            />
          )}
          {currentKind === 'parcel' && (
            <StepParcelInfo onSaved={goNext} onSkip={skip} onBack={goBack} />
          )}
          {currentKind === 'team' && (
            <StepTeam isLast onFinish={finish} finishing={finishing} onSkip={finish} onBack={goBack} />
          )}
        </div>

        {user && (
          <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {t('signup.success.cta')} — <button
              onClick={finish}
              className="underline hover:text-teal-600 dark:hover:text-teal-400"
              disabled={finishing}
            >
              {t('signup.success.title').replace(' 🎉', '')}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Step indicator ──────────────────────────────────────────────────────────

function StepIndicator({
  kinds, currentIdx, completed,
}: { kinds: StepKind[]; currentIdx: number; completed: OnboardingState['steps'] }) {
  const { t } = useI18n();
  const iconFor: Record<StepKind, typeof Palette> = {
    brand:   Palette,
    agency:  Building2,
    station: MapPin,
    route:   RouteIcon,
    parcel:  Package,
    team:    Users,
  };
  return (
    <ol className="mt-10 flex items-center justify-center gap-2" aria-label="Progression de l'onboarding">
      {kinds.map((k, i) => {
        const Icon = iconFor[k];
        const isActive   = i === currentIdx;
        const isComplete = i < currentIdx || completed[k as keyof typeof completed];
        return (
          <li key={k} className="flex items-center gap-1 sm:gap-2">
            <div
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium sm:px-3 sm:text-sm',
                isActive   && 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300',
                isComplete && !isActive && 'border-teal-500/50 bg-teal-500/10 text-teal-700 dark:text-teal-300',
                !isActive && !isComplete && 'border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400',
              )}
              aria-current={isActive ? 'step' : undefined}
            >
              {isComplete && !isActive
                ? <Check className="h-3.5 w-3.5" aria-hidden />
                : <Icon className="h-3.5 w-3.5" aria-hidden />}
              <span className="hidden sm:inline">{t(`onb.stepLabel.${k}`)}</span>
            </div>
            {i < kinds.length - 1 && (
              <span className={cn('h-px w-3 sm:w-6', i < currentIdx ? 'bg-teal-500' : 'bg-slate-200 dark:bg-slate-800')} aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ─── Step 1: Branding ────────────────────────────────────────────────────────

function StepBrand({ onSaved, onSkip, onBack }: StepProps) {
  const { t } = useI18n();
  const [brandName, setBrandName]   = useState('');
  const [logoUrl,   setLogoUrl]     = useState('');
  const [primaryColor, setPrimaryColor] = useState('#0d9488');
  const [supportEmail, setSupportEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await apiFetch('/api/onboarding/brand', {
        method: 'PATCH',
        body:   { brandName, logoUrl: logoUrl || undefined, primaryColor, supportEmail: supportEmail || undefined },
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? t('onb.error') : t('onb.error'));
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4">
      <StepHeader icon={Palette} title={t('onb.stepLabel.brand')} intro={t('onb.brand.intro')} />

      <div className="mt-6 space-y-5">
        <Field id="brand-name" label={t('onb.brand.name')} hint={t('onb.brand.nameHint')}>
          <input id="brand-name" type="text" value={brandName} onChange={e => setBrandName(e.target.value)}
            required maxLength={120} className={inputCls()}
          />
        </Field>
        <Field id="brand-logo" label={t('onb.brand.logo')} hint={t('onb.brand.logoHint')}>
          <input id="brand-logo" type="url" value={logoUrl} onChange={e => setLogoUrl(e.target.value)}
            maxLength={2000} placeholder="https://…" className={inputCls()}
          />
        </Field>
        <Field id="brand-color" label={t('onb.brand.color')} hint={t('onb.brand.colorHint')}>
          <div className="flex items-center gap-3">
            <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
              aria-label={t('onb.brand.color')}
              className="h-10 w-16 cursor-pointer rounded-md border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800"
            />
            <input id="brand-color" type="text" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
              pattern="^#[0-9a-fA-F]{6}$" className={cn(inputCls(), 'font-mono text-sm')}
            />
          </div>
        </Field>
        <Field id="brand-support" label={t('onb.brand.support')}>
          <input id="brand-support" type="email" value={supportEmail} onChange={e => setSupportEmail(e.target.value)}
            maxLength={254} className={inputCls()}
          />
        </Field>
      </div>

      <ErrorBox msg={err} />
      <Footer onBack={onBack} onSkip={onSkip} saving={saving} />
    </form>
  );
}

// ─── Step 2: Rename default agency ───────────────────────────────────────────

function StepAgency({ onSaved, onSkip, onBack }: StepProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await apiFetch('/api/onboarding/agency', { method: 'PATCH', body: { name } });
      onSaved();
    } catch {
      setErr(t('onb.error'));
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4">
      <StepHeader icon={Building2} title={t('onb.stepLabel.agency')} intro={t('onb.agency.intro')} />
      <div className="mt-6">
        <Field id="agency-name" label={t('onb.agency.name')}>
          <input id="agency-name" type="text" value={name} onChange={e => setName(e.target.value)}
            required maxLength={120} className={inputCls()}
          />
        </Field>
      </div>
      <ErrorBox msg={err} />
      <Footer onBack={onBack} onSkip={onSkip} saving={saving} />
    </form>
  );
}

// ─── Step 3: First station ──────────────────────────────────────────────────

function StepStation({
  onSaved, onSkip, onBack,
}: Omit<StepProps, 'onSaved'> & { onSaved: (stationId: string) => void }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [type, setType] = useState<'PRINCIPALE' | 'RELAIS'>('PRINCIPALE');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      const res = await apiFetch<{ id: string }>('/api/onboarding/station', {
        method: 'POST',
        body:   { name, city, type },
      });
      onSaved(res.id);
    } catch { setErr(t('onb.error')); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4">
      <StepHeader icon={MapPin} title={t('onb.stepLabel.station')} intro={t('onb.station.intro')} />
      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <Field id="station-name" label={t('onb.station.name')}>
          <input id="station-name" type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder={t('onb.station.namePlaceholder')}
            required maxLength={120} className={inputCls()}
          />
        </Field>
        <Field id="station-city" label={t('onb.station.city')} hint={t('onb.cityHint')}>
          <CityPicker
            id="station-city"
            tenantId={user?.effectiveTenantId ?? ''}
            value={city}
            onChange={setCity}
            placeholder={t('onb.station.cityPlaceholder')}
            required
            disabled={saving}
          />
        </Field>
        <Field id="station-type" label={t('onb.station.type')}>
          <select id="station-type" value={type} onChange={e => setType(e.target.value as typeof type)} className={inputCls()}>
            <option value="PRINCIPALE">{t('onb.station.typePrincipale')}</option>
            <option value="RELAIS">{t('onb.station.typeRelais')}</option>
          </select>
        </Field>
      </div>
      <ErrorBox msg={err} />
      <Footer onBack={onBack} onSkip={onSkip} saving={saving} />
    </form>
  );
}

// ─── Step 4a: First route (TICKETING / MIXED) ────────────────────────────────

function StepRoute({
  originStationId, currency, onSaved, onSkip, onBack,
}: StepProps & { originStationId: string | null; currency: string }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [destName, setDestName]     = useState('');
  const [destCity, setDestCity]     = useState('');
  const [price,    setPrice]        = useState('');
  const [distance, setDistance]     = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!originStationId) { setErr(t('onb.error')); return; }
    setSaving(true); setErr(null);
    try {
      await apiFetch('/api/onboarding/route', {
        method: 'POST',
        body:   {
          originStationId,
          destinationName: destName,
          destinationCity: destCity,
          basePrice:       Number(price) || 0,
          distanceKm:      Number(distance) || 0,
        },
      });
      onSaved();
    } catch { setErr(t('onb.error')); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4">
      <StepHeader icon={RouteIcon} title={t('onb.stepLabel.route')} intro={t('onb.route.intro')} />
      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <Field id="route-dest-name" label={t('onb.route.destName')}>
          <input id="route-dest-name" type="text" value={destName} onChange={e => setDestName(e.target.value)}
            placeholder={t('onb.route.destNamePlaceholder')}
            required maxLength={120} className={inputCls()}
          />
        </Field>
        <Field id="route-dest-city" label={t('onb.route.destCity')} hint={t('onb.cityHint')}>
          <CityPicker
            id="route-dest-city"
            tenantId={user?.effectiveTenantId ?? ''}
            value={destCity}
            onChange={setDestCity}
            placeholder={t('onb.route.destCityPlaceholder')}
            required
            disabled={saving}
          />
        </Field>
        <Field id="route-price" label={t('onb.route.price')} hint={t('onb.route.priceHint').replace('{currency}', currency)}>
          <input id="route-price" type="number" min="0" step="1" value={price} onChange={e => setPrice(e.target.value)}
            required className={inputCls()}
          />
        </Field>
        <Field id="route-distance" label={t('onb.route.distance')}>
          <input id="route-distance" type="number" min="0" step="1" value={distance} onChange={e => setDistance(e.target.value)}
            className={inputCls()}
          />
        </Field>
      </div>
      <ErrorBox msg={err} />
      <Footer onBack={onBack} onSkip={onSkip} saving={saving} />
    </form>
  );
}

// ─── Step 4b: Parcel info (PARCELS only) ─────────────────────────────────────

function StepParcelInfo({ onSaved, onSkip, onBack }: StepProps) {
  const { t } = useI18n();
  return (
    <div className="mt-4">
      <StepHeader icon={Package} title={t('onb.stepLabel.parcel')} intro={t('onb.parcel.intro')} />
      <div className="mt-6 rounded-lg border border-teal-200 bg-teal-50/60 p-4 text-sm text-teal-900 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-100">
        💡 {t('onb.parcel.hint')}
      </div>
      <Footer onBack={onBack} onSkip={onSkip} saving={false} primaryLabel={t('onb.parcel.continue')} onPrimary={onSaved} />
    </div>
  );
}

// ─── Step 5: Invite team ─────────────────────────────────────────────────────

interface Invite { email: string; name: string; roleSlug: string }

function StepTeam({
  isLast, onFinish, finishing, onSkip, onBack,
}: { isLast: boolean; onFinish: () => void; finishing: boolean } & Omit<StepProps, 'onSaved'>) {
  const { t } = useI18n();
  const [invites, setInvites] = useState<Invite[]>([{ email: '', name: '', roleSlug: 'CASHIER' }]);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addInvite = () => invites.length < 3 && setInvites([...invites, { email: '', name: '', roleSlug: 'CASHIER' }]);
  const updateInvite = (i: number, patch: Partial<Invite>) =>
    setInvites(invites.map((inv, idx) => idx === i ? { ...inv, ...patch } : inv));
  const removeInvite = (i: number) => setInvites(invites.filter((_, idx) => idx !== i));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const valid = invites.filter(i => i.email && i.name);
    if (valid.length === 0) { onFinish(); return; }
    setSending(true); setErr(null);
    try {
      await apiFetch('/api/onboarding/invite', { method: 'POST', body: { invites: valid } });
      onFinish();
    } catch { setErr(t('onb.error')); }
    finally { setSending(false); }
  }

  const roles = ['CASHIER', 'AGENCY_MANAGER', 'DRIVER', 'DISPATCHER'];

  return (
    <form onSubmit={onSubmit} className="mt-4">
      <StepHeader icon={Users} title={t('onb.stepLabel.team')} intro={t('onb.team.intro')} />

      <div className="mt-6 space-y-4">
        {invites.map((inv, idx) => (
          <div key={idx} className="grid items-end gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/40 md:grid-cols-[1fr_1fr_1fr_auto]">
            <Field id={`inv-email-${idx}`} label={t('onb.team.email')}>
              <input id={`inv-email-${idx}`} type="email" value={inv.email}
                onChange={e => updateInvite(idx, { email: e.target.value })}
                maxLength={254} className={inputCls()}
              />
            </Field>
            <Field id={`inv-name-${idx}`} label={t('onb.team.name')}>
              <input id={`inv-name-${idx}`} type="text" value={inv.name}
                onChange={e => updateInvite(idx, { name: e.target.value })}
                maxLength={120} className={inputCls()}
              />
            </Field>
            <Field id={`inv-role-${idx}`} label={t('onb.team.role')}>
              <select id={`inv-role-${idx}`} value={inv.roleSlug}
                onChange={e => updateInvite(idx, { roleSlug: e.target.value })} className={inputCls()}>
                {roles.map(r => <option key={r} value={r}>{t(`onb.team.role.${r}`)}</option>)}
              </select>
            </Field>
            {invites.length > 1 && (
              <button type="button" onClick={() => removeInvite(idx)}
                className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 px-3 text-sm text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                aria-label={t('onb.team.remove')}>
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        ))}

        {invites.length < 3 && (
          <button type="button" onClick={addInvite}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 hover:text-teal-600 dark:text-teal-400 dark:hover:text-teal-300">
            <Plus className="h-4 w-4" aria-hidden />
            {t('onb.team.add')}
          </button>
        )}
      </div>

      <ErrorBox msg={err} />

      <div className="mt-8 flex items-center justify-between gap-3">
        {onBack && (
          <button type="button" onClick={onBack} disabled={sending || finishing}
            className="inline-flex h-11 items-center gap-1.5 rounded-lg px-4 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t('onb.back')}
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={onSkip} disabled={sending || finishing}
            className="inline-flex h-11 items-center gap-1.5 rounded-lg px-4 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
            <SkipForward className="h-4 w-4" aria-hidden />
            {t('onb.team.later')}
          </button>
          <button type="submit" disabled={sending || finishing}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-teal-600 px-6 text-sm font-semibold text-white shadow-sm hover:bg-teal-500 disabled:opacity-60">
            {(sending || finishing)
              ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t(finishing ? 'onb.finishing' : 'onb.team.sending')}</>
              : <>{t('onb.finish')} <Check className="h-4 w-4" aria-hidden /></>}
          </button>
        </div>
      </div>
    </form>
  );
}

// ─── Shared ──────────────────────────────────────────────────────────────────

interface StepProps {
  onSaved: () => void;
  onSkip:  () => void;
  onBack?: () => void;
}

function StepHeader({ icon: Icon, title, intro }: { icon: typeof Palette; title: string; intro: string }) {
  return (
    <div className="flex items-start gap-4">
      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-400">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div className="mt-0.5">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{title}</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{intro}</p>
      </div>
    </div>
  );
}

function Footer({
  onBack, onSkip, saving, primaryLabel, onPrimary,
}: {
  onBack?: () => void; onSkip: () => void; saving: boolean;
  primaryLabel?: string; onPrimary?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-8 flex items-center justify-between gap-3">
      {onBack ? (
        <button type="button" onClick={onBack} disabled={saving}
          className="inline-flex h-11 items-center gap-1.5 rounded-lg px-4 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t('onb.back')}
        </button>
      ) : <span />}
      <div className="flex items-center gap-2">
        <button type="button" onClick={onSkip} disabled={saving}
          className="inline-flex h-11 items-center gap-1.5 rounded-lg px-4 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
          <SkipForward className="h-4 w-4" aria-hidden />
          {t('onb.skip')}
        </button>
        {onPrimary ? (
          <button type="button" onClick={onPrimary} disabled={saving}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-teal-600 px-6 text-sm font-semibold text-white shadow-sm hover:bg-teal-500 disabled:opacity-60">
            {primaryLabel ?? t('onb.save')}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        ) : (
          <button type="submit" disabled={saving}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-teal-600 px-6 text-sm font-semibold text-white shadow-sm hover:bg-teal-500 disabled:opacity-60">
            {saving
              ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('onb.saving')}</>
              : <>{primaryLabel ?? t('onb.save')} <ArrowRight className="h-4 w-4" aria-hidden /></>}
          </button>
        )}
      </div>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div role="alert" className="mt-5 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{msg}</span>
    </div>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

function inputCls(): string {
  return 'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white';
}

function ScreenLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center text-slate-500 dark:text-slate-400">
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
    </div>
  );
}

function ScreenError({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <AlertTriangle className="h-10 w-10 text-amber-500" aria-hidden />
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('onb.error')}</p>
      <button onClick={onRetry} className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500">
        ⟳
      </button>
    </div>
  );
}
