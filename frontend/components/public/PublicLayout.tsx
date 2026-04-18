/**
 * PublicLayout — Shell des pages publiques (landing, pricing, compare, security).
 *
 * Structure :
 *   - Skip-link a11y (focus clavier)
 *   - Header sticky : logo, nav, language switcher, theme toggle, CTAs
 *   - <main> en slot
 *   - Footer 4 colonnes + copyright
 *
 * Réutilisable pour toutes les routes marketing — ne pas duppliquer le header.
 */
import { useState, useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X, Globe, Sun, Moon, Check } from 'lucide-react';
import { useI18n } from '../../lib/i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import type { Language } from '../../lib/i18n/types';
import { LANGUAGE_META } from '../../lib/i18n/types';
import { cn } from '../../lib/utils';

interface PublicLayoutProps {
  children:    ReactNode;
}

type ActiveAnchor = 'product' | 'why' | 'pricing' | 'faq';

export function PublicLayout({ children }: PublicLayoutProps) {
  const { t, lang } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [active, setActive] = useState<ActiveAnchor | null>(null);

  useEffect(() => {
    const ids: Array<{ id: string; key: ActiveAnchor }> = [
      { id: 'modules',         key: 'product' },
      { id: 'differentiators', key: 'why'     },
      { id: 'pricing',         key: 'pricing' },
      { id: 'faq',             key: 'faq'     },
    ];
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) {
          const match = ids.find(i => i.id === visible.target.id);
          if (match) setActive(match.key);
        }
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    ids.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-teal-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-offset-2"
      >
        {t('landing.nav.skipToContent')}
      </a>

      <PublicHeader
        active={active}
        mobileOpen={mobileOpen}
        onMobileToggle={() => setMobileOpen(v => !v)}
      />

      <main id="main-content" className="relative" lang={lang}>
        {children}
      </main>

      <PublicFooter />
    </div>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────

interface PublicHeaderProps {
  active:         ActiveAnchor | null;
  mobileOpen:     boolean;
  onMobileToggle: () => void;
}

function PublicHeader({ active, mobileOpen, onMobileToggle }: PublicHeaderProps) {
  const { t } = useI18n();

  const navLinks: Array<{ key: ActiveAnchor; href: string; labelKey: string }> = [
    { key: 'product',  href: '#modules',         labelKey: 'landing.nav.product' },
    { key: 'why',      href: '#differentiators', labelKey: 'landing.nav.why'     },
    { key: 'pricing',  href: '#pricing',         labelKey: 'landing.nav.pricing' },
    { key: 'faq',      href: '#faq',             labelKey: 'landing.nav.faq'     },
  ];

  return (
    <header
      className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 backdrop-blur-md dark:border-slate-800/70 dark:bg-slate-950/80"
      role="banner"
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Link
          to="/"
          className="flex shrink-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950"
          aria-label="TransLog Pro — Accueil"
        >
          <LogoMark />
          <span className="text-base font-semibold tracking-tight">
            TransLog<span className="text-teal-600 dark:text-teal-400">Pro</span>
          </span>
        </Link>

        <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="Navigation principale">
          {navLinks.map(link => (
            <a
              key={link.key}
              href={link.href}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                'hover:text-teal-600 dark:hover:text-teal-400',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950',
                active === link.key
                  ? 'text-teal-600 dark:text-teal-400'
                  : 'text-slate-700 dark:text-slate-300',
              )}
              aria-current={active === link.key ? 'true' : undefined}
            >
              {t(link.labelKey)}
            </a>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-1 md:flex">
          <LanguageSwitcher />
          <ThemeToggle />
          <Link
            to="/login"
            className="ml-2 rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:text-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:text-slate-300 dark:hover:text-teal-400 dark:focus-visible:ring-offset-slate-950"
          >
            {t('landing.nav.login')}
          </Link>
          <a
            href="#pricing"
            className="inline-flex h-9 items-center justify-center rounded-md bg-teal-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950"
          >
            {t('landing.nav.cta')}
          </a>
        </div>

        <button
          type="button"
          onClick={onMobileToggle}
          className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus-visible:ring-offset-slate-950 md:hidden"
          aria-label={mobileOpen ? t('landing.nav.closeMenu') : t('landing.nav.openMenu')}
          aria-expanded={mobileOpen}
          aria-controls="public-mobile-menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div
          id="public-mobile-menu"
          className="border-t border-slate-200 bg-white px-4 py-4 md:hidden dark:border-slate-800 dark:bg-slate-950"
        >
          <nav className="flex flex-col gap-1" aria-label="Navigation mobile">
            {navLinks.map(link => (
              <a
                key={link.key}
                href={link.href}
                className="rounded-md px-3 py-2 text-base font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                onClick={onMobileToggle}
              >
                {t(link.labelKey)}
              </a>
            ))}
            <div className="mt-2 flex items-center gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
              <LanguageSwitcher />
              <ThemeToggle />
            </div>
            <Link
              to="/login"
              className="rounded-md px-3 py-2 text-base font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={onMobileToggle}
            >
              {t('landing.nav.login')}
            </Link>
            <a
              href="#pricing"
              className="mt-1 inline-flex h-10 items-center justify-center rounded-md bg-teal-600 px-4 text-sm font-semibold text-white hover:bg-teal-500"
              onClick={onMobileToggle}
            >
              {t('landing.nav.cta')}
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}

// ─── Logo ────────────────────────────────────────────────────────────────────

function LogoMark() {
  return (
    <span
      aria-hidden
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-teal-700 text-white shadow-sm"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        <path d="M4 17h2l2-10h8l2 10h2" />
        <circle cx="8" cy="19" r="2" />
        <circle cx="16" cy="19" r="2" />
      </svg>
    </span>
  );
}

// ─── Language Switcher ───────────────────────────────────────────────────────

function LanguageSwitcher() {
  const { lang, setLang, languages } = useI18n();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus-visible:ring-offset-slate-950"
        aria-label={t('landing.nav.switchLanguage')}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Globe className="h-4 w-4" aria-hidden />
        <span className="uppercase">{lang}</span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <ul
            role="listbox"
            aria-label={t('landing.nav.switchLanguage')}
            className="absolute right-0 z-50 mt-1 w-44 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-800 dark:bg-slate-900"
          >
            {(Object.keys(languages) as Language[]).map(code => (
              <li key={code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={code === lang}
                  onClick={() => { setLang(code); setOpen(false); }}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm',
                    'hover:bg-slate-100 dark:hover:bg-slate-800',
                    code === lang && 'font-semibold text-teal-700 dark:text-teal-400',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span aria-hidden>{LANGUAGE_META[code].flag}</span>
                    <span>{LANGUAGE_META[code].label}</span>
                  </span>
                  {code === lang && <Check className="h-4 w-4" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ─── Theme Toggle ────────────────────────────────────────────────────────────

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { t } = useI18n();

  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus-visible:ring-offset-slate-950"
      aria-label={t('landing.nav.switchTheme')}
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
    </button>
  );
}

// ─── Footer ──────────────────────────────────────────────────────────────────

function PublicFooter() {
  const { t } = useI18n();
  const year = new Date().getFullYear();

  // Phase 1 : seuls les ancres internes existent (single-page). Les liens vers
  // les futures routes (/blog, /docs, /legal/*, etc.) sont masqués tant que
  // leurs pages n'existent pas — éviter les liens morts.
  const cols: Array<{ titleKey: string; links: Array<{ labelKey: string; href: string }> }> = [
    {
      titleKey: 'landing.footer.product',
      links: [
        { labelKey: 'landing.footer.features',  href: '#modules'         },
        { labelKey: 'landing.footer.pricing',   href: '#pricing'         },
        { labelKey: 'landing.footer.security',  href: '#differentiators' },
      ],
    },
    {
      titleKey: 'landing.footer.company',
      links: [
        { labelKey: 'landing.footer.contact', href: '#cta' },
      ],
    },
    {
      titleKey: 'landing.footer.resources',
      links: [
        { labelKey: 'landing.footer.support', href: '#faq' },
      ],
    },
  ];

  return (
    <footer className="border-t border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40" role="contentinfo">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        <div className="grid grid-cols-2 gap-8 lg:grid-cols-5">
          <div className="col-span-2">
            <Link to="/" className="inline-flex items-center gap-2" aria-label="TransLog Pro — Accueil">
              <LogoMark />
              <span className="text-base font-semibold tracking-tight">
                TransLog<span className="text-teal-600 dark:text-teal-400">Pro</span>
              </span>
            </Link>
            <p className="mt-4 max-w-sm text-sm text-slate-600 dark:text-slate-400">
              {t('landing.footer.tagline')}
            </p>
          </div>

          {cols.map(col => (
            <div key={col.titleKey}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {t(col.titleKey)}
              </h3>
              <ul className="mt-4 space-y-2">
                {col.links.map(link => (
                  <li key={link.labelKey}>
                    <a
                      href={link.href}
                      className="text-sm text-slate-700 transition-colors hover:text-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:text-slate-300 dark:hover:text-teal-400 dark:focus-visible:ring-offset-slate-900"
                    >
                      {t(link.labelKey)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-slate-200 pt-6 text-sm text-slate-500 sm:flex-row dark:border-slate-800 dark:text-slate-400">
          <p>{t('landing.footer.copyright').replace('{year}', String(year))}</p>
          <p className="inline-flex items-center gap-1.5">
            <span aria-hidden>🌍</span>
            {t('landing.footer.madeIn')}
          </p>
        </div>
      </div>
    </footer>
  );
}
