/**
 * Layout Variants — composants de layout alternatifs pour le portail voyageur.
 *
 * Chaque layout (horizon, vivid, prestige) fournit des variantes pour :
 *   - Navbar
 *   - Hero + Search form
 *   - Trip Cards
 *   - Section titles
 *   - Footer
 *
 * Le layout "classic" utilise les composants d'origine dans PortailVoyageur.tsx.
 * i18n : toutes chaînes via t()
 * Responsive : mobile-first
 * Dark mode : classes Tailwind dark:
 * WCAG : aria-labels, rôles, focus-visible
 */

import { useState, useEffect, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

// ─── Shared types used across variants ───────────────────────────────────────

export interface NavItem { key: string; label: string }

export interface VariantNavbarProps {
  brandName: string;
  brandLogo?: string;
  nav: NavItem[];
  section: string;
  onSection: (key: string) => void;
  onHome: () => void;
  mobileNav: boolean;
  setMobileNav: (v: boolean | ((p: boolean) => boolean)) => void;
  themeToggle: ReactNode;
  langSwitcher: ReactNode;
  loginLabel: string;
  accent: string;
  accentDark: string;
  t: (k: string) => string;
}

export interface VariantHeroProps {
  scenes: { bg: string; overlay: string }[];
  searchForm: ReactNode;
  title: string;
  subtitle: string;
  stats: { value: string; label: string }[];
  accent: string;
  accentDark: string;
  t: (k: string) => string;
}

interface TripData {
  id: string;
  departure: string;
  arrival: string;
  departureTime: string;
  arrivalTime: string;
  price: number;
  availableSeats: number;
  busType: string;
  busModel: string;
  amenities: string[];
  canBook: boolean;
  stops?: { city: string; name: string; km: number }[];
  distanceKm?: number;
}

export interface VariantTripCardProps {
  trip: TripData;
  onBook: (t: TripData) => void;
  fmt: (n: number) => string;
  fmtTime: (iso: string) => string;
  fmtDuration: (dep: string, arr: string) => string;
  accent: string;
  accentDark: string;
  accentLight: string;
  t: (k: string) => string;
}

export interface VariantFooterProps {
  brandName: string;
  brandLogo?: string;
  nav: NavItem[];
  onSection: (key: string) => void;
  accent: string;
  accentDark: string;
  t: (k: string) => string;
}

export interface VariantSectionTitleProps {
  title: string;
  accent: string;
  accentDark: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HORIZON — minimaliste, épuré, whitespace, centré
// ═══════════════════════════════════════════════════════════════════════════════

export function HorizonNavbar({
  brandName, brandLogo, nav, section, onSection, onHome,
  mobileNav, setMobileNav, themeToggle, langSwitcher, loginLabel, t,
}: VariantNavbarProps) {
  return (
    <nav className="sticky top-0 z-40 bg-white/60 dark:bg-slate-950/60 backdrop-blur-2xl" role="navigation" aria-label={t('portail.navLabel')}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        {/* Top row: centered logo */}
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-1.5 shrink-0">
            {themeToggle}
            {langSwitcher}
          </div>
          <button onClick={onHome} className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 hover:opacity-70 transition-opacity" aria-label={brandName}>
            {brandLogo
              ? <img src={brandLogo} alt={brandName} className="w-8 h-8 rounded-lg object-cover" />
              : <div className="w-8 h-8 rounded-lg bg-slate-900 dark:bg-white flex items-center justify-center text-white dark:text-slate-900 font-black text-sm">{brandName.charAt(0) || 'T'}</div>}
            <span className="font-semibold text-slate-900 dark:text-white text-sm tracking-tight hidden sm:block">{brandName}</span>
          </button>
          <div className="flex items-center gap-1.5 shrink-0">
            <button className="hidden sm:block text-xs border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 px-3 py-1.5 rounded-full font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">{loginLabel}</button>
            <button
              onClick={() => setMobileNav((v: boolean) => !v)}
              className="md:hidden p-2 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
              aria-label={mobileNav ? t('portail.closeMenu') : t('portail.openMenu')}
              aria-expanded={mobileNav}
            >
              {mobileNav
                ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 12h18M3 6h18M3 18h18"/></svg>}
            </button>
          </div>
        </div>
        {/* Bottom row: nav links — centered, minimal underline */}
        <div className="hidden md:flex items-center justify-center gap-6 pb-3 -mt-1">
          {nav.map(n => (
            <button
              key={n.key}
              onClick={() => onSection(n.key)}
              className={cn(
                'text-xs font-medium tracking-wide uppercase transition-all pb-1 border-b-2',
                section === n.key
                  ? 'border-slate-900 dark:border-white text-slate-900 dark:text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300',
              )}
            >
              {n.label}
            </button>
          ))}
        </div>
      </div>
      {/* Mobile: slide-down centered list */}
      {mobileNav && (
        <div className="md:hidden border-t border-slate-100 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 backdrop-blur-xl">
          <div className="max-w-5xl mx-auto px-4 py-4 flex flex-col items-center gap-2">
            {nav.map(n => (
              <button key={n.key} onClick={() => { onSection(n.key); setMobileNav(false); }}
                className={cn('text-sm font-medium py-2 transition-colors', section === n.key ? 'text-slate-900 dark:text-white' : 'text-slate-400')}>
                {n.label}
              </button>
            ))}
            <button className="sm:hidden mt-2 text-xs border border-slate-300 text-slate-700 px-4 py-2 rounded-full font-medium">{loginLabel}</button>
          </div>
        </div>
      )}
    </nav>
  );
}

export function HorizonHero({ scenes, searchForm, title, subtitle, stats }: VariantHeroProps) {
  const [idx, setIdx] = useState(0);
  useEffect(() => { const iv = setInterval(() => setIdx(i => (i + 1) % scenes.length), 8000); return () => clearInterval(iv); }, [scenes.length]);
  return (
    <div className="relative min-h-[85vh] sm:min-h-[90vh] flex flex-col items-center justify-center overflow-hidden">
      {/* Background */}
      {scenes.map((scene, i) => (
        <div key={i} className="absolute inset-0 transition-opacity duration-[3000ms]" style={{ opacity: i === idx ? 1 : 0 }}>
          <div className="absolute inset-0" style={{ background: scene.bg }} />
          <div className="absolute inset-0" style={{ background: scene.overlay }} />
        </div>
      ))}
      {/* Centered content */}
      <div className="relative z-10 text-center px-4 max-w-2xl mx-auto">
        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black text-white leading-[1.05] tracking-tight">{title}</h1>
        <p className="text-sm sm:text-lg text-white/50 mt-4 max-w-md mx-auto leading-relaxed font-light">{subtitle}</p>
        {/* Stats row — minimal */}
        <div className="flex items-center justify-center gap-8 mt-8">
          {stats.map(s => (
            <div key={s.label} className="text-center">
              <p className="text-2xl sm:text-3xl font-black text-white">{s.value}</p>
              <p className="text-[9px] text-white/30 uppercase tracking-[0.2em] mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
      {/* Carousel dots — bottom center, minimal lines */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-3">
        {scenes.map((_, i) => (
          <button key={i} onClick={() => setIdx(i)} className={cn('h-[2px] rounded-full transition-all duration-700', i === idx ? 'bg-white w-10' : 'bg-white/20 w-4')} aria-label={`Scene ${i + 1}`} />
        ))}
      </div>
      {/* Search form — floating bar below hero center */}
      <div className="absolute bottom-0 left-0 right-0 translate-y-1/2 z-20 px-4">
        <div className="max-w-4xl mx-auto bg-white dark:bg-slate-900 rounded-2xl shadow-2xl shadow-black/10 border border-slate-200/50 dark:border-slate-700/50 p-3 sm:p-4">
          {searchForm}
        </div>
      </div>
    </div>
  );
}

export function HorizonTripCard({ trip, onBook, fmt, fmtTime, fmtDuration, t }: VariantTripCardProps) {
  const full = trip.availableSeats === 0;
  const urgent = trip.availableSeats > 0 && trip.availableSeats <= 5;
  return (
    <div className={cn('group py-5 border-b border-slate-100 dark:border-slate-800 last:border-b-0 transition-colors', full && 'opacity-50')}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        {/* Times — large, left-aligned */}
        <div className="flex items-center gap-4 sm:w-56 shrink-0">
          <div className="text-center">
            <p className="text-2xl font-black text-slate-900 dark:text-white tabular-nums tracking-tight">{fmtTime(trip.departureTime)}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{trip.departure}</p>
          </div>
          <div className="flex flex-col items-center flex-1 sm:flex-none sm:w-16">
            <div className="h-[1px] w-full bg-slate-200 dark:bg-slate-700" />
            <span className="text-[9px] text-slate-400 mt-1 font-medium tracking-wider uppercase">{fmtDuration(trip.departureTime, trip.arrivalTime)}</span>
          </div>
          <div className="text-center">
            <p className="text-2xl font-black text-slate-900 dark:text-white tabular-nums tracking-tight">{fmtTime(trip.arrivalTime)}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{trip.arrival}</p>
          </div>
        </div>
        {/* Info — center */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{trip.busModel} <span className="text-slate-400 font-normal">&middot; {trip.busType}</span></p>
          {trip.amenities.length > 0 && (
            <p className="text-[10px] text-slate-400 mt-1 truncate">{trip.amenities.join(' &middot; ')}</p>
          )}
          {trip.stops && trip.stops.length > 0 && (
            <p className="text-[10px] text-slate-400 mt-0.5">{trip.stops.length} {t('portail.stops')}</p>
          )}
        </div>
        {/* Price + action — right */}
        <div className="flex items-center gap-4 sm:flex-col sm:items-end shrink-0">
          <div className="text-right">
            <p className="text-xl font-black text-slate-900 dark:text-white">{fmt(trip.price)}</p>
            {full && <span className="text-[10px] font-bold text-red-500 uppercase">{t('portail.full')}</span>}
            {urgent && <span className="text-[10px] font-bold text-slate-500">{trip.availableSeats} {t('portail.seatsLeftSuffix')}</span>}
          </div>
          <button
            disabled={full}
            onClick={() => onBook(trip)}
            className={cn(
              'px-5 py-2 rounded-full text-xs font-semibold transition-all tracking-wide uppercase',
              full
                ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                : 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-700 active:scale-95',
            )}
          >
            {full ? t('portail.unavailable') : t('portail.book')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function HorizonSectionTitle({ title }: VariantSectionTitleProps) {
  return (
    <div className="text-center mb-10">
      <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight uppercase">{title}</h2>
      <div className="w-8 h-[2px] bg-slate-900 dark:bg-white mx-auto mt-3" />
    </div>
  );
}

export function HorizonFooter({ brandName, nav, onSection, t }: VariantFooterProps) {
  return (
    <footer className="border-t border-slate-100 dark:border-slate-800 mt-auto shrink-0" role="contentinfo">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-xs text-slate-400 font-medium">{brandName}</p>
        <div className="flex items-center gap-4">
          {nav.slice(0, 4).map(n => (
            <button key={n.key} onClick={() => onSection(n.key)} className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 uppercase tracking-wider font-medium transition-colors">{n.label}</button>
          ))}
        </div>
        <p className="text-[10px] text-slate-300 dark:text-slate-600">{t('portail.poweredBy')} TranslogPro</p>
      </div>
    </footer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  VIVID — moderne, split-screen, couleurs vives, cards horizontales
// ═══════════════════════════════════════════════════════════════════════════════

export function VividNavbar({
  brandName, brandLogo, nav, section, onSection, onHome,
  mobileNav, setMobileNav, themeToggle, langSwitcher, loginLabel, accent, t,
}: VariantNavbarProps) {
  return (
    <nav className="sticky top-0 z-40 bg-white dark:bg-slate-950 border-b border-slate-200/50 dark:border-slate-800/50 shadow-sm" role="navigation" aria-label={t('portail.navLabel')}>
      <div className="max-w-6xl mx-auto flex items-center justify-between h-14 sm:h-16 px-4 sm:px-6">
        <button onClick={onHome} className="flex items-center gap-2.5 shrink-0 hover:opacity-80 transition-opacity" aria-label={brandName}>
          {brandLogo
            ? <img src={brandLogo} alt={brandName} className="w-9 h-9 rounded-2xl object-cover" />
            : <div className="w-9 h-9 rounded-2xl flex items-center justify-center text-white font-bold text-sm" style={{ background: `linear-gradient(135deg, ${accent}, var(--portal-accent-dark))` }}>{brandName.charAt(0) || 'T'}</div>}
          <span className="font-bold text-slate-900 dark:text-white text-base tracking-tight hidden sm:block">{brandName}</span>
        </button>
        {/* Desktop: pill-shaped nav items */}
        <div className="hidden md:flex items-center gap-1.5 mx-4">
          {nav.map(n => (
            <button
              key={n.key}
              onClick={() => onSection(n.key)}
              className={cn(
                'px-4 py-2 rounded-full text-xs font-semibold transition-all',
                section === n.key
                  ? 'text-white shadow-md'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700',
              )}
              style={section === n.key ? { background: `linear-gradient(135deg, ${accent}, var(--portal-accent-dark))` } : undefined}
            >
              {n.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {themeToggle}
          {langSwitcher}
          <button className="hidden sm:block text-xs text-white px-4 py-2 rounded-full font-semibold shadow-md hover:brightness-110 transition-all ml-1" style={{ background: `linear-gradient(135deg, ${accent}, var(--portal-accent-dark))` }}>{loginLabel}</button>
          <button
            onClick={() => setMobileNav((v: boolean) => !v)}
            className="md:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ml-1"
            aria-label={mobileNav ? t('portail.closeMenu') : t('portail.openMenu')}
            aria-expanded={mobileNav}
          >
            {mobileNav
              ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
              : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 12h18M3 6h18M3 18h18"/></svg>}
          </button>
        </div>
      </div>
      {/* Mobile menu */}
      {mobileNav && (
        <div className="md:hidden bg-white dark:bg-slate-950 border-t border-slate-200/50 dark:border-slate-800/50">
          <div className="max-w-6xl mx-auto px-4 py-3 grid grid-cols-2 gap-2">
            {nav.map(n => (
              <button key={n.key} onClick={() => { onSection(n.key); setMobileNav(false); }}
                className={cn('py-3 rounded-2xl text-sm font-semibold transition-all text-center',
                  section === n.key ? 'text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400')}
                style={section === n.key ? { background: `linear-gradient(135deg, ${accent}, var(--portal-accent-dark))` } : undefined}>
                {n.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}

export function VividHero({ scenes, searchForm, title, subtitle, stats, accent, accentDark }: VariantHeroProps) {
  const [idx, setIdx] = useState(0);
  useEffect(() => { const iv = setInterval(() => setIdx(i => (i + 1) % scenes.length), 7000); return () => clearInterval(iv); }, [scenes.length]);
  return (
    <div className="relative overflow-hidden">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-2 gap-0 min-h-[65vh] lg:min-h-[75vh]">
        {/* Left: text + search */}
        <div className="flex flex-col justify-center py-10 sm:py-16 lg:py-20 lg:pr-8 z-10 relative">
          <div className="flex items-center gap-2 mb-4">
            {[1, 2, 3, 4, 5].map(i => <span key={i} className="text-sm" style={{ color: accent }}>{'\u2605'}</span>)}
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-slate-900 dark:text-white leading-[1.1] tracking-tight">{title}</h1>
          <p className="text-sm sm:text-base text-slate-500 mt-3 max-w-md leading-relaxed">{subtitle}</p>
          {/* Search form inline */}
          <div className="mt-8 bg-slate-50 dark:bg-slate-900 rounded-3xl p-4 sm:p-6 border border-slate-200 dark:border-slate-700/50">
            {searchForm}
          </div>
          {/* Stats */}
          <div className="flex items-center gap-6 sm:gap-10 mt-8">
            {stats.map(s => (
              <div key={s.label}>
                <p className="text-xl sm:text-2xl font-black" style={{ color: accent }}>{s.value}</p>
                <p className="text-[9px] text-slate-400 uppercase tracking-[0.15em] mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
        {/* Right: decorative gradient panel */}
        <div className="hidden lg:block relative">
          {scenes.map((scene, i) => (
            <div key={i} className="absolute inset-0 transition-opacity duration-[2500ms] rounded-bl-[60px]" style={{ opacity: i === idx ? 1 : 0 }}>
              <div className="absolute inset-0 rounded-bl-[60px]" style={{ background: scene.bg }} />
              <div className="absolute inset-0 rounded-bl-[60px]" style={{ background: scene.overlay }} />
            </div>
          ))}
          {/* Decorative elements */}
          <div className="absolute bottom-10 left-10 z-10">
            <div className="w-20 h-20 rounded-3xl border-2 border-white/10 rotate-12" />
            <div className="w-14 h-14 rounded-2xl border-2 border-white/5 -rotate-6 -mt-4 ml-8" />
          </div>
          {/* Dots */}
          <div className="absolute bottom-6 right-6 flex gap-2 z-10">
            {scenes.map((_, i) => (
              <button key={i} onClick={() => setIdx(i)} className={cn('w-2 h-2 rounded-full transition-all', i === idx ? 'w-6' : 'bg-white/30')} style={i === idx ? { background: accent } : undefined} aria-label={`Scene ${i + 1}`} />
            ))}
          </div>
        </div>
      </div>
      {/* Mobile: gradient strip under content */}
      <div className="lg:hidden h-4 -mt-2 relative overflow-hidden">
        <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, ${accent}30, ${accentDark}30, ${accent}30)` }} />
      </div>
    </div>
  );
}

export function VividTripCard({ trip, onBook, fmt, fmtTime, fmtDuration, accent, accentLight, t }: VariantTripCardProps) {
  const full = trip.availableSeats === 0;
  const urgent = trip.availableSeats > 0 && trip.availableSeats <= 5;
  const isVip = trip.busType === 'VIP';
  return (
    <div className={cn('group flex rounded-2xl border overflow-hidden transition-all bg-white dark:bg-slate-900/80', full ? 'opacity-50 border-slate-200 dark:border-slate-800' : 'border-slate-200 dark:border-slate-700/50 hover:shadow-xl')}>
      {/* Left color bar */}
      <div className="w-1.5 shrink-0 rounded-l-2xl" style={{ background: full ? '#94a3b8' : isVip ? `linear-gradient(to bottom, ${accent}, ${accentLight})` : accent }} />
      <div className="flex-1 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3">
        {/* Times */}
        <div className="flex items-center gap-3 sm:w-48 shrink-0">
          <div>
            <p className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">{fmtTime(trip.departureTime)}</p>
            <p className="text-[10px] text-slate-400">{trip.departure}</p>
          </div>
          <div className="flex flex-col items-center w-12">
            <svg width="20" height="8" viewBox="0 0 20 8" className="text-slate-300"><path d="M0 4h16M14 1l3 3-3 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" /></svg>
            <span className="text-[9px] text-slate-400 font-medium">{fmtDuration(trip.departureTime, trip.arrivalTime)}</span>
          </div>
          <div>
            <p className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">{fmtTime(trip.arrivalTime)}</p>
            <p className="text-[10px] text-slate-400">{trip.arrival}</p>
          </div>
        </div>
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{trip.busModel}</span>
            {isVip && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ background: accent }}>VIP</span>}
          </div>
          <div className="flex gap-1.5 flex-wrap mt-1.5">
            {trip.amenities.slice(0, 3).map(a => (
              <span key={a} className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: accentLight, color: accent }}>{a}</span>
            ))}
          </div>
        </div>
        {/* Price + book */}
        <div className="flex items-center gap-3 sm:flex-col sm:items-end shrink-0">
          <p className="text-xl font-black text-slate-900 dark:text-white">{fmt(trip.price)}</p>
          {urgent && <span className="text-[10px] font-bold animate-pulse" style={{ color: accent }}>{trip.availableSeats} {t('portail.seatsLeftSuffix')}</span>}
          <button disabled={full} onClick={() => onBook(trip)}
            className={cn('px-5 py-2.5 rounded-2xl text-xs font-bold transition-all', full ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'text-white hover:brightness-110 active:scale-95 shadow-lg')}
            style={full ? undefined : { background: `linear-gradient(135deg, ${accent}, var(--portal-accent-dark))` }}>
            {full ? t('portail.unavailable') : t('portail.book')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function VividSectionTitle({ title, accent }: VariantSectionTitleProps) {
  return (
    <div className="flex items-center gap-3 mb-8">
      <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-white" style={{ background: `linear-gradient(135deg, ${accent}, var(--portal-accent-dark))` }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z"/></svg>
      </div>
      <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">{title}</h2>
    </div>
  );
}

export function VividFooter({ brandName, brandLogo, nav, onSection, accent, t }: VariantFooterProps) {
  return (
    <footer className="mt-auto shrink-0 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800" role="contentinfo">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-8">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              {brandLogo ? <img src={brandLogo} alt="" className="w-8 h-8 rounded-xl object-cover" /> : <div className="w-8 h-8 rounded-xl text-white font-bold text-xs flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${accent}, var(--portal-accent-dark))` }}>{brandName.charAt(0)}</div>}
              <span className="font-bold text-slate-900 dark:text-white">{brandName}</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">{t('portail.footerAbout')}</p>
          </div>
          {/* Nav links */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: accent }}>{t('portail.footerLinks')}</p>
            <div className="space-y-2">{nav.map(n => <button key={n.key} onClick={() => onSection(n.key)} className="block text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 transition-colors">{n.label}</button>)}</div>
          </div>
          {/* Legal */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: accent }}>{t('portail.footerLegal')}</p>
            <div className="space-y-2">
              <a href="#" className="block text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900">CGV</a>
              <a href="#" className="block text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900">{t('portail.privacy')}</a>
              <a href="#" className="block text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900">{t('portail.legalMentions')}</a>
            </div>
          </div>
          {/* Newsletter */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: accent }}>Newsletter</p>
            <p className="text-xs text-slate-500 mb-3">{t('portail.footerAbout')}</p>
            <div className="flex gap-2">
              <input type="email" placeholder="email@exemple.com" className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs focus:outline-none focus:ring-2" style={{ boxShadow: `0 0 0 0px ${accent}40` }} />
              <button className="px-3 py-2 rounded-xl text-white text-xs font-semibold" style={{ background: accent }}>OK</button>
            </div>
          </div>
        </div>
        <div className="border-t border-slate-200 dark:border-slate-800 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-slate-400">{t('portail.copyright')}</p>
          <p className="text-xs text-slate-400">{t('portail.poweredBy')} <span className="font-semibold text-slate-500">TranslogPro</span></p>
        </div>
      </div>
    </footer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PRESTIGE — luxe classique, barre sombre, accents dorés, letterbox
// ═══════════════════════════════════════════════════════════════════════════════

export function PrestigeNavbar({
  brandName, brandLogo, nav, section, onSection, onHome,
  mobileNav, setMobileNav, themeToggle, langSwitcher, loginLabel, accent, t,
}: VariantNavbarProps) {
  return (
    <nav className="sticky top-0 z-40 bg-slate-950 text-white" role="navigation" aria-label={t('portail.navLabel')}>
      <div className="max-w-6xl mx-auto flex items-center justify-between h-16 px-4 sm:px-6">
        <button onClick={onHome} className="flex items-center gap-3 shrink-0 hover:opacity-80 transition-opacity" aria-label={brandName}>
          {brandLogo
            ? <img src={brandLogo} alt={brandName} className="w-9 h-9 rounded-lg object-cover border border-white/10" />
            : <div className="w-9 h-9 rounded-lg border-2 flex items-center justify-center font-bold text-sm" style={{ borderColor: accent, color: accent }}>{brandName.charAt(0) || 'T'}</div>}
          <div className="hidden sm:block">
            <span className="font-bold text-white text-sm tracking-wider uppercase">{brandName}</span>
            <div className="h-[1px] mt-0.5" style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }} />
          </div>
        </button>
        {/* Desktop: elegant nav with gold underlines */}
        <div className="hidden md:flex items-center gap-6 mx-4">
          {nav.map(n => (
            <button key={n.key} onClick={() => onSection(n.key)}
              className={cn('text-xs font-medium tracking-wider uppercase transition-all py-1', section === n.key ? 'text-white' : 'text-slate-400 hover:text-slate-200')}>
              {n.label}
              {section === n.key && <div className="h-[2px] mt-1 rounded-full" style={{ background: accent }} />}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="[&_button]:text-slate-400 [&_button:hover]:text-white">{themeToggle}</div>
          <div className="[&_button]:text-slate-400 [&_button:hover]:text-white">{langSwitcher}</div>
          <button className="hidden sm:block text-xs px-4 py-2 rounded-lg font-semibold border transition-colors ml-2 hover:bg-white/5" style={{ borderColor: accent, color: accent }}>{loginLabel}</button>
          <button
            onClick={() => setMobileNav((v: boolean) => !v)}
            className="md:hidden p-2 text-slate-400 hover:text-white transition-colors ml-1"
            aria-label={mobileNav ? t('portail.closeMenu') : t('portail.openMenu')}
            aria-expanded={mobileNav}
          >
            {mobileNav
              ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
              : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 12h18M3 6h18M3 18h18"/></svg>}
          </button>
        </div>
      </div>
      {/* Mobile */}
      {mobileNav && (
        <div className="md:hidden border-t border-slate-800 bg-slate-950">
          <div className="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-1">
            {nav.map(n => (
              <button key={n.key} onClick={() => { onSection(n.key); setMobileNav(false); }}
                className={cn('w-full text-left px-4 py-3 text-sm font-medium transition-colors', section === n.key ? 'text-white' : 'text-slate-500')}>
                {section === n.key && <span className="mr-2" style={{ color: accent }}>&mdash;</span>}
                {n.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}

export function PrestigeHero({ scenes, searchForm, title, subtitle, stats, accent, t }: VariantHeroProps) {
  const [idx, setIdx] = useState(0);
  useEffect(() => { const iv = setInterval(() => setIdx(i => (i + 1) % scenes.length), 7000); return () => clearInterval(iv); }, [scenes.length]);
  return (
    <div>
      {/* Letterbox hero — shorter, cinematic */}
      <div className="relative h-[45vh] sm:h-[55vh] overflow-hidden">
        {scenes.map((scene, i) => (
          <div key={i} className="absolute inset-0 transition-opacity duration-[2500ms]" style={{ opacity: i === idx ? 1 : 0 }}>
            <div className="absolute inset-0" style={{ background: scene.bg }} />
            <div className="absolute inset-0" style={{ background: scene.overlay }} />
          </div>
        ))}
        {/* Gold rule lines */}
        <div className="absolute top-8 left-8 right-8 h-[1px]" style={{ background: `linear-gradient(90deg, transparent, ${accent}40, transparent)` }} />
        <div className="absolute bottom-8 left-8 right-8 h-[1px]" style={{ background: `linear-gradient(90deg, transparent, ${accent}40, transparent)` }} />
        {/* Content — centered, elegant */}
        <div className="relative h-full flex flex-col items-center justify-center text-center px-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-[1px]" style={{ background: accent }} />
            <span className="text-[10px] font-semibold uppercase tracking-[0.3em]" style={{ color: accent }}>{t('portail.trustedBy')}</span>
            <div className="w-8 h-[1px]" style={{ background: accent }} />
          </div>
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black text-white leading-[1.1] tracking-tight max-w-3xl">{title}</h1>
          <p className="text-sm sm:text-lg text-white/50 mt-3 max-w-lg leading-relaxed">{subtitle}</p>
          {/* Stats */}
          <div className="flex items-center gap-8 sm:gap-12 mt-8">
            {stats.map((s, i) => (
              <div key={s.label} className="flex items-center gap-4">
                <div className="text-center">
                  <p className="text-xl sm:text-2xl font-black text-white">{s.value}</p>
                  <p className="text-[9px] text-white/40 uppercase tracking-[0.2em] mt-0.5">{s.label}</p>
                </div>
                {i < stats.length - 1 && <div className="w-[1px] h-8 bg-white/10" />}
              </div>
            ))}
          </div>
        </div>
        {/* Carousel dots — gold bars */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
          {scenes.map((_, i) => (
            <button key={i} onClick={() => setIdx(i)} className={cn('h-1 rounded-full transition-all duration-700', i === idx ? 'w-8' : 'w-2 bg-white/20')} style={i === idx ? { background: accent } : undefined} aria-label={`Scene ${i + 1}`} />
          ))}
        </div>
      </div>
      {/* Search form — separate bar below hero, dark bg */}
      <div className="bg-slate-900 dark:bg-slate-900 border-b border-slate-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-5">
          {searchForm}
        </div>
      </div>
    </div>
  );
}

export function PrestigeTripCard({ trip, onBook, fmt, fmtTime, fmtDuration, accent, t }: VariantTripCardProps) {
  const full = trip.availableSeats === 0;
  const urgent = trip.availableSeats > 0 && trip.availableSeats <= 5;
  const isVip = trip.busType === 'VIP';
  return (
    <div className={cn('group relative rounded-xl border transition-all bg-white dark:bg-slate-900', full ? 'opacity-50 border-slate-200 dark:border-slate-800' : 'hover:shadow-xl')}>
      {/* Subtle gold top border */}
      {!full && <div className="absolute top-0 left-4 right-4 h-[2px] rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${accent}60, transparent)` }} />}
      {isVip && <div className="absolute -top-3 right-6 px-3 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-white rounded-full" style={{ background: accent }}>VIP</div>}
      <div className="p-5 sm:p-6" style={!full ? { borderColor: `${accent}20` } : undefined}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          {/* Times */}
          <div className="flex items-center gap-4 sm:w-56 shrink-0">
            <div className="text-center">
              <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{fmtTime(trip.departureTime)}</p>
              <p className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wider">{trip.departure}</p>
            </div>
            <div className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: accent }}>{fmtDuration(trip.departureTime, trip.arrivalTime)}</span>
              <div className="w-full h-[1px]" style={{ background: `linear-gradient(90deg, ${accent}40, ${accent}, ${accent}40)` }} />
              {trip.stops && trip.stops.length > 0 && <span className="text-[9px]" style={{ color: accent }}>{trip.stops.length} {t('portail.stops')}</span>}
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{fmtTime(trip.arrivalTime)}</p>
              <p className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wider">{trip.arrival}</p>
            </div>
          </div>
          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{trip.busModel}</p>
            <div className="flex gap-1 flex-wrap mt-1">{trip.amenities.map(a => <span key={a} className="text-[10px] text-slate-400 after:content-['·'] after:mx-1 last:after:content-none">{a}</span>)}</div>
          </div>
          {/* Price + book */}
          <div className="flex items-center gap-4 sm:flex-col sm:items-end shrink-0">
            <div className="text-right">
              <p className="text-xl font-bold" style={isVip ? { color: accent } : undefined}>{fmt(trip.price)}</p>
              {full && <span className="text-[10px] font-bold text-red-500">{t('portail.full')}</span>}
              {urgent && <span className="text-[10px] font-bold" style={{ color: accent }}>{trip.availableSeats} {t('portail.seatsLeftSuffix')}</span>}
            </div>
            <button disabled={full} onClick={() => onBook(trip)}
              className={cn('px-6 py-2.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all border', full ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' : 'text-white hover:brightness-110 active:scale-95 shadow-lg border-transparent')}
              style={full ? undefined : { background: accent }}>
              {full ? t('portail.unavailable') : t('portail.book')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PrestigeSectionTitle({ title, accent }: VariantSectionTitleProps) {
  return (
    <div className="mb-10">
      <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{title}</h2>
      <div className="h-[2px] w-12 mt-2 rounded-full" style={{ background: accent }} />
    </div>
  );
}

export function PrestigeFooter({ brandName, brandLogo, nav, onSection, accent, t }: VariantFooterProps) {
  return (
    <footer className="bg-slate-950 text-white mt-auto shrink-0" role="contentinfo">
      <div className="h-[1px] w-full" style={{ background: `linear-gradient(90deg, transparent, ${accent}40, transparent)` }} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              {brandLogo ? <img src={brandLogo} alt="" className="w-8 h-8 rounded-lg object-cover border border-white/10" /> : <div className="w-8 h-8 rounded-lg border-2 flex items-center justify-center text-xs font-bold" style={{ borderColor: accent, color: accent }}>{brandName.charAt(0)}</div>}
              <span className="font-bold text-white text-sm uppercase tracking-wider">{brandName}</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">{t('portail.footerAbout')}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] mb-3" style={{ color: accent }}>{t('portail.footerLinks')}</p>
            <div className="space-y-2">{nav.map(n => <button key={n.key} onClick={() => onSection(n.key)} className="block text-sm text-slate-400 hover:text-white transition-colors">{n.label}</button>)}</div>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] mb-3" style={{ color: accent }}>{t('portail.footerLegal')}</p>
            <div className="space-y-2">
              <a href="#" className="block text-sm text-slate-400 hover:text-white">CGV</a>
              <a href="#" className="block text-sm text-slate-400 hover:text-white">{t('portail.privacy')}</a>
              <a href="#" className="block text-sm text-slate-400 hover:text-white">{t('portail.legalMentions')}</a>
            </div>
          </div>
        </div>
        <div className="h-[1px] mb-6" style={{ background: `linear-gradient(90deg, transparent, ${accent}30, transparent)` }} />
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-slate-600">{t('portail.copyright')}</p>
          <p className="text-xs text-slate-600">{t('portail.poweredBy')} <span className="font-semibold" style={{ color: accent }}>TranslogPro</span></p>
        </div>
      </div>
    </footer>
  );
}
