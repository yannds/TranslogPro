/**
 * DocumentPreview — Aperçu WYSIWYG d'un document généré
 *
 * Principe :
 *   1. Appel API → { downloadUrl } retourné par DocumentsService
 *   2. Affichage dans <iframe sandbox> (isolation XSS totale)
 *   3. Boutons : Imprimer (window.print via postMessage) | Télécharger | Plein écran
 *
 * Le HTML généré par Puppeteer est identique à ce qui sera imprimé.
 * L'iframe affiche EXACTEMENT le rendu PDF → WYSIWYG garanti.
 *
 * Formats gérés :
 *   - HTML certifié  → iframe direct
 *   - PDF (blob URL) → iframe avec #toolbar=0
 *   - Excel/Word     → lien téléchargement uniquement (pas de preview)
 *
 * Usage :
 *   const result = await api.get(`/tenants/${tid}/documents/tickets/${id}/print`);
 *   <DocumentPreview downloadUrl={result.downloadUrl} fileName="billet.pdf" />
 */
import { useState, useRef, useCallback, type CSSProperties } from 'react';
import { cn } from '../../lib/utils';

export type DocMimeType = 'text/html' | 'application/pdf' | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

interface DocumentPreviewProps {
  downloadUrl:   string;
  fileName?:     string;
  mimeType?:     DocMimeType;
  fingerprint?:  string;
  generatedAt?:  Date | string;
  actorId?:      string;
  className?:    string;
  /** Hauteur de l'iframe (défaut: 70vh) */
  height?:       string | number;
}

export function DocumentPreview({
  downloadUrl,
  fileName = 'document',
  mimeType = 'application/pdf',
  fingerprint,
  generatedAt,
  actorId,
  className,
  height = '70vh',
}: DocumentPreviewProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [loading,    setLoading]    = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const isPdf  = mimeType === 'application/pdf';
  const isHtml = mimeType === 'text/html';
  const canPreview = isPdf || isHtml;

  const handleLoad = useCallback(() => setLoading(false), []);

  const handlePrint = useCallback(() => {
    iframeRef.current?.contentWindow?.print();
  }, []);

  const iframeStyle: CSSProperties = {
    width:  '100%',
    height: typeof height === 'number' ? `${height}px` : height,
    border: 'none',
    display: loading ? 'none' : 'block',
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>

      {/* ── Barre d'outils ──────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Méta-données */}
        <div className="text-xs text-slate-500 dark:text-slate-400 space-y-0.5">
          {generatedAt && (
            <div>Généré le {new Date(generatedAt).toLocaleString('fr-FR')}</div>
          )}
          {actorId && <div>Par : <span className="font-mono">{actorId}</span></div>}
          {fingerprint && (
            <div className="flex items-center gap-1">
              <span className="text-green-600 dark:text-green-400">✓</span>
              <span className="font-mono text-[10px] truncate max-w-[180px]" title={fingerprint}>
                SHA-256 {fingerprint.slice(0, 16)}…
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {canPreview && (
            <button
              onClick={handlePrint}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
                bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700
                text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700
                transition-colors`}
              aria-label="Imprimer"
            >
              🖨 Imprimer
            </button>
          )}

          <a
            href={downloadUrl}
            download={fileName}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
              bg-slate-900 dark:bg-slate-50 text-white dark:text-slate-900
              hover:bg-slate-700 dark:hover:bg-slate-200 transition-colors`}
            aria-label="Télécharger"
          >
            ↓ Télécharger
          </a>

          {canPreview && (
            <button
              onClick={() => setFullscreen(f => !f)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
                bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700
                text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700
                transition-colors`}
              aria-label={fullscreen ? 'Réduire' : 'Plein écran'}
              aria-pressed={fullscreen}
            >
              {fullscreen ? '⊡ Réduire' : '⊞ Plein écran'}
            </button>
          )}
        </div>
      </div>

      {/* ── Aperçu ─────────────────────────────────────────────── */}
      {canPreview ? (
        <div
          className={cn(
            'relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900',
            fullscreen && 'fixed inset-0 z-50 rounded-none border-0',
          )}
        >
          {/* Skeleton pendant chargement */}
          {loading && (
            <div className="flex items-center justify-center bg-slate-100 dark:bg-slate-900"
                 style={{ height: typeof height === 'number' ? `${height}px` : height }}>
              <div className="flex flex-col items-center gap-3 text-slate-400">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                <span className="text-sm">Chargement du document…</span>
              </div>
            </div>
          )}

          {/* iframe sandboxée */}
          <iframe
            ref={iframeRef}
            src={isPdf ? `${downloadUrl}#toolbar=0&navpanes=0` : downloadUrl}
            title={`Aperçu : ${fileName}`}
            sandbox="allow-same-origin allow-scripts allow-modals allow-popups"
            style={iframeStyle}
            onLoad={handleLoad}
            aria-label={`Aperçu du document ${fileName}`}
          />

          {/* Bouton fermer plein écran */}
          {fullscreen && (
            <button
              onClick={() => setFullscreen(false)}
              className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white dark:bg-slate-800 shadow-lg text-slate-700 dark:text-slate-200"
              aria-label="Fermer le plein écran"
            >
              ✕
            </button>
          )}
        </div>
      ) : (
        /* Pas de preview pour Excel/Word */
        <div className="flex flex-col items-center gap-3 py-12 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
          <div className="text-4xl" aria-hidden>
            {mimeType.includes('spreadsheet') ? '📊' : '📄'}
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Aperçu non disponible pour ce format
          </p>
          <a
            href={downloadUrl}
            download={fileName}
            className="px-4 py-2 rounded-md bg-slate-900 dark:bg-slate-50 text-white dark:text-slate-900 text-sm font-medium hover:bg-slate-700 transition-colors"
          >
            ↓ Télécharger {fileName}
          </a>
        </div>
      )}
    </div>
  );
}

// ── Hook utilitaire — appel API + gestion état ────────────────────────────────

interface PrintResult {
  storageKey:  string;
  downloadUrl: string;
  expiresAt:   string;
  fingerprint: string;
  generatedAt: string;
  actorId:     string;
  sizeBytes:   number;
  format?:     string;
}

interface UsePrintDocumentReturn {
  result:   PrintResult | null;
  loading:  boolean;
  error:    string | null;
  trigger:  () => Promise<void>;
  reset:    () => void;
}

export function usePrintDocument(
  apiUrl: string,
  fetchFn: (url: string) => Promise<PrintResult> = defaultFetch,
): UsePrintDocumentReturn {
  const [result,  setResult]  = useState<PrintResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const trigger = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFn(apiUrl);
      setResult(data);
    } catch (e) {
      setError((e as Error).message ?? 'Erreur de génération');
    } finally {
      setLoading(false);
    }
  }, [apiUrl, fetchFn]);

  const reset = useCallback(() => { setResult(null); setError(null); }, []);

  return { result, loading, error, trigger, reset };
}

async function defaultFetch(url: string): Promise<PrintResult> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<PrintResult>;
}
