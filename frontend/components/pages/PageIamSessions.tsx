/**
 * PageIamSessions — Sessions actives du tenant
 *
 * Fonctionnalités :
 *   - Table des sessions actives (non expirées)
 *   - Informations : utilisateur, IP, user-agent, créée le, expire le
 *   - Révoquer une session individuelle
 *   - Actualisation manuelle
 */
import { useState, useCallback } from 'react';
import { KeyRound, RefreshCw, Trash2, Monitor, Smartphone } from 'lucide-react';
import { useAuth }    from '../../lib/auth/auth.context';
import { useFetch }   from '../../lib/hooks/useFetch';
import { apiDelete, ApiError } from '../../lib/api';
import { Button }     from '../ui/Button';
import { Dialog }     from '../ui/Dialog';
import { Skeleton }   from '../ui/Skeleton';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionUser { id: string; email: string; name: string }
interface Session {
  id:          string;
  ipAddress?:  string;
  userAgent?:  string;
  createdAt:   string;
  expiresAt:   string;
  user:        SessionUser;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function isMobile(ua?: string) {
  if (!ua) return false;
  return /mobile|android|iphone|ipad/i.test(ua);
}

function uaShort(ua?: string) {
  if (!ua) return '—';
  // Extract browser / OS summary
  const browser = ua.match(/(?:Chrome|Firefox|Safari|Edge|Opera)[/ ]([\d.]+)/i);
  const os = ua.match(/\(([^)]+)\)/)?.[1]?.split(';')[0] ?? '';
  return browser ? `${browser[0]} · ${os}` : ua.slice(0, 60);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function PageIamSessions() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/v1/tenants/${tenantId}/iam`;

  const [rev, setRev]                   = useState(0);
  const reload                          = useCallback(() => setRev(r => r + 1), []);

  const { data: sessionsData, loading } = useFetch<Session[]>(`${base}/sessions`, [rev]);
  const sessions                        = sessionsData ?? [];

  const [target, setTarget]             = useState<Session | null>(null);
  const [revoking, setRevoking]         = useState(false);
  const [err, setErr]                   = useState('');

  async function handleRevoke() {
    setRevoking(true); setErr('');
    try {
      await apiDelete(`${base}/sessions/${target!.id}`);
      setTarget(null);
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? String((e.body as any)?.message ?? e.message) : 'Erreur');
    } finally { setRevoking(false); }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <KeyRound size={24} className="text-indigo-400" />
            Sessions actives
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            {loading ? 'Chargement…' : `${sessions.length} session(s) ouverte(s)`}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={reload} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span className="ml-1">Actualiser</span>
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-slate-400">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Utilisateur</th>
              <th className="text-left px-4 py-3 font-medium">Appareil / Navigateur</th>
              <th className="text-left px-4 py-3 font-medium">IP</th>
              <th className="text-left px-4 py-3 font-medium">Créée le</th>
              <th className="text-left px-4 py-3 font-medium">Expire le</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading && Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="bg-slate-900">
                {Array.from({ length: 6 }).map((__, j) => (
                  <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                ))}
              </tr>
            ))}
            {!loading && sessions.map(session => {
              const mobile = isMobile(session.userAgent);
              const isOwn  = session.user.id === user?.id;
              return (
                <tr key={session.id} className="bg-slate-900 hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-white flex items-center gap-1.5">
                        {session.user.name}
                        {isOwn && (
                          <span className="text-xs text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 rounded px-1.5 py-0.5">
                            vous
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500">{session.user.email}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {mobile
                        ? <Smartphone size={13} className="text-slate-400 shrink-0" />
                        : <Monitor size={13} className="text-slate-400 shrink-0" />}
                      <span className="text-xs text-slate-400 max-w-[220px] truncate">
                        {uaShort(session.userAgent)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">
                    {session.ipAddress ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                    {formatDate(session.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                    {formatDate(session.expiresAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => { setTarget(session); setErr(''); }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-900/20 transition-colors"
                      title="Révoquer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {!loading && sessions.length === 0 && (
              <tr className="bg-slate-900">
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  Aucune session active
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Revoke confirm */}
      <Dialog
        open={!!target}
        onOpenChange={o => { if (!o) setTarget(null); }}
        title="Révoquer la session"
        description="L'utilisateur sera déconnecté immédiatement."
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setTarget(null)}>Annuler</Button>
            <Button variant="destructive" size="sm" onClick={handleRevoke} disabled={revoking}>
              {revoking ? 'Révocation…' : 'Révoquer'}
            </Button>
          </>
        }
      >
        {target && (
          <div className="space-y-2 text-sm text-slate-300">
            <p><strong className="text-white">{target.user.name}</strong> ({target.user.email})</p>
            <p className="text-slate-400">IP : {target.ipAddress ?? '—'}</p>
            {err && <p className="text-red-400 text-xs">{err}</p>}
          </div>
        )}
      </Dialog>
    </div>
  );
}
