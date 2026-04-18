/**
 * ProductTour — overlay guidé DRY.
 *
 * Caractéristiques :
 *   - Cible un sélecteur CSS (data-tour="..." recommandé) par étape
 *   - Spotlight découpé via 4 panneaux sombres autour de l'élément
 *   - Popover positionné auto (top/bottom) selon l'espace disponible
 *   - Keyboard : ←/→ navigue, Esc quitte
 *   - ARIA : role="dialog" aria-labelledby + focus initial sur CTA
 *   - prefers-reduced-motion : pas de transition
 *   - Persist dismiss via localStorage `tour-done:<tourId>`
 *
 * Usage :
 *   <ProductTour tourId="ticketing-v1" steps={STEPS} onFinish={...} />
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X, Check } from 'lucide-react';
import { useI18n } from '../../lib/i18n/useI18n';
import { cn } from '../../lib/utils';

export interface TourStep {
  /** Sélecteur CSS de l'élément à mettre en avant. Si absent → étape "centrale". */
  selector?: string;
  /** Clé i18n du titre. */
  titleKey: string;
  /** Clé i18n du corps (markdown-like minimal, HTML interdit). */
  bodyKey:  string;
  /** Padding autour du spotlight (px). Défaut 8. */
  pad?: number;
}

interface ProductTourProps {
  tourId: string;
  steps:  TourStep[];
  /** Appelé à la fermeture (quit ou finish). */
  onFinish?: (mode: 'completed' | 'dismissed') => void;
}

export function ProductTour({ tourId, steps, onFinish }: ProductTourProps) {
  const { t }        = useI18n();
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const step = steps[idx];

  // ─── Resolve target rect ─────────────────────────────────────────────────
  useLayoutEffect(() => {
    if (!step?.selector) { setRect(null); return; }
    const el = document.querySelector<HTMLElement>(step.selector);
    if (!el) { setRect(null); return; }
    const scroll = () => {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      // Attendre un tick pour laisser le scroll se faire, puis mesurer
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setRect(el.getBoundingClientRect());
        });
      });
    };
    scroll();
    const onResize = () => setRect(el.getBoundingClientRect());
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll',  onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll',  onResize, true);
    };
  }, [step?.selector]);

  // ─── Keyboard nav ────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape')      { e.preventDefault(); quit(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft')  { e.preventDefault(); prev(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  // ─── Focus popover au changement d'étape ────────────────────────────────
  useEffect(() => {
    popoverRef.current?.focus({ preventScroll: true });
  }, [idx]);

  if (!step) return null;

  function quit() {
    markDone(tourId);
    onFinish?.('dismissed');
  }

  function finish() {
    markDone(tourId);
    onFinish?.('completed');
  }

  function next() { if (idx < steps.length - 1) setIdx(idx + 1); else finish(); }
  function prev() { if (idx > 0) setIdx(idx - 1); }

  const pad = step.pad ?? 8;
  const isLast = idx === steps.length - 1;

  // Popover positioning — au-dessus si l'élément est dans le bas 50%, sinon en-dessous
  const popoverPos: React.CSSProperties = (() => {
    if (!rect) {
      // Étape centrale sans cible
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    }
    const vh = window.innerHeight;
    const below = rect.bottom + pad + 12;
    const above = rect.top    - pad - 12;
    const wantBelow = below < vh - 240;
    const left = Math.max(16, Math.min(window.innerWidth - 400 - 16, rect.left));
    return wantBelow
      ? { top: below, left }
      : { top: Math.max(16, above - 220), left };
  })();

  return (
    <div
      aria-hidden={false}
      className="fixed inset-0 z-[9999]"
      role="presentation"
    >
      {/* Spotlight : 4 panneaux sombres autour du rect. Si rect null → full overlay */}
      {rect ? (
        <>
          <div className="absolute inset-x-0 top-0 bg-slate-950/60" style={{ height: Math.max(0, rect.top - pad) }} />
          <div className="absolute inset-x-0 bottom-0 bg-slate-950/60" style={{ top: rect.bottom + pad }} />
          <div className="absolute bg-slate-950/60" style={{ top: rect.top - pad, left: 0, width: Math.max(0, rect.left - pad), height: rect.height + pad * 2 }} />
          <div className="absolute bg-slate-950/60" style={{ top: rect.top - pad, left: rect.right + pad, right: 0, height: rect.height + pad * 2 }} />
          {/* Ring sur l'élément */}
          <div
            className="absolute rounded-lg ring-2 ring-teal-400 shadow-[0_0_0_4px_rgba(20,184,166,0.25)] pointer-events-none motion-reduce:transition-none transition-all"
            style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-slate-950/70" />
      )}

      {/* Popover */}
      <div
        ref={popoverRef}
        role="dialog"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        className="absolute w-[360px] max-w-[calc(100vw-32px)] rounded-xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900 focus:outline-none motion-reduce:transition-none transition-all"
        style={popoverPos}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-400">
              {idx + 1} / {steps.length}
            </p>
            <h3 id="tour-title" className="mt-1 text-base font-semibold text-slate-900 dark:text-white">
              {t(step.titleKey)}
            </h3>
          </div>
          <button
            type="button"
            onClick={quit}
            aria-label={t('tour.close')}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <p id="tour-body" className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {t(step.bodyKey)}
        </p>

        {/* Dots + nav */}
        <div className="mt-5 flex items-center justify-between">
          <div className="flex items-center gap-1" aria-hidden>
            {steps.map((_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 rounded-full transition-all motion-reduce:transition-none',
                  i === idx ? 'w-4 bg-teal-500' : 'w-1.5 bg-slate-300 dark:bg-slate-700',
                )}
              />
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={prev}
              disabled={idx === 0}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-md px-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              {t('tour.prev')}
            </button>
            <button
              type="button"
              onClick={next}
              autoFocus
              className="inline-flex h-8 items-center justify-center gap-1 rounded-md bg-teal-600 px-3 text-sm font-semibold text-white hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2"
            >
              {isLast ? (
                <>
                  <Check className="h-4 w-4" aria-hidden />
                  {t('tour.finish')}
                </>
              ) : (
                <>
                  {t('tour.next')}
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── State helpers (localStorage) ───────────────────────────────────────────

const TOUR_PREFIX = 'tour-done:';

function markDone(tourId: string) {
  try { localStorage.setItem(TOUR_PREFIX + tourId, String(Date.now())); } catch { /* quota full */ }
}

/** Renvoie true si le tour a déjà été terminé/dismissé (timestamp présent). */
export function isTourDone(tourId: string): boolean {
  try { return !!localStorage.getItem(TOUR_PREFIX + tourId); } catch { return false; }
}

/** Reset manuel — utilisé par les settings/help pour "rejouer le tour". */
export function resetTour(tourId: string) {
  try { localStorage.removeItem(TOUR_PREFIX + tourId); } catch { /* ignore */ }
}
