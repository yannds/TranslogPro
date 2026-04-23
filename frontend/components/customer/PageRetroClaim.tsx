/**
 * PageRetroClaim — Portail CUSTOMER : "Retrouver un voyage ou un colis"
 *
 * Flow en 2 étapes :
 *   1. initiate : saisir (target TICKET|PARCEL, code, phone) → reçoit OTP SMS
 *   2. confirm  : saisir l'OTP 6 chiffres → rattache le Customer shadow à son compte
 *
 * Contrat :
 *   - i18n 8 locales (clés `retroClaim.*`)
 *   - WCAG AA : labels, aria-live, focus visible
 *   - Responsive, dark + light (défaut)
 *   - Composants existants (Button, Card, inputClass, ErrorAlert)
 */

import { useState, type FormEvent } from 'react';
import { History, ShieldCheck, CheckCircle2, ArrowRight } from 'lucide-react';
import { useAuth }    from '../../lib/auth/auth.context';
import { useI18n }    from '../../lib/i18n/useI18n';
import { useTenantConfig } from '../../providers/TenantConfigProvider';
import { getPhonePlaceholder } from '../../lib/config/phone.config';
import { apiPost }    from '../../lib/api';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Button }     from '../ui/Button';
import { Badge }      from '../ui/Badge';
import { ErrorAlert } from '../ui/ErrorAlert';
import { inputClass as inp } from '../ui/inputClass';

type Target = 'TICKET' | 'PARCEL';

interface InitiateForm {
  target: Target;
  code:   string;
  phone:  string;
}

interface InitiateResp { channel: 'WHATSAPP' | 'SMS'; expiresIn: number }

interface ConfirmResp  { customerId: string; targetId: string }

const OTP_DIGITS = 6;

function mapError(err: unknown): string {
  const msg = (err as Error)?.message ?? '';
  // Les codes côté backend sont mappés vers des clés i18n
  if (msg.includes('retro_claim_not_eligible'))     return 'retroClaim.errorNotEligible';
  if (msg.includes('retro_claim_rate_limit_phone')) return 'retroClaim.errorRateLimitPhone';
  if (msg.includes('phone_invalid'))                return 'retroClaim.errorPhoneInvalid';
  if (msg.includes('ticket_not_found'))             return 'retroClaim.errorTicketNotFound';
  if (msg.includes('parcel_not_found'))             return 'retroClaim.errorParcelNotFound';
  if (msg.includes('otp_invalid'))                  return 'retroClaim.errorOtpInvalid';
  if (msg.includes('otp_not_found_or_expired'))     return 'retroClaim.errorOtpExpired';
  if (msg.includes('otp_max_attempts_exceeded'))    return 'retroClaim.errorOtpMaxAttempts';
  if (msg.includes('user_not_in_tenant'))           return 'retroClaim.errorUserMismatch';
  if (msg.includes('user_already_linked'))          return 'retroClaim.errorAlreadyLinked';
  return 'retroClaim.errorGeneric';
}

export function PageRetroClaim() {
  const { t }    = useI18n();
  const { user } = useAuth();
  const { operational } = useTenantConfig();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/tenants/${tenantId}/customer/claim`;

  const [step, setStep]           = useState<1 | 2 | 3>(1);
  const [form, setForm]           = useState<InitiateForm>({ target: 'TICKET', code: '', phone: '' });
  const [otp, setOtp]             = useState('');
  const [channel, setChannel]     = useState<'WHATSAPP' | 'SMS' | null>(null);
  const [result, setResult]       = useState<ConfirmResp | null>(null);
  const [busy, setBusy]           = useState(false);
  const [errorKey, setErrorKey]   = useState<string | null>(null);

  const patch = (p: Partial<InitiateForm>) => setForm(prev => ({ ...prev, ...p }));

  const handleInitiate = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.code.trim() || !form.phone.trim()) return;
    setBusy(true); setErrorKey(null);
    try {
      const resp = await apiPost<InitiateResp>(`${base}/initiate`, {
        target: form.target,
        code:   form.code.trim(),
        phone:  form.phone.trim(),
      });
      setChannel(resp.channel);
      setStep(2);
    } catch (err) {
      setErrorKey(mapError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async (e: FormEvent) => {
    e.preventDefault();
    if (otp.length !== OTP_DIGITS) return;
    setBusy(true); setErrorKey(null);
    try {
      const resp = await apiPost<ConfirmResp>(`${base}/confirm`, {
        target: form.target,
        code:   form.code.trim(),
        phone:  form.phone.trim(),
        otp,
      });
      setResult(resp);
      setStep(3);
    } catch (err) {
      setErrorKey(mapError(err));
    } finally {
      setBusy(false);
    }
  };

  const resetFlow = () => {
    setStep(1); setForm({ target: 'TICKET', code: '', phone: '' });
    setOtp(''); setErrorKey(null); setResult(null); setChannel(null);
  };

  return (
    <main
      role="main"
      aria-labelledby="retro-claim-title"
      className="p-6 max-w-2xl mx-auto"
    >
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
          <History className="w-5 h-5 text-indigo-600 dark:text-indigo-400" aria-hidden />
        </div>
        <div>
          <h1 id="retro-claim-title" className="text-2xl font-bold text-slate-900 dark:text-white">
            {t('retroClaim.title')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('retroClaim.subtitle')}
          </p>
        </div>
      </div>

      {/* Stepper */}
      <ol
        role="list"
        aria-label={t('retroClaim.stepsLabel')}
        className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-6"
      >
        {[1, 2, 3].map(n => (
          <li key={n} className="flex items-center gap-2">
            <span
              aria-current={step === n ? 'step' : undefined}
              className={[
                'w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold',
                step === n
                  ? 'bg-indigo-600 text-white'
                  : step > n
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
              ].join(' ')}
            >
              {step > n ? '✓' : n}
            </span>
            <span className={step === n ? 'font-semibold text-slate-900 dark:text-white' : ''}>
              {t(`retroClaim.step${n}`)}
            </span>
            {n < 3 && <span aria-hidden className="text-slate-300 dark:text-slate-600">/</span>}
          </li>
        ))}
      </ol>

      {/* Étape 1 : saisie */}
      {step === 1 && (
        <Card>
          <CardHeader heading={t('retroClaim.step1Title')} description={t('retroClaim.step1Desc')} />
          <CardContent>
            <form onSubmit={handleInitiate} className="space-y-4">
              {errorKey && <ErrorAlert error={t(errorKey)} icon />}

              <div className="space-y-1.5">
                <label htmlFor="rc-target" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t('retroClaim.target')}
                </label>
                <div
                  role="radiogroup"
                  aria-label={t('retroClaim.target')}
                  className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5"
                >
                  {(['TICKET', 'PARCEL'] as const).map(tgt => (
                    <button
                      key={tgt}
                      type="button"
                      role="radio"
                      aria-checked={form.target === tgt}
                      onClick={() => patch({ target: tgt })}
                      disabled={busy}
                      className={[
                        'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                        'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1',
                        form.target === tgt
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
                      ].join(' ')}
                    >
                      {t(`retroClaim.target_${tgt}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="rc-code" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t(form.target === 'TICKET' ? 'retroClaim.codeTicket' : 'retroClaim.codeParcel')}
                  <span aria-hidden className="text-red-500 ml-1">*</span>
                </label>
                <input
                  id="rc-code" type="text" required
                  value={form.code}
                  onChange={e => patch({ code: e.target.value })}
                  className={inp} disabled={busy}
                  placeholder={t(form.target === 'TICKET' ? 'retroClaim.codeTicketPlaceholder' : 'retroClaim.codeParcelPlaceholder')}
                  autoComplete="off"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="rc-phone" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t('retroClaim.phone')} <span aria-hidden className="text-red-500">*</span>
                </label>
                <input
                  id="rc-phone" type="tel" required
                  value={form.phone}
                  onChange={e => patch({ phone: e.target.value })}
                  className={inp} disabled={busy}
                  placeholder={getPhonePlaceholder(operational.country)}
                  autoComplete="tel"
                  aria-describedby="rc-phone-help"
                />
                <p id="rc-phone-help" className="text-xs text-slate-500 dark:text-slate-400">
                  {t('retroClaim.phoneHelp')}
                </p>
              </div>

              <div className="flex justify-end">
                <Button type="submit" loading={busy} disabled={busy}>
                  {t('retroClaim.sendOtp')}
                  <ArrowRight className="w-4 h-4 ml-1.5" aria-hidden />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Étape 2 : OTP */}
      {step === 2 && (
        <Card>
          <CardHeader heading={t('retroClaim.step2Title')} description={t('retroClaim.step2Desc')} />
          <CardContent>
            <form onSubmit={handleConfirm} className="space-y-4">
              {errorKey && <ErrorAlert error={t(errorKey)} icon />}

              {channel && (
                <Badge variant="info">
                  {channel === 'WHATSAPP' ? t('retroClaim.sentViaWhatsapp') : t('retroClaim.sentViaSms')}
                </Badge>
              )}

              <div className="space-y-1.5">
                <label htmlFor="rc-otp" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t('retroClaim.otpLabel')}
                </label>
                <input
                  id="rc-otp" type="text" inputMode="numeric" pattern="\d{6}"
                  maxLength={6} required
                  value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className={`${inp} text-center tracking-[0.5em] font-mono text-xl`}
                  disabled={busy}
                  autoComplete="one-time-code"
                  aria-describedby="rc-otp-help"
                />
                <p id="rc-otp-help" className="text-xs text-slate-500 dark:text-slate-400">
                  {t('retroClaim.otpHelp')}
                </p>
              </div>

              <div className="flex justify-between gap-3">
                <Button type="button" variant="outline" onClick={resetFlow} disabled={busy}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" loading={busy} disabled={busy || otp.length !== OTP_DIGITS}>
                  {t('retroClaim.verify')}
                  <ShieldCheck className="w-4 h-4 ml-1.5" aria-hidden />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Étape 3 : succès */}
      {step === 3 && result && (
        <Card>
          <CardContent className="space-y-5 py-8">
            <div className="flex flex-col items-center text-center gap-3">
              <div className="p-3 rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" aria-hidden />
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                {t('retroClaim.successTitle')}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md">
                {t('retroClaim.successDesc')}
              </p>
              <div className="flex gap-3 mt-2">
                <Button variant="outline" onClick={resetFlow}>
                  {t('retroClaim.addAnother')}
                </Button>
                <Button onClick={() => { window.location.href = '/customer'; }}>
                  {t('retroClaim.seeHistory')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}

export default PageRetroClaim;
