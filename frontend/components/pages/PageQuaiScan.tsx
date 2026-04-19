/**
 * PageQuaiScan — scanner un code ticket ou colis pour agir en un clic.
 *
 * Flow v1 (manuel) : l'agent saisit ou colle le code (ticket QR / colis
 * trackingCode), le détermine et redirige vers la page d'embarquement
 * ou de chargement fret avec le code pré-rempli. Un vrai scanner caméra
 * web pourra être branché plus tard (html5-qrcode ou équivalent).
 *
 * Permissions : TICKET_SCAN_AGENCY et/ou PARCEL_SCAN_AGENCY.
 */

import { useState, type FormEvent } from 'react';
import { ScanLine, Package, Ticket } from 'lucide-react';
import { useI18n } from '../../lib/i18n/useI18n';
import { Button } from '../ui/Button';
import { inputClass } from '../ui/inputClass';
import { ErrorAlert } from '../ui/ErrorAlert';

// Heuristique très simple pour distinguer ticket vs colis.
// Ticket QR codes : format JWT-like / hex long / URL-encoded — typiquement long.
// Parcel trackingCode : format court (ex. TL-ABC123, souvent < 20 chars alphanumériques).
// Si incertain, on propose à l'agent de trancher via 2 boutons.
function guessKind(code: string): 'ticket' | 'parcel' | 'unknown' {
  const c = code.trim();
  if (c.length === 0) return 'unknown';
  if (c.length > 40) return 'ticket';        // QR token
  if (/^[A-Z]{2,4}[-_]?[A-Z0-9]{4,}$/i.test(c)) return 'parcel';
  return 'unknown';
}

export function PageQuaiScan() {
  const { t } = useI18n();
  const [code, setCode]   = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent, forceKind?: 'ticket' | 'parcel') {
    e.preventDefault();
    setError(null);
    const kind = forceKind ?? guessKind(code);
    if (kind === 'unknown') {
      setError(t('quaiScan.errUnknownKind'));
      return;
    }
    // Redirige vers la page concernée avec le code en query.
    // Les pages cibles consomment le paramètre pour pré-filtrer / pré-remplir.
    if (kind === 'ticket') {
      window.location.href = `/quai/boarding?code=${encodeURIComponent(code)}`;
    } else {
      window.location.href = `/quai/freight?code=${encodeURIComponent(code)}`;
    }
  }

  return (
    <main className="p-4 sm:p-6 space-y-6 max-w-lg mx-auto" role="main">
      <header className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30 shrink-0">
          <ScanLine className="w-5 h-5 text-purple-600 dark:text-purple-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold t-text">{t('quaiScan.title')}</h1>
          <p className="text-sm t-text-2 mt-0.5">{t('quaiScan.subtitle')}</p>
        </div>
      </header>

      <form onSubmit={e => handleSubmit(e)} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-4">
        <ErrorAlert error={error} icon />

        <div className="space-y-1.5">
          <label htmlFor="scan-code" className="block text-sm font-medium t-text">
            {t('quaiScan.codeLabel')}
          </label>
          <input
            id="scan-code"
            type="text"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder={t('quaiScan.codePh')}
            className={`${inputClass} font-mono`}
            autoFocus
            autoComplete="off"
          />
          <p className="text-xs t-text-3">{t('quaiScan.codeHint')}</p>
        </div>

        {/* Un seul bouton qui auto-détecte OU deux boutons explicites si ambigu */}
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline"
            onClick={e => handleSubmit(e, 'ticket')}
            disabled={!code.trim()}
            className="min-h-[44px] justify-center"
            leftIcon={<Ticket className="w-4 h-4" aria-hidden />}
          >
            {t('quaiScan.asTicket')}
          </Button>
          <Button type="button" variant="outline"
            onClick={e => handleSubmit(e, 'parcel')}
            disabled={!code.trim()}
            className="min-h-[44px] justify-center"
            leftIcon={<Package className="w-4 h-4" aria-hidden />}
          >
            {t('quaiScan.asParcel')}
          </Button>
        </div>
        <Button type="submit" disabled={!code.trim()} className="w-full min-h-[44px] justify-center"
          leftIcon={<ScanLine className="w-4 h-4" aria-hidden />}>
          {t('quaiScan.autoDetect')}
        </Button>

        <p className="text-[11px] t-text-3 text-center">{t('quaiScan.cameraSoonHint')}</p>
      </form>
    </main>
  );
}
