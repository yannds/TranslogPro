/**
 * PagePortalAdmin — Gestion du portail visiteur public
 *
 * Sections :
 *   1. Thème & Style — couleurs, CSS custom, thèmes pré-définis
 *   2. Carrousel Hero — images, slogans, overlay
 *   3. Sections — activer/désactiver About, Fleet, News, Contact
 *   4. Réseaux sociaux
 *   5. Aperçu lien public
 *
 * Données :
 *   GET  /api/v1/tenants/:tid/portal/config
 *   PUT  /api/v1/tenants/:tid/portal/config
 *   GET  /api/v1/tenants/:tid/brand (couleurs existantes)
 */

import { useState, useEffect } from 'react';
import {
  Globe, Palette, Image, ToggleLeft, Share2, Eye,
  Save, ChevronDown, ChevronUp, ExternalLink,
} from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPut } from '../../lib/api';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import { cn } from '../../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PortalConfig {
  showAbout: boolean;
  showFleet: boolean;
  showNews: boolean;
  showContact: boolean;
  heroImageUrl?: string;
  heroOverlay: number;
  slogans: Record<string, string>;
  socialLinks: Record<string, string>;
  ogImageUrl?: string;
}

interface BrandConfig {
  brandName: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  bgColor: string;
  textColor: string;
}

// ─── Pre-built themes ─────────────────────────────────────────────────────────

const THEMES = [
  {
    id: 'amber-luxury',
    name: 'Ambre Luxe',
    desc: 'Or & noir — premium, élégant',
    primary: '#d97706', secondary: '#1e293b', accent: '#f59e0b', bg: '#ffffff', text: '#111827',
    preview: 'from-amber-500 to-amber-700',
  },
  {
    id: 'ocean-blue',
    name: 'Océan Bleu',
    desc: 'Bleu profond — confiance, sérénité',
    primary: '#2563eb', secondary: '#1e3a5f', accent: '#06b6d4', bg: '#ffffff', text: '#111827',
    preview: 'from-blue-500 to-blue-700',
  },
  {
    id: 'emerald-nature',
    name: 'Émeraude Nature',
    desc: 'Vert & doré — éco, naturel',
    primary: '#059669', secondary: '#064e3b', accent: '#d97706', bg: '#ffffff', text: '#111827',
    preview: 'from-emerald-500 to-emerald-700',
  },
  {
    id: 'royal-purple',
    name: 'Pourpre Royal',
    desc: 'Violet & or — prestige, distinction',
    primary: '#7c3aed', secondary: '#2e1065', accent: '#f59e0b', bg: '#ffffff', text: '#111827',
    preview: 'from-violet-500 to-violet-700',
  },
];

// ─── CSS variables documentation for tenant custom CSS ────────────────────────

const CSS_VARS_DOC = `/* Variables CSS disponibles pour personnalisation */
:root {
  --color-primary:   /* Couleur principale */;
  --color-secondary: /* Couleur secondaire */;
  --color-accent:    /* Couleur d'accent */;
  --color-text:      /* Couleur du texte */;
  --color-bg:        /* Couleur de fond */;
  --font-brand:      /* Police de la marque */;
}

/* Classes utilitaires du portail */
.portal-hero     { /* Section hero avec carrousel */ }
.portal-nav      { /* Barre de navigation */ }
.portal-search   { /* Formulaire de recherche */ }
.portal-card     { /* Carte de trajet */ }
.portal-footer   { /* Pied de page */ }
.portal-btn-primary { /* Bouton principal */ }
.portal-btn-book    { /* Bouton réserver */ }`;

// ─── Component ────────────────────────────────────────────────────────────────

export function PagePortalAdmin() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId;
  const tenantSlug = ''; // Will be loaded from config

  // Fetch current config
  const portalRes = useFetch<PortalConfig | null>(
    tenantId ? `/api/v1/tenants/${tenantId}/portal/config` : null,
    [tenantId],
  );
  const brandRes = useFetch<BrandConfig>(
    tenantId ? `/api/v1/tenants/${tenantId}/brand` : null,
    [tenantId],
  );

  // Local state
  const [config, setConfig] = useState<Partial<PortalConfig>>({
    showAbout: true, showFleet: true, showNews: true, showContact: true,
    heroOverlay: 0.4, slogans: {}, socialLinks: {},
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>('themes');

  // Sync fetched data
  useEffect(() => {
    if (portalRes.data) setConfig(portalRes.data);
  }, [portalRes.data]);

  const updateField = <K extends keyof PortalConfig>(key: K, value: PortalConfig[K]) => {
    setConfig(c => ({ ...c, [key]: value }));
    setSaved(false);
  };

  const applyTheme = async (theme: typeof THEMES[0]) => {
    if (!tenantId) return;
    await apiPut(`/api/v1/tenants/${tenantId}/brand`, {
      brandName: brandRes.data?.brandName || 'My Company',
      primaryColor: theme.primary,
      secondaryColor: theme.secondary,
      accentColor: theme.accent,
      bgColor: theme.bg,
      textColor: theme.text,
    });
    brandRes.refetch();
    setSaved(false);
  };

  const saveConfig = async () => {
    if (!tenantId) return;
    setSaving(true);
    try {
      await apiPut(`/api/v1/tenants/${tenantId}/portal/config`, config);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const toggle = (section: string) => setExpandedSection(s => s === section ? null : section);

  if (portalRes.loading || brandRes.loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-white">
            <Globe size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t('portalAdmin.title')}</h1>
            <p className="text-sm text-slate-500">{t('portalAdmin.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/p/${user?.tenantId ? 'trans-express' : ''}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <Eye size={14} /> {t('portalAdmin.preview')}
            <ExternalLink size={12} />
          </a>
          <Button onClick={saveConfig} disabled={saving || saved} className="gap-1.5">
            <Save size={14} />
            {saving ? t('common.saving') : saved ? t('portalAdmin.saved') : t('common.save')}
          </Button>
        </div>
      </div>

      {/* ── Section 1: Themes ──────────────────────────────────────────────── */}
      <Card>
        <button onClick={() => toggle('themes')} className="w-full">
          <CardHeader className="flex-row items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
            <div className="flex items-center gap-2">
              <Palette size={18} className="text-amber-500" />
              <span className="font-semibold">{t('portalAdmin.themesTitle')}</span>
            </div>
            {expandedSection === 'themes' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </CardHeader>
        </button>
        {expandedSection === 'themes' && (
          <CardContent className="space-y-6">
            {/* Pre-built themes */}
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">{t('portalAdmin.prebuiltThemes')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {THEMES.map(theme => (
                  <button
                    key={theme.id}
                    onClick={() => applyTheme(theme)}
                    className={cn(
                      'flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all hover:shadow-md',
                      brandRes.data?.primaryColor === theme.primary
                        ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/10'
                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300',
                    )}
                  >
                    <div className={cn('w-10 h-10 rounded-lg bg-gradient-to-br shrink-0', theme.preview)} />
                    <div>
                      <p className="font-semibold text-sm text-slate-900 dark:text-white">{theme.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{theme.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Current colors (read from brand) */}
            {brandRes.data && (
              <div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">{t('portalAdmin.currentColors')}</p>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { label: 'Primary', color: brandRes.data.primaryColor },
                    { label: 'Secondary', color: brandRes.data.secondaryColor },
                    { label: 'Accent', color: brandRes.data.accentColor },
                    { label: 'Bg', color: brandRes.data.bgColor },
                    { label: 'Text', color: brandRes.data.textColor },
                  ].map(c => (
                    <div key={c.label} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                      <div className="w-5 h-5 rounded border border-slate-200 dark:border-slate-600" style={{ backgroundColor: c.color }} />
                      <span className="text-xs font-mono text-slate-600 dark:text-slate-400">{c.color}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-2">{t('portalAdmin.editColorsHint')}</p>
              </div>
            )}

            {/* Custom CSS documentation */}
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">{t('portalAdmin.customCssTitle')}</p>
              <p className="text-xs text-slate-500 mb-3">{t('portalAdmin.customCssDesc')}</p>
              <pre className="bg-slate-900 text-slate-300 rounded-xl p-4 text-xs overflow-x-auto leading-relaxed font-mono">
                {CSS_VARS_DOC}
              </pre>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ── Section 2: Hero / Carousel ─────────────────────────────────────── */}
      <Card>
        <button onClick={() => toggle('hero')} className="w-full">
          <CardHeader className="flex-row items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
            <div className="flex items-center gap-2">
              <Image size={18} className="text-amber-500" />
              <span className="font-semibold">{t('portalAdmin.heroTitle')}</span>
            </div>
            {expandedSection === 'hero' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </CardHeader>
        </button>
        {expandedSection === 'hero' && (
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('portalAdmin.heroImageUrl')}</label>
              <input
                type="url"
                value={config.heroImageUrl || ''}
                onChange={e => updateField('heroImageUrl', e.target.value)}
                placeholder="https://storage.example.com/hero.jpg"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
              <p className="text-xs text-slate-400 mt-1">{t('portalAdmin.heroImageHint')}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('portalAdmin.heroOverlay')} ({Math.round((config.heroOverlay ?? 0.4) * 100)}%)
              </label>
              <input
                type="range"
                min={0} max={1} step={0.05}
                value={config.heroOverlay ?? 0.4}
                onChange={e => updateField('heroOverlay', parseFloat(e.target.value))}
                className="w-full accent-amber-500"
              />
            </div>

            {/* Slogans by language */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">{t('portalAdmin.slogans')}</label>
              <div className="space-y-2">
                {['fr', 'en', 'es', 'pt', 'ar'].map(locale => (
                  <div key={locale} className="flex items-center gap-2">
                    <span className="text-xs font-mono text-slate-500 w-6 text-center uppercase">{locale}</span>
                    <input
                      type="text"
                      value={(config.slogans ?? {})[locale] || ''}
                      onChange={e => updateField('slogans', { ...(config.slogans ?? {}), [locale]: e.target.value })}
                      placeholder={locale === 'fr' ? 'Voyagez en toute élégance' : locale === 'en' ? 'Travel in Style' : ''}
                      className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                    />
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ── Section 3: Toggle Sections ─────────────────────────────────────── */}
      <Card>
        <button onClick={() => toggle('sections')} className="w-full">
          <CardHeader className="flex-row items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
            <div className="flex items-center gap-2">
              <ToggleLeft size={18} className="text-amber-500" />
              <span className="font-semibold">{t('portalAdmin.sectionsTitle')}</span>
            </div>
            {expandedSection === 'sections' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </CardHeader>
        </button>
        {expandedSection === 'sections' && (
          <CardContent className="space-y-3">
            <p className="text-xs text-slate-500 mb-2">{t('portalAdmin.sectionsDesc')}</p>
            {([
              { key: 'showAbout' as const, label: t('portalAdmin.sectionAbout'), desc: t('portalAdmin.sectionAboutDesc') },
              { key: 'showFleet' as const, label: t('portalAdmin.sectionFleet'), desc: t('portalAdmin.sectionFleetDesc') },
              { key: 'showNews' as const, label: t('portalAdmin.sectionNews'), desc: t('portalAdmin.sectionNewsDesc') },
              { key: 'showContact' as const, label: t('portalAdmin.sectionContact'), desc: t('portalAdmin.sectionContactDesc') },
            ]).map(s => (
              <label key={s.key} className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors">
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">{s.label}</p>
                  <p className="text-xs text-slate-500">{s.desc}</p>
                </div>
                <input
                  type="checkbox"
                  checked={config[s.key] ?? true}
                  onChange={e => updateField(s.key, e.target.checked)}
                  className="w-5 h-5 rounded border-slate-300 text-amber-500 focus:ring-amber-500 cursor-pointer"
                />
              </label>
            ))}
          </CardContent>
        )}
      </Card>

      {/* ── Section 4: Social Links ────────────────────────────────────────── */}
      <Card>
        <button onClick={() => toggle('social')} className="w-full">
          <CardHeader className="flex-row items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
            <div className="flex items-center gap-2">
              <Share2 size={18} className="text-amber-500" />
              <span className="font-semibold">{t('portalAdmin.socialTitle')}</span>
            </div>
            {expandedSection === 'social' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </CardHeader>
        </button>
        {expandedSection === 'social' && (
          <CardContent className="space-y-3">
            {['facebook', 'instagram', 'twitter', 'whatsapp', 'tiktok'].map(platform => (
              <div key={platform} className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-500 w-20 capitalize">{platform}</span>
                <input
                  type="url"
                  value={(config.socialLinks ?? {})[platform] || ''}
                  onChange={e => updateField('socialLinks', { ...(config.socialLinks ?? {}), [platform]: e.target.value })}
                  placeholder={`https://${platform}.com/...`}
                  className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                />
              </div>
            ))}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
