/**
 * PagePlatformEmail — Vue admin plateforme des 4 providers email.
 *
 * Read-only sur le choix du provider actif (piloté par la variable d'env
 * `EMAIL_PROVIDER` + redéploiement). Expose un bouton "Tester" par provider
 * qui déclenche un healthcheck (connexion + credentials Vault) et persiste
 * le résultat dans `email_provider_states`.
 *
 * Permission : `control.platform.config.manage.global`.
 */

import { useState } from 'react';
import {
  Mail, CheckCircle2, XCircle, Wifi, WifiOff, Loader2, RefreshCw,
  ShieldCheck, ShieldAlert, Settings, Send,
} from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPost } from '../../lib/api';
import { useI18n } from '../../lib/i18n/useI18n';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { EmailProviderConfigDialog, type ProviderField } from './platform-email/EmailProviderConfigDialog';
import { SendTestEmailDialog } from './platform-email/SendTestEmailDialog';

type ProviderKey = 'console' | 'smtp' | 'resend' | 'o365';

interface EmailProviderItem {
  key:                  ProviderKey;
  displayName:          string;
  vaultPath:            string | null;
  isActive:             boolean;
  healthStatus:         'UP' | 'DOWN' | 'DEGRADED' | 'UNKNOWN';
  lastHealthCheckAt:    string | null;
  lastHealthCheckError: string | null;
  fields:               ReadonlyArray<ProviderField>;
  configured:           boolean;
}

function HealthBadge({ status }: { status: EmailProviderItem['healthStatus'] }) {
  if (status === 'UP')        return <Badge variant="success"><Wifi className="w-3 h-3 mr-1" aria-hidden />UP</Badge>;
  if (status === 'DOWN')      return <Badge variant="danger"><WifiOff className="w-3 h-3 mr-1" aria-hidden />DOWN</Badge>;
  if (status === 'DEGRADED')  return <Badge variant="warning">DEGRADED</Badge>;
  return <Badge variant="outline">—</Badge>;
}

export function PagePlatformEmail() {
  const { t } = useI18n();
  const { data, loading, error, refetch } = useFetch<EmailProviderItem[]>(
    '/api/platform/email/providers',
  );

  const [busyKey, setBusyKey]     = useState<ProviderKey | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [lastMsg, setLastMsg]     = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [configKey, setConfigKey] = useState<ProviderKey | null>(null);
  const [testKey, setTestKey]     = useState<ProviderKey | null>(null);

  async function runHealth(key: ProviderKey) {
    setBusyKey(key); setActionErr(null); setLastMsg(null);
    try {
      const res = await apiPost<{ ok: boolean; status: string; detail?: string }>(
        `/api/platform/email/providers/${key}/healthcheck`,
        {},
      );
      setLastMsg({
        kind: res.ok ? 'ok' : 'err',
        text: res.ok
          ? t('platformEmail.healthcheckOk')
          : `${t('platformEmail.healthcheckFailed')}${res.detail ? ` — ${res.detail}` : ''}`,
      });
      refetch();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <header className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-400">
          <Mail className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t('platformEmail.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('platformEmail.subtitle')}</p>
        </div>
      </header>

      <ErrorAlert error={error} />
      <ErrorAlert error={actionErr} />
      {lastMsg && (
        <div
          role="alert"
          className={cn(
            'flex items-start gap-2 rounded-md border p-3 text-sm',
            lastMsg.kind === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
              : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200',
          )}
        >
          {lastMsg.kind === 'ok'
            ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            : <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          <span>{lastMsg.text}</span>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">{t('platformEmail.activeProvider')}</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('platformEmail.activeProviderHint')}
        </p>
      </section>

      {loading && <div className="text-slate-500">{t('common.loading')}</div>}

      <ul className="space-y-3">
        {(data ?? []).map(p => (
          <li
            key={p.key}
            className={cn(
              'border rounded-lg p-4 flex flex-col lg:flex-row gap-4 items-start lg:items-center',
              p.isActive
                ? 'border-sky-300 bg-sky-50/50 dark:border-sky-800 dark:bg-sky-950/30'
                : 'border-slate-200 dark:border-slate-700',
            )}
          >
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-slate-900 dark:text-slate-100">{p.displayName}</span>
                {p.isActive && <Badge variant="info">{t('platformEmail.activeBadge')}</Badge>}
                <HealthBadge status={p.healthStatus} />
              </div>
              {p.vaultPath ? (
                <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
                  {p.configured
                    ? <ShieldCheck className="w-3 h-3 text-green-600 dark:text-green-400" aria-hidden />
                    : <ShieldAlert className="w-3 h-3 text-amber-500" aria-hidden />}
                  <span className="font-mono">{p.vaultPath}</span>
                  {!p.configured && (
                    <span className="italic text-amber-600 dark:text-amber-400">
                      {t('platformEmail.notConfigured')}
                    </span>
                  )}
                  {p.lastHealthCheckAt && (
                    <span>· {t('platformEmail.lastCheck')}: {new Date(p.lastHealthCheckAt).toLocaleString()}</span>
                  )}
                </div>
              ) : (
                <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <ShieldAlert className="w-3 h-3 text-amber-500" aria-hidden />
                  <span className="italic">{t('platformEmail.consoleNoSecret')}</span>
                </div>
              )}
              {p.lastHealthCheckError && p.healthStatus !== 'UP' && (
                <p className="text-xs text-red-700 dark:text-red-400 italic">
                  {p.lastHealthCheckError}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {p.vaultPath && p.fields.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfigKey(p.key)}
                >
                  <Settings className="w-4 h-4 mr-1.5" aria-hidden />
                  {t('platformEmail.configure')}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={busyKey === p.key}
                onClick={() => runHealth(p.key)}
              >
                {busyKey === p.key
                  ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden />
                  : <RefreshCw className="w-4 h-4 mr-1.5" aria-hidden />}
                {t('platformEmail.test')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTestKey(p.key)}
              >
                <Send className="w-4 h-4 mr-1.5" aria-hidden />
                {t('platformEmail.testWithTemplate')}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {configKey && (() => {
        const p = (data ?? []).find(x => x.key === configKey);
        if (!p || !p.vaultPath) return null;
        return (
          <EmailProviderConfigDialog
            providerKey={p.key}
            providerName={p.displayName}
            vaultPath={p.vaultPath}
            fields={p.fields}
            open={true}
            onClose={() => setConfigKey(null)}
            onSaved={refetch}
          />
        );
      })()}

      {testKey && (() => {
        const p = (data ?? []).find(x => x.key === testKey);
        if (!p) return null;
        return (
          <SendTestEmailDialog
            providerKey={p.key}
            providerName={p.displayName}
            open={true}
            onClose={() => setTestKey(null)}
          />
        );
      })()}
    </div>
  );
}

export default PagePlatformEmail;
