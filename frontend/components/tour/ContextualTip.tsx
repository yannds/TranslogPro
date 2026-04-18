/**
 * ContextualTip — toast d'astuce dismissable, 1 affichage par clé et par jour.
 *
 * Pas de lib externe (pas sonner) — composant minimaliste custom. Utilisé pour
 * les conseils post-aha (après la première vente, premier colis, etc.).
 *
 * Usage :
 *   <ContextualTip
 *     id="post-first-sale"
 *     when={hasSoldFirstTicket}
 *     titleKey="tip.postFirstSale.title"
 *     bodyKey="tip.postFirstSale.body"
 *     ctaLabelKey="tip.postFirstSale.cta"
 *     ctaHref="/admin/tarifs/promotions"
 *   />
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbulb, X, ArrowRight } from 'lucide-react';
import { useI18n } from '../../lib/i18n/useI18n';

interface ContextualTipProps {
  /** Clé unique (localStorage). Format recommandé : `tip:<domain>:<action>`. */
  id: string;
  /** Condition d'apparition — si false, rien n'est rendu. */
  when: boolean;
  titleKey: string;
  bodyKey:  string;
  ctaLabelKey?: string;
  ctaHref?:     string;
  /** Délai avant apparition (ms) — évite le flash au mount. Défaut 800. */
  delayMs?: number;
}

const TIP_PREFIX = 'tip-seen:';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function ContextualTip({
  id, when, titleKey, bodyKey, ctaLabelKey, ctaHref, delayMs = 800,
}: ContextualTipProps) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!when) { setShow(false); return; }
    if (wasSeenRecently(id)) return;
    const h = window.setTimeout(() => setShow(true), delayMs);
    return () => window.clearTimeout(h);
  }, [when, id, delayMs]);

  if (!show) return null;

  function dismiss() {
    markSeen(id);
    setShow(false);
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[9000] w-[360px] max-w-[calc(100vw-32px)] animate-in slide-in-from-bottom-4 motion-reduce:animate-none"
    >
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-lg dark:border-amber-900/50 dark:bg-amber-950/90">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100">
          <Lightbulb className="h-4 w-4" aria-hidden />
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">{t(titleKey)}</p>
          <p className="mt-1 text-sm leading-relaxed text-amber-900/80 dark:text-amber-100/80">{t(bodyKey)}</p>
          {ctaHref && ctaLabelKey && (
            <Link
              to={ctaHref}
              onClick={dismiss}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-700 dark:text-amber-100"
            >
              {t(ctaLabelKey)}
              <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('tour.close')}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-amber-700 hover:bg-amber-200/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-amber-300 dark:hover:bg-amber-900/50"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

// ─── Persistence helpers ─────────────────────────────────────────────────────

function wasSeenRecently(id: string): boolean {
  try {
    const raw = localStorage.getItem(TIP_PREFIX + id);
    if (!raw) return false;
    const ts = Number(raw);
    return Number.isFinite(ts) && Date.now() - ts < ONE_DAY_MS;
  } catch { return false; }
}

function markSeen(id: string) {
  try { localStorage.setItem(TIP_PREFIX + id, String(Date.now())); } catch { /* quota */ }
}
