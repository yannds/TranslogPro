/**
 * PagePlatformUsers — Utilisateurs cross-tenant (portail plateforme).
 *
 * Vue diagnostic support : liste tous les users de tous les tenants avec un
 * filtre tenant, type (STAFF/CUSTOMER), et recherche texte. Permissions :
 *   - Lecture : data.platform.iam.read.global
 *   - Reset MFA : control.platform.mfa.reset.global (SA + L2)
 *
 * Endpoints :
 *   GET /api/platform/iam/users (filtres : tenantId, search, userType)
 *   POST /api/platform/iam/users/:id/reset-mfa
 *
 * La création / désactivation / suppression de users reste scopée aux tenants
 * (PageIamUsers sur le portail tenant — via impersonation JIT si nécessaire).
 */
import { useState, useCallback, useMemo } from 'react';
import { Users, ShieldOff, RefreshCw, Search } from 'lucide-react';
import { useAuth }  from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPost, ApiError } from '../../lib/api';
import { Input }    from '../ui/Input';
import { Button }   from '../ui/Button';
import { Select }   from '../ui/Select';
import { Badge }    from '../ui/Badge';
import { Dialog }   from '../ui/Dialog';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserTenant { id: string; name: string; slug: string }
interface UserRole   { id: string; name: string }
interface PlatformUser {
  id:          string;
  email:       string;
  name:        string | null;
  userType:    string;
  isActive:    boolean;
  mfaEnabled:  boolean;
  createdAt:   string;
  tenantId:    string;
  role:        UserRole | null;
  tenant:      UserTenant | null;
}
interface TenantOption { id: string; name: string; slug: string }

// ─── Permissions ─────────────────────────────────────────────────────────────

const P_MFA_RESET       = 'control.platform.mfa.reset.global';
const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';

/** Valeur sentinelle dans le dropdown pour demander TOUS les tenants. */
const ALL_TENANTS_VALUE = '__all__';

// ─── Colonnes ────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function buildColumns(t: (k: string) => string): Column<PlatformUser>[] {
  return [
    {
      key: 'tenant',
      header: t('platformAudit.colTenant'),
      sortable: false,
      width: '150px',
      cellRenderer: (_v, row) => row.tenant ? (
        <div className="text-xs">
          <p className="text-slate-800 dark:text-slate-200 truncate max-w-[140px]">{row.tenant.name}</p>
          <p className="text-slate-500 font-mono text-[10px]">{row.tenant.slug}</p>
        </div>
      ) : (
        <span className="text-xs text-slate-400 font-mono">{row.tenantId.slice(0, 8)}…</span>
      ),
      csvValue: (_v, row) => row.tenant ? `${row.tenant.name} (${row.tenant.slug})` : row.tenantId,
    },
    {
      key: 'email',
      header: t('iamSessions.colUser'),
      sortable: true,
      cellRenderer: (_v, row) => (
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-white">{row.name ?? '—'}</p>
          <p className="text-xs text-slate-500">{row.email}</p>
        </div>
      ),
      csvValue: (_v, row) => `${row.name ?? ''} <${row.email}>`,
    },
    {
      key: 'role',
      header: t('common.role'),
      width: '140px',
      cellRenderer: (_v, row) => row.role ? (
        <span className="text-xs font-mono text-slate-700 dark:text-slate-300">{row.role.name}</span>
      ) : (
        <span className="text-xs text-slate-400 italic">—</span>
      ),
      csvValue: (_v, row) => row.role?.name ?? '',
    },
    {
      key: 'userType',
      header: t('platformUsers.type'),
      sortable: true,
      width: '100px',
      cellRenderer: (v) => (
        <Badge variant="info" size="sm">{String(v)}</Badge>
      ),
    },
    {
      key: 'isActive',
      header: t('platformUsers.status'),
      width: '90px',
      cellRenderer: (_v, row) => row.isActive ? (
        <Badge variant="success" size="sm">{t('common.active')}</Badge>
      ) : (
        <Badge variant="default" size="sm">{t('platformUsers.inactive')}</Badge>
      ),
      csvValue: (_v, row) => row.isActive ? 'active' : 'inactive',
    },
    {
      key: 'mfaEnabled',
      header: 'MFA',
      width: '70px',
      cellRenderer: (_v, row) => row.mfaEnabled ? (
        <Badge variant="success" size="sm">{t('common.enabled')}</Badge>
      ) : (
        <Badge variant="default" size="sm">{t('common.disabled')}</Badge>
      ),
      csvValue: (_v, row) => row.mfaEnabled ? 'on' : 'off',
    },
    {
      key: 'createdAt',
      header: t('platformUsers.createdAt'),
      sortable: true,
      width: '110px',
      cellRenderer: (v) => (
        <span className="text-xs text-slate-500 font-mono">{formatDate(String(v))}</span>
      ),
      csvValue: (v) => formatDate(String(v)),
    },
  ];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function PagePlatformUsers() {
  const { user } = useAuth();
  const { t }    = useI18n();

  const canResetMfa = (user?.permissions ?? []).includes(P_MFA_RESET);

  // Vue par défaut : uniquement les users du tenant plateforme (staff interne
  // TranslogPro — SA/L1/L2). Le dropdown offre ensuite "Tous les tenants" pour
  // élargir la vue au SaaS entier, puis chaque tenant client individuellement.
  // Rationale UX : dans un portail plateforme, les opérateurs SaaS ont besoin
  // de voir leur propre staff en premier ; les users clients sont secondaires
  // et utilisés ponctuellement pour du support.
  const initialFilters = { tenantId: PLATFORM_TENANT_ID, search: '', userType: '' };
  const [draft, setDraft]     = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [rev, setRev]         = useState(0);

  const [resetTarget, setResetTarget] = useState<PlatformUser | null>(null);
  const [resetBusy,   setResetBusy]   = useState(false);
  const [resetErr,    setResetErr]    = useState('');
  const [resetOk,     setResetOk]     = useState(false);

  const { data: tenants } = useFetch<TenantOption[]>('/api/tenants');

  const qs = new URLSearchParams();
  // ALL_TENANTS_VALUE = pas de filtre tenant → backend renvoie tout le SaaS.
  // Vide = valeur initiale avant sélection, traitée comme tenant plateforme par défaut.
  if (filters.tenantId && filters.tenantId !== ALL_TENANTS_VALUE) {
    qs.set('tenantId', filters.tenantId);
  }
  if (filters.search)   qs.set('search',   filters.search);
  if (filters.userType) qs.set('userType', filters.userType);
  const url = `/api/platform/iam/users${qs.toString() ? `?${qs}` : ''}`;

  const { data: users, loading, refetch } = useFetch<PlatformUser[]>(url, [filters, rev]);

  const applyFilters = useCallback(() => {
    setFilters({ ...draft });
    setRev(r => r + 1);
  }, [draft]);

  async function handleResetMfa() {
    if (!resetTarget) return;
    setResetBusy(true); setResetErr(''); setResetOk(false);
    try {
      await apiPost(`/api/platform/iam/users/${resetTarget.id}/reset-mfa`, {});
      setResetOk(true);
      refetch();
      setTimeout(() => { setResetTarget(null); setResetOk(false); }, 1500);
    } catch (e) {
      setResetErr(e instanceof ApiError ? String((e.body as any)?.message ?? e.message) : t('platformUsers.mfaResetFailed'));
    } finally { setResetBusy(false); }
  }

  // Quand la vue est "Tous les tenants", on remonte les users du tenant
  // plateforme en tête de liste. Cohérent avec l'UX du portail : les gens
  // du SaaS eux-mêmes sont prioritaires, les users clients passent après.
  const sortedUsers = useMemo(() => {
    const list = users ?? [];
    if (filters.tenantId !== ALL_TENANTS_VALUE) return list;
    return [...list].sort((a, b) => {
      const aPlat = a.tenantId === PLATFORM_TENANT_ID ? 0 : 1;
      const bPlat = b.tenantId === PLATFORM_TENANT_ID ? 0 : 1;
      return aPlat - bPlat;
    });
  }, [users, filters.tenantId]);

  const columns = useMemo(() => buildColumns(t), [t]);
  const rowActions: RowAction<PlatformUser>[] = canResetMfa ? [
    {
      label:   t('platformUsers.resetMfa'),
      icon:    <ShieldOff size={13} />,
      danger:  true,
      disabled: (row) => !row.mfaEnabled,
      onClick: (row) => { setResetTarget(row); setResetErr(''); setResetOk(false); },
    },
  ] : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Users size={24} className="text-indigo-500 dark:text-indigo-400" />
            {t('platformUsers.title')}
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            {loading ? t('iamSessions.loading') : `${users?.length ?? 0} ${t('platformUsers.count')}`}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setRev(r => r + 1)} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span className="ml-1">{t('iamSessions.refresh')}</span>
        </Button>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Select
            options={[
              // Plateforme en premier (vue par défaut), puis "Tous les tenants"
              // (valeur sentinelle traduite en absence de filtre), puis la
              // liste des tenants clients par ordre alphabétique.
              { value: PLATFORM_TENANT_ID, label: t('platformUsers.tenantPlatformOnly') },
              { value: ALL_TENANTS_VALUE,  label: t('platformUsers.tenantAll') },
              ...(tenants ?? [])
                .filter(tnt => tnt.id !== PLATFORM_TENANT_ID)
                .map(tnt => ({ value: tnt.id, label: `${tnt.name} (${tnt.slug})` })),
            ]}
            value={draft.tenantId}
            onChange={e => setDraft(d => ({ ...d, tenantId: e.target.value }))}
          />
          <Select
            options={[
              { value: '',         label: t('platformUsers.allTypes') },
              { value: 'STAFF',    label: 'STAFF' },
              { value: 'CUSTOMER', label: 'CUSTOMER' },
              { value: 'ANONYMOUS', label: 'ANONYMOUS' },
            ]}
            value={draft.userType}
            onChange={e => setDraft(d => ({ ...d, userType: e.target.value }))}
          />
          <Input
            placeholder={t('platformUsers.searchPlaceholder')}
            value={draft.search}
            onChange={e => setDraft(d => ({ ...d, search: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') applyFilters(); }}
          />
          <Button size="sm" onClick={applyFilters}>
            <Search size={13} className="mr-1" /> {t('iamAudit.apply')}
          </Button>
        </div>
      </div>

      <DataTableMaster<PlatformUser>
        columns={columns}
        data={sortedUsers}
        loading={loading}
        rowActions={rowActions}
        defaultSort={{ key: 'createdAt', dir: 'desc' }}
        defaultPageSize={25}
        searchPlaceholder={t('platformUsers.searchPlaceholder')}
        emptyMessage={t('platformUsers.emptyMessage')}
        exportFormats={['csv', 'json']}
        exportFilename="platform-users"
        stickyHeader
      />

      {resetTarget && (
        <Dialog
          open={!!resetTarget}
          onOpenChange={o => { if (!o && !resetBusy) setResetTarget(null); }}
          title={t('platformUsers.resetMfaTitle')}
          description={t('platformUsers.resetMfaDesc')}
          size="md"
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setResetTarget(null)} disabled={resetBusy}>
                {t('common.cancel')}
              </Button>
              <Button variant="destructive" size="sm" onClick={handleResetMfa} disabled={resetBusy || resetOk}>
                <ShieldOff size={13} />
                {resetOk
                  ? t('platformUsers.mfaResetDone')
                  : resetBusy ? t('platformUsers.resetting') : t('platformUsers.resetMfa')}
              </Button>
            </>
          }
        >
          <div className="space-y-2 text-sm">
            <p className="text-slate-700 dark:text-slate-300">
              <span className="text-slate-500">{t('iamSessions.colUser')} :</span>{' '}
              {resetTarget.name ?? '—'} — {resetTarget.email}
            </p>
            <p className="text-slate-700 dark:text-slate-300">
              <span className="text-slate-500">{t('platformAudit.colTenant')} :</span>{' '}
              {resetTarget.tenant?.name ?? resetTarget.tenantId}
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded px-2 py-1.5">
              {t('platformUsers.resetMfaWarning')}
            </p>
            {resetErr && <p className="text-xs text-red-600 dark:text-red-400">{resetErr}</p>}
          </div>
        </Dialog>
      )}
    </div>
  );
}
