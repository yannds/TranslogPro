/**
 * PageIamSessions — Sessions actives du tenant
 *
 * Fonctionnalités :
 *   - DataTableMaster : tri, recherche, pagination
 *   - Informations : utilisateur, IP, user-agent, créée le, expire le
 *   - Révoquer une session individuelle (row action + confirmation Dialog)
 */
import { useState, useCallback } from 'react';
import { KeyRound, RefreshCw, Trash2, Monitor, Smartphone } from 'lucide-react';
import { useAuth }    from '../../lib/auth/auth.context';
import { useFetch }   from '../../lib/hooks/useFetch';
import { apiDelete, ApiError } from '../../lib/api';
import { Button }     from '../ui/Button';
import { Dialog }     from '../ui/Dialog';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

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
  const browser = ua.match(/(?:Chrome|Firefox|Safari|Edge|Opera)[/ ]([\d.]+)/i);
  const os      = ua.match(/\(([^)]+)\)/)?.[1]?.split(';')[0] ?? '';
  return browser ? `${browser[0]} · ${os}` : ua.slice(0, 60);
}

// ─── Colonnes DataTableMaster ─────────────────────────────────────────────────

function buildColumns(currentUserId: string): Column<Session>[] {
  return [
    {
      key: 'user',
      header: 'Utilisateur',
      sortable: true,
      cellRenderer: (_v, row) => (
        <div>
          <p className="text-sm font-medium text-white flex items-center gap-1.5">
            {row.user.name}
            {row.user.id === currentUserId && (
              <span className="text-xs text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 rounded px-1.5 py-0.5">
                vous
              </span>
            )}
          </p>
          <p className="text-xs text-slate-500">{row.user.email}</p>
        </div>
      ),
      csvValue: (_v, row) => `${row.user.name} <${row.user.email}>`,
    },
    {
      key: 'userAgent',
      header: 'Appareil / Navigateur',
      cellRenderer: (v) => (
        <div className="flex items-center gap-1.5">
          {isMobile(String(v))
            ? <Smartphone size={13} className="text-slate-400 shrink-0" />
            : <Monitor size={13} className="text-slate-400 shrink-0" />}
          <span className="text-xs text-slate-400 max-w-[220px] truncate">
            {uaShort(v ? String(v) : undefined)}
          </span>
        </div>
      ),
      csvValue: (v) => uaShort(v ? String(v) : undefined),
    },
    {
      key: 'ipAddress',
      header: 'IP',
      sortable: true,
      width: '130px',
      cellRenderer: (v) => (
        <span className="font-mono text-xs text-slate-400">{v ? String(v) : '—'}</span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Créée le',
      sortable: true,
      width: '140px',
      cellRenderer: (v) => (
        <span className="text-xs text-slate-400 whitespace-nowrap">{formatDate(String(v))}</span>
      ),
      csvValue: (v) => formatDate(String(v)),
    },
    {
      key: 'expiresAt',
      header: 'Expire le',
      sortable: true,
      width: '140px',
      cellRenderer: (v) => (
        <span className="text-xs text-slate-400 whitespace-nowrap">{formatDate(String(v))}</span>
      ),
      csvValue: (v) => formatDate(String(v)),
    },
  ];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function PageIamSessions() {
  const { user }  = useAuth();
  const tenantId  = user?.tenantId ?? '';
  const base      = `/api/v1/tenants/${tenantId}/iam`;

  const [rev, setRev]                   = useState(0);
  const reload                          = useCallback(() => setRev(r => r + 1), []);

  const { data: sessionsData, loading } = useFetch<Session[]>(`${base}/sessions`, [rev]);
  const sessions                        = sessionsData ?? [];

  const [target,   setTarget]   = useState<Session | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [err,      setErr]      = useState('');

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

  const columns    = buildColumns(user?.id ?? '');
  const rowActions: RowAction<Session>[] = [
    {
      label:   'Révoquer',
      icon:    <Trash2 size={13} />,
      danger:  true,
      onClick: (row) => { setTarget(row); setErr(''); },
    },
  ];

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

      {/* Tableau */}
      <DataTableMaster<Session>
        columns={columns}
        data={sessions}
        loading={loading}
        rowActions={rowActions}
        defaultSort={{ key: 'createdAt', dir: 'desc' }}
        defaultPageSize={25}
        searchPlaceholder="Rechercher (utilisateur, IP, appareil…)"
        emptyMessage="Aucune session active"
        onExportCsv="sessions.csv"
        stickyHeader
      />

      {/* Confirmation révocation */}
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
