/**
 * PagePlatformSettings — édition des paramètres plateforme (SUPER_ADMIN).
 *
 * Le backend expose le registre des clés connues (label, type, default,
 * validate) enrichi des valeurs courantes. Le formulaire est auto-généré
 * depuis ce registre : ajouter une clé backend = elle apparaît ici sans
 * changer le code frontend.
 *
 * Endpoints :
 *   GET    /api/platform/config
 *   PATCH  /api/platform/config             { entries: [{ key, value }, …] }
 *   DELETE /api/platform/config/:key        (reset à la valeur par défaut)
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Settings, Save, RotateCcw, AlertTriangle, Check, Info,
} from 'lucide-react';
import { useFetch }                        from '../../lib/hooks/useFetch';
import { apiPatch, apiDelete }              from '../../lib/api';
import { useI18n }                          from '../../lib/i18n/useI18n';
import { Button }                          from '../ui/Button';
import { Badge }                           from '../ui/Badge';

// ─── Types (alignés sur PlatformConfigDef backend) ──────────────────────────

interface ConfigEntry {
  key:       string;
  type:      'number' | 'boolean' | 'string';
  default:   unknown;
  label:     string; // i18n key
  help:      string; // i18n key
  group:     string; // i18n key
  current:   unknown;
  isDefault: boolean;
}

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

// ─── Composant principal ─────────────────────────────────────────────────────

export function PagePlatformSettings() {
  const { t } = useI18n();

  const { data, loading, error, refetch } = useFetch<ConfigEntry[]>('/api/platform/config');

  // draft local : key → valeur en cours d'édition (string pour faciliter le <input>)
  const [draft,      setDraft]      = useState<Record<string, string>>({});
  const [saving,     setSaving]     = useState(false);
  const [saveOk,     setSaveOk]     = useState(false);
  const [actionErr,  setActionErr]  = useState<string | null>(null);

  // Quand les données arrivent, on initialise le draft avec les valeurs courantes.
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

  return (
    <form onSubmit={handleSave} className="p-4 sm:p-6 space-y-6">
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

      {loading && (
        <p className="text-sm t-text-3">{t('common.loading')}…</p>
      )}

      {/* Groupes */}
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
            {entries.map(e => {
              const val = draft[e.key] ?? '';
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
                  {e.type === 'boolean' ? (
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
            })}
          </div>
        </section>
      ))}
    </form>
  );
}
