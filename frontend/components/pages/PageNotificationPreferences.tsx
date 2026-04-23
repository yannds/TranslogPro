/**
 * PageNotificationPreferences — Module L PRD : préférences self-service.
 *
 * L'utilisateur gère lui-même ses canaux de notifications :
 *   - SMS       (Twilio / abonnés mobile)
 *   - WhatsApp  (Business API)
 *   - Push      (mobile app)
 *   - Email     (confirmations longues)
 *
 * Endpoints :
 *   - GET   /api/v1/tenants/:tid/notifications/preferences
 *   - PATCH /api/v1/tenants/:tid/notifications/preferences
 *
 * Permission : data.notification.read.own
 * Identité forcée serveur (CurrentUser) — pas d'usurpation possible.
 *
 * Qualité : i18n fr+en, WCAG AA (toggle accessible), dark+light, responsive.
 */
import { useEffect, useState } from 'react';
import { Bell, MessageCircle, Smartphone, Mail, Save, Check } from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPatch } from '../../lib/api';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n, tm } from '../../lib/i18n/useI18n';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { ErrorAlert } from '../ui/ErrorAlert';

interface NotificationPrefs {
  id:       string | null;
  userId:   string;
  tenantId: string;
  sms:      boolean;
  whatsapp: boolean;
  push:     boolean;
  email:    boolean;
}

const SAVE_FEEDBACK_MS = 2_000;

export function PageNotificationPreferences() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const canRead  = (user?.permissions ?? []).includes('data.notification.read.own');

  const url = tenantId && canRead
    ? `/api/v1/tenants/${tenantId}/notifications/preferences`
    : null;

  const { data, loading, error, refetch } = useFetch<NotificationPrefs>(url, [tenantId]);

  const [draft, setDraft] = useState<Partial<NotificationPrefs>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);

  // Hydrate le draft à la première arrivée des données
  useEffect(() => {
    if (data && Object.keys(draft).length === 0) {
      setDraft({
        sms:      data.sms,
        whatsapp: data.whatsapp,
        push:     data.push,
        email:    data.email,
      });
    }
  }, [data, draft]);

  useEffect(() => {
    if (!savedTick) return;
    const id = setTimeout(() => setSavedTick(false), SAVE_FEEDBACK_MS);
    return () => clearTimeout(id);
  }, [savedTick]);

  const T = {
    title:      t(tm('Préférences de notifications', 'Notification preferences')),
    subtitle:   t(tm('Choisissez les canaux par lesquels vous souhaitez être notifié.',
                     'Pick the channels you want to be reached through.')),
    smsTitle:   t(tm('SMS', 'SMS')),
    smsDesc:    t(tm('Messages texte courts (alertes urgentes, billets QR).',
                     'Short text messages (urgent alerts, QR tickets).')),
    waTitle:    t(tm('WhatsApp', 'WhatsApp')),
    waDesc:     t(tm('Messages riches via WhatsApp Business (lien tracking, justificatifs).',
                     'Rich messages via WhatsApp Business (tracking links, receipts).')),
    pushTitle:  t(tm('Push mobile', 'Mobile push')),
    pushDesc:   t(tm('Notifications de l\'application mobile (changement de quai, retard).',
                     'Mobile app notifications (gate change, delay).')),
    emailTitle: t(tm('Email', 'Email')),
    emailDesc:  t(tm('Confirmations longues, factures PDF (désactivé par défaut).',
                     'Long confirmations, PDF invoices (off by default).')),
    save:       t(tm('Enregistrer', 'Save')),
    saving:     t(tm('Enregistrement…', 'Saving…')),
    saved:      t(tm('Enregistré', 'Saved')),
    notAuth:    t(tm('Vous devez être connecté pour accéder à cette page.',
                     'You must be signed in to access this page.')),
    inAppNote:  t(tm('Les notifications dans l\'application sont toujours actives — elles n\'envoient rien à l\'extérieur.',
                     'In-app notifications are always on — they never leave the platform.')),
  };

  const toggle = (key: keyof NotificationPrefs, val: boolean) => {
    setDraft({ ...draft, [key]: val });
    setSavedTick(false);
  };

  const save = async () => {
    if (!tenantId) return;
    setSaving(true);
    setSaveError(null);
    try {
      await apiPatch(`/api/v1/tenants/${tenantId}/notifications/preferences`, draft);
      await refetch();
      setSavedTick(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!canRead) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <ErrorAlert error={T.notAuth} icon className="mt-6" />
      </div>
    );
  }

  const isDirty = data
    ? draft.sms      !== data.sms
   || draft.whatsapp !== data.whatsapp
   || draft.push     !== data.push
   || draft.email    !== data.email
    : false;

  return (
    <div className="p-6 max-w-3xl mx-auto" aria-labelledby="page-notif-prefs-title">
      <header className="mb-6">
        <h1 id="page-notif-prefs-title" className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          {T.title}
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{T.subtitle}</p>
      </header>

      {error && <ErrorAlert error={error} className="mb-4" />}

      <div className="space-y-3" role="group" aria-labelledby="page-notif-prefs-title">
        <PrefRow
          icon={<Smartphone className="w-5 h-5" />}
          title={T.smsTitle}
          description={T.smsDesc}
          enabled={draft.sms ?? false}
          loading={loading}
          onChange={(v) => toggle('sms', v)}
        />
        <PrefRow
          icon={<MessageCircle className="w-5 h-5" />}
          title={T.waTitle}
          description={T.waDesc}
          enabled={draft.whatsapp ?? false}
          loading={loading}
          onChange={(v) => toggle('whatsapp', v)}
        />
        <PrefRow
          icon={<Bell className="w-5 h-5" />}
          title={T.pushTitle}
          description={T.pushDesc}
          enabled={draft.push ?? false}
          loading={loading}
          onChange={(v) => toggle('push', v)}
        />
        <PrefRow
          icon={<Mail className="w-5 h-5" />}
          title={T.emailTitle}
          description={T.emailDesc}
          enabled={draft.email ?? false}
          loading={loading}
          onChange={(v) => toggle('email', v)}
        />
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400 mt-4">{T.inAppNote}</p>

      {saveError && <ErrorAlert error={saveError} className="mt-4" />}

      <div className="mt-6 flex items-center gap-3">
        <Button onClick={save} disabled={!isDirty || saving} loading={saving}>
          <Save className="w-4 h-4 mr-1.5" aria-hidden />
          {saving ? T.saving : T.save}
        </Button>
        {savedTick && (
          <span className="inline-flex items-center gap-1 text-sm text-green-700 dark:text-green-400" role="status">
            <Check className="w-4 h-4" aria-hidden /> {T.saved}
          </span>
        )}
      </div>
    </div>
  );
}

interface PrefRowProps {
  icon:        React.ReactNode;
  title:       string;
  description: string;
  enabled:     boolean;
  loading:     boolean;
  onChange:    (val: boolean) => void;
}

function PrefRow({ icon, title, description, enabled, loading, onChange }: PrefRowProps) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="text-slate-500 dark:text-slate-400 shrink-0 mt-0.5" aria-hidden>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-slate-900 dark:text-slate-100">{title}</p>
        <p className="text-sm text-slate-600 dark:text-slate-400">{description}</p>
      </div>
      <div className="shrink-0">
        <Checkbox
          checked={enabled}
          disabled={loading}
          onCheckedChange={(v) => onChange(Boolean(v))}
          aria-label={title}
        />
      </div>
    </div>
  );
}
