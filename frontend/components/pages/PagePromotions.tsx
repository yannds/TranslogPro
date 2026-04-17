/**
 * PagePromotions — Gestion des promotions (CRUD)
 *
 * Fonctionnalites :
 *   - DataTableMaster : tri, recherche, pagination, export CSV/XLS
 *   - CRUD complet via Dialog (creation / edition)
 *   - Toggle activation rapide via row action
 *   - Suppression protegee (masquee si usedCount > 0)
 *   - Dark mode, responsive, WCAG
 *
 * API :
 *   GET    /api/v1/tenants/:tid/promotions
 *   POST   /api/v1/tenants/:tid/promotions
 *   PATCH  /api/v1/tenants/:tid/promotions/:id
 *   DELETE /api/v1/tenants/:tid/promotions/:id
 */

import { useState, useCallback, type FormEvent } from 'react';
import {
  Percent, Plus, Pencil, ToggleLeft, Trash2,
} from 'lucide-react';
import { useAuth }       from '../../lib/auth/auth.context';
import { useI18n }       from '../../lib/i18n/useI18n';
import { useFetch }      from '../../lib/hooks/useFetch';
import { apiPost, apiPatch, apiDelete } from '../../lib/api';
import { Badge }         from '../ui/Badge';
import { Button }        from '../ui/Button';
import { Dialog }        from '../ui/Dialog';
import { ErrorAlert }    from '../ui/ErrorAlert';
import { FormFooter }    from '../ui/FormFooter';
import { inputClass }    from '../ui/inputClass';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Promotion {
  id: string;
  code: string;
  name: string;
  description?: string;
  discountType: string; // PERCENTAGE | FIXED_AMOUNT
  discountValue: number;
  maxUses?: number;
  usedCount: number;
  maxPerUser: number;
  minAmount?: number;
  routeId?: string;
  busType?: string;
  validFrom: string;
  validTo: string;
  isActive: boolean;
  createdAt?: string;
}

interface PromoFormValues {
  code: string;
  name: string;
  discountType: string;
  discountValue: string;
  maxUses: string;
  minAmount: string;
  validFrom: string;
  validTo: string;
}

const EMPTY_FORM: PromoFormValues = {
  code: '', name: '', discountType: 'PERCENTAGE', discountValue: '',
  maxUses: '', minAmount: '', validFrom: '', validTo: '',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

// ─── Columns ──────────────────────────────────────────────────────────────────

function buildColumns(t: (k: string | Record<string, string | undefined>) => string): Column<Promotion>[] {
  return [
    {
      key: 'code',
      header: t('promotions.colCode'),
      sortable: true,
      width: '130px',
      cellRenderer: (v) => (
        <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
          {String(v)}
        </span>
      ),
    },
    {
      key: 'name',
      header: t('promotions.colName'),
      sortable: true,
    },
    {
      key: 'discountValue',
      header: t('promotions.colDiscount'),
      sortable: true,
      align: 'right',
      width: '120px',
      cellRenderer: (_v, row) =>
        row.discountType === 'PERCENTAGE'
          ? <span className="font-semibold text-violet-600 dark:text-violet-400">{row.discountValue}%</span>
          : <span className="font-semibold text-violet-600 dark:text-violet-400">{row.discountValue.toLocaleString('fr-FR')} XAF</span>,
      csvValue: (_v, row) =>
        row.discountType === 'PERCENTAGE' ? `${row.discountValue}%` : `${row.discountValue} XAF`,
    },
    {
      key: 'usedCount',
      header: t('promotions.colUsage'),
      sortable: true,
      align: 'center',
      width: '110px',
      cellRenderer: (_v, row) => (
        <span className="text-xs text-slate-600 dark:text-slate-400">
          {row.usedCount}{row.maxUses != null ? `/${row.maxUses}` : ''}
        </span>
      ),
      csvValue: (_v, row) => row.maxUses != null ? `${row.usedCount}/${row.maxUses}` : String(row.usedCount),
    },
    {
      key: 'validFrom',
      header: t('promotions.colValidity'),
      sortable: true,
      width: '180px',
      cellRenderer: (_v, row) => (
        <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
          {formatDate(row.validFrom)} — {formatDate(row.validTo)}
        </span>
      ),
      csvValue: (_v, row) => `${formatDate(row.validFrom)} - ${formatDate(row.validTo)}`,
    },
    {
      key: 'isActive',
      header: t('promotions.colActive'),
      sortable: true,
      align: 'center',
      width: '100px',
      cellRenderer: (v) =>
        v
          ? <Badge variant="success" size="sm">{t('promotions.active')}</Badge>
          : <Badge variant="danger" size="sm">{t('promotions.inactive')}</Badge>,
      csvValue: (v) => v ? 'Active' : 'Inactive',
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PagePromotions() {
  const { user } = useAuth();
  const { t }    = useI18n();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/v1/tenants/${tenantId}/promotions`;

  // ── data ──
  const [rev, setRev] = useState(0);
  const { data, loading, error } = useFetch<Promotion[]>(tenantId ? base : null, [tenantId, rev]);
  const items = data ?? [];

  // ── dialog state ──
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing]       = useState<Promotion | null>(null);
  const [form, setForm]             = useState<PromoFormValues>(EMPTY_FORM);
  const [busy, setBusy]             = useState(false);
  const [formError, setFormError]   = useState<string | null>(null);

  const refresh = useCallback(() => setRev(r => r + 1), []);

  // ── open create ──
  const openCreate = useCallback(() => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDialogOpen(true);
  }, []);

  // ── open edit ──
  const openEdit = useCallback((promo: Promotion) => {
    setEditing(promo);
    setForm({
      code: promo.code,
      name: promo.name,
      discountType: promo.discountType,
      discountValue: String(promo.discountValue),
      maxUses: promo.maxUses != null ? String(promo.maxUses) : '',
      minAmount: promo.minAmount != null ? String(promo.minAmount) : '',
      validFrom: promo.validFrom.slice(0, 10),
      validTo: promo.validTo.slice(0, 10),
    });
    setFormError(null);
    setDialogOpen(true);
  }, []);

  // ── submit ──
  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        discountType: form.discountType,
        discountValue: Number(form.discountValue),
        maxUses: form.maxUses ? Number(form.maxUses) : undefined,
        minAmount: form.minAmount ? Number(form.minAmount) : undefined,
        validFrom: form.validFrom,
        validTo: form.validTo,
      };
      if (editing) {
        await apiPatch(`${base}/${editing.id}`, payload);
      } else {
        await apiPost(base, payload);
      }
      setDialogOpen(false);
      refresh();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [form, editing, base, refresh]);

  // ── toggle active ──
  const toggleActive = useCallback(async (promo: Promotion) => {
    try {
      await apiPatch(`${base}/${promo.id}`, { isActive: !promo.isActive });
      refresh();
    } catch {
      // silently fail
    }
  }, [base, refresh]);

  // ── delete ──
  const handleDelete = useCallback(async (promo: Promotion) => {
    try {
      await apiDelete(`${base}/${promo.id}`);
      refresh();
    } catch {
      // silently fail
    }
  }, [base, refresh]);

  // ── columns & actions ──
  const columns = buildColumns(t);

  const rowActions: RowAction<Promotion>[] = [
    {
      label: t('promotions.edit'),
      icon: <Pencil className="w-4 h-4" aria-hidden />,
      onClick: openEdit,
    },
    {
      label: t('promotions.toggleActive'),
      icon: <ToggleLeft className="w-4 h-4" aria-hidden />,
      onClick: toggleActive,
    },
    {
      label: t('promotions.delete'),
      icon: <Trash2 className="w-4 h-4" aria-hidden />,
      onClick: handleDelete,
      danger: true,
      hidden: (row) => row.usedCount > 0,
    },
  ];

  // ── field helper ──
  const upd = (key: keyof PromoFormValues) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value }));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-violet-100 dark:bg-violet-900/30">
            <Percent className="w-6 h-6 text-violet-600 dark:text-violet-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              {t('promotions.title')}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('promotions.subtitle')}
            </p>
          </div>
        </div>

        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1.5" aria-hidden />
          {t('promotions.newPromo')}
        </Button>
      </div>

      {/* Error */}
      {error && <ErrorAlert error={error} />}

      {/* Table */}
      <DataTableMaster<Promotion>
        columns={columns}
        data={items}
        loading={loading}
        defaultSort={{ key: 'validFrom', dir: 'desc' }}
        defaultPageSize={25}
        searchPlaceholder={t('promotions.searchPlaceholder')}
        emptyMessage={t('promotions.emptyMessage')}
        exportFormats={['csv', 'xls']}
        exportFilename="promotions"
        rowActions={rowActions}
        onRowClick={openEdit}
        stickyHeader
      />

      {/* Create / Edit Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? t('promotions.editTitle') : t('promotions.createTitle')}
        description={editing ? t('promotions.editDesc') : t('promotions.createDesc')}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && <ErrorAlert error={formError} />}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Code */}
            <div>
              <label htmlFor="promo-code" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('promotions.fieldCode')} <span className="text-red-500">*</span>
              </label>
              <input
                id="promo-code"
                className={inputClass}
                value={form.code}
                onChange={upd('code')}
                required
                disabled={busy}
                autoFocus
              />
            </div>

            {/* Name */}
            <div>
              <label htmlFor="promo-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('promotions.fieldName')} <span className="text-red-500">*</span>
              </label>
              <input
                id="promo-name"
                className={inputClass}
                value={form.name}
                onChange={upd('name')}
                required
                disabled={busy}
              />
            </div>

            {/* Discount Type */}
            <div>
              <label htmlFor="promo-discountType" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('promotions.fieldDiscountType')} <span className="text-red-500">*</span>
              </label>
              <select
                id="promo-discountType"
                className={inputClass}
                value={form.discountType}
                onChange={upd('discountType')}
                required
                disabled={busy}
              >
                <option value="PERCENTAGE">{t('promotions.typePercentage')}</option>
                <option value="FIXED_AMOUNT">{t('promotions.typeFixedAmount')}</option>
              </select>
            </div>

            {/* Discount Value */}
            <div>
              <label htmlFor="promo-discountValue" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('promotions.fieldDiscountValue')} <span className="text-red-500">*</span>
              </label>
              <input
                id="promo-discountValue"
                type="number"
                min="0"
                step={form.discountType === 'PERCENTAGE' ? '1' : '0.01'}
                className={inputClass}
                value={form.discountValue}
                onChange={upd('discountValue')}
                required
                disabled={busy}
              />
            </div>

            {/* Max Uses */}
            <div>
              <label htmlFor="promo-maxUses" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('promotions.fieldMaxUses')}
              </label>
              <input
                id="promo-maxUses"
                type="number"
                min="1"
                className={inputClass}
                value={form.maxUses}
                onChange={upd('maxUses')}
                disabled={busy}
              />
            </div>

            {/* Min Amount */}
            <div>
              <label htmlFor="promo-minAmount" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('promotions.fieldMinAmount')}
              </label>
              <input
                id="promo-minAmount"
                type="number"
                min="0"
                step="0.01"
                className={inputClass}
                value={form.minAmount}
                onChange={upd('minAmount')}
                disabled={busy}
              />
            </div>

            {/* Valid From */}
            <div>
              <label htmlFor="promo-validFrom" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('promotions.fieldValidFrom')} <span className="text-red-500">*</span>
              </label>
              <input
                id="promo-validFrom"
                type="date"
                className={inputClass}
                value={form.validFrom}
                onChange={upd('validFrom')}
                required
                disabled={busy}
              />
            </div>

            {/* Valid To */}
            <div>
              <label htmlFor="promo-validTo" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('promotions.fieldValidTo')} <span className="text-red-500">*</span>
              </label>
              <input
                id="promo-validTo"
                type="date"
                className={inputClass}
                value={form.validTo}
                onChange={upd('validTo')}
                required
                disabled={busy}
              />
            </div>
          </div>

          <FormFooter
            onCancel={() => setDialogOpen(false)}
            busy={busy}
            submitLabel={editing ? t('common.save') : t('common.create')}
            pendingLabel={editing ? t('common.saving') : t('common.creating')}
          />
        </form>
      </Dialog>
    </div>
  );
}
