/**
 * PageIamAudit — Journal d'accès tenant (Format ISO 27001)
 *
 * Fonctionnalités :
 *   - DataTableMaster : tri, recherche full-text, pagination, export multi-format
 *   - Filtres serveur : niveau (info/warn/critical), action, userId, plage de dates
 *   - Badge coloré par niveau (light + dark mode adaptatif)
 *   - Clic sur ligne → modale détail exhaustive (lecture seule)
 *   - Décomposition Type/Catégorie/Action depuis les champs existants (frontend only)
 *   - Affichage requête brute (newValue JSON)
 */
import { useState, useCallback } from 'react';
import { ScrollText, Search, Filter } from 'lucide-react';
import { useAuth }  from '../../lib/auth/auth.context';
import { useFetch } from '../../lib/hooks/useFetch';
import { Input }    from '../ui/Input';
import { Button }   from '../ui/Button';
import { Select }   from '../ui/Select';
import { Dialog }   from '../ui/Dialog';
import DataTableMaster, { type Column } from '../DataTableMaster';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuditUser { email: string; name: string }
interface AuditEntry {
  id:             string;
  createdAt:      string;
  plane:          string;
  level:          string;
  action:         string;
  resource:       string;
  ipAddress?:     string;
  userId?:        string;
  user?:          AuditUser;
  securityLevel?: string;
  newValue?:      Record<string, unknown> | null;
}
interface AuditPage {
  items: AuditEntry[];
  total: number;
  page:  number;
  limit: number;
  pages: number;
}

// ─── Helpers d'affichage ──────────────────────────────────────────────────────

const LEVEL_STYLES: Record<string, string> = {
  info:     'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/20',
  warn:     'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/20',
  warning:  'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/20',
  critical: 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/20',
  error:    'bg-red-50 text-red-700 border border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/20',
};

const SEC_LEVEL_STYLES: Record<string, string> = {
  INTERNAL:     'bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/20',
  CONFIDENTIAL: 'bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/20',
  RESTRICTED:   'bg-red-50 text-red-700 border border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/20',
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

function SecLevelBadge({ level }: { level: string }) {
  const cls = SEC_LEVEL_STYLES[level.toUpperCase()]
    ?? 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/20';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {level.toUpperCase()}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// ─── Décomposition sémantique depuis les champs existants ─────────────────────

/**
 * Dérive le Type d'événement depuis plane + actionType embarqué dans action.
 * Aucune modification du schéma — lecture seule des données existantes.
 */
function deriveEventType(plane: string, action: string): string {
  if (plane === 'control') return 'CONTROL';
  if (action.includes('LOGIN') || action.includes('sign_in') || action.includes('auth'))
    return 'SYSTEM_SECURITY';
  return 'SYSTEM_DATA';
}

/**
 * Dérive la Catégorie depuis le module (newValue.module) ou l'action.
 */
function deriveCategory(action: string, module?: string): string {
  const src = (module ?? action).toLowerCase();
  if (src.includes('auth') || src.includes('mfa') || src.includes('login') || src.includes('sign_in'))
    return 'AUTHENTICATION';
  if (src.includes('iam') || src.includes('user') || src.includes('role') || src.includes('session'))
    return 'IAM';
  if (src.includes('workflow')) return 'WORKFLOW';
  if (src.includes('ticket'))   return 'TICKET';
  if (src.includes('sav') || src.includes('parcel')) return 'SAV';
  if (src.includes('cashier') || src.includes('pricing')) return 'FINANCE';
  if (src.includes('maintenance')) return 'MAINTENANCE';
  if (src.includes('integration')) return 'INTEGRATION';
  return 'SYSTÈME';
}

/**
 * Dérive l'Action lisible depuis actionType ou la string action.
 */
function deriveActionLabel(action: string, actionType?: string): string {
  const src = (actionType ?? action).toUpperCase();
  if (src.includes('LOGIN') || src.includes('SIGN_IN')) return 'CONNEXION';
  if (src.includes('DELETE') || src.includes('SUPPRESSION')) return 'SUPPRESSION';
  if (src === 'EXPORT') return 'EXPORT';
  if (src.includes('WRITE') || src.includes('POST') || src.includes('CREATE')) return 'CRÉATION';
  if (src.includes('WRITE') || src.includes('PATCH') || src.includes('PUT') || src.includes('UPDATE')) return 'MODIFICATION';
  if (src.includes('READ') || src.includes('GET')) return 'CONSULTATION';
  if (src.includes('REVOKE')) return 'RÉVOCATION';
  return src;
}

/**
 * Construit une description lisible depuis les données disponibles.
 */
function deriveDescription(entry: AuditEntry): string {
  const nv = entry.newValue ?? {};
  const outcome = String(nv['outcome'] ?? '');
  const email   = entry.user?.email ?? String(nv['userId'] ?? '');
  const module  = String(nv['module'] ?? entry.plane);
  const at      = String(nv['actionType'] ?? entry.action).toUpperCase();

  if (at.includes('LOGIN')) {
    return outcome === 'FAILURE'
      ? `Tentative de connexion échouée${email ? ' : ' + email : ''}`
      : `Connexion réussie${email ? ' : ' + email : ''}`;
  }
  if (at.includes('DELETE'))
    return `Suppression sur ${module}${entry.resource ? ' — ' + entry.resource : ''}`;
  if (at.includes('WRITE') || at.includes('CREATE'))
    return `Création/modification sur ${module}${entry.resource ? ' — ' + entry.resource : ''}`;
  return `${at} sur ${module}`;
}

// ─── Colonnes DataTableMaster ─────────────────────────────────────────────────

const COLUMNS: Column<AuditEntry>[] = [
  {
    key: 'createdAt',
    header: 'Date',
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
      <span className="font-mono text-xs text-slate-800 dark:text-slate-200 max-w-[260px] truncate block">
        {String(v)}
      </span>
    ),
  },
  {
    key: 'resource',
    header: 'Ressource',
    sortable: true,
    cellRenderer: (v) => (
      <span className="text-xs text-slate-500 dark:text-slate-400 max-w-[180px] truncate block">{String(v)}</span>
    ),
  },
  {
    key: 'user',
    header: 'Utilisateur',
    cellRenderer: (_v, row) => row.user ? (
      <div>
        <p className="text-xs text-slate-800 dark:text-slate-200">{row.user.name}</p>
        <p className="text-xs text-slate-500">{row.user.email}</p>
      </div>
    ) : <span className="text-xs text-slate-400 dark:text-slate-600 italic">—</span>,
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

// ─── Modale détail ISO 27001 ───────────────────────────────────────────────────

function AuditDetailDialog({
  entry,
  onClose,
}: {
  entry: AuditEntry | null;
  onClose: () => void;
}) {
  const [rawOpen, setRawOpen] = useState(false);
  if (!entry) return null;

  const nv         = entry.newValue ?? {};
  const module     = String(nv['module']     ?? '—');
  const endpoint   = String(nv['endpoint']   ?? '—');
  const method     = String(nv['method']     ?? '—');
  const roleName   = String(nv['roleName']   ?? '—');
  const actionType = String(nv['actionType'] ?? '');
  const outcome    = String(nv['outcome']    ?? '—');
  const duration   = nv['durationMs'] != null ? `${nv['durationMs']} ms` : '—';

  const eventType   = deriveEventType(entry.plane, entry.action);
  const category    = deriveCategory(entry.action, nv['module'] as string | undefined);
  const actionLabel = deriveActionLabel(entry.action, actionType);
  const description = deriveDescription(entry);
  const secLevel    = entry.securityLevel ?? 'INTERNAL';

  return (
    <Dialog
      open={!!entry}
      onOpenChange={o => { if (!o) onClose(); }}
      title="Détails du Log — Format ISO 27001"
      description="Informations détaillées du log de sécurité"
      size="lg"
      footer={<Button variant="outline" size="sm" onClick={onClose}>Fermer</Button>}
    >
      <div className="space-y-4 text-sm">

        {/* Bloc 1 — Identité */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-0.5">ID de l&apos;événement</p>
            <p className="font-mono text-xs text-slate-800 dark:text-slate-200 break-all">{entry.id}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-0.5">Horodatage</p>
            <p className="font-mono text-xs text-slate-800 dark:text-slate-200">{formatDate(entry.createdAt)}</p>
          </div>
        </div>

        {/* Bloc 2 — Source */}
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-0.5">Source de l&apos;événement</p>
          <p className="text-xs text-slate-800 dark:text-slate-200 uppercase font-mono">{entry.plane}</p>
        </div>

        <div className="border-t border-slate-100 dark:border-slate-800" />

        {/* Bloc 3 — Classification */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Type d&apos;événement</p>
            <p className="text-xs font-mono text-slate-800 dark:text-slate-200">{eventType}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Catégorie</p>
            <p className="text-xs font-mono text-slate-800 dark:text-slate-200">{category}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Action</p>
            <p className="text-xs font-mono text-slate-800 dark:text-slate-200">{actionLabel}</p>
          </div>
        </div>

        {/* Bloc 4 — Sévérité + Niveau sécurité */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Sévérité</p>
            <LevelBadge level={entry.level} />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Niveau de sécurité</p>
            <SecLevelBadge level={secLevel} />
          </div>
        </div>

        <div className="border-t border-slate-100 dark:border-slate-800" />

        {/* Bloc 5 — Description */}
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Description</p>
          <p className="text-sm text-slate-800 dark:text-slate-200 pl-3 border-l-2 border-indigo-300 dark:border-indigo-600">
            {description}
          </p>
        </div>

        <div className="border-t border-slate-100 dark:border-slate-800" />

        {/* Bloc 6 — Utilisateur + Contexte */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">Utilisateur</p>
            <div className="space-y-0.5">
              {entry.user ? (
                <>
                  <p className="text-xs text-slate-800 dark:text-slate-200">
                    <span className="text-slate-500">Email :</span> {entry.user.email}
                  </p>
                  <p className="text-xs text-slate-800 dark:text-slate-200">
                    <span className="text-slate-500">Nom :</span> {entry.user.name}
                  </p>
                </>
              ) : (
                <p className="text-xs italic text-slate-400">Système / anonyme</p>
              )}
              {roleName !== '—' && (
                <p className="text-xs text-slate-800 dark:text-slate-200">
                  <span className="text-slate-500">Rôle :</span> {roleName}
                </p>
              )}
              <p className="text-xs font-mono text-slate-800 dark:text-slate-200">
                <span className="text-slate-500 not-italic">IP :</span> {entry.ipAddress ?? '—'}
              </p>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">Contexte</p>
            <div className="space-y-0.5">
              <p className="text-xs text-slate-800 dark:text-slate-200">
                <span className="text-slate-500">Module :</span> {module}
              </p>
              <p className="text-xs font-mono text-slate-800 dark:text-slate-200 break-all">
                <span className="text-slate-500 not-italic">Endpoint :</span> {endpoint}
              </p>
              <p className="text-xs font-mono text-slate-800 dark:text-slate-200">
                <span className="text-slate-500 not-italic">Méthode :</span> {method}
              </p>
              <p className="text-xs text-slate-800 dark:text-slate-200">
                <span className="text-slate-500">Résultat :</span>{' '}
                <span className={outcome === 'SUCCESS' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                  {outcome}
                </span>
                {duration !== '—' && <span className="text-slate-400 ml-1">({duration})</span>}
              </p>
            </div>
          </div>
        </div>

        {/* Bloc 7 — Requête brute (expandable) */}
        {entry.newValue && (
          <>
            <div className="border-t border-slate-100 dark:border-slate-800" />
            <div>
              <button
                className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                onClick={() => setRawOpen(o => !o)}
              >
                {rawOpen ? '▾' : '▸'} Requête brute (newValue)
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

export function PageIamAudit() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/v1/tenants/${tenantId}/iam`;

  const [draft, setDraft]     = useState({ action: '', userId: '', from: '', to: '', level: '' });
  const [filters, setFilters] = useState({ action: '', userId: '', from: '', to: '', level: '' });
  const [rev, setRev]         = useState(0);
  const [detail, setDetail]   = useState<AuditEntry | null>(null);

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

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <ScrollText size={24} className="text-indigo-500 dark:text-indigo-400" />
          Journal d&apos;accès
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
          {data
            ? `${data.total} entrée(s) au total — affichage des ${items.length} plus récentes`
            : 'Chargement…'}
        </p>
      </div>

      {/* Filtres serveur */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4 space-y-3">
        <div className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 font-medium mb-1">
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

      {/* Tableau */}
      <DataTableMaster<AuditEntry>
        columns={COLUMNS}
        data={items}
        loading={loading}
        defaultSort={{ key: 'createdAt', dir: 'desc' }}
        defaultPageSize={25}
        searchPlaceholder="Recherche locale (action, ressource, IP…)"
        emptyMessage="Aucune entrée pour ces critères"
        exportFormats={['csv', 'json', 'pdf']}
        exportFilename="audit-log"
        onRowClick={setDetail}
        stickyHeader
      />

      {/* Modale détail ISO 27001 */}
      <AuditDetailDialog entry={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
