/**
 * PublicLanding — Page d'accueil marketing TransLog Pro (single-page).
 *
 * Toute la navigation est interne à la page via des ancres (#modules, #pricing,
 * #faq, etc.). Aucune route externe n'est encore implémentée.
 *
 * Sections :
 *   1. Hero (mockup dashboard animé)
 *   2. Trust bar
 *   3. Problème
 *   4. Modules (10)
 *   5. Deep Dive produit (3 moments-clés alternés)
 *   6. Différenciateurs Afrique (6)
 *   7. Couverture continentale (map stylisée + stats)
 *   8. Mobile companion (phone mockup)
 *   9. Pricing teaser (3 plans)
 *  10. FAQ
 *  11. Final CTA + formulaire early-access
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, ApiError } from '../../lib/api';
import { CaptchaWidget } from '../ui/CaptchaWidget';
import { PLATFORM_BASE_DOMAIN } from '../../lib/tenancy/host';
import {
  ArrowRight, PlayCircle, ChevronDown,
  Shield, Cloud, Activity,
  AlertTriangle, FileSpreadsheet, Coins, PackageSearch,
  Ticket, Package, Route, Wallet, Truck, Users,
  Heart, LifeBuoy, LineChart, Workflow,
  Smartphone, Languages, WifiOff, Calculator, Lock,
  Check, Star, QrCode, Banknote, Gift, BellRing,
  MapPin, Mail, Send, UserCircle2, Sparkles,
} from 'lucide-react';
import { PublicLayout } from './PublicLayout';
import { useI18n } from '../../lib/i18n/useI18n';
import { cn } from '../../lib/utils';

export function PublicLanding() {
  return (
    <PublicLayout>
      <HeroSection />
      <TrustBar />
      <ProblemSection />
      <ModulesSection />
      <DeepDiveSection />
      <DifferentiatorsSection />
      <AfricaSection />
      <MobileSection />
      <PricingTeaser />
      <FAQSection />
      <FinalCTA />
    </PublicLayout>
  );
}

// Compensation du header sticky (h-16) pour les ancres.
const anchorOffset = 'scroll-mt-20';

// ─── Hero ────────────────────────────────────────────────────────────────────

function HeroSection() {
  const { t } = useI18n();
  return (
    <section id="hero" className={cn('relative overflow-hidden', anchorOffset)} aria-labelledby="hero-title">
      <div className="absolute inset-0 -z-10" aria-hidden>
        <div className="absolute inset-0 bg-gradient-to-b from-teal-50/60 via-white to-white dark:from-teal-950/40 dark:via-slate-950 dark:to-slate-950" />
        <div className="absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-teal-400/20 blur-3xl dark:bg-teal-500/10" />
      </div>

      <div className="mx-auto max-w-7xl px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:px-8 lg:pb-24 lg:pt-28">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-white/60 px-3 py-1 text-xs font-medium text-teal-700 shadow-sm backdrop-blur dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-300">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-500" aria-hidden />
              {t('landing.hero.eyebrow')}
            </p>

            <h1
              id="hero-title"
              className="mt-5 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl dark:text-white"
            >
              {t('landing.hero.title')}
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600 dark:text-slate-300">
              {t('landing.hero.subtitle')}
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                to="/signup"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-teal-600 px-6 text-base font-semibold text-white shadow-lg shadow-teal-600/20 transition-all hover:bg-teal-500 hover:shadow-teal-600/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950"
              >
                {t('landing.hero.ctaPrimary')}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <a
                href="#deepdive"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-6 text-base font-semibold text-slate-900 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800 dark:focus-visible:ring-offset-slate-950"
              >
                <PlayCircle className="h-5 w-5" aria-hidden />
                {t('landing.hero.ctaSecondary')}
              </a>
            </div>

            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
              {t('landing.hero.ctaNote')}
            </p>
          </div>

          <div className="relative">
            <DashboardMockup />
          </div>
        </div>
      </div>
    </section>
  );
}

function DashboardMockup() {
  const { t } = useI18n();
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/40"
      role="img"
      aria-label={t('landing.hero.mockupTitle')}
    >
      <BrowserChrome url={`acme.${PLATFORM_BASE_DOMAIN}/admin`} />
      <div className="grid grid-cols-12">
        <FakeSidebar />
        <div className="col-span-9 p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MiniKpi label={t('landing.hero.mockupRevenue')}  value="1.2M" suffix="FCFA" trend="+14%" tone="teal"    />
            <MiniKpi label={t('landing.hero.mockupTickets')}  value="348"                trend="+8%"  tone="emerald" />
            <MiniKpi label={t('landing.hero.mockupParcels')}  value="72"                 trend="+3%"  tone="sky"     />
            <MiniKpi label={t('landing.hero.mockupFillrate')} value="86"  suffix="%"     trend="+5%"  tone="amber"   />
          </div>
          <MockupChart />
          <MockupTable rows={3} />
        </div>
      </div>
    </div>
  );
}

// ─── Trust Bar ───────────────────────────────────────────────────────────────

function TrustBar() {
  const { t } = useI18n();
  const items = [
    { Icon: Smartphone, labelKey: 'landing.trust.momoLabel',       descKey: 'landing.trust.momoDesc'       },
    { Icon: Cloud,      labelKey: 'landing.trust.hostingLabel',    descKey: 'landing.trust.hostingDesc'    },
    { Icon: Shield,     labelKey: 'landing.trust.complianceLabel', descKey: 'landing.trust.complianceDesc' },
    { Icon: Activity,   labelKey: 'landing.trust.uptimeLabel',     descKey: 'landing.trust.uptimeDesc'     },
  ];
  return (
    <section className="border-y border-slate-200 bg-slate-50/60 py-10 dark:border-slate-800 dark:bg-slate-900/30" aria-labelledby="trust-title">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 id="trust-title" className="text-center text-sm font-medium text-slate-500 dark:text-slate-400">
          {t('landing.trust.title')}
        </h2>
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-6">
          {items.map(({ Icon, labelKey, descKey }) => (
            <li key={labelKey} className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                <Icon className="h-5 w-5 text-teal-600 dark:text-teal-400" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{t(labelKey)}</p>
                <p className="text-xs text-slate-600 dark:text-slate-400">{t(descKey)}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ─── Problème ────────────────────────────────────────────────────────────────

function ProblemSection() {
  const { t } = useI18n();
  const pains = [
    { Icon: FileSpreadsheet, titleKey: 'landing.problem.pain1.title', descKey: 'landing.problem.pain1.desc' },
    { Icon: Coins,           titleKey: 'landing.problem.pain2.title', descKey: 'landing.problem.pain2.desc' },
    { Icon: PackageSearch,   titleKey: 'landing.problem.pain3.title', descKey: 'landing.problem.pain3.desc' },
  ];
  return (
    <section className="py-20 lg:py-28" aria-labelledby="problem-title">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <SectionEyebrow>{t('landing.problem.eyebrow')}</SectionEyebrow>
          <h2 id="problem-title" className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
            {t('landing.problem.title')}
          </h2>
          <p className="mt-5 text-lg text-slate-600 dark:text-slate-300">
            {t('landing.problem.subtitle')}
          </p>
        </div>

        <ul className="mt-14 grid gap-6 md:grid-cols-3">
          {pains.map(({ Icon, titleKey, descKey }) => (
            <li
              key={titleKey}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="mt-4 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
                <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
                {t(titleKey)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                {t(descKey)}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ─── Modules ─────────────────────────────────────────────────────────────────

function ModulesSection() {
  const { t } = useI18n();
  const modules = [
    { Icon: Ticket,    key: 'm1'  }, { Icon: Package,  key: 'm2'  },
    { Icon: Route,     key: 'm3'  }, { Icon: Wallet,   key: 'm4'  },
    { Icon: Truck,     key: 'm5'  }, { Icon: Users,    key: 'm6'  },
    { Icon: Heart,     key: 'm7'  }, { Icon: LifeBuoy, key: 'm8'  },
    { Icon: LineChart, key: 'm9'  }, { Icon: Workflow, key: 'm10' },
  ];
  return (
    <section id="modules" className={cn('bg-slate-50 py-20 dark:bg-slate-900/40 lg:py-28', anchorOffset)} aria-labelledby="modules-title">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <SectionEyebrow>{t('landing.modules.eyebrow')}</SectionEyebrow>
          <h2 id="modules-title" className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
            {t('landing.modules.title')}
          </h2>
          <p className="mt-5 text-lg text-slate-600 dark:text-slate-300">
            {t('landing.modules.subtitle')}
          </p>
        </div>

        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {modules.map(({ Icon, key }) => (
            <li
              key={key}
              className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-700 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-700 transition-colors group-hover:bg-teal-100 dark:bg-teal-950/50 dark:text-teal-400 dark:group-hover:bg-teal-900/50">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-white">
                {t(`landing.modules.${key}.title`)}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                {t(`landing.modules.${key}.desc`)}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ─── Deep Dive (3 moments-clés alternés) ─────────────────────────────────────

function DeepDiveSection() {
  const { t } = useI18n();
  const rows = [
    { key: 'row1', bullets: ['b1', 'b2', 'b3'], mockup: <SellTicketMockup /> },
    { key: 'row2', bullets: ['b1', 'b2', 'b3'], mockup: <CrmMockup /> },
    { key: 'row3', bullets: ['b1', 'b2', 'b3'], mockup: <AnalyticsMockup /> },
  ];
  return (
    <section id="deepdive" className={cn('py-20 lg:py-28', anchorOffset)} aria-labelledby="dd-title">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <SectionEyebrow>{t('landing.dd.eyebrow')}</SectionEyebrow>
          <h2 id="dd-title" className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
            {t('landing.dd.title')}
          </h2>
          <p className="mt-5 text-lg text-slate-600 dark:text-slate-300">
            {t('landing.dd.subtitle')}
          </p>
        </div>

        <div className="mt-20 flex flex-col gap-20 lg:gap-28">
          {rows.map((row, idx) => (
            <div
              key={row.key}
              className={cn(
                'grid items-center gap-10 lg:grid-cols-2 lg:gap-16',
                idx % 2 === 1 && 'lg:[&>*:first-child]:order-2',
              )}
            >
              <div>
                <SectionEyebrow>{t(`landing.dd.${row.key}.eyebrow`)}</SectionEyebrow>
                <h3 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
                  {t(`landing.dd.${row.key}.title`)}
                </h3>
                <p className="mt-4 text-base leading-relaxed text-slate-600 dark:text-slate-300">
                  {t(`landing.dd.${row.key}.desc`)}
                </p>
                <ul className="mt-6 space-y-3">
                  {row.bullets.map(b => (
                    <li key={b} className="flex items-start gap-3">
                      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-400">
                        <Check className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        {t(`landing.dd.${row.key}.${b}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>{row.mockup}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Différenciateurs ────────────────────────────────────────────────────────

function DifferentiatorsSection() {
  const { t } = useI18n();
  const diffs = [
    { Icon: Smartphone, key: 'd1' },
    { Icon: Coins,      key: 'd2' },
    { Icon: Languages,  key: 'd3' },
    { Icon: WifiOff,    key: 'd4' },
    { Icon: Calculator, key: 'd5' },
    { Icon: Lock,       key: 'd6' },
  ];
  return (
    <section id="differentiators" className={cn('relative overflow-hidden bg-slate-50 py-20 dark:bg-slate-900/40 lg:py-28', anchorOffset)} aria-labelledby="diff-title">
      <div className="absolute inset-0 -z-10" aria-hidden>
        <div className="absolute left-1/2 top-1/2 h-[500px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal-400/10 blur-3xl dark:bg-teal-500/5" />
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <SectionEyebrow>{t('landing.diff.eyebrow')}</SectionEyebrow>
          <h2 id="diff-title" className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
            {t('landing.diff.title')}
          </h2>
          <p className="mt-5 text-lg text-slate-600 dark:text-slate-300">
            {t('landing.diff.subtitle')}
          </p>
        </div>

        <ul className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {diffs.map(({ Icon, key }) => (
            <li
              key={key}
              className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-teal-50/40 p-6 shadow-sm dark:border-slate-800 dark:from-slate-900 dark:to-teal-950/30"
            >
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-teal-600 text-white shadow-md shadow-teal-600/20">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="mt-5 text-lg font-semibold text-slate-900 dark:text-white">
                {t(`landing.diff.${key}.title`)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                {t(`landing.diff.${key}.desc`)}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ─── Africa Coverage ─────────────────────────────────────────────────────────

function AfricaSection() {
  const { t } = useI18n();
  const stats = ['stat1', 'stat2', 'stat3', 'stat4'] as const;
  return (
    <section className="py-20 lg:py-28" aria-labelledby="africa-title">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <SectionEyebrow>{t('landing.africa.eyebrow')}</SectionEyebrow>
            <h2 id="africa-title" className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
              {t('landing.africa.title')}
            </h2>
            <p className="mt-5 text-lg text-slate-600 dark:text-slate-300">
              {t('landing.africa.subtitle')}
            </p>

            <dl className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-6">
              {stats.map(s => (
                <div key={s} className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                  <dt className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {t(`landing.africa.${s}.label`)}
                  </dt>
                  <dd className="mt-2 text-3xl font-bold tracking-tight text-teal-600 dark:text-teal-400">
                    {t(`landing.africa.${s}.value`)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative">
            <AfricaMap />
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Mobile Companion ────────────────────────────────────────────────────────

function MobileSection() {
  const { t } = useI18n();
  const features = ['f1', 'f2', 'f3', 'f4', 'f5'] as const;
  const icons = [Smartphone, Package, Banknote, QrCode, Gift];
  return (
    <section className="relative overflow-hidden bg-slate-50 py-20 dark:bg-slate-900/40 lg:py-28" aria-labelledby="mobile-title">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="order-2 lg:order-1">
            <PhoneMockup />
          </div>
          <div className="order-1 lg:order-2">
            <SectionEyebrow>{t('landing.mobile.eyebrow')}</SectionEyebrow>
            <h2 id="mobile-title" className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
              {t('landing.mobile.title')}
            </h2>
            <p className="mt-5 text-lg text-slate-600 dark:text-slate-300">
              {t('landing.mobile.subtitle')}
            </p>
            <ul className="mt-8 space-y-4">
              {features.map((f, i) => {
                const Icon = icons[i];
                return (
                  <li key={f} className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-400">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="text-base font-medium text-slate-700 dark:text-slate-200">
                      {t(`landing.mobile.${f}`)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Pricing ─────────────────────────────────────────────────────────────────

function PricingTeaser() {
  const { t } = useI18n();
  const plans: Array<{ key: 'p1' | 'p2' | 'p3'; featured?: boolean }> = [
    { key: 'p1' }, { key: 'p2', featured: true }, { key: 'p3' },
  ];
  return (
    <section id="pricing" className={cn('py-20 lg:py-28', anchorOffset)} aria-labelledby="pricing-title">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <SectionEyebrow>{t('landing.pricing.eyebrow')}</SectionEyebrow>
          <h2 id="pricing-title" className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
            {t('landing.pricing.title')}
          </h2>
          <p className="mt-5 text-lg text-slate-600 dark:text-slate-300">
            {t('landing.pricing.subtitle')}
          </p>
        </div>

        <ul className="mt-14 grid gap-6 md:grid-cols-3">
          {plans.map(({ key, featured }) => (
            <li
              key={key}
              className={cn(
                'relative flex flex-col rounded-2xl border bg-white p-6 shadow-sm dark:bg-slate-900',
                featured
                  ? 'border-teal-500 ring-2 ring-teal-500 dark:border-teal-500'
                  : 'border-slate-200 dark:border-slate-800',
              )}
            >
              {featured && (
                <span className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-teal-600 px-3 py-1 text-xs font-semibold text-white shadow-md">
                  <Star className="h-3 w-3" aria-hidden />
                  {t('landing.pricing.p2.badge')}
                </span>
              )}
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                {t(`landing.pricing.${key}.name`)}
              </h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {t(`landing.pricing.${key}.desc`)}
              </p>
              <p className="mt-5 text-3xl font-bold text-slate-900 dark:text-white">
                {t(`landing.pricing.${key}.price`)}
                <span className="text-base font-normal text-slate-500 dark:text-slate-400">
                  {t(`landing.pricing.${key}.period`)}
                </span>
              </p>

              <Link
                to={`/signup?plan=${planSlugFromKey(key)}`}
                className={cn(
                  'mt-6 inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900',
                  featured
                    ? 'bg-teal-600 text-white hover:bg-teal-500'
                    : 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800',
                )}
              >
                {t(`landing.pricing.${key}.cta`)}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ─── FAQ ─────────────────────────────────────────────────────────────────────

function FAQSection() {
  const { t } = useI18n();
  const questions = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'] as const;
  return (
    <section id="faq" className={cn('bg-slate-50 py-20 dark:bg-slate-900/40 lg:py-28', anchorOffset)} aria-labelledby="faq-title">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <SectionEyebrow>{t('landing.faq.eyebrow')}</SectionEyebrow>
          <h2 id="faq-title" className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
            {t('landing.faq.title')}
          </h2>
        </div>

        <dl className="mt-12 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {questions.map(q => (
            <FAQItem key={q} qKey={`landing.faq.${q}.q`} aKey={`landing.faq.${q}.a`} />
          ))}
        </dl>
      </div>
    </section>
  );
}

function FAQItem({ qKey, aKey }: { qKey: string; aKey: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <dt>
        <button
          type="button"
          className="flex w-full items-start justify-between gap-6 px-5 py-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
          aria-expanded={open}
          onClick={() => setOpen(v => !v)}
        >
          <span className="text-base font-medium text-slate-900 dark:text-white">
            {t(qKey)}
          </span>
          <ChevronDown
            className={cn(
              'h-5 w-5 shrink-0 text-slate-500 transition-transform dark:text-slate-400 motion-reduce:transition-none',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
      </dt>
      {open && (
        <dd className="px-5 pb-5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          {t(aKey)}
        </dd>
      )}
    </div>
  );
}

// ─── Final CTA + Early access ────────────────────────────────────────────────

function FinalCTA() {
  const { t, lang } = useI18n();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'invalid' | 'error'>('idle');
  const [captcha, setCaptcha] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    if (!valid) { setStatus('invalid'); return; }

    setStatus('pending');
    try {
      await apiFetch('/api/public/waitlist', {
        method: 'POST',
        body:   { email: email.trim().toLowerCase(), locale: lang, source: 'landing_cta' },
        skipRedirectOn401: true,
        captchaToken: captcha,
      });
      setStatus('success');
      setEmail('');
    } catch (err) {
      // Rate-limit (429) ou 400 → message générique d'erreur, on garde l'email pour retry.
      if (err instanceof ApiError && err.status === 429) {
        setStatus('error');
      } else {
        setStatus('error');
      }
    }
  }

  return (
    <section
      id="cta"
      className={cn('relative overflow-hidden bg-slate-900 py-20 lg:py-28 dark:bg-slate-950', anchorOffset)}
      aria-labelledby="cta-title"
    >
      <div className="absolute inset-0 -z-10" aria-hidden>
        <div className="absolute left-1/2 top-1/2 h-[500px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal-500/20 blur-3xl" />
      </div>
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
        <span className="inline-flex items-center gap-2 rounded-full border border-teal-400/30 bg-teal-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-teal-300">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          {t('landing.earlyAccess.bonus')}
        </span>
        <h2 id="cta-title" className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          {t('landing.earlyAccess.title')}
        </h2>
        <p className="mt-5 text-lg text-slate-300">
          {t('landing.earlyAccess.subtitle')}
        </p>

        <form onSubmit={onSubmit} className="mx-auto mt-8 flex max-w-md flex-col gap-3 sm:flex-row" noValidate>
          <label htmlFor="early-email" className="sr-only">{t('landing.earlyAccess.placeholder')}</label>
          {/* Honeypot anti-bot — invisible visuellement + aria-hidden */}
          <input
            type="text"
            name="company_website"
            autoComplete="off"
            tabIndex={-1}
            aria-hidden
            className="absolute left-[-9999px] h-0 w-0 opacity-0"
          />
          <div className="relative flex-1">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              id="early-email"
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); if (status !== 'idle' && status !== 'pending') setStatus('idle'); }}
              placeholder={t('landing.earlyAccess.placeholder')}
              aria-invalid={status === 'invalid'}
              aria-describedby="early-email-status"
              disabled={status === 'pending' || status === 'success'}
              className="h-12 w-full rounded-lg border border-slate-600 bg-slate-800/80 pl-10 pr-4 text-sm text-white placeholder:text-slate-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-400/40 disabled:opacity-60"
              autoComplete="email"
              required
            />
          </div>
          <div className="mt-2">
            <CaptchaWidget onToken={setCaptcha} theme="dark" />
          </div>
          <button
            type="submit"
            disabled={status === 'pending' || status === 'success'}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-teal-500 px-6 text-sm font-semibold text-white shadow-lg shadow-teal-500/30 transition-colors hover:bg-teal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {status === 'pending' ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
            ) : (
              <Send className="h-4 w-4" aria-hidden />
            )}
            {t('landing.earlyAccess.submit')}
          </button>
        </form>

        <p id="early-email-status" className="mt-3 min-h-[1.25rem] text-sm" role="status" aria-live="polite">
          {status === 'success' && (
            <span className="inline-flex items-center gap-1.5 text-teal-300">
              <Check className="h-4 w-4" aria-hidden />
              {t('landing.earlyAccess.success')}
            </span>
          )}
          {status === 'invalid' && (
            <span className="inline-flex items-center gap-1.5 text-amber-300">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              {t('landing.earlyAccess.invalid')}
            </span>
          )}
          {status === 'error' && (
            <span className="inline-flex items-center gap-1.5 text-amber-300">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              {t('landing.earlyAccess.error')}
            </span>
          )}
        </p>
      </div>
    </section>
  );
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║                           MOCKUPS (SVG / Tailwind)                         ║
// ╚════════════════════════════════════════════════════════════════════════════╝

function BrowserChrome({ url }: { url: string }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/60">
      <span className="h-2.5 w-2.5 rounded-full bg-red-400" aria-hidden />
      <span className="h-2.5 w-2.5 rounded-full bg-amber-400" aria-hidden />
      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" aria-hidden />
      <div className="ml-4 flex-1 truncate rounded-md bg-white px-2 py-1 text-xs text-slate-400 shadow-inner dark:bg-slate-900 dark:text-slate-500">
        {url}
      </div>
    </div>
  );
}

function FakeSidebar() {
  return (
    <div className="col-span-3 border-r border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
      <div className="flex items-center gap-2 pb-3">
        <div className="h-6 w-6 rounded-md bg-gradient-to-br from-teal-500 to-teal-700" aria-hidden />
        <div className="h-2 w-16 rounded bg-slate-300 dark:bg-slate-700" aria-hidden />
      </div>
      <div className="space-y-1.5" aria-hidden>
        {[true, false, false, false, false, false].map((active, i) => (
          <div
            key={i}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5',
              active && 'bg-teal-100 dark:bg-teal-900/40',
            )}
          >
            <div className={cn('h-3 w-3 rounded', active ? 'bg-teal-500' : 'bg-slate-300 dark:bg-slate-700')} />
            <div className={cn('h-2 flex-1 rounded', active ? 'bg-teal-400/60 dark:bg-teal-600/60' : 'bg-slate-200 dark:bg-slate-800')} />
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniKpi({
  label, value, suffix, trend, tone,
}: { label: string; value: string; suffix?: string; trend: string; tone: 'teal' | 'emerald' | 'sky' | 'amber' }) {
  const toneMap: Record<typeof tone, string> = {
    teal:    'text-teal-700 dark:text-teal-400',
    emerald: 'text-emerald-700 dark:text-emerald-400',
    sky:     'text-sky-700 dark:text-sky-400',
    amber:   'text-amber-700 dark:text-amber-400',
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-950/40">
      <p className="truncate text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-slate-900 dark:text-white">
        {value}
        {suffix && <span className="ml-0.5 text-xs font-normal text-slate-500 dark:text-slate-400">{suffix}</span>}
      </p>
      <p className={cn('text-[10px] font-medium', toneMap[tone])}>{trend}</p>
    </div>
  );
}

function MockupChart() {
  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/40">
      <div className="mb-2 flex items-center justify-between" aria-hidden>
        <div className="h-2 w-24 rounded bg-slate-300 dark:bg-slate-700" />
        <div className="h-2 w-12 rounded bg-slate-200 dark:bg-slate-800" />
      </div>
      <svg viewBox="0 0 400 110" className="h-24 w-full" aria-hidden>
        <defs>
          <linearGradient id="mockArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="currentColor" stopOpacity="0.35" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="text-teal-500 dark:text-teal-400">
          <path
            d="M0,85 L40,72 L80,78 L120,58 L160,62 L200,42 L240,48 L280,30 L320,35 L360,22 L400,28 L400,110 L0,110 Z"
            fill="url(#mockArea)"
          />
          <path
            d="M0,85 L40,72 L80,78 L120,58 L160,62 L200,42 L240,48 L280,30 L320,35 L360,22 L400,28"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>
      </svg>
    </div>
  );
}

function MockupTable({ rows }: { rows: number }) {
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/40">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'flex items-center justify-between px-3 py-2.5',
            i !== rows - 1 && 'border-b border-slate-100 dark:border-slate-800',
          )}
          aria-hidden
        >
          <div className="flex items-center gap-3">
            <div className="h-7 w-7 rounded-full bg-slate-200 dark:bg-slate-800" />
            <div className="space-y-1.5">
              <div className="h-2 w-28 rounded bg-slate-300 dark:bg-slate-700" />
              <div className="h-1.5 w-20 rounded bg-slate-200 dark:bg-slate-800" />
            </div>
          </div>
          <div className="h-5 w-14 rounded-full bg-emerald-100 dark:bg-emerald-900/40" />
        </div>
      ))}
    </div>
  );
}

function SellTicketMockup() {
  const { t } = useI18n();
  return (
    <div
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 dark:border-slate-800 dark:bg-slate-900"
      role="img"
      aria-label={t('landing.dd.row1.eyebrow')}
    >
      <BrowserChrome url={`acme.${PLATFORM_BASE_DOMAIN}/admin/sell`} />
      <div className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Nouveau billet</p>
            <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">Brazzaville → Pointe-Noire</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
            <WifiOff className="h-3 w-3" aria-hidden />
            Offline
          </span>
        </div>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <MockField label="Date" value="Demain · 07:30" />
          <MockField label="Siège" value="12A" />
          <MockField label="Passager" value="M. Nganga" />
          <MockField label="Téléphone" value="+242 06 ••• •567" />
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600 dark:text-slate-400">Tarif + bagage</span>
            <span className="text-sm font-medium text-slate-900 dark:text-white">17 500 FCFA</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-sm text-slate-600 dark:text-slate-400">Promo FIDELE-10</span>
            <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">- 1 750</span>
          </div>
          <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-900 dark:text-white">Total</span>
              <span className="text-lg font-bold text-slate-900 dark:text-white">15 750 FCFA</span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <PayBadge label="MTN MoMo" />
          <PayBadge label="Airtel" />
          <PayBadge label="Wave" />
          <PayBadge label="Espèces" />
        </div>

        <button
          type="button"
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 py-2.5 text-sm font-semibold text-white"
          tabIndex={-1}
          aria-hidden
        >
          <QrCode className="h-4 w-4" />
          Confirmer & imprimer
        </button>
      </div>
    </div>
  );
}

function CrmMockup() {
  const { t } = useI18n();
  return (
    <div
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 dark:border-slate-800 dark:bg-slate-900"
      role="img"
      aria-label={t('landing.dd.row2.eyebrow')}
    >
      <BrowserChrome url={`acme.${PLATFORM_BASE_DOMAIN}/admin/crm`} />
      <div className="p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-teal-600 text-lg font-semibold text-white" aria-hidden>
            MN
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="text-base font-semibold text-slate-900 dark:text-white">Moussa Ndiaye</h4>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                <Star className="h-3 w-3" aria-hidden />
                VIP
              </span>
            </div>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">+221 77 ••• •234 · moussa@***.sn</p>
            <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Client depuis mars 2023 · Dakar</p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
          <MiniStat label="Tickets" value="42" />
          <MiniStat label="Colis" value="9" />
          <MiniStat label="Total dépensé" value="685k" suffix="FCFA" />
        </div>

        <div className="mt-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Préférences détectées</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <TagChip>Siège 12A</TagChip>
            <TagChip>Matin</TagChip>
            <TagChip>Dakar → Thiès</TagChip>
            <TagChip>Fare Premium</TagChip>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
          <p className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
            <BellRing className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" aria-hidden />
            Suggestion agent
          </p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Proposer le siège 12A sur le trajet de demain. Probabilité d'achat 84 %.
          </p>
        </div>
      </div>
    </div>
  );
}

function AnalyticsMockup() {
  const { t } = useI18n();
  return (
    <div
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 dark:border-slate-800 dark:bg-slate-900"
      role="img"
      aria-label={t('landing.dd.row3.eyebrow')}
    >
      <BrowserChrome url={`acme.${PLATFORM_BASE_DOMAIN}/admin/analytics`} />
      <div className="p-5">
        <div className="flex items-center justify-between">
          <h4 className="text-base font-semibold text-slate-900 dark:text-white">Yield, 7 derniers jours</h4>
          <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">
            <Sparkles className="h-3 w-3" aria-hidden />
            AI
          </span>
        </div>

        <svg viewBox="0 0 400 140" className="mt-3 h-32 w-full" aria-hidden>
          <defs>
            <linearGradient id="areaA" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="currentColor" stopOpacity="0.35" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* grid */}
          <g stroke="currentColor" strokeOpacity="0.08" className="text-slate-500">
            <line x1="0" y1="40"  x2="400" y2="40"  />
            <line x1="0" y1="80"  x2="400" y2="80"  />
            <line x1="0" y1="120" x2="400" y2="120" />
          </g>
          {/* baseline (demand) */}
          <g className="text-slate-400">
            <path
              d="M0,90 L57,82 L114,84 L171,70 L228,74 L285,62 L342,60 L400,52"
              fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" strokeLinecap="round"
            />
          </g>
          {/* revenue */}
          <g className="text-teal-500 dark:text-teal-400">
            <path
              d="M0,78 L57,66 L114,70 L171,48 L228,54 L285,32 L342,28 L400,18 L400,140 L0,140 Z"
              fill="url(#areaA)"
            />
            <path
              d="M0,78 L57,66 L114,70 L171,48 L228,54 L285,32 L342,28 L400,18"
              fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
            />
          </g>
        </svg>

        <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
          <MiniStat label="Revenu" value="+22%" tone="teal" />
          <MiniStat label="Taux rempl." value="86%" tone="emerald" />
          <MiniStat label="Prév. J+7" value="+12%" tone="sky" />
        </div>

        <div className="mt-4 space-y-2">
          <RecoRow label="Brazzaville → Dolisie (dim.)"  action="Augmenter +5 %" tone="up"   />
          <RecoRow label="Pointe-Noire → Owando (sam.)" action="Baisser −8 %"   tone="down" />
          <RecoRow label="Dakar → Thiès (lun. 07:30)"    action="Ouvrir surclassement" tone="flat" />
        </div>
      </div>
    </div>
  );
}

function PhoneMockup() {
  const { t } = useI18n();
  return (
    <div className="mx-auto w-[280px]">
      <div className="relative rounded-[2.5rem] border-[8px] border-slate-900 bg-white shadow-2xl shadow-slate-900/30 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/60">
        <div className="absolute left-1/2 top-0 h-5 w-28 -translate-x-1/2 rounded-b-2xl bg-slate-900 dark:bg-slate-800" aria-hidden />
        <div className="px-4 pb-5 pt-8">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <MapPin className="h-3 w-3 text-teal-500" aria-hidden />
              Dakar
            </span>
            <UserCircle2 className="h-5 w-5 text-slate-400" aria-hidden />
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/50">
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t('landing.mobile.screenDay')}
            </p>
            <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">
              {t('landing.mobile.screenTitle')}
            </p>
            <p className="mt-1 text-[11px] text-teal-600 dark:text-teal-400">
              {t('landing.mobile.screenPrice')}
            </p>
          </div>

          <div className="mt-3 space-y-2">
            {[
              { h: '07:30 → 13:00', p: '28 000', b: 'Direct' },
              { h: '09:15 → 15:40', p: '24 000', b: '1 arrêt' },
              { h: '13:00 → 18:30', p: '28 000', b: 'Direct' },
            ].map((r, i) => (
              <div
                key={i}
                className={cn(
                  'flex items-center justify-between rounded-lg border p-2 text-[11px]',
                  i === 0
                    ? 'border-teal-300 bg-teal-50 dark:border-teal-700 dark:bg-teal-950/40'
                    : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
                )}
                aria-hidden
              >
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">{r.h}</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">{r.b}</p>
                </div>
                <p className="text-[11px] font-semibold text-slate-900 dark:text-white">{r.p}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-teal-600 py-2 text-[11px] font-semibold text-white" aria-hidden>
            <QrCode className="h-3.5 w-3.5" />
            Réserver · Mobile Money
          </div>
        </div>
      </div>
    </div>
  );
}

function AfricaMap() {
  // Silhouette stylisée — pas une carte géographique exacte.
  // Points : principales villes couvertes (Dakar, Abidjan, Lagos, Douala, Brazzaville, Kinshasa, Casablanca).
  return (
    <div className="relative mx-auto aspect-square max-w-md">
      <svg viewBox="0 0 400 400" className="h-full w-full" aria-hidden>
        <defs>
          <radialGradient id="afGrad" cx="50%" cy="50%" r="60%">
            <stop offset="0%"   stopColor="currentColor" stopOpacity="0.25" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.05" />
          </radialGradient>
        </defs>

        <g className="text-teal-500 dark:text-teal-400">
          {/* Silhouette Afrique stylisée (approximative) */}
          <path
            d="M170 40 L215 35 L255 55 L280 85 L300 120 L310 155 L330 180 L340 220 L325 255 L315 290 L295 320 L265 345 L230 365 L200 375 L170 370 L150 345 L135 320 L120 290 L110 255 L105 220 L100 185 L105 150 L120 115 L140 80 Z"
            fill="url(#afGrad)"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeOpacity="0.4"
            strokeLinejoin="round"
          />
          {/* Madagascar */}
          <path
            d="M355 275 L365 290 L362 315 L352 330 L348 315 Z"
            fill="url(#afGrad)"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeOpacity="0.35"
          />
        </g>

        {/* Cités couvertes (repères) */}
        {[
          { cx: 155, cy: 75,  label: 'Casablanca' },
          { cx: 125, cy: 170, label: 'Dakar'      },
          { cx: 155, cy: 200, label: 'Abidjan'    },
          { cx: 210, cy: 190, label: 'Lagos'      },
          { cx: 240, cy: 205, label: 'Douala'     },
          { cx: 245, cy: 235, label: 'Brazzaville'},
          { cx: 258, cy: 245, label: 'Kinshasa'   },
          { cx: 170, cy: 220, label: 'Lomé'       },
          { cx: 190, cy: 215, label: 'Cotonou'    },
        ].map((c, i) => (
          <g key={i}>
            <circle cx={c.cx} cy={c.cy} r="8" className="fill-teal-500/20 animate-pulse motion-reduce:animate-none" />
            <circle cx={c.cx} cy={c.cy} r="3.5" className="fill-teal-500" />
          </g>
        ))}
      </svg>

      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full border border-teal-200 bg-white/90 px-4 py-1.5 text-xs font-medium text-teal-700 shadow-sm backdrop-blur dark:border-teal-800 dark:bg-slate-900/80 dark:text-teal-400">
        9 villes stratégiques · 11 pays live
      </div>
    </div>
  );
}

// ─── Petits blocs réutilisés ─────────────────────────────────────────────────

function MockField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-800 dark:bg-slate-950/40">
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}

function MiniStat({ label, value, suffix, tone }: { label: string; value: string; suffix?: string; tone?: 'teal' | 'emerald' | 'sky' }) {
  const toneCls =
    tone === 'teal'    ? 'text-teal-600 dark:text-teal-400'    :
    tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' :
    tone === 'sky'     ? 'text-sky-600 dark:text-sky-400'      :
    'text-slate-900 dark:text-white';
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-950/40">
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
      <p className={cn('mt-0.5 text-base font-semibold', toneCls)}>
        {value}
        {suffix && <span className="ml-0.5 text-[10px] font-normal text-slate-500 dark:text-slate-400">{suffix}</span>}
      </p>
    </div>
  );
}

function TagChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
      {children}
    </span>
  );
}

function PayBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
      <Smartphone className="h-3 w-3 text-teal-600 dark:text-teal-400" aria-hidden />
      {label}
    </span>
  );
}

function RecoRow({ label, action, tone }: { label: string; action: string; tone: 'up' | 'down' | 'flat' }) {
  const toneCls =
    tone === 'up'   ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/40' :
    tone === 'down' ? 'text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40'         :
    'text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800';
  return (
    <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-800 dark:bg-slate-950/40">
      <span className="truncate text-xs text-slate-700 dark:text-slate-300">{label}</span>
      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold', toneCls)}>
        {action}
      </span>
    </div>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

/**
 * Mapping des clés locales du teaser ("p1"|"p2"|"p3") vers les slugs de plans
 * backend (catalogue DB-driven). Les slugs doivent exister dans la table Plan ;
 * si un plan n'est pas trouvé côté /api/public/plans, le wizard fallback
 * sur le premier plan public actif, donc un mauvais mapping reste fonctionnel.
 */
function planSlugFromKey(key: 'p1' | 'p2' | 'p3'): string {
  const map: Record<typeof key, string> = {
    p1: 'starter',
    p2: 'growth',
    p3: 'enterprise',
  };
  return map[key];
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50/50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-teal-700 dark:border-teal-900 dark:bg-teal-950/50 dark:text-teal-400">
      {children}
    </p>
  );
}
