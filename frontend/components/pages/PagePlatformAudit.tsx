/**
 * PagePlatformAudit — Journal d'accès cross-tenant (portail plateforme).
 *
 * Variante globale de PageIamAudit : pas de filtre implicite par tenantId,
 * ajoute une colonne "Tenant" et un filtre tenant optionnel. Accessible aux
 * SUPER_ADMIN, SUPPORT_L1 et SUPPORT_L2 (permission data.platform.audit.read.global).
 *
 * Endpoint : GET /api/platform/iam/audit
 * Filtres serveur : tenantId, level, action, userId, from, to, page, limit.
 */
import { useState, useCallback, useMemo } from 'react';
import { ScrollText, Search, Filter } from 'lucide-react';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch } from '../../lib/hooks/useFetch';
import { Input }    from '../ui/Input';
import { Button }   from '../ui/Button';
import { Select }   from '../ui/Select';
import { Dialog }   from '../ui/Dialog';
import DataTableMaster, { type Column } from '../DataTableMaster';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuditUser   { email: string; name: string | null }
interface AuditTenant { id: string; name: string; slug: string }
interface AuditEntry {
  id:             string;
  createdAt:      string;
  plane:          string;
  level:          string;
  action:         string;
  resource:       string;
  ipAddress?:     string | null;
  userId?:        string | null;
  tenantId:       string;
  user?:          AuditUser | null;
  tenant?:        AuditTenant | null;
  securityLevel?: string | null;
  newValue?:      Record<string, unknown> | null;
}
interface AuditPage {
  items: AuditEntry[];
  total: number;
  page:  number;
  limit: number;
  pages: number;
}

interface TenantOption { id: string; name: string; slug: string }

// ─── Helpers d'affichage ──────────────────────────────────────────────────────

const LEVEL_STYLES: Record<string, string> = {
  info:     'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/20',
  warn:     'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/20',
  warning:  'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/20',
  critical: 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/20',
};

function LevelBadge({ level }: { level: string }) {
  const cls = LEVEL_STYLES[level.toLowerCase()]
    ?? 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/20';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {level}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// ─── Colonnes DataTableMaster ─────────────────────────────────────────────────

function buildColumns(t: (k: string) => string): Column<AuditEntry>[] {
  return [
    {
      key: 'createdAt',
      header: t('iamAudit.colDate'),
      sortable: true,
      width: '150px',
      cellRenderer: (v) => (
        <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap font-mono">
          {formatDate(String(v))}
        </span>
      ),
      csvValue: (v) => formatDate(String(v)),
    },
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
      key: 'level',
      header: t('iamAudit.colLevel'),
      sortable: true,
      width: '90px',
      cellRenderer: (v) => <LevelBadge level={String(v)} />,
    },
    {
      key: 'action',
      header: t('iamAudit.colAction'),
      sortable: true,
      cellRenderer: (v) => (
        <span className="font-mono text-xs text-slate-800 dark:text-slate-200 max-w-[260px] truncate block">
          {String(v)}
        </span>
      ),
    },
    {
      key: 'resource',
      header: t('iamAudit.colResource'),
      sortable: true,
      cellRenderer: (v) => (
        <span className="text-xs text-slate-500 dark:text-slate-400 max-w-[180px] truncate block">{String(v)}</span>
      ),
    },
    {
      key: 'user',
      header: t('iamAudit.colUser'),
      cellRenderer: (_v, row) => row.user ? (
        <div>
          <p className="text-xs text-slate-800 dark:text-slate-200">{row.user.name ?? '—'}</p>
          <p className="text-xs text-slate-500">{row.user.email}</p>
        </div>
      ) : <span className="text-xs text-slate-400 dark:text-slate-600 italic">—</span>,
      csvValue: (_v, row) => row.user ? `${row.user.name ?? ''} <${row.user.email}>` : '',
    },
    {
      key: 'ipAddress',
      header: t('iamAudit.colIp'),
      width: '120px',
      cellRenderer: (v) => (
        <span className="text-xs text-slate-500 font-mono">{v ? String(v) : '—'}</span>
      ),
    },
  ];
}

// ─── Modale détail (version compacte) ──────────────────────────────────────

function AuditDetailDialog({ entry, onClose }: { entry: AuditEntry | null; onClose: () => void }) {
  const { t } = useI18n();
  const [rawOpen, setRawOpen] = useState(false);
  if (!entry) return null;
  const nv     = entry.newValue ?? {};
  const module = String(nv['module'] ?? '—');
  const method = String(nv['method'] ?? '—');
  const outcome = String(nv['outcome'] ?? '—');

  return (
    <Dialog
      open={!!entry}
      onOpenChange={o => { if (!o) onClose(); }}
      title={t('iamAudit.logDetailTitle')}
      description={t('iamAudit.logDetailDesc')}
      size="xl"
      footer={<Button variant="outline" size="sm" onClick={onClose}>{t('common.close')}</Button>}
    >
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-0.5">{t('iamAudit.eventId')}</p>
            <p className="font-mono text-xs text-slate-800 dark:text-slate-200 break-all">{entry.id}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-0.5">{t('iamAudit.timestamp')}</p>
            <p className="font-mono text-xs text-slate-800 dark:text-slate-200">{formatDate(entry.createdAt)}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-0.5">{t('platformAudit.colTenant')}</p>
            <p className="text-xs text-slate-800 dark:text-slate-200">
              {entry.tenant ? `${entry.tenant.name} (${entry.tenant.slug})` : entry.tenantId}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-0.5">{t('iamAudit.eventSource')}</p>
            <p className="text-xs text-slate-800 dark:text-slate-200 uppercase font-mono">{entry.plane}</p>
          </div>
        </div>
        <div className="border-t border-slate-100 dark:border-slate-800" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('iamAudit.severity')}</p>
            <LevelBadge level={entry.level} />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('iamAudit.colAction')}</p>
            <p className="text-xs font-mono text-slate-800 dark:text-slate-200 break-all">{entry.action}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('iamAudit.colResource')}</p>
            <p className="text-xs font-mono text-slate-800 dark:text-slate-200 break-all">{entry.resource}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">{t('iamAudit.user')}</p>
            {entry.user ? (
              <>
                <p className="text-xs text-slate-800 dark:text-slate-200">{entry.user.email}</p>
                <p className="text-xs text-slate-500">{entry.user.name ?? '—'}</p>
              </>
            ) : (
              <p className="text-xs italic text-slate-400">{t('iamAudit.systemAnonymous')}</p>
            )}
            <p className="text-xs font-mono text-slate-800 dark:text-slate-200 mt-1">
              <span className="text-slate-500">{t('iamAudit.colIp')} :</span> {entry.ipAddress ?? '—'}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">{t('iamAudit.context')}</p>
            <p className="text-xs text-slate-800 dark:text-slate-200">
              <span className="text-slate-500">{t('iamAudit.module')} :</span> {module}
            </p>
            <p className="text-xs font-mono text-slate-800 dark:text-slate-200">
              <span className="text-slate-500">{t('iamAudit.method')} :</span> {method}
            </p>
            <p className="text-xs text-slate-800 dark:text-slate-200">
              <span className="text-slate-500">{t('iamAudit.result')} :</span>{' '}
              <span className={outcome === 'SUCCESS' ? 'text-green-600 dark:text-green-400' : 'text-slate-700 dark:text-slate-300'}>
                {outcome}
              </span>
            </p>
          </div>
        </div>
        {entry.newValue && (
          <>
            <div className="border-t border-slate-100 dark:border-slate-800" />
            <div>
              <button
                className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                onClick={() => setRawOpen(o => !o)}
              >
                {rawOpen ? '▾' : '▸'} {t('iamAudit.rawRequest')}
              </button>
              {rawOpen && (
                <pre className="mt-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-700 dark:text-slate-300 overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(entry.newValue, null, 2)}
                </pre>
              )}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function PagePlatformAudit() {
  const { t } = useI18n();

  const [draft, setDraft]     = useState({ tenantId: '', action: '', userId: '', from: '', to: '', level: '' });
  const [filters, setFilters] = useState(draft);
  const [rev, setRev]         = useState(0);
  const [detail, setDetail]   = useState<AuditEntry | null>(null);

  // Liste tenants pour peupler le filtre (endpoint déjà exposé côté portail platform).
  const { data: tenants } = useFetch<TenantOption[]>('/api/tenants');

  const qs = new URLSearchParams({ page: '1', limit: '200' });
  if (filters.tenantId) qs.set('tenantId', filters.tenantId);
  if (filters.level)    qs.set('level',    filters.level);
  if (filters.action)   qs.set('action',   filters.action);
  if (filters.userId)   qs.set('userId',   filters.userId);
  if (filters.from)     qs.set('from',     filters.from);
  if (filters.to)       qs.set('to',       filters.to);

  const url = `/api/platform/iam/audit?${qs.toString()}`;
  const { data, loading } = useFetch<AuditPage>(url, [filters, rev]);

  const applyFilters = useCallback(() => {
    setFilters({ ...draft });
    setRev(r => r + 1);
  }, [draft]);

  const resetFilters = useCallback(() => {
    const empty = { tenantId: '', action: '', userId: '', from: '', to: '', level: '' };
    setDraft(empty);
    setFilters(empty);
    setRev(r => r + 1);
  }, []);

  const items = data?.items ?? [];
  const columns = useMemo(() => buildColumns(t), [t]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <ScrollText size={24} className="text-indigo-500 dark:text-indigo-400" />
          {t('platformAudit.title')}
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
          {data
            ? `${data.total} ${t('platformAudit.totalEntries').replace('{count}', String(items.length))}`
            : t('iamAudit.loading')}
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4 space-y-3">
        <div className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 font-medium mb-1">
          <Filter size={14} /> {t('iamAudit.serverFilters')}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Select
            options={[
              { value: '', label: t('platformAudit.allTenants') },
              ...(tenants ?? []).map(tnt => ({ value: tnt.id, label: `${tnt.name} (${tnt.slug})` })),
            ]}
            value={draft.tenantId}
            onChange={e => setDraft(d => ({ ...d, tenantId: e.target.value }))}
          />
          <Select
            options={[
              { value: '', label: t('iamAudit.allLevels') },
              { value: 'info', label: 'info' },
              { value: 'warn', label: 'warn' },
              { value: 'critical', label: 'critical' },
            ]}
            value={draft.level}
            onChange={e => setDraft(d => ({ ...d, level: e.target.value }))}
          />
          <Input
            placeholder={t('iamAudit.searchAction')}
            value={draft.action}
            onChange={e => setDraft(d => ({ ...d, action: e.target.value }))}
          />
          <Input
            placeholder={t('iamAudit.userIdPlaceholder')}
            value={draft.userId}
            onChange={e => setDraft(d => ({ ...d, userId: e.target.value }))}
          />
          <Input
            type="date"
            value={draft.from}
            onChange={e => setDraft(d => ({ ...d, from: e.target.value }))}
            title={t('iamAudit.since')}
          />
          <Input
            type="date"
            value={draft.to}
            onChange={e => setDraft(d => ({ ...d, to: e.target.value }))}
            title={t('iamAudit.until')}
          />
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" size="sm" onClick={resetFilters}>{t('iamAudit.reset')}</Button>
          <Button size="sm" onClick={applyFilters}>
            <Search size={13} className="mr-1" /> {t('iamAudit.apply')}
          </Button>
        </div>
      </div>

      <DataTableMaster<AuditEntry>
        columns={columns}
        data={items}
        loading={loading}
        defaultSort={{ key: 'createdAt', dir: 'desc' }}
        defaultPageSize={25}
        searchPlaceholder={t('iamAudit.searchPlaceholder')}
        emptyMessage={t('iamAudit.emptyMessage')}
        exportFormats={['csv', 'json', 'pdf']}
        exportFilename="platform-audit-log"
        onRowClick={setDetail}
        stickyHeader
      />

      <AuditDetailDialog entry={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
