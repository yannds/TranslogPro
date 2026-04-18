/**
 * AdminDashboard — Orchestrateur du portail d'administration TranslogPro
 *
 * Light mode par défaut — Dark mode via classe 'dark' sur <html>.
 */

import { useMemo, useState, Suspense }  from 'react';
import { useLocation }        from 'react-router-dom';
import { LogOut, Sun, Moon, Menu, X }  from 'lucide-react';
import { useAuth }            from '../../lib/auth/auth.context';
import { useI18n }             from '../../lib/i18n/useI18n';
import { useNavigation } from '../../lib/hooks/useNavigation';
import { useTheme }           from '../theme/ThemeProvider';
import { ADMIN_NAV, PLATFORM_NAV } from '../../lib/navigation/nav.config';
import { resolveHost }         from '../../lib/tenancy/host';
import { SidebarNavItem }     from '../dashboard/SidebarNavItem';
import { PageRouter }         from '../dashboard/PageRouter';
import type { ResolvedNavItem } from '../../lib/navigation/nav.types';
import { TenantScopeSelector } from '../platform/TenantScopeSelector';

function PageLoadingFallback() {
  return (
    <div className="p-6 flex items-center justify-center min-h-[50vh]">
      <div
        className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"
        role="status"
        aria-label="Chargement…"
      />
    </div>
  );
}

interface SidebarSectionProps {
  title?:     string;
  items:      ResolvedNavItem[];
  activeHref: string;
}

function SidebarSection({ title, items, activeHref }: SidebarSectionProps) {
  return (
    <div>
      {title && (
        <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest t-text-2">
          {title}
        </div>
      )}
      <ul role="list" className="space-y-0.5">
        {items.map(item => (
          <SidebarNavItem key={item.id} item={item} activeHref={activeHref} />
        ))}
      </ul>
    </div>
  );
}

export function AdminDashboard() {
  const { user: authUser, logout } = useAuth();
  const { theme, toggle }          = useTheme();
  const { t }                      = useI18n();
  const location = useLocation();

  // Source unique : permissions résolues backend dans /api/auth/me (zéro
  // duplication frontend ↔ seed IAM).
  const permissions = authUser?.permissions ?? [];

  // Sur admin.translog.test (portail plateforme) → nav Control Plane uniquement.
  // Sur sous-domaine tenant (ou pendant une impersonation) → nav tenant complète.
  const navConfig = resolveHost().isAdmin ? PLATFORM_NAV : ADMIN_NAV;

  const { sections, activeId } = useNavigation({
    config:         navConfig,
    permissions,
    t,
    enabledModules: authUser?.enabledModules ?? [],
    currentHref:    location.pathname,
  });

  const activeHref = location.pathname;

  const sidebarContent = useMemo(() => (
    <nav
      className="flex-1 overflow-y-auto px-2 py-3 space-y-4"
      aria-label="Navigation principale"
    >
      {sections.map(section => (
        <SidebarSection
          key={section.id}
          title={section.title}
          items={section.items}
          activeHref={activeHref}
        />
      ))}
    </nav>
  ), [sections, activeHref]);

  const logo = (
    <div className="flex items-center gap-2">
      <div className="w-7 h-7 rounded-lg bg-teal-600 flex items-center justify-center text-white font-black text-sm">
        T
      </div>
      <span className="font-bold t-text text-sm tracking-wide">
        TranslogPro
      </span>
    </div>
  );

  const userPanel = (
    <div className="flex items-center gap-2.5">
      <div
        className="w-8 h-8 rounded-full bg-teal-600 dark:bg-teal-700 flex items-center justify-center text-white text-xs font-bold shrink-0"
        aria-hidden
      >
        {(authUser?.name ?? authUser?.email ?? '?').slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium t-text-body truncate">
          {authUser?.name ?? authUser?.email}
        </p>
        <p className="text-[10px] text-slate-500 truncate">
          {authUser?.roleName ?? authUser?.userType}
        </p>
      </div>

      {/* Toggle Jour / Nuit */}
      <button
        onClick={toggle}
        title={theme === 'dark' ? t('portal.lightMode') : t('portal.darkMode')}
        aria-label={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
        className="shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-slate-700/60 dark:hover:text-amber-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      >
        {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>

      <button
        onClick={() => void logout()}
        title={t('portal.logout')}
        aria-label="Se déconnecter"
        className="shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 dark:hover:text-red-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
      >
        <LogOut className="w-4 h-4" />
      </button>
    </div>
  );

  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden t-app">

      {/* ── Sidebar desktop ──────────────────────────────────── */}
      <aside
        aria-label="Navigation principale"
        className="hidden lg:flex flex-col w-64 shrink-0 t-sidebar border-r t-border"
      >
        <div className="flex h-14 items-center px-4 border-b t-border shrink-0">
          {logo}
        </div>
        {sidebarContent}
        <div className="shrink-0 border-t t-border p-3">
          {userPanel}
        </div>
      </aside>

      {/* ── Sidebar mobile (drawer) ──────────────────────────── */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <aside
            className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col t-sidebar border-r t-border lg:hidden animate-in slide-in-from-left duration-200"
            aria-label="Navigation principale"
          >
            <div className="flex h-14 items-center justify-between px-4 border-b t-border shrink-0">
              {logo}
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-1.5 rounded-lg t-text-2 hover:t-text transition-colors"
                aria-label="Fermer le menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {sidebarContent}
            <div className="shrink-0 border-t t-border p-3">
              {userPanel}
            </div>
          </aside>
        </>
      )}

      {/* ── Main ─────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile top bar */}
        <div className="flex items-center gap-3 border-b t-border bg-white dark:bg-slate-900 px-4 py-3 lg:hidden">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
            aria-label="Ouvrir le menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          {logo}
        </div>

        {/* Bandeau staff plateforme — visible uniquement si tenantId === PLATFORM.
            Permet de scoper les pages tenant-scoped (Trips, Fleet, Cashier, …)
            sur un tenant client, au lieu de requêter le tenant plateforme (vide). */}
        <TenantScopeSelector />

        {/* Scroll container */}
        <main className="flex-1 overflow-y-auto t-app" role="main">
          <Suspense fallback={<PageLoadingFallback />}>
            <PageRouter activeId={activeId} />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
