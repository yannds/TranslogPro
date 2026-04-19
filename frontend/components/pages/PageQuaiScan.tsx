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

import { useState } from 'react';
import { ScanLine, Package, Ticket } from 'lucide-react';
import { useI18n } from '../../lib/i18n/useI18n';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { QrScannerWeb } from '../ui/QrScannerWeb';

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
  const [detectedCode, setDetectedCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function routeByKind(code: string, forceKind?: 'ticket' | 'parcel') {
    setError(null);
    const kind = forceKind ?? guessKind(code);
    if (kind === 'unknown') {
      setError(t('quaiScan.errUnknownKind'));
      return;
    }
    if (kind === 'ticket') {
      window.location.href = `/quai/boarding?code=${encodeURIComponent(code)}`;
    } else {
      window.location.href = `/quai/freight?code=${encodeURIComponent(code)}`;
    }
  }

  // Quand le scanner (caméra ou manuel) détecte un code, on le stocke et on
  // propose à l'agent de le router auto OU de forcer ticket/colis. On évite
  // la redirection immédiate pour qu'il garde le contrôle en cas d'ambiguïté.
  const handleDetected = (code: string) => {
    setDetectedCode(code);
    setError(null);
  };

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

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-4">
        <ErrorAlert error={error} icon />

        {/* Scanner principal — camera + fallback manuel géré dans le composant */}
        <QrScannerWeb
          onDetected={handleDetected}
          manualPlaceholder={t('quaiScan.codePh')}
        />

        <p className="text-xs t-text-3">{t('quaiScan.codeHint')}</p>

        {/* Code détecté — confirmation + routage */}
        {detectedCode && (
          <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                {t('quaiScan.detectedLabel')}
              </p>
              <code className="block text-sm font-mono break-all rounded bg-slate-50 dark:bg-slate-800 px-2 py-1.5 t-text">
                {detectedCode}
              </code>
            </div>

            <Button onClick={() => routeByKind(detectedCode)}
              className="w-full min-h-[44px] justify-center"
              leftIcon={<ScanLine className="w-4 h-4" aria-hidden />}>
              {t('quaiScan.autoDetect')}
            </Button>

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline"
                onClick={() => routeByKind(detectedCode, 'ticket')}
                className="min-h-[40px] justify-center"
                leftIcon={<Ticket className="w-4 h-4" aria-hidden />}>
                {t('quaiScan.asTicket')}
              </Button>
              <Button variant="outline"
                onClick={() => routeByKind(detectedCode, 'parcel')}
                className="min-h-[40px] justify-center"
                leftIcon={<Package className="w-4 h-4" aria-hidden />}>
                {t('quaiScan.asParcel')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
