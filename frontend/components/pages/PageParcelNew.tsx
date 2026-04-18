/**
 * PageParcelNew — « Enregistrer un colis »
 *
 * Formulaire plein écran pour enregistrer un nouveau colis (agent de gare).
 * Sur succès, affiche le code de suivi + bouton « Nouveau colis ».
 *
 * API :
 *   GET  /api/tenants/:tid/stations
 *   POST /api/tenants/:tid/parcels          body: CreateParcelDto
 */

import { useState, type FormEvent } from 'react';
import { PackagePlus, PackageCheck, Copy, Plus } from 'lucide-react';
import { useAuth }                       from '../../lib/auth/auth.context';
import { useFetch }                      from '../../lib/hooks/useFetch';
import { apiPost }                       from '../../lib/api';
import { useI18n }                       from '../../lib/i18n/useI18n';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge }                         from '../ui/Badge';
import { Button }                        from '../ui/Button';
import { ErrorAlert }                    from '../ui/ErrorAlert';
import { FormFooter }                    from '../ui/FormFooter';
import { inputClass as inp }             from '../ui/inputClass';

interface StationRow {
  id:   string;
  name: string;
  city: string;
}

interface ParcelCreated {
  id:           string;
  trackingCode: string;
}

interface FormValues {
  // Destinataire (obligatoire)
  recipientName:  string;
  recipientPhone: string;
  recipientEmail: string;    // CRM — optionnel
  address:        string;
  // Expéditeur (optionnel — sinon l'actor connecté est pris par défaut)
  senderName:     string;
  senderPhone:    string;
  senderEmail:    string;
  // Colis
  destinationId:  string;
  weightKg:       string;
  declaredValue:  string;
}

const EMPTY_FORM: FormValues = {
  recipientName: '', recipientPhone: '', recipientEmail: '', address: '',
  senderName: '', senderPhone: '', senderEmail: '',
  destinationId: '', weightKg: '', declaredValue: '',
};

export function PageParcelNew() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const { data: stations } = useFetch<StationRow[]>(
    tenantId ? `/api/tenants/${tenantId}/stations` : null, [tenantId],
  );

  const [f, setF]                 = useState<FormValues>(EMPTY_FORM);
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [created, setCreated]     = useState<ParcelCreated | null>(null);
  const [copied, setCopied]       = useState(false);

  const patch = (p: Partial<FormValues>) => setF(prev => ({ ...prev, ...p }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const parcel = await apiPost<ParcelCreated>(`/api/tenants/${tenantId}/parcels`, {
        recipientName:  f.recipientName.trim(),
        recipientPhone: f.recipientPhone.trim(),
        recipientEmail: f.recipientEmail.trim() || undefined,
        address:        f.address.trim() || undefined,
        senderName:     f.senderName.trim()  || undefined,
        senderPhone:    f.senderPhone.trim() || undefined,
        senderEmail:    f.senderEmail.trim() || undefined,
        destinationId:  f.destinationId,
        weightKg:       Number(f.weightKg),
        declaredValue:  f.declaredValue ? Number(f.declaredValue) : undefined,
      });
      setCreated(parcel);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const reset = () => {
    setCreated(null); setF(EMPTY_FORM); setError(null); setCopied(false);
  };

  const copyCode = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.trackingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <main className="p-6 space-y-6 max-w-3xl mx-auto" role="main" aria-label={t('parcelNew.title')}>
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
          <PackagePlus className="w-5 h-5 text-indigo-600 dark:text-indigo-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('parcelNew.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t('parcelNew.subtitle')}
          </p>
        </div>
      </div>

      {created ? (
        <Card>
          <CardHeader heading={t('parcelNew.parcelRegistered')} description={t('parcelNew.transmitCode')} />
          <CardContent className="space-y-5">
            <div className="flex flex-col items-center text-center gap-3 py-4">
              <div className="p-3 rounded-full bg-green-100 dark:bg-green-900/30">
                <PackageCheck className="w-8 h-8 text-green-600 dark:text-green-400" aria-hidden />
              </div>
              <Badge variant="success">{t('parcelNew.created')}</Badge>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">{t('parcelNew.trackingCode')}</p>
                <p className="text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
                  {created.trackingCode}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={copyCode}>
                <Copy className="w-3.5 h-3.5 mr-1.5" aria-hidden />
                {copied ? t('parcelNew.copied') : t('parcelNew.copyCode')}
              </Button>
            </div>
            <div className="flex justify-end">
              <Button onClick={reset}>
                <Plus className="w-4 h-4 mr-1.5" aria-hidden />
                {t('parcelNew.newParcel')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader heading={t('parcelNew.parcelInfo')} />
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <ErrorAlert error={error} />

              <fieldset className="space-y-4">
                <legend className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
                  {t('parcelNew.recipient')}
                </legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label htmlFor="rec-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                      {t('parcelNew.name')} <span aria-hidden className="text-red-500">*</span>
                    </label>
                    <input id="rec-name" type="text" required value={f.recipientName}
                      onChange={e => patch({ recipientName: e.target.value })}
                      className={inp} disabled={busy} />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="rec-phone" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                      {t('parcelNew.phone')} <span aria-hidden className="text-red-500">*</span>
                    </label>
                    <input id="rec-phone" type="tel" required value={f.recipientPhone}
                      onChange={e => patch({ recipientPhone: e.target.value })}
                      className={inp} disabled={busy} placeholder="+242 06 000 00 00" />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="rec-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                      {t('parcelNew.email')}
                      <span className="text-xs text-slate-500 dark:text-slate-400 ml-1 font-normal">
                        {t('common.optional')}
                      </span>
                    </label>
                    <input id="rec-email" type="email" value={f.recipientEmail}
                      onChange={e => patch({ recipientEmail: e.target.value })}
                      className={inp} disabled={busy} aria-describedby="rec-email-help" />
                    <p id="rec-email-help" className="text-xs text-slate-500 dark:text-slate-400">
                      {t('parcelNew.emailHelp')}
                    </p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="rec-address" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                    {t('parcelNew.deliveryAddress')}
                  </label>
                  <input id="rec-address" type="text" value={f.address}
                    onChange={e => patch({ address: e.target.value })}
                    className={inp} disabled={busy}
                    placeholder={t('parcelNew.addressPlaceholder')} />
                </div>
              </fieldset>

              {/* Expéditeur — optionnel ; sinon l'user connecté (guichet) sera pris */}
              <fieldset className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                <legend className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
                  {t('parcelNew.sender')}
                  <span className="text-xs text-slate-500 dark:text-slate-400 ml-2 font-normal">
                    {t('common.optional')}
                  </span>
                </legend>
                <p className="text-xs text-slate-500 dark:text-slate-400 -mt-2">
                  {t('parcelNew.senderHelp')}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label htmlFor="snd-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                      {t('parcelNew.name')}
                    </label>
                    <input id="snd-name" type="text" value={f.senderName}
                      onChange={e => patch({ senderName: e.target.value })}
                      className={inp} disabled={busy} />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="snd-phone" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                      {t('parcelNew.phone')}
                    </label>
                    <input id="snd-phone" type="tel" value={f.senderPhone}
                      onChange={e => patch({ senderPhone: e.target.value })}
                      className={inp} disabled={busy} placeholder="+242 06 000 00 00" />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="snd-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                      {t('parcelNew.email')}
                    </label>
                    <input id="snd-email" type="email" value={f.senderEmail}
                      onChange={e => patch({ senderEmail: e.target.value })}
                      className={inp} disabled={busy} />
                  </div>
                </div>
              </fieldset>

              <fieldset className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                <legend className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
                  {t('parcelNew.shipping')}
                </legend>
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                    {t('parcelNew.destinationStation')} <span aria-hidden className="text-red-500">*</span>
                  </label>
                  <select required value={f.destinationId}
                    onChange={e => patch({ destinationId: e.target.value })}
                    className={inp} disabled={busy}>
                    <option value="">{t('parcelNew.selectStation')}</option>
                    {(stations ?? []).map(s => (
                      <option key={s.id} value={s.id}>{s.name} — {s.city}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                      {t('parcelNew.weight')} <span aria-hidden className="text-red-500">*</span>
                    </label>
                    <input type="number" step="0.01" min={0} required value={f.weightKg}
                      onChange={e => patch({ weightKg: e.target.value })}
                      className={inp} disabled={busy} placeholder="5.0" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                      {t('parcelNew.declaredValue')}
                    </label>
                    <input type="number" min={0} value={f.declaredValue}
                      onChange={e => patch({ declaredValue: e.target.value })}
                      className={inp} disabled={busy} placeholder={t('parcelNew.optional')} />
                  </div>
                </div>
              </fieldset>

              <FormFooter onCancel={() => setF(EMPTY_FORM)} busy={busy}
                submitLabel={t('parcelNew.registerParcel')} pendingLabel={t('parcelNew.registering')}
                cancelLabel={t('parcelNew.clear')} />
            </form>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
