/**
 * SignaturePad — canvas tactile/souris qui produit une signature SVG.
 *
 * Pas de lib externe : pointer events natifs (fonctionne mouse/touch/pen
 * unifié). Trace les strokes en tableau de points, puis sérialise en
 * `<path d="...">` SVG à la demande via `getSvg()`. Le consumer peut aussi
 * appeler `clear()` pour reset.
 *
 * UX :
 *   - Canvas responsive (prend 100% de la largeur, ratio 2:1)
 *   - Bouton « Effacer » intégré
 *   - Overlay placeholder tant qu'aucun trait
 *   - Touch-action: none sur le canvas pour empêcher le scroll gestuel
 *
 * Valeur retournée par `getSvg()` : chaîne SVG complète < 40Ko pour une
 * signature typique — safe pour un POST JSON.
 */

import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
  type PointerEvent,
} from 'react';
import { Eraser } from 'lucide-react';
import { useI18n } from '../../lib/i18n/useI18n';
import { Button } from './Button';

/** Point 2D relatif au canvas, en coordonnées CSS (pas en pixels backend). */
interface Pt { x: number; y: number }
/** Un trait = une séquence de points entre un pointerdown et un pointerup. */
type Stroke = Pt[];

export interface SignaturePadHandle {
  /** SVG string correspondant à la signature courante, ou null si vide. */
  getSvg(): string | null;
  /** Reset complet du canvas + des traits internes. */
  clear(): void;
  /** Vrai si au moins 1 trait non-vide est présent. */
  hasSignature(): boolean;
}

export const SignaturePad = forwardRef<SignaturePadHandle, { disabled?: boolean }>(
function SignaturePad({ disabled }, ref) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activeRef = useRef<Stroke | null>(null);
  const [hasDraw, setHasDraw] = useState(false);

  // Redraw complet du canvas — utilisé après un resize ou un clear.
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Clear + style de base
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#0f172a';  // slate-900 pour contraste dark & light
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    for (const stroke of strokesRef.current) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i++) {
        ctx.lineTo(stroke[i].x, stroke[i].y);
      }
      ctx.stroke();
    }
  }, []);

  // Resize responsive — ajuste la résolution interne du canvas en fonction
  // de la taille CSS + devicePixelRatio pour un rendu net sur Retina.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const dpr  = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width  = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);
      redraw();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [redraw]);

  // ── Handlers ────────────────────────────────────────────────────────────
  function pointFrom(e: PointerEvent<HTMLCanvasElement>): Pt {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    activeRef.current = [pointFrom(e)];
  };

  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!activeRef.current) return;
    const pt = pointFrom(e);
    activeRef.current.push(pt);
    // Dessine uniquement le nouveau segment — plus rapide que redraw complet.
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || activeRef.current.length < 2) return;
    const prev = activeRef.current[activeRef.current.length - 2];
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
  };

  const onUp = () => {
    if (!activeRef.current) return;
    if (activeRef.current.length > 1) {
      strokesRef.current.push(activeRef.current);
      setHasDraw(true);
    }
    activeRef.current = null;
  };

  const handleClear = () => {
    strokesRef.current = [];
    setHasDraw(false);
    redraw();
  };

  // Expose l'API impérative au parent via ref.
  useImperativeHandle(ref, () => ({
    getSvg(): string | null {
      if (strokesRef.current.length === 0) return null;
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      // Construit un path d'une seule commande par trait — fichier compact.
      const paths = strokesRef.current.map(stroke => {
        if (stroke.length === 0) return '';
        const [first, ...rest] = stroke;
        const d = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)} ` +
          rest.map(p => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
        return `<path d="${d}" fill="none" stroke="#0f172a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
      }).join('');
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${paths}</svg>`;
    },
    clear: handleClear,
    hasSignature: () => strokesRef.current.length > 0,
  }));

  return (
    <div className="space-y-2">
      <div className="relative rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-50 aspect-[2/1] overflow-hidden">
        <canvas
          ref={canvasRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
          onPointerCancel={onUp}
          className="w-full h-full cursor-crosshair touch-none"
          aria-label={t('signaturePad.ariaLabel')}
        />
        {!hasDraw && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-slate-400 text-sm">
            {t('signaturePad.placeholder')}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{t('signaturePad.hint')}</p>
        <Button variant="outline" size="sm"
          onClick={handleClear}
          disabled={disabled || !hasDraw}
          leftIcon={<Eraser className="w-3.5 h-3.5" aria-hidden />}>
          {t('signaturePad.clear')}
        </Button>
      </div>
    </div>
  );
});
