/**
 * PagePlatformSessions — Sessions actives cross-tenant (portail plateforme).
 *
 * Variante globale de PageIamSessions : liste toutes les sessions actives sur
 * l'ensemble des tenants, avec colonne Tenant + filtre tenant. Révocation par
 * l'endpoint global /api/platform/iam/sessions/:id (permission
 * control.platform.session.revoke.global — SA + L2).
 */
import { useState, useCallback, useMemo } from 'react';
import { KeyRound, RefreshCw, Trash2, Monitor, Smartphone } from 'lucide-react';
import { useAuth }    from '../../lib/auth/auth.context';
import { useI18n }    from '../../lib/i18n/useI18n';
import { useFetch }   from '../../lib/hooks/useFetch';
import { apiDelete, ApiError } from '../../lib/api';
import { Button }     from '../ui/Button';
import { Dialog }     from '../ui/Dialog';
import { Select }     from '../ui/Select';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionUser   { id: string; email: string; name: string | null }
interface SessionTenant { id: string; name: string; slug: string }
interface Session {
  id:          string;
  tenantId:    string;
  ipAddress?:  string | null;
  userAgent?:  string | null;
  createdAt:   string;
  expiresAt:   string;
  user:        SessionUser;
  tenant?:     SessionTenant | null;
}
interface TenantOption { id: string; name: string; slug: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function isMobile(ua?: string | null) {
  return !!ua && /mobile|android|iphone|ipad/i.test(ua);
}

function uaShort(ua?: string | null) {
  if (!ua) return '—';
  const browser = ua.match(/(?:Chrome|Firefox|Safari|Edge|Opera)[/ ]([\d.]+)/i);
  const os      = ua.match(/\(([^)]+)\)/)?.[1]?.split(';')[0] ?? '';
  return browser ? `${browser[0]} · ${os}` : ua.slice(0, 60);
}

// ─── Colonnes DataTableMaster ─────────────────────────────────────────────────

function buildColumns(currentUserId: string, t: (k: string) => string): Column<Session>[] {
  return [
    {
      key: 'tenant',
      header: t('platformAudit.colTenant'),
      sortable: false,
      width: '140px',
      cellRenderer: (_v, row) => row.tenant ? (
        <div className="text-xs">
          <p className="text-slate-800 dark:text-slate-200 truncate max-w-[130px]">{row.tenant.name}</p>
          <p className="text-slate-500 font-mono text-[10px]">{row.tenant.slug}</p>
        </div>
      ) : (
        <span className="text-xs text-slate-400 font-mono">{row.tenantId.slice(0, 8)}…</span>
      ),
      csvValue: (_v, row) => row.tenant ? `${row.tenant.name} (${row.tenant.slug})` : row.tenantId,
    },
    {
      key: 'user',
      header: t('iamSessions.colUser'),
      sortable: true,
      cellRenderer: (_v, row) => (
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-1.5">
            {row.user.name ?? '—'}
            {row.user.id === currentUserId && (
              <span className="text-xs text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 rounded px-1.5 py-0.5">
                {t('iamSessions.you')}
              </span>
            )}
          </p>
          <p className="text-xs text-slate-500">{row.user.email}</p>
        </div>
      ),
      csvValue: (_v, row) => `${row.user.name ?? ''} <${row.user.email}>`,
    },
    {
      key: 'userAgent',
      header: t('iamSessions.colDeviceBrowser'),
      cellRenderer: (v) => (
        <div className="flex items-center gap-1.5">
          {isMobile(v as string)
            ? <Smartphone size={13} className="text-slate-400 shrink-0" />
            : <Monitor size={13} className="text-slate-400 shrink-0" />}
          <span className="text-xs text-slate-500 dark:text-slate-400 max-w-[220px] truncate">
            {uaShort(v as string)}
          </span>
        </div>
      ),
      csvValue: (v) => uaShort(v as string),
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

// ─── Main ─────────────────────────────────────────────────────────────────────

export function PagePlatformSessions() {
  const { user } = useAuth();
  const { t }    = useI18n();

  const [tenantFilter, setTenantFilter] = useState('');
  const [rev, setRev] = useState(0);
  const reload = useCallback(() => setRev(r => r + 1), []);

  const qs = new URLSearchParams();
  if (tenantFilter) qs.set('tenantId', tenantFilter);
  const url = `/api/platform/iam/sessions${qs.toString() ? `?${qs}` : ''}`;

  const { data: sessionsData, loading } = useFetch<Session[]>(url, [rev, tenantFilter]);
  const { data: tenants } = useFetch<TenantOption[]>('/api/tenants');

  const sessions = sessionsData ?? [];

  const [target,   setTarget]   = useState<Session | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [err,      setErr]      = useState('');

  async function handleRevoke() {
    if (!target) return;
    setRevoking(true); setErr('');
    try {
      await apiDelete(`/api/platform/iam/sessions/${target.id}`);
      setTarget(null);
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? String((e.body as any)?.message ?? e.message) : t('iamSessions.errorGeneric'));
    } finally { setRevoking(false); }
  }

  const columns = useMemo(() => buildColumns(user?.id ?? '', t), [user?.id, t]);
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
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <KeyRound size={24} className="text-indigo-500 dark:text-indigo-400" />
            {t('platformSessions.title')}
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            {loading ? t('iamSessions.loading') : `${sessions.length} ${t('iamSessions.sessionCount')}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            options={[
              { value: '', label: t('platformAudit.allTenants') },
              ...(tenants ?? []).map(tnt => ({ value: tnt.id, label: `${tnt.name} (${tnt.slug})` })),
            ]}
            value={tenantFilter}
            onChange={e => setTenantFilter(e.target.value)}
          />
          <Button variant="ghost" size="sm" onClick={reload} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span className="ml-1">{t('iamSessions.refresh')}</span>
          </Button>
        </div>
      </div>

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
        exportFilename="platform-sessions"
        onRowClick={(row) => { setTarget(row); setErr(''); }}
        stickyHeader
      />

      {target && (
        <Dialog
          open={!!target}
          onOpenChange={o => { if (!o) setTarget(null); }}
          title={t('platformSessions.revokeTitle')}
          description={t('platformSessions.revokeDesc')}
          size="lg"
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setTarget(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="destructive" size="sm" onClick={handleRevoke} disabled={revoking}>
                <Trash2 size={13} />
                {revoking ? t('iamSessions.revoking') : t('iamSessions.revoke')}
              </Button>
            </>
          }
        >
          <div className="space-y-2 text-sm">
            <p className="text-slate-700 dark:text-slate-300">
              <span className="text-slate-500">{t('platformAudit.colTenant')} :</span>{' '}
              {target.tenant ? `${target.tenant.name} (${target.tenant.slug})` : target.tenantId}
            </p>
            <p className="text-slate-700 dark:text-slate-300">
              <span className="text-slate-500">{t('iamSessions.colUser')} :</span>{' '}
              {target.user.name ?? '—'} — {target.user.email}
            </p>
            <p className="text-slate-700 dark:text-slate-300">
              <span className="text-slate-500">{t('iamSessions.ip')} :</span>{' '}
              <span className="font-mono">{target.ipAddress ?? '—'}</span>
            </p>
            <p className="text-slate-700 dark:text-slate-300">
              <span className="text-slate-500">{t('iamSessions.colDevice')} :</span>{' '}
              <span className="font-mono text-xs">{uaShort(target.userAgent)}</span>
            </p>
            {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
          </div>
        </Dialog>
      )}
    </div>
  );
}
