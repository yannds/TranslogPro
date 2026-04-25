/**
 * PageTenantBusinessRules — Règles métier configurables par tenant.
 *
 * Sections :
 *   1. Annulation & remboursement (N-paliers JSON + acteurs concernés)
 *   2. No-show & TTL billet (pénalité no-show, grace period, TTL validité)
 *   3. Incident en route & compensation (tiers délai → % + snack + forme)
 *   4. Colis : hubs & retrait (TTL hub, TTL retrait, action auto si non retiré)
 *
 * Endpoint : PATCH /api/tenants/:tid/business-config
 * Permission : control.settings.manage.tenant
 *
 * Qualité : i18n fr+en (autres locales → TODO), WCAG AA + ARIA,
 * responsive desktop-first, dark+light, DataTableMaster absent ici (form),
 * zéro magic number (toutes les defaults viennent de la DB / schema Prisma).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Trash2, AlertCircle } from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPatch } from '../../lib/api';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Checkbox } from '../ui/Checkbox';
import { FormFooter } from '../ui/FormFooter';
import { ErrorAlert } from '../ui/ErrorAlert';

interface PenaltyTier    { hoursBeforeDeparture: number; penaltyPct: number }
interface CompensationTier { delayMinutes: number; compensationPct: number; snackBundle?: string }

interface BusinessRules {
  // Annulation legacy + N-paliers
  cancellationFullRefundMinutes:    number;
  cancellationPartialRefundMinutes: number;
  cancellationPartialRefundPct:     number;
  refundApprovalThreshold:          number;
  refundAutoApproveMax:             number;
  autoApproveTripCancelled:         boolean;
  cancellationPenaltyTiers:         PenaltyTier[] | unknown;
  cancellationPenaltyAppliesTo:     string[] | unknown;
  // No-show
  noShowGraceMinutes:       number;
  ticketTtlHours:           number;
  noShowPenaltyEnabled:     boolean;
  noShowPenaltyPct:         number;
  noShowPenaltyFlatAmount:  number;
  // Incident / compensation
  incidentCompensationEnabled:     boolean;
  incidentCompensationDelayTiers:  CompensationTier[] | unknown;
  incidentCompensationFormDefault: string;
  incidentVoucherValidityDays:     number;
  incidentVoucherUsageScope:       string;
  incidentRefundProrataEnabled:    boolean;
  // Parcel hub
  parcelHubMaxStorageDays:         number;
  parcelPickupMaxDaysBeforeReturn: number;
  parcelPickupNoShowAction:        string;
  // Sécurité endpoints publics (2026-04-20)
  captchaEnabled:                  boolean;
  dailyMagicLinkBudget:            number;
  magicLinkPhoneCooldownHours:     number;
  // Briefing pré-voyage QHSE (2026-04-24)
  preTripBriefingPolicy:           'OFF' | 'RECOMMENDED' | 'RECOMMENDED_WITH_ALERT';
  mandatoryItemFailurePolicy:      'WARN_ONLY' | 'ALERT_MANAGER' | 'BLOCK_DEPARTURE';
  restShortfallPolicy:             'WARN' | 'ALERT' | 'BLOCK';
  minDriverRestHours:              number;
}

const PENALTY_ACTORS   = ['CUSTOMER', 'AGENT', 'ADMIN', 'SYSTEM'];
const COMP_FORMS       = ['MONETARY', 'VOUCHER', 'MIXED', 'SNACK'];
const VOUCHER_SCOPES   = ['ANY_TRIP', 'SAME_ROUTE', 'SAME_COMPANY'];
const PICKUP_ACTIONS   = ['return', 'dispose', 'hold'];
const SNACK_BUNDLES    = ['', 'SNACK_LIGHT', 'SNACK_FULL', 'MEAL', 'CUSTOM'];

export function PageTenantBusinessRules() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const url = tenantId ? `/api/tenants/${tenantId}/business-config` : null;
  const { data, loading, error, refetch } = useFetch<BusinessRules>(url, [tenantId]);

  const [form, setForm] = useState<BusinessRules | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (data) setForm(parseJson(data)); }, [data]);

  // Parse JSON columns en array typés
  function parseJson(raw: BusinessRules): BusinessRules {
    const tiers   = Array.isArray(raw.cancellationPenaltyTiers) ? raw.cancellationPenaltyTiers as PenaltyTier[] : [];
    const actors  = Array.isArray(raw.cancellationPenaltyAppliesTo) ? raw.cancellationPenaltyAppliesTo as string[] : ['CUSTOMER', 'AGENT', 'ADMIN'];
    const delays  = Array.isArray(raw.incidentCompensationDelayTiers) ? raw.incidentCompensationDelayTiers as CompensationTier[] : [];
    return { ...raw, cancellationPenaltyTiers: tiers, cancellationPenaltyAppliesTo: actors, incidentCompensationDelayTiers: delays };
  }

  const set = (patch: Partial<BusinessRules>) =>
    setForm(prev => prev ? { ...prev, ...patch } : prev);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form || !tenantId) return;
    setSaving(true); setSaveErr(null); setSaved(false);
    try {
      // Tri les tiers avant envoi (cohérence DB + logique runtime qui attend décroissant).
      const penaltyTiers = (form.cancellationPenaltyTiers as PenaltyTier[])
        .filter(r => Number.isFinite(r.hoursBeforeDeparture) && Number.isFinite(r.penaltyPct))
        .sort((a, b) => b.hoursBeforeDeparture - a.hoursBeforeDeparture);
      const delayTiers = (form.incidentCompensationDelayTiers as CompensationTier[])
        .filter(r => Number.isFinite(r.delayMinutes) && Number.isFinite(r.compensationPct))
        .sort((a, b) => b.delayMinutes - a.delayMinutes);

      await apiPatch(url!, {
        ...form,
        cancellationPenaltyTiers:       penaltyTiers,
        cancellationPenaltyAppliesTo:   form.cancellationPenaltyAppliesTo,
        incidentCompensationDelayTiers: delayTiers,
      });
      setSaved(true); refetch();
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Error');
    } finally { setSaving(false); }
  };

  if (loading) return <div className="p-6 text-gray-500 dark:text-gray-400">{t('common.loading')}</div>;
  if (error)   return <div className="p-6"><ErrorAlert error={error} /></div>;
  if (!form)   return null;

  const penaltyTiers = form.cancellationPenaltyTiers as PenaltyTier[];
  const delayTiers   = form.incidentCompensationDelayTiers as CompensationTier[];
  const actors       = form.cancellationPenaltyAppliesTo as string[];

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          {t('tenantRules.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('tenantRules.subtitle')}
        </p>
      </header>

      <form onSubmit={submit} className="space-y-8">
        {/* ── Section 1 : Annulation & remboursement ─────────────────────── */}
        <section aria-labelledby="sec-cancel" className="rounded-lg border border-gray-200 dark:border-gray-700 p-5 bg-white dark:bg-gray-800">
          <h2 id="sec-cancel" className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            {t('tenantRules.cancellationTitle')}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {t('tenantRules.cancellationHint')}
          </p>

          {/* Paliers N-tiers */}
          <fieldset className="mb-4">
            <legend className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('tenantRules.penaltyTiers')}
            </legend>
            <div className="space-y-2">
              {penaltyTiers.map((tier, i) => (
                <div key={i} className="flex gap-2 items-end">
                  <label className="flex-1">
                    <span className="block text-xs text-gray-500 dark:text-gray-400">{t('tenantRules.hoursBefore')}</span>
                    <Input type="number" min="0" value={tier.hoursBeforeDeparture}
                      onChange={e => {
                        const next = [...penaltyTiers];
                        next[i] = { ...tier, hoursBeforeDeparture: parseInt(e.target.value, 10) || 0 };
                        set({ cancellationPenaltyTiers: next });
                      }} />
                  </label>
                  <label className="flex-1">
                    <span className="block text-xs text-gray-500 dark:text-gray-400">{t('tenantRules.penaltyPct')}</span>
                    <Input type="number" min="0" max="1" step="0.01" value={tier.penaltyPct}
                      onChange={e => {
                        const next = [...penaltyTiers];
                        next[i] = { ...tier, penaltyPct: Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)) };
                        set({ cancellationPenaltyTiers: next });
                      }} />
                  </label>
                  <Button variant="ghost" size="sm" type="button"
                    aria-label={t('common.delete')}
                    onClick={() => set({ cancellationPenaltyTiers: penaltyTiers.filter((_, j) => j !== i) })}>
                    <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" aria-hidden="true" />
                  </Button>
                </div>
              ))}
              <Button variant="secondary" size="sm" type="button"
                leftIcon={<Plus className="w-4 h-4" aria-hidden="true" />}
                onClick={() => set({ cancellationPenaltyTiers: [...penaltyTiers, { hoursBeforeDeparture: 0, penaltyPct: 0 }] })}>
                {t('tenantRules.addTier')}
              </Button>
            </div>
          </fieldset>

          <fieldset className="mb-4">
            <legend className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('tenantRules.appliesTo')}
            </legend>
            <div className="flex flex-wrap gap-3">
              {PENALTY_ACTORS.map(a => (
                <label key={a} className="inline-flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
                  <Checkbox checked={actors.includes(a)}
                    onCheckedChange={checked => {
                      const set2 = new Set(actors);
                      if (checked) set2.add(a); else set2.delete(a);
                      set({ cancellationPenaltyAppliesTo: Array.from(set2) });
                    }} />
                  <span>{t(`tenantRules.actor.${a}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('tenantRules.refundApprovalThreshold')}</span>
              <Input type="number" min="0" step="0.01" value={form.refundApprovalThreshold}
                onChange={e => set({ refundApprovalThreshold: parseFloat(e.target.value) || 0 })} />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('tenantRules.refundAutoApproveMax')}</span>
              <Input type="number" min="0" step="0.01" value={form.refundAutoApproveMax}
                onChange={e => set({ refundAutoApproveMax: parseFloat(e.target.value) || 0 })} />
            </label>
            <label className="inline-flex items-center gap-2 text-sm self-end pb-2 text-gray-900 dark:text-gray-100">
              <Checkbox checked={form.autoApproveTripCancelled}
                onCheckedChange={c => set({ autoApproveTripCancelled: c as boolean })} />
              <span>{t('tenantRules.autoApproveTripCancelled')}</span>
            </label>
          </div>
        </section>

        {/* ── Section 2 : No-show + TTL ────────────────────────────────── */}
        <section aria-labelledby="sec-noshow" className="rounded-lg border border-gray-200 dark:border-gray-700 p-5 bg-white dark:bg-gray-800">
          <h2 id="sec-noshow" className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            {t('tenantRules.noShowTitle')}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {t('tenantRules.noShowHint')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('tenantRules.noShowGraceMinutes')}</span>
              <Input type="number" min="0" value={form.noShowGraceMinutes}
                onChange={e => set({ noShowGraceMinutes: parseInt(e.target.value, 10) || 0 })} />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('tenantRules.ticketTtlHours')}</span>
              <Input type="number" min="1" value={form.ticketTtlHours}
                onChange={e => set({ ticketTtlHours: parseInt(e.target.value, 10) || 1 })} />
            </label>
          </div>
          <label className="mt-4 inline-flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
            <Checkbox checked={form.noShowPenaltyEnabled}
              onCheckedChange={c => set({ noShowPenaltyEnabled: c as boolean })} />
            <span>{t('tenantRules.noShowPenaltyEnabled')}</span>
          </label>
          {form.noShowPenaltyEnabled && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('tenantRules.noShowPenaltyPct')}</span>
                <Input type="number" min="0" max="1" step="0.01" value={form.noShowPenaltyPct}
                  onChange={e => set({ noShowPenaltyPct: Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)) })} />
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('tenantRules.noShowPenaltyFlatAmount')}</span>
                <Input type="number" min="0" step="0.01" value={form.noShowPenaltyFlatAmount}
                  onChange={e => set({ noShowPenaltyFlatAmount: parseFloat(e.target.value) || 0 })} />
              </label>
            </div>
          )}
        </section>

        {/* ── Section 3 : Incident & compensation ─────────────────────── */}
        <section aria-labelledby="sec-incident" className="rounded-lg border border-gray-200 dark:border-gray-700 p-5 bg-white dark:bg-gray-800">
          <h2 id="sec-incident" className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            {t('tenantRules.incidentTitle')}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {t('tenantRules.incidentHint')}
          </p>

          <label className="inline-flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100 mb-4">
            <Checkbox checked={form.incidentCompensationEnabled}
              onCheckedChange={c => set({ incidentCompensationEnabled: c as boolean })} />
            <span>{t('tenantRules.incidentCompensationEnabled')}</span>
          </label>

          {form.incidentCompensationEnabled && (
            <>
              <fieldset className="mb-4">
                <legend className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('tenantRules.compensationDelayTiers')}
                </legend>
                <div className="space-y-2">
                  {delayTiers.map((tier, i) => (
                    <div key={i} className="flex gap-2 items-end">
                      <label className="flex-1">
                        <span className="block text-xs text-gray-500 dark:text-gray-400">{t('tenantRules.delayMinutes')}</span>
                        <Input type="number" min="0" value={tier.delayMinutes}
                          onChange={e => {
                            const next = [...delayTiers];
                            next[i] = { ...tier, delayMinutes: parseInt(e.target.value, 10) || 0 };
                            set({ incidentCompensationDelayTiers: next });
                          }} />
                      </label>
                      <label className="flex-1">
                        <span className="block text-xs text-gray-500 dark:text-gray-400">{t('tenantRules.compensationPct')}</span>
                        <Input type="number" min="0" max="1" step="0.01" value={tier.compensationPct}
                          onChange={e => {
                            const next = [...delayTiers];
                            next[i] = { ...tier, compensationPct: Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)) };
                            set({ incidentCompensationDelayTiers: next });
                          }} />
                      </label>
                      <label className="flex-1">
                        <span className="block text-xs text-gray-500 dark:text-gray-400">{t('tenantRules.snackBundle')}</span>
                        <Select value={tier.snackBundle ?? ''}
                          onChange={e => {
                            const next = [...delayTiers];
                            next[i] = { ...tier, snackBundle: e.target.value || undefined };
                            set({ incidentCompensationDelayTiers: next });
                          }}
                          options={SNACK_BUNDLES.map(b => ({ value: b, label: b === '' ? t('common.none') : b }))} />
                      </label>
                      <Button variant="ghost" size="sm" type="button"
                        aria-label={t('common.delete')}
                        onClick={() => set({ incidentCompensationDelayTiers: delayTiers.filter((_, j) => j !== i) })}>
                        <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="secondary" size="sm" type="button"
                    leftIcon={<Plus className="w-4 h-4" aria-hidden="true" />}
                    onClick={() => set({ incidentCompensationDelayTiers: [...delayTiers, { delayMinutes: 0, compensationPct: 0 }] })}>
                    {t('tenantRules.addTier')}
                  </Button>
                </div>
              </fieldset>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block">
                  <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('tenantRules.compensationForm')}</span>
                  <Select value={form.incidentCompensationFormDefault}
                    onChange={e => set({ incidentCompensationFormDefault: e.target.value })}
                    options={COMP_FORMS.map(f => ({ value: f, label: t(`tenantRules.form.${f}`) }))} />
                </label>
                <label className="block">
                  <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('tenantRules.voucherUsageScope')}</span>
                  <Select value={form.incidentVoucherUsageScope}
                    onChange={e => set({ incidentVoucherUsageScope: e.target.value })}
                    options={VOUCHER_SCOPES.map(s => ({ value: s, label: t(`tenantRules.scope.${s}`) }))} />
                </label>
                <label className="block">
                  <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('tenantRules.voucherValidityDays')}</span>
                  <Input type="number" min="1" value={form.incidentVoucherValidityDays}
                    onChange={e => set({ incidentVoucherValidityDays: parseInt(e.target.value, 10) || 1 })} />
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100 self-end pb-2">
                  <Checkbox checked={form.incidentRefundProrataEnabled}
                    onCheckedChange={c => set({ incidentRefundProrataEnabled: c as boolean })} />
                  <span>{t('tenantRules.incidentRefundProrataEnabled')}</span>
                </label>
              </div>
            </>
          )}
        </section>

        {/* ── Section 4 : Colis hub & retrait ──────────────────────────── */}
        <section aria-labelledby="sec-parcel" className="rounded-lg border border-gray-200 dark:border-gray-700 p-5 bg-white dark:bg-gray-800">
          <h2 id="sec-parcel" className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            {t('tenantRules.parcelTitle')}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {t('tenantRules.parcelHint')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('tenantRules.parcelHubMaxStorageDays')}</span>
              <Input type="number" min="1" value={form.parcelHubMaxStorageDays}
                onChange={e => set({ parcelHubMaxStorageDays: parseInt(e.target.value, 10) || 1 })} />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('tenantRules.parcelPickupMaxDaysBeforeReturn')}</span>
              <Input type="number" min="1" value={form.parcelPickupMaxDaysBeforeReturn}
                onChange={e => set({ parcelPickupMaxDaysBeforeReturn: parseInt(e.target.value, 10) || 1 })} />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('tenantRules.parcelPickupNoShowAction')}</span>
              <Select value={form.parcelPickupNoShowAction}
                onChange={e => set({ parcelPickupNoShowAction: e.target.value })}
                options={PICKUP_ACTIONS.map(a => ({ value: a, label: t(`tenantRules.pickupAction.${a}`) }))} />
            </label>
          </div>
        </section>

        {/* ── Section 5 : Sécurité endpoints publics ───────────────────── */}
        <section aria-labelledby="sec-security" className="rounded-lg border border-gray-200 dark:border-gray-700 p-5 bg-white dark:bg-gray-800">
          <h2 id="sec-security" className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            {t('tenantRules.securityTitle')}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {t('tenantRules.securityHint')}
          </p>
          <div className="space-y-4">
            <label className="flex items-start gap-3">
              <Checkbox
                checked={form.captchaEnabled}
                onCheckedChange={(checked) => set({ captchaEnabled: !!checked })}
                aria-describedby="captcha-help"
              />
              <span>
                <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('tenantRules.captchaEnabled')}</span>
                <span id="captcha-help" className="block text-xs text-gray-500 dark:text-gray-400 mt-1">{t('tenantRules.captchaEnabledHint')}</span>
              </span>
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('tenantRules.dailyMagicLinkBudget')}</span>
                <Input type="number" min="0" value={form.dailyMagicLinkBudget}
                  onChange={e => set({ dailyMagicLinkBudget: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">{t('tenantRules.dailyMagicLinkBudgetHint')}</span>
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('tenantRules.magicLinkPhoneCooldownHours')}</span>
                <Input type="number" min="0" max="168" value={form.magicLinkPhoneCooldownHours}
                  onChange={e => set({ magicLinkPhoneCooldownHours: Math.max(0, Math.min(168, parseInt(e.target.value, 10) || 0)) })} />
                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">{t('tenantRules.magicLinkPhoneCooldownHoursHint')}</span>
              </label>
            </div>
          </div>
        </section>

        {/* ── Section 6 : Briefing pré-voyage QHSE (2026-04-24) ────────── */}
        <section aria-labelledby="sec-briefing" className="rounded-lg border border-gray-200 dark:border-gray-700 p-5 bg-white dark:bg-gray-800">
          <h2 id="sec-briefing" className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            {t('tenantRules.briefingTitle')}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {t('tenantRules.briefingHint')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('tenantRules.preTripBriefingPolicy')}</span>
              <select
                value={form.preTripBriefingPolicy}
                onChange={e => set({ preTripBriefingPolicy: e.target.value as BusinessRules['preTripBriefingPolicy'] })}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2"
                aria-label={t('tenantRules.preTripBriefingPolicy')}
              >
                <option value="OFF">{t('tenantRules.preTripPolicy.OFF')}</option>
                <option value="RECOMMENDED">{t('tenantRules.preTripPolicy.RECOMMENDED')}</option>
                <option value="RECOMMENDED_WITH_ALERT">{t('tenantRules.preTripPolicy.RECOMMENDED_WITH_ALERT')}</option>
              </select>
            </label>

            <label className="block">
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('tenantRules.mandatoryItemFailurePolicy')}</span>
              <select
                value={form.mandatoryItemFailurePolicy}
                onChange={e => set({ mandatoryItemFailurePolicy: e.target.value as BusinessRules['mandatoryItemFailurePolicy'] })}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2"
                aria-label={t('tenantRules.mandatoryItemFailurePolicy')}
              >
                <option value="WARN_ONLY">{t('tenantRules.mandatoryFailurePolicy.WARN_ONLY')}</option>
                <option value="ALERT_MANAGER">{t('tenantRules.mandatoryFailurePolicy.ALERT_MANAGER')}</option>
                <option value="BLOCK_DEPARTURE">{t('tenantRules.mandatoryFailurePolicy.BLOCK_DEPARTURE')}</option>
              </select>
            </label>

            <label className="block">
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('tenantRules.restShortfallPolicy')}</span>
              <select
                value={form.restShortfallPolicy}
                onChange={e => set({ restShortfallPolicy: e.target.value as BusinessRules['restShortfallPolicy'] })}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2"
                aria-label={t('tenantRules.restShortfallPolicy')}
              >
                <option value="WARN">{t('tenantRules.restShortfallPolicy.WARN')}</option>
                <option value="ALERT">{t('tenantRules.restShortfallPolicy.ALERT')}</option>
                <option value="BLOCK">{t('tenantRules.restShortfallPolicy.BLOCK')}</option>
              </select>
            </label>

            <label className="block">
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('tenantRules.minDriverRestHours')}</span>
              <Input type="number" min="0" max="72" value={form.minDriverRestHours}
                onChange={e => set({ minDriverRestHours: Math.max(0, Math.min(72, parseInt(e.target.value, 10) || 0)) })} />
              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">{t('tenantRules.minDriverRestHoursHint')}</span>
            </label>
          </div>
        </section>

        {saveErr && <ErrorAlert error={saveErr} />}
        {saved && (
          <div role="status" className="text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" aria-hidden="true" />
            {t('tenantRules.saved')}
          </div>
        )}
        <FormFooter
          submitLabel={t('common.save')}
          pendingLabel={t('common.saving')}
          busy={saving}
          onCancel={() => data && setForm(parseJson(data))}
        />
      </form>
    </div>
  );
}
