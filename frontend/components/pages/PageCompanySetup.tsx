/**
 * PageCompanySetup — Configuration société et localisation du tenant.
 *
 * Source :
 *   GET   /api/tenants/:id/company  → lecture publique
 *   PATCH /api/tenants/:id/company  → control.settings.manage.tenant
 *
 * Champs gérés :
 *   - name         : raison sociale (utilisée partout + documents imprimables)
 *   - rccm         : Registre de commerce (optionnel — pour factures légales)
 *   - phoneNumber  : contact principal (optionnel — portail public)
 *   - language     : pilote l'interface i18n entière (fr | en)
 *   - timezone     : IANA (ex: "Africa/Brazzaville") — fuseau pour dates
 *   - currency     : ISO 4217 (XAF, EUR, USD, XOF)
 *
 * Changement de langue : propage immédiatement via TenantConfigBridge au
 * prochain login, ou via refresh() côté AuthProvider.
 */

import { useState, useEffect, type FormEvent } from 'react';
import { Building2, Save, Loader2, Globe, Clock, Banknote, FileBadge, Phone } from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPatch } from '../../lib/api';
import { useAuth }  from '../../lib/auth/auth.context';

interface CompanyInfo {
  id:          string;
  name:        string;
  slug:        string;
  language:    string;
  timezone:    string;
  currency:    string;
  rccm:        string | null;
  phoneNumber: string | null;
}

// Langues supportées — aligné avec le backend SUPPORTED_LANGUAGES
const LANGUAGE_OPTIONS = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
];

// Timezones courants — liste courte pragmatique, l'utilisateur peut taper
// n'importe quelle IANA TZ dans le champ libre.
const TIMEZONE_SUGGESTIONS = [
  'Africa/Brazzaville',
  'Africa/Kinshasa',
  'Africa/Lagos',
  'Africa/Abidjan',
  'Africa/Dakar',
  'Europe/Paris',
  'UTC',
];

// Devises courantes — liste courte, champ libre pour les autres.
const CURRENCY_OPTIONS = [
  { value: 'XAF', label: 'XAF — Franc CFA (Afrique Centrale)' },
  { value: 'XOF', label: 'XOF — Franc CFA (Afrique de l\'Ouest)' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'USD', label: 'USD — Dollar américain' },
];

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

const INPUT_CLS =
  'w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 ' +
  'px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 ' +
  'focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30';

export function PageCompanySetup() {
  const { user, refresh } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const url = tenantId ? `/api/tenants/${tenantId}/company` : null;
  const { data: remote, loading, error: fetchError, refetch } = useFetch<CompanyInfo>(url, [tenantId]);

  const [form, setForm]       = useState<CompanyInfo | null>(null);
  const [saving, setSaving]   = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saved, setSaved]     = useState(false);

  useEffect(() => { if (remote) setForm(remote); }, [remote]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form || !tenantId) return;

    setSaving(true);
    setSaveErr(null);
    setSaved(false);

    try {
      await apiPatch(`/api/tenants/${tenantId}/company`, {
        name:        form.name,
        language:    form.language,
        timezone:    form.timezone,
        currency:    form.currency,
        rccm:        form.rccm || null,
        phoneNumber: form.phoneNumber || null,
      });
      setSaved(true);
      refetch();
      // Rafraîchit l'utilisateur courant pour refléter toute perm modifiée
      void refresh();
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
          <Building2 className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Informations société</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Identité légale, localisation et langue de l'interface.
          </p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-slate-500 py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Chargement…</span>
        </div>
      )}

      {fetchError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
          Impossible de charger : {fetchError}
        </div>
      )}

      {form && (
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* ── Identité ─────────────────────────────────────────────── */}
          <section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
              Identité
            </h2>

            <Field icon={Building2} label="Raison sociale" htmlFor="name"
                   hint="Nom affiché partout (portail, billets, documents).">
              <input
                id="name"
                type="text"
                required
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className={INPUT_CLS}
              />
            </Field>

            <Field icon={FileBadge} label="RCCM — Registre du commerce (optionnel)" htmlFor="rccm"
                   hint="Affiché sur les factures légales. Laissez vide si non applicable.">
              <input
                id="rccm"
                type="text"
                placeholder="Ex : CG/BZV/20-B-5678"
                value={form.rccm ?? ''}
                onChange={e => setForm({ ...form, rccm: e.target.value })}
                className={INPUT_CLS}
              />
            </Field>

            <Field icon={Phone} label="Téléphone principal (optionnel)" htmlFor="phone"
                   hint="Contact affiché sur le portail client.">
              <input
                id="phone"
                type="tel"
                placeholder="+242 06 123 45 67"
                value={form.phoneNumber ?? ''}
                onChange={e => setForm({ ...form, phoneNumber: e.target.value })}
                className={INPUT_CLS}
              />
            </Field>
          </section>

          {/* ── Localisation ─────────────────────────────────────────── */}
          <section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
              Localisation & interface
            </h2>

            <Field icon={Globe} label="Langue de l'interface" htmlFor="language"
                   hint="Pilote l'ensemble de l'interface pour tous les utilisateurs du tenant.">
              <select
                id="language"
                value={form.language}
                onChange={e => setForm({ ...form, language: e.target.value })}
                className={INPUT_CLS}
              >
                {LANGUAGE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>

            <Field icon={Clock} label="Fuseau horaire" htmlFor="timezone"
                   hint="Format IANA (ex. Africa/Brazzaville). Affecte l'affichage des dates.">
              <input
                id="timezone"
                type="text"
                list="tz-suggestions"
                required
                value={form.timezone}
                onChange={e => setForm({ ...form, timezone: e.target.value })}
                className={INPUT_CLS}
              />
              <datalist id="tz-suggestions">
                {TIMEZONE_SUGGESTIONS.map(tz => <option key={tz} value={tz} />)}
              </datalist>
            </Field>

            <Field icon={Banknote} label="Devise" htmlFor="currency"
                   hint="Code ISO 4217. Utilisée pour tous les montants (billets, colis, caisse).">
              <select
                id="currency"
                value={form.currency}
                onChange={e => setForm({ ...form, currency: e.target.value })}
                className={INPUT_CLS}
              >
                {CURRENCY_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
                {!CURRENCY_OPTIONS.some(o => o.value === form.currency) && (
                  <option value={form.currency}>{form.currency}</option>
                )}
              </select>
            </Field>
          </section>

          {/* ── Actions ──────────────────────────────────────────────── */}
          {saveErr && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
              {saveErr}
            </div>
          )}

          {saved && !saveErr && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
              Modifications enregistrées. La langue sera appliquée au prochain chargement.
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
