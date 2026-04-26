/**
 * SendTestEmailDialog — modale de test d'envoi de mail réel.
 *
 * Permet à l'admin plateforme de :
 *   1. Charger le catalogue des templates depuis GET /platform/email/templates
 *   2. Sélectionner un template via combobox (regroupé par groupe)
 *   3. Saisir email + nom du destinataire + langue (fr/en)
 *   4. Envoyer via POST /platform/email/providers/:key/send-test
 *   5. Voir le résultat (succès messageId ou erreur detail)
 *
 * Multi-canal côté plateforme : EMAIL only, le test cible le provider
 * spécifié (peut être différent du provider actif EMAIL_PROVIDER).
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Mail, Send, CheckCircle2, XCircle } from 'lucide-react';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Select } from '../../ui/Select';
import { Badge } from '../../ui/Badge';
import { ErrorAlert } from '../../ui/ErrorAlert';
import { apiGet, apiPost } from '../../../lib/api';
import { useI18n } from '../../../lib/i18n/useI18n';

interface TemplateDescriptor {
  id:               string;
  group:            string;
  labelFr:          string;
  labelEn:          string;
  descriptionFr:    string;
  descriptionEn:    string;
  sampleVars:       Record<string, string>;
  recipientNameVar: string;
}

interface SendResult {
  ok:         boolean;
  messageId?: string;
  provider?:  string;
  detail?:    string;
}

interface Props {
  providerKey:  string;
  providerName: string;
  open:         boolean;
  onClose:      () => void;
}

export function SendTestEmailDialog({ providerKey, providerName, open, onClose }: Props) {
  const { t, lang: currentLang } = useI18n();
  const [templates, setTemplates]  = useState<TemplateDescriptor[]>([]);
  const [loading, setLoading]      = useState(false);
  const [sending, setSending]      = useState(false);
  const [error, setError]          = useState<string | null>(null);
  const [result, setResult]        = useState<SendResult | null>(null);

  // Form state
  const [templateId, setTemplateId] = useState('');
  const [toEmail, setToEmail]       = useState('');
  const [toName, setToName]         = useState('');
  const [lang, setLang]             = useState<'fr' | 'en'>('fr');

  // Charge le catalogue à l'ouverture
  useEffect(() => {
    if (!open) return;
    setError(null); setResult(null);
    setLoading(true);
    apiGet<TemplateDescriptor[]>('/api/platform/email/templates')
      .then(data => {
        setTemplates(data ?? []);
        if (data?.[0] && !templateId) setTemplateId(data[0].id);
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Error'))
      .finally(() => setLoading(false));
  }, [open]);

  // Locale par défaut depuis l'i18n du user
  useEffect(() => {
    if (open) setLang(currentLang === 'en' ? 'en' : 'fr');
  }, [open, currentLang]);

  // Options groupées (group → templates) pour la combobox
  const options = useMemo(() => {
    return templates.map(t => ({
      value: t.id,
      label: `[${t.group}] ${lang === 'en' ? t.labelEn : t.labelFr}`,
    }));
  }, [templates, lang]);

  const selected = useMemo(
    () => templates.find(t => t.id === templateId),
    [templates, templateId],
  );

  async function handleSend() {
    if (!toEmail || !toName || !templateId) return;
    setSending(true); setError(null); setResult(null);
    try {
      const res = await apiPost<SendResult>(
        `/api/platform/email/providers/${providerKey}/send-test`,
        { templateId, toEmail, toName, lang },
      );
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSending(false);
    }
  }

  const canSend = !!templateId && !!toEmail && !!toName && !sending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      size="lg"
      title={`${t('platformEmail.sendTestTitle')} — ${providerName}`}
      description={t('platformEmail.sendTestDesc')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={sending}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSend} disabled={!canSend}>
            {sending
              ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden />
              : <Send className="w-4 h-4 mr-1.5" aria-hidden />}
            {t('platformEmail.send')}
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
                'flex items-start gap-2 rounded-md border p-3 text-sm ' +
                (result.ok
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                  : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200')
              }
            >
              {result.ok
                ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                : <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
              <div className="space-y-0.5">
                {result.ok ? (
                  <>
                    <div className="font-medium">{t('platformEmail.sendOk')}</div>
                    {result.messageId && (
                      <div className="text-xs opacity-80 font-mono">
                        messageId: {result.messageId}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="font-medium">{t('platformEmail.sendFailed')}</div>
                    {result.detail && (
                      <div className="text-xs opacity-80">{result.detail}</div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                {t('platformEmail.template')}
                <span className="text-red-500 ml-0.5">*</span>
              </label>
              <Select
                options={options}
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                placeholder={t('platformEmail.selectTemplate')}
              />
              {selected && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 italic">
                  {lang === 'en' ? selected.descriptionEn : selected.descriptionFr}
                  <Badge variant="outline" className="ml-2">{selected.recipientNameVar}</Badge>
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                {t('platformEmail.recipientEmail')}
                <span className="text-red-500 ml-0.5">*</span>
              </label>
              <Input
                type="email"
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                placeholder="email@example.com"
                autoComplete="off"
                leftAddon={<Mail className="w-4 h-4" aria-hidden />}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                {t('platformEmail.recipientName')}
                <span className="text-red-500 ml-0.5">*</span>
              </label>
              <Input
                type="text"
                value={toName}
                onChange={(e) => setToName(e.target.value)}
                placeholder={t('platformEmail.recipientNamePlaceholder')}
                autoComplete="off"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                {t('platformEmail.language')}
              </label>
              <Select
                options={[
                  { value: 'fr', label: 'Français' },
                  { value: 'en', label: 'English' },
                ]}
                value={lang}
                onChange={(e) => setLang(e.target.value as 'fr' | 'en')}
              />
            </div>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400 italic">
            {t('platformEmail.sendTestHint')}
          </p>
        </div>
      )}
    </Dialog>
  );
}
