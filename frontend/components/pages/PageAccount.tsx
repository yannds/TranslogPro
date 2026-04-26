/**
 * PageAccount — Self-service utilisateur (tous les rôles authentifiés).
 *
 * Trois onglets :
 *   - Profil       : lecture rôle, tenant, email (pas d'édition ici — le nom
 *                    propre reste géré côté IAM, pour éviter de diverger du
 *                    parcours d'onboarding).
 *   - Sécurité     : changement de mot de passe + carte MFA (activer/désactiver
 *                    TOTP avec QR code + codes de secours).
 *   - Préférences  : locale (8 langues) + timezone (select IANA).
 *
 * Endpoints consommés :
 *   POST   /api/auth/change-password   { currentPassword, newPassword }
 *   PATCH  /api/auth/me/preferences    { locale?, timezone? }
 *   POST   /api/mfa/setup                                  → { otpauthUrl, secret, qrDataUrl }
 *   GET    /api/mfa/status                                 → { enabled, verifiedAt, backupCodesRemaining, pendingSetup }
 *   POST   /api/mfa/enable          { code }               → { backupCodes[] }
 *   POST   /api/mfa/disable         { code }
 *   POST   /api/mfa/backup-codes/regenerate   { code }     → { backupCodes[] }
 *   GET    /api/auth/sessions                              → Array<{ id, ipAddress, userAgent, createdAt, expiresAt, isCurrent }>
 *   DELETE /api/auth/sessions/:id                          → 204
 *   DELETE /api/auth/sessions                              → { revoked }
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { useSearchParams } from 'react-router-dom';
import {
  UserCircle2, ShieldCheck, SlidersHorizontal, Save, KeyRound,
  Smartphone, Check, X, AlertTriangle, Copy, CheckCircle2, CreditCard,
  RefreshCw, Trash2, Globe, Monitor,
} from 'lucide-react';
import { useAuth }  from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { apiGet, apiPost, apiDelete, ApiError } from '../../lib/api';
import { Button } from '../ui/Button';
import { Badge }  from '../ui/Badge';
import { PageAdminBilling } from './PageAdminBilling';

// ─── Tokens ───────────────────────────────────────────────────────────────────

const inp = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30 disabled:opacity-50';

type Tab = 'profile' | 'security' | 'preferences' | 'billing';

/**
 * Permission requise pour voir/éditer l'onglet Billing. Doit rester alignée avec
 * la garde serveur `SETTINGS_MANAGE_TENANT` sur `SubscriptionCheckoutController`
 * (défense en profondeur — un rôle qui n'a pas cette perm renvoie 403 sur tous
 * les endpoints /api/subscription/*, même s'il accède à l'URL directement).
 */
const BILLING_PERMISSION = 'control.settings.manage.tenant';

// Les 8 locales publiquement supportées dans l'UI TranslogPro. La source
// canonique reste le dossier frontend/lib/i18n/locales/. Ajouter une langue
// ici ET dans le dossier en parallèle.
const LOCALES = [
  { value: 'fr',  label: 'Français' },
  { value: 'en',  label: 'English' },
  { value: 'pt',  label: 'Português' },
  { value: 'es',  label: 'Español' },
  { value: 'ar',  label: 'العربية' },
  { value: 'ln',  label: 'Lingala' },
  { value: 'ktu', label: 'Kituba' },
  { value: 'wo',  label: 'Wolof' },
];

// Sélection pragmatique de fuseaux courants (Afrique centrale/ouest + Europe).
// Les admins peuvent toujours basculer vers une TZ non listée via la config
// tenant — ce dropdown couvre 95% des cas opérationnels.
const TIMEZONES = [
  'Africa/Brazzaville',
  'Africa/Kinshasa',
  'Africa/Dakar',
  'Africa/Abidjan',
  'Africa/Lagos',
  'Africa/Cairo',
  'Europe/Paris',
  'Europe/London',
  'UTC',
];

// ─── Sous-composants ──────────────────────────────────────────────────────────

function TabButton({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors inline-flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
        active ? 'border-teal-500 t-text' : 'border-transparent t-text-2 hover:t-text'
      }`}
    >
      {icon}{label}
    </button>
  );
}

function Card({ title, description, children }: {
  title: string; description?: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-4">
      <header>
        <h3 className="text-base font-semibold t-text">{title}</h3>
        {description && <p className="text-xs t-text-3 mt-0.5">{description}</p>}
      </header>
      {children}
    </section>
  );
}

// ─── Onglet Profil ────────────────────────────────────────────────────────────

function ProfileTab() {
  const { user } = useAuth();
  const { t }    = useI18n();

  if (!user) return null;

  return (
    <Card title={t('account.profileTitle')} description={t('account.profileDesc')}>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs t-text-3">{t('account.fieldEmail')}</dt>
          <dd className="mt-0.5 t-text">{user.email}</dd>
        </div>
        <div>
          <dt className="text-xs t-text-3">{t('account.fieldName')}</dt>
          <dd className="mt-0.5 t-text">{user.name ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs t-text-3">{t('account.fieldRole')}</dt>
          <dd className="mt-0.5"><Badge variant="info">{user.roleName ?? user.userType}</Badge></dd>
        </div>
        <div>
          <dt className="text-xs t-text-3">{t('account.fieldUserType')}</dt>
          <dd className="mt-0.5 t-text font-mono text-xs">{user.userType}</dd>
        </div>
      </dl>
    </Card>
  );
}

// ─── Onglet Sécurité : changement de mot de passe + MFA ───────────────────────

function SecurityTab() {
  const { user, changePassword } = useAuth();
  const { t } = useI18n();

  const [current, setCurrent] = useState('');
  const [next, setNext]       = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState<string | null>(null);
  const [ok, setOk]           = useState(false);

  async function handlePwdSubmit(e: FormEvent) {
    e.preventDefault(); setErr(null); setOk(false);
    if (next !== confirm) { setErr(t('account.pwdMismatch')); return; }
    if (next.length < 8)  { setErr(t('account.pwdTooShort')); return; }
    setBusy(true);
    try {
      await changePassword(current, next);
      // Le contexte redirige déjà vers /login — pas besoin de setOk ici.
      setOk(true);
    } catch (e) {
      setErr(e instanceof ApiError
        ? String((e.body as { message?: string })?.message ?? e.message)
        : t('account.pwdFailed'));
      setBusy(false);
    }
  }

  // ── Carte MFA ──
  // On consomme `otpauthUrl` (toujours présent dans la réponse) pour rendre
  // le QR localement via `qrcode.toCanvas` — pas de data: URI dans le DOM,
  // donc indépendant de la CSP `img-src` du frontend (Vite, nginx, SW PWA).
  // Le champ legacy `qrDataUrl` reste lu si présent mais n'est plus requis.
  const [mfaSetup, setMfaSetup] = useState<{ otpauthUrl: string; secret: string } | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mfaCode,  setMfaCode]  = useState('');
  const [mfaBusy,  setMfaBusy]  = useState(false);
  const [mfaErr,   setMfaErr]   = useState<string | null>(null);
  const [backup,   setBackup]   = useState<string[] | null>(null);
  // Désactivation : on demande le code TOTP, pas le mot de passe (le service
  // attend `{ code }`. Confondre les deux causait un 400 "property password
  // should not exist" à la désactivation).
  const [disCode,  setDisCode]  = useState('');
  const [showDis,  setShowDis]  = useState(false);
  // Régénération codes de secours.
  const [showRegen, setShowRegen] = useState(false);
  const [regenCode, setRegenCode] = useState('');

  // Statut MFA dérivé du backend (date d'activation, codes restants).
  const [mfaStatus, setMfaStatus] = useState<{
    enabled:              boolean;
    verifiedAt:           string | null;
    backupCodesRemaining: number;
    pendingSetup:         boolean;
  } | null>(null);

  const reloadMfaStatus = useCallback(async () => {
    try {
      const s = await apiGet<{
        enabled: boolean; verifiedAt: string | null;
        backupCodesRemaining: number; pendingSetup: boolean;
      }>('/api/mfa/status');
      setMfaStatus(s);
    } catch {
      // En cas d'erreur on retombe sur le user.mfaEnabled du contexte (pas de blocage).
      setMfaStatus(null);
    }
  }, []);
  useEffect(() => { void reloadMfaStatus(); }, [reloadMfaStatus]);

  const mfaEnabled = mfaStatus?.enabled ?? user?.mfaEnabled ?? false;

  // Rendu du QR sur canvas dès que mfaSetup.otpauthUrl est disponible.
  // Aucun data: URI n'est exposé au DOM — toute CSP img-src ne peut bloquer.
  useEffect(() => {
    if (!mfaSetup?.otpauthUrl || !qrCanvasRef.current) return;
    QRCode.toCanvas(qrCanvasRef.current, mfaSetup.otpauthUrl, { width: 192, margin: 1 })
      .catch((err: unknown) => {
        // En dernier recours, on log et l'utilisateur peut toujours saisir
        // le secret manuellement (champ "Secret" affiché juste en dessous).
        // eslint-disable-next-line no-console
        console.error('[MFA] QR render failed', err);
      });
  }, [mfaSetup?.otpauthUrl]);

  async function startMfaSetup() {
    setMfaBusy(true); setMfaErr(null);
    try {
      const out = await apiPost<{ otpauthUrl: string; secret: string }>('/api/mfa/setup', {});
      setMfaSetup(out);
    } catch (e) {
      setMfaErr(e instanceof ApiError ? String((e.body as any)?.message ?? e.message) : String(e));
    } finally { setMfaBusy(false); }
  }

  async function confirmMfaEnable() {
    setMfaBusy(true); setMfaErr(null);
    try {
      const out = await apiPost<{ backupCodes: string[] }>('/api/mfa/enable', { code: mfaCode });
      setBackup(out.backupCodes);
      setMfaSetup(null); setMfaCode('');
      await reloadMfaStatus();
    } catch (e) {
      setMfaErr(e instanceof ApiError ? String((e.body as any)?.message ?? e.message) : String(e));
    } finally { setMfaBusy(false); }
  }

  async function disableMfa() {
    setMfaBusy(true); setMfaErr(null);
    try {
      // Backend attend { code } TOTP (cf. MfaService.disable). Le mot de passe
      // n'est PAS requis ici — la possession du second facteur est suffisante.
      await apiPost('/api/mfa/disable', { code: disCode });
      setDisCode(''); setShowDis(false);
      await reloadMfaStatus();
      window.location.reload(); // Force /me refresh — UX simple
    } catch (e) {
      setMfaErr(e instanceof ApiError ? String((e.body as any)?.message ?? e.message) : String(e));
    } finally { setMfaBusy(false); }
  }

  async function regenerateBackupCodes() {
    setMfaBusy(true); setMfaErr(null);
    try {
      const out = await apiPost<{ backupCodes: string[] }>(
        '/api/mfa/backup-codes/regenerate',
        { code: regenCode },
      );
      setBackup(out.backupCodes);
      setRegenCode(''); setShowRegen(false);
      await reloadMfaStatus();
    } catch (e) {
      setMfaErr(e instanceof ApiError ? String((e.body as any)?.message ?? e.message) : String(e));
    } finally { setMfaBusy(false); }
  }

  return (
    <div className="space-y-6">
      {user?.mustChangePassword && (
        <div role="alert" className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
          <span>{t('account.mustChangePassword')}</span>
        </div>
      )}

      {user?.mustEnrollMfa && (
        <div role="alert" className="rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 px-4 py-3 text-sm text-rose-800 dark:text-rose-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
          <span>{t('account.mustEnrollMfa')}</span>
        </div>
      )}

      <Card title={t('account.pwdTitle')} description={t('account.pwdDesc')}>
        <form onSubmit={handlePwdSubmit} className="space-y-3">
          {err && (
            <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {err}
            </div>
          )}
          {ok && (
            <div role="status" className="rounded-lg bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 px-3 py-2 text-sm text-teal-700 dark:text-teal-300 flex items-center gap-2">
              <Check className="w-4 h-4" aria-hidden />{t('account.pwdOk')}
            </div>
          )}
          <div className="space-y-1.5">
            <label htmlFor="pwd-current" className="block text-sm font-medium t-text">
              {t('account.pwdCurrent')}
            </label>
            <input id="pwd-current" type="password" autoComplete="current-password"
              required value={current} onChange={e => setCurrent(e.target.value)}
              className={inp} disabled={busy} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="pwd-new" className="block text-sm font-medium t-text">
                {t('account.pwdNew')}
              </label>
              <input id="pwd-new" type="password" autoComplete="new-password"
                required minLength={8} value={next} onChange={e => setNext(e.target.value)}
                className={inp} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="pwd-confirm" className="block text-sm font-medium t-text">
                {t('account.pwdConfirm')}
              </label>
              <input id="pwd-confirm" type="password" autoComplete="new-password"
                required minLength={8} value={confirm} onChange={e => setConfirm(e.target.value)}
                className={inp} disabled={busy} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !current || !next || !confirm}>
              <KeyRound className="w-4 h-4 mr-1.5" aria-hidden />
              {busy ? t('common.saving') : t('account.pwdSubmit')}
            </Button>
          </div>
        </form>
      </Card>

      <Card title={t('account.mfaTitle')} description={t('account.mfaDesc')}>
        {mfaErr && (
          <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {mfaErr}
          </div>
        )}

        {!mfaEnabled && !mfaSetup && !backup && (
          <div className="flex items-center gap-3 justify-between">
            <p className="text-sm t-text-body">{t('account.mfaStatusOff')}</p>
            <Button onClick={startMfaSetup} disabled={mfaBusy}>
              <Smartphone className="w-4 h-4 mr-1.5" aria-hidden />{t('account.mfaActivate')}
            </Button>
          </div>
        )}

        {mfaSetup && (
          <div className="space-y-3">
            <p className="text-sm t-text-body">{t('account.mfaScanHint')}</p>
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              <canvas
                ref={qrCanvasRef}
                aria-label="QR TOTP"
                role="img"
                className="w-48 h-48 rounded border border-slate-200 dark:border-slate-700 bg-white"
              />
              <div className="space-y-2 flex-1">
                <p className="text-xs t-text-3">{t('account.mfaSecretLabel')}</p>
                <code className="block text-[11px] font-mono break-all t-text bg-slate-50 dark:bg-slate-800 rounded px-2 py-1">{mfaSetup.secret}</code>
                <label className="block text-xs font-medium t-text mt-2">{t('account.mfaCodeLabel')}</label>
                <input
                  type="text" inputMode="numeric" pattern="\d{6}"
                  value={mfaCode}
                  onChange={e => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className={`${inp} font-mono text-center tracking-widest`}
                  disabled={mfaBusy}
                />
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => { setMfaSetup(null); setMfaCode(''); }} disabled={mfaBusy}>
                    <X className="w-4 h-4 mr-1.5" aria-hidden />{t('common.cancel')}
                  </Button>
                  <Button onClick={confirmMfaEnable} disabled={mfaBusy || mfaCode.length !== 6}>
                    <Check className="w-4 h-4 mr-1.5" aria-hidden />
                    {mfaBusy ? t('common.saving') : t('account.mfaConfirm')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {backup && (
          <div className="space-y-2">
            <div className="rounded-lg bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 px-3 py-2 text-sm text-teal-800 dark:text-teal-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" aria-hidden />{t('account.mfaEnabledOk')}
            </div>
            <p className="text-xs font-medium t-text">{t('account.mfaBackupTitle')}</p>
            <p className="text-xs t-text-3">{t('account.mfaBackupHint')}</p>
            <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {backup.map(c => (
                <li key={c} className="font-mono text-sm t-text bg-slate-50 dark:bg-slate-800 rounded px-2 py-1 text-center">{c}</li>
              ))}
            </ul>
            <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(backup.join('\n')).catch(() => {})}>
              <Copy className="w-3 h-3 mr-1" aria-hidden />{t('common.copy')}
            </Button>
          </div>
        )}

        {mfaEnabled && !mfaSetup && !backup && (
          <div className="space-y-4">
            {/* Bandeau statut */}
            <div className="rounded-lg bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 px-4 py-3">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" aria-hidden />
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium text-teal-900 dark:text-teal-100">
                    {t('account.mfaStatusOn')}
                  </p>
                  <dl className="text-xs text-teal-800 dark:text-teal-300 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                    <div className="flex gap-1.5">
                      <dt className="font-medium">{t('account.mfaMethodLabel')}:</dt>
                      <dd>{t('account.mfaMethodTotp')}</dd>
                    </div>
                    {mfaStatus?.verifiedAt && (
                      <div className="flex gap-1.5">
                        <dt className="font-medium">{t('account.mfaActiveSince')}:</dt>
                        <dd><time dateTime={mfaStatus.verifiedAt}>
                          {new Date(mfaStatus.verifiedAt).toLocaleDateString(undefined, {
                            day: 'numeric', month: 'long', year: 'numeric',
                          })}
                        </time></dd>
                      </div>
                    )}
                    <div className="flex gap-1.5">
                      <dt className="font-medium">{t('account.mfaBackupRemaining')}:</dt>
                      <dd>
                        <span className={(mfaStatus?.backupCodesRemaining ?? 0) <= 2
                          ? 'font-semibold text-amber-700 dark:text-amber-400'
                          : ''
                        }>
                          {mfaStatus?.backupCodesRemaining ?? 0} / 10
                        </span>
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 justify-end">
              {!showDis && !showRegen && (
                <>
                  <Button variant="outline" onClick={() => setShowRegen(true)} disabled={mfaBusy}>
                    <RefreshCw className="w-4 h-4 mr-1.5" aria-hidden />
                    {t('account.mfaRegenBackup')}
                  </Button>
                  <Button variant="outline" onClick={() => setShowDis(true)} disabled={mfaBusy}>
                    {t('account.mfaDeactivate')}
                  </Button>
                </>
              )}
            </div>

            {/* Régénération codes de secours */}
            {showRegen && (
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 px-3 py-3 space-y-2">
                <p className="text-xs t-text-body">{t('account.mfaRegenWarn')}</p>
                <label className="block text-xs font-medium t-text">{t('account.mfaCodeLabel')}</label>
                <input
                  type="text" inputMode="numeric" pattern="\d{6}"
                  value={regenCode}
                  onChange={e => setRegenCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className={`${inp} font-mono text-center tracking-widest`}
                  disabled={mfaBusy}
                />
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => { setShowRegen(false); setRegenCode(''); }} disabled={mfaBusy}>
                    <X className="w-4 h-4 mr-1.5" aria-hidden />{t('common.cancel')}
                  </Button>
                  <Button onClick={regenerateBackupCodes} disabled={mfaBusy || regenCode.length !== 6}>
                    <RefreshCw className="w-4 h-4 mr-1.5" aria-hidden />
                    {mfaBusy ? t('common.saving') : t('account.mfaRegenConfirm')}
                  </Button>
                </div>
              </div>
            )}

            {/* Désactivation */}
            {showDis && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 px-3 py-3 space-y-2">
                <p className="text-xs text-amber-800 dark:text-amber-300">{t('account.mfaDisableWarn')}</p>
                <label className="block text-xs font-medium t-text">{t('account.mfaCodeLabel')}</label>
                <input
                  type="text" inputMode="numeric" pattern="\d{6}"
                  value={disCode}
                  onChange={e => setDisCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className={`${inp} font-mono text-center tracking-widest`}
                  disabled={mfaBusy}
                  autoComplete="off"
                />
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => { setShowDis(false); setDisCode(''); }} disabled={mfaBusy}>
                    {t('common.cancel')}
                  </Button>
                  <Button onClick={disableMfa} disabled={mfaBusy || disCode.length !== 6}
                    className="bg-red-600 hover:bg-red-700 text-white border-red-600">
                    {mfaBusy ? t('common.saving') : t('account.mfaDeactivateConfirm')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      <SessionsCard />
    </div>
  );
}

// ─── Carte Sessions actives ────────────────────────────────────────────────

interface SessionRow {
  id:         string;
  ipAddress:  string | null;
  userAgent:  string | null;
  createdAt:  string;
  expiresAt:  string;
  isCurrent:  boolean;
}

function SessionsCard() {
  const { t } = useI18n();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const data = await apiGet<SessionRow[]>('/api/auth/sessions');
      setRows(data);
    } catch (e) {
      setErr(e instanceof ApiError ? String((e.body as any)?.message ?? e.message) : String(e));
    } finally { setBusy(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  async function revokeOne(id: string) {
    setBusyId(id); setErr(null);
    try {
      await apiDelete(`/api/auth/sessions/${id}`);
      await reload();
    } catch (e) {
      setErr(e instanceof ApiError ? String((e.body as any)?.message ?? e.message) : String(e));
    } finally { setBusyId(null); }
  }

  async function revokeAllOthers() {
    setBusy(true); setErr(null);
    try {
      await apiDelete('/api/auth/sessions');
      await reload();
    } catch (e) {
      setErr(e instanceof ApiError ? String((e.body as any)?.message ?? e.message) : String(e));
    } finally { setBusy(false); }
  }

  const others = rows.filter(r => !r.isCurrent);

  return (
    <Card title={t('account.sessionsTitle')} description={t('account.sessionsDesc')}>
      {err && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300 mb-3">
          {err}
        </div>
      )}

      {others.length > 0 && (
        <div className="flex justify-end mb-3">
          <Button variant="outline" size="sm" onClick={revokeAllOthers} disabled={busy}>
            <Trash2 className="w-4 h-4 mr-1.5" aria-hidden />
            {t('account.sessionsRevokeOthers')}
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm t-text-3">{busy ? t('common.loading') : t('account.sessionsEmpty')}</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {rows.map(r => (
            <li key={r.id} className="py-3 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-0.5">
                  <Monitor className="w-4 h-4 t-text-3 shrink-0" aria-hidden />
                  <span className="text-sm t-text font-medium truncate">
                    {compactUserAgent(r.userAgent)}
                  </span>
                  {r.isCurrent && (
                    <Badge variant="success">{t('account.sessionsCurrent')}</Badge>
                  )}
                </div>
                <dl className="text-xs t-text-3 flex flex-wrap gap-x-4 gap-y-0.5">
                  {r.ipAddress && (
                    <div className="flex gap-1">
                      <dt className="inline-flex items-center gap-1"><Globe className="w-3 h-3" aria-hidden />IP:</dt>
                      <dd className="font-mono">{r.ipAddress}</dd>
                    </div>
                  )}
                  <div className="flex gap-1">
                    <dt>{t('account.sessionsStarted')}:</dt>
                    <dd><time dateTime={r.createdAt}>{formatDateTime(r.createdAt)}</time></dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>{t('account.sessionsExpires')}:</dt>
                    <dd><time dateTime={r.expiresAt}>{formatDateTime(r.expiresAt)}</time></dd>
                  </div>
                </dl>
              </div>
              {!r.isCurrent && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => revokeOne(r.id)}
                  disabled={busyId === r.id || busy}
                  aria-label={t('account.sessionsRevokeOne')}
                >
                  <Trash2 className="w-4 h-4" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function compactUserAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  // On extrait juste le nom du browser + OS pour un affichage lisible.
  const browserMatch = ua.match(/(Chrome|Safari|Firefox|Edge|Opera)\/[\d.]+/);
  const osMatch      = ua.match(/(Windows|Mac OS X|Linux|Android|iPhone OS|iPad)/);
  const browser = browserMatch ? browserMatch[1] : 'Browser';
  const os      = osMatch ? osMatch[1].replace('Mac OS X', 'macOS').replace('iPhone OS', 'iOS') : '';
  return os ? `${browser} — ${os}` : browser;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ─── Onglet Préférences ───────────────────────────────────────────────────────

function PreferencesTab() {
  const { user, updatePreferences } = useAuth();
  const { t } = useI18n();

  const [locale,    setLocale]    = useState(user?.locale ?? '');
  const [timezone,  setTimezone]  = useState(user?.timezone ?? '');
  const [busy, setBusy] = useState(false);
  const [ok,   setOk]   = useState(false);
  const [err,  setErr]  = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setErr(null); setOk(false); setBusy(true);
    try {
      await updatePreferences({
        locale:   locale || undefined,
        timezone: timezone || undefined,
      });
      setOk(true);
      window.setTimeout(() => setOk(false), 2000);
    } catch (e) {
      setErr(e instanceof ApiError ? String((e.body as any)?.message ?? e.message) : String(e));
    } finally { setBusy(false); }
  }

  return (
    <Card title={t('account.prefsTitle')} description={t('account.prefsDesc')}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {err && (
          <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">{err}</div>
        )}
        {ok && (
          <div role="status" className="rounded-lg bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 px-3 py-2 text-sm text-teal-700 dark:text-teal-300 inline-flex items-center gap-2">
            <Check className="w-4 h-4" aria-hidden />{t('account.prefsOk')}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="prefs-locale" className="block text-sm font-medium t-text">
              {t('account.localeLabel')}
            </label>
            <select id="prefs-locale" value={locale}
              onChange={e => setLocale(e.target.value)} className={inp} disabled={busy}>
              <option value="">{t('account.useTenantDefault')}</option>
              {LOCALES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="prefs-tz" className="block text-sm font-medium t-text">
              {t('account.timezoneLabel')}
            </label>
            <select id="prefs-tz" value={timezone}
              onChange={e => setTimezone(e.target.value)} className={inp} disabled={busy}>
              <option value="">{t('account.useTenantDefault')}</option>
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>
            <Save className="w-4 h-4 mr-1.5" aria-hidden />
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export function PageAccount() {
  const { t }          = useI18n();
  const { user }       = useAuth();
  const [params, setParams] = useSearchParams();

  // Garde permissions (défense-en-profondeur UI — la source de vérité reste
  // le PermissionGuard serveur). Un user sans SETTINGS_MANAGE_TENANT ne voit
  // PAS l'onglet, ET si qqn arrive avec ?tab=billing en URL directe on bascule
  // silencieusement vers le premier onglet autorisé.
  const canBilling = (user?.permissions ?? []).includes(BILLING_PERMISSION);

  // Tab courante dérivée du query param `?tab=…` pour que les redirects
  // /admin/billing → /account?tab=billing fonctionnent directement. Sans perm
  // billing, on revient à 'profile'.
  const rawTab = (params.get('tab') ?? 'profile') as Tab;
  const initialTab: Tab = rawTab === 'billing' && !canBilling ? 'profile' : rawTab;
  const [tab, setTab] = useState<Tab>(initialTab);

  // Synchroniser l'URL quand l'utilisateur change d'onglet — permet de partager
  // un lien direct vers une tab et de garder l'historique navigateur cohérent.
  useEffect(() => {
    if (params.get('tab') !== tab) {
      const next = new URLSearchParams(params);
      next.set('tab', tab);
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
          <UserCircle2 className="w-5 h-5 text-teal-700 dark:text-teal-300" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold t-text">{t('account.title')}</h1>
          <p className="text-sm t-text-2">{t('account.subtitle')}</p>
        </div>
      </header>

      <nav className="flex border-b border-slate-200 dark:border-slate-800 overflow-x-auto" role="tablist" aria-label={t('account.tablistAria')}>
        <TabButton active={tab === 'profile'}     onClick={() => setTab('profile')}     icon={<UserCircle2 size={14} />} label={t('account.tabProfile')} />
        <TabButton active={tab === 'security'}    onClick={() => setTab('security')}    icon={<ShieldCheck size={14} />} label={t('account.tabSecurity')} />
        <TabButton active={tab === 'preferences'} onClick={() => setTab('preferences')} icon={<SlidersHorizontal size={14} />} label={t('account.tabPrefs')} />
        {canBilling && (
          <TabButton active={tab === 'billing'} onClick={() => setTab('billing')} icon={<CreditCard size={14} />} label={t('account.tabBilling')} />
        )}
      </nav>

      {tab === 'profile'     && <ProfileTab />}
      {tab === 'security'    && <SecurityTab />}
      {tab === 'preferences' && <PreferencesTab />}
      {tab === 'billing' && canBilling && <PageAdminBilling />}
    </div>
  );
}
