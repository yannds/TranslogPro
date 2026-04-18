/**
 * PageDebugOutbox — Dead Letter Queue & Replay (SUPPORT_L2 / SUPER_ADMIN)
 *
 * Permission : data.outbox.replay.global
 *
 * Monitoring et replay manuel des événements en DeadLetterEvent (PRD Module P).
 * Alerting si DLQ non vide > 1h → ce que L2 surveille pendant l'astreinte.
 *
 * L'endpoint `/api/control/tenants/:tid/dlq` n'est pas encore monté en public.
 * La page expose la trame, le scope de responsabilité et un état d'attente
 * plutôt que des données factices.
 */

import { useAuth }   from '../../lib/auth/auth.context';
import { useI18n }    from '../../lib/i18n/useI18n';
import { RefreshCw, ShieldAlert, Info } from 'lucide-react';

const P_OUTBOX_REPLAY = 'data.outbox.replay.global';

export function PageDebugOutbox() {
  const { user } = useAuth();
  const { t }    = useI18n();
  const allowed  = (user?.permissions ?? []).includes(P_OUTBOX_REPLAY);

  if (!allowed) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <div role="status" className="t-card-bordered rounded-2xl p-6 max-w-md text-center space-y-2">
          <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto" aria-hidden />
          <p className="text-sm t-text-2">{t('debugOutbox.notAllowed')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <header className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
          <RefreshCw className="w-5 h-5 text-slate-700 dark:text-slate-300" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold t-text">{t('debugOutbox.title')}</h1>
          <p className="text-sm t-text-2">{t('debugOutbox.subtitle')}</p>
        </div>
      </header>

      <section
        role="region"
        aria-labelledby="debug-outbox-scope"
        className="t-card-bordered rounded-2xl p-5 space-y-3"
      >
        <h2 id="debug-outbox-scope" className="text-sm font-semibold t-text">{t('debugOutbox.scopeTitle')}</h2>
        <ul className="text-sm t-text-body space-y-2 list-disc pl-5">
          <li>{t('debugOutbox.scope1')}</li>
          <li>{t('debugOutbox.scope2')}</li>
          <li>{t('debugOutbox.scope3')}</li>
        </ul>
      </section>

      <div
        role="status"
        className="rounded-2xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 p-4 flex items-start gap-3"
      >
        <Info className="w-5 h-5 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" aria-hidden />
        <div className="text-sm text-blue-900 dark:text-blue-200">
          <p className="font-semibold">{t('debugOutbox.pendingTitle')}</p>
          <p className="mt-1 text-xs text-blue-800 dark:text-blue-300">{t('debugOutbox.pendingDesc')}</p>
        </div>
      </div>
    </div>
  );
}
