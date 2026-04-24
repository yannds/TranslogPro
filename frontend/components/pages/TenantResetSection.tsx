/**
 * TenantResetSection — Zone dangereuse "Réinitialiser le tenant".
 *
 * Composant réutilisable, à monter en bas de PageCompanySetup (ou équivalent).
 * Gated par permission `control.tenant.reset.tenant` (jamais rôle).
 *
 * Double garde-fou UI :
 *   1. Bouton rouge "Zone dangereuse" — ouvre une modale
 *   2. Modale — l'utilisateur doit saisir son password ET taper le slug du
 *      tenant à l'identique pour activer le bouton "Réinitialiser"
 *
 * Appelle POST /api/tenants/:id/settings/reset. Le backend applique
 * lui-même les garde-fous (permission + re-auth password + slug match +
 * rate-limit 3/h) : l'UI est un confort visuel, la sécurité reste côté service.
 */

import { useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { apiPost } from '../../lib/api';
import { Button } from '../ui/Button';
import { inputClass } from '../ui/inputClass';
import { ErrorAlert } from '../ui/ErrorAlert';
import { cn } from '../../lib/utils';

const PERM_RESET = 'control.tenant.reset.tenant';

export interface TenantResetSectionProps {
  tenantId:   string;
  tenantSlug: string;
  /** Callback optionnel après succès (ex: recharger la page / rediriger) */
  onSuccess?: () => void;
}

interface ResetResponse {
  ok: true;
  purged: Record<string, number>;
  tenantSlug: string;
}

export function TenantResetSection({ tenantId, tenantSlug, onSuccess }: TenantResetSectionProps) {
  const { user } = useAuth();
  const { t }    = useI18n();
  const canReset = !!user?.permissions?.includes(PERM_RESET);

  const [open, setOpen]           = useState(false);
  const [password, setPassword]   = useState('');
  const [confirmSlug, setConfirm] = useState('');
  const [busy, setBusy]           = useState(false);
  const [err, setErr]             = useState<string | null>(null);
  const [result, setResult]       = useState<ResetResponse | null>(null);

  // Gate permission stricte — ne rend rien si l'utilisateur n'a pas la permission
  if (!canReset) return null;

  const slugMatches = confirmSlug === tenantSlug;
  const canSubmit   = slugMatches && password.length > 0 && !busy;

  const closeDialog = () => {
    if (busy) return;
    setOpen(false);
    setPassword('');
    setConfirm('');
    setErr(null);
    setResult(null);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await apiPost<ResetResponse>(
        `/api/tenants/${tenantId}/settings/reset`,
        { password, confirmSlug },
      );
      setResult(res);
      onSuccess?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('tenantReset.genericError'));
    } finally {
      setBusy(false);
    }
  };

  const totalPurged = result ? Object.values(result.purged).reduce((s, n) => s + n, 0) : 0;

  return (
    <section
      aria-labelledby="tenant-reset-title"
      className="mt-8 rounded-2xl border-2 border-red-300/60 dark:border-red-800/40 bg-red-50/40 dark:bg-red-950/20 p-5"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center">
          <AlertTriangle className="w-5 h-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="tenant-reset-title" className="text-lg font-bold text-red-700 dark:text-red-300">
            {t('tenantReset.zoneTitle')}
          </h2>
          <p className="text-sm text-red-700/80 dark:text-red-300/70 mt-1">
            {t('tenantReset.zoneDesc')}
          </p>
          <Button
            onClick={() => setOpen(true)}
            className="mt-4 bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800 text-white"
          >
            {t('tenantReset.buttonOpen')}
          </Button>
        </div>
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={closeDialog} />
          <div className="relative z-10 w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="reset-dialog-title" className="text-lg font-bold t-text">
                  {t('tenantReset.dialogTitle')}
                </h3>
                <p className="text-sm t-text-2 mt-1">{t('tenantReset.dialogWarn')}</p>
              </div>
              <button
                onClick={closeDialog}
                disabled={busy}
                aria-label={t('common.close')}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                <X className="w-5 h-5 t-text-2" aria-hidden />
              </button>
            </div>

            {result ? (
              // Succès : afficher le récap des tables purgées
              <div className="space-y-3">
                <p className="text-sm font-semibold t-text">
                  ✅ {t('tenantReset.successTitle')}
                </p>
                <p className="text-sm t-text-2">
                  {totalPurged} {t('tenantReset.rowsPurged')}
                </p>
                <details className="text-xs t-text-3">
                  <summary className="cursor-pointer">{t('tenantReset.showDetail')}</summary>
                  <ul className="mt-2 space-y-0.5 font-mono">
                    {Object.entries(result.purged).map(([table, n]) => (
                      <li key={table}>{table}: {n}</li>
                    ))}
                  </ul>
                </details>
                <Button onClick={closeDialog} className="w-full">{t('common.close')}</Button>
              </div>
            ) : (
              <>
                <ul className="text-xs t-text-2 space-y-1 list-disc list-inside">
                  <li>{t('tenantReset.bulletPurged')}</li>
                  <li>{t('tenantReset.bulletKept')}</li>
                  <li>{t('tenantReset.bulletIrreversible')}</li>
                </ul>

                <ErrorAlert error={err} icon />

                <div>
                  <label htmlFor="reset-password" className="block text-xs font-semibold t-text-2 uppercase tracking-wider mb-1">
                    {t('tenantReset.labelPassword')}
                  </label>
                  <input
                    id="reset-password"
                    type="password"
                    autoComplete="current-password"
                    className={inputClass}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    disabled={busy}
                    placeholder="••••••••"
                  />
                </div>

                <div>
                  <label htmlFor="reset-slug" className="block text-xs font-semibold t-text-2 uppercase tracking-wider mb-1">
                    {t('tenantReset.labelSlug')}{' '}
                    <span className="font-mono text-red-600 dark:text-red-400">{tenantSlug}</span>
                  </label>
                  <input
                    id="reset-slug"
                    type="text"
                    autoComplete="off"
                    className={cn(
                      inputClass,
                      confirmSlug.length > 0 && !slugMatches && 'border-red-400 dark:border-red-700',
                      slugMatches && 'border-emerald-400 dark:border-emerald-700',
                    )}
                    value={confirmSlug}
                    onChange={e => setConfirm(e.target.value)}
                    disabled={busy}
                    placeholder={tenantSlug}
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <Button onClick={closeDialog} disabled={busy} className="flex-1 bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-300 dark:hover:bg-slate-700">
                    {t('common.cancel')}
                  </Button>
                  <Button
                    onClick={submit}
                    disabled={!canSubmit}
                    className="flex-1 bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800 text-white disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed"
                  >
                    {busy
                      ? <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden />{t('tenantReset.submitting')}</span>
                      : t('tenantReset.submit')}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
