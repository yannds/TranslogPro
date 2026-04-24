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
 *   GET  /api/tenants/:tid/portal/config
 *   PUT  /api/tenants/:tid/portal/config
 *   GET  /api/tenants/:tid/brand (couleurs existantes)
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
import { PORTAL_THEMES_LIST } from '../portail-voyageur/portal-themes';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PortalConfig {
  themeId: string;
  showAbout: boolean;
  showFleet: boolean;
  showNews: boolean;
  showContact: boolean;
  newsCmsEnabled: boolean;
  heroImageUrl?: string;
  heroOverlay: number;
  slogans: Record<string, string>;
  socialLinks: Record<string, string>;
  ogImageUrl?: string;
}

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
    tenantId ? `/api/tenants/${tenantId}/portal/config` : null,
    [tenantId],
  );
  // brand not needed — themes are self-contained

  // Local state
  const [config, setConfig] = useState<Partial<PortalConfig>>({
    themeId: 'amber-luxury',
    showAbout: true, showFleet: true, showNews: true, showContact: true,
    newsCmsEnabled: false,
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

  const selectTheme = (themeId: string) => {
    updateField('themeId', themeId);
  };

  const saveConfig = async () => {
    if (!tenantId) return;
    setSaving(true);
    try {
      // Only send DTO-valid fields — strip id, tenantId, updatedAt etc.
      const payload = {
        themeId:        config.themeId,
        showAbout:      config.showAbout,
        showFleet:      config.showFleet,
        showNews:       config.showNews,
        showContact:    config.showContact,
        newsCmsEnabled: config.newsCmsEnabled,
        heroImageUrl:   config.heroImageUrl || undefined,
        heroOverlay:    config.heroOverlay,
        slogans:        config.slogans,
        socialLinks:    config.socialLinks,
        ogImageUrl:     config.ogImageUrl || undefined,
      };
      await apiPut(`/api/tenants/${tenantId}/portal/config`, payload);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const toggle = (section: string) => setExpandedSection(s => s === section ? null : section);

  if (portalRes.loading) {
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
            {/* Theme selection with live preview */}
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">{t('portalAdmin.prebuiltThemes')}</p>
              <div className="grid grid-cols-1 gap-4">
                {PORTAL_THEMES_LIST.map(theme => {
                  const active = config.themeId === theme.id;
                  return (
                    <button
                      key={theme.id}
                      onClick={() => selectTheme(theme.id)}
                      className={cn(
                        'relative rounded-2xl border-2 text-left transition-all overflow-hidden',
                        active ? 'border-slate-900 dark:border-white ring-2 ring-slate-900/20 dark:ring-white/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-400',
                      )}
                    >
                      {/* Mini hero preview */}
                      <div className="h-28 relative overflow-hidden">
                        <div className="absolute inset-0" style={{ background: theme.heroScenes[0].bg }} />
                        <div className="absolute inset-0" style={{ background: theme.heroScenes[0].overlay }} />
                        <div className="relative p-4 flex flex-col justify-end h-full">
                          <p className="text-white font-black text-lg leading-tight">{theme.name}</p>
                          <p className="text-white/60 text-xs mt-0.5">{theme.description}</p>
                        </div>
                        {active && (
                          <div className="absolute top-3 right-3 w-7 h-7 rounded-full bg-white flex items-center justify-center shadow-lg">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                          </div>
                        )}
                      </div>
                      {/* Color swatches */}
                      <div className="p-3 flex items-center gap-3">
                        <div className="flex gap-1">
                          <div className="w-6 h-6 rounded-full border border-slate-200" style={{ backgroundColor: theme.accent }} title="Accent" />
                          <div className="w-6 h-6 rounded-full border border-slate-200" style={{ backgroundColor: theme.accentLight }} title="Light" />
                          <div className="w-6 h-6 rounded-full border border-slate-200" style={{ backgroundColor: theme.accentDark }} title="Dark" />
                          <div className="w-6 h-6 rounded-full border border-slate-200" style={{ backgroundColor: theme.secondary }} title="Secondary" />
                        </div>
                        <span className="text-xs text-slate-500 ml-auto">{active ? t('portalAdmin.activeTheme') : t('portalAdmin.clickToApply')}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

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
              { key: 'newsCmsEnabled' as const, label: t('cms.newsCmsToggle'), desc: t('cms.newsCmsToggleDesc') },
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
