/**
 * PageImpersonation — Impersonation JIT (Just-In-Time)
 *
 * Flux PRD §IV.12 :
 *   1. L'agent plateforme (SA / L1 / L2) sélectionne un tenant cible et une raison
 *   2. POST /iam/impersonate → reçoit un token HMAC-SHA256 (TTL 15 min, one-shot)
 *   3. Le token est échangé sur {target}.translog.test/api/auth/impersonate/exchange
 *      qui pose un cookie session scopé → l'acteur reste connecté sur ce tenant
 *      jusqu'au TTL ou jusqu'à révocation explicite/pagehide.
 *   4. Une section "Mes sessions actives" liste les tenants accessibles
 *      immédiatement (cookie déjà posé) — le bouton "Rejoindre" n'appelle PAS
 *      l'API, il ouvre simplement {target}.translog.test/admin.
 *   5. Création d'une session pour un tenant déjà actif → auto-révoque la
 *      précédente (règle UX : une session active par tenant par acteur).
 *
 * Permissions :
 *   - switch  (P_IMPERSONATION_SWITCH_GLOBAL)  : SUPER_ADMIN, SUPPORT_L1, SUPPORT_L2
 *   - revoke  (P_IMPERSONATION_REVOKE_GLOBAL)  : SUPER_ADMIN, SUPPORT_L2 uniquement
 *   - terminate-self : accessible à tout acteur sur sa PROPRE session (utilisé
 *     par le bouton "Terminer" du banner) — guardé par switch.global + check
 *     actorId serveur-side.
 */

import { useState, useEffect, useMemo, type FormEvent } from 'react';
import {
  UserCheck, Building2, Clock, Copy, Check, AlertTriangle,
  RefreshCw, Trash2, ShieldAlert, ExternalLink, LogIn,
} from 'lucide-react';
import { useFetch }                  from '../../lib/hooks/useFetch';
import { apiPost, apiDelete }         from '../../lib/api';
import { useAuth }                   from '../../lib/auth/auth.context';
import { useI18n }                    from '../../lib/i18n/useI18n';
import { Button }                    from '../ui/Button';
import { Badge }                     from '../ui/Badge';
import { Dialog }                    from '../ui/Dialog';
import DataTableMaster, { type Column } from '../DataTableMaster';

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
  token:       string;
  sessionId:   string;
  expiresAt:   string;   // ISO
  redirectUrl: string;
  targetSlug:  string;
  message:     string;
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

interface MyActiveSession extends ActiveSession {
  status:       'ACTIVE' | 'EXCHANGED';
  targetTenant: { id: string; name: string; slug: string } | null;
}

interface MyActiveResponse {
  sessions: MyActiveSession[];
}

interface HistorySession {
  id:             string;
  actorId:        string;
  targetTenantId: string;
  status:         'ACTIVE' | 'EXCHANGED' | 'REVOKED' | 'EXPIRED';
  reason:         string | null;
  ipAddress:      string | null;
  createdAt:      string;
  expiresAt:      string;
  revokedAt:      string | null;
  revokedBy:      string | null;
  exchangedAt:    string | null;
  actor:          { id: string; email: string; name: string | null } | null;
}

interface HistoryResponse {
  sessions: HistorySession[];
}

// ─── Permissions ─────────────────────────────────────────────────────────────

const P_IMPERSONATION   = 'control.impersonation.switch.global';
const P_IMPERSONATE_REV = 'control.impersonation.revoke.global';

// Slug du tenant plateforme — jamais impersonable (règle backend + UX).
const PLATFORM_SLUG = '__platform__';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const inp = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30 disabled:opacity-50';

function formatRelative(expiresAtIso: string, now: number, t: (k: string) => string): string {
  const delta = new Date(expiresAtIso).getTime() - now;
  if (delta <= 0) return t('impersonation.expired');
  const m = Math.floor(delta / 60_000);
  const s = Math.floor((delta % 60_000) / 1000);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function buildTenantAdminUrl(slug: string): string {
  const host = typeof window !== 'undefined' ? window.location.host : '';
  const hostname = host.split(':')[0] ?? '';
  const port     = host.includes(':') ? `:${host.split(':')[1]}` : '';
  // Remplace le premier label (admin / __platform__) par le slug cible.
  const parts = hostname.split('.');
  if (parts.length >= 2) {
    parts[0] = slug;
    return `${window.location.protocol}//${parts.join('.')}${port}/admin`;
  }
  return `${window.location.protocol}//${slug}.${hostname}${port}/admin`;
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

// ─── TokenCountdown — variante proéminente pour le bloc token émis ─────────

function TokenCountdown({ expiresAt }: { expiresAt: string }) {
  const { t } = useI18n();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = formatRelative(expiresAt, now, t);
  const deltaMs   = new Date(expiresAt).getTime() - now;
  const expired   = deltaMs <= 0;
  const critical  = !expired && deltaMs <= 60_000;
  const color = expired
    ? 'text-red-600 dark:text-red-400'
    : critical
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-teal-700 dark:text-teal-200';
  return (
    <div
      role="timer"
      aria-live="polite"
      aria-label={t('impersonation.tokenExpiresIn')}
      className={`inline-flex items-center gap-1.5 text-lg font-mono font-semibold tabular-nums ${color}`}
    >
      <Clock className="w-4 h-4" aria-hidden />
      {remaining}
    </div>
  );
}

// ─── Composant principal ─────────────────────────────────────────────────────

export function PageImpersonation() {
  const { user } = useAuth();
  const { t, dateLocale } = useI18n();

  const canSwitch = (user?.permissions ?? []).includes(P_IMPERSONATION);
  const canRevoke = (user?.permissions ?? []).includes(P_IMPERSONATE_REV);

  // Tenants disponibles — on exclut le tenant plateforme lui-même (défense en
  // profondeur : le backend renvoie 403 mais on masque l'option côté UI pour
  // éviter les erreurs évitables).
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
  const [myRevoking,     setMyRevoking]     = useState<string | null>(null);

  // Token expired tick — désactive le bouton de bascule dès que le TTL est écoulé.
  const [tokenExpired,   setTokenExpired]   = useState(false);
  useEffect(() => {
    if (!result) { setTokenExpired(false); return; }
    const expiresAt = new Date(result.expiresAt).getTime();
    const check = () => setTokenExpired(Date.now() >= expiresAt);
    check();
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, [result]);

  // Mes sessions actives (tous tenants) — permet de rejoindre un tenant sur
  // lequel un cookie est déjà posé sans regénérer un token. Refetch après
  // chaque création / révocation.
  const {
    data: myActive,
    loading: lMy,
    refetch: refetchMy,
  } = useFetch<MyActiveResponse>(
    canSwitch ? '/api/iam/impersonate/my-active' : null,
  );

  // Sessions actives du tenant sélectionné (audit, L2/SA seulement)
  const { data: sessions, loading: lSess, refetch: refetchSess, error: sErr } =
    useFetch<ActiveSessionsResponse>(
      canRevoke && targetTenantId ? `/api/iam/impersonate/${targetTenantId}/active` : null,
      [targetTenantId],
    );

  // Historique complet (tous statuts) du tenant sélectionné — même scope RBAC
  // que la vue active (L2/SA). Affiche les 200 dernières entrées : ACTIVE,
  // EXCHANGED, REVOKED, EXPIRED — avec acteur, IP, raison.
  const { data: history, loading: lHist, refetch: refetchHist } =
    useFetch<HistoryResponse>(
      canRevoke && targetTenantId ? `/api/iam/impersonate/${targetTenantId}/history` : null,
      [targetTenantId],
    );

  const tenantOptions = useMemo(() =>
    (tenants ?? []).filter(tnt =>
      tnt.isActive &&
      tnt.provisionStatus === 'ACTIVE' &&
      tnt.slug !== PLATFORM_SLUG,
    ),
    [tenants],
  );

  // ── Colonnes DataTableMaster — historique sessions impersonation ─────────
  const historyColumns: Column<HistorySession>[] = [
    {
      key: 'status', header: t('impersonation.colStatus'), sortable: true, width: '110px',
      cellRenderer: (v) => (
        <Badge
          variant={
            v === 'ACTIVE'    ? 'info'    :
            v === 'EXCHANGED' ? 'success' :
            v === 'REVOKED'   ? 'danger'  : 'default'
          }
          size="sm"
        >
          {String(v)}
        </Badge>
      ),
    },
    {
      key: 'actorId', header: t('impersonation.colActor'), sortable: true,
      cellRenderer: (_v, row) => (
        <div className="min-w-0">
          <p className="t-text truncate max-w-[220px]">{row.actor?.name ?? row.actor?.email ?? '—'}</p>
          {row.actor?.email && row.actor.name && (
            <p className="text-[10px] t-text-3 truncate max-w-[220px]">{row.actor.email}</p>
          )}
        </div>
      ),
      csvValue: (_v, row) => row.actor?.email ?? row.actor?.name ?? row.actorId,
    },
    {
      key: 'reason', header: t('impersonation.colReason'), sortable: false,
      cellRenderer: (v) => (
        <span className="italic t-text-body block max-w-[260px] truncate">{(v as string | null) ?? '—'}</span>
      ),
    },
    {
      key: 'ipAddress', header: t('impersonation.colIp'), sortable: true, width: '140px',
      cellRenderer: (v) => <span className="font-mono text-xs">{(v as string | null) ?? '—'}</span>,
    },
    {
      key: 'createdAt', header: t('impersonation.colCreatedAt'), sortable: true, width: '150px',
      cellRenderer: (v) => (
        <span className="whitespace-nowrap text-xs">{new Date(v as string).toLocaleString(dateLocale, {
          day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
        })}</span>
      ),
      csvValue: (v) => new Date(v as string).toISOString(),
    },
    {
      key: 'expiresAt', header: t('impersonation.colEndedAt'), sortable: true, width: '150px',
      cellRenderer: (_v, row) => {
        const endedAt = row.revokedAt ?? (row.status === 'EXPIRED' ? row.expiresAt : null);
        return (
          <span className="whitespace-nowrap text-xs">
            {endedAt
              ? new Date(endedAt).toLocaleString(dateLocale, {
                  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
                })
              : '—'}
          </span>
        );
      },
      csvValue: (_v, row) => {
        const endedAt = row.revokedAt ?? (row.status === 'EXPIRED' ? row.expiresAt : null);
        return endedAt ? new Date(endedAt).toISOString() : '';
      },
    },
  ];

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
      refetchMy();
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
      refetchMy();
    } catch (err) {
      setActionErr((err as Error).message);
    } finally {
      setRevokeBusy(false);
    }
  };

  const handleTerminateMine = async (s: MyActiveSession) => {
    setMyRevoking(s.id);
    try {
      await apiDelete(`/api/iam/impersonate/${s.id}/self`);
      refetchMy();
    } catch (err) {
      setActionErr((err as Error).message);
    } finally {
      setMyRevoking(null);
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

  const mine = myActive?.sessions ?? [];

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

      {/* ── Mes sessions actives ────────────────────────────────────── */}
      <section
        className="t-card-bordered rounded-2xl p-5 space-y-3"
        aria-labelledby="imp-mine-title"
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 id="imp-mine-title" className="text-base font-semibold t-text flex items-center gap-2">
              <LogIn className="w-4 h-4 text-teal-700 dark:text-teal-300" aria-hidden />
              {t('impersonation.mineTitle')}
            </h2>
            <p className="text-xs t-text-2 mt-0.5">{t('impersonation.mineDesc')}</p>
          </div>
          <button
            type="button"
            onClick={() => refetchMy()}
            className="p-1.5 rounded-md t-text-2 hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            aria-label={t('common.refresh')}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${lMy ? 'animate-spin' : ''}`} aria-hidden />
          </button>
        </div>

        {mine.length === 0 && !lMy && (
          <p className="text-xs t-text-3 py-2">{t('impersonation.mineEmpty')}</p>
        )}

        {mine.length > 0 && (
          <ul role="list" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {mine.map(s => (
              <li
                key={s.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold t-text truncate">
                      {s.targetTenant?.name ?? s.targetTenantId}
                    </p>
                    <p className="text-[11px] font-mono t-text-3 truncate">
                      {s.targetTenant?.slug ?? '—'}
                    </p>
                  </div>
                  <Badge variant={s.status === 'EXCHANGED' ? 'success' : 'info'} size="sm">
                    {s.status === 'EXCHANGED' ? t('impersonation.statusExchanged') : t('impersonation.statusReady')}
                  </Badge>
                </div>
                {s.reason && (
                  <p className="text-[11px] italic t-text-body break-words line-clamp-2">« {s.reason} »</p>
                )}
                <div className="flex items-center justify-between pt-1 border-t border-slate-200 dark:border-slate-800">
                  <Countdown expiresAt={s.expiresAt} />
                  <span className="text-[10px] t-text-3">
                    {new Date(s.createdAt).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="flex gap-2">
                  {s.targetTenant?.slug && s.status === 'EXCHANGED' && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => { window.location.href = buildTenantAdminUrl(s.targetTenant!.slug); }}
                      aria-label={t('impersonation.rejoinAria').replace('{tenant}', s.targetTenant!.name)}
                    >
                      <ExternalLink className="w-3.5 h-3.5 mr-1" aria-hidden />
                      {t('impersonation.rejoin')}
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-900 dark:hover:bg-red-950/30"
                    onClick={() => void handleTerminateMine(s)}
                    disabled={myRevoking === s.id}
                    aria-label={t('impersonation.terminateMineAria')}
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

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
                <div className="shrink-0 text-right">
                  <div className="text-[10px] uppercase tracking-wide text-teal-700 dark:text-teal-400 font-semibold">
                    {t('impersonation.tokenExpiresIn')}
                  </div>
                  <TokenCountdown expiresAt={result.expiresAt} />
                </div>
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
              <div className="pt-1">
                <Button
                  type="button"
                  onClick={() => { window.location.href = result.redirectUrl; }}
                  disabled={tokenExpired}
                  className="w-full justify-center bg-teal-600 hover:bg-teal-700 text-white border-teal-600 disabled:opacity-50"
                  aria-label={t('impersonation.switchNowAria')}
                >
                  <ExternalLink className="w-4 h-4 mr-1.5" aria-hidden />
                  {t('impersonation.switchNow')} <span className="font-mono ml-1.5 opacity-90">{result.targetSlug}</span>
                </Button>
                <p className="text-[11px] text-teal-700 dark:text-teal-300 mt-1.5">
                  {t('impersonation.switchNowHint')}
                </p>
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

      {/* ── Historique par tenant (tous statuts, L2/SA) ─────────────────── */}
      {canRevoke && targetTenantId && (
        <section
          className="t-card-bordered rounded-2xl p-5 space-y-3"
          aria-labelledby="imp-history-title"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 id="imp-history-title" className="text-base font-semibold t-text">
                {t('impersonation.historyTitle')}
              </h2>
              <p className="text-xs t-text-2 mt-0.5">{t('impersonation.historyDesc')}</p>
            </div>
            <button
              type="button"
              onClick={() => refetchHist()}
              className="p-1.5 rounded-md t-text-2 hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
              aria-label={t('common.refresh')}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${lHist ? 'animate-spin' : ''}`} aria-hidden />
            </button>
          </div>

          {(history?.sessions.length ?? 0) === 0 && !lHist && (
            <p className="text-xs t-text-3 py-2">{t('impersonation.historyEmpty')}</p>
          )}

          {history && history.sessions.length > 0 && (
            <DataTableMaster<HistorySession>
              columns={historyColumns}
              data={history.sessions}
              loading={lHist}
              defaultSort={{ key: 'createdAt', dir: 'desc' }}
              defaultPageSize={25}
              searchPlaceholder={t('impersonation.searchHistory')}
              emptyMessage={t('impersonation.historyEmpty')}
              exportFormats={['csv']}
              exportFilename="impersonation-history"
            />
          )}
        </section>
      )}

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
