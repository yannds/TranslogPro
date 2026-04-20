/**
 * AdminDashboard — Orchestrateur du portail d'administration TranslogPro
 *
 * Light mode par défaut — Dark mode via classe 'dark' sur <html>.
 */

import { useMemo, useState, Suspense }  from 'react';
import { useLocation }        from 'react-router-dom';
import { LogOut, Sun, Moon, Menu, X, UserCircle2, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useAuth }            from '../../lib/auth/auth.context';
import { useI18n }             from '../../lib/i18n/useI18n';
import { useNavigation } from '../../lib/hooks/useNavigation';
import { useLockedViewport } from '../../lib/hooks/useLockedViewport';
import { useSidebarCollapsed } from '../../lib/hooks/useSidebarCollapsed';
import { useTheme }           from '../theme/ThemeProvider';
import { ADMIN_NAV, PLATFORM_NAV } from '../../lib/navigation/nav.config';
import { resolveHost }         from '../../lib/tenancy/host';
import { SidebarNavItem }     from '../dashboard/SidebarNavItem';
import { PageRouter }         from '../dashboard/PageRouter';
import { cn }                 from '../../lib/utils';
import type { ResolvedNavItem } from '../../lib/navigation/nav.types';
import { TenantScopeSelector } from '../platform/TenantScopeSelector';
import { ImpersonationBanner } from '../platform/ImpersonationBanner';
import { TrialBanner }         from '../billing/TrialBanner';
import { SuspendedScreen }     from '../billing/SuspendedScreen';
import { OfflineBanner }       from '../offline/OfflineBanner';

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
  title?:          string;
  items:           ResolvedNavItem[];
  activeHref:      string;
  collapsed:       boolean;
  onRequestExpand: () => void;
}

function SidebarSection({ title, items, activeHref, collapsed, onRequestExpand }: SidebarSectionProps) {
  return (
    <div>
      {title && !collapsed && (
        <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest t-text-2">
          {title}
        </div>
      )}
      {title && collapsed && (
        <div className="mx-2 mb-1 h-px bg-slate-200 dark:bg-slate-700/60" aria-hidden />
      )}
      <ul role="list" className="space-y-0.5">
        {items.map(item => (
          <SidebarNavItem
            key={item.id}
            item={item}
            activeHref={activeHref}
            collapsed={collapsed}
            onRequestExpand={onRequestExpand}
          />
        ))}
      </ul>
    </div>
  );
}

export function AdminDashboard() {
  // Garde-fou scroll : verrouille <html>/<body> pendant que ce shell est monté.
  // Sinon un composant tiers peut étendre le scroll area du document et faire
  // dériver tout le SPA en bloc (sidebar + main) au moindre scroll.
  useLockedViewport();

  const { user: authUser, logout } = useAuth();
  const { theme, toggle }          = useTheme();
  const { t }                      = useI18n();
  const location = useLocation();
  const { collapsed, toggle: toggleCollapsed, setCollapsed } = useSidebarCollapsed();

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
    // Inclure la query string : sinon les items dont les hrefs ne diffèrent
    // que par `?type=ticket` vs `?type=parcel` (drv-scan / drv-scan-parcel,
    // qa-scan / qa-scan-parcel) collapsent sur le même path et activeId
    // tombe à null → fallback PageDashboard.
    currentHref:    location.pathname + location.search,
  });

  const activeHref = location.pathname + location.search;

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
          collapsed={collapsed}
          onRequestExpand={() => setCollapsed(false)}
        />
      ))}
    </nav>
  ), [sections, activeHref, collapsed, setCollapsed]);

  // Drawer mobile : la liste complète est toujours ouverte (on ne reprend pas
  // l'état rail ici — le mobile dispose déjà d'un drawer plein écran).
  const mobileSidebarContent = useMemo(() => (
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
          collapsed={false}
          onRequestExpand={() => {}}
        />
      ))}
    </nav>
  ), [sections, activeHref]);

  const logo = (showText: boolean) => (
    <div className="flex items-center gap-2">
      <div className="w-7 h-7 rounded-lg bg-teal-600 flex items-center justify-center text-white font-black text-sm shrink-0">
        T
      </div>
      {showText && (
        <span className="font-bold t-text text-sm tracking-wide">
          TranslogPro
        </span>
      )}
    </div>
  );

  const userPanel = (
    <div className={cn('flex items-center', collapsed ? 'flex-col gap-2' : 'gap-2.5')}>
      <div
        className="w-8 h-8 rounded-full bg-teal-600 dark:bg-teal-700 flex items-center justify-center text-white text-xs font-bold shrink-0"
        aria-hidden
      >
        {(authUser?.name ?? authUser?.email ?? '?').slice(0, 2).toUpperCase()}
      </div>
      {!collapsed && (
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium t-text-body truncate">
            {authUser?.name ?? authUser?.email}
          </p>
          <p className="text-[10px] text-slate-500 truncate">
            {authUser?.roleName ?? authUser?.userType}
          </p>
        </div>
      )}

      {/* Toggle Jour / Nuit */}
      <button
        onClick={toggle}
        title={theme === 'dark' ? t('portal.lightMode') : t('portal.darkMode')}
        aria-label={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
        className="shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-slate-700/60 dark:hover:text-amber-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      >
        {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>

      {/* Accès self-service au compte — mot de passe, MFA, préférences. */}
      <a
        href="/account"
        title={t('account.title')}
        aria-label={t('account.title')}
        className="shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950/40 dark:hover:text-teal-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
      >
        <UserCircle2 className="w-4 h-4" />
      </a>

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
        className={cn(
          'hidden lg:flex flex-col shrink-0 t-sidebar border-r t-border transition-[width] duration-200',
          collapsed ? 'w-14' : 'w-64',
        )}
      >
        <div
          className={cn(
            'flex h-14 items-center border-b t-border shrink-0',
            collapsed ? 'justify-center px-2' : 'px-4',
          )}
        >
          {logo(!collapsed)}
        </div>
        {sidebarContent}
        <div className={cn('shrink-0 border-t t-border', collapsed ? 'p-2' : 'p-3')}>
          {userPanel}
        </div>
        <button
          onClick={toggleCollapsed}
          title={collapsed ? t('portal.sidebar.expand') : t('portal.sidebar.collapse')}
          aria-label={collapsed ? t('portal.sidebar.expand') : t('portal.sidebar.collapse')}
          aria-expanded={!collapsed}
          className="shrink-0 border-t t-border py-2 flex items-center justify-center text-slate-500 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950/40 dark:hover:text-teal-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          {collapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
        </button>
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
              {logo(true)}
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-1.5 rounded-lg t-text-2 hover:t-text transition-colors"
                aria-label="Fermer le menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {mobileSidebarContent}
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
          {logo(true)}
        </div>

        {/* Bandeau offline / outbox — visible ssi browser offline ou mutations
            en attente de sync. Placé ici (dans le shell, au-dessus du <main>
            scrollable) pour ne pas étendre la hauteur document et casser
            l'ancrage h-screen. */}
        <OfflineBanner />

        {/* Banner d'impersonation — présent ssi session JIT active (présence
            de user.impersonation dans /api/auth/me). Chrono persistant, bouton
            Terminer self-service, auto-revoke sur pagehide. */}
        <ImpersonationBanner />

        {/* Bannière trial — visible seulement pour les tenants en phase
            d'essai avec <= 14 jours restants. Masquée 24h au dismiss.
            Ne monter que pour les utilisateurs qui peuvent gérer la facturation :
            évite un 403 bruyant dans la console pour les agents/caissiers. */}
        {permissions.includes('control.settings.manage.tenant') && (
          <div className="px-4 pt-3 sm:px-6">
            <TrialBanner />
          </div>
        )}

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

      {/* Verrou SUSPENDED — bloque toute l'app admin sauf /admin/billing
          et /welcome. Se monte ici pour rester au-dessus de la sidebar,
          du header et du contenu. */}
      <SuspendedScreen />
    </div>
  );
}
