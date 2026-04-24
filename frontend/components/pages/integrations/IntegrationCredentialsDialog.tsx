/**
 * IntegrationCredentialsDialog — formulaire BYO-credentials par provider paiement.
 *
 * Flux :
 *   1. Ouverture : GET /schema → chargement des champs spécifiques au provider
 *   2. Saisie : champs text / password / select selon le schéma
 *   3. Soumission : PUT /credentials { credentials: { KEY: val, ... } } → Vault tenant-scoped
 *   4. Succès : onSaved() → PageIntegrations refetch
 *
 * Règles :
 *   - Les valeurs ne sont JAMAIS relues depuis l'API (elles restent dans Vault).
 *   - Les champs password affichent un placeholder masqué si des creds existent déjà.
 *   - Alerte "mode LIVE → SANDBOX" si l'item est actuellement en production.
 *   - WCAG AA : labels liés, aria-describedby pour les helpText, focus visible.
 *   - i18n : fr + en. Les 6 autres locales sont en TODO (docs/TODO_i18n_propagation.md).
 */
import { useEffect, useState } from 'react';
import { ShieldAlert, Info } from 'lucide-react';
import { useFetch } from '../../../lib/hooks/useFetch';
import { apiPut } from '../../../lib/api';
import { useI18n } from '../../../lib/i18n/useI18n';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { FormFooter } from '../../ui/FormFooter';
import { ErrorAlert } from '../../ui/ErrorAlert';
import { inputClass } from '../../ui/inputClass';

export interface CredentialFieldSpec {
  key:          string;
  label:        string;
  type:         'text' | 'password' | 'select';
  required:     boolean;
  placeholder?: string;
  helpText?:    string;
  options?:     string[];
}

interface SchemaResponse {
  providerKey: string;
  fields:      CredentialFieldSpec[];
}

interface Props {
  open:         boolean;
  onOpenChange: (open: boolean) => void;
  tenantId:     string;
  providerKey:  string;
  displayName:  string;
  /** true si des credentials tenant existent déjà (scopedToTenant) */
  hasExisting:  boolean;
  /** true si le provider est actuellement en mode LIVE */
  isLive:       boolean;
  onSaved:      () => void;
}

export function IntegrationCredentialsDialog({
  open, onOpenChange, tenantId, providerKey, displayName,
  hasExisting, isLive, onSaved,
}: Props) {
  const { t } = useI18n();

  const { data: schema, loading: schemaLoading, error: schemaError } = useFetch<SchemaResponse>(
    open ? `/api/tenants/${tenantId}/settings/integrations/${providerKey}/schema` : null,
  );

  const [values,  setValues]  = useState<Record<string, string>>({});
  const [busy,    setBusy]    = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  useEffect(() => {
    if (schema) setValues({});
  }, [schema]);

  const handleChange = (key: string, value: string) =>
    setValues(prev => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setSaveErr(null);
    try {
      await apiPut(`/api/tenants/${tenantId}/settings/integrations/${providerKey}/credentials`, {
        credentials: values,
      });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('integrations.credentials.title', { provider: displayName })}
      description={t('integrations.credentials.subtitle')}
      size="lg"
      footer={
        <FormFooter
          onCancel={() => onOpenChange(false)}
          busy={busy}
          submitLabel={t('integrations.credentials.save')}
          pendingLabel={t('integrations.credentials.saving')}
          formId="creds-form"
        />
      }
    >
      {/* Alerte de rétrogradation LIVE → SANDBOX */}
      {isLive && (
        <div role="alert" className="mb-4 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 p-3 text-sm text-amber-800 dark:text-amber-300">
          <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          <span>{t('integrations.credentials.liveWarning')}</span>
        </div>
      )}

      {/* Notice sécurité Vault */}
      <div className="mb-5 flex gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-3 text-xs text-slate-600 dark:text-slate-400">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
        <span>{t('integrations.credentials.vaultNotice')}</span>
      </div>

      {schemaLoading && <div className="py-4 text-center text-sm text-slate-500">{t('common.loading')}</div>}
      {schemaError   && <ErrorAlert error={schemaError} />}
      {saveErr       && <ErrorAlert error={saveErr} />}

      {schema && (
        <form id="creds-form" onSubmit={handleSubmit} className="space-y-4" aria-label={t('integrations.credentials.formLabel', { provider: displayName })}>
          {schema.fields.map(field => {
            const inputId  = `cred-${field.key}`;
            const helpId   = field.helpText ? `help-${field.key}` : undefined;

            return (
              <div key={field.key} className="space-y-1">
                <label htmlFor={inputId} className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  {field.label}
                  {field.required && <span className="ml-1 text-red-500" aria-hidden>*</span>}
                </label>

                {field.type === 'select' ? (
                  <select
                    id={inputId}
                    className={inputClass}
                    value={values[field.key] ?? ''}
                    onChange={e => handleChange(field.key, e.target.value)}
                    required={field.required}
                    aria-describedby={helpId}
                    aria-required={field.required}
                  >
                    <option value="">{t('common.selectPlaceholder')}</option>
                    {field.options?.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={inputId}
                    type={field.type}
                    className={inputClass}
                    value={values[field.key] ?? ''}
                    onChange={e => handleChange(field.key, e.target.value)}
                    placeholder={
                      hasExisting && field.type === 'password'
                        ? t('integrations.credentials.existingPlaceholder')
                        : field.placeholder
                    }
                    required={field.required}
                    autoComplete={field.type === 'password' ? 'new-password' : 'off'}
                    aria-describedby={helpId}
                    aria-required={field.required}
                  />
                )}

                {field.helpText && (
                  <p id={helpId} className="text-xs text-slate-500 dark:text-slate-400">{field.helpText}</p>
                )}
              </div>
            );
          })}
        </form>
      )}
    </Dialog>
  );
}
