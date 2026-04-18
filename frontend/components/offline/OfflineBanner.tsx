/**
 * OfflineBanner — Bandeau discret affiché quand :
 *   1. le browser passe en offline, OU
 *   2. des mutations sont en attente de sync dans la outbox.
 *
 * A11y : role="status" + aria-live="polite" pour que les lecteurs d'écran
 * annoncent le basculement sans interrompre le flux.
 */

import { useEffect, useState } from 'react';
import { CloudOff, CloudUpload, RefreshCcw } from 'lucide-react';
import { useOnline } from '../../lib/offline/online';
import { countPending, flushOutbox } from '../../lib/offline/outbox';
import { useI18n } from '../../lib/i18n/useI18n';

export function OfflineBanner() {
  const { t } = useI18n();
  const online = useOnline();
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function tick() {
      const n = await countPending();
      if (mounted) setPending(n);
    }
    tick();
    const id = setInterval(tick, 5_000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  if (online && pending === 0) return null;

  async function retry() {
    setSyncing(true);
    try { await flushOutbox(); } finally { setSyncing(false); }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`sticky top-0 z-40 flex items-center gap-2 px-4 py-2 text-sm
        ${!online
          ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'
          : 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200'}
      `}
    >
      {!online ? (
        <>
          <CloudOff className="w-4 h-4 shrink-0" aria-hidden />
          <span>{t('offline.bannerOffline')}</span>
          {pending > 0 && (
            <span className="ml-2 rounded-full bg-amber-200 dark:bg-amber-800 px-2 py-0.5 text-xs">
              {t('offline.pendingCount', { n: String(pending) })}
            </span>
          )}
        </>
      ) : (
        <>
          <CloudUpload className="w-4 h-4 shrink-0" aria-hidden />
          <span>{t('offline.bannerSyncing', { n: String(pending) })}</span>
          <button
            type="button"
            onClick={retry}
            disabled={syncing}
            className="ml-auto inline-flex items-center gap-1 rounded-md bg-sky-200 dark:bg-sky-800 px-2 py-1 text-xs font-medium disabled:opacity-50"
            aria-label={t('offline.retryNow')}
          >
            <RefreshCcw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} aria-hidden />
            {t('offline.retryNow')}
          </button>
        </>
      )}
    </div>
  );
}
