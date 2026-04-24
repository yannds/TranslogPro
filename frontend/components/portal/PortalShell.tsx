/**
 * PortalShell — Enveloppe générique pour les portails contextuels
 * (driver, station-agent, quai-agent).
 *
 * Structure et rendu identiques à AdminDashboard :
 *   1. Logo (haut)
 *   2. Nav scrollable avec accordéons L0 (icône+titre) → L1 (SidebarNavItem)
 *   3. BottomBar : Thème · UserMenu consolidé (bas)
 *   4. Bouton collapse (très bas)
 *
 * Sections sans titre → rendu direct (pas d'accordéon), identique à la section
 * Dashboard dans AdminDashboard.
 * Sections avec titre + icon → accordéon cliquable, même comportement admin.
 *
 * UserMenu : dropdown consolidé = Notifications (badge unread) + Aide & Support
 *            + Mon compte + Déconnexion. L'avatar porte la pastille d'unread.
 */

import { useMemo, useState, useRef, useEffect, Suspense } from 'react';
import { useLocation, useNavigate }   from 'react-router-dom';
import {
  Sun, Moon, Bell, LifeBuoy, UserCircle2, LogOut,
  ChevronDown, ChevronsLeft, ChevronsRight,
} from 'lucide-react';
import { useAuth }             from '../../lib/auth/auth.context';
import { useI18n }             from '../../lib/i18n/useI18n';
import { useNavigation }       from '../../lib/hooks/useNavigation';
import { useAnnouncementFeed } from '../../lib/hooks/useAnnouncementFeed';
import { useLockedViewport }   from '../../lib/hooks/useLockedViewport';
import { useSidebarCollapsed } from '../../lib/hooks/useSidebarCollapsed';
import { useTheme }            from '../theme/ThemeProvider';
import { NavIcon }             from '../dashboard/NavIcon';
import { SidebarNavItem }      from '../dashboard/SidebarNavItem';
import { PageRouter }          from '../dashboard/PageRouter';
import { SuspendedScreen }     from '../billing/SuspendedScreen';
import { OfflineBanner }       from '../offline/OfflineBanner';
import { cn }                  from '../../lib/utils';
import type { PortalNavConfig, ResolvedNavSection, NavLeaf } from '../../lib/navigation/nav.types';

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

function isSingleLeaf(section: ResolvedNavSection): boolean {
  return section.items.length === 1 && !section.items[0]?.children;
}

function isSectionActive(section: ResolvedNavSection, activeHref: string): boolean {
  return section.items.some(
    item => item.href === activeHref || item.children?.some(c => c.href === activeHref),
  );
}

/** Extrait les hrefs utilitaires depuis la section _utility du config. */
function getUtilityHrefs(config: PortalNavConfig): { account: string; support: string; notifications: string } {
  const section = config.sections.find(s => s.id === '_utility');
  const items = (section?.items ?? []) as NavLeaf[];
  return {
    account:       items.find(i => i.id === 'account')?.href       ?? '/account',
    support:       items.find(i => i.id === 'support')?.href       ?? '/support',
    notifications: items.find(i => i.id === 'notifications')?.href ?? '/notifications',
  };
}

// ─── SidebarSection — Accordéon L0 (identique à AdminDashboard) ───────────────

interface SidebarSectionProps {
  section:         ResolvedNavSection;
  activeHref:      string;
  collapsed:       boolean;
  onRequestExpand: () => void;
}

function SidebarSection({ section, activeHref, collapsed, onRequestExpand }: SidebarSectionProps) {
  const navigate = useNavigate();
  const active   = isSectionActive(section, activeHref);

  // Section à item unique : rendu direct (même comportement que Dashboard dans admin)
  if (isSingleLeaf(section)) {
    const leaf = section.items[0]!;
    const isLeafActive = leaf.href === activeHref;

    if (collapsed) {
      return (
        <li>
          <button
            onClick={() => navigate(leaf.href)}
            title={section.title ?? leaf.label}
            aria-label={section.title ?? leaf.label}
            aria-current={isLeafActive ? 'page' : undefined}
            className={cn(
              'w-full flex items-center justify-center rounded-xl py-2.5 transition-colors',
              isLeafActive ? 't-nav-active' : cn('t-nav-text', 't-nav-hover'),
            )}
          >
            <NavIcon name={section.icon ?? leaf.icon} className="w-5 h-5" />
          </button>
        </li>
      );
    }

    return (
      <li>
        <button
          onClick={() => navigate(leaf.href)}
          aria-current={isLeafActive ? 'page' : undefined}
          className={cn(
            'w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors text-left',
            isLeafActive ? 't-nav-active' : cn('t-nav-text', 't-nav-hover'),
          )}
        >
          <NavIcon name={section.icon ?? leaf.icon} className="w-5 h-5 shrink-0" />
          <span className="flex-1 truncate uppercase tracking-wider">{section.title ?? leaf.label}</span>
        </button>
      </li>
    );
  }

  // Section sans titre (anonyme) : rendu plat avec séparateur
  if (!section.title) {
    return (
      <li>
        <ul role="list" className="space-y-0.5">
          {section.items.map(item => (
            <SidebarNavItem
              key={item.id}
              item={item}
              activeHref={activeHref}
              collapsed={collapsed}
              onRequestExpand={onRequestExpand}
            />
          ))}
        </ul>
      </li>
    );
  }

  // Section multi-items avec titre : accordéon L0 (identique AdminDashboard)
  return (
    <SidebarSectionAccordion
      section={section}
      activeHref={activeHref}
      active={active}
      collapsed={collapsed}
      onRequestExpand={onRequestExpand}
    />
  );
}

interface SidebarSectionAccordionProps {
  section:         ResolvedNavSection;
  activeHref:      string;
  active:          boolean;
  collapsed:       boolean;
  onRequestExpand: () => void;
}

function SidebarSectionAccordion({
  section, activeHref, active, collapsed, onRequestExpand,
}: SidebarSectionAccordionProps) {
  const [expanded, setExpanded] = useState(active);

  if (collapsed) {
    return (
      <li>
        <button
          onClick={() => { setExpanded(true); onRequestExpand(); }}
          title={section.title}
          aria-label={section.title}
          className={cn(
            'relative w-full flex items-center justify-center rounded-xl py-2.5 transition-colors',
            active ? 't-nav-group-active' : cn('t-nav-text', 't-nav-hover'),
          )}
        >
          <NavIcon name={section.icon ?? 'LayoutDashboard'} className="w-5 h-5" />
          {active && (
            <span
              aria-hidden
              className="absolute left-0.5 top-1/2 -translate-y-1/2 w-1 h-4 rounded-full bg-teal-500"
            />
          )}
        </button>
      </li>
    );
  }

  return (
    <li>
      <button
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        className={cn(
          'w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors text-left',
          active ? 't-nav-group-active' : cn('t-nav-text', 't-nav-hover'),
        )}
      >
        <NavIcon name={section.icon ?? 'LayoutDashboard'} className="w-5 h-5 shrink-0" />
        <span className="flex-1 truncate uppercase tracking-wider">{section.title}</span>
        <ChevronDown
          className={cn('w-3.5 h-3.5 shrink-0 transition-transform duration-200', expanded && 'rotate-180')}
          aria-hidden
        />
      </button>

      {expanded && (
        <ul
          role="list"
          className="mt-1 ml-2 pl-2 border-l border-slate-700/40 dark:border-slate-600/40 space-y-0.5"
        >
          {section.items.map(item => (
            <SidebarNavItem
              key={item.id}
              item={item}
              activeHref={activeHref}
              collapsed={false}
              depth={1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ─── UserMenu — dropdown consolidé (Notifications + Aide + Compte + Logout) ──

interface UserMenuProps {
  name:              string;
  email?:            string;
  role?:             string;
  initials:          string;
  collapsed:         boolean;
  unreadCount:       number;
  canSupport:        boolean;
  accountHref:       string;
  notificationsHref: string;
  supportHref:       string;
  onLogout:          () => void;
}

function UserMenu({
  name, email, role, initials, collapsed,
  unreadCount, canSupport,
  accountHref, notificationsHref, supportHref,
  onLogout,
}: UserMenuProps) {
  const { t }           = useI18n();
  const navigate        = useNavigate();
  const [open, setOpen] = useState(false);
  const ref             = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const itemClass = 'w-full flex items-center gap-2.5 px-3 py-2 text-sm t-nav-text t-nav-hover transition-colors text-left';

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
        <span className="relative shrink-0">
          <span
            className="w-7 h-7 rounded-full bg-teal-600 dark:bg-teal-700 flex items-center justify-center text-white text-[11px] font-bold"
            aria-hidden
          >
            {initials}
          </span>
          {unreadCount > 0 && (
            <span
              aria-label={t('nav.notifications')}
              className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-[9px] font-bold text-white ring-2 ring-white dark:ring-slate-900 flex items-center justify-center"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
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
            collapsed ? 'left-full ml-2 w-56' : 'left-0 right-0',
            'rounded-xl border t-border t-sidebar shadow-lg py-1',
          )}
        >
          <div className="px-3 py-2 border-b t-border">
            <p className="text-sm font-semibold t-text-body truncate">{name}</p>
            {email && <p className="text-[11px] text-slate-500 truncate">{email}</p>}
          </div>

          <button
            role="menuitem"
            onClick={() => { setOpen(false); navigate(notificationsHref); }}
            className={itemClass}
          >
            <Bell className="w-4 h-4 shrink-0" />
            <span className="flex-1 truncate">{t('nav.notifications')}</span>
            {unreadCount > 0 && (
              <span className="shrink-0 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {canSupport && (
            <button
              role="menuitem"
              onClick={() => { setOpen(false); navigate(supportHref); }}
              className={itemClass}
            >
              <LifeBuoy className="w-4 h-4 shrink-0" />
              <span className="flex-1 truncate">{t('nav.help_support')}</span>
            </button>
          )}

          <div className="my-1 border-t t-border" aria-hidden />

          <button
            role="menuitem"
            onClick={() => { setOpen(false); navigate(accountHref); }}
            className={itemClass}
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

// ─── BottomBar — Theme · UserMenu (consolidé) ────────────────────────────────

interface BottomBarProps {
  collapsed:     boolean;
  authUser:      { name?: string | null; email?: string | null; roleName?: string | null; userType?: string; tenantId?: string } | null;
  onLogout:      () => void;
  permissions:   string[];
  utilityHrefs:  { account: string; support: string; notifications: string };
}

function BottomBar({ collapsed, authUser, onLogout, permissions, utilityHrefs }: BottomBarProps) {
  const { theme, toggle } = useTheme();
  const { t }             = useI18n();
  const { notifications } = useAnnouncementFeed({ tenantId: authUser?.tenantId ?? null });
  const unreadCount       = notifications.length;

  const name     = authUser?.name ?? authUser?.email ?? '?';
  const initials = name.slice(0, 2).toUpperCase();
  const role     = authUser?.roleName ?? authUser?.userType;
  const canSupport = permissions.includes('data.support.create.tenant') ||
                     permissions.includes('data.support.read.tenant');

  const btnBase = cn(
    'relative w-full flex items-center text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded-xl',
    't-nav-text t-nav-hover',
    collapsed ? 'justify-center py-2.5' : 'gap-3 px-3 py-2',
  );

  return (
    <div
      className={cn(
        'shrink-0 border-t t-border',
        collapsed ? 'flex flex-col items-center py-2 gap-1' : 'flex flex-col gap-1 px-2 py-2',
      )}
    >
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

      {/* UserMenu consolidé — avatar avec badge + Notifications + Aide + Compte + Logout */}
      <UserMenu
        name={name}
        email={authUser?.email ?? undefined}
        role={role ?? undefined}
        initials={initials}
        collapsed={collapsed}
        unreadCount={unreadCount}
        canSupport={canSupport}
        accountHref={utilityHrefs.account}
        notificationsHref={utilityHrefs.notifications}
        supportHref={utilityHrefs.support}
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

export function PortalShell({ config, ariaNavLabel }: PortalShellProps) {
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

  const sidebarNav = useMemo(() => (
    <nav
      className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5"
      aria-label={ariaNavLabel}
    >
      <ul role="list" className="space-y-0.5">
        {sections.map(section => (
          <SidebarSection
            key={section.id}
            section={section}
            activeHref={activeHref}
            collapsed={collapsed}
            onRequestExpand={() => setCollapsed(false)}
          />
        ))}
      </ul>
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

        {sidebarNav}

        <BottomBar
          collapsed={collapsed}
          authUser={authUser}
          onLogout={() => void logout()}
          permissions={permissions}
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
          instance. */}
      <SuspendedScreen />
    </div>
  );
}
