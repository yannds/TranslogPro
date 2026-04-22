/**
 * PortalShell — Enveloppe générique pour les portails contextuels
 * (driver, station-agent, quai-agent).
 *
 * Structure identique à AdminDashboard :
 *   1. Logo (haut)
 *   2. Nav scrollable (milieu)
 *   3. BottomBar : Bell · Thème · Aide & Support · UserMenu (bas)
 *   4. Bouton collapse (très bas)
 *
 * Les paths account/support/notifications sont lus depuis la section _utility
 * du config passé en props — évite tout hardcoding dans le shell.
 */

import { useMemo, useState, useRef, useEffect, Suspense } from 'react';
import { useLocation, useNavigate }   from 'react-router-dom';
import {
  Sun, Moon, Bell, LifeBuoy, UserCircle2, LogOut,
  ChevronDown, ChevronsLeft, ChevronsRight,
  BookOpen, FileText,
} from 'lucide-react';
import { useAuth }            from '../../lib/auth/auth.context';
import { useI18n }            from '../../lib/i18n/useI18n';
import { useNavigation }      from '../../lib/hooks/useNavigation';
import { useLockedViewport }  from '../../lib/hooks/useLockedViewport';
import { useSidebarCollapsed } from '../../lib/hooks/useSidebarCollapsed';
import { useTheme }           from '../theme/ThemeProvider';
import { SidebarNavItem }     from '../dashboard/SidebarNavItem';
import { PageRouter }         from '../dashboard/PageRouter';
import { SuspendedScreen }    from '../billing/SuspendedScreen';
import { OfflineBanner }      from '../offline/OfflineBanner';
import { cn }                 from '../../lib/utils';
import type { PortalNavConfig, ResolvedNavItem, NavLeaf } from '../../lib/navigation/nav.types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

/** Extrait les hrefs utilitaires (account, support, notifications) depuis la
 *  section _utility du config. Fallback sur des paths génériques si absents. */
function getUtilityHrefs(config: PortalNavConfig): { account: string; support: string; notifications: string } {
  const section = config.sections.find(s => s.id === '_utility');
  const items = (section?.items ?? []) as NavLeaf[];
  return {
    account:       items.find(i => i.id === 'account')?.href       ?? '/account',
    support:       items.find(i => i.id === 'support')?.href       ?? '/support',
    notifications: items.find(i => i.id === 'notifications')?.href ?? '/notifications',
  };
}

// ─── SidebarSection ───────────────────────────────────────────────────────────

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

// ─── UserMenu — dropdown inline dans le bottom bar ────────────────────────────

interface UserMenuProps {
  name:         string;
  email?:       string;
  role?:        string;
  initials:     string;
  collapsed:    boolean;
  accountHref:  string;
  onLogout:     () => void;
}

function UserMenu({ name, email, role, initials, collapsed, accountHref, onLogout }: UserMenuProps) {
  const { t }           = useI18n();
  const navigate         = useNavigate();
  const [open, setOpen]  = useState(false);
  const ref              = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title={collapsed ? name : undefined}
        aria-label={t('account.title')}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'w-full flex items-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
          collapsed ? 'justify-center py-2.5' : 'gap-3 px-3 py-2',
          't-nav-text t-nav-hover',
        )}
      >
        <span
          className="w-7 h-7 rounded-full bg-teal-600 dark:bg-teal-700 flex items-center justify-center text-white text-[11px] font-bold shrink-0"
          aria-hidden
        >
          {initials}
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-sm font-medium t-text-body truncate">{name}</span>
            {role && <span className="block text-[10px] text-slate-500 truncate">{role}</span>}
          </span>
        )}
        {!collapsed && (
          <ChevronDown
            className={cn('w-3 h-3 shrink-0 text-slate-500 transition-transform duration-200', open && 'rotate-180')}
            aria-hidden
          />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute bottom-full mb-1 z-50',
            collapsed ? 'left-full ml-2 w-48' : 'left-0 right-0',
            'rounded-xl border t-border t-sidebar shadow-lg py-1',
          )}
        >
          <div className="px-3 py-2 border-b t-border">
            <p className="text-sm font-semibold t-text-body truncate">{name}</p>
            {email && <p className="text-[11px] text-slate-500 truncate">{email}</p>}
          </div>

          <button
            role="menuitem"
            onClick={() => { setOpen(false); navigate(accountHref); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm t-nav-text t-nav-hover transition-colors text-left"
          >
            <UserCircle2 className="w-4 h-4 shrink-0" />
            {t('account.title')}
          </button>

          <button
            role="menuitem"
            onClick={() => { setOpen(false); onLogout(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 dark:text-red-400 transition-colors text-left"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {t('portal.logout')}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── BottomBar ────────────────────────────────────────────────────────────────

interface BottomBarProps {
  collapsed:     boolean;
  authUser:      { name?: string | null; email?: string | null; roleName?: string | null; userType?: string } | null;
  onLogout:      () => void;
  utilityHrefs:  { account: string; support: string; notifications: string };
}

function BottomBar({ collapsed, authUser, onLogout, utilityHrefs }: BottomBarProps) {
  const { theme, toggle }           = useTheme();
  const { t }                       = useI18n();
  const navigate                    = useNavigate();
  const [supportExpanded, setSupExp] = useState(false);

  const name     = authUser?.name ?? authUser?.email ?? '?';
  const initials = name.slice(0, 2).toUpperCase();
  const role     = authUser?.roleName ?? authUser?.userType;

  const btnBase = cn(
    'relative w-full flex items-center text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded-xl',
    't-nav-text t-nav-hover',
    collapsed ? 'justify-center py-2.5' : 'gap-3 px-3 py-2',
  );

  const subBtnBase = 'w-full flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg t-nav-text t-nav-hover transition-colors text-left';

  return (
    <div
      className={cn(
        'shrink-0 border-t t-border',
        collapsed ? 'flex flex-col items-center py-2 gap-1' : 'flex flex-col gap-1 px-2 py-2',
      )}
    >
      {/* Bell — notifications */}
      <button
        onClick={() => navigate(utilityHrefs.notifications)}
        title={t('nav.notifications')}
        aria-label={t('nav.notifications')}
        className={btnBase}
      >
        <Bell className="w-4 h-4 shrink-0" />
        {!collapsed && (
          <span className="flex-1 truncate text-sm">{t('nav.notifications')}</span>
        )}
      </button>

      {/* Theme toggle */}
      <button
        onClick={toggle}
        title={theme === 'dark' ? t('portal.lightMode') : t('portal.darkMode')}
        aria-label={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
        className={btnBase}
      >
        {theme === 'dark'
          ? <Sun  className="w-4 h-4 shrink-0" />
          : <Moon className="w-4 h-4 shrink-0" />
        }
        {!collapsed && (
          <span className="flex-1 truncate text-sm">
            {theme === 'dark' ? t('portal.lightMode') : t('portal.darkMode')}
          </span>
        )}
      </button>

      {/* Aide & Support — accordéon identique à AdminDashboard */}
      <div className="w-full">
        <button
          onClick={collapsed ? () => navigate(utilityHrefs.support) : () => setSupExp(e => !e)}
          title={collapsed ? t('nav.help_support') : undefined}
          aria-label={collapsed ? t('nav.help_support') : undefined}
          aria-expanded={collapsed ? undefined : supportExpanded}
          className={btnBase}
        >
          <LifeBuoy className="w-4 h-4 shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 truncate text-sm">{t('nav.help_support')}</span>
              <ChevronDown
                className={cn('w-3 h-3 shrink-0 transition-transform duration-200', supportExpanded && 'rotate-180')}
                aria-hidden
              />
            </>
          )}
        </button>
        {!collapsed && supportExpanded && (
          <ul className="mt-0.5 ml-4 pl-2 border-l border-slate-200 dark:border-slate-700 space-y-0.5">
            <li>
              <button onClick={() => navigate(utilityHrefs.support)} className={subBtnBase}>
                <LifeBuoy className="w-3.5 h-3.5 shrink-0" />
                {t('nav.contact_support')}
              </button>
            </li>
            <li>
              <button className={subBtnBase} disabled title="Bientôt disponible">
                <BookOpen className="w-3.5 h-3.5 shrink-0 opacity-50" />
                <span className="opacity-50">{t('nav.help_center')}</span>
              </button>
            </li>
            <li>
              <button className={subBtnBase} disabled title="Bientôt disponible">
                <FileText className="w-3.5 h-3.5 shrink-0 opacity-50" />
                <span className="opacity-50">{t('nav.documentation')}</span>
              </button>
            </li>
          </ul>
        )}
      </div>

      {/* UserMenu — avatar + Mon compte + Déconnexion */}
      <UserMenu
        name={name}
        email={authUser?.email ?? undefined}
        role={role ?? undefined}
        initials={initials}
        collapsed={collapsed}
        accountHref={utilityHrefs.account}
        onLogout={onLogout}
      />
    </div>
  );
}

// ─── PortalShell ──────────────────────────────────────────────────────────────

export interface PortalShellProps {
  config:            PortalNavConfig;
  roleFallbackLabel: string;
  ariaNavLabel:      string;
}

export function PortalShell({ config, roleFallbackLabel, ariaNavLabel }: PortalShellProps) {
  useLockedViewport();

  const { user: authUser, logout } = useAuth();
  const { t }                      = useI18n();
  const location                   = useLocation();
  const { collapsed, toggle: toggleCollapsed, setCollapsed } = useSidebarCollapsed();

  const permissions = authUser?.permissions ?? [];

  const { sections, activeId } = useNavigation({
    config,
    permissions,
    t,
    enabledModules: authUser?.enabledModules ?? [],
    currentHref:    location.pathname + location.search,
  });

  const activeHref    = location.pathname + location.search;
  const utilityHrefs  = useMemo(() => getUtilityHrefs(config), [config]);

  const sidebarContent = useMemo(() => (
    <nav
      className="flex-1 overflow-y-auto px-2 py-3 space-y-4"
      aria-label={ariaNavLabel}
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
  ), [sections, activeHref, ariaNavLabel, collapsed, setCollapsed]);

  const logo = (
    <div className="flex items-center gap-2">
      <div className="w-7 h-7 rounded-lg bg-teal-600 flex items-center justify-center text-white font-black text-sm shrink-0">
        T
      </div>
      {!collapsed && (
        <span className="font-bold t-text text-sm tracking-wide">
          TranslogPro
        </span>
      )}
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden t-app">
      <aside
        aria-label={ariaNavLabel}
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
          {logo}
        </div>

        {sidebarContent}

        <BottomBar
          collapsed={collapsed}
          authUser={authUser}
          onLogout={() => void logout()}
          utilityHrefs={utilityHrefs}
        />

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

      <div className="flex flex-1 flex-col overflow-hidden">
        <OfflineBanner />
        <main className="flex-1 overflow-y-auto t-app" role="main">
          <Suspense fallback={<PageLoadingFallback />}>
            <PageRouter activeId={activeId} />
          </Suspense>
        </main>
      </div>

      {/* Verrou SUSPENDED — commun à tous les portails (driver, station-agent,
          quai-agent) qui dérivent de PortalShell. AdminDashboard a sa propre
          instance. Ne s'affiche que si user.subscriptionStatus === 'SUSPENDED'
          et hors des routes exemptées (/admin/billing, /welcome, /login). */}
      <SuspendedScreen />
    </div>
  );
}
