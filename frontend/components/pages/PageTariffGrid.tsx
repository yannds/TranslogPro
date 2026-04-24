/**
 * PageTariffGrid — Grille tarifaire
 *
 * CRUD des grilles tarifaires par route (multiplicateurs, prix fixes,
 * plages horaires, jours de semaine, périodes de validité).
 *
 * API :
 *   GET    /api/tenants/:tid/tariffs
 *   POST   /api/tenants/:tid/tariffs
 *   PATCH  /api/tenants/:tid/tariffs/:id
 *   DELETE /api/tenants/:tid/tariffs/:id
 */

import { useState, type FormEvent } from 'react';
import {
  Grid3x3, Plus, Pencil, Trash2, ToggleLeft, ToggleRight, X,
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

interface TariffRow {
  id:         string;
  routeId:    string;
  name:       string;
  busType:    string | null;
  multiplier: number;
  fixedPrice: number | null;
  startHour:  number | null;
  endHour:    number | null;
  dayMask:    number;
  validFrom:  string | null;
  validTo:    string | null;
  isActive:   boolean;
  priority:   number;
  route?:     { id: string; name: string };
}

interface RouteRow { id: string; name: string; }

const DAY_LABELS = ['L', 'M', 'Me', 'J', 'V', 'S', 'D'];

function dayMaskToStr(mask: number): string {
  return DAY_LABELS.filter((_, i) => mask & (1 << i)).join(', ');
}

// ─── Build Columns ────────────────────────────────────────────────────────────

function buildColumns(t: (k: string) => string): Column<TariffRow>[] {
  return [
    {
      key: 'name', header: t('tariffGrid.colName'), sortable: true,
      cellRenderer: (_v, row) => (
        <div className="flex items-center gap-2">
          <Grid3x3 className="w-4 h-4 text-indigo-500" />
          <span className="font-medium text-slate-900 dark:text-slate-100">{row.name}</span>
        </div>
      ),
    },
    {
      key: 'route.name' as keyof TariffRow, header: t('tariffGrid.colRoute'), sortable: true,
      cellRenderer: (_v, row) => row.route?.name ?? '—',
    },
    {
      key: 'busType', header: t('tariffGrid.colClass'), sortable: true,
      cellRenderer: (v) => (v as string) ?? t('tariffGrid.allClasses'),
    },
    {
      key: 'multiplier', header: t('tariffGrid.colMultiplier'),
      cellRenderer: (_v, row) => row.fixedPrice != null
        ? `${row.fixedPrice.toLocaleString()} XAF`
        : `×${row.multiplier.toFixed(2)}`,
    },
    {
      key: 'dayMask', header: t('tariffGrid.colDays'),
      cellRenderer: (_v, row) => row.dayMask === 127 ? t('tariffGrid.everyDay') : dayMaskToStr(row.dayMask),
    },
    {
      key: 'isActive', header: t('tariffGrid.colStatus'),
      cellRenderer: (v) => (
        <Badge variant={v ? 'success' : 'default'}>
          {v ? t('tariffGrid.active') : t('tariffGrid.inactive')}
        </Badge>
      ),
    },
    {
      key: 'priority', header: t('tariffGrid.colPriority'), sortable: true,
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PageTariffGrid() {
  const { user: me } = useAuth();
  const { t }        = useI18n();
  const tenantId     = me?.tenantId ?? '';
  const base         = `/api/tenants/${tenantId}/tariffs`;

  const { data: grids, loading, refetch } = useFetch<TariffRow[]>(tenantId ? base : null, [tenantId]);
  const { data: routes } = useFetch<RouteRow[]>(tenantId ? `/api/tenants/${tenantId}/routes` : null, [tenantId]);

  const [showCreate, setShowCreate]       = useState(false);
  const [editTarget, setEditTarget]       = useState<TariffRow | null>(null);
  const [deleteTarget, setDeleteTarget]   = useState<TariffRow | null>(null);
  const [busy, setBusy]     = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true); setActionErr(null);
    try {
      await apiPost(base, {
        routeId:    fd.get('routeId'),
        name:       fd.get('name'),
        busType:    fd.get('busType') || undefined,
        multiplier: parseFloat(fd.get('multiplier') as string) || 1.0,
        fixedPrice: fd.get('fixedPrice') ? parseFloat(fd.get('fixedPrice') as string) : undefined,
        dayMask:    parseInt(fd.get('dayMask') as string) || 127,
        priority:   parseInt(fd.get('priority') as string) || 0,
        isActive:   true,
      });
      setShowCreate(false); refetch();
    } catch (err) { setActionErr((err as Error).message); }
    finally { setBusy(false); }
  };

  const handleToggle = async (row: TariffRow) => {
    try {
      await apiPatch(`${base}/${row.id}`, { isActive: !row.isActive });
      refetch();
    } catch (err) { setActionErr((err as Error).message); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true); setActionErr(null);
    try {
      await apiDelete(`${base}/${deleteTarget.id}`);
      setDeleteTarget(null); refetch();
    } catch (err) { setActionErr((err as Error).message); }
    finally { setBusy(false); }
  };

  const rowActions: RowAction<TariffRow>[] = [
    {
      label: t('tariffGrid.toggle'), icon: <ToggleLeft size={13} />,
      onClick: (row) => handleToggle(row),
    },
    {
      label: t('common.delete'), icon: <Trash2 size={13} />,
      variant: 'danger' as const,
      onClick: (row) => { setDeleteTarget(row); setActionErr(null); },
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('tariffGrid.title')}</h1>
        <Button onClick={() => { setShowCreate(true); setActionErr(null); }}>
          <Plus className="w-4 h-4 mr-2" />{t('tariffGrid.newGrid')}
        </Button>
      </div>

      <DataTableMaster<TariffRow>
        columns={buildColumns(t)}
        data={grids ?? []}
        loading={loading}
        rowActions={rowActions}
        defaultSort={{ key: 'priority', dir: 'desc' }}
        defaultPageSize={25}
        searchPlaceholder={t('tariffGrid.searchPlaceholder')}
        emptyMessage={t('tariffGrid.emptyMsg')}
        exportFormats={['csv', 'json', 'xls']}
        exportFilename="grille-tarifaire"
        stickyHeader
      />

      {/* Dialog création */}
      <Dialog open={showCreate} onOpenChange={o => { if (!o) setShowCreate(false); }} title={t('tariffGrid.newGrid')} size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <ErrorAlert error={actionErr} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('tariffGrid.name')} <span className="text-red-500">*</span></label>
              <input name="name" required className={inp} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('tariffGrid.route')} <span className="text-red-500">*</span></label>
              <select name="routeId" required className={inp} disabled={busy}>
                <option value="">{t('tariffGrid.selectRoute')}</option>
                {(routes ?? []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('tariffGrid.class')}</label>
              <select name="busType" className={inp} disabled={busy}>
                <option value="">{t('tariffGrid.allClasses')}</option>
                <option value="STANDARD">Standard</option>
                <option value="CONFORT">Confort</option>
                <option value="VIP">VIP</option>
                <option value="MINIBUS">Minibus</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('tariffGrid.multiplier')}</label>
              <input name="multiplier" type="number" step="0.01" min="0" defaultValue="1.0" className={inp} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('tariffGrid.fixedPrice')}</label>
              <input name="fixedPrice" type="number" step="1" min="0" className={inp} disabled={busy} placeholder={t('tariffGrid.fixedPricePlaceholder')} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('tariffGrid.dayMask')}</label>
              <input name="dayMask" type="number" min="0" max="127" defaultValue="127" className={inp} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('tariffGrid.priority')}</label>
              <input name="priority" type="number" defaultValue="0" className={inp} disabled={busy} />
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
      <Dialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null); }} title={t('tariffGrid.confirmDelete')} size="sm">
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
          {t('tariffGrid.deleteMsg')} <strong>{deleteTarget?.name}</strong> ?
        </p>
        <ErrorAlert error={actionErr} />
        <FormFooter
          busy={busy}
          submitLabel={t('common.delete')}
          pendingLabel={t('common.deleting')}
          onCancel={() => setDeleteTarget(null)}
          onSubmit={handleDelete}
          variant="danger"
        />
      </Dialog>
    </div>
  );
}
