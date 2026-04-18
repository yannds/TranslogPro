/**
 * PageCustomerSupport — Support tenant → plateforme.
 *
 * Les utilisateurs d'un tenant client peuvent :
 *   - ouvrir un nouveau ticket (permission data.support.create.tenant)
 *   - consulter leurs tickets et le thread de réponses (data.support.read.tenant)
 *   - répondre à un ticket ouvert (data.support.create.tenant)
 *
 * Endpoints :
 *   POST   /api/support/tickets          { title, description, category?, priority? }
 *   GET    /api/support/tickets          [?status=]
 *   GET    /api/support/tickets/:id
 *   POST   /api/support/tickets/:id/messages    { body }
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  LifeBuoy, Plus, X, Send, Clock, AlertTriangle, MessageSquare,
} from 'lucide-react';
import { useFetch }         from '../../lib/hooks/useFetch';
import { apiPost }           from '../../lib/api';
import { useI18n }           from '../../lib/i18n/useI18n';
import { useAuth }           from '../../lib/auth/auth.context';
import { Button }           from '../ui/Button';
import { Badge }            from '../ui/Badge';
import { Dialog }           from '../ui/Dialog';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TicketRow {
  id:        string;
  title:     string;
  category:  string;
  priority:  string;
  status:    string;
  createdAt: string;
  _count?:   { messages: number };
}

interface Message {
  id:          string;
  authorScope: 'TENANT' | 'PLATFORM';
  body:        string;
  createdAt:   string;
}

interface TicketDetail extends TicketRow {
  description: string;
  messages:    Message[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const inp = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30 disabled:opacity-50';

function priorityVariant(p: string): 'danger' | 'warning' | 'info' | 'default' {
  switch (p) {
    case 'CRITICAL': return 'danger';
    case 'HIGH':     return 'warning';
    case 'NORMAL':   return 'info';
    default:         return 'default';
  }
}

function statusVariant(s: string): 'success' | 'warning' | 'info' | 'default' {
  switch (s) {
    case 'OPEN':            return 'info';
    case 'IN_PROGRESS':     return 'warning';
    case 'WAITING_CUSTOMER':return 'warning';
    case 'RESOLVED':        return 'success';
    case 'CLOSED':          return 'default';
    default:                return 'default';
  }
}

// ─── Create dialog ──────────────────────────────────────────────────────────

interface CreateForm { title: string; description: string; category: string; priority: string }

function CreateTicketForm({ onSubmit, onCancel, busy, error }: {
  onSubmit: (f: CreateForm) => void;
  onCancel: () => void;
  busy:     boolean;
  error:    string | null;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<CreateForm>({ title: '', description: '', category: 'QUESTION', priority: 'NORMAL' });
  const set = <K extends keyof CreateForm>(k: K, v: CreateForm[K]) =>
    setF(p => ({ ...p, [k]: v }));

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>
      )}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium t-text">
          {t('customerSupport.title')} <span className="text-red-500" aria-hidden>*</span>
        </label>
        <input type="text" required minLength={3} maxLength={200} value={f.title}
          onChange={e => set('title', e.target.value)}
          className={inp} disabled={busy} placeholder={t('customerSupport.titlePh')} />
      </div>
      <div className="space-y-1.5">
        <label className="block text-sm font-medium t-text">
          {t('customerSupport.description')} <span className="text-red-500" aria-hidden>*</span>
        </label>
        <textarea required minLength={10} maxLength={5000} rows={5} value={f.description}
          onChange={e => set('description', e.target.value)}
          className={inp} disabled={busy} placeholder={t('customerSupport.descPh')} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium t-text">{t('customerSupport.category')}</label>
          <select value={f.category} onChange={e => set('category', e.target.value)} className={inp} disabled={busy}>
            <option value="QUESTION">QUESTION</option>
            <option value="BUG">BUG</option>
            <option value="FEATURE_REQUEST">FEATURE_REQUEST</option>
            <option value="INCIDENT">INCIDENT</option>
            <option value="BILLING">BILLING</option>
            <option value="OTHER">OTHER</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium t-text">{t('customerSupport.priority')}</label>
          <select value={f.priority} onChange={e => set('priority', e.target.value)} className={inp} disabled={busy}>
            <option value="LOW">LOW</option>
            <option value="NORMAL">NORMAL</option>
            <option value="HIGH">HIGH</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
          <p className="text-[11px] t-text-3">{t('customerSupport.priorityHint')}</p>
        </div>
      </div>
      <div className="flex justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          <X className="w-4 h-4 mr-1.5" aria-hidden />{t('common.cancel')}
        </Button>
        <Button type="submit" disabled={busy}>
          <Send className="w-4 h-4 mr-1.5" aria-hidden />{busy ? t('common.creating') : t('customerSupport.send')}
        </Button>
      </div>
    </form>
  );
}

// ─── Detail dialog ─────────────────────────────────────────────────────────

function DetailDialog({
  open, ticketId, onClose, canWrite, onChanged,
}: {
  open: boolean; ticketId: string | null; onClose: () => void;
  canWrite: boolean; onChanged: () => void;
}) {
  const { t, dateLocale } = useI18n();
  const { data, loading, error, refetch } = useFetch<TicketDetail>(
    ticketId ? `/api/support/tickets/${ticketId}` : null, [ticketId],
  );
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  useEffect(() => { setBody(''); setActionErr(null); }, [ticketId]);

  if (!open || !ticketId) return null;

  const sendReply = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setActionErr(null);
    try {
      await apiPost(`/api/support/tickets/${ticketId}/messages`, { body });
      setBody('');
      refetch(); onChanged();
    } catch (err) { setActionErr((err as Error).message); }
    finally { setBusy(false); }
  };

  const closed = data ? ['RESOLVED', 'CLOSED'].includes(data.status) : false;

  return (
    <Dialog
      open={open}
      onOpenChange={o => { if (!o) onClose(); }}
      title={data?.title ?? t('common.loading')}
      size="xl"
    >
      {loading && <p className="text-sm t-text-3">{t('common.loading')}…</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {data && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <Badge variant={statusVariant(data.status)} size="sm">{data.status}</Badge>
            <Badge variant={priorityVariant(data.priority)} size="sm">{data.priority}</Badge>
            <Badge variant="default" size="sm">{data.category}</Badge>
            <span className="text-xs t-text-3 ml-auto">
              <Clock className="inline w-3 h-3 mr-1" aria-hidden />
              {new Date(data.createdAt).toLocaleString(dateLocale)}
            </span>
          </div>

          <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-2">
            {data.messages.map(m => (
              <div key={m.id}
                className={`rounded-lg p-3 text-sm border ${
                  m.authorScope === 'TENANT'
                    ? 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                    : 'bg-teal-50 dark:bg-teal-950/20 border-teal-200 dark:border-teal-900'
                }`}>
                <div className="flex items-center gap-2 text-[11px] t-text-3 mb-1">
                  <Badge variant={m.authorScope === 'PLATFORM' ? 'success' : 'info'} size="sm">
                    {m.authorScope === 'PLATFORM' ? t('customerSupport.agent') : t('customerSupport.you')}
                  </Badge>
                  <span className="ml-auto">{new Date(m.createdAt).toLocaleString(dateLocale)}</span>
                </div>
                <p className="whitespace-pre-wrap break-words t-text-body">{m.body}</p>
              </div>
            ))}
          </div>

          {actionErr && (
            <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{actionErr}</div>
          )}

          {canWrite && !closed && (
            <form onSubmit={sendReply} className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <label className="block text-xs font-medium t-text-2">{t('customerSupport.reply')}</label>
              <textarea rows={3} required minLength={1} maxLength={10000}
                value={body} onChange={e => setBody(e.target.value)}
                className={inp} disabled={busy}
                placeholder={t('customerSupport.replyPh')} />
              <div className="flex justify-end">
                <Button type="submit" disabled={busy || !body.trim()}>
                  <Send className="w-4 h-4 mr-1.5" aria-hidden />{busy ? t('common.saving') : t('customerSupport.send')}
                </Button>
              </div>
            </form>
          )}
          {closed && (
            <p className="text-xs t-text-3 text-center">{t('customerSupport.closedNotice')}</p>
          )}
        </div>
      )}
    </Dialog>
  );
}

// ─── Composant principal ─────────────────────────────────────────────────────

export function PageCustomerSupport() {
  const { user } = useAuth();
  const { t, dateLocale } = useI18n();

  const canCreate = (user?.permissions ?? []).includes('data.support.create.tenant');
  const canRead   = (user?.permissions ?? []).includes('data.support.read.tenant');

  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: tickets, loading, error, refetch } = useFetch<TicketRow[]>(
    canRead || canCreate ? '/api/support/tickets' : null,
  );

  const handleCreate = async (f: CreateForm) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPost('/api/support/tickets', f);
      setShowCreate(false);
      refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const columns: Column<TicketRow>[] = useMemo(() => ([
    {
      key: 'title',
      header: t('customerSupport.colTitle'),
      sortable: true,
      cellRenderer: (_v, row) => (
        <div className="min-w-0">
          <p className="text-sm font-medium t-text truncate">{row.title}</p>
          <p className="text-[11px] t-text-3">{row.category}</p>
        </div>
      ),
      csvValue: (_v, row) => row.title,
    },
    {
      key: 'priority',
      header: t('customerSupport.priority'),
      sortable: true,
      width: '110px',
      cellRenderer: (v) => <Badge variant={priorityVariant(String(v))} size="sm">{String(v)}</Badge>,
      csvValue: (v) => String(v ?? ''),
    },
    {
      key: 'status',
      header: t('customerSupport.status'),
      sortable: true,
      width: '140px',
      cellRenderer: (v) => <Badge variant={statusVariant(String(v))} size="sm">{String(v)}</Badge>,
      csvValue: (v) => String(v ?? ''),
    },
    {
      key: 'createdAt',
      header: t('customerSupport.openedAt'),
      sortable: true,
      width: '130px',
      cellRenderer: (v) => (
        <span className="text-xs t-text-3">{new Date(String(v)).toLocaleDateString(dateLocale)}</span>
      ),
      csvValue: (v) => new Date(String(v)).toLocaleDateString(dateLocale),
    },
  ]), [t, dateLocale]);

  const actions: RowAction<TicketRow>[] = [
    { label: t('customerSupport.view'), icon: <MessageSquare size={13} />, onClick: (r) => setOpenId(r.id) },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
            <LifeBuoy className="w-5 h-5 text-teal-700 dark:text-teal-300" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold t-text">{t('customerSupport.heading')}</h1>
            <p className="text-sm t-text-2">{t('customerSupport.subtitle')}</p>
          </div>
        </div>
        {canCreate && (
          <Button onClick={() => { setShowCreate(true); setActionErr(null); }}>
            <Plus className="w-4 h-4 mr-2" aria-hidden />{t('customerSupport.newTicket')}
          </Button>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />{error}
        </div>
      )}

      <DataTableMaster<TicketRow>
        columns={columns}
        data={tickets ?? []}
        loading={loading}
        rowActions={actions}
        onRowClick={(r) => setOpenId(r.id)}
        defaultSort={{ key: 'createdAt', dir: 'desc' }}
        defaultPageSize={25}
        searchPlaceholder={t('customerSupport.searchPlaceholder')}
        emptyMessage={t('customerSupport.empty')}
        stickyHeader
      />

      <Dialog
        open={showCreate}
        onOpenChange={o => { if (!o) setShowCreate(false); }}
        title={t('customerSupport.newTicket')}
        description={t('customerSupport.newDesc')}
        size="lg"
      >
        <CreateTicketForm
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
          busy={busy}
          error={actionErr}
        />
      </Dialog>

      <DetailDialog
        open={!!openId}
        ticketId={openId}
        onClose={() => setOpenId(null)}
        canWrite={canCreate}
        onChanged={() => refetch()}
      />
    </div>
  );
}
