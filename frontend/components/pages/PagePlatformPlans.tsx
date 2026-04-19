/**
 * PagePlatformPlans — CRUD des plans SaaS (SUPER_ADMIN).
 *
 * Les plans sont entièrement DB-driven. Cette page permet au SA de :
 *   - Lister tous les plans (actifs + désactivés) avec compteurs tenants
 *   - Créer un nouveau plan (slug unique, prix, cycle, devise, modules inclus)
 *   - Éditer un plan existant (sauf le slug, immuable)
 *   - Désactiver/supprimer (soft delete si des tenants référencent le plan)
 *
 * Endpoints :
 *   GET    /api/platform/plans
 *   POST   /api/platform/plans
 *   PATCH  /api/platform/plans/:id
 *   DELETE /api/platform/plans/:id
 */

import { useState, type FormEvent } from 'react';
import {
  Wallet, Plus, Pencil, Trash2, X, Check, AlertTriangle, Package, Globe,
} from 'lucide-react';
import { useFetch }            from '../../lib/hooks/useFetch';
import { apiPost, apiPatch, apiDelete } from '../../lib/api';
import { useI18n }              from '../../lib/i18n/useI18n';
import { Button }              from '../ui/Button';
import { Badge }               from '../ui/Badge';
import { Dialog }              from '../ui/Dialog';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlanModule { id: string; planId: string; moduleKey: string }
interface PlanRow {
  id:           string;
  slug:         string;
  name:         string;
  description:  string | null;
  price:        number;
  currency:     string;
  billingCycle: string;
  trialDays:    number;
  limits:       Record<string, unknown>;
  sla:          Record<string, unknown>;
  sortOrder:    number;
  isPublic:     boolean;
  isActive:     boolean;
  createdAt:    string;
  modules:      PlanModule[];
  _count?:      { tenants: number; subscriptions: number };
}

interface PlanFormState {
  slug:         string;
  name:         string;
  description:  string;
  price:        string;
  currency:     string;
  billingCycle: string;
  trialDays:    string;
  modulesCsv:   string;
  limitsJson:   string;
  slaJson:      string;
  sortOrder:    string;
  isPublic:     boolean;
  isActive:     boolean;
}

const emptyForm: PlanFormState = {
  slug: '', name: '', description: '',
  price: '0', currency: 'EUR', billingCycle: 'MONTHLY',
  trialDays: '0', modulesCsv: '', limitsJson: '{}', slaJson: '{}',
  sortOrder: '0', isPublic: true, isActive: true,
};

const inp = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30 disabled:opacity-50';

// ─── Colonnes ────────────────────────────────────────────────────────────────

function buildColumns(t: (k: string) => string): Column<PlanRow>[] {
  return [
    {
      key: 'name',
      header: t('platformPlans.colPlan'),
      sortable: true,
      cellRenderer: (_v, row) => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
            <Wallet className="w-4 h-4 text-teal-700 dark:text-teal-300" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium t-text truncate">{row.name}</p>
            <p className="text-[11px] t-text-3 font-mono">{row.slug}</p>
          </div>
        </div>
      ),
      csvValue: (_v, row) => `${row.name} (${row.slug})`,
    },
    {
      key: 'price',
      header: t('platformPlans.colPrice'),
      sortable: true,
      width: '180px',
      cellRenderer: (_v, row) => (
        <span className="text-sm t-text-body tabular-nums">
          {row.price.toLocaleString(undefined, { maximumFractionDigits: 2 })} {row.currency} · {row.billingCycle}
        </span>
      ),
      csvValue: (_v, row) => `${row.price} ${row.currency} ${row.billingCycle}`,
    },
    {
      key: 'modules',
      header: t('platformPlans.colModules'),
      sortable: false,
      cellRenderer: (_v, row) => (
        <span className="inline-flex items-center gap-1 text-xs t-text-2">
          <Package className="w-3 h-3" aria-hidden />
          {row.modules.length} {t('platformPlans.modules')}
        </span>
      ),
      csvValue: (_v, row) => row.modules.map(m => m.moduleKey).join(','),
    },
    {
      key: '_count',
      header: t('platformPlans.colTenants'),
      sortable: false,
      width: '110px',
      cellRenderer: (_v, row) => (
        <span className="text-sm t-text-body tabular-nums">{row._count?.tenants ?? 0}</span>
      ),
      csvValue: (_v, row) => String(row._count?.tenants ?? 0),
    },
    {
      key: 'isPublic',
      header: t('platformPlans.colVisibility'),
      sortable: true,
      width: '110px',
      cellRenderer: (v) => v
        ? <span className="text-xs inline-flex items-center gap-1 t-text-2"><Globe className="w-3 h-3" aria-hidden />{t('platformPlans.publicLbl')}</span>
        : <span className="text-xs t-text-3">{t('platformPlans.privateLbl')}</span>,
      csvValue: (v) => (v ? 'public' : 'private'),
    },
    {
      key: 'isActive',
      header: t('platformPlans.colStatus'),
      sortable: true,
      width: '100px',
      cellRenderer: (_v, row) => row.isActive
        ? <Badge variant="success" size="sm">ACTIVE</Badge>
        : <Badge variant="default" size="sm">INACTIVE</Badge>,
      csvValue: (v) => (v ? 'active' : 'inactive'),
    },
  ];
}

// ─── Form ────────────────────────────────────────────────────────────────────

function PlanForm({
  mode, initial, onSubmit, onCancel, busy, error,
}: {
  mode:    'create' | 'edit';
  initial: PlanFormState;
  onSubmit: (f: PlanFormState) => void;
  onCancel: () => void;
  busy:    boolean;
  error:   string | null;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<PlanFormState>(initial);
  const set = <K extends keyof PlanFormState>(k: K, v: PlanFormState[K]) =>
    setF(p => ({ ...p, [k]: v }));

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium t-text">
            {t('platformPlans.formSlug')} <span className="text-red-500" aria-hidden>*</span>
          </label>
          <input
            type="text" required value={f.slug}
            onChange={e => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            className={`${inp} font-mono`} disabled={busy || mode === 'edit'}
            placeholder="starter / pro / enterprise"
            pattern="[a-z0-9-]+"
          />
          <p className="text-[11px] t-text-3">{t('platformPlans.formSlugHint')}</p>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium t-text">
            {t('platformPlans.formName')} <span className="text-red-500" aria-hidden>*</span>
          </label>
          <input type="text" required maxLength={128} value={f.name}
            onChange={e => set('name', e.target.value)}
            className={inp} disabled={busy} />
        </div>
        <div className="lg:col-span-2 space-y-1.5">
          <label className="block text-sm font-medium t-text">{t('platformPlans.formDescription')}</label>
          <textarea value={f.description} maxLength={1000} rows={2}
            onChange={e => set('description', e.target.value)}
            className={inp} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium t-text">
            {t('platformPlans.formPrice')} <span className="text-red-500" aria-hidden>*</span>
          </label>
          <input type="number" required min={0} step="0.01" value={f.price}
            onChange={e => set('price', e.target.value)}
            className={inp} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium t-text">
            {t('platformPlans.formCurrency')} <span className="text-red-500" aria-hidden>*</span>
          </label>
          <input type="text" required value={f.currency} pattern="[A-Z]{3}"
            maxLength={3}
            onChange={e => set('currency', e.target.value.toUpperCase())}
            className={`${inp} font-mono`} disabled={busy} placeholder="EUR" />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium t-text">
            {t('platformPlans.formCycle')} <span className="text-red-500" aria-hidden>*</span>
          </label>
          <select value={f.billingCycle}
            onChange={e => set('billingCycle', e.target.value)}
            className={inp} disabled={busy}>
            <option value="MONTHLY">MONTHLY</option>
            <option value="YEARLY">YEARLY</option>
            <option value="ONE_SHOT">ONE_SHOT</option>
            <option value="CUSTOM">CUSTOM</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium t-text">{t('platformPlans.formTrialDays')}</label>
          <input type="number" min={0} max={365} value={f.trialDays}
            onChange={e => set('trialDays', e.target.value)}
            className={inp} disabled={busy} />
        </div>
        <div className="lg:col-span-2 space-y-1.5">
          <label className="block text-sm font-medium t-text">{t('platformPlans.formModules')}</label>
          <input type="text" value={f.modulesCsv}
            onChange={e => set('modulesCsv', e.target.value.toUpperCase().replace(/[^A-Z0-9_,\s]/g, ''))}
            className={`${inp} font-mono`} disabled={busy}
            placeholder="YIELD_ENGINE, GARAGE_PRO, SCHEDULER" />
          <p className="text-[11px] t-text-3">{t('platformPlans.formModulesHint')}</p>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium t-text">{t('platformPlans.formLimits')}</label>
          <textarea value={f.limitsJson} rows={3}
            onChange={e => set('limitsJson', e.target.value)}
            className={`${inp} font-mono text-[11px]`} disabled={busy}
            placeholder='{ "maxUsers": 50 }' />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium t-text">{t('platformPlans.formSla')}</label>
          <textarea value={f.slaJson} rows={3}
            onChange={e => set('slaJson', e.target.value)}
            className={`${inp} font-mono text-[11px]`} disabled={busy}
            placeholder='{ "maxPriority": "HIGH" }' />
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.isPublic}
              onChange={e => set('isPublic', e.target.checked)}
              disabled={busy} className="rounded" />
            {t('platformPlans.formIsPublic')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.isActive}
              onChange={e => set('isActive', e.target.checked)}
              disabled={busy} className="rounded" />
            {t('platformPlans.formIsActive')}
          </label>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium t-text">{t('platformPlans.formSortOrder')}</label>
          <input type="number" value={f.sortOrder}
            onChange={e => set('sortOrder', e.target.value)}
            className={inp} disabled={busy} />
        </div>
      </div>
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          <X className="w-4 h-4 mr-1.5" aria-hidden />{t('common.cancel')}
        </Button>
        <Button type="submit" disabled={busy}>
          <Check className="w-4 h-4 mr-1.5" aria-hidden />
          {busy ? (mode === 'create' ? t('common.creating') : t('common.saving')) : (mode === 'create' ? t('common.create') : t('common.save'))}
        </Button>
      </div>
    </form>
  );
}

// ─── Composant principal ─────────────────────────────────────────────────────

export function PagePlatformPlans() {
  const { t } = useI18n();

  const { data: plans, loading, error, refetch } = useFetch<PlanRow[]>('/api/platform/plans');

  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<PlanRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlanRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const toFormState = (p: PlanRow): PlanFormState => ({
    slug:         p.slug,
    name:         p.name,
    description:  p.description ?? '',
    price:        String(p.price),
    currency:     p.currency,
    billingCycle: p.billingCycle,
    trialDays:    String(p.trialDays),
    modulesCsv:   p.modules.map(m => m.moduleKey).join(', '),
    limitsJson:   JSON.stringify(p.limits ?? {}, null, 2),
    slaJson:      JSON.stringify(p.sla ?? {}, null, 2),
    sortOrder:    String(p.sortOrder),
    isPublic:     p.isPublic,
    isActive:     p.isActive,
  });

  const parseForm = (f: PlanFormState) => {
    const moduleKeys = f.modulesCsv
      .split(',').map(s => s.trim()).filter(Boolean);
    let limits: Record<string, unknown> = {};
    let sla:    Record<string, unknown> = {};
    try { limits = JSON.parse(f.limitsJson || '{}'); } catch { throw new Error(t('platformPlans.errInvalidLimits')); }
    try { sla    = JSON.parse(f.slaJson    || '{}'); } catch { throw new Error(t('platformPlans.errInvalidSla')); }
    return {
      slug:         f.slug,
      name:         f.name,
      description:  f.description || undefined,
      price:        Number(f.price),
      currency:     f.currency,
      billingCycle: f.billingCycle,
      trialDays:    Number(f.trialDays || 0),
      moduleKeys,
      limits,
      sla,
      sortOrder:    Number(f.sortOrder || 0),
      isPublic:     f.isPublic,
      isActive:     f.isActive,
    };
  };

  const handleCreate = async (f: PlanFormState) => {
    setBusy(true); setActionErr(null);
    try {
      const body = parseForm(f);
      await apiPost('/api/platform/plans', body);
      setShowCreate(false);
      refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleEdit = async (f: PlanFormState) => {
    if (!editTarget) return;
    setBusy(true); setActionErr(null);
    try {
      const body = parseForm(f);
      delete (body as Partial<typeof body>).slug; // slug immuable
      await apiPatch(`/api/platform/plans/${editTarget.id}`, body);
      setEditTarget(null);
      refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true); setActionErr(null);
    try {
      await apiDelete(`/api/platform/plans/${deleteTarget.id}`);
      setDeleteTarget(null);
      refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const columns = buildColumns(t);
  const rowActions: RowAction<PlanRow>[] = [
    {
      label:   t('common.edit'),
      icon:    <Pencil size={13} />,
      onClick: (row) => { setEditTarget(row); setActionErr(null); },
    },
    {
      label:   t('common.delete'),
      icon:    <Trash2 size={13} />,
      danger:  true,
      onClick: (row) => { setDeleteTarget(row); setActionErr(null); },
    },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
            <Wallet className="w-5 h-5 text-teal-700 dark:text-teal-300" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold t-text">{t('platformPlans.title')}</h1>
            <p className="text-sm t-text-2">
              {plans ? `${plans.length} ${t('platformPlans.plansCount')}` : t('platformPlans.subtitle')}
            </p>
          </div>
        </div>
        <Button onClick={() => { setShowCreate(true); setActionErr(null); }}>
          <Plus className="w-4 h-4 mr-2" aria-hidden />{t('platformPlans.newPlan')}
        </Button>
      </div>

      {(error || actionErr) && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />{error ?? actionErr}
        </div>
      )}

      <DataTableMaster<PlanRow>
        columns={columns}
        data={plans ?? []}
        loading={loading}
        rowActions={rowActions}
        onRowClick={(row) => { setEditTarget(row); setActionErr(null); }}
        defaultSort={{ key: 'sortOrder', dir: 'asc' }}
        defaultPageSize={25}
        searchPlaceholder={t('platformPlans.searchPlaceholder')}
        emptyMessage={t('platformPlans.emptyMsg')}
        stickyHeader
      />

      {/* Créer */}
      <Dialog
        open={showCreate}
        onOpenChange={o => { if (!o) setShowCreate(false); }}
        title={t('platformPlans.newPlan')}
        description={t('platformPlans.createDesc')}
        size="2xl"
      >
        <PlanForm
          mode="create"
          initial={emptyForm}
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
          busy={busy}
          error={actionErr}
        />
      </Dialog>

      {/* Éditer */}
      <Dialog
        open={!!editTarget}
        onOpenChange={o => { if (!o) setEditTarget(null); }}
        title={t('platformPlans.editPlan')}
        description={editTarget?.name}
        size="2xl"
      >
        {editTarget && (
          <PlanForm
            mode="edit"
            initial={toFormState(editTarget)}
            onSubmit={handleEdit}
            onCancel={() => setEditTarget(null)}
            busy={busy}
            error={actionErr}
          />
        )}
      </Dialog>

      {/* Delete */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={o => { if (!o) setDeleteTarget(null); }}
        title={t('platformPlans.deletePlan')}
        description={deleteTarget ? `${deleteTarget.name} (${deleteTarget.slug})` : ''}
        footer={
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={busy}>
              <X className="w-4 h-4 mr-1.5" aria-hidden />{t('common.cancel')}
            </Button>
            <Button onClick={handleDelete} disabled={busy}
              className="bg-red-600 hover:bg-red-700 text-white border-red-600">
              <Trash2 className="w-4 h-4 mr-1.5" aria-hidden />{t('common.delete')}
            </Button>
          </div>
        }
      >
        <div className="space-y-2 text-sm t-text-body">
          <p>{t('platformPlans.deleteWarning')}</p>
          {(deleteTarget?._count?.tenants ?? 0) > 0 && (
            <div role="alert" className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
              <span>{t('platformPlans.deleteSoftNotice').replace('{n}', String(deleteTarget?._count?.tenants ?? 0))}</span>
            </div>
          )}
          {actionErr && <p className="text-sm text-red-600 dark:text-red-400">{actionErr}</p>}
        </div>
      </Dialog>
    </div>
  );
}
