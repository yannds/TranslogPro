/**
 * PagePortalMarketplace — Marketplace de thèmes pour le Portail Visiteur
 *
 * Parcourir, prévisualiser et appliquer des thèmes visuels.
 * Les thèmes sont définis dans portal-themes.ts (statiques + futur API).
 *
 * Données :
 *   GET  /api/tenants/:tid/portal/config          (thème actif)
 *   PUT  /api/tenants/:tid/portal/config           (appliquer thème)
 *
 * Accessibilité : WCAG 2.1 AA — aria-labels, rôles, focus-visible
 * Dark mode : classes Tailwind dark: via ThemeProvider
 * Responsive : mobile-first, grid adaptatif
 * i18n : toutes chaînes via t()
 */

import { useState, useMemo } from 'react';
import {
  Store, Check, Search, Eye, Palette, Download,
  Sparkles, X,
} from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPut } from '../../lib/api';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { Card, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { cn } from '../../lib/utils';
import { PORTAL_THEMES_LIST, type PortalTheme } from '../portail-voyageur/portal-themes';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PortalConfig {
  themeId: string;
}

type ThemeCategory = 'all' | 'premium' | 'minimal' | 'colorful';

const THEME_CATEGORIES: Record<string, ThemeCategory[]> = {
  'amber-luxury':       ['premium'],
  'ocean-blue':         ['premium', 'colorful'],
  'emerald-nature':     ['premium', 'colorful'],
  'monochrome':         ['minimal'],
  'pastel-soft':        ['colorful'],
  'bordeaux-prestige':  ['premium'],
};

// ─── Theme Card ───────────────────────────────────────────────────────────────

function ThemeCard({
  theme,
  isActive,
  onPreview,
  onApply,
  applying,
  t,
}: {
  theme: PortalTheme;
  isActive: boolean;
  onPreview: (theme: PortalTheme) => void;
  onApply: (themeId: string) => void;
  applying: string | null;
  t: (key: string) => string;
}) {
  return (
    <Card
      className={cn(
        'group overflow-hidden transition-all duration-200 hover:shadow-lg flex flex-col',
        isActive && 'ring-2 ring-emerald-500 dark:ring-emerald-400',
      )}
    >
      {/* Hero preview */}
      <button
        type="button"
        onClick={() => onPreview(theme)}
        className="relative h-40 sm:h-48 overflow-hidden cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
        aria-label={t('portalMarket.previewTheme').replace('{name}', theme.name)}
      >
        <div className="absolute inset-0 transition-transform duration-500 group-hover:scale-105" style={{ background: theme.heroScenes[0].bg }} />
        <div className="absolute inset-0" style={{ background: theme.heroScenes[0].overlay }} />

        {/* Text preview inside hero */}
        <div className="relative h-full flex flex-col justify-end p-4 sm:p-5">
          <p className="text-white/60 text-[10px] font-semibold uppercase tracking-widest mb-1">{t('portalMarket.preview')}</p>
          <p className="text-white font-black text-lg sm:text-xl leading-tight drop-shadow-lg">{theme.name}</p>
          <p className="text-white/50 text-xs mt-0.5 line-clamp-1">{theme.description}</p>
        </div>

        {/* Active badge */}
        {isActive && (
          <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-emerald-500 px-2.5 py-1 text-white text-[10px] font-bold shadow-lg">
            <Check className="w-3 h-3" aria-hidden />
            {t('portalMarket.active')}
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-xl px-4 py-2 flex items-center gap-2 shadow-xl">
            <Eye className="w-4 h-4 text-slate-700 dark:text-slate-300" aria-hidden />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('portalMarket.preview')}</span>
          </div>
        </div>
      </button>

      <CardContent className="pt-4 flex flex-col flex-1">
        {/* Color palette */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex -space-x-1">
            {[theme.accent, theme.accentLight, theme.accentDark, theme.secondary].map((color, i) => (
              <div
                key={i}
                className="w-6 h-6 rounded-full border-2 border-white dark:border-slate-800 shadow-sm"
                style={{ backgroundColor: color }}
                title={['Accent', 'Light', 'Dark', 'Secondary'][i]}
                aria-hidden
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-1 ml-auto">
            {(THEME_CATEGORIES[theme.id] ?? []).map(cat => (
              <span
                key={cat}
                className={cn(
                  'rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
                  cat === 'premium'  && 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
                  cat === 'minimal'  && 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400',
                  cat === 'colorful' && 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300',
                )}
              >
                {t(`portalMarket.cat_${cat}`)}
              </span>
            ))}
          </div>
        </div>

        {/* Layout badge */}
        <div className="mb-3">
          <span className="inline-flex items-center gap-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1 text-[10px] font-medium text-slate-500 dark:text-slate-400">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            Layout: <span className="font-semibold capitalize text-slate-700 dark:text-slate-300">{theme.layout}</span>
          </span>
        </div>

        {/* Scenes mini-previews */}
        <div className="flex gap-1.5 mb-4">
          {theme.heroScenes.map((scene, i) => (
            <div
              key={i}
              className="flex-1 h-8 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700"
              style={{ background: scene.bg }}
              aria-hidden
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-auto pt-3 border-t border-slate-100 dark:border-slate-800">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPreview(theme)}
            className="flex-1 text-xs"
          >
            <Eye className="w-3.5 h-3.5 mr-1.5" aria-hidden />
            {t('portalMarket.preview')}
          </Button>
          {isActive ? (
            <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 text-xs font-semibold px-3">
              <Check className="w-3.5 h-3.5" aria-hidden />
              {t('portalMarket.installed')}
            </div>
          ) : (
            <Button
              size="sm"
              onClick={() => onApply(theme.id)}
              disabled={applying === theme.id}
              className="flex-1 text-xs"
            >
              <Download className="w-3.5 h-3.5 mr-1.5" aria-hidden />
              {applying === theme.id ? t('common.saving') : t('portalMarket.apply')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Preview Dialog Content ──────────────────────────────────────────────────

function ThemePreviewContent({ theme, t }: { theme: PortalTheme; t: (key: string) => string }) {
  return (
    <div className="space-y-5">
      {/* All 4 hero scenes */}
      <div>
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">{t('portalMarket.heroScenes')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {theme.heroScenes.map((scene, i) => (
            <div key={i} className="relative h-32 sm:h-40 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
              <div className="absolute inset-0" style={{ background: scene.bg }} />
              <div className="absolute inset-0" style={{ background: scene.overlay }} />
              <div className="relative h-full flex flex-col justify-end p-3">
                <p className="text-white font-bold text-sm drop-shadow">{t('portalMarket.sceneN').replace('{n}', String(i + 1))}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Color palette detail */}
      <div>
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">{t('portalMarket.colorPalette')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Accent', color: theme.accent },
            { label: 'Light', color: theme.accentLight },
            { label: 'Dark', color: theme.accentDark },
            { label: 'Secondary', color: theme.secondary },
          ].map(({ label, color }) => (
            <div key={label} className="text-center">
              <div
                className="w-full h-14 rounded-xl border border-slate-200 dark:border-slate-700 shadow-inner mb-1.5"
                style={{ backgroundColor: color }}
                aria-hidden
              />
              <p className="text-xs font-medium text-slate-600 dark:text-slate-400">{label}</p>
              <p className="text-[10px] font-mono text-slate-400">{color}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Simulated UI preview */}
      <div>
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">{t('portalMarket.uiPreview')}</p>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          {/* Mini navbar */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg" style={{ background: `linear-gradient(135deg, ${theme.accent}, ${theme.accentDark})` }} />
              <div className="h-2 w-16 rounded bg-slate-200 dark:bg-slate-700" />
            </div>
            <div className="flex gap-1.5">
              <div className="h-2 w-10 rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-2 w-10 rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-2 w-10 rounded bg-slate-200 dark:bg-slate-700" />
            </div>
            <div className="h-6 w-16 rounded-lg" style={{ backgroundColor: theme.accent }}>
              <div className="h-full flex items-center justify-center">
                <div className="h-1.5 w-8 rounded bg-white/60" />
              </div>
            </div>
          </div>
          {/* Mini hero */}
          <div className="relative h-24">
            <div className="absolute inset-0" style={{ background: theme.heroScenes[0].bg }} />
            <div className="absolute inset-0" style={{ background: theme.heroScenes[0].overlay }} />
            <div className="relative flex flex-col justify-center items-center h-full">
              <div className="h-3 w-40 rounded bg-white/80 mb-2" />
              <div className="h-2 w-28 rounded bg-white/40" />
            </div>
          </div>
          {/* Mini cards */}
          <div className="bg-slate-50 dark:bg-slate-950 p-3 flex gap-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-2">
                <div className="h-1.5 w-full rounded mb-1.5" style={{ backgroundColor: theme.accentLight }} />
                <div className="h-1 w-3/4 rounded bg-slate-200 dark:bg-slate-700 mb-1" />
                <div className="h-1 w-1/2 rounded bg-slate-200 dark:bg-slate-700" />
                <div className="mt-2 h-4 rounded-md" style={{ backgroundColor: theme.accent }}>
                  <div className="h-full flex items-center justify-center">
                    <div className="h-1 w-6 rounded bg-white/60" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function PagePortalMarketplace() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId;

  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState<ThemeCategory>('all');
  const [previewTheme, setPreviewTheme] = useState<PortalTheme | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const { data: config, refetch } = useFetch<PortalConfig>(
    tenantId ? `/api/tenants/${tenantId}/portal/config` : null,
    [tenantId],
  );

  const activeThemeId = config?.themeId ?? 'amber-luxury';

  const filteredThemes = useMemo(() => {
    let list = PORTAL_THEMES_LIST;
    if (filterCat !== 'all') {
      list = list.filter(th => (THEME_CATEGORIES[th.id] ?? []).includes(filterCat));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(th =>
        th.name.toLowerCase().includes(q) ||
        th.description.toLowerCase().includes(q),
      );
    }
    return list;
  }, [filterCat, search]);

  const handleApply = async (themeId: string) => {
    if (!tenantId) return;
    setApplying(themeId);
    setSuccessMsg(null);
    try {
      await apiPut(`/api/tenants/${tenantId}/portal/config`, { themeId });
      setSuccessMsg(t('portalMarket.appliedSuccess'));
      setPreviewTheme(null);
      refetch();
    } finally {
      setApplying(null);
    }
  };

  const categories: { key: ThemeCategory; label: string }[] = [
    { key: 'all',      label: t('portalMarket.catAll') },
    { key: 'premium',  label: t('portalMarket.cat_premium') },
    { key: 'minimal',  label: t('portalMarket.cat_minimal') },
    { key: 'colorful', label: t('portalMarket.cat_colorful') },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-violet-500/20">
            <Store className="w-5 h-5 text-white" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">{t('portalMarket.title')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('portalMarket.subtitle').replace('{count}', String(PORTAL_THEMES_LIST.length))}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-amber-500" aria-hidden />
          <span className="text-xs text-slate-500">{t('portalMarket.freeThemes')}</span>
        </div>
      </div>

      {/* Success message */}
      {successMsg && (
        <div role="status" className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" aria-hidden /> {successMsg}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('portalMarket.searchPlaceholder')}
            aria-label={t('portalMarket.searchPlaceholder')}
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30 transition-shadow"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar" role="tablist" aria-label={t('portalMarket.filterByCategory')}>
          {categories.map(cat => (
            <button
              key={cat.key}
              onClick={() => setFilterCat(cat.key)}
              role="tab"
              aria-selected={filterCat === cat.key}
              className={cn(
                'px-3 py-2 rounded-xl text-xs sm:text-sm font-medium transition-colors whitespace-nowrap',
                filterCat === cat.key
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700',
              )}
            >
              {cat.label}
            </button>
          ))}
          {(search || filterCat !== 'all') && (
            <button
              onClick={() => { setSearch(''); setFilterCat('all'); }}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label={t('portalMarket.resetFilters')}
            >
              <X className="w-4 h-4" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {/* Theme Grid */}
      {filteredThemes.length === 0 ? (
        <div className="py-16 text-center">
          <div className="flex justify-center mb-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
              <Palette className="w-8 h-8 text-slate-400" aria-hidden />
            </div>
          </div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-1">{t('portalMarket.noResults')}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('portalMarket.noResultsHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5" role="list" aria-label={t('portalMarket.themeList')}>
          {filteredThemes.map(theme => (
            <div key={theme.id} role="listitem">
              <ThemeCard
                theme={theme}
                isActive={theme.id === activeThemeId}
                onPreview={setPreviewTheme}
                onApply={handleApply}
                applying={applying}
                t={t}
              />
            </div>
          ))}
        </div>
      )}

      {/* Preview Dialog */}
      <Dialog
        open={!!previewTheme}
        onOpenChange={open => { if (!open) setPreviewTheme(null); }}
        title={previewTheme?.name ?? t('portalMarket.preview')}
        description={previewTheme?.description}
        size="xl"
        footer={
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => setPreviewTheme(null)}>{t('common.close')}</Button>
            {previewTheme && previewTheme.id !== activeThemeId && (
              <Button onClick={() => handleApply(previewTheme.id)} disabled={applying === previewTheme.id}>
                <Download className="w-4 h-4 mr-1.5" aria-hidden />
                {applying === previewTheme.id ? t('common.saving') : t('portalMarket.applyTheme')}
              </Button>
            )}
            {previewTheme && previewTheme.id === activeThemeId && (
              <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 text-sm font-semibold px-3">
                <Check className="w-4 h-4" aria-hidden />
                {t('portalMarket.alreadyActive')}
              </div>
            )}
          </div>
        }
      >
        {previewTheme && <ThemePreviewContent theme={previewTheme} t={t} />}
      </Dialog>
    </div>
  );
}
