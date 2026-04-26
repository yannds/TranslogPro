/**
 * WelcomePage — page d'activation post-onboarding.
 *
 * Affiche une checklist VÉRIDIQUE par dépendance : un item "Vendre votre 1er
 * billet" n'est jamais cliquable tant qu'un Bus + un Trip n'existent pas (sinon
 * on envoie l'admin sur un formulaire vide → frustration). Chaque item locked
 * indique sa dépendance via tooltip — pas de promesse mensongère.
 *
 * Source de vérité : `/api/onboarding/state` qui renvoie un bloc `activation`
 * avec les compteurs réels (bus, trip, ticket, parcel, team).
 *
 * Variantes par `tenant.businessActivity` :
 *   TICKETING : addBus → planTrip → sellFirstTicket
 *   PARCELS   : ensureRoute → registerFirstParcel
 *   MIXED     : fusion des deux paths
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2, Circle, Lock, ArrowRight, Lightbulb,
  UserPlus, Ticket, Package, Bus, Calendar, Settings,
  Loader2, AlertCircle,
} from 'lucide-react';
import { useI18n } from '../../lib/i18n/useI18n';
import { useAuth } from '../../lib/auth/auth.context';
import { apiFetch } from '../../lib/api';
import { cn } from '../../lib/utils';

type Activity = 'TICKETING' | 'PARCELS' | 'MIXED' | null;

interface ActivationState {
  bus:         boolean;
  trip:        boolean;
  firstTicket: boolean;
  firstParcel: boolean;
  team:        boolean;
  hasDemoSeed: boolean;
}

interface OnboardingState {
  tenant: {
    name: string; slug: string; language: string;
    businessActivity: Activity;
    onboardingCompletedAt: string | null;
  };
  steps:      { brand: boolean; agency: boolean; station: boolean; route: boolean; team: boolean };
  activation: ActivationState;
  completedAt: string | null;
}

type ItemStatus = 'done' | 'active' | 'locked';

interface ChecklistItem {
  id:          string;
  labelKey:    string;
  descKey?:    string;
  href:        string;
  Icon:        typeof Bus;
  status:      ItemStatus;
  /** Clé i18n du tooltip "débloquer en faisant X". Affichée si status=locked. */
  unlockKey?:  string;
}

export function WelcomePage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [loadErr, setLoadErr] = useState(false);

  useEffect(() => {
    apiFetch<OnboardingState>('/api/onboarding/state', { skipRedirectOn401: true })
      .then(setState)
      .catch(() => setLoadErr(true));
  }, []);

  if (!user) return null;
  if (loadErr) return <ErrorScreen onRetry={() => window.location.reload()} t={t} />;
  if (!state)  return <LoadingScreen t={t} />;

  const activity: Activity = state.tenant.businessActivity;
  const a = state.activation;
  const onboardingDone = Boolean(state.completedAt);

  // ── Composition par activité — ordre de dépendance préservé ────────────────
  const items: ChecklistItem[] = [
    { id: 'account',    labelKey: 'welcome.task.account',    href: '/admin',          Icon: CheckCircle2, status: 'done' },
    { id: 'onboarding', labelKey: 'welcome.task.onboarding', href: '/admin/settings', Icon: Settings,
      status: onboardingDone ? 'done' : 'active' },
  ];

  const wantsTicketing = activity === 'TICKETING' || activity === 'MIXED' || !activity;
  const wantsParcels   = activity === 'PARCELS'   || activity === 'MIXED';

  if (wantsTicketing) {
    items.push(
      { id: 'addBus', labelKey: 'welcome.task.addBus', descKey: 'welcome.task.addBus.desc',
        href: '/admin/fleet', Icon: Bus,
        status: a.bus ? 'done' : 'active' },
      { id: 'planTrip', labelKey: 'welcome.task.planTrip', descKey: 'welcome.task.planTrip.desc',
        href: '/admin/trips/planning', Icon: Calendar,
        status: a.trip ? 'done' : a.bus ? 'active' : 'locked',
        unlockKey: 'welcome.unlock.needsBus' },
      { id: 'sellFirstTicket', labelKey: 'welcome.task.firstTicket', descKey: 'welcome.task.firstTicket.desc',
        href: '/admin/tickets/new', Icon: Ticket,
        status: a.firstTicket ? 'done' : a.trip ? 'active' : 'locked',
        unlockKey: 'welcome.unlock.needsTrip' },
    );
  }

  if (wantsParcels) {
    items.push(
      { id: 'registerFirstParcel', labelKey: 'welcome.task.firstParcel', descKey: 'welcome.task.firstParcel.desc',
        href: '/admin/parcels/new', Icon: Package,
        status: a.firstParcel ? 'done' : state.steps.route ? 'active' : 'locked',
        unlockKey: 'welcome.unlock.needsRoute' },
    );
  }

  items.push(
    { id: 'inviteTeam', labelKey: 'welcome.task.inviteTeam', descKey: 'welcome.task.inviteTeam.desc',
      href: '/admin/staff', Icon: UserPlus,
      status: a.team ? 'done' : 'active' },
  );

  const doneCount  = items.filter(i => i.status === 'done').length;
  const totalCount = items.length;
  const progress   = Math.round((doneCount / totalCount) * 100);

  return (
    <div className="min-h-screen bg-gradient-to-b from-teal-50/60 via-white to-white dark:from-teal-950/40 dark:via-slate-950 dark:to-slate-950">
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        {/* Hero */}
        <header>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
            {t('welcome.heroTitle').replace('{name}', user.name ?? '')}
          </h1>
          <p className="mt-3 text-lg text-slate-600 dark:text-slate-300">
            {t('welcome.heroSubtitle').replace('{tenantName}', (user as any).tenantName ?? state.tenant.name)}
          </p>
        </header>

        {/* Checklist card */}
        <section className="mt-10 rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900" aria-labelledby="checklist-title">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5 dark:border-slate-800">
            <h2 id="checklist-title" className="text-base font-semibold text-slate-900 dark:text-white">
              {t('welcome.checklist.title')}
            </h2>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {t('welcome.checklist.done').replace('{done}', String(doneCount)).replace('{total}', String(totalCount))}
              </span>
              <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>

          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {items.map(item => <ChecklistRow key={item.id} item={item} t={t} />)}
          </ul>
        </section>

        {/* Tips */}
        <section className="mt-10 rounded-2xl border border-amber-200 bg-amber-50/50 p-6 dark:border-amber-900/50 dark:bg-amber-950/20" aria-labelledby="tips-title">
          <h3 id="tips-title" className="inline-flex items-center gap-2 text-base font-semibold text-amber-900 dark:text-amber-200">
            <Lightbulb className="h-5 w-5" aria-hidden />
            {t('welcome.tips.title')}
          </h3>
          <ul className="mt-4 space-y-2 text-sm text-amber-900/80 dark:text-amber-100/80">
            <li>• {t('welcome.tips.t1')}</li>
            <li>• {t('welcome.tips.t2')}</li>
            <li>• {t('welcome.tips.t3')}</li>
          </ul>
        </section>

        <div className="mt-8 text-center">
          <Link to="/admin" className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 hover:text-teal-600 dark:text-teal-400 dark:hover:text-teal-300">
            {t('welcome.gotoDashboard')}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Sous-composants ───────────────────────────────────────────────────────────

function ChecklistRow({ item, t }: { item: ChecklistItem; t: (k: string) => string }) {
  const { Icon, labelKey, descKey, href, status, unlockKey } = item;

  const baseRow = (
    <div className={cn(
      'flex items-start gap-4 px-5 py-4 transition-colors',
      status === 'done'   && 'bg-teal-50/30 dark:bg-teal-950/20',
      status === 'active' && 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
      status === 'locked' && 'cursor-not-allowed opacity-60',
    )}>
      <div className="mt-0.5 shrink-0">
        {status === 'done'   && <CheckCircle2 className="h-5 w-5 text-teal-600 dark:text-teal-400" aria-hidden />}
        {status === 'active' && <Circle       className="h-5 w-5 text-slate-400" aria-hidden />}
        {status === 'locked' && <Lock         className="h-5 w-5 text-slate-400" aria-hidden />}
      </div>
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0',
        status === 'done' ? 'text-teal-600 dark:text-teal-400' : 'text-slate-500')} aria-hidden />
      <div className="flex-1">
        <span className={cn('text-sm font-medium block',
          status === 'done'   && 'text-slate-500 line-through dark:text-slate-400',
          status === 'active' && 'text-slate-900 dark:text-white',
          status === 'locked' && 'text-slate-500 dark:text-slate-400')}>
          {t(labelKey)}
        </span>
        {descKey && status !== 'done' && (
          <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
            {t(descKey)}
          </span>
        )}
        {status === 'locked' && unlockKey && (
          <span className="mt-1 inline-flex items-center gap-1 text-xs italic text-amber-700 dark:text-amber-400">
            <AlertCircle className="h-3 w-3" aria-hidden />
            {t(unlockKey)}
          </span>
        )}
      </div>
      {status === 'active' && (
        <span className="ml-2 inline-flex shrink-0 items-center gap-1 self-center text-xs font-semibold text-teal-700 dark:text-teal-400">
          {t('welcome.task.goto')}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </span>
      )}
    </div>
  );

  // Locked = pas de Link, juste le row + tooltip via title.
  if (status === 'locked') {
    return (
      <li title={unlockKey ? t(unlockKey) : undefined} aria-disabled="true">
        {baseRow}
      </li>
    );
  }

  return (
    <li>
      <Link to={href} className="block">{baseRow}</Link>
    </li>
  );
}

function LoadingScreen({ t }: { t: (k: string) => string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white dark:bg-slate-950">
      <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        <span>{t('welcome.loading')}</span>
      </div>
    </div>
  );
}

function ErrorScreen({ onRetry, t }: { onRetry: () => void; t: (k: string) => string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white dark:bg-slate-950 p-6">
      <div className="max-w-md text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-amber-500" aria-hidden />
        <p className="mt-4 text-slate-700 dark:text-slate-300">{t('welcome.loadError')}</p>
        <button onClick={onRetry}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700">
          {t('welcome.retry')}
        </button>
      </div>
    </div>
  );
}
