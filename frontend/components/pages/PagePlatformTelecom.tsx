/**
 * PagePlatformTelecom — Vue admin plateforme des providers SMS / WhatsApp.
 *
 * Symétrique à PagePlatformEmail. Aujourd'hui 2 providers : Twilio SMS +
 * Twilio WhatsApp. Bouton Configurer (formulaire dynamique) + Tester
 * (healthcheck Vault + appel API Twilio /Accounts/{sid}.json).
 *
 * Permission : `control.platform.config.manage.global`.
 */

import { useState } from 'react';
import {
  MessageSquare, CheckCircle2, XCircle, Wifi, WifiOff, Loader2, RefreshCw,
  ShieldCheck, ShieldAlert, Settings,
} from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPost } from '../../lib/api';
import { useI18n } from '../../lib/i18n/useI18n';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { TelecomProviderConfigDialog, type ProviderField } from './platform-telecom/TelecomProviderConfigDialog';

type ProviderKey = 'sms' | 'whatsapp';

interface TelecomProviderItem {
  key:                  ProviderKey;
  displayName:          string;
  vaultPath:            string;
  healthStatus:         'UP' | 'DOWN' | 'DEGRADED' | 'UNKNOWN';
  lastHealthCheckAt:    string | null;
  lastHealthCheckError: string | null;
  fields:               ReadonlyArray<ProviderField>;
  configured:           boolean;
}

function HealthBadge({ status }: { status: TelecomProviderItem['healthStatus'] }) {
  if (status === 'UP')        return <Badge variant="success"><Wifi className="w-3 h-3 mr-1" aria-hidden />UP</Badge>;
  if (status === 'DOWN')      return <Badge variant="danger"><WifiOff className="w-3 h-3 mr-1" aria-hidden />DOWN</Badge>;
  if (status === 'DEGRADED')  return <Badge variant="warning">DEGRADED</Badge>;
  return <Badge variant="outline">—</Badge>;
}

export function PagePlatformTelecom() {
  const { t } = useI18n();
  const { data, loading, error, refetch } = useFetch<TelecomProviderItem[]>(
    '/api/platform/telecom/providers',
  );

  const [busyKey, setBusyKey]     = useState<ProviderKey | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [lastMsg, setLastMsg]     = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [configKey, setConfigKey] = useState<ProviderKey | null>(null);

  async function runHealth(key: ProviderKey) {
    setBusyKey(key); setActionErr(null); setLastMsg(null);
    try {
      const res = await apiPost<{ ok: boolean; status: string; detail?: string }>(
        `/api/platform/telecom/providers/${key}/healthcheck`,
        {},
      );
      setLastMsg({
        kind: res.ok ? 'ok' : 'err',
        text: res.ok
          ? t('platformTelecom.healthcheckOk')
          : `${t('platformTelecom.healthcheckFailed')}${res.detail ? ` — ${res.detail}` : ''}`,
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
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
          <MessageSquare className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t('platformTelecom.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('platformTelecom.subtitle')}</p>
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
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">{t('platformTelecom.providersTitle')}</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('platformTelecom.providersHint')}</p>
      </section>

      {loading && <div className="text-slate-500">{t('common.loading')}</div>}

      <ul className="space-y-3">
        {(data ?? []).map(p => (
          <li
            key={p.key}
            className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 flex flex-col lg:flex-row gap-4 items-start lg:items-center"
          >
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-slate-900 dark:text-slate-100">{p.displayName}</span>
                <HealthBadge status={p.healthStatus} />
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
                {p.configured
                  ? <ShieldCheck className="w-3 h-3 text-green-600 dark:text-green-400" aria-hidden />
                  : <ShieldAlert className="w-3 h-3 text-amber-500" aria-hidden />}
                <span className="font-mono">{p.vaultPath}</span>
                {!p.configured && (
                  <span className="italic text-amber-600 dark:text-amber-400">
                    {t('platformTelecom.notConfigured')}
                  </span>
                )}
                {p.lastHealthCheckAt && (
                  <span>· {t('platformTelecom.lastCheck')}: {new Date(p.lastHealthCheckAt).toLocaleString()}</span>
                )}
              </div>
              {p.lastHealthCheckError && p.healthStatus !== 'UP' && (
                <p className="text-xs text-red-700 dark:text-red-400 italic">{p.lastHealthCheckError}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfigKey(p.key)}
              >
                <Settings className="w-4 h-4 mr-1.5" aria-hidden />
                {t('platformTelecom.configure')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busyKey === p.key}
                onClick={() => runHealth(p.key)}
              >
                {busyKey === p.key
                  ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden />
                  : <RefreshCw className="w-4 h-4 mr-1.5" aria-hidden />}
                {t('platformTelecom.test')}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {configKey && (() => {
        const p = (data ?? []).find(x => x.key === configKey);
        if (!p) return null;
        return (
          <TelecomProviderConfigDialog
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
    </div>
  );
}

export default PagePlatformTelecom;
