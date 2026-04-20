/**
 * PagePlatformDashboard — Tableau de bord SaaS du tenant plateforme.
 *
 * Destiné aux 3 rôles système (SUPER_ADMIN, SUPPORT_L1, SUPPORT_L2). Les
 * sections se composent selon les permissions résolues backend :
 *   - Growth   : nb tenants, MRR, funnel d'onboarding, churn, top 10 tenants
 *   - Adoption : DAU / WAU / MAU + adoption par module + trend 30 j
 *   - Health   : tenants à risque (score <60), DLQ, incidents, impersonation
 *   - Support  : queue tickets (top priorité) + raccourci vers la page dédiée
 *
 * Données alimentées par :
 *   GET /api/platform/analytics/growth
 *   GET /api/platform/analytics/adoption
 *   GET /api/platform/analytics/health
 *   GET /api/platform/support/tickets?status=OPEN (limité aux 5 plus urgents)
 *
 * Ces endpoints retournent 403 pour tout acteur sans permission
 * data.platform.metrics.read.global. Les cartes dépendantes sont masquées
 * avec un message explicite (pas de cache silencieux).
 *
 * WCAG AA : sections étiquetées (aria-labelledby), focus visible, responsive
 * mobile → desktop (grid 1/2/4 cols), dark + light, ARIA sur progressbars.
 */

import { useMemo } from 'react';
import {
  ShieldCheck, Building2, UserCog, UserCheck, Bug, RefreshCw,
  Activity, Users, TrendingUp, AlertCircle, LifeBuoy, Wallet,
  BarChart3, HeartPulse,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth }  from '../../lib/auth/auth.context';
import { useFetch } from '../../lib/hooks/useFetch';
import { useI18n }  from '../../lib/i18n/useI18n';
import { Badge }    from '../ui/Badge';
// Sections KPI SaaS (sprint KPI 2026-04-20) — montage conditionnel par permission
import { SectionNorthStar }       from '../platform/SectionNorthStar';
import { SectionMrrBreakdown }    from '../platform/SectionMrrBreakdown';
import { SectionRetention }       from '../platform/SectionRetention';
import { SectionTransactional }   from '../platform/SectionTransactional';
import { SectionAdoptionDetailed } from '../platform/SectionAdoptionDetailed';
import { SectionActivation }      from '../platform/SectionActivation';
import { SectionStrategic }       from '../platform/SectionStrategic';

// ─── Permissions ─────────────────────────────────────────────────────────────
const P_METRICS         = 'data.platform.metrics.read.global';
const P_SUPPORT_READ    = 'control.platform.support.read.global';
const P_TENANT_MANAGE   = 'control.tenant.manage.global';
const P_PLATFORM_STAFF  = 'control.platform.staff.global';
const P_IMPERSONATION   = 'control.impersonation.switch.global';
const P_PLANS_MANAGE    = 'control.platform.plans.manage.global';
const P_BILLING_MANAGE  = 'control.platform.billing.manage.global';
// Fine-grained KPI permissions (Sprint KPI 2026-04-20)
const P_KPI_BUSINESS    = 'data.platform.kpi.business.read.global';
const P_KPI_ADOPTION    = 'data.platform.kpi.adoption.read.global';
const P_KPI_RETENTION   = 'data.platform.kpi.retention.read.global';

// ─── Types (alignés sur PlatformAnalyticsService) ────────────────────────────

interface GrowthPayload {
  totalTenants:        number;
  byProvisionStatus:   Record<string, number>;
  newThisMonth:        number;
  cancelled30d:        number;
  churnRate30d:        number;
  mrr:                 Record<string, number>; // { EUR: 1234.5, XAF: 99000 }
  topTenants: Array<{
    id: string; name: string; slug: string; country: string;
    provisionStatus: string; planId: string | null;
    _count: { users: number };
  }>;
}

interface AdoptionPayload {
  dau:              number;
  wau:              number;
  mau:              number;
  totalActiveUsers: number;
  moduleAdoption: Array<{ moduleKey: string; tenants: number; pct: number }>;
  trend30d:         Array<{ date: string; count: number }>;
}

interface HealthPayload {
  avgHealthScore:       number | null;
  atRiskTenants: Array<{
    tenantId: string; score: number; date: string; components: Record<string, unknown>;
  }>;
  dlqOpen:              number;
  supportTicketsOpen:   number;
  incidentsOpen:        number;
  impersonationsActive: number;
  lastComputedAt:       string;
}

interface SupportTicketRow {
  id:         string;
  tenantId:   string;
  title:      string;
  priority:   string;
  status:     string;
  createdAt:  string;
  slaDueAt:   string | null;
  tenant?:    { id: string; name: string; slug: string };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function useHasPerm(perm: string): boolean {
  const { user } = useAuth();
  return (user?.permissions ?? []).includes(perm);
}

function priorityVariant(p: string): 'danger' | 'warning' | 'info' | 'default' {
  switch (p) {
    case 'CRITICAL': return 'danger';
    case 'HIGH':     return 'warning';
    case 'NORMAL':   return 'info';
    default:         return 'default';
  }
}

function formatMrr(mrr: Record<string, number>): string {
  const entries = Object.entries(mrr ?? {});
  if (entries.length === 0) return '—';
  return entries.map(([ccy, amount]) =>
    `${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${ccy}`,
  ).join(' · ');
}

// ─── KPI card ────────────────────────────────────────────────────────────────

interface KpiProps {
  label: string;
  value: string | number;
  hint?: string;
  icon:  React.ReactNode;
  tone:  'teal' | 'amber' | 'blue' | 'slate' | 'red' | 'emerald';
  loading?: boolean;
}

const TONE: Record<KpiProps['tone'], string> = {
  teal:    'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  amber:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  blue:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  slate:   'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  red:     'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
};

function Kpi({ label, value, hint, icon, tone, loading }: KpiProps) {
  return (
    <div className="t-card-bordered rounded-2xl p-5 flex items-start gap-4" aria-busy={loading || undefined}>
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl shrink-0 ${TONE[tone]}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide t-text-2">{label}</p>
        <p className="mt-1 text-2xl font-bold t-text tabular-nums">
          {loading ? <span className="inline-block h-6 w-20 rounded animate-pulse bg-slate-200 dark:bg-slate-700" /> : value}
        </p>
        {hint && <p className="mt-0.5 text-xs t-text-3 truncate">{hint}</p>}
      </div>
    </div>
  );
}

// ─── Quick action ────────────────────────────────────────────────────────────

function Action({ to, icon, title, desc }: { to: string; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Link
      to={to}
      className="t-card-bordered rounded-2xl p-4 flex items-start gap-3 group
                 hover:border-teal-400 dark:hover:border-teal-600 transition-colors
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0 group-hover:bg-teal-50 dark:group-hover:bg-teal-900/30 group-hover:text-teal-700 dark:group-hover:text-teal-300 transition-colors">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold t-text">{title}</p>
        <p className="mt-0.5 text-xs t-text-2 line-clamp-2">{desc}</p>
      </div>
    </Link>
  );
}

// ─── Module adoption bar ─────────────────────────────────────────────────────

function ModuleBar({ moduleKey, pct, tenants }: { moduleKey: string; pct: number; tenants: number }) {
  const pctRound = Math.round(pct * 100);
  const pctBar = Math.max(0, Math.min(100, pctRound));
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between text-xs mb-1 gap-2">
        <span className="t-text-body font-medium font-mono truncate">{moduleKey}</span>
        <span className="t-text-2 tabular-nums shrink-0">{tenants} · {pctRound}%</span>
      </div>
      <div
        className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden"
        role="progressbar"
        aria-label={moduleKey}
        aria-valuenow={pctBar}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="bg-teal-500 h-1.5 rounded-full" style={{ width: `${pctBar}%` }} />
      </div>
    </div>
  );
}

// ─── Sparkline SVG minimale pour trend30d ────────────────────────────────────

function Sparkline({ data, ariaLabel }: { data: Array<{ date: string; count: number }>; ariaLabel: string }) {
  if (data.length === 0) return <span className="text-xs t-text-3">—</span>;
  const max = Math.max(1, ...data.map(d => d.count));
  const w = 180;
  const h = 40;
  const step = data.length > 1 ? w / (data.length - 1) : 0;
  const points = data
    .map((d, i) => `${i * step},${h - (d.count / max) * h}`)
    .join(' ');
  return (
    <svg
      role="img" aria-label={ariaLabel}
      viewBox={`0 0 ${w} ${h}`}
      className="w-full h-10"
      preserveAspectRatio="none"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        points={points}
        className="text-teal-500"
      />
    </svg>
  );
}

// ─── Composant principal ─────────────────────────────────────────────────────

export function PagePlatformDashboard() {
  const { user } = useAuth();
  const { t, dateLocale } = useI18n();

  const canMetrics       = useHasPerm(P_METRICS);
  const canSupport       = useHasPerm(P_SUPPORT_READ);
  const canManageTenants = useHasPerm(P_TENANT_MANAGE);
  const canManageStaff   = useHasPerm(P_PLATFORM_STAFF);
  const canImpersonate   = useHasPerm(P_IMPERSONATION);
  const canManagePlans   = useHasPerm(P_PLANS_MANAGE);
  const canManageBilling = useHasPerm(P_BILLING_MANAGE);
  // Fine-grained KPI permissions — montage conditionnel des sections SaaS
  const canKpiBusiness   = useHasPerm(P_KPI_BUSINESS);
  const canKpiAdoption   = useHasPerm(P_KPI_ADOPTION);
  const canKpiRetention  = useHasPerm(P_KPI_RETENTION);

  const { data: growth,   loading: lGrowth  } = useFetch<GrowthPayload>(canMetrics ? '/api/platform/analytics/growth'   : null);
  const { data: adoption, loading: lAdoption } = useFetch<AdoptionPayload>(canMetrics ? '/api/platform/analytics/adoption' : null);
  const { data: health,   loading: lHealth  } = useFetch<HealthPayload>(canMetrics ? '/api/platform/analytics/health'   : null);
  const { data: queue,    loading: lQueue   } = useFetch<SupportTicketRow[]>(canSupport ? '/api/platform/support/tickets?status=OPEN' : null);

  const topModules = useMemo(
    () => (adoption?.moduleAdoption ?? []).slice(0, 6),
    [adoption],
  );

  const topQueue = useMemo(() => (queue ?? []).slice(0, 5), [queue]);

  const roleLabel = user?.roleName ?? '—';

  return (
    <div className="p-4 sm:p-6 space-y-8" aria-label={t('platformDash.title')}>
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-100 dark:bg-teal-900/30">
            <ShieldCheck className="w-5 h-5 text-teal-700 dark:text-teal-300" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold t-text">{t('platformDash.title')}</h1>
            <p className="text-sm t-text-2 mt-0.5">
              {t('platformDash.subtitle')} — {new Date().toLocaleDateString(dateLocale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs t-text-2">{t('platformDash.loggedAs')}</span>
          <Badge variant="info" size="sm">{roleLabel}</Badge>
        </div>
      </header>

      {/* ─── GROWTH ──────────────────────────────────────────────────────── */}
      {canMetrics && (
        <section aria-labelledby="pd-growth">
          <header className="mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
            <h2 id="pd-growth" className="text-sm font-semibold uppercase tracking-wider t-text-2">
              {t('platformDash.sectionGrowth')}
            </h2>
          </header>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi
              label={t('platformDash.tenantsTotal')}
              value={growth?.totalTenants ?? 0}
              hint={t('platformDash.tenantsTotalHint')}
              icon={<Building2 className="w-5 h-5" aria-hidden />}
              tone="teal"
              loading={lGrowth}
            />
            <Kpi
              label={t('platformDash.newThisMonth')}
              value={growth?.newThisMonth ?? 0}
              hint={t('platformDash.newThisMonthHint')}
              icon={<TrendingUp className="w-5 h-5" aria-hidden />}
              tone="emerald"
              loading={lGrowth}
            />
            <Kpi
              label={t('platformDash.mrr')}
              value={growth ? formatMrr(growth.mrr) : '—'}
              hint={t('platformDash.mrrHint')}
              icon={<Wallet className="w-5 h-5" aria-hidden />}
              tone="blue"
              loading={lGrowth}
            />
            <Kpi
              label={t('platformDash.churn30d')}
              value={growth ? `${(growth.churnRate30d * 100).toFixed(1)}%` : '—'}
              hint={t('platformDash.churn30dHint').replace('{n}', String(growth?.cancelled30d ?? 0))}
              icon={<AlertCircle className="w-5 h-5" aria-hidden />}
              tone="amber"
              loading={lGrowth}
            />
          </div>

          {/* Funnel provisioning + top tenants */}
          {growth && (
            <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="t-card-bordered rounded-2xl p-5 space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider t-text-2">{t('platformDash.funnel')}</h3>
                {['PENDING', 'PROVISIONING', 'ACTIVE', 'SUSPENDED'].map(status => {
                  const n = growth.byProvisionStatus?.[status] ?? 0;
                  const max = Math.max(1, ...Object.values(growth.byProvisionStatus ?? { x: 1 }));
                  const pct = (n / max) * 100;
                  return (
                    <div key={status}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="t-text-body font-medium font-mono">{status}</span>
                        <span className="t-text-2 tabular-nums">{n}</span>
                      </div>
                      <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5"
                        role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={status}>
                        <div className="bg-teal-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="lg:col-span-2 t-card-bordered rounded-2xl p-5">
                <h3 className="text-xs font-semibold uppercase tracking-wider t-text-2 mb-3">{t('platformDash.topTenants')}</h3>
                <ul role="list" className="divide-y divide-slate-100 dark:divide-slate-800">
                  {growth.topTenants.slice(0, 10).map(tnt => (
                    <li key={tnt.id} className="flex items-center justify-between py-2 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <Building2 className="w-3.5 h-3.5 shrink-0 t-text-3" aria-hidden />
                        <span className="font-medium t-text truncate">{tnt.name}</span>
                        <span className="text-xs t-text-3 font-mono">{tnt.slug}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 text-xs">
                        <span className="t-text-2 tabular-nums">{tnt._count.users} {t('platformDash.users')}</span>
                        <Badge variant={tnt.provisionStatus === 'ACTIVE' ? 'success' : 'warning'} size="sm">{tnt.provisionStatus}</Badge>
                      </div>
                    </li>
                  ))}
                  {growth.topTenants.length === 0 && (
                    <li className="text-xs t-text-3 py-2">{t('platformDash.noData')}</li>
                  )}
                </ul>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ─── ADOPTION ───────────────────────────────────────────────────── */}
      {canMetrics && (
        <section aria-labelledby="pd-adoption">
          <header className="mb-3 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
            <h2 id="pd-adoption" className="text-sm font-semibold uppercase tracking-wider t-text-2">
              {t('platformDash.sectionAdoption')}
            </h2>
          </header>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi
              label={t('platformDash.dau')}
              value={adoption?.dau ?? 0}
              hint={t('platformDash.dauHint')}
              icon={<Activity className="w-5 h-5" aria-hidden />}
              tone="teal"
              loading={lAdoption}
            />
            <Kpi
              label={t('platformDash.wau')}
              value={adoption?.wau ?? 0}
              hint={t('platformDash.wauHint')}
              icon={<Users className="w-5 h-5" aria-hidden />}
              tone="blue"
              loading={lAdoption}
            />
            <Kpi
              label={t('platformDash.mau')}
              value={adoption?.mau ?? 0}
              hint={t('platformDash.mauHint').replace('{n}', String(adoption?.totalActiveUsers ?? 0))}
              icon={<TrendingUp className="w-5 h-5" aria-hidden />}
              tone="emerald"
              loading={lAdoption}
            />
            <Kpi
              label={t('platformDash.engagement')}
              value={adoption?.totalActiveUsers
                ? `${Math.round((adoption.mau / adoption.totalActiveUsers) * 100)}%`
                : '—'}
              hint={t('platformDash.engagementHint')}
              icon={<HeartPulse className="w-5 h-5" aria-hidden />}
              tone="amber"
              loading={lAdoption}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 t-card-bordered rounded-2xl p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider t-text-2 mb-3">{t('platformDash.moduleAdoption')}</h3>
              <div className="space-y-3">
                {topModules.length > 0
                  ? topModules.map(m => <ModuleBar key={m.moduleKey} {...m} />)
                  : <p className="text-xs t-text-3">{t('platformDash.noData')}</p>}
              </div>
            </div>
            <div className="t-card-bordered rounded-2xl p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider t-text-2 mb-3">{t('platformDash.dauTrend')}</h3>
              <Sparkline data={adoption?.trend30d ?? []} ariaLabel={t('platformDash.dauTrend')} />
              <p className="text-[11px] t-text-3 mt-2">{t('platformDash.dauTrendHint')}</p>
            </div>
          </div>
        </section>
      )}

      {/* ─── HEALTH ─────────────────────────────────────────────────────── */}
      {canMetrics && (
        <section aria-labelledby="pd-health">
          <header className="mb-3 flex items-center gap-2">
            <HeartPulse className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
            <h2 id="pd-health" className="text-sm font-semibold uppercase tracking-wider t-text-2">
              {t('platformDash.sectionHealth')}
            </h2>
          </header>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi
              label={t('platformDash.avgScore')}
              value={health?.avgHealthScore ?? '—'}
              hint={t('platformDash.avgScoreHint')}
              icon={<HeartPulse className="w-5 h-5" aria-hidden />}
              tone={(health?.avgHealthScore ?? 100) < 60 ? 'red' : 'emerald'}
              loading={lHealth}
            />
            <Kpi
              label={t('platformDash.dlqOpen')}
              value={health?.dlqOpen ?? 0}
              hint={t('platformDash.dlqHint')}
              icon={<RefreshCw className="w-5 h-5" aria-hidden />}
              tone={(health?.dlqOpen ?? 0) > 0 ? 'amber' : 'slate'}
              loading={lHealth}
            />
            <Kpi
              label={t('platformDash.incidentsOpen')}
              value={health?.incidentsOpen ?? 0}
              hint={t('platformDash.incidentsHint')}
              icon={<AlertCircle className="w-5 h-5" aria-hidden />}
              tone={(health?.incidentsOpen ?? 0) > 0 ? 'red' : 'slate'}
              loading={lHealth}
            />
            <Kpi
              label={t('platformDash.impersonationsActive')}
              value={health?.impersonationsActive ?? 0}
              hint={t('platformDash.impersonationsHint')}
              icon={<UserCheck className="w-5 h-5" aria-hidden />}
              tone="blue"
              loading={lHealth}
            />
          </div>

          {health && health.atRiskTenants.length > 0 && (
            <div className="mt-4 t-card-bordered rounded-2xl p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider t-text-2 mb-3">
                {t('platformDash.atRisk')} ({health.atRiskTenants.length})
              </h3>
              <ul role="list" className="divide-y divide-slate-100 dark:divide-slate-800">
                {health.atRiskTenants.slice(0, 10).map(r => (
                  <li key={r.tenantId} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-mono text-xs t-text-body truncate">{r.tenantId.slice(0, 8)}</span>
                    <Badge variant="danger" size="sm">{r.score}/100</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* ─── SUPPORT QUEUE ──────────────────────────────────────────────── */}
      {canSupport && (
        <section aria-labelledby="pd-support">
          <header className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <LifeBuoy className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
              <h2 id="pd-support" className="text-sm font-semibold uppercase tracking-wider t-text-2">
                {t('platformDash.sectionSupport')}
              </h2>
            </div>
            <Link
              to="/admin/platform/support"
              className="text-xs text-teal-700 dark:text-teal-400 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded px-1"
            >
              {t('platformDash.viewAllQueue')} →
            </Link>
          </header>
          <div className="t-card-bordered rounded-2xl p-5">
            {lQueue && <p className="text-xs t-text-3">{t('common.loading') ?? '…'}</p>}
            {!lQueue && topQueue.length === 0 && (
              <p className="text-xs t-text-3">{t('platformDash.noOpenTickets')}</p>
            )}
            <ul role="list" className="divide-y divide-slate-100 dark:divide-slate-800">
              {topQueue.map(tk => (
                <li key={tk.id} className="flex items-start justify-between gap-3 py-2">
                  <Link to={`/admin/platform/support/${tk.id}`}
                    className="flex-1 min-w-0 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded px-1">
                    <p className="text-sm font-medium t-text truncate">{tk.title}</p>
                    <p className="text-[11px] t-text-3">
                      {tk.tenant?.name ?? tk.tenantId.slice(0, 8)} ·{' '}
                      {new Date(tk.createdAt).toLocaleDateString(dateLocale)}
                    </p>
                  </Link>
                  <Badge variant={priorityVariant(tk.priority)} size="sm">{tk.priority}</Badge>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ═════════════════════════════════════════════════════════════════════════ */}
      {/* SECTIONS KPI SAAS (Sprint KPI 2026-04-20)                                 */}
      {/* Montage conditionnel par permission fine-grained. Chaque section est      */}
      {/* auto-contenue (état local, useFetch, tokens sémantiques).                 */}
      {/* ═════════════════════════════════════════════════════════════════════════ */}

      {canKpiAdoption && <SectionNorthStar />}
      {canKpiBusiness && <SectionMrrBreakdown />}
      {canKpiAdoption && <SectionTransactional />}
      {canKpiAdoption && <SectionAdoptionDetailed />}
      {canKpiAdoption && <SectionActivation />}
      {canKpiRetention && <SectionRetention />}
      {canKpiAdoption && <SectionStrategic />}

      {/* ─── Quick actions ──────────────────────────────────────────────── */}
      <section aria-labelledby="pd-actions">
        <h2 id="pd-actions" className="text-xs font-semibold uppercase tracking-wider t-text-2 mb-3">
          {t('platformDash.quickActions')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {canManageTenants && (
            <Action to="/admin/platform/tenants"
              icon={<Building2 className="w-5 h-5" aria-hidden />}
              title={t('platformDash.actTenantsTitle')}
              desc={t('platformDash.actTenantsDesc')} />
          )}
          {canManagePlans && (
            <Action to="/admin/platform/plans"
              icon={<Wallet className="w-5 h-5" aria-hidden />}
              title={t('platformDash.actPlansTitle')}
              desc={t('platformDash.actPlansDesc')} />
          )}
          {canManageBilling && (
            <Action to="/admin/platform/billing"
              icon={<Wallet className="w-5 h-5" aria-hidden />}
              title={t('platformDash.actBillingTitle')}
              desc={t('platformDash.actBillingDesc')} />
          )}
          {canManageStaff && (
            <Action to="/admin/platform/staff"
              icon={<UserCog className="w-5 h-5" aria-hidden />}
              title={t('platformDash.actStaffTitle')}
              desc={t('platformDash.actStaffDesc')} />
          )}
          {canImpersonate && (
            <Action to="/admin/platform/impersonation"
              icon={<UserCheck className="w-5 h-5" aria-hidden />}
              title={t('platformDash.actImpersonateTitle')}
              desc={t('platformDash.actImpersonateDesc')} />
          )}
          {canSupport && (
            <Action to="/admin/platform/support"
              icon={<LifeBuoy className="w-5 h-5" aria-hidden />}
              title={t('platformDash.actSupportTitle')}
              desc={t('platformDash.actSupportDesc')} />
          )}
          <Action to="/admin/platform/debug/workflow"
            icon={<Bug className="w-5 h-5" aria-hidden />}
            title={t('platformDash.actWfDebugTitle')}
            desc={t('platformDash.actWfDebugDesc')} />
          <Action to="/admin/platform/debug/outbox"
            icon={<RefreshCw className="w-5 h-5" aria-hidden />}
            title={t('platformDash.actOutboxTitle')}
            desc={t('platformDash.actOutboxDesc')} />
        </div>
      </section>
    </div>
  );
}
