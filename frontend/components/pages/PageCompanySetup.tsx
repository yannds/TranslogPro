/**
 * PageCompanySetup — Configuration société et localisation du tenant.
 *
 * 3 sections :
 *   1. Identité légale (nom, identifiant fiscal, adresse, ville)
 *   2. Contact (téléphone, email, site web)
 *   3. Localisation & régional (pays, fuseau horaire, devise, langue, format date)
 *
 * Le pays drive les suggestions de timezone et devise (auto-fill à la sélection).
 *
 * Source :
 *   GET   /api/tenants/:id/company  → lecture publique
 *   PATCH /api/tenants/:id/company  → control.settings.manage.tenant
 */

import { useState, useEffect, type FormEvent } from 'react';
import {
  Building2, Save, Loader2, Globe, Clock, Banknote, FileBadge, Phone,
  Mail, ExternalLink, MapPin, Flag, CalendarDays, Settings2,
} from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPatch } from '../../lib/api';
import { useAuth }  from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import {
  COUNTRIES, getCountry, getTimezonesForCountry, DATE_FORMAT_OPTIONS,
} from '../../lib/config/regional.config';

// ─── i18n (string-key based — see locales/fr.ts → companySetup) ─────────────

// Devises supportées — Afrique + partenaires commerciaux
const CURRENCY_OPTIONS = [
  // Afrique Centrale
  { value: 'XAF', label: 'XAF — Franc CFA (CEMAC)' },
  { value: 'CDF', label: 'CDF — Franc congolais (RDC)' },
  { value: 'RWF', label: 'RWF — Franc rwandais' },
  { value: 'BIF', label: 'BIF — Franc burundais' },
  { value: 'STN', label: 'STN — Dobra (São Tomé-et-Príncipe)' },
  // Afrique de l'Ouest
  { value: 'XOF', label: 'XOF — Franc CFA (UEMOA)' },
  { value: 'GNF', label: 'GNF — Franc guinéen' },
  { value: 'SLL', label: 'SLL — Leone (Sierra Leone)' },
  { value: 'NGN', label: 'NGN — Naira (Nigeria)' },
  { value: 'LRD', label: 'LRD — Dollar libérien' },
  { value: 'GHS', label: 'GHS — Cedi (Ghana)' },
  { value: 'GMD', label: 'GMD — Dalasi (Gambie)' },
  { value: 'CVE', label: 'CVE — Escudo cap-verdien' },
  // Afrique de l'Est
  { value: 'KES', label: 'KES — Shilling kényan' },
  { value: 'UGX', label: 'UGX — Shilling ougandais' },
  { value: 'ETB', label: 'ETB — Birr éthiopien' },
  { value: 'DJF', label: 'DJF — Franc de Djibouti' },
  // Afrique du Nord
  { value: 'MAD', label: 'MAD — Dirham marocain' },
  { value: 'TND', label: 'TND — Dinar tunisien' },
  { value: 'DZD', label: 'DZD — Dinar algérien' },
  // Afrique Australe / Autre
  { value: 'AOA', label: 'AOA — Kwanza (Angola)' },
  // International
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'USD', label: 'USD — Dollar américain' },
  { value: 'CNY', label: 'CNY — Yuan (Chine)' },
];

// Langues supportées — aligné avec Language type (i18n/types.ts)
const LANGUAGE_OPTIONS = [
  { value: 'fr',  label: '🇫🇷 Français' },
  { value: 'en',  label: '🇬🇧 English' },
  { value: 'ln',  label: '🇨🇬 Lingala' },
  { value: 'ktu', label: '🇨🇬 Kituba' },
  { value: 'es',  label: '🇪🇸 Español' },
  { value: 'pt',  label: '🇵🇹 Português' },
  { value: 'ar',  label: '🇸🇦 العربية' },
  { value: 'wo',  label: '🇸🇳 Wolof' },
];

interface CompanyInfo {
  id:          string;
  name:        string;
  slug:        string;
  country:     string;
  city:        string;
  language:    string;
  timezone:    string;
  currency:    string;
  dateFormat:  string;
  rccm:        string | null;
  phoneNumber: string | null;
  email:       string | null;
  website:     string | null;
  address:     string | null;
  taxId:       string | null;
}

interface BusinessConfig {
  id:                     string;
  tenantId:               string;
  daysPerYear:            number;
  defaultTripsPerMonth:   number;
  breakEvenThresholdPct:  number;
  agencyCommissionRate:   number;
  stationFeePerDeparture: number;
}

// ─── Sous-composants ─────────────────────────────────────────────────────────

function Field({
  icon: Icon, label, htmlFor, hint, children,
}: {
  icon?:    typeof Building2;
  label:    string;
  htmlFor:  string;
  hint?:    string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
        {Icon && <Icon className="w-3.5 h-3.5 text-slate-400" aria-hidden />}
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-4">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
        {title}
      </h2>
      {children}
    </section>
  );
}

const INPUT_CLS =
  'w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 ' +
  'px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 ' +
  'focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30';

// ─── Page ────────────────────────────────────────────────────────────────────

export function PageCompanySetup() {
  const { user, refresh } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId ?? '';

  const url = tenantId ? `/api/tenants/${tenantId}/company` : null;
  const { data: remote, loading, error: fetchError, refetch } = useFetch<CompanyInfo>(url, [tenantId]);

  const [form, setForm]       = useState<CompanyInfo | null>(null);
  const [saving, setSaving]   = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saved, setSaved]     = useState(false);

  // ── Business config ────────────────────────────────────────────────────────
  const bizUrl = tenantId ? `/api/tenants/${tenantId}/business-config` : null;
  const { data: remoteBiz, loading: bizLoading, error: bizFetchErr, refetch: bizRefetch } =
    useFetch<BusinessConfig>(bizUrl, [tenantId]);

  const [bizForm, setBizForm]       = useState<BusinessConfig | null>(null);
  const [bizSaving, setBizSaving]   = useState(false);
  const [bizSaveErr, setBizSaveErr] = useState<string | null>(null);
  const [bizSaved, setBizSaved]     = useState(false);

  useEffect(() => { if (remoteBiz) setBizForm(remoteBiz); }, [remoteBiz]);

  useEffect(() => { if (remote) setForm(remote); }, [remote]);

  const set = (patch: Partial<CompanyInfo>) =>
    setForm(prev => prev ? { ...prev, ...patch } : prev);

  // Quand on change de pays → auto-remplir timezone + devise
  const handleCountryChange = (countryCode: string) => {
    const c = getCountry(countryCode);
    if (c) {
      set({
        country:  c.code,
        timezone: c.timezone,
        currency: c.currency,
      });
    } else {
      set({ country: countryCode });
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form || !tenantId) return;

    setSaving(true);
    setSaveErr(null);
    setSaved(false);

    try {
      await apiPatch(`/api/tenants/${tenantId}/company`, {
        name:        form.name,
        country:     form.country,
        city:        form.city || '',
        language:    form.language,
        timezone:    form.timezone,
        currency:    form.currency,
        dateFormat:  form.dateFormat,
        rccm:        form.rccm || null,
        phoneNumber: form.phoneNumber || null,
        email:       form.email || null,
        website:     form.website || null,
        address:     form.address || null,
        taxId:       form.taxId || null,
      });
      setSaved(true);
      refetch();
      void refresh();
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : t('companySetup.unknownError'));
    } finally {
      setSaving(false);
    }
  };

  const handleBizSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!bizForm || !tenantId) return;

    setBizSaving(true);
    setBizSaveErr(null);
    setBizSaved(false);

    try {
      await apiPatch(`/api/tenants/${tenantId}/business-config`, {
        daysPerYear:            bizForm.daysPerYear,
        defaultTripsPerMonth:   bizForm.defaultTripsPerMonth,
        breakEvenThresholdPct:  bizForm.breakEvenThresholdPct,
        agencyCommissionRate:   bizForm.agencyCommissionRate,
        stationFeePerDeparture: bizForm.stationFeePerDeparture,
      });
      setBizSaved(true);
      bizRefetch();
    } catch (err) {
      setBizSaveErr(err instanceof Error ? err.message : t('companySetup.unknownError'));
    } finally {
      setBizSaving(false);
    }
  };

  const timezones = form ? getTimezonesForCountry(form.country) : [];
  const countryObj = form ? getCountry(form.country) : undefined;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
          <Building2 className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('companySetup.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('companySetup.subtitle')}
          </p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-slate-500 py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          <span className="text-sm">{t('companySetup.loading')}</span>
        </div>
      )}

      {fetchError && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
          {t('companySetup.loadError')} : {fetchError}
        </div>
      )}

      {form && (
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* ── Section 1 : Identité légale ──────────────────────────── */}
          <SectionCard title={t('companySetup.legalIdentity')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field icon={Building2} label={t('companySetup.companyName')} htmlFor="name"
                     hint={t('companySetup.companyNameHint')}>
                <input id="name" type="text" required value={form.name}
                  onChange={e => set({ name: e.target.value })}
                  className={INPUT_CLS} />
              </Field>

              <Field icon={FileBadge} label={t('companySetup.taxId')} htmlFor="taxId"
                     hint={t('companySetup.taxIdHint')}>
                <input id="taxId" type="text"
                  placeholder="Ex : CG/BZV/20-B-5678"
                  value={form.taxId ?? ''}
                  onChange={e => set({ taxId: e.target.value })}
                  className={INPUT_CLS} />
              </Field>

              <Field icon={MapPin} label={t('companySetup.hqAddress')} htmlFor="address"
                     hint={t('companySetup.hqAddressHint')}>
                <input id="address" type="text"
                  placeholder="123 Avenue de la Paix, Brazzaville"
                  value={form.address ?? ''}
                  onChange={e => set({ address: e.target.value })}
                  className={INPUT_CLS} />
              </Field>

              <Field icon={MapPin} label={t('companySetup.hqCity')} htmlFor="city"
                     hint={t('companySetup.hqCityHint')}>
                <input id="city" type="text"
                  placeholder="Brazzaville"
                  value={form.city ?? ''}
                  onChange={e => set({ city: e.target.value })}
                  className={INPUT_CLS} />
              </Field>
            </div>
          </SectionCard>

          {/* ── Section 2 : Contact ──────────────────────────────────── */}
          <SectionCard title={t('companySetup.contact')}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field icon={Phone} label={t('companySetup.phone')} htmlFor="phone"
                     hint={t('companySetup.phoneHint')}>
                <input id="phone" type="tel"
                  placeholder="+242 06 123 45 67"
                  value={form.phoneNumber ?? ''}
                  onChange={e => set({ phoneNumber: e.target.value })}
                  className={INPUT_CLS} />
              </Field>

              <Field icon={Mail} label={t('companySetup.contactEmail')} htmlFor="email"
                     hint={t('companySetup.contactEmailHint')}>
                <input id="email" type="email"
                  placeholder="contact@societe.com"
                  value={form.email ?? ''}
                  onChange={e => set({ email: e.target.value })}
                  className={INPUT_CLS} />
              </Field>

              <Field icon={ExternalLink} label={t('companySetup.website')} htmlFor="website"
                     hint={t('companySetup.websiteHint')}>
                <input id="website" type="url"
                  placeholder="https://www.societe.com"
                  value={form.website ?? ''}
                  onChange={e => set({ website: e.target.value })}
                  className={INPUT_CLS} />
              </Field>
            </div>
          </SectionCard>

          {/* ── Section 3 : Localisation & régional ──────────────────── */}
          <SectionCard title={t('companySetup.locRegional')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field icon={Flag} label={t('companySetup.country')} htmlFor="country"
                     hint={t('companySetup.countryHint')}>
                <select id="country" value={form.country}
                  onChange={e => handleCountryChange(e.target.value)}
                  className={INPUT_CLS}>
                  {COUNTRIES.map(c => (
                    <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                  ))}
                  {!COUNTRIES.some(c => c.code === form.country) && (
                    <option value={form.country}>{form.country}</option>
                  )}
                </select>
              </Field>

              <Field icon={Clock} label={t('companySetup.timezone')} htmlFor="timezone"
                     hint={countryObj ? `Fuseaux de ${countryObj.name} + UTC.` : 'Format IANA.'}>
                <select id="timezone" value={form.timezone}
                  onChange={e => set({ timezone: e.target.value })}
                  className={INPUT_CLS}>
                  {timezones.map(tz => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                  {!timezones.some(tz => tz.value === form.timezone) && (
                    <option value={form.timezone}>{form.timezone}</option>
                  )}
                </select>
              </Field>

              <Field icon={Banknote} label={t('companySetup.currency')} htmlFor="currency"
                     hint={t('companySetup.currencyHint')}>
                <select id="currency" value={form.currency}
                  onChange={e => set({ currency: e.target.value })}
                  className={INPUT_CLS}>
                  {CURRENCY_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                  {!CURRENCY_OPTIONS.some(o => o.value === form.currency) && (
                    <option value={form.currency}>{form.currency}</option>
                  )}
                </select>
              </Field>

              <Field icon={Globe} label={t('companySetup.language')} htmlFor="language"
                     hint={t('companySetup.languageHint')}>
                <select id="language" value={form.language}
                  onChange={e => set({ language: e.target.value })}
                  className={INPUT_CLS}>
                  {LANGUAGE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>

              <Field icon={CalendarDays} label={t('companySetup.dateFormat')} htmlFor="dateFormat"
                     hint={t('companySetup.dateFormatHint')}>
                <select id="dateFormat" value={form.dateFormat}
                  onChange={e => set({ dateFormat: e.target.value })}
                  className={INPUT_CLS}>
                  {DATE_FORMAT_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>
            </div>
          </SectionCard>

          {/* ── Feedback & submit ────────────────────────────────────── */}
          {saveErr && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
              {saveErr}
            </div>
          )}

          {saved && !saveErr && (
            <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
              {t('companySetup.savedMsg')}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Save className="w-4 h-4" aria-hidden />}
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      )}

      {/* ── Section : Paramètres business ──────────────────────────────── */}
      {bizLoading && (
        <div className="flex items-center gap-2 text-slate-500 py-8 justify-center mt-6">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          <span className="text-sm">{t('companySetup.bizLoading')}</span>
        </div>
      )}

      {bizFetchErr && (
        <div role="alert" className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
          {t('companySetup.bizLoadError')} : {bizFetchErr}
        </div>
      )}

      {bizForm && (
        <form onSubmit={handleBizSubmit} className="space-y-6 mt-8">
          <SectionCard title={t('companySetup.bizTitle')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field icon={Settings2} label={t('companySetup.agencyComm')} htmlFor="agencyCommissionRate"
                     hint={t('companySetup.agencyCommHint')}>
                <input id="agencyCommissionRate" type="number" step="0.01" min="0" max="100"
                  value={Math.round(bizForm.agencyCommissionRate * 10000) / 100}
                  onChange={e => setBizForm(prev => prev ? { ...prev, agencyCommissionRate: parseFloat(e.target.value || '0') / 100 } : prev)}
                  className={INPUT_CLS} />
              </Field>

              <Field icon={Settings2} label={t('companySetup.breakEvenThresh')} htmlFor="breakEvenThresholdPct"
                     hint={t('companySetup.breakEvenHint')}>
                <input id="breakEvenThresholdPct" type="number" step="0.01" min="0" max="100"
                  value={Math.round(bizForm.breakEvenThresholdPct * 10000) / 100}
                  onChange={e => setBizForm(prev => prev ? { ...prev, breakEvenThresholdPct: parseFloat(e.target.value || '0') / 100 } : prev)}
                  className={INPUT_CLS} />
              </Field>

              <Field icon={Settings2} label={t('companySetup.tripsMonth')} htmlFor="defaultTripsPerMonth"
                     hint={t('companySetup.tripsMonthHint')}>
                <input id="defaultTripsPerMonth" type="number" step="1" min="1"
                  value={bizForm.defaultTripsPerMonth}
                  onChange={e => setBizForm(prev => prev ? { ...prev, defaultTripsPerMonth: parseInt(e.target.value || '1', 10) } : prev)}
                  className={INPUT_CLS} />
              </Field>

              <Field icon={Settings2} label={t('companySetup.stationFee')} htmlFor="stationFeePerDeparture"
                     hint={t('companySetup.stationFeeHint')}>
                <input id="stationFeePerDeparture" type="number" step="1" min="0"
                  value={bizForm.stationFeePerDeparture}
                  onChange={e => setBizForm(prev => prev ? { ...prev, stationFeePerDeparture: parseFloat(e.target.value || '0') } : prev)}
                  className={INPUT_CLS} />
              </Field>

              <Field icon={CalendarDays} label={t('companySetup.workDays')} htmlFor="daysPerYear"
                     hint={t('companySetup.workDaysHint')}>
                <input id="daysPerYear" type="number" step="1" min="1" max="366"
                  value={bizForm.daysPerYear}
                  onChange={e => setBizForm(prev => prev ? { ...prev, daysPerYear: parseInt(e.target.value || '365', 10) } : prev)}
                  className={INPUT_CLS} />
              </Field>
            </div>
          </SectionCard>

          {bizSaveErr && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
              {bizSaveErr}
            </div>
          )}

          {bizSaved && !bizSaveErr && (
            <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
              {t('companySetup.bizSaved')}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={bizSaving}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              {bizSaving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Save className="w-4 h-4" aria-hidden />}
              {bizSaving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
