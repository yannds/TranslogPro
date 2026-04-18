/**
 * PagePlatformSupport — Queue support côté plateforme (SUPER_ADMIN / L1 / L2).
 *
 * Listing filtrable des tickets soumis par les tenants. Détail du ticket
 * avec thread de messages + actions (assigner, changer priorité/statut,
 * répondre, note interne).
 *
 * Endpoints :
 *   GET   /api/platform/support/tickets?status=&priority=&tenantId=&assignee=
 *   GET   /api/platform/support/tickets/:id
 *   PATCH /api/platform/support/tickets/:id      { status?, priority?, assignedToPlatformUserId? }
 *   POST  /api/platform/support/tickets/:id/messages   { body, isInternal? }
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  LifeBuoy, AlertTriangle, Send, Clock, MessageSquare,
  Lock, UserCog,
} from 'lucide-react';
import { useFetch }                        from '../../lib/hooks/useFetch';
import { apiPost, apiPatch }                from '../../lib/api';
import { useAuth }                         from '../../lib/auth/auth.context';
import { useI18n }                         from '../../lib/i18n/useI18n';
import { Button }                          from '../ui/Button';
import { Badge }                           from '../ui/Badge';
import { Dialog }                          from '../ui/Dialog';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

const P_SUPPORT_WRITE = 'control.platform.support.write.global';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TicketSummary {
  id:        string;
  tenantId:  string;
  title:     string;
  category:  string;
  priority:  string;
  status:    string;
  createdAt: string;
  slaDueAt:  string | null;
  firstResponseAt: string | null;
  tenant?:   { id: string; name: string; slug: string; country: string };
  _count?:   { messages: number };
}

interface Message {
  id:          string;
  ticketId:    string;
  authorId:    string;
  authorScope: 'TENANT' | 'PLATFORM';
  body:        string;
  attachments: unknown[];
  isInternal:  boolean;
  createdAt:   string;
}

interface TicketDetail extends TicketSummary {
  description: string;
  reporterUserId: string;
  assignedToPlatformUserId: string | null;
  resolvedAt: string | null;
  tenant:     TicketSummary['tenant'] & { planId: string | null; plan?: { name: string; slug: string; sla: Record<string, unknown> } };
  messages:   Message[];
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

// ─── Ticket detail dialog ───────────────────────────────────────────────────

function TicketDetailDialog({
  ticketId, open, onClose, canWrite, onChanged,
}: {
  ticketId: string | null;
  open: boolean;
  onClose: () => void;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const { t, dateLocale } = useI18n();

  const { data, loading, error, refetch } = useFetch<TicketDetail>(
    ticketId ? `/api/platform/support/tickets/${ticketId}` : null,
    [ticketId],
  );

  const [body, setBody]             = useState('');
  const [internal, setInternal]     = useState(false);
  const [busy, setBusy]             = useState(false);
  const [actionErr, setActionErr]   = useState<string | null>(null);

  useEffect(() => {
    setBody(''); setInternal(false); setActionErr(null);
  }, [ticketId]);

  if (!open || !ticketId) return null;

  const sendReply = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setActionErr(null);
    try {
      await apiPost(`/api/platform/support/tickets/${ticketId}/messages`, {
        body, isInternal: internal,
      });
      setBody('');
      setInternal(false);
      refetch();
      onChanged();
    } catch (err) { setActionErr((err as Error).message); }
    finally { setBusy(false); }
  };

  const changeStatus = async (status: string) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPatch(`/api/platform/support/tickets/${ticketId}`, { status });
      refetch(); onChanged();
    } catch (err) { setActionErr((err as Error).message); }
    finally { setBusy(false); }
  };

  const changePriority = async (priority: string) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPatch(`/api/platform/support/tickets/${ticketId}`, { priority });
      refetch(); onChanged();
    } catch (err) { setActionErr((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={data ? data.title : t('common.loading')}
      description={data?.tenant?.name}
      size="2xl"
    >
      {loading && <p className="text-sm t-text-3">{t('common.loading')}…</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {data && (
        <div className="space-y-4">
          {/* Header */}
          <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <Badge variant={statusVariant(data.status)} size="sm">{data.status}</Badge>
            <Badge variant={priorityVariant(data.priority)} size="sm">{data.priority}</Badge>
            <Badge variant="default" size="sm">{data.category}</Badge>
            <span className="text-xs t-text-3 ml-auto">
              {t('platformSupport.tenant')} : <span className="font-mono">{data.tenant?.slug}</span>
              {data.tenant?.plan && <span className="ml-2">· {t('platformSupport.plan')}: {data.tenant.plan.name}</span>}
            </span>
          </div>

          {/* Timing */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] t-text-3">
            <span><Clock className="inline w-3 h-3 mr-1" aria-hidden />{t('platformSupport.openedAt')}: {new Date(data.createdAt).toLocaleString(dateLocale)}</span>
            {data.slaDueAt && <span>{t('platformSupport.slaDueAt')}: {new Date(data.slaDueAt).toLocaleString(dateLocale)}</span>}
            {data.firstResponseAt && <span>{t('platformSupport.firstResponseAt')}: {new Date(data.firstResponseAt).toLocaleString(dateLocale)}</span>}
            {data.resolvedAt && <span>{t('platformSupport.resolvedAt')}: {new Date(data.resolvedAt).toLocaleString(dateLocale)}</span>}
          </div>

          {/* Thread messages */}
          <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-2">
            {data.messages.map(m => (
              <div
                key={m.id}
                className={`rounded-lg p-3 text-sm border ${
                  m.isInternal
                    ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900'
                    : m.authorScope === 'TENANT'
                      ? 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                      : 'bg-teal-50 dark:bg-teal-950/20 border-teal-200 dark:border-teal-900'
                }`}
              >
                <div className="flex items-center gap-2 text-[11px] t-text-3 mb-1">
                  <Badge variant={m.authorScope === 'PLATFORM' ? 'success' : 'info'} size="sm">
                    {m.authorScope}
                  </Badge>
                  {m.isInternal && (
                    <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                      <Lock className="w-3 h-3" aria-hidden />{t('platformSupport.internalNote')}
                    </span>
                  )}
                  <span className="ml-auto">{new Date(m.createdAt).toLocaleString(dateLocale)}</span>
                </div>
                <p className="whitespace-pre-wrap break-words t-text-body">{m.body}</p>
              </div>
            ))}
          </div>

          {actionErr && (
            <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{actionErr}</div>
          )}

          {/* Actions plateforme (only L1/L2/SA with write perm) */}
          {canWrite && (
            <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <div className="flex flex-wrap gap-2">
                <select value={data.status} onChange={e => changeStatus(e.target.value)} disabled={busy}
                  className={`${inp} max-w-[200px]`} aria-label={t('platformSupport.changeStatus')}>
                  <option value="OPEN">OPEN</option>
                  <option value="IN_PROGRESS">IN_PROGRESS</option>
                  <option value="WAITING_CUSTOMER">WAITING_CUSTOMER</option>
                  <option value="RESOLVED">RESOLVED</option>
                  <option value="CLOSED">CLOSED</option>
                </select>
                <select value={data.priority} onChange={e => changePriority(e.target.value)} disabled={busy}
                  className={`${inp} max-w-[160px]`} aria-label={t('platformSupport.changePriority')}>
                  <option value="LOW">LOW</option>
                  <option value="NORMAL">NORMAL</option>
                  <option value="HIGH">HIGH</option>
                  <option value="CRITICAL">CRITICAL</option>
                </select>
              </div>

              <form onSubmit={sendReply} className="space-y-2">
                <label className="block text-xs font-medium t-text-2">{t('platformSupport.reply')}</label>
                <textarea
                  rows={3} required maxLength={10000}
                  value={body} onChange={e => setBody(e.target.value)}
                  className={inp} disabled={busy}
                  placeholder={t('platformSupport.replyPh')}
                />
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={internal}
                      onChange={e => setInternal(e.target.checked)} disabled={busy} />
                    <Lock className="w-3 h-3" aria-hidden />
                    {t('platformSupport.internalNote')}
                  </label>
                  <Button type="submit" disabled={busy || !body.trim()}>
                    <Send className="w-4 h-4 mr-1.5" aria-hidden />
                    {busy ? t('common.saving') : t('platformSupport.send')}
                  </Button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

// ─── Composant principal ─────────────────────────────────────────────────────

export function PagePlatformSupport() {
  const { user } = useAuth();
  const { t, dateLocale } = useI18n();

  const canWrite = (user?.permissions ?? []).includes(P_SUPPORT_WRITE);

  const [status,   setStatus]   = useState<string>('');
  const [priority, setPriority] = useState<string>('');

  const qs = useMemo(() => {
    const q = new URLSearchParams();
    if (status)   q.set('status', status);
    if (priority) q.set('priority', priority);
    const s = q.toString();
    return s ? `?${s}` : '';
  }, [status, priority]);

  const { data: tickets, loading, error, refetch } =
    useFetch<TicketSummary[]>(`/api/platform/support/tickets${qs}`, [qs]);

  const [openId, setOpenId] = useState<string | null>(null);

  const columns: Column<TicketSummary>[] = [
    {
      key: 'title',
      header: t('platformSupport.colTitle'),
      sortable: true,
      cellRenderer: (_v, row) => (
        <div className="min-w-0">
          <p className="text-sm font-medium t-text truncate">{row.title}</p>
          <p className="text-[11px] t-text-3 truncate">{row.tenant?.name ?? row.tenantId.slice(0, 8)}</p>
        </div>
      ),
      csvValue: (_v, row) => row.title,
    },
    {
      key: 'priority',
      header: t('platformSupport.colPriority'),
      sortable: true,
      width: '110px',
      cellRenderer: (v) => <Badge variant={priorityVariant(String(v))} size="sm">{String(v)}</Badge>,
      csvValue: (v) => String(v ?? ''),
    },
    {
      key: 'status',
      header: t('platformSupport.colStatus'),
      sortable: true,
      width: '140px',
      cellRenderer: (v) => <Badge variant={statusVariant(String(v))} size="sm">{String(v)}</Badge>,
      csvValue: (v) => String(v ?? ''),
    },
    {
      key: 'category',
      header: t('platformSupport.colCategory'),
      sortable: true,
      width: '140px',
      cellRenderer: (v) => <span className="text-xs font-mono t-text-2">{String(v)}</span>,
      csvValue: (v) => String(v ?? ''),
    },
    {
      key: 'createdAt',
      header: t('platformSupport.colOpenedAt'),
      sortable: true,
      width: '130px',
      cellRenderer: (v) => (
        <span className="text-xs t-text-3">{new Date(String(v)).toLocaleDateString(dateLocale)}</span>
      ),
      csvValue: (v) => new Date(String(v)).toLocaleDateString(dateLocale),
    },
    {
      key: 'slaDueAt',
      header: t('platformSupport.colSla'),
      width: '130px',
      cellRenderer: (v) => v
        ? <span className="text-xs t-text-3">{new Date(String(v)).toLocaleString(dateLocale)}</span>
        : <span className="text-xs t-text-3">—</span>,
      csvValue: (v) => v ? new Date(String(v)).toLocaleString(dateLocale) : '',
    },
  ];

  const actions: RowAction<TicketSummary>[] = [
    {
      label:   t('platformSupport.viewDetail'),
      icon:    <MessageSquare size={13} />,
      onClick: (r) => setOpenId(r.id),
    },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
          <LifeBuoy className="w-5 h-5 text-teal-700 dark:text-teal-300" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold t-text">{t('platformSupport.title')}</h1>
          <p className="text-sm t-text-2">
            {tickets ? `${tickets.length} ${t('platformSupport.ticketsCount')}` : t('platformSupport.subtitle')}
          </p>
        </div>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-3">
        <div>
          <label htmlFor="ps-status" className="sr-only">{t('platformSupport.filterStatus')}</label>
          <select id="ps-status" value={status} onChange={e => setStatus(e.target.value)} className={`${inp} max-w-[200px]`}>
            <option value="">{t('platformSupport.filterStatus')}</option>
            <option value="OPEN">OPEN</option>
            <option value="IN_PROGRESS">IN_PROGRESS</option>
            <option value="WAITING_CUSTOMER">WAITING_CUSTOMER</option>
            <option value="RESOLVED">RESOLVED</option>
            <option value="CLOSED">CLOSED</option>
          </select>
        </div>
        <div>
          <label htmlFor="ps-prio" className="sr-only">{t('platformSupport.filterPriority')}</label>
          <select id="ps-prio" value={priority} onChange={e => setPriority(e.target.value)} className={`${inp} max-w-[200px]`}>
            <option value="">{t('platformSupport.filterPriority')}</option>
            <option value="LOW">LOW</option>
            <option value="NORMAL">NORMAL</option>
            <option value="HIGH">HIGH</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
        </div>
        {!canWrite && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs t-text-3">
            <UserCog className="w-3 h-3" aria-hidden />{t('platformSupport.readOnly')}
          </span>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />{error}
        </div>
      )}

      <DataTableMaster<TicketSummary>
        columns={columns}
        data={tickets ?? []}
        loading={loading}
        rowActions={actions}
        onRowClick={(r) => setOpenId(r.id)}
        defaultSort={{ key: 'createdAt', dir: 'desc' }}
        defaultPageSize={25}
        searchPlaceholder={t('platformSupport.searchPlaceholder')}
        emptyMessage={t('platformSupport.emptyMsg')}
        stickyHeader
      />

      <TicketDetailDialog
        ticketId={openId}
        open={!!openId}
        onClose={() => setOpenId(null)}
        canWrite={canWrite}
        onChanged={() => refetch()}
      />
    </div>
  );
}
