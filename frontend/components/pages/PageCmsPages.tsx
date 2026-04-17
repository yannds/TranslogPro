/**
 * PageCmsPages — Gestion des pages CMS du portail public
 *
 * CRUD pages : about, terms, privacy, mentions-legales, custom pages…
 * Éditeur riche HTML, publication, affichage footer, tri.
 *
 * Slugs système (hero, about, contact) : éditeur structuré JSON avec
 * limites de caractères. Ces pages sont pré-seedées par tenant.
 *
 * API :
 *   GET    /api/v1/tenants/:tid/portal/pages
 *   PUT    /api/v1/tenants/:tid/portal/pages      (upsert par slug+locale)
 *   DELETE /api/v1/tenants/:tid/portal/pages/:id
 */

import { useState, useMemo } from 'react';
import {
  FileText, Plus, Pencil, Trash2, Eye, EyeOff, Save,
  ChevronLeft, Lock, AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPut, apiDelete } from '../../lib/api';
import DataTableMaster from '../DataTableMaster';
import type { Column, RowAction } from '../DataTableMaster';
import { Button } from '../ui/Button';
import { RichTextEditor } from '../ui/RichTextEditor';
import { cn } from '../../lib/utils';

interface CmsPage {
  id: string;
  slug: string;
  title: string;
  content: string;
  locale: string;
  sortOrder: number;
  published: boolean;
  showInFooter: boolean;
  createdAt: string;
  updatedAt: string;
}

const EMPTY_PAGE: Partial<CmsPage> = {
  slug: '',
  title: '',
  content: '',
  locale: 'fr',
  sortOrder: 0,
  published: false,
  showInFooter: false,
};

// ─── Slugs système — éditeur structuré ─────────────────────────────────────

const SYSTEM_SLUGS = ['hero', 'about', 'contact'] as const;
type SystemSlug = typeof SYSTEM_SLUGS[number];

function isSystemSlug(slug: string): slug is SystemSlug {
  return (SYSTEM_SLUGS as readonly string[]).includes(slug);
}

/** Limites de caractères par champ */
const CMS_LIMITS = {
  hero:    { title: 60, subtitle: 200, trustedBy: 100 },
  about:   { description: 500, featureTitle: 30, featureDesc: 80 },
  contact: { hours: 100 },
} as const;

interface HeroCms    { title: string; subtitle: string; trustedBy: string }
interface AboutFeature { icon: string; title: string; description: string }
interface AboutCms   { description: string; features: AboutFeature[] }
interface ContactCms { hours: string }

function parseJson<T>(content: string, fallback: T): T {
  try { return JSON.parse(content) as T; } catch { return fallback; }
}

const FEATURE_ICONS = [
  { value: 'shield',   label: '🛡 Shield' },
  { value: 'sparkles', label: '✦ Sparkles' },
  { value: 'target',   label: '⌖ Target' },
  { value: 'heart',    label: '♥ Heart' },
  { value: 'star',     label: '★ Star' },
  { value: 'clock',    label: '⏱ Clock' },
];

// ─── Champ texte avec compteur de caractères ────────────────────────────────

function LimitedInput({ label, value, onChange, maxLen, multiline }: {
  label: string; value: string; onChange: (v: string) => void; maxLen: number; multiline?: boolean;
}) {
  const over = value.length > maxLen;
  const cls = cn(
    'w-full rounded-lg border bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2',
    over ? 'border-red-400 focus:ring-red-500/50' : 'border-slate-200 dark:border-slate-700 focus:ring-blue-500/50',
  );
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
        <span className={cn('text-xs tabular-nums', over ? 'text-red-500 font-semibold' : 'text-slate-400')}>
          {value.length}/{maxLen}
        </span>
      </div>
      {multiline
        ? <textarea value={value} onChange={e => onChange(e.target.value)} rows={3} className={cls} />
        : <input type="text" value={value} onChange={e => onChange(e.target.value)} className={cls} />}
      {over && (
        <p className="flex items-center gap-1 text-xs text-red-500 mt-1">
          <AlertTriangle size={12} /> {value.length - maxLen} car. en trop
        </p>
      )}
    </div>
  );
}

// ─── Éditeur structuré Hero ─────────────────────────────────────────────────

function HeroEditor({ content, onChange }: { content: string; onChange: (c: string) => void }) {
  const data = parseJson<HeroCms>(content, { title: '', subtitle: '', trustedBy: '' });
  const upd = (patch: Partial<HeroCms>) => onChange(JSON.stringify({ ...data, ...patch }));
  return (
    <div className="space-y-4">
      <LimitedInput label="Titre principal" value={data.title} onChange={v => upd({ title: v })} maxLen={CMS_LIMITS.hero.title} />
      <LimitedInput label="Sous-titre" value={data.subtitle} onChange={v => upd({ subtitle: v })} maxLen={CMS_LIMITS.hero.subtitle} multiline />
      <LimitedInput label="Badge confiance" value={data.trustedBy} onChange={v => upd({ trustedBy: v })} maxLen={CMS_LIMITS.hero.trustedBy} />
    </div>
  );
}

// ─── Éditeur structuré About ────────────────────────────────────────────────

function AboutEditor({ content, onChange }: { content: string; onChange: (c: string) => void }) {
  const data = parseJson<AboutCms>(content, {
    description: '', features: [
      { icon: 'shield', title: '', description: '' },
      { icon: 'sparkles', title: '', description: '' },
      { icon: 'target', title: '', description: '' },
    ],
  });
  const upd = (patch: Partial<AboutCms>) => onChange(JSON.stringify({ ...data, ...patch }));
  const updFeature = (idx: number, patch: Partial<AboutFeature>) => {
    const features = [...data.features];
    features[idx] = { ...features[idx], ...patch };
    upd({ features });
  };
  return (
    <div className="space-y-6">
      <LimitedInput label="Description" value={data.description} onChange={v => upd({ description: v })} maxLen={CMS_LIMITS.about.description} multiline />
      <div>
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Points forts (3 max.)</p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {data.features.slice(0, 3).map((f, i) => (
            <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3 bg-slate-50 dark:bg-slate-800/50">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Icône</label>
                <select value={f.icon} onChange={e => updFeature(i, { icon: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50">
                  {FEATURE_ICONS.map(ic => <option key={ic.value} value={ic.value}>{ic.label}</option>)}
                </select>
              </div>
              <LimitedInput label="Titre" value={f.title} onChange={v => updFeature(i, { title: v })} maxLen={CMS_LIMITS.about.featureTitle} />
              <LimitedInput label="Description" value={f.description} onChange={v => updFeature(i, { description: v })} maxLen={CMS_LIMITS.about.featureDesc} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Éditeur structuré Contact ──────────────────────────────────────────────

function ContactEditor({ content, onChange }: { content: string; onChange: (c: string) => void }) {
  const data = parseJson<ContactCms>(content, { hours: '' });
  const upd = (patch: Partial<ContactCms>) => onChange(JSON.stringify({ ...data, ...patch }));
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 dark:border-blue-800/50 bg-blue-50 dark:bg-blue-900/20 p-4">
        <p className="text-sm text-blue-700 dark:text-blue-300">
          Téléphone, email et adresse proviennent de la fiche entreprise (Paramètres &gt; Entreprise).
          Seuls les horaires sont éditables ici.
        </p>
      </div>
      <LimitedInput label="Horaires d'ouverture" value={data.hours} onChange={v => upd({ hours: v })} maxLen={CMS_LIMITS.contact.hours} />
    </div>
  );
}

// ─── Composant principal ────────────────────────────────────────────────────

export function PageCmsPages() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId;

  const pagesRes = useFetch<CmsPage[]>(
    tenantId ? `/api/v1/tenants/${tenantId}/portal/pages` : null,
    [tenantId],
  );

  const [editing, setEditing] = useState<Partial<CmsPage> | null>(null);
  const [saving, setSaving] = useState(false);

  const openNew = () => setEditing({ ...EMPTY_PAGE });
  const openEdit = (page: CmsPage) => setEditing({ ...page });

  // Validation : vérifier que les champs structurés respectent les limites
  const structuredValid = useMemo(() => {
    if (!editing?.slug || !isSystemSlug(editing.slug)) return true;
    try {
      const data = JSON.parse(editing.content || '{}');
      if (editing.slug === 'hero') {
        return (data.title?.length ?? 0) <= CMS_LIMITS.hero.title
          && (data.subtitle?.length ?? 0) <= CMS_LIMITS.hero.subtitle
          && (data.trustedBy?.length ?? 0) <= CMS_LIMITS.hero.trustedBy;
      }
      if (editing.slug === 'about') {
        if ((data.description?.length ?? 0) > CMS_LIMITS.about.description) return false;
        for (const f of (data.features ?? [])) {
          if ((f.title?.length ?? 0) > CMS_LIMITS.about.featureTitle) return false;
          if ((f.description?.length ?? 0) > CMS_LIMITS.about.featureDesc) return false;
        }
        return true;
      }
      if (editing.slug === 'contact') {
        return (data.hours?.length ?? 0) <= CMS_LIMITS.contact.hours;
      }
    } catch { return false; }
    return true;
  }, [editing?.slug, editing?.content]);

  const savePage = async () => {
    if (!tenantId || !editing?.slug || !editing?.title) return;
    if (!structuredValid) return;
    setSaving(true);
    try {
      await apiPut(`/api/v1/tenants/${tenantId}/portal/pages`, {
        slug:         editing.slug,
        title:        editing.title,
        content:      editing.content || '',
        locale:       editing.locale || 'fr',
        sortOrder:    editing.sortOrder ?? 0,
        published:    editing.published ?? false,
        showInFooter: editing.showInFooter ?? false,
      });
      setEditing(null);
      pagesRes.refetch();
    } finally {
      setSaving(false);
    }
  };

  const deletePage = async (page: CmsPage) => {
    if (!tenantId) return;
    if (isSystemSlug(page.slug)) return; // pages système non supprimables
    await apiDelete(`/api/v1/tenants/${tenantId}/portal/pages/${page.id}`);
    pagesRes.refetch();
  };

  const updateField = <K extends keyof CmsPage>(key: K, val: CmsPage[K]) => {
    setEditing(e => e ? { ...e, [key]: val } : e);
  };

  const currentSlug = editing?.slug ?? '';
  const isSysSlug = isSystemSlug(currentSlug);

  const columns: Column<CmsPage>[] = [
    { key: 'title' as keyof CmsPage, header: t('cms.pageTitle'), sortable: true,
      cellRenderer: (v, row) => (
        <span className="flex items-center gap-2">
          {isSystemSlug((row as CmsPage).slug) && <Lock size={12} className="text-amber-500 shrink-0" />}
          <span>{String(v)}</span>
        </span>
      ),
    },
    { key: 'slug' as keyof CmsPage, header: 'Slug', sortable: true,
      cellRenderer: (v) => <code className="text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{String(v)}</code>,
    },
    { key: 'locale' as keyof CmsPage, header: t('cms.locale'), sortable: true,
      cellRenderer: (v) => <span className="text-xs font-mono uppercase">{String(v)}</span>,
    },
    { key: 'published' as keyof CmsPage, header: t('cms.status'), sortable: true,
      cellRenderer: (v) => (
        <span className={cn('inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full', v ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400')}>
          {v ? <Eye size={12} /> : <EyeOff size={12} />}
          {v ? t('cms.published') : t('cms.draft')}
        </span>
      ),
    },
    { key: 'showInFooter' as keyof CmsPage, header: t('cms.footer'),
      cellRenderer: (v) => v ? <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">{t('cms.inFooter')}</span> : <span className="text-xs text-slate-400">—</span>,
    },
    { key: 'sortOrder' as keyof CmsPage, header: t('cms.order'), sortable: true },
  ];

  const rowActions: RowAction<CmsPage>[] = [
    { label: t('common.edit'), icon: <Pencil size={14} />, onClick: openEdit },
    { label: t('common.delete'), icon: <Trash2 size={14} />, danger: true, onClick: deletePage,
      hidden: (row) => isSystemSlug(row.slug), // ne pas afficher "Supprimer" pour les pages système
    },
  ];

  // ── Editor ────────────────────────────────────────────────────────────────
  if (editing) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setEditing(null)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white">
              <FileText size={18} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">
                {editing.id ? t('cms.editPage') : t('cms.newPage')}
              </h1>
              {isSysSlug && (
                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <Lock size={10} /> {t('cms.systemPage')}
                </p>
              )}
            </div>
          </div>
          <div className="flex-1" />
          <Button onClick={savePage} disabled={saving || !editing.slug || !editing.title || !structuredValid} className="gap-1.5">
            <Save size={14} />
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </div>

        {/* Meta fields */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('cms.pageTitle')}</label>
            <input
              type="text" value={editing.title || ''} onChange={e => updateField('title', e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Slug</label>
            <input
              type="text" value={editing.slug || ''} onChange={e => updateField('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              placeholder="about, terms, news..."
              disabled={!!editing.id || isSysSlug}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('cms.locale')}</label>
            <select
              value={editing.locale || 'fr'} onChange={e => updateField('locale', e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              {['fr', 'en', 'es', 'pt', 'ar', 'wo', 'ln', 'ktu'].map(l => (
                <option key={l} value={l}>{l.toUpperCase()}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('cms.order')}</label>
            <input
              type="number" value={editing.sortOrder ?? 0} onChange={e => updateField('sortOrder', parseInt(e.target.value) || 0)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          </div>
        </div>

        {/* Toggles */}
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={editing.published ?? false} onChange={e => updateField('published', e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-blue-500 focus:ring-blue-500" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('cms.publishPage')}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={editing.showInFooter ?? false} onChange={e => updateField('showInFooter', e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('cms.showInFooter')}</span>
          </label>
        </div>

        {/* Structured editor for system slugs, rich text for custom pages */}
        {isSysSlug ? (
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
            {currentSlug === 'hero'    && <HeroEditor content={editing.content || '{}'} onChange={c => updateField('content', c)} />}
            {currentSlug === 'about'   && <AboutEditor content={editing.content || '{}'} onChange={c => updateField('content', c)} />}
            {currentSlug === 'contact' && <ContactEditor content={editing.content || '{}'} onChange={c => updateField('content', c)} />}
          </div>
        ) : (
          <RichTextEditor
            value={editing.content || ''}
            onChange={html => updateField('content', html)}
            placeholder={t('cms.contentPlaceholder')}
            minHeight="350px"
          />
        )}
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white">
            <FileText size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t('cms.pagesTitle')}</h1>
            <p className="text-sm text-slate-500">{t('cms.pagesSubtitle')}</p>
          </div>
        </div>
        <Button onClick={openNew} className="gap-1.5">
          <Plus size={14} /> {t('cms.newPage')}
        </Button>
      </div>

      <DataTableMaster
        columns={columns}
        data={pagesRes.data ?? []}
        loading={pagesRes.loading}
        rowActions={rowActions}
        onRowClick={openEdit}
        emptyMessage={t('cms.noPagesYet')}
        searchPlaceholder={t('cms.searchPages')}
      />
    </div>
  );
}
