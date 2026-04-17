/**
 * PageAnnouncements — Annonces gare (sonores / visuelles)
 *
 * API :
 *   GET    /api/v1/tenants/:tid/announcements
 *   POST   /api/v1/tenants/:tid/announcements
 *   PATCH  /api/v1/tenants/:tid/announcements/:id
 *   DELETE /api/v1/tenants/:tid/announcements/:id
 */

import { useState, type FormEvent } from 'react';
import {
  Volume2, Plus, Pencil, Trash2, ToggleLeft, X, Megaphone,
} from 'lucide-react';
import { useAuth }       from '../../lib/auth/auth.context';
import { useFetch }      from '../../lib/hooks/useFetch';
import { apiPost, apiPatch, apiDelete } from '../../lib/api';
import { useI18n }       from '../../lib/i18n/useI18n';
import { Badge }         from '../ui/Badge';
import { Button }        from '../ui/Button';
import { Dialog }        from '../ui/Dialog';
import { ErrorAlert }    from '../ui/ErrorAlert';
import { FormFooter }    from '../ui/FormFooter';
import { inputClass as inp } from '../ui/inputClass';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

// ─── Types ────────────────────────────────────────────────────────────────────

type AnnouncementType = 'INFO' | 'DELAY' | 'CANCELLATION' | 'SECURITY' | 'PROMO' | 'CUSTOM';

interface AnnouncementRow {
  id:         string;
  stationId:  string | null;
  title:      string;
  message:    string;
  type:       AnnouncementType;
  priority:   number;
  isActive:   boolean;
  startsAt:   string;
  endsAt:     string | null;
  createdAt:  string;
  station?:   { id: string; name: string; city: string } | null;
}

interface StationRow { id: string; name: string; city: string; }

const TYPE_VARIANT: Record<AnnouncementType, 'default' | 'warning' | 'danger' | 'success'> = {
  INFO:         'default',
  DELAY:        'warning',
  CANCELLATION: 'danger',
  SECURITY:     'danger',
  PROMO:        'success',
  CUSTOM:       'default',
};

// ─── Build Columns ────────────────────────────────────────────────────────────

function buildColumns(t: (k: string) => string): Column<AnnouncementRow>[] {
  return [
    {
      key: 'title', header: t('announcements.colTitle'), sortable: true,
      cellRenderer: (_v, row) => (
        <div className="flex items-center gap-2">
          <Megaphone className="w-4 h-4 text-violet-500" />
          <span className="font-medium text-slate-900 dark:text-slate-100">{row.title}</span>
        </div>
      ),
    },
    {
      key: 'type', header: t('announcements.colType'),
      cellRenderer: (_v, row) => (
        <Badge variant={TYPE_VARIANT[row.type]}>
          {t(`announcements.type${row.type.charAt(0) + row.type.slice(1).toLowerCase()}`)}
        </Badge>
      ),
    },
    {
      key: 'station.name' as keyof AnnouncementRow, header: t('announcements.colStation'),
      cellRenderer: (_v, row) => row.station ? row.station.name : t('announcements.allStations'),
    },
    {
      key: 'message', header: t('announcements.colMessage'),
      cellRenderer: (v) => {
        const msg = v as string;
        return msg.length > 60 ? msg.slice(0, 60) + '…' : msg;
      },
    },
    {
      key: 'isActive', header: t('announcements.colStatus'),
      cellRenderer: (v) => (
        <Badge variant={v ? 'success' : 'default'}>
          {v ? t('announcements.active') : t('announcements.inactive')}
        </Badge>
      ),
    },
    { key: 'priority', header: t('announcements.colPriority'), sortable: true },
    {
      key: 'startsAt', header: t('announcements.colStart'),
      cellRenderer: (v) => new Date(v as string).toLocaleDateString(),
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PageAnnouncements() {
  const { user: me } = useAuth();
  const { t }        = useI18n();
  const tenantId     = me?.tenantId ?? '';
  const base         = `/api/v1/tenants/${tenantId}/announcements`;

  const { data: announcements, loading, refetch } = useFetch<AnnouncementRow[]>(tenantId ? base : null, [tenantId]);
  const { data: stations } = useFetch<StationRow[]>(tenantId ? `/api/tenants/${tenantId}/stations` : null, [tenantId]);

  const [showCreate, setShowCreate]     = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AnnouncementRow | null>(null);
  const [busy, setBusy]     = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true); setActionErr(null);
    try {
      await apiPost(base, {
        stationId: fd.get('stationId') || undefined,
        title:     fd.get('title'),
        message:   fd.get('message'),
        type:      fd.get('type') || 'INFO',
        priority:  parseInt(fd.get('priority') as string) || 0,
        endsAt:    fd.get('endsAt') || undefined,
        isActive:  true,
      });
      setShowCreate(false); refetch();
    } catch (err) { setActionErr((err as Error).message); }
    finally { setBusy(false); }
  };

  const handleToggle = async (row: AnnouncementRow) => {
    try { await apiPatch(`${base}/${row.id}`, { isActive: !row.isActive }); refetch(); }
    catch (err) { setActionErr((err as Error).message); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true); setActionErr(null);
    try { await apiDelete(`${base}/${deleteTarget.id}`); setDeleteTarget(null); refetch(); }
    catch (err) { setActionErr((err as Error).message); }
    finally { setBusy(false); }
  };

  const rowActions: RowAction<AnnouncementRow>[] = [
    { label: t('announcements.toggle'), icon: <ToggleLeft size={13} />, onClick: (row) => handleToggle(row) },
    { label: t('common.delete'), icon: <Trash2 size={13} />, variant: 'danger' as const, onClick: (row) => { setDeleteTarget(row); setActionErr(null); } },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('announcements.title')}</h1>
        <Button onClick={() => { setShowCreate(true); setActionErr(null); }}>
          <Plus className="w-4 h-4 mr-2" />{t('announcements.newAnnouncement')}
        </Button>
      </div>

      <DataTableMaster<AnnouncementRow>
        columns={buildColumns(t)}
        data={announcements ?? []}
        loading={loading}
        rowActions={rowActions}
        defaultSort={{ key: 'priority', dir: 'desc' }}
        defaultPageSize={25}
        searchPlaceholder={t('announcements.searchPlaceholder')}
        emptyMessage={t('announcements.emptyMsg')}
        exportFormats={['csv', 'json', 'xls']}
        exportFilename="annonces"
        stickyHeader
      />

      {/* Dialog création */}
      <Dialog open={showCreate} onOpenChange={o => { if (!o) setShowCreate(false); }} title={t('announcements.newAnnouncement')} size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <ErrorAlert error={actionErr} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('announcements.titleLabel')} <span className="text-red-500">*</span></label>
              <input name="title" required className={inp} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('announcements.type')}</label>
              <select name="type" className={inp} disabled={busy}>
                <option value="INFO">Info</option>
                <option value="DELAY">{t('announcements.typeDelay')}</option>
                <option value="CANCELLATION">{t('announcements.typeCancellation')}</option>
                <option value="SECURITY">{t('announcements.typeSecurity')}</option>
                <option value="PROMO">{t('announcements.typePromo')}</option>
                <option value="CUSTOM">{t('announcements.typeCustom')}</option>
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className="block text-sm font-medium">{t('announcements.message')} <span className="text-red-500">*</span></label>
              <textarea name="message" required rows={3} className={inp} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('announcements.station')}</label>
              <select name="stationId" className={inp} disabled={busy}>
                <option value="">{t('announcements.allStations')}</option>
                {(stations ?? []).map(s => <option key={s.id} value={s.id}>{s.name} — {s.city}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('announcements.priority')}</label>
              <input name="priority" type="number" defaultValue="0" className={inp} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('announcements.endsAt')}</label>
              <input name="endsAt" type="datetime-local" className={inp} disabled={busy} />
            </div>
          </div>
          <FormFooter
            busy={busy}
            submitLabel={t('common.create')}
            pendingLabel={t('common.creating')}
            onCancel={() => setShowCreate(false)}
          />
        </form>
      </Dialog>

      {/* Dialog suppression */}
      <Dialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null); }} title={t('announcements.confirmDelete')} size="sm">
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
          {t('announcements.deleteMsg')} <strong>{deleteTarget?.title}</strong> ?
        </p>
        <ErrorAlert error={actionErr} />
        <FormFooter busy={busy} submitLabel={t('common.delete')} pendingLabel={t('common.deleting')} onCancel={() => setDeleteTarget(null)} onSubmit={handleDelete} variant="danger" />
      </Dialog>
    </div>
  );
}
