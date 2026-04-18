/**
 * WelcomePage — dashboard post-onboarding.
 *
 * Affiche une checklist d'activation adaptée à l'activité du tenant
 * (TICKETING → premier billet, PARCELS → premier colis, MIXED → les deux)
 * + 3 conseils pour bien démarrer.
 *
 * C'est la première landing après la finalisation du wizard — on garde
 * volontairement un ton léger et encourageant (adoption SaaS > page admin
 * dense).
 */
import { Link } from 'react-router-dom';
import {
  CheckCircle2, Circle, ArrowRight, Lightbulb,
  UserPlus, Ticket, Package, LineChart, Settings,
} from 'lucide-react';
import { useI18n } from '../../lib/i18n/useI18n';
import { useAuth } from '../../lib/auth/auth.context';
import { cn } from '../../lib/utils';

export function WelcomePage() {
  const { t } = useI18n();
  const { user } = useAuth();

  if (!user) return null;

  const activity = (user as any).businessActivity as 'TICKETING' | 'PARCELS' | 'MIXED' | null;

  // Composition de la checklist selon l'activité
  const tasks: Array<{ id: string; labelKey: string; href: string; Icon: typeof Ticket; done: boolean }> = [
    { id: 'account',     labelKey: 'welcome.task.account',     href: '/admin',                     Icon: CheckCircle2, done: true  },
    { id: 'onboarding',  labelKey: 'welcome.task.onboarding',  href: '/admin/settings',            Icon: Settings,     done: true  },
    ...(activity === 'TICKETING' || activity === 'MIXED' || !activity
      ? [{ id: 'firstTicket',  labelKey: 'welcome.task.firstTicket',  href: '/admin/sell-ticket',        Icon: Ticket,   done: false }]
      : []),
    ...(activity === 'PARCELS' || activity === 'MIXED'
      ? [{ id: 'firstParcel',  labelKey: 'welcome.task.firstParcel',  href: '/admin/parcels/new',        Icon: Package,  done: false }]
      : []),
    { id: 'firstReport', labelKey: 'welcome.task.firstReport', href: '/admin/analytics',          Icon: LineChart,    done: false },
    { id: 'inviteTeam',  labelKey: 'welcome.task.inviteTeam',  href: '/admin/iam/users',          Icon: UserPlus,     done: false },
  ];

  const doneCount = tasks.filter(t => t.done).length;
  const totalCount = tasks.length;
  const progress = Math.round((doneCount / totalCount) * 100);

  return (
    <div className="min-h-screen bg-gradient-to-b from-teal-50/60 via-white to-white dark:from-teal-950/40 dark:via-slate-950 dark:to-slate-950">
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        {/* Hero */}
        <header>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
            {t('welcome.heroTitle').replace('{name}', user.name ?? '')}
          </h1>
          <p className="mt-3 text-lg text-slate-600 dark:text-slate-300">
            {t('welcome.heroSubtitle').replace('{tenantName}', (user as any).tenantName ?? 'TransLog Pro')}
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
              <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>

          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {tasks.map(({ id, labelKey, href, Icon, done }) => (
              <li key={id}>
                <Link to={href}
                  className={cn(
                    'flex items-center gap-4 px-5 py-4 transition-colors',
                    done
                      ? 'bg-teal-50/30 dark:bg-teal-950/20'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
                  )}
                >
                  {done
                    ? <CheckCircle2 className="h-5 w-5 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden />
                    : <Circle     className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />}
                  <Icon className={cn('h-5 w-5 shrink-0', done ? 'text-teal-600 dark:text-teal-400' : 'text-slate-500')} aria-hidden />
                  <span className={cn('flex-1 text-sm font-medium', done ? 'text-slate-500 line-through dark:text-slate-400' : 'text-slate-900 dark:text-white')}>
                    {t(labelKey)}
                  </span>
                  {!done && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 dark:text-teal-400">
                      {t('welcome.task.goto')}
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </span>
                  )}
                </Link>
              </li>
            ))}
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
            {t('welcome.task.goto')}
          </Link>
        </div>
      </div>
    </div>
  );
}
