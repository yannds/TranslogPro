/**
 * PageIamAudit — Journal d'accès tenant
 *
 * Fonctionnalités :
 *   - Table paginée des AuditLog
 *   - Filtres : niveau (info/warn/critical), recherche action, plage de dates, userId
 *   - Badge coloré par niveau
 *   - Pagination : prev / next / page courante
 */
import { useState, useCallback } from 'react';
import { ScrollText, ChevronLeft, ChevronRight, Search, Filter } from 'lucide-react';
import { useAuth }  from '../../lib/auth/auth.context';
import { useFetch } from '../../lib/hooks/useFetch';
import { Input }    from '../ui/Input';
import { Button }   from '../ui/Button';
import { Select }   from '../ui/Select';
import { Skeleton } from '../ui/Skeleton';

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

// ─── Main ─────────────────────────────────────────────────────────────────────

export function PageIamAudit() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/v1/tenants/${tenantId}/iam`;

  const [page, setPage]       = useState(1);
  const [level, setLevel]     = useState('');
  const [action, setAction]   = useState('');
  const [userId, setUserId]   = useState('');
  const [from, setFrom]       = useState('');
  const [to, setTo]           = useState('');
  const [draft, setDraft]     = useState({ action: '', userId: '', from: '', to: '', level: '' });
  const [rev, setRev]         = useState(0);

  // Build query string
  const qs = new URLSearchParams({ page: String(page), limit: '50' });
  if (level)  qs.set('level',  level);
  if (action) qs.set('action', action);
  if (userId) qs.set('userId', userId);
  if (from)   qs.set('from',   from);
  if (to)     qs.set('to',     to);

  const url = `${base}/audit?${qs.toString()}`;
  const { data, loading } = useFetch<AuditPage>(url, [page, level, action, userId, from, to, rev]);

  const applyFilters = useCallback(() => {
    setLevel(draft.level);
    setAction(draft.action);
    setUserId(draft.userId);
    setFrom(draft.from);
    setTo(draft.to);
    setPage(1);
    setRev(r => r + 1);
  }, [draft]);

  const resetFilters = useCallback(() => {
    const empty = { action: '', userId: '', from: '', to: '', level: '' };
    setDraft(empty);
    setLevel(''); setAction(''); setUserId(''); setFrom(''); setTo('');
    setPage(1);
    setRev(r => r + 1);
  }, []);

  const items = data?.items ?? [];
  const pages = data?.pages ?? 1;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <ScrollText size={24} className="text-indigo-400" />
          Journal d&apos;accès
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          {data ? `${data.total} entrée(s) · page ${data.page}/${data.pages}` : 'Chargement…'}
        </p>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-3">
        <div className="flex items-center gap-1 text-sm text-slate-400 font-medium mb-1">
          <Filter size={14} /> Filtres
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
            title="Jusqu'au"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" size="sm" onClick={resetFilters}>Réinitialiser</Button>
          <Button size="sm" onClick={applyFilters}>
            <Search size={13} className="mr-1" /> Appliquer
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-700 overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-slate-800 text-slate-400">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Date</th>
              <th className="text-left px-4 py-3 font-medium">Niveau</th>
              <th className="text-left px-4 py-3 font-medium">Action</th>
              <th className="text-left px-4 py-3 font-medium">Ressource</th>
              <th className="text-left px-4 py-3 font-medium">Utilisateur</th>
              <th className="text-left px-4 py-3 font-medium">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading && Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} className="bg-slate-900">
                {Array.from({ length: 6 }).map((__, j) => (
                  <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                ))}
              </tr>
            ))}
            {!loading && items.map(entry => (
              <tr key={entry.id} className="bg-slate-900 hover:bg-slate-800/50 transition-colors">
                <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap text-xs">
                  {formatDate(entry.createdAt)}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <LevelBadge level={entry.level} />
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-200 max-w-[260px] truncate">
                  {entry.action}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-400 max-w-[180px] truncate">
                  {entry.resource}
                </td>
                <td className="px-4 py-2.5">
                  {entry.user ? (
                    <div>
                      <p className="text-xs text-slate-200">{entry.user.name}</p>
                      <p className="text-xs text-slate-500">{entry.user.email}</p>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-600 italic">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500 font-mono">
                  {entry.ipAddress ?? '—'}
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr className="bg-slate-900">
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  Aucune entrée pour ces critères
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="ghost" size="sm"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            <ChevronLeft size={15} />
          </Button>
          <span className="text-sm text-slate-400">
            Page <strong className="text-white">{page}</strong> / {pages}
          </span>
          <Button
            variant="ghost" size="sm"
            disabled={page >= pages}
            onClick={() => setPage(p => p + 1)}
          >
            <ChevronRight size={15} />
          </Button>
        </div>
      )}
    </div>
  );
}
