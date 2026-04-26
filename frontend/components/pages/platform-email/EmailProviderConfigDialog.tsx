/**
 * EmailProviderConfigDialog — formulaire dynamique de configuration d'un
 * provider email côté admin plateforme.
 *
 * Le schéma des champs (label, required, secret, type, hint) vient du backend
 * via `GET /platform/email/providers` → champ `fields[]`. L'UI génère le
 * formulaire en conséquence — pas de couplage en dur côté FE entre un provider
 * et ses champs.
 *
 * Comportement :
 *   - Open → GET /providers/:key/credentials (secrets masqués `••••••••`)
 *   - Save → PUT /providers/:key/credentials (re-déclenche un healthcheck)
 *   - Si le user laisse un champ secret avec la valeur masquée, le BE conserve
 *     l'ancien secret (no-op sur ce champ).
 */
import { useEffect, useState } from 'react';
import { Loader2, Save, ShieldCheck } from 'lucide-react';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { ErrorAlert } from '../../ui/ErrorAlert';
import { apiGet, apiPut } from '../../../lib/api';
import { useI18n } from '../../../lib/i18n/useI18n';

export interface ProviderField {
  key:        string;
  label:      string;
  secret?:    boolean;
  required?:  boolean;
  type?:      'text' | 'email' | 'password' | 'number' | 'boolean';
  hint?:      string;
}

interface Props {
  providerKey:  string;
  providerName: string;
  vaultPath:    string | null;
  fields:       ReadonlyArray<ProviderField>;
  open:         boolean;
  onClose:      () => void;
  /** Appelé après save réussie pour rafraîchir la liste parente. */
  onSaved:      () => void;
}

export function EmailProviderConfigDialog({
  providerKey, providerName, vaultPath, fields, open, onClose, onSaved,
}: Props) {
  const { t } = useI18n();
  const [values,  setValues]  = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [result,  setResult]  = useState<{ ok: boolean; detail?: string } | null>(null);

  // Charge les valeurs courantes (secrets masqués) à l'ouverture.
  useEffect(() => {
    if (!open) return;
    setError(null); setResult(null);
    setLoading(true);
    apiGet<Record<string, string>>(`/api/platform/email/providers/${providerKey}/credentials`)
      .then(data => setValues(data ?? {}))
      .catch(e => setError(e instanceof Error ? e.message : 'Error'))
      .finally(() => setLoading(false));
  }, [open, providerKey]);

  function setField(key: string, value: string) {
    setValues(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true); setError(null); setResult(null);
    try {
      const res = await apiPut<{ ok: boolean; status: string; detail?: string }>(
        `/api/platform/email/providers/${providerKey}/credentials`,
        values,
      );
      setResult({ ok: res.ok, detail: res.detail });
      if (res.ok) {
        onSaved();
        // Laisse 800ms au user pour lire "OK" avant fermeture.
        setTimeout(onClose, 800);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      size="lg"
      title={`${t('platformEmail.configureTitle')} — ${providerName}`}
      description={vaultPath
        ? `${t('platformEmail.vaultPath')} : ${vaultPath}`
        : undefined}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving
              ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden />
              : <Save className="w-4 h-4 mr-1.5" aria-hidden />}
            {t('platformEmail.saveAndTest')}
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 py-8">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          {t('common.loading')}
        </div>
      ) : (
        <div className="space-y-4">
          <ErrorAlert error={error} />

          {result && (
            <div
              role="alert"
              className={
                'rounded-md border p-3 text-sm ' +
                (result.ok
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                  : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200')
              }
            >
              {result.ok
                ? t('platformEmail.savedAndHealthy')
                : `${t('platformEmail.savedHealthFailed')}${result.detail ? ` — ${result.detail}` : ''}`}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {fields.map(f => {
              const value = values[f.key] ?? '';
              const inputType = f.secret
                ? 'password'
                : f.type === 'email'    ? 'email'
                : f.type === 'number'   ? 'number'
                : f.type === 'password' ? 'password'
                : 'text';

              if (f.type === 'boolean') {
                return (
                  <label
                    key={f.key}
                    className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 md:col-span-1"
                  >
                    <input
                      type="checkbox"
                      checked={value === 'true'}
                      onChange={(e) => setField(f.key, e.target.checked ? 'true' : 'false')}
                      className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    <span className="font-medium">{f.label}</span>
                    {f.hint && <span className="text-xs text-slate-500">— {f.hint}</span>}
                  </label>
                );
              }

              return (
                <div key={f.key} className={f.key.includes('SECRET') || f.key.includes('PASS') || f.key.includes('KEY') ? 'md:col-span-2' : ''}>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                    {f.label}
                    {f.required && <span className="text-red-500 ml-0.5">*</span>}
                    {f.secret && (
                      <ShieldCheck className="inline-block w-3 h-3 ml-1 text-emerald-600 dark:text-emerald-400" aria-label="secret" />
                    )}
                  </label>
                  <Input
                    type={inputType}
                    value={value}
                    onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={f.hint}
                    autoComplete={f.secret ? 'new-password' : 'off'}
                  />
                  {f.hint && !f.secret && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{f.hint}</p>
                  )}
                </div>
              );
            })}
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400 italic">
            {t('platformEmail.secretHint')}
          </p>
        </div>
      )}
    </Dialog>
  );
}
