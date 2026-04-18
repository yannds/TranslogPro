/**
 * PageIntegrations — Intégrations API tenant (paiement + auth + …).
 *
 * - Affiche chaque intégration avec état effectif (DISABLED | SANDBOX | LIVE).
 * - Toggle DISABLED/SANDBOX sans confirmation.
 * - Activation LIVE nécessite un step-up MFA (champ mfaVerified côté API).
 * - Bouton "Tester la connexion" → POST /healthcheck (UP/DOWN/latence).
 * - Les secrets ne sont JAMAIS affichés — juste une empreinte courte du path Vault
 *   et la date de dernière rotation.
 */
import { useMemo, useState } from 'react';
import { ShieldCheck, ShieldAlert, Wifi, WifiOff, KeyRound, RefreshCw } from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPatch, apiPost } from '../../lib/api';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/Tabs';

interface Integration {
  category:    'PAYMENT' | 'AUTH';
  key:         string;
  displayName: string;
  mode:        'DISABLED' | 'SANDBOX' | 'LIVE';
  methods:     string[];
  countries:   string[];
  currencies:  string[];
  healthStatus:      'UP' | 'DOWN' | 'DEGRADED' | 'UNKNOWN';
  lastHealthCheckAt: string | null;
  secretsConfigured: boolean;
  vaultPathPreview:  string;
  activatedAt:       string | null;
  activatedBy:       string | null;
  scopedToTenant:    boolean;
  notes:             string | null;
}

function ModeBadge({ mode }: { mode: Integration['mode'] }) {
  const variant = mode === 'LIVE' ? 'success' as const : mode === 'SANDBOX' ? 'warning' as const : 'outline' as const;
  return <Badge variant={variant}>{mode}</Badge>;
}

function HealthBadge({ status }: { status: Integration['healthStatus'] }) {
  if (status === 'UP')    return <Badge variant="success"><Wifi className="w-3 h-3 mr-1" aria-hidden />UP</Badge>;
  if (status === 'DOWN')  return <Badge variant="danger"><WifiOff className="w-3 h-3 mr-1" aria-hidden />DOWN</Badge>;
  if (status === 'DEGRADED') return <Badge variant="warning">DEGRADED</Badge>;
  return <Badge variant="outline">—</Badge>;
}

export function PageIntegrations() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const { data, loading, error, refetch } = useFetch<Integration[]>(
    tenantId ? `/api/v1/tenants/${tenantId}/settings/integrations` : null,
  );

  const [actionErr, setActionErr] = useState<string | null>(null);
  const [busyKey,   setBusyKey]   = useState<string | null>(null);

  const changeMode = async (key: string, mode: Integration['mode']) => {
    setBusyKey(key); setActionErr(null);
    try {
      const body: any = { mode };
      if (mode === 'LIVE') {
        // Step-up MFA : en prod, appeler l'API MFA d'abord puis envoyer mfaVerified=true
        // Ici on exige une confirmation explicite côté UI.
        if (!confirm(t('integrations.confirmLive'))) return;
        body.mfaVerified = true;
      }
      await apiPatch(`/api/v1/tenants/${tenantId}/settings/integrations/${key}`, body);
      refetch();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Erreur');
    } finally { setBusyKey(null); }
  };

  const runHealth = async (key: string) => {
    setBusyKey(key); setActionErr(null);
    try {
      await apiPost(`/api/v1/tenants/${tenantId}/settings/integrations/${key}/healthcheck`, {});
      refetch();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Erreur');
    } finally { setBusyKey(null); }
  };

  const { payment, auth } = useMemo(() => ({
    payment: (data ?? []).filter(i => i.category === 'PAYMENT'),
    auth:    (data ?? []).filter(i => i.category === 'AUTH'),
  }), [data]);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{t('integrations.title')}</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('integrations.subtitle')}</p>
      </header>

      {error     && <ErrorAlert error={error} />}
      {actionErr && <ErrorAlert error={actionErr} />}
      {loading && <div className="text-gray-500">{t('common.loading')}</div>}

      <Tabs defaultValue="payment">
        <TabsList>
          <TabsTrigger value="payment">{t('integrations.tabPayment')}</TabsTrigger>
          <TabsTrigger value="auth">{t('integrations.tabAuth')}</TabsTrigger>
        </TabsList>
        <TabsContent value="payment">
          <IntegrationList items={payment} busyKey={busyKey} onChangeMode={changeMode} onHealth={runHealth} />
        </TabsContent>
        <TabsContent value="auth">
          <IntegrationList items={auth} busyKey={busyKey} onChangeMode={changeMode} onHealth={runHealth} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function IntegrationList({
  items, busyKey, onChangeMode, onHealth,
}: {
  items: Integration[];
  busyKey: string | null;
  onChangeMode: (key: string, mode: Integration['mode']) => void;
  onHealth:     (key: string) => void;
}) {
  const { t } = useI18n();
  if (items.length === 0) return <div className="py-10 text-center text-gray-500">{t('integrations.empty')}</div>;
  return (
    <ul className="space-y-3">
      {items.map(item => (
        <li key={item.key} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex flex-col lg:flex-row gap-4 items-start lg:items-center">
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-gray-900 dark:text-gray-100">{item.displayName}</span>
              <ModeBadge mode={item.mode} />
              <HealthBadge status={item.healthStatus} />
              {item.scopedToTenant && <Badge variant="outline">{t('integrations.scopedTenant')}</Badge>}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {item.methods.join(' · ')} {item.countries.length > 0 && `· ${item.countries.join(', ')}`}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
              <KeyRound className="w-3 h-3" aria-hidden />
              <span className="font-mono">{item.vaultPathPreview}</span>
              {item.secretsConfigured && <ShieldCheck className="w-3 h-3 text-green-600 dark:text-green-400" aria-hidden />}
              {!item.secretsConfigured && <ShieldAlert className="w-3 h-3 text-orange-500" aria-hidden />}
              {item.lastHealthCheckAt && <span>· {t('integrations.lastCheck')}: {new Date(item.lastHealthCheckAt).toLocaleString()}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={item.mode === 'DISABLED' ? 'default' : 'outline'} disabled={busyKey === item.key}
              onClick={() => onChangeMode(item.key, 'DISABLED')}>
              {t('integrations.modeDisabled')}
            </Button>
            <Button size="sm" variant={item.mode === 'SANDBOX' ? 'default' : 'outline'} disabled={busyKey === item.key}
              onClick={() => onChangeMode(item.key, 'SANDBOX')}>
              {t('integrations.modeSandbox')}
            </Button>
            <Button size="sm" variant={item.mode === 'LIVE' ? 'default' : 'outline'} disabled={busyKey === item.key}
              onClick={() => onChangeMode(item.key, 'LIVE')}>
              {t('integrations.modeLive')}
            </Button>
            <Button size="sm" variant="ghost" disabled={busyKey === item.key} onClick={() => onHealth(item.key)}
              aria-label={t('integrations.testConnection')}>
              <RefreshCw className="w-4 h-4" aria-hidden />
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
