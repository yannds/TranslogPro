/**
 * ImpersonationBanner — bandeau sticky persistant pour toute session JIT,
 * visible des deux côtés du flux :
 *
 *   (A) Sur le sous-domaine cible ({target}.translog.test) : `user.impersonation`
 *       est défini par /api/auth/me (la Session cookie porte Session.tenantId
 *       = target). On affiche le tenant courant + chrono + bouton Terminer.
 *       Auto-revoke sur `pagehide` pour que la fermeture de l'onglet ne laisse
 *       pas un cookie actif sur le sous-domaine.
 *
 *   (B) Sur le portail plateforme (admin.translog.test) : `user.impersonation`
 *       est absent mais l'acteur a potentiellement des sessions actives sur
 *       d'autres sous-domaines. On fetch /api/iam/impersonate/my-active et on
 *       affiche une ligne par session — avec Rejoindre (navigue vers
 *       {target}/admin, cookie déjà posé) et Terminer (self-service).
 *
 * Masquage manuel : bouton X, persisté en sessionStorage sur l'ID de session.
 * Réapparaît si une nouvelle session est créée (ID différent) ou au reload.
 *
 * Security : l'endpoint `:sessionId/self` ne requiert que
 * control.impersonation.switch.global et vérifie serveur-side que
 * l'acteur courant == session.actorId.
 *
 * WCAG : role="status" + aria-live, chrono annoncé, bouton Terminer labellé,
 * contraste AA light+dark.
 */
import { useEffect, useState, useCallback } from 'react';
import { ShieldAlert, Clock, X, LogOut, ExternalLink } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiDelete } from '../../lib/api';
import { buildTenantUrl } from '../../lib/tenancy/host';

const HIDE_STORAGE_KEY = 'translog.impersonation.hidden';

const P_IMPERSONATION = 'control.impersonation.switch.global';

interface MyActiveSession {
  id:             string;
  actorId:        string;
  targetTenantId: string;
  status:         'ACTIVE' | 'EXCHANGED';
  reason:         string | null;
  createdAt:      string;
  expiresAt:      string;
  targetTenant:   { id: string; name: string; slug: string } | null;
}

interface MyActiveResponse {
  sessions: MyActiveSession[];
}

function formatRemaining(expiresAtIso: string, now: number): { text: string; expired: boolean; critical: boolean } {
  const delta = new Date(expiresAtIso).getTime() - now;
  if (delta <= 0) return { text: '00:00', expired: true, critical: true };
  const m = Math.floor(delta / 60_000);
  const s = Math.floor((delta % 60_000) / 1000);
  return {
    text:     `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
    expired:  false,
    critical: delta <= 60_000,
  };
}

function toneFor(expired: boolean, critical: boolean) {
  if (expired) return 'bg-red-100 dark:bg-red-950/50 border-red-300 dark:border-red-800 text-red-900 dark:text-red-200';
  if (critical) return 'bg-amber-100 dark:bg-amber-950/50 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200';
  return 'bg-indigo-100 dark:bg-indigo-950/50 border-indigo-300 dark:border-indigo-800 text-indigo-900 dark:text-indigo-200';
}

export function ImpersonationBanner() {
  const { user }      = useAuth();
  const { t }         = useI18n();
  const imp           = user?.impersonation;
  const canImpersonate = (user?.permissions ?? []).includes(P_IMPERSONATION);

  const [now, setNow]       = useState(Date.now());
  const [hidden, setHidden] = useState<Set<string>>(() => {
    if (typeof sessionStorage === 'undefined') return new Set();
    try {
      const raw = sessionStorage.getItem(HIDE_STORAGE_KEY);
      return new Set(raw ? JSON.parse(raw) as string[] : []);
    } catch { return new Set(); }
  });
  const [ending, setEnding] = useState<string | null>(null);

  // Tick 1s — toujours monté, on évite une boucle de re-fetch.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Source (A) — session courante si on est sur le tenant cible.
  // Source (B) — my-active pour voir toutes les sessions de l'acteur, utile
  // depuis le portail plateforme. On évite de fetcher si l'acteur n'a pas la
  // permission switch (CUSTOMER, tenants clients).
  const { data: myActive, refetch: refetchMy } = useFetch<MyActiveResponse>(
    canImpersonate ? '/api/iam/impersonate/my-active' : null,
    [user?.id ?? ''],
  );

  // Auto-refetch périodique (30s) pour détecter nouvelles sessions ou
  // expirations — coût API négligeable (1 query indexée).
  useEffect(() => {
    if (!canImpersonate) return;
    const id = setInterval(() => refetchMy(), 30_000);
    return () => clearInterval(id);
  }, [canImpersonate, refetchMy]);

  // Auto-revoke sur fermeture réelle de l'onglet — actif uniquement côté
  // tenant cible (où le cookie d'impersonation existe).
  useEffect(() => {
    if (!imp) return;
    const handler = (e: PageTransitionEvent) => {
      if (e.persisted) return;
      const url = `/api/iam/impersonate/${encodeURIComponent(imp.sessionId)}/self`;
      try {
        fetch(url, { method: 'DELETE', credentials: 'include', keepalive: true }).catch(() => {});
      } catch { /* noop */ }
    };
    window.addEventListener('pagehide', handler);
    return () => window.removeEventListener('pagehide', handler);
  }, [imp]);

  const persistHidden = useCallback((next: Set<string>) => {
    if (typeof sessionStorage !== 'undefined') {
      try { sessionStorage.setItem(HIDE_STORAGE_KEY, JSON.stringify([...next])); }
      catch { /* quota — ignore */ }
    }
    setHidden(next);
  }, []);

  const handleHide = useCallback((sessionId: string) => {
    const next = new Set(hidden);
    next.add(sessionId);
    persistHidden(next);
  }, [hidden, persistHidden]);

  const handleTerminate = useCallback(async (sessionId: string, redirectAfter: boolean) => {
    if (ending) return;
    setEnding(sessionId);
    try {
      await apiDelete(`/api/iam/impersonate/${sessionId}/self`);
    } catch { /* best-effort — UI continue */ }
    setEnding(null);
    if (redirectAfter) {
      // Sur le sous-domaine cible : la Session cookie vient d'être supprimée,
      // on renvoie l'acteur sur /login qui le ramènera sur admin.
      window.location.href = '/login';
    } else {
      refetchMy();
    }
  }, [ending, refetchMy]);

  const handleRejoin = useCallback((slug: string) => {
    // Cookie déjà posé sur le sous-domaine cible — navigation directe.
    window.location.href = buildTenantUrl(slug, '/admin');
  }, []);

  // ── Mode (A) — on est sur le tenant cible ───────────────────────────────
  if (imp) {
    if (hidden.has(imp.sessionId)) return null;
    const r = formatRemaining(imp.expiresAt, now);
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={t('impersonationBanner.ariaLabel')}
        className={`sticky top-0 z-40 border-b ${toneFor(r.expired, r.critical)}`}
      >
        <div className="flex flex-wrap items-center gap-3 px-4 py-2 text-xs sm:text-sm">
          <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden />
          <span className="font-semibold">{t('impersonationBanner.title')}</span>
          <span>
            {t('impersonationBanner.targetLabel')}{' '}
            <span className="font-mono font-semibold">{imp.targetSlug}</span>
          </span>
          {imp.reason && (
            <span className="hidden sm:inline italic opacity-80 truncate max-w-[30ch]">
              « {imp.reason} »
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 font-mono font-bold tabular-nums ml-auto">
            <Clock className="w-3.5 h-3.5" aria-hidden />
            {r.text}
          </span>
          <button
            type="button"
            onClick={() => handleTerminate(imp.sessionId, true)}
            disabled={ending === imp.sessionId}
            className="inline-flex items-center gap-1 rounded-md border border-current/40 px-2 py-1 text-xs font-medium hover:bg-white/40 dark:hover:bg-black/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-current disabled:opacity-50"
            aria-label={t('impersonationBanner.terminateAria')}
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden />
            {ending === imp.sessionId ? t('impersonationBanner.terminating') : t('impersonationBanner.terminate')}
          </button>
          <button
            type="button"
            onClick={() => handleHide(imp.sessionId)}
            className="rounded-md p-1 hover:bg-white/40 dark:hover:bg-black/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-current"
            aria-label={t('impersonationBanner.hideAria')}
            title={t('impersonationBanner.hideHint')}
          >
            <X className="w-3.5 h-3.5" aria-hidden />
          </button>
        </div>
      </div>
    );
  }

  // ── Mode (B) — on est ailleurs (admin portal), on montre les sessions
  //              actives de l'acteur pour permettre de rejoindre. ─────────
  const visible = (myActive?.sessions ?? []).filter(s => !hidden.has(s.id));
  if (!canImpersonate || visible.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('impersonationBanner.ariaLabelMy')}
      className="sticky top-0 z-40 border-b bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900"
    >
      <ul role="list" className="divide-y divide-indigo-200/60 dark:divide-indigo-900/60">
        {visible.map(s => {
          const r = formatRemaining(s.expiresAt, now);
          const slug = s.targetTenant?.slug ?? '';
          return (
            <li key={s.id} className={`${toneFor(r.expired, r.critical)} border-0`}>
              <div className="flex flex-wrap items-center gap-3 px-4 py-1.5 text-xs sm:text-sm">
                <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden />
                <span className="font-semibold">{t('impersonationBanner.mineTitle')}</span>
                <span>
                  {t('impersonationBanner.targetLabel')}{' '}
                  <span className="font-mono font-semibold">{slug || s.targetTenantId.slice(0, 8)}</span>
                </span>
                {s.reason && (
                  <span className="hidden md:inline italic opacity-80 truncate max-w-[24ch]">
                    « {s.reason} »
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 font-mono font-bold tabular-nums ml-auto">
                  <Clock className="w-3.5 h-3.5" aria-hidden />
                  {r.text}
                </span>
                {slug && (
                  <button
                    type="button"
                    onClick={() => handleRejoin(slug)}
                    className="inline-flex items-center gap-1 rounded-md border border-current/40 px-2 py-1 text-xs font-medium hover:bg-white/40 dark:hover:bg-black/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-current"
                    aria-label={t('impersonationBanner.rejoinAria').replace('{tenant}', s.targetTenant?.name ?? slug)}
                  >
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden />
                    {t('impersonationBanner.rejoin')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleTerminate(s.id, false)}
                  disabled={ending === s.id}
                  className="inline-flex items-center gap-1 rounded-md border border-current/40 px-2 py-1 text-xs font-medium hover:bg-white/40 dark:hover:bg-black/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-current disabled:opacity-50"
                  aria-label={t('impersonationBanner.terminateAria')}
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden />
                  {ending === s.id ? t('impersonationBanner.terminating') : t('impersonationBanner.terminate')}
                </button>
                <button
                  type="button"
                  onClick={() => handleHide(s.id)}
                  className="rounded-md p-1 hover:bg-white/40 dark:hover:bg-black/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-current"
                  aria-label={t('impersonationBanner.hideAria')}
                  title={t('impersonationBanner.hideHint')}
                >
                  <X className="w-3.5 h-3.5" aria-hidden />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
