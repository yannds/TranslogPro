/**
 * PageDebugWorkflow — Diagnostic des workflows (SUPPORT_L2 / SUPER_ADMIN)
 *
 * Permission : data.workflow.debug.global
 *
 * Cette page expose l'état runtime des machines à états UWE (Unified Workflow
 * Engine) pour les escalades L2. L'endpoint backend `/api/workflow/debug/...`
 * n'est pas encore exposé publiquement — la page présente donc la trame et
 * l'état « prévu » plutôt que de falsifier des données.
 *
 * Quand le backend sera prêt, remplacer `useFetch(null, ...)` par l'URL réelle
 * et dé-commenter la grille d'affichage des machines.
 */

import { useAuth }   from '../../lib/auth/auth.context';
import { useI18n }    from '../../lib/i18n/useI18n';
import { Bug, ShieldAlert, Info } from 'lucide-react';

const P_WORKFLOW_DEBUG = 'data.workflow.debug.global';

export function PageDebugWorkflow() {
  const { user } = useAuth();
  const { t }    = useI18n();
  const allowed  = (user?.permissions ?? []).includes(P_WORKFLOW_DEBUG);

  if (!allowed) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <div role="status" className="t-card-bordered rounded-2xl p-6 max-w-md text-center space-y-2">
          <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto" aria-hidden />
          <p className="text-sm t-text-2">{t('debugWf.notAllowed')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <header className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
          <Bug className="w-5 h-5 text-amber-700 dark:text-amber-300" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold t-text">{t('debugWf.title')}</h1>
          <p className="text-sm t-text-2">{t('debugWf.subtitle')}</p>
        </div>
      </header>

      <section
        role="region"
        aria-labelledby="debug-wf-scope"
        className="t-card-bordered rounded-2xl p-5 space-y-3"
      >
        <h2 id="debug-wf-scope" className="text-sm font-semibold t-text">{t('debugWf.scopeTitle')}</h2>
        <ul className="text-sm t-text-body space-y-2 list-disc pl-5">
          <li>{t('debugWf.scope1')}</li>
          <li>{t('debugWf.scope2')}</li>
          <li>{t('debugWf.scope3')}</li>
        </ul>
      </section>

      <div
        role="status"
        className="rounded-2xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 p-4 flex items-start gap-3"
      >
        <Info className="w-5 h-5 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" aria-hidden />
        <div className="text-sm text-blue-900 dark:text-blue-200">
          <p className="font-semibold">{t('debugWf.pendingTitle')}</p>
          <p className="mt-1 text-xs text-blue-800 dark:text-blue-300">{t('debugWf.pendingDesc')}</p>
        </div>
      </div>
    </div>
  );
}
