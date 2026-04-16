/**
 * PageWfMarketplace — Marketplace de Blueprints de Workflow
 *
 * Parcourir, prévisualiser et installer des blueprints publics et système.
 *
 * Données :
 *   GET  /api/workflow-marketplace/browse?entityType=&categoryId=&search=
 *   GET  /api/workflow-marketplace/categories
 *   POST /api/tenants/:tid/workflow-studio/blueprints/:id/install
 *
 * Accessibilité : WCAG 2.1 AA
 * Dark mode : classes Tailwind dark: via ThemeProvider
 */

import { useState } from 'react';
import {
  Store, Download, Search, Shield, Star, X,
  GitFork, Tag, RefreshCw, Check,
} from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPost } from '../../lib/api';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { Card, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { Dialog } from '../ui/Dialog';
import { cn } from '../../lib/utils';
import type { BlueprintDetail, BlueprintSummary } from '../workflow/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Category {
  id:        string;
  name:      string;
  slug:      string;
  icon?:     string;
  sortOrder: number;
}


// ─── Blueprint Card ───────────────────────────────────────────────────────────

function MarketplaceCard({
  bp,
  onPreview,
  onInstall,
  installing,
}: {
  bp:         BlueprintSummary;
  onPreview:  (bp: BlueprintSummary) => void;
  onInstall:  (id: string) => void;
  installing: string | null;
}) {
  const { t } = useI18n();
  const isInstalled = bp.installs && bp.installs.length > 0;

  return (
    <Card className={cn(
      'hover:shadow-md transition-all duration-200 flex flex-col',
      isInstalled && 'ring-2 ring-emerald-500/30 dark:ring-emerald-400/20',
    )}>
      <CardContent className="pt-4 flex flex-col h-full">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex flex-wrap gap-1">
              {bp.isSystem && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                  <Shield className="w-2.5 h-2.5" aria-hidden /> {t('wfMarketplace.system')}
                </span>
              )}
              {isInstalled && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                  <Check className="w-2.5 h-2.5" aria-hidden /> {t('wfMarketplace.installed')}
                </span>
              )}
            </div>
            <h3 className="font-semibold text-sm text-slate-900 dark:text-white leading-tight">{bp.name}</h3>
          </div>
          <Badge variant="default" className="text-[10px] shrink-0">{bp.entityType}</Badge>
        </div>

        {bp.description && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 line-clamp-3 flex-1">{bp.description}</p>
        )}

        {bp.category && <p className="text-[10px] text-slate-400 mb-2">{bp.category.name}</p>}

        {bp.tags && bp.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {bp.tags.slice(0, 4).map(tag => (
              <span key={tag} className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-500 dark:text-slate-400">
                <Tag className="w-2 h-2" aria-hidden /> {tag}
              </span>
            ))}
          </div>
        )}

        {/* Stats + actions */}
        <div className="flex items-center justify-between gap-2 mt-auto pt-3 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2 text-[10px] text-slate-400">
            <span className="flex items-center gap-0.5"><Star className="w-2.5 h-2.5" aria-hidden />{bp._count?.installs ?? bp.usageCount ?? 0}</span>
            <span>v{bp.version}</span>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => onPreview(bp)} className="text-xs py-1">{t('wfMarketplace.preview')}</Button>
            <Button size="sm" onClick={() => onInstall(bp.id)} disabled={installing === bp.id} className="text-xs py-1">
              <Download className="w-3 h-3 mr-1" aria-hidden />
              {installing === bp.id ? '…' : t('wfMarketplace.install')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function PageWfMarketplace() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId ?? '';

  const [search,         setSearch]         = useState('');
  const [filterEntity,   setFilterEntity]   = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [previewBp,      setPreviewBp]      = useState<BlueprintSummary | null>(null);
  const [installing,     setInstalling]     = useState<string | null>(null);
  const [installMsg,     setInstallMsg]     = useState<string | null>(null);
  const [installErr,     setInstallErr]     = useState<string | null>(null);

  const params = new URLSearchParams();
  if (filterEntity)   params.set('entityType', filterEntity);
  if (filterCategory) params.set('categoryId', filterCategory);
  if (search)         params.set('search', search);
  const browseUrl = `/api/workflow-marketplace/browse?${params.toString()}`;

  const { data: blueprints, loading, error, refetch } = useFetch<BlueprintSummary[]>(
    browseUrl,
    [filterEntity, filterCategory, search],
  );

  const { data: categories } = useFetch<Category[]>('/api/workflow-marketplace/categories', []);

  const { data: previewDetail } = useFetch<BlueprintDetail>(
    previewBp ? `/api/tenants/${tenantId}/workflow-studio/blueprints/${previewBp.id}` : null,
    [previewBp?.id],
  );

  const handleInstall = async (id: string) => {
    setInstalling(id);
    setInstallErr(null);
    setInstallMsg(null);
    try {
      await apiPost(`/api/tenants/${tenantId}/workflow-studio/blueprints/${id}/install`, {});
      setInstallMsg(t('wfMarketplace.installedMsg'));
      setPreviewBp(null);
      refetch();
    } catch (e) {
      setInstallErr((e as Error).message);
    } finally {
      setInstalling(null);
    }
  };

  const ENTITY_TYPES = ['Ticket', 'Trip', 'Parcel', 'Bus', 'Claim'];
  const graph = previewDetail?.graphJson;

  return (
    <div className="p-6 space-y-6">

      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
            <Store className="w-5 h-5 text-purple-600 dark:text-purple-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('wfMarketplace.marketplace')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {blueprints ? `${blueprints.length} ${t('wfMarketplace.blueprintsAvail')}` : t('wfMarketplace.readyToUse')}
            </p>
          </div>
        </div>
        <button type="button" onClick={refetch} disabled={loading} aria-label={t('wfMarketplace.refresh')}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} aria-hidden />
        </button>
      </div>

      {/* Messages */}
      {installMsg && (
        <div role="status" className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" aria-hidden /> {installMsg}
        </div>
      )}
      {(error || installErr) && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error ?? installErr}
        </div>
      )}

      {/* Filtres */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('wfMarketplace.searchBlueprint')}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
        </div>
        <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30">
          <option value="">{t('wfMarketplace.allTypes')}</option>
          {ENTITY_TYPES.map(et => <option key={et} value={et}>{et}</option>)}
        </select>
        {categories && categories.length > 0 && (
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30">
            <option value="">{t('wfMarketplace.allCategories')}</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {(filterEntity || filterCategory || search) && (
          <Button variant="ghost" size="sm" onClick={() => { setFilterEntity(''); setFilterCategory(''); setSearch(''); }}>
            <X className="w-4 h-4 mr-1" aria-hidden /> {t('wfMarketplace.reset')}
          </Button>
        )}
      </div>

      {/* Grille */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5].map(i => (
            <Card key={i}><CardContent className="pt-4 space-y-2">
              <Skeleton className="h-5 w-32" /><Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" /><Skeleton className="h-8 w-24 mt-2" />
            </CardContent></Card>
          ))}
        </div>
      ) : !blueprints || blueprints.length === 0 ? (
        <div className="py-16 text-center">
          <div className="flex justify-center mb-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
              <GitFork className="w-8 h-8 text-slate-400" aria-hidden />
            </div>
          </div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-1">{t('wfMarketplace.noBlueprintFound')}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {search || filterEntity || filterCategory ? t('wfMarketplace.changeFilters') : t('wfMarketplace.emptyMarketplace')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {blueprints.map(bp => (
            <MarketplaceCard key={bp.id} bp={bp} onPreview={setPreviewBp} onInstall={handleInstall} installing={installing} />
          ))}
        </div>
      )}

      {/* Modal preview */}
      <Dialog
        open={!!previewBp}
        onOpenChange={open => { if (!open) setPreviewBp(null); }}
        title={previewBp?.name ?? t('wfMarketplace.preview')}
        description={previewBp?.description ?? `Blueprint ${previewBp?.entityType} · v${previewBp?.version}`}
        size="xl"
        footer={
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => setPreviewBp(null)}>{t('common.close')}</Button>
            {previewBp && (
              <Button onClick={() => handleInstall(previewBp.id)} disabled={installing === previewBp.id}>
                <Download className="w-4 h-4 mr-1.5" aria-hidden />
                {installing === previewBp.id ? t('wfMarketplace.installing') : t('wfMarketplace.installThisBp')}
              </Button>
            )}
          </div>
        }
      >
        {previewBp && (
          <div className="space-y-4">
            {/* Badges */}
            <div className="flex flex-wrap gap-2">
              <Badge variant="default">{previewBp.entityType}</Badge>
              {previewBp.isSystem && <Badge variant="warning">{t('wfMarketplace.system')}</Badge>}
              {previewBp.isPublic && <Badge variant="info">{t('wfMarketplace.public')}</Badge>}
              {previewBp.category && <Badge variant="default">{previewBp.category.name}</Badge>}
            </div>

            {/* Tags */}
            {previewBp.tags && previewBp.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {previewBp.tags.map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs text-slate-500 dark:text-slate-400">
                    <Tag className="w-3 h-3" aria-hidden /> {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Graph stats */}
            {graph ? (
              <div className="space-y-3">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('wfMarketplace.wfStructure')}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {[
                    { label: t('wfMarketplace.states'),       value: (graph as any).nodes?.length ?? 0 },
                    { label: t('wfMarketplace.transitions'), value: (graph as any).edges?.length ?? 0 },
                    { label: t('wfMarketplace.version'),     value: `v${previewBp.version}` },
                  ].map(stat => (
                    <div key={stat.label} className="rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-3 text-center">
                      <div className="text-2xl font-bold text-slate-900 dark:text-white">{stat.value}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{stat.label}</div>
                    </div>
                  ))}
                </div>

                {/* States */}
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">{t('wfMarketplace.states')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(graph as any).nodes?.map((n: any) => (
                      <span key={n.id} className={cn(
                        'rounded-full px-2.5 py-1 text-xs font-medium',
                        n.type === 'initial'  ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' :
                        n.type === 'terminal' ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300' :
                                                'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
                      )}>
                        {n.type === 'initial' ? '▶ ' : n.type === 'terminal' ? '■ ' : ''}{n.label}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Transitions */}
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">{t('wfMarketplace.transitions')}</p>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {(graph as any).edges?.map((e: any) => (
                      <div key={e.id} className="flex items-center gap-2 text-xs bg-slate-50 dark:bg-slate-900 rounded px-2 py-1.5">
                        <span className="font-medium text-slate-700 dark:text-slate-300">{e.source}</span>
                        <span className="text-slate-400">→</span>
                        <span className="font-mono text-blue-600 dark:text-blue-400">{e.label}</span>
                        <span className="text-slate-400">→</span>
                        <span className="font-medium text-slate-700 dark:text-slate-300">{e.target}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Checksum */}
                {previewDetail?.checksum && (
                  <div className="rounded bg-slate-100 dark:bg-slate-900 px-3 py-2">
                    <p className="text-[10px] text-slate-400 mb-0.5">Checksum SHA-256</p>
                    <p className="font-mono text-[10px] text-slate-500 dark:text-slate-400 truncate">{previewDetail.checksum}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            )}
          </div>
        )}
      </Dialog>

    </div>
  );
}
