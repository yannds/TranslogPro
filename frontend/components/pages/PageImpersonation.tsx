/**
 * PageImpersonation — Impersonation JIT (Just-In-Time)
 *
 * Flux PRD §IV.12 :
 *   1. L'agent plateforme (SA / L1 / L2) sélectionne un tenant cible et une raison
 *   2. POST /iam/impersonate → reçoit un token HMAC-SHA256 (TTL 15 min, non-renouvelable)
 *   3. Le token est affiché UNE SEULE FOIS (audit) — l'agent le copie
 *   4. Les requêtes suivantes utilisent le header X-Impersonation-Token
 *
 * Permissions :
 *   - switch  (P_IMPERSONATION_SWITCH_GLOBAL)  : SUPER_ADMIN, SUPPORT_L1, SUPPORT_L2
 *   - revoke  (P_IMPERSONATION_REVOKE_GLOBAL)  : SUPER_ADMIN, SUPPORT_L2 uniquement
 *
 * Les agents sans `revoke` voient la liste des sessions MAIS sans bouton révoquer.
 * Le backend renvoie 403 si la permission manque — on masque l'action côté UI
 * en défense en profondeur.
 *
 * Security :
 *   - Token jamais logué (console.log retiré)
 *   - Copy-to-clipboard respecte les permissions navigator.clipboard
 *   - Countdown visible pour avertir de l'expiration
 */

import { useState, useEffect, useMemo, type FormEvent } from 'react';
import {
  UserCheck, Building2, Clock, Copy, Check, AlertTriangle,
  RefreshCw, Trash2, ShieldAlert,
} from 'lucide-react';
import { useFetch }                  from '../../lib/hooks/useFetch';
import { apiPost, apiDelete }         from '../../lib/api';
import { useAuth }                   from '../../lib/auth/auth.context';
import { useI18n }                    from '../../lib/i18n/useI18n';
import { Button }                    from '../ui/Button';
import { Badge }                     from '../ui/Badge';
import { Dialog }                    from '../ui/Dialog';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TenantSummary {
  id:              string;
  name:            string;
  slug:            string;
  country:         string;
  provisionStatus: string;
  isActive:        boolean;
}

interface SwitchResponse {
  token:     string;
  sessionId: string;
  expiresAt: string;   // ISO
  message:   string;
}

interface ActiveSession {
  id:             string;
  actorId:        string;
  targetTenantId: string;
  reason:         string | null;
  ipAddress:      string | null;
  createdAt:      string;
  expiresAt:      string;
}

interface ActiveSessionsResponse {
  sessions: ActiveSession[];
}

// ─── Permissions ─────────────────────────────────────────────────────────────

const P_IMPERSONATION   = 'control.impersonation.switch.global';
const P_IMPERSONATE_REV = 'control.impersonation.revoke.global';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const inp = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30 disabled:opacity-50';

function formatRelative(expiresAtIso: string, now: number, t: (k: string) => string): string {
  const delta = new Date(expiresAtIso).getTime() - now;
  if (delta <= 0) return t('impersonation.expired');
  const m = Math.floor(delta / 60_000);
  const s = Math.floor((delta % 60_000) / 1000);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

// ─── Countdown component (ré-affiche chaque seconde sans re-fetch) ──────────

function Countdown({ expiresAt }: { expiresAt: string }) {
  const { t } = useI18n();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = formatRelative(expiresAt, now, t);
  const expired   = new Date(expiresAt).getTime() <= now;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-mono ${expired ? 'text-red-600 dark:text-red-400' : 't-text-2'}`}
      aria-live="polite"
    >
      <Clock className="w-3.5 h-3.5" aria-hidden />
      {remaining}
    </span>
  );
}

// ─── Composant principal ─────────────────────────────────────────────────────

export function PageImpersonation() {
  const { user } = useAuth();
  const { t, dateLocale } = useI18n();

  const canSwitch = (user?.permissions ?? []).includes(P_IMPERSONATION);
  const canRevoke = (user?.permissions ?? []).includes(P_IMPERSONATE_REV);

  // Tenants disponibles (le backend retourne 403 si l'agent n'a pas tenant.manage ;
  // on tente quand même et on retombe sur un input texte libre si liste indisponible).
  const { data: tenants, loading: lTenants, error: tErr } = useFetch<TenantSummary[]>(
    canSwitch ? '/api/tenants' : null,
  );

  const [targetTenantId, setTargetTenantId] = useState('');
  const [reason,         setReason]         = useState('');
  const [busy,           setBusy]           = useState(false);
  const [result,         setResult]         = useState<SwitchResponse | null>(null);
  const [actionErr,      setActionErr]      = useState<string | null>(null);
  const [copied,         setCopied]         = useState(false);

  const [revokeTarget,   setRevokeTarget]   = useState<ActiveSession | null>(null);
  const [revokeBusy,     setRevokeBusy]     = useState(false);

  // Sessions actives du tenant en question (si sélectionné ET revoke perm)
  const { data: sessions, loading: lSess, refetch: refetchSess, error: sErr } =
    useFetch<ActiveSessionsResponse>(
      canRevoke && targetTenantId ? `/api/iam/impersonate/${targetTenantId}/active` : null,
      [targetTenantId],
    );

  const tenantOptions = useMemo(() =>
    (tenants ?? []).filter(tnt => tnt.isActive && tnt.provisionStatus === 'ACTIVE'),
    [tenants],
  );

  const handleSwitch = async (e: FormEvent) => {
    e.preventDefault();
    if (!targetTenantId) return;
    setBusy(true); setActionErr(null); setResult(null); setCopied(false);
    try {
      const res = await apiPost<SwitchResponse>('/api/iam/impersonate', {
        targetTenantId,
        reason: reason.trim() || undefined,
      });
      setResult(res);
      refetchSess();
    } catch (err) {
      setActionErr((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCopyToken = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setActionErr(t('impersonation.copyFailed'));
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setRevokeBusy(true);
    try {
      await apiDelete(`/api/iam/impersonate/${revokeTarget.id}`);
      setRevokeTarget(null);
      refetchSess();
    } catch (err) {
      setActionErr((err as Error).message);
    } finally {
      setRevokeBusy(false);
    }
  };

  if (!canSwitch) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <div role="status" className="t-card-bordered rounded-2xl p-6 max-w-md text-center space-y-2">
          <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto" aria-hidden />
          <p className="text-sm t-text-2">{t('impersonation.notAllowed')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* En-tête */}
      <header className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
          <UserCheck className="w-5 h-5 text-teal-700 dark:text-teal-300" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold t-text">{t('impersonation.title')}</h1>
          <p className="text-sm t-text-2">{t('impersonation.subtitle')}</p>
        </div>
      </header>

      {/* Grid 2 colonnes desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Formulaire switch — 2/3 */}
        <section
          className="lg:col-span-2 t-card-bordered rounded-2xl p-5 space-y-4"
          aria-labelledby="imp-switch-title"
        >
          <div>
            <h2 id="imp-switch-title" className="text-base font-semibold t-text">
              {t('impersonation.switchTitle')}
            </h2>
            <p className="text-xs t-text-2 mt-1">{t('impersonation.switchDesc')}</p>
          </div>

          {actionErr && (
            <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
              {actionErr}
            </div>
          )}

          <form onSubmit={handleSwitch} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="imp-tenant" className="block text-sm font-medium t-text">
                {t('impersonation.targetTenant')} <span aria-hidden className="text-red-500">*</span>
              </label>
              {lTenants ? (
                <div className={`${inp} animate-pulse h-10`} aria-busy />
              ) : tErr ? (
                <input
                  id="imp-tenant" type="text" required
                  value={targetTenantId}
                  onChange={e => setTargetTenantId(e.target.value.trim())}
                  className={`${inp} font-mono`} disabled={busy}
                  placeholder="uuid-du-tenant-cible"
                  pattern="[0-9a-fA-F-]{36}"
                  title={t('impersonation.uuidFormat')}
                />
              ) : (
                <select
                  id="imp-tenant" required
                  value={targetTenantId}
                  onChange={e => setTargetTenantId(e.target.value)}
                  className={inp} disabled={busy}
                >
                  <option value="">{t('impersonation.selectTenant')}</option>
                  {tenantOptions.map(tnt => (
                    <option key={tnt.id} value={tnt.id}>
                      {tnt.name} — {tnt.slug} ({tnt.country})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="imp-reason" className="block text-sm font-medium t-text">
                {t('impersonation.reason')}
              </label>
              <input
                id="imp-reason" type="text" maxLength={500}
                value={reason} onChange={e => setReason(e.target.value)}
                className={inp} disabled={busy}
                placeholder={t('impersonation.reasonPh')}
              />
              <p className="text-[11px] t-text-3">{t('impersonation.reasonHint')}</p>
            </div>

            <div role="note" className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
              <span>{t('impersonation.auditWarning')}</span>
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={busy || !targetTenantId}>
                <UserCheck className="w-4 h-4 mr-1.5" aria-hidden />
                {busy ? t('impersonation.creating') : t('impersonation.createSession')}
              </Button>
            </div>
          </form>

          {/* Résultat — token affiché UNE FOIS */}
          {result && (
            <div
              role="region"
              aria-labelledby="imp-token-title"
              className="mt-2 rounded-lg bg-teal-50 dark:bg-teal-950/30 border border-teal-300 dark:border-teal-800 p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 id="imp-token-title" className="text-sm font-semibold text-teal-900 dark:text-teal-100">
                    {t('impersonation.tokenIssued')}
                  </h3>
                  <p className="text-xs text-teal-800 dark:text-teal-300 mt-0.5">{result.message}</p>
                </div>
                <Countdown expiresAt={result.expiresAt} />
              </div>
              <div className="rounded-md bg-white dark:bg-slate-900 border border-teal-200 dark:border-teal-900 p-2 flex items-center gap-2">
                <code className="flex-1 text-[11px] font-mono break-all text-slate-700 dark:text-slate-200">
                  {result.token}
                </code>
                <Button type="button" variant="outline" size="sm" onClick={handleCopyToken}>
                  {copied
                    ? <><Check className="w-3.5 h-3.5 mr-1" aria-hidden />{t('impersonation.copied')}</>
                    : <><Copy className="w-3.5 h-3.5 mr-1" aria-hidden />{t('impersonation.copy')}</>}
                </Button>
              </div>
              <p className="text-[11px] text-teal-700 dark:text-teal-300">
                {t('impersonation.tokenNotice')}
              </p>
            </div>
          )}
        </section>

        {/* Sessions actives — 1/3 (L2/SA seulement) */}
        <aside
          className="t-card-bordered rounded-2xl p-5 space-y-3"
          aria-labelledby="imp-sessions-title"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 id="imp-sessions-title" className="text-base font-semibold t-text">
              {t('impersonation.activeSessions')}
            </h2>
            <button
              type="button"
              onClick={() => refetchSess()}
              className="p-1.5 rounded-md t-text-2 hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
              aria-label={t('common.refresh')}
              disabled={!targetTenantId}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${lSess ? 'animate-spin' : ''}`} aria-hidden />
            </button>
          </div>

          {!targetTenantId && (
            <p className="text-xs t-text-3 py-3">{t('impersonation.selectToView')}</p>
          )}

          {!canRevoke && targetTenantId && (
            <p className="text-xs t-text-3">{t('impersonation.noRevokePerm')}</p>
          )}

          {canRevoke && targetTenantId && sErr && (
            <p className="text-xs text-red-600 dark:text-red-400">{sErr}</p>
          )}

          {canRevoke && targetTenantId && sessions && sessions.sessions.length === 0 && (
            <p className="text-xs t-text-3 py-3">{t('impersonation.noActive')}</p>
          )}

          {canRevoke && sessions && sessions.sessions.length > 0 && (
            <ul role="list" className="space-y-2">
              {sessions.sessions.map(s => (
                <li
                  key={s.id}
                  className="rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="info" size="sm">
                      <Building2 className="w-3 h-3 mr-1" aria-hidden />
                      {s.actorId.slice(0, 8)}
                    </Badge>
                    <Countdown expiresAt={s.expiresAt} />
                  </div>
                  {s.reason && (
                    <p className="t-text-body italic break-words">{s.reason}</p>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="t-text-3">
                      {new Date(s.createdAt).toLocaleString(dateLocale, {
                        hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short',
                      })}
                    </span>
                    <button
                      type="button"
                      onClick={() => setRevokeTarget(s)}
                      className="inline-flex items-center gap-1 text-red-600 hover:text-red-700 dark:text-red-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded px-1"
                      aria-label={t('impersonation.revokeSessionAria')}
                    >
                      <Trash2 className="w-3 h-3" aria-hidden />
                      {t('impersonation.revoke')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {/* Dialog confirmation révocation */}
      <Dialog
        open={!!revokeTarget}
        onOpenChange={o => { if (!o) setRevokeTarget(null); }}
        title={t('impersonation.confirmRevoke')}
        description={revokeTarget?.reason ?? ''}
        footer={
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setRevokeTarget(null)} disabled={revokeBusy}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleRevoke}
              disabled={revokeBusy}
              className="bg-red-600 hover:bg-red-700 text-white border-red-600"
            >
              <Trash2 className="w-4 h-4 mr-1.5" aria-hidden />
              {revokeBusy ? t('impersonation.revoking') : t('impersonation.revoke')}
            </Button>
          </div>
        }
      >
        <p className="text-sm t-text-body">{t('impersonation.revokeWarning')}</p>
      </Dialog>
    </div>
  );
}
