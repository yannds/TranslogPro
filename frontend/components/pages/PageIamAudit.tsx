/**
 * PageIamAudit — Journal d'accès tenant
 *
 * Fonctionnalités :
 *   - DataTableMaster : tri, recherche full-text, pagination, export CSV
 *   - Filtres serveur : niveau (info/warn/critical), action, userId, plage de dates
 *   - Badge coloré par niveau
 */
import { useState, useCallback } from 'react';
import { ScrollText, Search, Filter } from 'lucide-react';
import { useAuth }  from '../../lib/auth/auth.context';
import { useFetch } from '../../lib/hooks/useFetch';
import { Input }    from '../ui/Input';
import { Button }   from '../ui/Button';
import { Select }   from '../ui/Select';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuditUser { email: string; name: string }
interface AuditEntry {
  id:         string;
  createdAt:  string;
  plane:      string;
  level:      string;
  action:     string;
  resource:   string;
  ipAddress?: string;
  userId?:    string;
  user?:      AuditUser;
}
interface AuditPage {
  items: AuditEntry[];
  total: number;
  page:  number;
  limit: number;
  pages: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const LEVEL_STYLES: Record<string, string> = {
  info:     'bg-blue-500/15 text-blue-300 border border-blue-500/20',
  warn:     'bg-amber-500/15 text-amber-300 border border-amber-500/20',
  warning:  'bg-amber-500/15 text-amber-300 border border-amber-500/20',
  critical: 'bg-red-500/15 text-red-300 border border-red-500/20',
  error:    'bg-red-500/15 text-red-300 border border-red-500/20',
};

function LevelBadge({ level }: { level: string }) {
  const cls = LEVEL_STYLES[level.toLowerCase()] ?? 'bg-slate-500/15 text-slate-300';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {level}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── Colonnes DataTableMaster ─────────────────────────────────────────────────

const COLUMNS: Column<AuditEntry>[] = [
  {
    key: 'createdAt',
    header: 'Date',
    sortable: true,
    width: '150px',
    cellRenderer: (v) => (
      <span className="text-xs text-slate-400 whitespace-nowrap font-mono">
        {formatDate(String(v))}
      </span>
    ),
    csvValue: (v) => formatDate(String(v)),
  },
  {
    key: 'level',
    header: 'Niveau',
    sortable: true,
    width: '90px',
    cellRenderer: (v) => <LevelBadge level={String(v)} />,
  },
  {
    key: 'action',
    header: 'Action',
    sortable: true,
    cellRenderer: (v) => (
      <span className="font-mono text-xs text-slate-200 max-w-[260px] truncate block">
        {String(v)}
      </span>
    ),
  },
  {
    key: 'resource',
    header: 'Ressource',
    sortable: true,
    cellRenderer: (v) => (
      <span className="text-xs text-slate-400 max-w-[180px] truncate block">{String(v)}</span>
    ),
  },
  {
    key: 'user',
    header: 'Utilisateur',
    cellRenderer: (_v, row) => row.user ? (
      <div>
        <p className="text-xs text-slate-200">{row.user.name}</p>
        <p className="text-xs text-slate-500">{row.user.email}</p>
      </div>
    ) : <span className="text-xs text-slate-600 italic">—</span>,
    csvValue: (_v, row) => row.user ? `${row.user.name} <${row.user.email}>` : '',
  },
  {
    key: 'ipAddress',
    header: 'IP',
    width: '120px',
    cellRenderer: (v) => (
      <span className="text-xs text-slate-500 font-mono">{v ? String(v) : '—'}</span>
    ),
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

export function PageIamAudit() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/v1/tenants/${tenantId}/iam`;

  const [draft, setDraft]   = useState({ action: '', userId: '', from: '', to: '', level: '' });
  const [filters, setFilters] = useState({ action: '', userId: '', from: '', to: '', level: '' });
  const [rev, setRev]       = useState(0);

  // Récupère jusqu'à 200 entrées pour la page courante — DataTableMaster gère la pagination locale
  const qs = new URLSearchParams({ page: '1', limit: '200' });
  if (filters.level)  qs.set('level',  filters.level);
  if (filters.action) qs.set('action', filters.action);
  if (filters.userId) qs.set('userId', filters.userId);
  if (filters.from)   qs.set('from',   filters.from);
  if (filters.to)     qs.set('to',     filters.to);

  const url = `${base}/audit?${qs.toString()}`;
  const { data, loading } = useFetch<AuditPage>(url, [filters, rev]);

  const applyFilters = useCallback(() => {
    setFilters({ ...draft });
    setRev(r => r + 1);
  }, [draft]);

  const resetFilters = useCallback(() => {
    const empty = { action: '', userId: '', from: '', to: '', level: '' };
    setDraft(empty);
    setFilters(empty);
    setRev(r => r + 1);
  }, []);

  const items = data?.items ?? [];

  const rowActions: RowAction<AuditEntry>[] = []; // Journal en lecture seule

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <ScrollText size={24} className="text-indigo-400" />
          Journal d&apos;accès
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          {data
            ? `${data.total} entrée(s) au total — affichage des ${items.length} plus récentes`
            : 'Chargement…'}
        </p>
      </div>

      {/* Filtres serveur */}
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-3">
        <div className="flex items-center gap-1 text-sm text-slate-400 font-medium mb-1">
          <Filter size={14} /> Filtres serveur
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <Select
            options={[
              { value: '', label: 'Tous niveaux' },
              { value: 'info', label: 'info' },
              { value: 'warn', label: 'warn' },
              { value: 'critical', label: 'critical' },
            ]}
            value={draft.level}
            onChange={e => setDraft(d => ({ ...d, level: e.target.value }))}
          />
          <Input
            placeholder="Rechercher action…"
            value={draft.action}
            onChange={e => setDraft(d => ({ ...d, action: e.target.value }))}
          />
          <Input
            placeholder="User ID…"
            value={draft.userId}
            onChange={e => setDraft(d => ({ ...d, userId: e.target.value }))}
          />
          <Input
            type="date"
            value={draft.from}
            onChange={e => setDraft(d => ({ ...d, from: e.target.value }))}
            title="Depuis"
          />
          <Input
            type="date"
            value={draft.to}
            onChange={e => setDraft(d => ({ ...d, to: e.target.value }))}
            title="Jusqu&apos;au"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" size="sm" onClick={resetFilters}>Réinitialiser</Button>
          <Button size="sm" onClick={applyFilters}>
            <Search size={13} className="mr-1" /> Appliquer
          </Button>
        </div>
      </div>

      {/* Tableau */}
      <DataTableMaster<AuditEntry>
        columns={COLUMNS}
        data={items}
        loading={loading}
        rowActions={rowActions}
        defaultSort={{ key: 'createdAt', dir: 'desc' }}
        defaultPageSize={25}
        searchPlaceholder="Recherche locale (action, ressource, IP…)"
        emptyMessage="Aucune entrée pour ces critères"
        onExportCsv="audit-log.csv"
        stickyHeader
      />
    </div>
  );
}
