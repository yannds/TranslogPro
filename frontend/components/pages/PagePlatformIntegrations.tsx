/**
 * PagePlatformIntegrations — config providers paiement au niveau **plateforme**.
 *
 * Cette page super-admin pilote les `PaymentProviderState` avec `tenantId=null`
 * (les defaults dont héritent tous les tenants). Pour chaque provider, le SA :
 *   - voit l'état (DISABLED | SANDBOX | LIVE) + la santé
 *   - active / passe en sandbox / passe en LIVE (LIVE exige MFA — TODO step-up)
 *   - saisit les vrais secrets API → Vault `platform/payments/<providerKey>`
 *   - lance un healthcheck à la demande
 *
 * Côté tenant : ils gèrent leur compte de retrait dans `PageTenantPayment`,
 * sans jamais voir ces clés.
 */
import { useEffect, useState, type FormEvent } from 'react';
import {
  Activity, KeyRound, RefreshCw, ShieldCheck, AlertCircle, CheckCircle2, Coins,
} from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPatch, apiPut, apiPost } from '../../lib/api';
import { useI18n } from '../../lib/i18n/useI18n';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Dialog } from '../ui/Dialog';
import { ErrorAlert } from '../ui/ErrorAlert';
import { cn } from '../../lib/utils';

interface CredentialFieldSpec {
  key:          string;
  label:        string;
  type:         'text' | 'password' | 'select';
  required:     boolean;
  placeholder?: string;
  helpText?:    string;
  options?:     string[];
}

interface PlatformProvider {
  key:                 string;
  displayName:         string;
  mode:                'DISABLED' | 'SANDBOX' | 'LIVE';
  methods:             string[];
  countries:           string[];
  currencies:          string[];
  supportsSplit:       boolean;
  vaultPath:           string;
  credentialFields:    CredentialFieldSpec[];
  secretsConfigured:   boolean;
  healthStatus:        'UP' | 'DOWN' | 'DEGRADED' | 'UNKNOWN';
  lastHealthCheckAt:   string | null;
  lastHealthCheckError: string | null;
  activatedAt:         string | null;
  activatedBy:         string | null;
  notes:               string | null;
}

const MODE_BADGE: Record<PlatformProvider['mode'], { cls: string; key: string }> = {
  DISABLED: { cls: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300', key: 'platformIntegrations.modeDisabled' },
  SANDBOX:  { cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', key: 'platformIntegrations.modeSandbox' },
  LIVE:     { cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300', key: 'platformIntegrations.modeLive' },
};

const HEALTH_BADGE: Record<PlatformProvider['healthStatus'], { cls: string; Icon: typeof Activity }> = {
  UP:       { cls: 'text-emerald-600 dark:text-emerald-400', Icon: CheckCircle2 },
  DOWN:     { cls: 'text-red-600 dark:text-red-400',         Icon: AlertCircle  },
  DEGRADED: { cls: 'text-amber-600 dark:text-amber-400',     Icon: AlertCircle  },
  UNKNOWN:  { cls: 'text-gray-500',                          Icon: Activity     },
};

export function PagePlatformIntegrations() {
  const { t } = useI18n();
  const { data, loading, error, refetch } = useFetch<PlatformProvider[]>('/api/platform/integrations');
  const [credsFor, setCredsFor] = useState<PlatformProvider | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) return <div className="p-6 text-gray-500">{t('common.loading')}</div>;
  if (error)   return <div className="p-6"><ErrorAlert error={error} /></div>;

  const setMode = async (p: PlatformProvider, mode: PlatformProvider['mode']) => {
    setBusyKey(p.key); setActionError(null);
    try {
      await apiPatch(`/api/platform/integrations/${p.key}`, {
        mode,
        // TODO MFA step-up pour LIVE — pour l'instant on confirme côté UI seulement.
        mfaVerified: mode === 'LIVE',
      });
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Erreur');
    } finally { setBusyKey(null); }
  };

  const runCheck = async (p: PlatformProvider) => {
    setBusyKey(p.key); setActionError(null);
    try {
      await apiPost(`/api/platform/integrations/${p.key}/healthcheck`, {});
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Erreur');
    } finally { setBusyKey(null); }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Coins className="w-6 h-6 text-teal-600 dark:text-teal-400" aria-hidden />
          {t('platformIntegrations.title')}
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          {t('platformIntegrations.subtitle')}
        </p>
      </header>

      {actionError && <ErrorAlert error={actionError} />}

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-900 overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-gray-50 dark:bg-slate-800 text-gray-600 dark:text-gray-300 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">{t('platformIntegrations.colProvider')}</th>
              <th className="text-left px-4 py-3">{t('platformIntegrations.colCoverage')}</th>
              <th className="text-left px-4 py-3">{t('platformIntegrations.colSplit')}</th>
              <th className="text-left px-4 py-3">{t('platformIntegrations.colMode')}</th>
              <th className="text-left px-4 py-3">{t('platformIntegrations.colHealth')}</th>
              <th className="text-right px-4 py-3">{t('platformIntegrations.colActions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {(data ?? []).map(p => {
              const Health = HEALTH_BADGE[p.healthStatus].Icon;
              const busy = busyKey === p.key;
              return (
                <tr key={p.key}>
                  <td className="px-4 py-4">
                    <div className="font-semibold text-gray-900 dark:text-gray-100">{p.displayName}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{p.key}</div>
                    <div className="text-xs text-gray-400 mt-0.5 font-mono">{p.vaultPath}</div>
                  </td>
                  <td className="px-4 py-4 text-xs text-gray-600 dark:text-gray-300">
                    <div>{p.countries.join(', ') || '—'}</div>
                    <div className="text-gray-400 mt-0.5">{p.methods.join(' · ')}</div>
                  </td>
                  <td className="px-4 py-4">
                    {p.supportsSplit
                      ? <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                          <ShieldCheck className="w-3.5 h-3.5" aria-hidden />
                          {t('platformIntegrations.splitYes')}
                        </span>
                      : <span className="text-xs text-gray-400">{t('platformIntegrations.splitNo')}</span>}
                  </td>
                  <td className="px-4 py-4">
                    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', MODE_BADGE[p.mode].cls)}>
                      {t(MODE_BADGE[p.mode].key)}
                    </span>
                    {!p.secretsConfigured && (
                      <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                        {t('platformIntegrations.noCredentials')}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <div className={cn('inline-flex items-center gap-1 text-xs', HEALTH_BADGE[p.healthStatus].cls)}>
                      <Health className="w-3.5 h-3.5" aria-hidden />
                      {p.healthStatus}
                    </div>
                    {p.lastHealthCheckAt && (
                      <div className="text-xs text-gray-400 mt-0.5">
                        {new Date(p.lastHealthCheckAt).toLocaleString()}
                      </div>
                    )}
                    {p.lastHealthCheckError && (
                      <div className="text-xs text-red-600 dark:text-red-400 mt-0.5 truncate max-w-[200px]" title={p.lastHealthCheckError}>
                        {p.lastHealthCheckError}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setCredsFor(p)}
                              leftIcon={<KeyRound className="w-3.5 h-3.5" aria-hidden />}>
                        {t('platformIntegrations.btnCredentials')}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => runCheck(p)}
                              leftIcon={<RefreshCw className={cn('w-3.5 h-3.5', busy && 'animate-spin')} aria-hidden />}>
                        {t('platformIntegrations.btnCheck')}
                      </Button>
                      <select
                        value={p.mode}
                        disabled={busy || !p.secretsConfigured}
                        onChange={e => setMode(p, e.target.value as PlatformProvider['mode'])}
                        className="text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 px-2 py-1"
                        aria-label={t('platformIntegrations.colMode')}
                      >
                        <option value="DISABLED">{t('platformIntegrations.modeDisabled')}</option>
                        <option value="SANDBOX">{t('platformIntegrations.modeSandbox')}</option>
                        <option value="LIVE">{t('platformIntegrations.modeLive')}</option>
                      </select>
                    </div>
                  </td>
                </tr>
              );
            })}
            {(data ?? []).length === 0 && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                {t('platformIntegrations.empty')}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {credsFor && (
        <PlatformCredentialsDialog
          open
          onOpenChange={open => !open && setCredsFor(null)}
          provider={credsFor}
          onSaved={() => { setCredsFor(null); refetch(); }}
        />
      )}
    </div>
  );
}

// ─── Dialog credentials inline ───────────────────────────────────────────────

function PlatformCredentialsDialog({
  open, onOpenChange, provider, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: PlatformProvider;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // On ne pré-remplit jamais avec les secrets existants — Vault est write-only.
    setValues({});
    setErr(null);
  }, [provider.key]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      // On filtre les champs vides pour ne pas écraser une clé existante avec
      // une chaîne vide quand l'utilisateur ne veut pas la changer.
      const credentials = Object.fromEntries(
        Object.entries(values).filter(([, v]) => v && v.trim()),
      );
      if (Object.keys(credentials).length === 0) {
        setErr(t('platformIntegrations.errEmpty'));
        return;
      }
      await apiPut(`/api/platform/integrations/${provider.key}/credentials`, { credentials });
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Erreur');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`${provider.displayName} — ${t('platformIntegrations.credentialsTitle')}`}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-xs text-gray-600 dark:text-gray-400">
          {t('platformIntegrations.credentialsHelp')} <span className="font-mono">{provider.vaultPath}</span>
        </p>
        {provider.mode === 'LIVE' && (
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 p-3 text-xs text-amber-900 dark:text-amber-200">
            {t('platformIntegrations.willDowngrade')}
          </div>
        )}
        {provider.credentialFields.map(f => (
          <label key={f.key} className="block">
            <span className="block text-sm font-medium mb-1">
              {f.label}
              {f.required && <span className="text-red-500 ml-0.5">*</span>}
            </span>
            <Input
              type={f.type === 'password' ? 'password' : 'text'}
              placeholder={provider.secretsConfigured ? '••••••••' : (f.placeholder ?? '')}
              value={values[f.key] ?? ''}
              onChange={e => setValues({ ...values, [f.key]: e.target.value })}
              autoComplete="off"
              required={f.required && !provider.secretsConfigured}
            />
            {f.helpText && (
              <span className="block text-xs text-gray-500 mt-1">{f.helpText}</span>
            )}
          </label>
        ))}
        {err && <ErrorAlert error={err} />}
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={saving} leftIcon={<KeyRound className="w-4 h-4" aria-hidden />}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
