/**
 * QrScannerWeb — scanner QR / code-barres web avec fallback manuel.
 *
 * Deux modes, toggle via un switch :
 *   1. Caméra (par défaut si permission OK) : démarre la vidéo live et décode
 *      en continu via html5-qrcode. Appelle onDetected(decoded) dès qu'un
 *      code est reconnu. Arrête la caméra automatiquement au unmount ou au
 *      toggle vers mode manuel.
 *   2. Manuel : input texte + bouton « Valider » — utilisé si la caméra est
 *      refusée, indisponible, ou si l'agent préfère une douchette USB.
 *
 * Arrêt propre : garanti via useEffect cleanup + flag `stoppedRef` pour
 * éviter les races lors de double-unmount en StrictMode.
 *
 * Accessibilité : les boutons ont des labels explicites, l'input manuel a
 * un label associé, les erreurs ont role="alert".
 *
 * Usage :
 *   <QrScannerWeb onDetected={(code) => { ... }} />
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, Keyboard, CameraOff, CheckCircle2 } from 'lucide-react';
import { useI18n } from '../../lib/i18n/useI18n';
import { Button } from './Button';
import { inputClass } from './inputClass';
import { ErrorAlert } from './ErrorAlert';

export interface QrScannerWebProps {
  /** Callback invoqué dès qu'un code est reconnu (caméra) ou validé (manuel). */
  onDetected: (code: string) => void;
  /** Placeholder de l'input manuel (ex. "Scannez un billet ou saisissez le code"). */
  manualPlaceholder?: string;
  /** Forcer un mode initial — par défaut 'camera' si l'API MediaDevices est dispo. */
  initialMode?: 'camera' | 'manual';
}

export function QrScannerWeb({
  onDetected,
  manualPlaceholder,
  initialMode,
}: QrScannerWebProps) {
  const { t } = useI18n();
  // Détecte au premier rendu si la caméra est théoriquement disponible. Le
  // vrai test (permission utilisateur) se fait au start — on ne le fait pas
  // en amont pour éviter le prompt intempestif avant que l'user ait choisi.
  const cameraCapable = typeof navigator !== 'undefined'
    && typeof navigator.mediaDevices?.getUserMedia === 'function';

  const [mode, setMode] = useState<'camera' | 'manual'>(
    initialMode ?? (cameraCapable ? 'camera' : 'manual'),
  );
  const [error, setError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [lastDetected, setLastDetected] = useState<string | null>(null);

  // Réf au div DOM hôte pour html5-qrcode (lib manipule le DOM en direct).
  const containerRef = useRef<HTMLDivElement>(null);
  // Instance du scanner — gardée pour cleanup au unmount / toggle.
  const scannerRef = useRef<Html5QrScannerInstance | null>(null);
  const stoppedRef = useRef(false);

  // Démarre la caméra uniquement en mode camera ET quand le ref DOM est prêt.
  useEffect(() => {
    if (mode !== 'camera') return;
    if (!containerRef.current) return;
    stoppedRef.current = false;

    let cancelled = false;
    void (async () => {
      try {
        // Lazy import — évite de charger ~200KB tant que l'agent n'a pas ouvert le scanner.
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled || stoppedRef.current) return;

        const elId = 'qr-scanner-' + Math.random().toString(36).slice(2, 8);
        if (containerRef.current) {
          containerRef.current.id = elId;
        }
        const scanner = new Html5Qrcode(elId);
        scannerRef.current = scanner as unknown as Html5QrScannerInstance;

        await scanner.start(
          { facingMode: 'environment' }, // caméra arrière par défaut (mobile/tablette)
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decodedText: string) => {
            // Évite de re-déclencher pour le même code encore dans le champ (freeze après 1er scan).
            if (lastDetected === decodedText) return;
            setLastDetected(decodedText);
            onDetected(decodedText);
          },
          () => { /* ignore les frames sans code */ },
        );
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(t('qrScanner.errStart').replace('{msg}', msg));
        // Si la caméra a refusé / absente → fallback auto sur manuel.
        setMode('manual');
      }
    })();

    return () => {
      cancelled = true;
      stoppedRef.current = true;
      const s = scannerRef.current;
      if (!s) return;
      scannerRef.current = null;
      // Fix E-DRV-1 : html5-qrcode throw sync "Cannot stop, scanner is not running"
      // si le scanner n'a jamais démarré (caméra refusée / mode manuel).
      // On protège par try/catch externe ET on ignore les rejets internes.
      Promise.resolve().then(async () => {
        try { await s.stop(); } catch { /* ignore — was not running */ }
        try { s.clear?.(); } catch { /* ignore */ }
      }).catch(() => { /* ignore */ });
    };
    // lastDetected volontairement hors deps — géré comme cache de dernière valeur pour éviter doublons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const handleManualSubmit = useCallback((e: FormEvent) => {
    e.preventDefault();
    const code = manualCode.trim();
    if (code.length === 0) return;
    setLastDetected(code);
    onDetected(code);
    setManualCode('');
  }, [manualCode, onDetected]);

  return (
    <div className="space-y-3">
      {/* Toggle mode */}
      <div role="radiogroup" aria-label={t('qrScanner.modeLabel')}
        className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-1">
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'camera'}
          disabled={!cameraCapable}
          onClick={() => { setError(null); setMode('camera'); }}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors inline-flex items-center gap-1.5 ${
            mode === 'camera'
              ? 'bg-teal-600 text-white'
              : 't-text-2 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40'
          }`}
        >
          <Camera className="w-3.5 h-3.5" aria-hidden />{t('qrScanner.camera')}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'manual'}
          onClick={() => { setError(null); setMode('manual'); }}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors inline-flex items-center gap-1.5 ${
            mode === 'manual'
              ? 'bg-teal-600 text-white'
              : 't-text-2 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Keyboard className="w-3.5 h-3.5" aria-hidden />{t('qrScanner.manual')}
        </button>
      </div>

      <ErrorAlert error={error} icon />

      {/* Caméra live */}
      {mode === 'camera' && (
        <div className="space-y-2">
          {!cameraCapable ? (
            <div className="p-6 text-center rounded-lg border border-dashed border-slate-300 dark:border-slate-700 t-text-3">
              <CameraOff className="w-8 h-8 mx-auto mb-2" aria-hidden />
              <p className="text-sm">{t('qrScanner.noCamera')}</p>
            </div>
          ) : (
            <div className="relative rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-black aspect-video">
              <div ref={containerRef} className="w-full h-full" />
            </div>
          )}
          {lastDetected && (
            <div role="status" className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
              <span className="font-mono">{t('qrScanner.lastDetected')} : {lastDetected.slice(0, 40)}{lastDetected.length > 40 ? '…' : ''}</span>
            </div>
          )}
        </div>
      )}

      {/* Input manuel / douchette USB */}
      {mode === 'manual' && (
        <form onSubmit={handleManualSubmit} className="flex gap-2">
          <input
            type="text"
            value={manualCode}
            onChange={e => setManualCode(e.target.value)}
            placeholder={manualPlaceholder ?? t('qrScanner.manualPlaceholder')}
            className={`${inputClass} font-mono flex-1`}
            autoFocus
            autoComplete="off"
            aria-label={t('qrScanner.manualLabel')}
          />
          <Button type="submit" disabled={manualCode.trim().length === 0}>
            {t('qrScanner.validate')}
          </Button>
        </form>
      )}
    </div>
  );
}

// Type minimal pour l'instance html5-qrcode — évite d'exiger l'import du
// type complet côté consumer (la lib est import() dynamique).
interface Html5QrScannerInstance {
  stop(): Promise<void>;
  clear?: () => void;
}
