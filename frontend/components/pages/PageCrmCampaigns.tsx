/**
 * PageCrmCampaigns — Gestion des campagnes marketing tenant.
 *
 * Backend : src/modules/crm (CrmController — /api/tenants/:tenantId/crm/campaigns)
 *
 * Endpoints consommés :
 *   GET    /crm/campaigns          → liste (filtre status optionnel)
 *   POST   /crm/campaigns          → créer
 *   GET    /crm/campaigns/:id      → détail
 *   PATCH  /crm/campaigns/:id      → mettre à jour (name, criteria, message, status)
 *   DELETE /crm/campaigns/:id      → supprimer (DRAFT only côté service)
 *   GET    /crm/campaigns/:id/audience → estimation taille audience
 *
 * Permissions :
 *   - read   : data.crm.read.tenant
 *   - write  : control.campaign.manage.tenant
 *
 * Qualité : i18n fr+en, WCAG, dark+light, responsive, DataTableMaster.
 */
import { useState, type FormEvent } from 'react';
import { Megaphone, Plus, Pencil, Trash2, Users } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPost, apiPatch, apiDelete, apiGet } from '../../lib/api';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { ErrorAlert } from '../ui/ErrorAlert';
import { FormFooter } from '../ui/FormFooter';
import { inputClass } from '../ui/inputClass';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

// ─── Types ────────────────────────────────────────────────────────────────────

type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';

interface Campaign {
  id:          string;
  name:        string;
  messageText: string;
  criteria:    Record<string, unknown>;
  status:      CampaignStatus;
  sentCount:   number;
  createdAt:   string;
  updatedAt:   string;
}

interface CampaignFormValues {
  name:        string;
  messageText: string;
  criteria:    string; // JSON serialized
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(s: CampaignStatus): 'success' | 'info' | 'warning' | 'default' {
  switch (s) {
    case 'ACTIVE':    return 'success';
    case 'DRAFT':     return 'info';
    case 'PAUSED':    return 'warning';
    case 'COMPLETED': return 'default';
  }
}

// ─── Form ─────────────────────────────────────────────────────────────────────

function CampaignForm({
  initial, onSubmit, onCancel, busy, error,
}: {
  initial?:  Partial<Campaign>;
  onSubmit:  (v: CampaignFormValues) => void;
  onCancel:  () => void;
  busy:      boolean;
  error:     string | null;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<CampaignFormValues>({
    name:        initial?.name ?? '',
    messageText: initial?.messageText ?? '',
    criteria:    JSON.stringify(initial?.criteria ?? { segment: 'all' }, null, 2),
  });

  return (
    <form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}>
      <ErrorAlert error={error} />
      <div className="space-y-1.5">
        <label htmlFor="cmp-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('crmCampaigns.name')} <span aria-hidden className="text-red-500">*</span>
        </label>
        <input id="cmp-name" type="text" required value={f.name}
          onChange={e => setF(p => ({ ...p, name: e.target.value }))}
          className={inputClass} disabled={busy} placeholder={t('crmCampaigns.namePlaceholder')} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="cmp-message" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('crmCampaigns.messageText')} <span aria-hidden className="text-red-500">*</span>
        </label>
        <textarea id="cmp-message" required value={f.messageText} rows={3}
          onChange={e => setF(p => ({ ...p, messageText: e.target.value }))}
          className={inputClass} disabled={busy} placeholder={t('crmCampaigns.messagePlaceholder')} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="cmp-criteria" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('crmCampaigns.criteria')}
        </label>
        <textarea id="cmp-criteria" value={f.criteria} rows={4}
          onChange={e => setF(p => ({ ...p, criteria: e.target.value }))}
          className={`${inputClass} font-mono text-xs`} disabled={busy}
          aria-describedby="cmp-criteria-help" />
        <p id="cmp-criteria-help" className="text-xs text-slate-500 dark:text-slate-400">
          {t('crmCampaigns.criteriaHelp')}
        </p>
      </div>
      <FormFooter onCancel={onCancel} busy={busy}
        submitLabel={initial?.id ? t('common.save') : t('common.create')}
        pendingLabel={t('common.creating')} />
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function PageCrmCampaigns() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const base = `/api/tenants/${tenantId}/crm/campaigns`;

  const { data: campaigns, loading, refetch } = useFetch<Campaign[]>(tenantId ? base : null, [tenantId]);

  const [showForm,   setShowForm]   = useState(false);
  const [editing,    setEditing]    = useState<Campaign | null>(null);
  const [audienceFor,setAudienceFor]= useState<{ campaign: Campaign; size: number } | null>(null);
  const [busy,       setBusy]       = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const openCreate = () => { setEditing(null); setShowForm(true); setError(null); };
  const openEdit   = (c: Campaign) => { setEditing(c); setShowForm(true); setError(null); };

  const submit = async (v: CampaignFormValues) => {
    setBusy(true); setError(null);
    try {
      let criteria: Record<string, unknown> = {};
      try { criteria = JSON.parse(v.criteria || '{}'); }
      catch { throw new Error(t('crmCampaigns.invalidJson')); }
      const payload = { name: v.name, messageText: v.messageText, criteria };
      if (editing) {
        await apiPatch(`${base}/${editing.id}`, payload);
      } else {
        await apiPost(base, payload);
      }
      setShowForm(false); setEditing(null);
      refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally { setBusy(false); }
  };

  const remove = async (c: Campaign) => {
    if (!window.confirm(`${t('crmCampaigns.confirmDelete')} « ${c.name} » ?`)) return;
    try {
      await apiDelete(`${base}/${c.id}`);
      refetch();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const showAudience = async (c: Campaign) => {
    try {
      const res = await apiGet<{ count: number }>(`${base}/${c.id}/audience`);
      setAudienceFor({ campaign: c, size: res.count });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Unknown error');
    }
  };

  // ── Colonnes DataTableMaster ──────────────────────────────────────────────
  const columns: Column<Campaign>[] = [
    {
      key: 'name', header: t('crmCampaigns.name'), sortable: true,
      cellRenderer: (v) => <span className="font-medium text-slate-900 dark:text-slate-100">{String(v)}</span>,
    },
    {
      key: 'messageText', header: t('crmCampaigns.messageText'), sortable: false,
      cellRenderer: (v) => (
        <span className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">{String(v)}</span>
      ),
    },
    {
      key: 'status', header: t('crmCampaigns.status'), sortable: true, width: '120px',
      cellRenderer: (v) => <Badge variant={statusBadge(v as CampaignStatus)}>{String(v)}</Badge>,
    },
    {
      key: 'sentCount', header: t('crmCampaigns.sentCount'), sortable: true, align: 'right', width: '110px',
      cellRenderer: (v) => <span className="tabular-nums">{Number(v).toLocaleString()}</span>,
    },
    {
      key: 'createdAt', header: t('crmCampaigns.createdAt'), sortable: true, width: '140px',
      cellRenderer: (v) => <span className="text-xs whitespace-nowrap">{new Date(v as string).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}</span>,
      csvValue: (v) => new Date(v as string).toISOString(),
    },
  ];

  const rowActions: RowAction<Campaign>[] = [
    {
      label:  t('crmCampaigns.estimateAudience'),
      icon:   <Users className="w-4 h-4" aria-hidden />,
      onClick: showAudience,
    },
    {
      label:  t('common.edit'),
      icon:   <Pencil className="w-4 h-4" aria-hidden />,
      onClick: openEdit,
    },
    {
      label:  t('common.delete'),
      icon:   <Trash2 className="w-4 h-4" aria-hidden />,
      onClick: remove,
      hidden: (row) => row.status !== 'DRAFT',
      danger: true,
    },
  ];

  return (
    <main className="p-6 space-y-6" aria-label={t('crmCampaigns.title')}>
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center">
            <Megaphone className="w-5 h-5 text-purple-600 dark:text-purple-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{t('crmCampaigns.title')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t('crmCampaigns.subtitle')}</p>
          </div>
        </div>
        <Button onClick={openCreate} aria-label={t('crmCampaigns.newCampaign')}>
          <Plus className="w-4 h-4 mr-1" aria-hidden /> {t('crmCampaigns.newCampaign')}
        </Button>
      </header>

      <Card>
        <CardHeader heading={t('crmCampaigns.listTitle')} description={t('crmCampaigns.listDescription')} />
        <CardContent className="p-4">
          <DataTableMaster<Campaign>
            columns={columns}
            data={campaigns ?? []}
            loading={loading}
            rowActions={rowActions}
            onRowClick={openEdit}
            defaultSort={{ key: 'createdAt', dir: 'desc' }}
            searchPlaceholder={t('crmCampaigns.searchPlaceholder')}
            emptyMessage={t('crmCampaigns.empty')}
            exportFormats={['csv']}
            exportFilename="crm-campaigns"
          />
        </CardContent>
      </Card>

      <Dialog
        open={showForm}
        onOpenChange={o => { if (!o) { setShowForm(false); setEditing(null); } }}
        title={editing ? t('crmCampaigns.editTitle') : t('crmCampaigns.newCampaign')}
        description={editing ? t('crmCampaigns.editDescription') : t('crmCampaigns.newDescription')}
        size="lg"
      >
        {showForm && (
          <CampaignForm
            initial={editing ?? undefined}
            onSubmit={submit}
            onCancel={() => { setShowForm(false); setEditing(null); }}
            busy={busy}
            error={error}
          />
        )}
      </Dialog>

      <Dialog
        open={!!audienceFor}
        onOpenChange={o => { if (!o) setAudienceFor(null); }}
        title={t('crmCampaigns.audienceTitle')}
        description={audienceFor?.campaign.name}
        size="md"
      >
        {audienceFor && (
          <div className="space-y-3 text-center py-4">
            <Users className="w-12 h-12 mx-auto text-purple-500" aria-hidden />
            <p className="text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {audienceFor.size.toLocaleString()}
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('crmCampaigns.estimatedRecipients')}
            </p>
          </div>
        )}
      </Dialog>
    </main>
  );
}
