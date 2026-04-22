/**
 * AdminDashboard — Shell du portail d'administration TranslogPro
 *
 * Sidebar 3 zones :
 *   1. Logo (haut, fixe)
 *   2. Nav L0→L1→L2 (scrollable) : SidebarSection accordion L0 → SidebarNavItem L1
 *   3. Bottom bar (bas, fixe) : Bell (badge unread) · Theme toggle · UserMenu · Support
 *
 * Collapsed (w-14) : icônes seules + séparateurs.
 * Expanded (w-64)  : icônes + labels.
 * Mobile           : drawer plein écran toujours expanded.
 *
 * UserMenu : dropdown inline dans le bottom bar (avatar → Mon compte / Déconnexion).
 */

import { useMemo, useState, useRef, useEffect, Suspense } from 'react';
import { useLocation, useNavigate }     from 'react-router-dom';
import {
  Sun, Moon, Menu, X, ChevronsLeft, ChevronsRight,
  Bell, LifeBuoy, UserCircle2, LogOut, ChevronDown,
  BookOpen, FileText,
} from 'lucide-react';
import { useAuth }                    from '../../lib/auth/auth.context';
import { useI18n }                    from '../../lib/i18n/useI18n';
import { useNavigation }              from '../../lib/hooks/useNavigation';
import { useNotifications }           from '../../lib/hooks/useNotifications';
import { useLockedViewport }          from '../../lib/hooks/useLockedViewport';
import { useSidebarCollapsed }        from '../../lib/hooks/useSidebarCollapsed';
import { useTheme }                   from '../theme/ThemeProvider';
import { ADMIN_NAV, PLATFORM_NAV }    from '../../lib/navigation/nav.config';
import { resolveHost }                from '../../lib/tenancy/host';
import { NavIcon }                    from '../dashboard/NavIcon';
import { SidebarNavItem }             from '../dashboard/SidebarNavItem';
import { PageRouter }                 from '../dashboard/PageRouter';
import { cn }                         from '../../lib/utils';
import type { ResolvedNavSection } from '../../lib/navigation/nav.types';
import { TenantScopeSelector }        from '../platform/TenantScopeSelector';
import { ImpersonationBanner }        from '../platform/ImpersonationBanner';
import { TrialBanner }                from '../billing/TrialBanner';
import { SuspendedScreen }            from '../billing/SuspendedScreen';
import { OfflineBanner }              from '../offline/OfflineBanner';

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

// ─── SidebarSection — Accordion L0 ───────────────────────────────────────────

interface SidebarSectionProps {
  section:         ResolvedNavSection;
  activeHref:      string;
  collapsed:       boolean;
  onRequestExpand: () => void;
}

function SidebarSection({ section, activeHref, collapsed, onRequestExpand }: SidebarSectionProps) {
  const navigate = useNavigate();
  const active   = isSectionActive(section, activeHref);

  // Sections à item unique : rendu direct (pas d'accordion).
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
          <span className="flex-1 truncate">{section.title ?? leaf.label}</span>
        </button>
      </li>
    );
  }

  // Sections multi-items : accordion L0.
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

  // Mode rail (collapsed) : icône seule, clic déplie la sidebar
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

  // Mode déplié : accordion avec titre, chevron, et items L1
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
        <span className="flex-1 truncate">{section.title}</span>
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

// ─── UserMenu — dropdown inline dans le bottom bar ────────────────────────────

interface UserMenuProps {
  name:      string;
  email?:    string;
  role?:     string;
  initials:  string;
  collapsed: boolean;
  onLogout:  () => void;
}

function UserMenu({ name, email, role, initials, collapsed, onLogout }: UserMenuProps) {
  const { t }          = useI18n();
  const navigate        = useNavigate();
  const [open, setOpen] = useState(false);
  const ref             = useRef<HTMLDivElement>(null);

  // Fermeture clic extérieur
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
          {/* En-tête utilisateur */}
          <div className="px-3 py-2 border-b t-border">
            <p className="text-sm font-semibold t-text-body truncate">{name}</p>
            {email && <p className="text-[11px] text-slate-500 truncate">{email}</p>}
          </div>

          <button
            role="menuitem"
            onClick={() => { setOpen(false); navigate('/admin/account'); }}
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

// ─── BottomBar — Bell · Theme · UserMenu · Support ────────────────────────────

interface BottomBarProps {
  collapsed:    boolean;
  authUser:     { name?: string | null; email?: string | null; roleName?: string | null; userType?: string } | null;
  onLogout:     () => void;
  permissions:  string[];
  unreadCount:  number;
}

function BottomBar({ collapsed, authUser, onLogout, permissions, unreadCount }: BottomBarProps) {
  const { theme, toggle } = useTheme();
  const { t }             = useI18n();
  const navigate          = useNavigate();
  const unread            = unreadCount;

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

  const subBtnBase = 'w-full flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg t-nav-text t-nav-hover transition-colors text-left';

  const [supportExpanded, setSupportExpanded] = useState(false);

  return (
    <div
      className={cn(
        'shrink-0 border-t t-border',
        collapsed ? 'flex flex-col items-center py-2 gap-1' : 'flex flex-col gap-1 px-2 py-2',
      )}
    >
      {/* Bell — notifications */}
      <button
        onClick={() => navigate('/admin/notifications')}
        title={t('nav.notifications')}
        aria-label={t('nav.notifications')}
        className={btnBase}
      >
        <Bell className="w-4 h-4 shrink-0" />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute top-1.5 left-5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-900"
          />
        )}
        {!collapsed && (
          <span className="flex-1 truncate text-sm">{t('nav.notifications')}</span>
        )}
        {!collapsed && unread > 0 && (
          <span className="shrink-0 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
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

      {/* UserMenu — avatar + Mon compte + Déconnexion */}
      <UserMenu
        name={name}
        email={authUser?.email ?? undefined}
        role={role ?? undefined}
        initials={initials}
        collapsed={collapsed}
        onLogout={onLogout}
      />

      {/* Aide & Support — accordion avec sous-menus */}
      {canSupport && (
        <div className="w-full">
          <button
            onClick={collapsed ? () => navigate('/admin/support') : () => setSupportExpanded(e => !e)}
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
                <button onClick={() => navigate('/admin/support')} className={subBtnBase}>
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
      )}
    </div>
  );
}

// ─── AdminDashboard ───────────────────────────────────────────────────────────

export function AdminDashboard() {
  useLockedViewport();

  const { user: authUser, logout } = useAuth();
  const { t }                      = useI18n();
  const location                   = useLocation();
  const { collapsed, toggle: toggleCollapsed, setCollapsed } = useSidebarCollapsed();

  const permissions    = authUser?.permissions ?? [];
  const { notifications } = useNotifications({ tenantId: authUser?.tenantId ?? 'demo' });
  const unreadCount    = notifications.length;

  const navConfig      = resolveHost().isAdmin ? PLATFORM_NAV : ADMIN_NAV;
  const { sections, activeId } = useNavigation({
    config:         navConfig,
    permissions,
    t,
    enabledModules: authUser?.enabledModules ?? [],
    currentHref:    location.pathname + location.search,
  });

  const activeHref = location.pathname + location.search;

  // ── Nav scrollable ──────────────────────────────────────────────────────
  const sidebarNav = useMemo(() => (
    <nav
      className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5"
      aria-label="Navigation principale"
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
  ), [sections, activeHref, collapsed, setCollapsed]);

  // Mobile : toujours expanded (pas de rail sur petit écran)
  const mobileSidebarNav = useMemo(() => (
    <nav
      className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5"
      aria-label="Navigation principale"
    >
      <ul role="list" className="space-y-0.5">
        {sections.map(section => (
          <SidebarSection
            key={section.id}
            section={section}
            activeHref={activeHref}
            collapsed={false}
            onRequestExpand={() => {}}
          />
        ))}
      </ul>
    </nav>
  ), [sections, activeHref]);

  // ── Logo ────────────────────────────────────────────────────────────────
  const logo = (showText: boolean) => (
    <div className="flex items-center gap-2">
      <div className="w-7 h-7 rounded-lg bg-teal-600 flex items-center justify-center text-white font-black text-sm shrink-0">
        T
      </div>
      {showText && (
        <span className="font-bold t-text text-sm tracking-wide">TranslogPro</span>
      )}
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
        {/* Logo */}
        <div
          className={cn(
            'flex h-14 items-center border-b t-border shrink-0',
            collapsed ? 'justify-center px-2' : 'px-4',
          )}
        >
          {logo(!collapsed)}
        </div>

        {/* Nav scrollable */}
        {sidebarNav}

        {/* Bottom bar : Bell · Theme · UserMenu · Support */}
        <BottomBar
          collapsed={collapsed}
          authUser={authUser}
          onLogout={() => void logout()}
          permissions={permissions}
          unreadCount={unreadCount}
        />

        {/* Toggle collapsed */}
        <button
          onClick={toggleCollapsed}
          title={collapsed ? t('portal.sidebar.expand') : t('portal.sidebar.collapse')}
          aria-label={collapsed ? t('portal.sidebar.expand') : t('portal.sidebar.collapse')}
          aria-expanded={!collapsed}
          className="shrink-0 border-t t-border py-2 flex items-center justify-center text-slate-500 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950/40 dark:hover:text-teal-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          {collapsed
            ? <ChevronsRight className="w-4 h-4" />
            : <ChevronsLeft  className="w-4 h-4" />
          }
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

            {mobileSidebarNav}

            <BottomBar
              collapsed={false}
              authUser={authUser}
              onLogout={() => { setDrawerOpen(false); void logout(); }}
              permissions={permissions}
              unreadCount={unreadCount}
            />
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

        <OfflineBanner />
        <ImpersonationBanner />

        {permissions.includes('control.settings.manage.tenant') && (
          <div className="px-4 pt-3 sm:px-6">
            <TrialBanner />
          </div>
        )}

        <TenantScopeSelector />

        <main className="flex-1 overflow-y-auto t-app" role="main">
          <Suspense fallback={<PageLoadingFallback />}>
            <PageRouter activeId={activeId} />
          </Suspense>
        </main>
      </div>

      <SuspendedScreen />
    </div>
  );
}
