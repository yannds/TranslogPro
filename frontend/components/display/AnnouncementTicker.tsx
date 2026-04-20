/**
 * AnnouncementTicker — Bandeau défilant d'annonces gare.
 *
 * Usage :
 *   <AnnouncementTicker announcements={list} lang="fr" />
 *
 * Design :
 *   - Tri par priorité desc ; affichage en marquee continu
 *   - Couleur de fond selon la plus haute priorité active
 *   - Accessible : aria-live="polite" pour les annonces INFO/PROMO,
 *     aria-live="assertive" + role="alert" si au moins une SECURITY/CANCELLATION
 *   - Pause au hover (WCAG 2.1 — 2.2.2 pause / stop)
 *   - Respecte prefers-reduced-motion (pas de défilement, carrousel statique 5s/item)
 *   - Dark + Light natif, RTL compatible
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import type { Announcement } from '../../lib/hooks/useAnnouncements';

const TYPE_STYLES: Record<string, { bg: string; text: string; icon: string }> = {
  SECURITY:     { bg: 'bg-red-600 dark:bg-red-700',       text: 'text-white', icon: '⚠️' },
  CANCELLATION: { bg: 'bg-red-500 dark:bg-red-600',       text: 'text-white', icon: '✕' },
  DELAY:        { bg: 'bg-amber-500 dark:bg-amber-600',   text: 'text-white', icon: '⏱' },
  SUSPENSION:   { bg: 'bg-orange-500 dark:bg-orange-600', text: 'text-white', icon: '⏸' },
  BOARDING:     { bg: 'bg-emerald-600 dark:bg-emerald-700',text: 'text-white', icon: '🚌' },
  ARRIVAL:      { bg: 'bg-sky-600 dark:bg-sky-700',       text: 'text-white', icon: '✓' },
  PROMO:        { bg: 'bg-purple-600 dark:bg-purple-700', text: 'text-white', icon: '★' },
  INFO:         { bg: 'bg-slate-700 dark:bg-slate-800',   text: 'text-white', icon: 'ⓘ' },
  CUSTOM:       { bg: 'bg-slate-700 dark:bg-slate-800',   text: 'text-white', icon: '✎' },
};

export interface AnnouncementTickerProps {
  announcements: Announcement[];
  /** Langue d'affichage (sert aux ARIA labels). Default 'fr' */
  lang?:         'fr' | 'en' | string;
  /** Hauteur du bandeau en pixels. Défaut 44 */
  height?:       number;
  /** Vitesse : pixels par seconde (plus haut = plus rapide). Défaut 80 */
  speedPxPerSec?: number;
  /** Classe supplémentaire */
  className?:    string;
}

export function AnnouncementTicker({
  announcements,
  lang = 'fr',
  height = 44,
  speedPxPerSec = 80,
  className,
}: AnnouncementTickerProps): JSX.Element | null {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef   = useRef<HTMLDivElement | null>(null);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [carouselIdx, setCarouselIdx] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Carousel pour reduced-motion
  useEffect(() => {
    if (!reducedMotion || announcements.length <= 1) return;
    const timer = setInterval(() => {
      setCarouselIdx((i) => (i + 1) % announcements.length);
    }, 5_000);
    return () => clearInterval(timer);
  }, [reducedMotion, announcements.length]);

  // Prime annonce = la plus prioritaire
  const top = announcements[0];
  const hasCritical = announcements.some(a =>
    a.type === 'SECURITY' || a.type === 'CANCELLATION' || a.priority >= 9,
  );

  // Durée animation = longueur du contenu / vitesse
  const [animationSecs, setAnimationSecs] = useState(30);
  useEffect(() => {
    if (reducedMotion) return;
    const el = contentRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    // Longueur totale = somme largeurs des items
    const total = el.scrollWidth + container.offsetWidth;
    setAnimationSecs(Math.max(15, total / speedPxPerSec));
  }, [announcements, reducedMotion, speedPxPerSec]);

  const primary = top ? (TYPE_STYLES[top.type] ?? TYPE_STYLES.INFO) : TYPE_STYLES.INFO;

  const ariaLabel = useMemo(() => {
    if (lang === 'en') return `Station announcements — ${announcements.length} active`;
    return `Annonces de la gare — ${announcements.length} active${announcements.length > 1 ? 's' : ''}`;
  }, [lang, announcements.length]);

  if (announcements.length === 0) return null;

  // Rendu reduced-motion : une annonce à la fois, change toutes les 5s
  if (reducedMotion) {
    const current = announcements[carouselIdx] ?? announcements[0];
    const style   = TYPE_STYLES[current.type] ?? TYPE_STYLES.INFO;
    return (
      <div
        ref={containerRef}
        className={cn('w-full overflow-hidden', style.bg, style.text, className)}
        style={{ height }}
        role={hasCritical ? 'alert' : 'region'}
        aria-live={hasCritical ? 'assertive' : 'polite'}
        aria-label={ariaLabel}
        data-testid="announcement-ticker"
      >
        <div className="flex items-center h-full px-4 gap-3">
          <span className="text-lg" aria-hidden>{style.icon}</span>
          <span className="font-semibold">{current.title}</span>
          <span className="opacity-90 truncate">— {current.message}</span>
        </div>
      </div>
    );
  }

  // Rendu marquee (défilement continu)
  const items = announcements.map((a) => {
    const s = TYPE_STYLES[a.type] ?? TYPE_STYLES.INFO;
    return (
      <span key={a.id} className="inline-flex items-center gap-2 mx-8">
        <span className={cn('rounded px-2 py-0.5 text-xs font-bold', s.bg, s.text)}>
          {s.icon} {a.title}
        </span>
        <span>{a.message}</span>
      </span>
    );
  });

  return (
    <div
      ref={containerRef}
      className={cn('w-full overflow-hidden relative', primary.bg, primary.text, className)}
      style={{ height }}
      role={hasCritical ? 'alert' : 'region'}
      aria-live={hasCritical ? 'assertive' : 'polite'}
      aria-label={ariaLabel}
      data-testid="announcement-ticker"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      tabIndex={0}
    >
      <div
        ref={contentRef}
        className={cn(
          'absolute inset-y-0 left-0 flex items-center whitespace-nowrap font-medium',
          'animate-ticker-scroll',
        )}
        style={{
          animationDuration:     `${animationSecs}s`,
          animationPlayState:    paused ? 'paused' : 'running',
          animationIterationCount: 'infinite',
          animationTimingFunction: 'linear',
          animationName:         'ticker-scroll',
        }}
      >
        {items}
        {/* duplication pour un défilement continu sans saut */}
        {items}
      </div>
      <style>{`
        @keyframes ticker-scroll {
          0%   { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
}
