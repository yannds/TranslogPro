/**
 * PageCrm — CRM voyageurs (clients)
 *
 * CRUD complet : lister · créer · modifier · archiver
 * Données :
 *   GET    /api/tenants/:tid/crm/customers
 *   POST   /api/tenants/:tid/crm/customers
 *   PATCH  /api/tenants/:tid/crm/customers/:userId
 *   DELETE /api/tenants/:tid/crm/customers/:userId
 *
 * Light mode par défaut, dark mode compatible via tokens .t-* / dark: .
 */

import { useState, useMemo, type FormEvent } from 'react';
import {
  Users2, Plus, Pencil, Archive, X, UserCircle, Star, History,
  Phone as PhoneIcon, Mail as MailIcon,
} from 'lucide-react';
import { useFetch }              from '../../lib/hooks/useFetch';
import { apiPost, apiPatch, apiDelete } from '../../lib/api';
import { useAuth }               from '../../lib/auth/auth.context';
import { useI18n }                from '../../lib/i18n/useI18n';
import { Button }                from '../ui/Button';
import { Badge }                 from '../ui/Badge';
import { Dialog }                from '../ui/Dialog';
import { ErrorAlert }            from '../ui/ErrorAlert';
import { FormFooter }            from '../ui/FormFooter';
import { inputClass as inp }     from '../ui/inputClass';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';
import { DocumentAttachments } from '../document/DocumentAttachments';
import { CustomerDetailModal } from '../crm/CustomerDetailModal';
import { ContactHistoryModal } from '../crm/ContactHistoryModal';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CustomerRow {
  id:           string;
  email:        string;
  name:         string | null;
  agencyId:     string | null;
  loyaltyScore: number;
  preferences:  Record<string, unknown> | null;
  createdAt:    string;
}

interface ListResponse {
  total: number;
  page:  number;
  limit: number;
  data:  CustomerRow[];
}

// ─── Modèle CRM unifié (nouveau) ────────────────────────────────────────────
// Alimenté par GET /crm/contacts : inclut shadows (userId=null) + registered.
interface ContactRow {
  id:              string;
  phoneE164:       string | null;
  email:           string | null;
  name:            string;
  firstName:       string | null;
  lastName:        string | null;
  language:        string | null;
  userId:          string | null;
  segments:        string[];
  totalTickets:    number;
  totalParcels:    number;
  totalSpentCents: number;
  firstSeenAt:     string;
  lastSeenAt:      string;
  isShadow:        boolean;
}

interface ContactsResponse {
  total: number;
  page:  number;
  limit: number;
  data:  ContactRow[];
}

type Segment = 'all' | 'shadow' | 'registered';

interface CreateForm {
  email: string;
  name:  string;
  phone: string;
}

interface EditForm {
  name:         string;
  phone:        string;
  loyaltyScore: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tierFromScore(score: number, t: (k: string) => string): { label: string; variant: 'default' | 'success' | 'warning' | 'info' } {
  if (score >= 4000) return { label: t('crmPage.tierPlatinum'), variant: 'info'    };
  if (score >= 2000) return { label: t('crmPage.tierGold'),     variant: 'warning' };
  if (score >= 500)  return { label: t('crmPage.tierSilver'),   variant: 'default' };
  return { label: t('crmPage.tierBronze'), variant: 'default' };
}

function getPhone(prefs: Record<string, unknown> | null): string {
  return typeof prefs?.['phone'] === 'string' ? (prefs['phone'] as string) : '';
}

// ─── Colonnes ─────────────────────────────────────────────────────────────────

function buildColumns(t: (k: string | Record<string, string | undefined>) => string): Column<CustomerRow>[] {
  return [
    {
      key: 'name',
      header: t('crmPage.colClient'),
      sortable: true,
      cellRenderer: (_v, row) => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
            <UserCircle className="w-5 h-5 text-slate-400" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
              {row.name ?? '—'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{row.email}</p>
          </div>
        </div>
      ),
      csvValue: (_v, row) => `${row.name ?? ''} <${row.email}>`,
    },
    {
      key: 'preferences',
      header: t('crmPage.colPhone'),
      sortable: false,
      cellRenderer: (_v, row) => (
        <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
          {getPhone(row.preferences) || '—'}
        </span>
      ),
      csvValue: (_v, row) => getPhone(row.preferences),
    },
    {
      key: 'loyaltyScore',
      header: t('crmPage.colLoyalty'),
      sortable: true,
      width: '140px',
      cellRenderer: (v) => {
        const tier = tierFromScore(Number(v), t);
        return (
          <div className="flex items-center gap-2">
            <Badge variant={tier.variant}>
              <Star className="w-3 h-3 mr-1" aria-hidden />{tier.label}
            </Badge>
            <span className="text-xs text-slate-400 tabular-nums">{Number(v).toFixed(0)}</span>
          </div>
        );
      },
      csvValue: (v) => Number(v).toFixed(0),
    },
    {
      key: 'createdAt',
      header: t('crmPage.colRegistered'),
      sortable: true,
      width: '110px',
      cellRenderer: (v) => (
        <span className="text-xs text-slate-400">
          {new Date(String(v)).toLocaleDateString('fr-FR')}
        </span>
      ),
      csvValue: (v) => new Date(String(v)).toLocaleDateString('fr-FR'),
    },
  ];
}

// ─── Formulaire création ──────────────────────────────────────────────────────

function CreateCustomerForm({ onSubmit, onCancel, busy, error }: {
  onSubmit: (f: CreateForm) => void;
  onCancel: () => void;
  busy:     boolean;
  error:    string | null;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<CreateForm>({ email: '', name: '', phone: '' });
  const set = <K extends keyof CreateForm>(k: K, v: CreateForm[K]) =>
    setF(p => ({ ...p, [k]: v }));

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      <ErrorAlert error={error} />
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('common.email')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="email" required value={f.email}
            onChange={e => set('email', e.target.value)}
            className={inp} disabled={busy} placeholder={t('crmPage.emailPlaceholder')}
            autoComplete="email" />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('crmPage.fullName')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="text" required value={f.name}
            onChange={e => set('name', e.target.value)}
            className={inp} disabled={busy} placeholder={t('crmPage.namePlaceholder')}
            autoComplete="name" />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{t('crmPage.colPhone')}</label>
          <input type="tel" value={f.phone}
            onChange={e => set('phone', e.target.value)}
            className={inp} disabled={busy} placeholder={t('crmPage.phonePlaceholder')}
            autoComplete="tel" />
        </div>
      </div>
      <FormFooter onCancel={onCancel} busy={busy} submitLabel={t('common.create')} pendingLabel={t('common.creating')} />
    </form>
  );
}

// ─── Formulaire édition ───────────────────────────────────────────────────────

function EditCustomerForm({ customer, tenantId, onSubmit, onCancel, busy, error, onPreviewChange }: {
  customer: CustomerRow;
  tenantId: string;
  onSubmit: (f: EditForm) => void;
  onCancel: () => void;
  busy:     boolean;
  error:    string | null;
  onPreviewChange?: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<EditForm>({
    name:         customer.name ?? '',
    phone:        getPhone(customer.preferences),
    loyaltyScore: String(customer.loyaltyScore ?? 0),
  });
  const set = <K extends keyof EditForm>(k: K, v: EditForm[K]) =>
    setF(p => ({ ...p, [k]: v }));

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      <ErrorAlert error={error} />
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{t('crmPage.fullName')}</label>
          <input type="text" value={f.name}
            onChange={e => set('name', e.target.value)}
            className={inp} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{t('crmPage.colPhone')}</label>
          <input type="tel" value={f.phone}
            onChange={e => set('phone', e.target.value)}
            className={inp} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('crmPage.loyaltyScore')}
          </label>
          <input type="number" min={0} step={1} value={f.loyaltyScore}
            onChange={e => set('loyaltyScore', e.target.value)}
            className={inp} disabled={busy} />
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2">
          <p>{t('common.email')} : <span className="font-mono">{customer.email}</span></p>
          <p>{t('crmPage.registered')} : {new Date(customer.createdAt).toLocaleDateString('fr-FR')}</p>
        </div>

        {/* Pièces jointes du voyageur */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">{t('crmPage.attachments')}</h3>
          <DocumentAttachments
            tenantId={tenantId}
            entityType="CUSTOMER"
            entityId={customer.id}
            allowedKinds={['ID_CARD', 'CONTRACT', 'PHOTO', 'OTHER']}
            onPreviewChange={onPreviewChange}
          />
        </div>
      </div>
      <FormFooter onCancel={onCancel} busy={busy} submitLabel={t('common.save')} pendingLabel={t('common.saving')} />
    </form>
  );
}

// ─── KPIs (calculés depuis la liste) ──────────────────────────────────────────

function CrmKpis({ customers, t }: { customers: CustomerRow[]; t: (k: string | Record<string, string | undefined>) => string }) {
  const total      = customers.length;
  const newMonth   = customers.filter(c => {
    const d = new Date(c.createdAt);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  const platinum   = customers.filter(c => c.loyaltyScore >= 4000).length;
  const avgScore   = total === 0 ? 0 : customers.reduce((s, c) => s + (c.loyaltyScore ?? 0), 0) / total;

  const items = [
    { label: t('crmPage.customers'),        value: total.toLocaleString('fr-FR'),      sub: t('crmPage.total'),         color: 'teal' },
    { label: t('crmPage.newThisMonth'),    value: newMonth.toLocaleString('fr-FR'),   sub: t('crmPage.registrations'), color: 'emerald' },
    { label: t('crmPage.platinumCust'),    value: platinum.toLocaleString('fr-FR'),   sub: t('crmPage.ptsThreshold'),      color: 'amber' },
    { label: t('crmPage.avgScore'),        value: avgScore.toFixed(0),                sub: t('crmPage.loyalty'),       color: 'blue' },
  ] as const;

  const palette: Record<string, string> = {
    teal:    'bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
    emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    amber:   'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    blue:    'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {items.map(it => (
        <div key={it.label} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{it.label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{it.value}</p>
          <span className={'mt-1 inline-block text-[11px] font-medium px-2 py-0.5 rounded ' + palette[it.color]}>{it.sub}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function PageCrm() {
  const { user: me } = useAuth();
  const { t } = useI18n();
  const tenantId = me?.tenantId ?? '';
  const base     = `/api/tenants/${tenantId}/crm`;

  const { data: list, loading, error, refetch } = useFetch<ListResponse>(
    tenantId ? `${base}/customers?limit=200` : null,
    [tenantId],
  );

  const customers = list?.data ?? [];

  // ── Vue CRM unifiée (Customer, shadow + registered) ────────────────────────
  const [segment, setSegment] = useState<Segment>('all');
  const contactsUrl = tenantId
    ? `${base}/contacts?segment=${segment}&limit=200`
    : null;
  const { data: contactsData, loading: contactsLoading, error: contactsError } =
    useFetch<ContactsResponse>(contactsUrl, [tenantId, segment]);
  const contacts = contactsData?.data ?? [];
  const [historyTarget, setHistoryTarget] = useState<ContactRow | null>(null);

  const [showCreate,   setShowCreate]   = useState(false);
  const [detailTarget, setDetailTarget] = useState<CustomerRow | null>(null);
  const [editTarget,   setEditTarget]   = useState<CustomerRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<CustomerRow | null>(null);
  const [busy,         setBusy]         = useState(false);
  const [actionErr,    setActionErr]    = useState<string | null>(null);
  const [editPreviewOpen, setEditPreviewOpen] = useState(false);

  const handleCreate = async (f: CreateForm) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPost(`${base}/customers`, {
        email: f.email,
        name:  f.name,
        phone: f.phone || undefined,
      });
      setShowCreate(false); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleEdit = async (f: EditForm) => {
    if (!editTarget) return;
    setBusy(true); setActionErr(null);
    try {
      await apiPatch(`${base}/customers/${editTarget.id}`, {
        name:         f.name,
        phone:        f.phone,
        loyaltyScore: Number.isFinite(parseFloat(f.loyaltyScore)) ? parseFloat(f.loyaltyScore) : undefined,
      });
      setEditTarget(null); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    setBusy(true); setActionErr(null);
    try {
      await apiDelete(`${base}/customers/${archiveTarget.id}`);
      setArchiveTarget(null); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  // Colonnes du tableau Contacts (Customer model unifié)
  const contactColumns: Column<ContactRow>[] = useMemo(() => [
    {
      key: 'name',
      header: t('crmPage.colClient'),
      sortable: true,
      cellRenderer: (_v, row) => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
            <UserCircle className="w-5 h-5 text-slate-400" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{row.name}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {row.email ?? row.phoneE164 ?? '—'}
            </p>
          </div>
        </div>
      ),
      csvValue: (_v, row) => row.name,
    },
    {
      key: 'phoneE164',
      header: t('crmPage.colPhone'),
      sortable: false,
      width: '160px',
      cellRenderer: (_v, row) => row.phoneE164
        ? (
          <span className="inline-flex items-center gap-1 text-xs tabular-nums text-slate-600 dark:text-slate-300">
            <PhoneIcon className="w-3 h-3" aria-hidden />
            {row.phoneE164}
          </span>
        )
        : <span className="text-xs text-slate-400">—</span>,
      csvValue: (_v, row) => row.phoneE164 ?? '',
    },
    {
      key: 'email',
      header: t('common.email'),
      sortable: false,
      cellRenderer: (_v, row) => row.email
        ? (
          <span className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300 truncate">
            <MailIcon className="w-3 h-3" aria-hidden />
            {row.email}
          </span>
        )
        : <span className="text-xs text-slate-400">—</span>,
      csvValue: (_v, row) => row.email ?? '',
    },
    {
      key: 'isShadow',
      header: t('crmContact.status'),
      sortable: true,
      width: '130px',
      cellRenderer: (_v, row) => {
        const recurrent = row.totalTickets + row.totalParcels >= 2;
        return (
          <div className="flex flex-wrap gap-1">
            {row.isShadow
              ? <Badge variant="warning">{t('crmContact.shadow')}</Badge>
              : <Badge variant="success">{t('crmContact.registered')}</Badge>}
            {recurrent && <Badge variant="info">{t('crmContact.recurrent')}</Badge>}
          </div>
        );
      },
      csvValue: (_v, row) => row.isShadow ? 'SHADOW' : 'REGISTERED',
    },
    {
      key: 'totalTickets',
      header: t('crmContact.tickets'),
      sortable: true,
      width: '80px',
      cellRenderer: (v) => (
        <span className="text-xs tabular-nums text-slate-600 dark:text-slate-300">{Number(v)}</span>
      ),
    },
    {
      key: 'totalParcels',
      header: t('crmContact.parcels'),
      sortable: true,
      width: '80px',
      cellRenderer: (v) => (
        <span className="text-xs tabular-nums text-slate-600 dark:text-slate-300">{Number(v)}</span>
      ),
    },
    {
      key: 'lastSeenAt',
      header: t('crmContact.lastActivity'),
      sortable: true,
      width: '140px',
      cellRenderer: (v) => (
        <span className="text-xs text-slate-400">
          {v ? new Date(String(v)).toLocaleDateString() : '—'}
        </span>
      ),
      csvValue: (v) => v ? new Date(String(v)).toLocaleDateString() : '',
    },
  ], [t]);

  const contactRowActions: RowAction<ContactRow>[] = [
    {
      label:   t('crmContact.openHistory'),
      icon:    <History size={13} />,
      onClick: (row) => setHistoryTarget(row),
    },
  ];

  const columns = buildColumns(t);
  const rowActions: RowAction<CustomerRow>[] = [
    {
      label:   t('crmPage.viewProfile'),
      icon:    <UserCircle size={13} />,
      onClick: (row) => { setDetailTarget(row); setActionErr(null); },
    },
    {
      label:   t('common.edit'),
      icon:    <Pencil size={13} />,
      onClick: (row) => { setEditTarget(row); setActionErr(null); },
    },
    {
      label:   t('common.archive'),
      icon:    <Archive size={13} />,
      danger:  true,
      onClick: (row) => { setArchiveTarget(row); setActionErr(null); },
    },
  ];

  return (
    <div className="p-6 space-y-6 bg-gray-50 dark:bg-slate-950 min-h-full">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
            <Users2 className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('crmPage.title')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {list ? `${list.total} ${t('crmPage.customerCount')}` : t('crmPage.customerMgmt')}
            </p>
          </div>
        </div>
        <Button onClick={() => { setShowCreate(true); setActionErr(null); }}>
          <Plus className="w-4 h-4 mr-2" aria-hidden />{t('crmPage.newCustomer')}
        </Button>
      </div>

      {/* KPIs */}
      <CrmKpis customers={customers} t={t} />

      {/* ── Contacts CRM unifiés (Customer model, shadow + registered) ───── */}
      <section
        aria-labelledby="crm-contacts-heading"
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="crm-contacts-heading" className="text-sm font-semibold text-slate-900 dark:text-white">
              {t('crmContact.sectionTitle')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('crmContact.sectionDesc')}
            </p>
          </div>
          <div
            role="tablist"
            aria-label={t('crmContact.segmentLabel')}
            className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5"
          >
            {(['all', 'registered', 'shadow'] as const).map(seg => (
              <button
                key={seg}
                type="button"
                role="tab"
                aria-selected={segment === seg}
                onClick={() => setSegment(seg)}
                className={[
                  'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1',
                  segment === seg
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
                ].join(' ')}
              >
                {t(`crmContact.segment_${seg}`)}
              </button>
            ))}
          </div>
        </div>

        <ErrorAlert error={contactsError} icon />

        <DataTableMaster<ContactRow>
          columns={contactColumns}
          data={contacts}
          loading={contactsLoading}
          rowActions={contactRowActions}
          defaultSort={{ key: 'lastSeenAt', dir: 'desc' }}
          defaultPageSize={25}
          searchPlaceholder={t('crmContact.searchPlaceholder')}
          emptyMessage={t('crmContact.empty')}
          onRowClick={(row) => setHistoryTarget(row)}
          stickyHeader
        />
      </section>

      <ErrorAlert error={error ?? actionErr} icon />

      {/* Tableau */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2">
        <DataTableMaster<CustomerRow>
          columns={columns}
          data={customers}
          loading={loading}
          rowActions={rowActions}
          defaultSort={{ key: 'createdAt', dir: 'desc' }}
          defaultPageSize={25}
          searchPlaceholder={t('crmPage.searchPlaceholder')}
          emptyMessage={list && list.total === 0 ? t('crmPage.emptyMsg') : t('crmPage.noResult')}
          exportFormats={['csv', 'json', 'xls']}
          exportFilename="voyageurs"
          onRowClick={(row) => { setDetailTarget(row); setActionErr(null); }}
          stickyHeader
        />
      </div>

      {/* Fiche historique CRM (Contacts unifiés) */}
      <ContactHistoryModal
        open={!!historyTarget}
        onClose={() => setHistoryTarget(null)}
        tenantId={tenantId}
        customerId={historyTarget?.id ?? null}
      />

      {/* Fiche détaillée */}
      <CustomerDetailModal
        open={!!detailTarget}
        onClose={() => setDetailTarget(null)}
        tenantId={tenantId}
        customerId={detailTarget?.id ?? null}
        onEdit={() => {
          if (!detailTarget) return;
          setEditTarget(detailTarget);
          setDetailTarget(null);
        }}
      />

      {/* Modal Créer */}
      <Dialog
        open={showCreate}
        onOpenChange={o => { if (!o) setShowCreate(false); }}
        title={t('crmPage.newCustomer')}
        description={t('crmPage.createDesc')}
        size="md"
      >
        <CreateCustomerForm
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
          busy={busy}
          error={actionErr}
        />
      </Dialog>

      {/* Modal Éditer */}
      <Dialog
        open={!!editTarget}
        onOpenChange={o => { if (!o) { setEditPreviewOpen(false); setEditTarget(null); } }}
        title={t('crmPage.editCustomer')}
        description={editTarget?.email}
        size={editPreviewOpen ? '3xl' : 'md'}
      >
        {editTarget && (
          <EditCustomerForm
            customer={editTarget}
            tenantId={tenantId}
            onSubmit={handleEdit}
            onCancel={() => { setEditPreviewOpen(false); setEditTarget(null); }}
            busy={busy}
            error={actionErr}
            onPreviewChange={setEditPreviewOpen}
          />
        )}
      </Dialog>

      {/* Modal Archiver */}
      <Dialog
        open={!!archiveTarget}
        onOpenChange={o => { if (!o) setArchiveTarget(null); }}
        title={t('crmPage.archiveCustomer')}
        description={`${t('common.archive')} « ${archiveTarget?.name ?? archiveTarget?.email} » ? ${t('crmPage.archiveDesc')}`}
        footer={
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setArchiveTarget(null)} disabled={busy}>
              <X className="w-4 h-4 mr-1.5" aria-hidden />{t('common.cancel')}
            </Button>
            <Button
              onClick={handleArchive}
              disabled={busy}
              loading={busy}
              variant="destructive"
            >
              <Archive className="w-4 h-4 mr-1.5" aria-hidden />
              {busy ? t('crmPage.archiving') : t('common.archive')}
            </Button>
          </div>
        }
      >
        {actionErr && <p className="text-sm text-red-600 dark:text-red-400">{actionErr}</p>}
        <div />
      </Dialog>
    </div>
  );
}
