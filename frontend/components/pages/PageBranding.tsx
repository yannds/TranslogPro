/**
 * PageBranding — Paramètres marque blanche (White-label)
 *
 * Données :
 *   GET /api/v1/tenants/:tid/brand        → lire la config
 *   PUT /api/v1/tenants/:tid/brand        → sauvegarder
 *
 * Prévisualisation live : les couleurs sont appliquées en CSS custom props
 * sur un aperçu interne (pas sur l'app globale tant que non sauvegardé).
 *
 * Accessibilité : WCAG 2.1 AA — aria-labels, rôles, focus visible
 * Dark mode : classes Tailwind dark: via ThemeProvider
 */

import { useState, useEffect, type FormEvent } from 'react';
import { Palette, Save, RotateCcw, Eye, Bus } from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPut } from '../../lib/api';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import { cn } from '../../lib/utils';


// ─── Types ────────────────────────────────────────────────────────────────────

interface BrandConfig {
  brandName:       string;
  logoUrl?:        string;
  faviconUrl?:     string;
  primaryColor?:   string;
  secondaryColor?: string;
  accentColor?:    string;
  textColor?:      string;
  bgColor?:        string;
  fontFamily?:     string;
  metaTitle?:      string;
  metaDescription?: string;
  supportEmail?:   string;
  supportPhone?:   string;
}

// ─── Champ de couleur ─────────────────────────────────────────────────────────

function ColorField({
  label, name, value, onChange,
}: {
  label:    string;
  name:     string;
  value:    string;
  onChange: (name: string, value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={`brand-${name}`}
        className="block text-sm font-medium text-slate-700 dark:text-slate-300"
      >
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={`brand-${name}`}
          type="color"
          value={value || '#000000'}
          onChange={e => onChange(name, e.target.value)}
          className="h-9 w-12 cursor-pointer rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-0.5"
          aria-label={`Couleur ${label}`}
        />
        <input
          type="text"
          value={value || ''}
          onChange={e => onChange(name, e.target.value)}
          placeholder="#000000"
          maxLength={7}
          pattern="^#[0-9A-Fa-f]{6}$"
          className={cn(
            'flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800',
            'px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400',
            'focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30',
          )}
          aria-label={`Valeur hex ${label}`}
        />
      </div>
    </div>
  );
}

// ─── Aperçu live ──────────────────────────────────────────────────────────────

function BrandPreview({ brand }: { brand: BrandConfig }) {
  const bg      = brand.bgColor      ?? '#020617';
  const primary = brand.primaryColor ?? '#0d9488';
  const text    = brand.textColor    ?? '#f8fafc';
  const accent  = brand.accentColor  ?? '#f59e0b';
  const { t: tFn } = useI18n();
  const name    = brand.brandName    || tFn('branding.myCompany');

  return (
    <div
      aria-label={tFn('branding.brandPreview')}
      className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 select-none"
      style={{ fontFamily: brand.fontFamily ?? 'inherit' }}
    >
      {/* Topbar */}
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ backgroundColor: bg }}
      >
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ backgroundColor: primary }}
        >
          <Bus className="w-4 h-4" style={{ color: text }} aria-hidden />
        </div>
        <span className="text-sm font-bold" style={{ color: text }}>{name}</span>
      </div>

      {/* Content */}
      <div className="bg-slate-100 dark:bg-slate-800 px-4 py-4 space-y-3">
        <div className="h-2 w-3/4 rounded-full" style={{ backgroundColor: primary, opacity: 0.4 }} />
        <div className="h-2 w-1/2 rounded-full bg-slate-300 dark:bg-slate-600" />
        <div className="flex gap-2">
          <div
            className="px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ backgroundColor: primary, color: text }}
          >
            {tFn('branding.primaryAction')}
          </div>
          <div
            className="px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ backgroundColor: accent, color: '#000' }}
          >
            {tFn('branding.accent')}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function PageBranding() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId ?? '';

  const brandUrl = tenantId ? `/api/v1/tenants/${tenantId}/brand` : null;
  const { data: remote, loading, error: fetchError, refetch } = useFetch<BrandConfig>(
    brandUrl,
    [tenantId],
  );

  const [form,    setForm]    = useState<BrandConfig>({ brandName: '' });
  const [saving,  setSaving]  = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  // Sync formulaire depuis l'API quand les données arrivent
  useEffect(() => {
    if (remote) setForm(remote);
  }, [remote]);

  const handleText = (field: keyof BrandConfig, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const handleColor = (name: string, value: string) =>
    setForm(prev => ({ ...prev, [name]: value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    try {
      await apiPut(`/api/v1/tenants/${tenantId}/brand`, form);
      setSaveMsg(t('branding.brandSaved'));
      refetch();
    } catch {
      setSaveMsg(t('branding.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (remote) setForm(remote);
    setSaveMsg(null);
  };

  const fieldClass = cn(
    'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800',
    'px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400',
    'focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30',
    'disabled:opacity-50',
  );

  return (
    <div className="p-6 space-y-6">

      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
            <Palette className="w-5 h-5 text-purple-600 dark:text-purple-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('branding.title')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('branding.subtitle')}</p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPreview(p => !p)}
          aria-pressed={preview}
        >
          <Eye className="w-4 h-4 mr-2" aria-hidden />
          {preview ? t('branding.hidePreview') : t('branding.livePreview')}
        </Button>
      </div>

      {fetchError && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {fetchError}
        </div>
      )}

      <div className={cn('grid gap-6', preview ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1')}>

        {/* Formulaire */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {loading ? (
            <Card>
              <CardContent className="pt-5 space-y-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Identité */}
              <Card>
                <CardHeader heading={t('branding.identity')} />
                <CardContent className="pt-4 space-y-4">
                  <div className="space-y-1.5">
                    <label htmlFor="brand-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                      {t('branding.brandName')} <span aria-hidden className="text-red-500">*</span>
                    </label>
                    <input
                      id="brand-name"
                      type="text"
                      required
                      value={form.brandName}
                      onChange={e => handleText('brandName', e.target.value)}
                      maxLength={100}
                      placeholder="Ex: Congo Express"
                      className={fieldClass}
                      disabled={saving}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="brand-logo" className="block text-sm font-medium text-slate-700 dark:text-slate-300">{t('branding.logoUrl')}</label>
                    <input
                      id="brand-logo"
                      type="url"
                      value={form.logoUrl ?? ''}
                      onChange={e => handleText('logoUrl', e.target.value)}
                      placeholder="https://cdn.example.com/logo.png"
                      className={fieldClass}
                      disabled={saving}
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label htmlFor="brand-support-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300">{t('branding.supportEmail')}</label>
                      <input
                        id="brand-support-email"
                        type="email"
                        value={form.supportEmail ?? ''}
                        onChange={e => handleText('supportEmail', e.target.value)}
                        placeholder="support@example.com"
                        className={fieldClass}
                        disabled={saving}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="brand-support-phone" className="block text-sm font-medium text-slate-700 dark:text-slate-300">{t('branding.supportPhone')}</label>
                      <input
                        id="brand-support-phone"
                        type="tel"
                        value={form.supportPhone ?? ''}
                        onChange={e => handleText('supportPhone', e.target.value)}
                        placeholder="+242 06 000 0000"
                        className={fieldClass}
                        disabled={saving}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Couleurs */}
              <Card>
                <CardHeader heading={t('branding.colors')} />
                <CardContent className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <ColorField label={t('branding.primaryColor')}   name="primaryColor"   value={form.primaryColor   ?? '#0d9488'} onChange={handleColor} />
                  <ColorField label={t('branding.secondaryColor')} name="secondaryColor" value={form.secondaryColor ?? '#0f766e'} onChange={handleColor} />
                  <ColorField label={t('branding.accentColor')}    name="accentColor"    value={form.accentColor    ?? '#f59e0b'} onChange={handleColor} />
                  <ColorField label={t('branding.textColor')}      name="textColor"      value={form.textColor      ?? '#f8fafc'} onChange={handleColor} />
                  <ColorField label={t('branding.bgColor')}        name="bgColor"        value={form.bgColor        ?? '#020617'} onChange={handleColor} />
                  <div className="space-y-1.5">
                    <label htmlFor="brand-font" className="block text-sm font-medium text-slate-700 dark:text-slate-300">{t('branding.font')}</label>
                    <input
                      id="brand-font"
                      type="text"
                      value={form.fontFamily ?? ''}
                      onChange={e => handleText('fontFamily', e.target.value)}
                      placeholder="Inter, sans-serif"
                      className={fieldClass}
                      disabled={saving}
                    />
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {/* Footer actions */}
          <div className="flex items-center justify-between gap-3">
            {saveMsg && (
              <p
                aria-live="polite"
                className={cn(
                  'text-sm',
                  saveMsg === t('branding.saveError') ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400',
                )}
              >
                {saveMsg}
              </p>
            )}
            <div className="flex gap-2 ml-auto">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleReset}
                disabled={saving || loading}
              >
                <RotateCcw className="w-4 h-4 mr-2" aria-hidden />
                {t('branding.reset')}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={saving || loading}
              >
                <Save className="w-4 h-4 mr-2" aria-hidden />
                {saving ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </div>
        </form>

        {/* Aperçu live */}
        {preview && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-600 dark:text-slate-400 flex items-center gap-2">
              <Eye className="w-4 h-4" aria-hidden />
              {t('branding.previewLabel')}
            </p>
            <BrandPreview brand={form} />
          </div>
        )}
      </div>
    </div>
  );
}
