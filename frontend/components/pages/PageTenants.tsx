/**
 * PageTenants — Gestion globale des tenants (SUPER_ADMIN)
 *
 * CRUD : lister · créer · suspendre
 *
 * Données :
 *   GET    /api/tenants                  (permission control.tenant.manage.global)
 *   POST   /api/tenants                  body: { name, slug, adminEmail, adminName }
 *   PATCH  /api/tenants/:id/suspend      → provisionStatus = 'SUSPENDED'
 *
 * Invariants :
 *   - Impossible d'éditer ou supprimer le tenant plateforme (slug "__platform__").
 *   - Slug unique et immuable (contrainte backend).
 *   - Création non réversible côté UI : on montre un rappel avant soumission.
 *
 * Per-role :
 *   - SUPER_ADMIN seul accède à cette page (anyOf: P.TENANT_MANAGE dans nav.config).
 *   - Affichage en lecture seule si la perm est absente (backend renverra 403).
 */

import { useState, useMemo, type FormEvent } from 'react';
import {
  Building2, Plus, ShieldOff, AlertTriangle, X, Check, Globe,
} from 'lucide-react';
import { useFetch }                     from '../../lib/hooks/useFetch';
import { apiPost, apiPatch }            from '../../lib/api';
import { useI18n }                       from '../../lib/i18n/useI18n';
import { Button }                       from '../ui/Button';
import { Badge }                        from '../ui/Badge';
import { Dialog }                       from '../ui/Dialog';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TenantRow {
  id:              string;
  name:            string;
  slug:            string;
  country:         string;
  city:            string | null;
  language:        string;
  currency:        string;
  isActive:        boolean;
  provisionStatus: string;
  createdAt:       string;
}

interface CreateForm {
  name:       string;
  slug:       string;
  adminEmail: string;
  adminName:  string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const inp = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30 disabled:opacity-50';

function provisionVariant(status: string): 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'ACTIVE':        return 'success';
    case 'PROVISIONING':  return 'info';
    case 'PENDING':       return 'warning';
    case 'SUSPENDED':     return 'danger';
    default:              return 'warning';
  }
}

// ─── Colonnes DataTableMaster ────────────────────────────────────────────────

function buildColumns(t: (k: string) => string, dateLocale: string): Column<TenantRow>[] {
  return [
    {
      key: 'name',
      header: t('tenantsPage.colTenant'),
      sortable: true,
      cellRenderer: (_v, row) => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
            <Building2 className="w-4 h-4 text-teal-700 dark:text-teal-300" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium t-text truncate">
              {row.name}
              {row.id === PLATFORM_TENANT_ID && (
                <span className="ml-2 text-[10px] text-teal-500">{t('tenantsPage.platformTag')}</span>
              )}
            </p>
            <p className="text-xs t-text-3 font-mono truncate">{row.slug}</p>
          </div>
        </div>
      ),
      csvValue: (_v, row) => `${row.name} (${row.slug})`,
    },
    {
      key: 'country',
      header: t('tenantsPage.colLocation'),
      sortable: true,
      cellRenderer: (_v, row) => (
        <span className="text-xs t-text-2 inline-flex items-center gap-1.5">
          <Globe className="w-3.5 h-3.5" aria-hidden />
          {row.country}{row.city ? ` · ${row.city}` : ''}
        </span>
      ),
      csvValue: (_v, row) => `${row.country}${row.city ? ' / ' + row.city : ''}`,
    },
    {
      key: 'language',
      header: t('tenantsPage.colLocale'),
      sortable: true,
      width: '120px',
      cellRenderer: (_v, row) => (
        <span className="text-xs font-mono t-text-2 uppercase">{row.language} · {row.currency}</span>
      ),
      csvValue: (_v, row) => `${row.language}/${row.currency}`,
    },
    {
      key: 'provisionStatus',
      header: t('tenantsPage.colStatus'),
      sortable: true,
      width: '140px',
      cellRenderer: (v) => (
        <Badge variant={provisionVariant(String(v))} size="sm">{String(v)}</Badge>
      ),
      csvValue: (v) => String(v ?? ''),
    },
    {
      key: 'createdAt',
      header: t('tenantsPage.colCreatedAt'),
      sortable: true,
      width: '120px',
      cellRenderer: (v) => (
        <span className="text-xs t-text-3">
          {new Date(String(v)).toLocaleDateString(dateLocale)}
        </span>
      ),
      csvValue: (v) => new Date(String(v)).toLocaleDateString(dateLocale),
    },
  ];
}

// ─── Formulaire création ─────────────────────────────────────────────────────

function CreateTenantForm({ onSubmit, onCancel, busy, error }: {
  onSubmit: (f: CreateForm) => void;
  onCancel: () => void;
  busy:     boolean;
  error:    string | null;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<CreateForm>({
    name: '', slug: '', adminEmail: '', adminName: '',
  });
  const set = <K extends keyof CreateForm>(k: K, v: CreateForm[K]) =>
    setF(p => ({ ...p, [k]: v }));

  // slug auto à partir du name si vide
  const autoSlug = (name: string) =>
    name.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label htmlFor="t-name" className="block text-sm font-medium t-text">
            {t('tenantsPage.formName')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input
            id="t-name" type="text" required value={f.name}
            onChange={e => {
              const n = e.target.value;
              set('name', n);
              if (!f.slug) set('slug', autoSlug(n));
            }}
            className={inp} disabled={busy} placeholder={t('tenantsPage.formNamePh')}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="t-slug" className="block text-sm font-medium t-text">
            {t('tenantsPage.formSlug')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input
            id="t-slug" type="text" required value={f.slug}
            onChange={e => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            className={`${inp} font-mono`} disabled={busy}
            placeholder="acme-transport" pattern="[a-z0-9-]+"
          />
          <p className="text-[11px] t-text-3">{t('tenantsPage.formSlugHint')}</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="t-adminEmail" className="block text-sm font-medium t-text">
            {t('tenantsPage.formAdminEmail')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input
            id="t-adminEmail" type="email" required value={f.adminEmail}
            onChange={e => set('adminEmail', e.target.value)}
            className={inp} disabled={busy} placeholder="admin@acme-transport.com"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="t-adminName" className="block text-sm font-medium t-text">
            {t('tenantsPage.formAdminName')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input
            id="t-adminName" type="text" required value={f.adminName}
            onChange={e => set('adminName', e.target.value)}
            className={inp} disabled={busy} placeholder="Alice Dupont"
          />
        </div>
      </div>
      <div role="note" className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
        <span>{t('tenantsPage.formIrreversible')}</span>
      </div>
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          <X className="w-4 h-4 mr-1.5" aria-hidden />{t('common.cancel')}
        </Button>
        <Button type="submit" disabled={busy}>
          <Check className="w-4 h-4 mr-1.5" aria-hidden />
          {busy ? t('common.creating') : t('common.create')}
        </Button>
      </div>
    </form>
  );
}

// ─── Composant principal ─────────────────────────────────────────────────────

export function PageTenants() {
  const { t, dateLocale } = useI18n();

  const { data: tenants, loading, error, refetch } = useFetch<TenantRow[]>('/api/tenants');

  const [showCreate,     setShowCreate]     = useState(false);
  const [suspendTarget,  setSuspendTarget]  = useState<TenantRow | null>(null);
  const [busy,           setBusy]           = useState(false);
  const [actionErr,      setActionErr]      = useState<string | null>(null);

  const rows = useMemo(() => tenants ?? [], [tenants]);

  const handleCreate = async (f: CreateForm) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPost('/api/tenants', f);
      setShowCreate(false);
      refetch();
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSuspend = async () => {
    if (!suspendTarget) return;
    setBusy(true); setActionErr(null);
    try {
      await apiPatch(`/api/tenants/${suspendTarget.id}/suspend`);
      setSuspendTarget(null);
      refetch();
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const columns = buildColumns(t, dateLocale);
  const rowActions: RowAction<TenantRow>[] = [
    {
      label:    t('tenantsPage.suspend'),
      icon:     <ShieldOff size={13} />,
      danger:   true,
      disabled: (row) => row.id === PLATFORM_TENANT_ID || row.provisionStatus === 'SUSPENDED',
      onClick:  (row) => { setSuspendTarget(row); setActionErr(null); },
    },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
            <Building2 className="w-5 h-5 text-teal-700 dark:text-teal-300" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold t-text">{t('tenantsPage.title')}</h1>
            <p className="text-sm t-text-2">
              {tenants ? `${tenants.length} ${t('tenantsPage.tenantsCount')}` : t('tenantsPage.subtitle')}
            </p>
          </div>
        </div>
        <Button onClick={() => { setShowCreate(true); setActionErr(null); }}>
          <Plus className="w-4 h-4 mr-2" aria-hidden />{t('tenantsPage.newTenant')}
        </Button>
      </div>

      {/* Erreur globale */}
      {(error || actionErr) && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />
          {error ?? actionErr}
        </div>
      )}

      {/* Tableau */}
      <DataTableMaster<TenantRow>
        columns={columns}
        data={rows}
        loading={loading}
        rowActions={rowActions}
        defaultSort={{ key: 'createdAt', dir: 'desc' }}
        defaultPageSize={25}
        searchPlaceholder={t('tenantsPage.searchPlaceholder')}
        emptyMessage={t('tenantsPage.emptyMsg')}
        exportFormats={['csv', 'json', 'xls']}
        exportFilename="tenants"
        stickyHeader
      />

      {/* Modal Créer */}
      <Dialog
        open={showCreate}
        onOpenChange={o => { if (!o) setShowCreate(false); }}
        title={t('tenantsPage.newTenant')}
        description={t('tenantsPage.createDesc')}
        size="lg"
      >
        <CreateTenantForm
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
          busy={busy}
          error={actionErr}
        />
      </Dialog>

      {/* Modal Suspendre */}
      <Dialog
        open={!!suspendTarget}
        onOpenChange={o => { if (!o) setSuspendTarget(null); }}
        title={t('tenantsPage.suspendTenant')}
        description={suspendTarget ? `${suspendTarget.name} (${suspendTarget.slug})` : ''}
        footer={
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setSuspendTarget(null)} disabled={busy}>
              <X className="w-4 h-4 mr-1.5" aria-hidden />{t('common.cancel')}
            </Button>
            <Button
              onClick={handleSuspend}
              disabled={busy}
              className="bg-red-600 hover:bg-red-700 text-white border-red-600"
            >
              <ShieldOff className="w-4 h-4 mr-1.5" aria-hidden />
              {busy ? t('tenantsPage.suspending') : t('tenantsPage.confirmSuspend')}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div role="alert" className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
            <span>{t('tenantsPage.suspendWarning')}</span>
          </div>
          {actionErr && <p className="text-sm text-red-600 dark:text-red-400">{actionErr}</p>}
        </div>
      </Dialog>
    </div>
  );
}
