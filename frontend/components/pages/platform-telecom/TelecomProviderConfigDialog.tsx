/**
 * TelecomProviderConfigDialog — formulaire de config d'un provider SMS/WhatsApp.
 *
 * Identique à EmailProviderConfigDialog (même pattern) — formulaire dynamique
 * généré depuis `fields[]` retourné par l'API. Champs `secret: true` masqués
 * par `••••••••` ; si laissé masqué côté client, le BE conserve l'ancienne
 * valeur (round-trip non destructif).
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
  vaultPath:    string;
  fields:       ReadonlyArray<ProviderField>;
  open:         boolean;
  onClose:      () => void;
  onSaved:      () => void;
}

export function TelecomProviderConfigDialog({
  providerKey, providerName, vaultPath, fields, open, onClose, onSaved,
}: Props) {
  const { t } = useI18n();
  const [values,  setValues]  = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [result,  setResult]  = useState<{ ok: boolean; detail?: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null); setResult(null);
    setLoading(true);
    apiGet<Record<string, string>>(`/api/platform/telecom/providers/${providerKey}/credentials`)
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
        `/api/platform/telecom/providers/${providerKey}/credentials`,
        values,
      );
      setResult({ ok: res.ok, detail: res.detail });
      if (res.ok) {
        onSaved();
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
      title={`${t('platformTelecom.configureTitle')} — ${providerName}`}
      description={`${t('platformTelecom.vaultPath')} : ${vaultPath}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving
              ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden />
              : <Save className="w-4 h-4 mr-1.5" aria-hidden />}
            {t('platformTelecom.saveAndTest')}
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
                ? t('platformTelecom.savedAndHealthy')
                : `${t('platformTelecom.savedHealthFailed')}${result.detail ? ` — ${result.detail}` : ''}`}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {fields.map(f => {
              const value = values[f.key] ?? '';
              const inputType = f.secret ? 'password' : (f.type ?? 'text');
              return (
                <div key={f.key} className={f.key.includes('TOKEN') || f.key.includes('SECRET') ? 'md:col-span-2' : ''}>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                    {f.label}
                    {f.required && <span className="text-red-500 ml-0.5">*</span>}
                    {f.secret && (
                      <ShieldCheck className="inline-block w-3 h-3 ml-1 text-emerald-600 dark:text-emerald-400" aria-label="secret" />
                    )}
                  </label>
                  <Input
                    type={inputType as any}
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
            {t('platformTelecom.secretHint')}
          </p>
        </div>
      )}
    </Dialog>
  );
}
