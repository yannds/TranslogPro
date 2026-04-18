/**
 * CashierSessionBar — Statut caisse ouverte / actions (ouvrir • clôturer)
 *
 * Utilisation :
 *   <CashierSessionBar />  // en haut des pages caisse / vente
 *
 * Récupère la caisse ouverte de l'utilisateur courant via useCashierSession.
 * Si aucune caisse → bouton "Ouvrir ma caisse" (dialog).
 * Si caisse ouverte → solde en cours + bouton "Clôturer" (dialog rapprochement).
 *
 * i18n : toutes les chaînes passent par t('cashierSession.*').
 * A11y : dialogs Radix (aria gérés), inputs avec label/aria-describedby, focus trap.
 */

import { useMemo, useState } from 'react';
import { Landmark, Lock, Unlock, AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useCashierSession } from '../../lib/hooks/useCashierSession';
import { useCurrencyFormatter } from '../../providers/TenantConfigProvider';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { ErrorAlert } from '../ui/ErrorAlert';
import { inputClass } from '../ui/inputClass';

export interface CashierSessionBarProps {
  /** Afficher une version compacte (une ligne seulement) */
  compact?: boolean;
  /** Callback lorsqu'une caisse est ouverte ou clôturée */
  onChange?: () => void;
}

export function CashierSessionBar({ compact, onChange }: CashierSessionBarProps) {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';
  const agencyId = user?.agencyId ?? '';
  const fmt = useCurrencyFormatter();
  const { register, loading, error, openRegister, closeRegister, mutating } =
    useCashierSession(tenantId);

  const [openDlg, setOpenDlg]   = useState(false);
  const [closeDlg, setCloseDlg] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const openedAtLabel = useMemo(() => {
    if (!register) return '';
    return new Date(register.openedAt).toLocaleTimeString(undefined, {
      hour: '2-digit', minute: '2-digit',
    });
  }, [register]);

  async function handleOpen(opening: number, note: string) {
    if (!agencyId) {
      setMutationError(t('cashierSession.errorNoAgency'));
      return;
    }
    setMutationError(null);
    try {
      await openRegister(agencyId, opening, note || undefined);
      setOpenDlg(false);
      onChange?.();
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleClose(counted: number, note: string) {
    setMutationError(null);
    try {
      await closeRegister(counted, note || undefined);
      setCloseDlg(false);
      onChange?.();
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!tenantId) return null;

  return (
    <div
      role="region"
      aria-label={t('cashierSession.regionLabel')}
      className={`rounded-xl border bg-white dark:bg-slate-950
        border-slate-200 dark:border-slate-800 p-4
        ${compact ? '' : 'shadow-sm'}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Landmark className="w-5 h-5 text-slate-500 dark:text-slate-400" aria-hidden />
          <span className="font-medium text-slate-900 dark:text-slate-50">
            {t('cashierSession.title')}
          </span>
        </div>

        {loading && (
          <span className="text-sm text-slate-500 dark:text-slate-400 inline-flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
            {t('cashierSession.loading')}
          </span>
        )}

        {!loading && error && (
          <span className="text-sm text-red-600 dark:text-red-400 inline-flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" aria-hidden /> {error}
          </span>
        )}

        {!loading && !error && register && (
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
              <Unlock className="w-4 h-4" aria-hidden />
              {t('cashierSession.opened', { time: openedAtLabel })}
            </span>
            <span className="text-slate-600 dark:text-slate-400">
              {t('cashierSession.initialBalance')} :{' '}
              <strong className="text-slate-900 dark:text-slate-50">
                {fmt(register.initialBalance)}
              </strong>
            </span>
            {register._count?.transactions !== undefined && (
              <span className="text-slate-500 dark:text-slate-400">
                {t('cashierSession.txCount', { n: String(register._count.transactions) })}
              </span>
            )}
          </div>
        )}

        {!loading && !error && !register && (
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {t('cashierSession.noneOpen')}
          </span>
        )}

        <div className="ml-auto flex gap-2">
          {!register && (
            <Button
              variant="default"
              size="sm"
              onClick={() => setOpenDlg(true)}
              disabled={loading || mutating}
              leftIcon={<Unlock className="w-4 h-4" aria-hidden />}
              aria-label={t('cashierSession.open')}
            >
              {t('cashierSession.open')}
            </Button>
          )}
          {register && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setCloseDlg(true)}
              disabled={mutating}
              leftIcon={<Lock className="w-4 h-4" aria-hidden />}
              aria-label={t('cashierSession.close')}
            >
              {t('cashierSession.close')}
            </Button>
          )}
        </div>
      </div>

      {/* Dialog : ouverture */}
      <OpenRegisterDialog
        open={openDlg}
        onOpenChange={setOpenDlg}
        onConfirm={handleOpen}
        loading={mutating}
        error={mutationError}
      />

      {/* Dialog : clôture */}
      {register && (
        <CloseRegisterDialog
          open={closeDlg}
          onOpenChange={setCloseDlg}
          register={register}
          onConfirm={handleClose}
          loading={mutating}
          error={mutationError}
        />
      )}
    </div>
  );
}

// ─── Dialog : ouverture ────────────────────────────────────────────────────────

interface OpenRegisterDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (opening: number, note: string) => void | Promise<void>;
  loading: boolean;
  error: string | null;
}

function OpenRegisterDialog({ open, onOpenChange, onConfirm, loading, error }: OpenRegisterDialogProps) {
  const { t } = useI18n();
  const [opening, setOpening] = useState('0');
  const [note, setNote] = useState('');

  function submit() {
    const v = Number(opening);
    if (!Number.isFinite(v) || v < 0) return;
    onConfirm(v, note);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('cashierSession.openDialogTitle')}
      description={t('cashierSession.openDialogDesc')}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={loading} loading={loading}>
            {t('cashierSession.confirmOpen')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorAlert error={error} icon />
        <label className="block">
          <span className="text-sm text-slate-700 dark:text-slate-300">
            {t('cashierSession.openingBalance')}
          </span>
          <input
            type="number"
            min={0}
            step="any"
            value={opening}
            onChange={e => setOpening(e.target.value)}
            className={inputClass}
            aria-label={t('cashierSession.openingBalance')}
            inputMode="decimal"
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-700 dark:text-slate-300">
            {t('cashierSession.noteOptional')}
          </span>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            className={inputClass}
            rows={2}
            aria-label={t('cashierSession.noteOptional')}
          />
        </label>
      </div>
    </Dialog>
  );
}

// ─── Dialog : clôture ─────────────────────────────────────────────────────────

interface CloseRegisterDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  register: { id: string; initialBalance: number; openedAt: string; _count?: { transactions: number } };
  onConfirm: (counted: number, note: string) => void | Promise<void>;
  loading: boolean;
  error: string | null;
}

function CloseRegisterDialog({ open, onOpenChange, register, onConfirm, loading, error }: CloseRegisterDialogProps) {
  const { t } = useI18n();
  const fmt = useCurrencyFormatter();
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');

  function submit() {
    const v = Number(counted);
    if (!Number.isFinite(v) || v < 0) return;
    onConfirm(v, note);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('cashierSession.closeDialogTitle')}
      description={t('cashierSession.closeDialogDesc')}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={submit} disabled={loading} loading={loading}>
            {t('cashierSession.confirmClose')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorAlert error={error} icon />
        <div className="text-sm text-slate-600 dark:text-slate-400">
          {t('cashierSession.initialBalance')} : <strong>{fmt(register.initialBalance)}</strong>
        </div>
        <label className="block">
          <span className="text-sm text-slate-700 dark:text-slate-300">
            {t('cashierSession.countedBalance')}
          </span>
          <input
            type="number"
            min={0}
            step="any"
            value={counted}
            onChange={e => setCounted(e.target.value)}
            className={inputClass}
            aria-label={t('cashierSession.countedBalance')}
            inputMode="decimal"
            autoFocus
          />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t('cashierSession.countedHint')}
          </p>
        </label>
        <label className="block">
          <span className="text-sm text-slate-700 dark:text-slate-300">
            {t('cashierSession.closingNote')}
          </span>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            className={inputClass}
            rows={2}
            aria-label={t('cashierSession.closingNote')}
          />
        </label>
      </div>
    </Dialog>
  );
}
