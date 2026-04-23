/**
 * PagePlatformSettings — édition des paramètres plateforme (SUPER_ADMIN).
 *
 * Le backend expose le registre des clés connues (label, type, default,
 * validate) enrichi des valeurs courantes. Le formulaire est auto-généré
 * depuis ce registre : ajouter une clé backend = elle apparaît ici sans
 * changer le code frontend.
 *
 * Exception : le groupe "platformConfig.groupRouting" bénéficie d'un rendu
 * enrichi — select pour le provider + section injection clés API dans Vault.
 *
 * Endpoints :
 *   GET    /api/platform/config
 *   PATCH  /api/platform/config             { entries: [{ key, value }, …] }
 *   DELETE /api/platform/config/:key        (reset à la valeur par défaut)
 *   GET    /api/platform/config/routing/key-status
 *   PUT    /api/platform/config/routing/key/:provider   { apiKey }
 *   DELETE /api/platform/config/routing/key/:provider
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Settings, Save, RotateCcw, AlertTriangle, Check, Info,
  ShieldCheck, ShieldAlert, KeyRound, Trash2,
} from 'lucide-react';
import { useFetch }                        from '../../lib/hooks/useFetch';
import { apiPatch, apiDelete, apiPut }     from '../../lib/api';
import { useI18n }                         from '../../lib/i18n/useI18n';
import { Button }                          from '../ui/Button';
import { Badge }                           from '../ui/Badge';
import { Dialog }                          from '../ui/Dialog';
import { FormFooter }                      from '../ui/FormFooter';
import { ErrorAlert }                      from '../ui/ErrorAlert';
import { inputClass }                      from '../ui/inputClass';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConfigEntry {
  key:       string;
  type:      'number' | 'boolean' | 'string';
  default:   unknown;
  label:     string;
  help:      string;
  group:     string;
  current:   unknown;
  isDefault: boolean;
}

interface KeyStatus { google: boolean; mapbox: boolean }

type RoutingProvider = 'google' | 'mapbox';
const ROUTING_GROUP = 'platformConfig.groupRouting';

const PROVIDER_LABELS: Record<RoutingProvider, string> = {
  google: 'platformConfig.routingKeyGoogle',
  mapbox: 'platformConfig.routingKeyMapbox',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const inp = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30 disabled:opacity-50';

function parseInput(value: string, type: ConfigEntry['type']): unknown {
  if (type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'boolean') return value === 'true';
  return value;
}

// ─── Sous-composant : dialog injection clé API Vault ─────────────────────────

function RoutingKeyDialog({
  open, provider, onClose, onSaved,
}: {
  open:     boolean;
  provider: RoutingProvider | null;
  onClose:  () => void;
  onSaved:  () => void;
}) {
  const { t } = useI18n();
  const [apiKey, setApiKey] = useState('');
  const [busy,   setBusy]   = useState(false);
  const [err,    setErr]    = useState<string | null>(null);

  useEffect(() => {
    if (open) { setApiKey(''); setErr(null); }
  }, [open, provider]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!provider || !apiKey.trim()) return;
    setBusy(true); setErr(null);
    try {
      await apiPut(`/api/platform/config/routing/key/${provider}`, { apiKey: apiKey.trim() });
      onSaved();
      onClose();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  if (!provider) return null;
  const providerLabel = t(PROVIDER_LABELS[provider]);

  return (
    <Dialog
      open={open}
      onOpenChange={v => { if (!v) onClose(); }}
      title={t('platformConfig.routingKeyDialogTitle').replace('{{provider}}', providerLabel)}
      description={t('platformConfig.routingKeyDialogDesc')}
      size="md"
      footer={
        <FormFooter
          onCancel={onClose}
          busy={busy}
          submitLabel={t('platformConfig.routingKeySave')}
          pendingLabel={t('platformConfig.routingKeySaving')}
          formId="routing-key-form"
        />
      }
    >
      {/* Notice Vault */}
      <div className="mb-4 flex gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-3 text-xs text-slate-600 dark:text-slate-400">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{t('platformConfig.routingKeyVaultNotice')}</span>
      </div>

      {err && <ErrorAlert error={err} />}

      <form id="routing-key-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="routing-api-key" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('platformConfig.routingKeyLabel')}
            <span className="ml-1 text-red-500" aria-hidden>*</span>
          </label>
          <input
            id="routing-api-key"
            type="password"
            className={inputClass}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={t('platformConfig.routingKeyPlaceholder')}
            required
            autoComplete="new-password"
            aria-required
          />
        </div>
      </form>
    </Dialog>
  );
}

// ─── Sous-composant : section clés API dans le groupe Routing ─────────────────

function RoutingKeysSection({ onRefreshStatus }: { onRefreshStatus: () => void }) {
  const { t } = useI18n();

  const { data: keyStatus, refetch: refetchStatus } = useFetch<KeyStatus>(
    '/api/platform/config/routing/key-status',
  );

  const [dialogProvider, setDialogProvider] = useState<RoutingProvider | null>(null);
  const [deleting, setDeleting]             = useState<RoutingProvider | null>(null);
  const [delErr,   setDelErr]               = useState<string | null>(null);

  const handleDelete = async (provider: RoutingProvider) => {
    const label = t(PROVIDER_LABELS[provider]);
    if (!confirm(t('platformConfig.routingKeyDeleteConfirm').replace('{{provider}}', label))) return;
    setDeleting(provider); setDelErr(null);
    try {
      await apiDelete(`/api/platform/config/routing/key/${provider}`);
      refetchStatus();
      onRefreshStatus();
    } catch (ex) {
      setDelErr(ex instanceof Error ? ex.message : 'Erreur');
    } finally {
      setDeleting(null);
    }
  };

  const handleSaved = () => {
    refetchStatus();
    onRefreshStatus();
  };

  return (
    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
      <div className="flex items-start gap-2">
        <KeyRound className="w-4 h-4 mt-0.5 text-teal-600 dark:text-teal-400 shrink-0" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('platformConfig.routingApiKeysTitle')}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('platformConfig.routingApiKeysDesc')}</p>
        </div>
      </div>

      {delErr && <ErrorAlert error={delErr} />}

      <ul className="space-y-2">
        {(['google', 'mapbox'] as RoutingProvider[]).map(provider => {
          const configured = keyStatus?.[provider] ?? false;
          return (
            <li key={provider}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-800"
            >
              <div className="flex items-center gap-2 min-w-0">
                {configured
                  ? <ShieldCheck className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" aria-hidden />
                  : <ShieldAlert className="w-4 h-4 text-orange-500 shrink-0" aria-hidden />
                }
                <span className="text-sm text-slate-800 dark:text-slate-200 font-medium">
                  {t(PROVIDER_LABELS[provider])}
                </span>
                <Badge variant={configured ? 'success' : 'warning'} size="sm">
                  {configured ? t('platformConfig.routingKeyConfigured') : t('platformConfig.routingKeyMissing')}
                </Badge>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDialogProvider(provider)}
                  aria-label={`${t(configured ? 'platformConfig.routingKeyReplace' : 'platformConfig.routingKeyConfigure')} ${t(PROVIDER_LABELS[provider])}`}
                >
                  {t(configured ? 'platformConfig.routingKeyReplace' : 'platformConfig.routingKeyConfigure')}
                </Button>
                {configured && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={deleting === provider}
                    onClick={() => { void handleDelete(provider); }}
                    aria-label={`${t('platformConfig.routingKeyDelete')} ${t(PROVIDER_LABELS[provider])}`}
                    className="text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950/30"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden />
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <RoutingKeyDialog
        open={!!dialogProvider}
        provider={dialogProvider}
        onClose={() => setDialogProvider(null)}
        onSaved={handleSaved}
      />
    </div>
  );
}

// ─── Composant principal ─────────────────────────────────────────────────────

export function PagePlatformSettings() {
  const { t } = useI18n();

  const { data, loading, error, refetch } = useFetch<ConfigEntry[]>('/api/platform/config');

  const [draft,      setDraft]      = useState<Record<string, string>>({});
  const [saving,     setSaving]     = useState(false);
  const [saveOk,     setSaveOk]     = useState(false);
  const [actionErr,  setActionErr]  = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const next: Record<string, string> = {};
    for (const e of data) next[e.key] = String(e.current);
    setDraft(next);
  }, [data]);

  const grouped = useMemo(() => {
    const map = new Map<string, ConfigEntry[]>();
    for (const e of data ?? []) {
      const arr = map.get(e.group) ?? [];
      arr.push(e);
      map.set(e.group, arr);
    }
    return Array.from(map.entries());
  }, [data]);

  const dirtyKeys = useMemo(
    () => (data ?? []).filter(e => String(e.current) !== draft[e.key]).map(e => e.key),
    [data, draft],
  );

  const handleChange = (key: string, raw: string) => {
    setDraft(prev => ({ ...prev, [key]: raw }));
    setSaveOk(false);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (dirtyKeys.length === 0 || !data) return;
    setSaving(true); setActionErr(null); setSaveOk(false);
    try {
      const entries = dirtyKeys.map(k => {
        const def = data.find(d => d.key === k)!;
        return { key: k, value: parseInput(draft[k] ?? '', def.type) };
      });
      await apiPatch('/api/platform/config', { entries });
      setSaveOk(true);
      refetch();
    } catch (err) {
      setActionErr((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async (key: string) => {
    setSaving(true); setActionErr(null); setSaveOk(false);
    try {
      await apiDelete(`/api/platform/config/${encodeURIComponent(key)}`);
      refetch();
    } catch (err) { setActionErr((err as Error).message); }
    finally { setSaving(false); }
  };

  const renderField = (e: ConfigEntry) => {
    const val   = draft[e.key] ?? '';
    const dirty = String(e.current) !== val;

    return (
      <div key={e.key} className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`cfg-input-${e.key}`} className="text-sm font-medium t-text">
            {t(e.label)}
          </label>
          <div className="flex items-center gap-1">
            {dirty && <Badge variant="warning" size="sm">{t('platformConfig.dirty')}</Badge>}
            {!e.isDefault && (
              <button
                type="button"
                onClick={() => handleReset(e.key)}
                disabled={saving}
                className="inline-flex items-center gap-1 text-[11px] t-text-3 hover:t-text px-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                aria-label={t('platformConfig.resetKey')}
              >
                <RotateCcw className="w-3 h-3" aria-hidden />{t('platformConfig.reset')}
              </button>
            )}
          </div>
        </div>

        {/* routing.provider → <select> spécial */}
        {e.key === 'routing.provider' ? (
          <select
            id={`cfg-input-${e.key}`}
            value={val}
            onChange={ev => handleChange(e.key, ev.target.value)}
            className={inp}
            disabled={saving}
          >
            <option value="haversine">haversine — {t('platformConfig.routingKeyMissing').replace('Clé m', 'Sans API, ligne droite').replace('Key m', 'No API, straight line')}</option>
            <option value="google">google — Google Maps Directions</option>
            <option value="mapbox">mapbox — Mapbox Directions</option>
          </select>
        ) : e.type === 'boolean' ? (
          <select
            id={`cfg-input-${e.key}`}
            value={val}
            onChange={ev => handleChange(e.key, ev.target.value)}
            className={inp} disabled={saving}
          >
            <option value="true">{t('common.yes')}</option>
            <option value="false">{t('common.no')}</option>
          </select>
        ) : (
          <input
            id={`cfg-input-${e.key}`}
            type={e.type === 'number' ? 'number' : 'text'}
            value={val}
            onChange={ev => handleChange(e.key, ev.target.value)}
            className={inp} disabled={saving}
          />
        )}
        <p className="text-[11px] t-text-3">{t(e.help)}</p>
        <p className="text-[11px] t-text-3 font-mono">
          {t('platformConfig.defaultValue')}: {String(e.default)}
        </p>
      </div>
    );
  };

  return (
    <form onSubmit={handleSave} className="p-4 sm:p-6 pb-24 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
            <Settings className="w-5 h-5 text-teal-700 dark:text-teal-300" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold t-text">{t('platformConfig.title')}</h1>
            <p className="text-sm t-text-2">{t('platformConfig.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saveOk && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
              <Check className="w-4 h-4" aria-hidden />{t('platformConfig.saved')}
            </span>
          )}
          <Badge variant="info" size="sm">{dirtyKeys.length} {t('platformConfig.pending')}</Badge>
          <Button type="submit" disabled={saving || dirtyKeys.length === 0}>
            <Save className="w-4 h-4 mr-1.5" aria-hidden />
            {saving ? t('common.saving') : t('platformConfig.saveAll')}
          </Button>
        </div>
      </div>

      {/* Note explicative */}
      <div role="note" className="rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-3 text-xs t-text-2 flex items-start gap-2">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden />
        <p>{t('platformConfig.explain')}</p>
      </div>

      {(error || actionErr) && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />{error ?? actionErr}
        </div>
      )}

      {loading && <p className="text-sm t-text-3">{t('common.loading')}…</p>}

      {/* Groupes auto-générés */}
      {grouped.map(([groupKey, entries]) => (
        <section
          key={groupKey}
          aria-labelledby={`cfg-${groupKey}`}
          className="t-card-bordered rounded-2xl p-5 space-y-4"
        >
          <h2 id={`cfg-${groupKey}`} className="text-sm font-semibold uppercase tracking-wider t-text-2">
            {t(groupKey)}
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {entries.map(e => renderField(e))}
          </div>

          {/* Section clés API Vault — uniquement pour le groupe Routing */}
          {groupKey === ROUTING_GROUP && (
            <RoutingKeysSection onRefreshStatus={refetch} />
          )}
        </section>
      ))}

      {/* Barre d'action sticky — visible UNIQUEMENT quand il y a des modifs
          non sauvegardées. Évite le piège du bouton « Enregistrer » planqué
          tout en haut sur une page longue multi-sections. */}
      {dirtyKeys.length > 0 && (
        <div
          role="region"
          aria-label={t('platformConfig.unsavedBarLabel')}
          className="fixed bottom-0 left-0 right-0 z-40 border-t border-amber-300 bg-amber-50/95 backdrop-blur px-4 py-3 shadow-[0_-4px_10px_-2px_rgba(0,0,0,0.08)] dark:border-amber-900/60 dark:bg-amber-950/80"
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-100">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              <span>{t('platformConfig.unsavedCount').replace('{n}', String(dirtyKeys.length))}</span>
            </div>
            <Button type="submit" disabled={saving} size="sm">
              <Save className="w-4 h-4 mr-1.5" aria-hidden />
              {saving ? t('common.saving') : t('platformConfig.saveAll')}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
