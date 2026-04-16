/**
 * PageIamSessions — Sessions actives du tenant
 *
 * Fonctionnalités :
 *   - DataTableMaster : tri, recherche, pagination, export multi-format
 *   - Informations : utilisateur, IP, user-agent, créée le, expire le
 *   - Clic ligne → modale détail avec option révocation
 *   - Révoquer aussi via row action directe (raccourci)
 */
import { useState, useCallback } from 'react';
import { KeyRound, RefreshCw, Trash2, Monitor, Smartphone } from 'lucide-react';
import { useAuth }    from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
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

function buildColumns(currentUserId: string, t: (keyOrMap: string | Record<string, string>) => string): Column<Session>[] {
  return [
    {
      key: 'user',
      header: t('iamSessions.colUser'),
      sortable: true,
      cellRenderer: (_v, row) => (
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-1.5">
            {row.user.name}
            {row.user.id === currentUserId && (
              <span className="text-xs text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 rounded px-1.5 py-0.5">
                {t('iamSessions.you')}
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
      header: t('iamSessions.colDeviceBrowser'),
      cellRenderer: (v) => (
        <div className="flex items-center gap-1.5">
          {isMobile(String(v))
            ? <Smartphone size={13} className="text-slate-400 shrink-0" />
            : <Monitor size={13} className="text-slate-400 shrink-0" />}
          <span className="text-xs text-slate-500 dark:text-slate-400 max-w-[220px] truncate">
            {uaShort(v ? String(v) : undefined)}
          </span>
        </div>
      ),
      csvValue: (v) => uaShort(v ? String(v) : undefined),
    },
    {
      key: 'ipAddress',
      header: t('iamSessions.ip'),
      sortable: true,
      width: '130px',
      cellRenderer: (v) => (
        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{v ? String(v) : '—'}</span>
      ),
    },
    {
      key: 'createdAt',
      header: t('iamSessions.colCreatedAt'),
      sortable: true,
      width: '140px',
      cellRenderer: (v) => (
        <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{formatDate(String(v))}</span>
      ),
      csvValue: (v) => formatDate(String(v)),
    },
    {
      key: 'expiresAt',
      header: t('iamSessions.colExpiresAt'),
      sortable: true,
      width: '140px',
      cellRenderer: (v) => (
        <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{formatDate(String(v))}</span>
      ),
      csvValue: (v) => formatDate(String(v)),
    },
  ];
}

// ─── Modale détail session ────────────────────────────────────────────────────

function SessionDetailDialog({
  session,
  currentUserId,
  onClose,
  onRevoke,
  revoking,
  err,
}: {
  session:        Session | null;
  currentUserId:  string;
  onClose:        () => void;
  onRevoke:       () => void;
  revoking:       boolean;
  err:            string;
}) {
  const { t } = useI18n();
  if (!session) return null;
  const isOwn = session.user.id === currentUserId;
  return (
    <Dialog
      open={!!session}
      onOpenChange={o => { if (!o) onClose(); }}
      title={t('iamSessions.sessionDetail')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>{t('common.close')}</Button>
          <Button variant="destructive" size="sm" onClick={onRevoke} disabled={revoking}>
            <Trash2 size={13} />
            {revoking ? t('iamSessions.revoking') : t('iamSessions.revoke')}
          </Button>
        </>
      }
    >
      <dl className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
        <div className="py-2.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <dt className="font-medium text-slate-500 dark:text-slate-400">{t('iamSessions.colUser')}</dt>
          <dd className="sm:col-span-2 text-slate-900 dark:text-slate-100">
            <span className="font-medium">{session.user.name}</span>
            {isOwn && (
              <span className="ml-2 text-xs text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 rounded px-1.5 py-0.5">
                {t('iamSessions.you')}
              </span>
            )}
            <p className="text-xs text-slate-500 mt-0.5">{session.user.email}</p>
          </dd>
        </div>
        <div className="py-2.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <dt className="font-medium text-slate-500 dark:text-slate-400">{t('iamSessions.ip')}</dt>
          <dd className="sm:col-span-2 font-mono text-slate-900 dark:text-slate-100">{session.ipAddress ?? '—'}</dd>
        </div>
        <div className="py-2.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <dt className="font-medium text-slate-500 dark:text-slate-400">{t('iamSessions.colDevice')}</dt>
          <dd className="sm:col-span-2 text-xs text-slate-700 dark:text-slate-300 break-all">
            {uaShort(session.userAgent)}
          </dd>
        </div>
        <div className="py-2.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <dt className="font-medium text-slate-500 dark:text-slate-400">{t('iamSessions.colCreatedAt')}</dt>
          <dd className="sm:col-span-2 text-slate-900 dark:text-slate-100 font-mono text-xs">{formatDate(session.createdAt)}</dd>
        </div>
        <div className="py-2.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <dt className="font-medium text-slate-500 dark:text-slate-400">{t('iamSessions.colExpiresAt')}</dt>
          <dd className="sm:col-span-2 text-slate-900 dark:text-slate-100 font-mono text-xs">{formatDate(session.expiresAt)}</dd>
        </div>
      </dl>
      {err && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{err}</p>}
    </Dialog>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function PageIamSessions() {
  const { user }  = useAuth();
  const { t } = useI18n();
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
      setErr(e instanceof ApiError ? String((e.body as any)?.message ?? e.message) : t('iamSessions.errorGeneric'));
    } finally { setRevoking(false); }
  }

  const columns    = buildColumns(user?.id ?? '', t);
  const rowActions: RowAction<Session>[] = [
    {
      label:   t('iamSessions.revoke'),
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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <KeyRound size={24} className="text-indigo-500 dark:text-indigo-400" />
            {t('iamSessions.activeSessions')}
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            {loading ? t('iamSessions.loading') : `${sessions.length} ${t('iamSessions.sessionCount')}`}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={reload} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span className="ml-1">{t('iamSessions.refresh')}</span>
        </Button>
      </div>

      {/* Tableau — clic ligne = détail + option révocation */}
      <DataTableMaster<Session>
        columns={columns}
        data={sessions}
        loading={loading}
        rowActions={rowActions}
        defaultSort={{ key: 'createdAt', dir: 'desc' }}
        defaultPageSize={25}
        searchPlaceholder={t('iamSessions.searchPlaceholder')}
        emptyMessage={t('iamSessions.emptyMessage')}
        exportFormats={['csv', 'json']}
        exportFilename="sessions"
        onRowClick={(row) => { setTarget(row); setErr(''); }}
        stickyHeader
      />

      {/* Modale détail / révocation */}
      <SessionDetailDialog
        session={target}
        currentUserId={user?.id ?? ''}
        onClose={() => setTarget(null)}
        onRevoke={handleRevoke}
        revoking={revoking}
        err={err}
      />
    </div>
  );
}
