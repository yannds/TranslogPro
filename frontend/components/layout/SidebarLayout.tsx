/**
 * SidebarLayout — Layout applicatif avec sidebar de navigation
 *
 * Structure :
 *   ┌─────────────────────────────────────────────────────┐
 *   │ SIDEBAR (fixe, 240px)  │  CONTENU (flex-1)          │
 *   │  Logo                  │  PageLayout ou PlainPage   │
 *   │  NavGroup              │                            │
 *   │    NavItem (actif)     │                            │
 *   │    NavItem             │                            │
 *   │  ──────────────────    │                            │
 *   │  NavGroup              │                            │
 *   │  UserPanel (bas)       │                            │
 *   └─────────────────────────────────────────────────────┘
 *
 * Mobile : sidebar masquée par défaut → drawer avec backdrop
 * Dark mode : slate-900 fond sidebar
 */
import { useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NavItem {
  label:   string;
  href:    string;
  icon?:   ReactNode;
  badge?:  string | number;
  active?: boolean;
}

export interface NavGroup {
  title?: string;
  items:  NavItem[];
}

interface SidebarLayoutProps {
  logo?:      ReactNode;
  navGroups:  NavGroup[];
  userPanel?: ReactNode;      // Slot bas : avatar + nom + déco
  children:   ReactNode;
  className?: string;
}

// ─── Composant ────────────────────────────────────────────────────────────────

export function SidebarLayout({
  logo, navGroups, userPanel, children, className,
}: SidebarLayoutProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn('flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950', className)}>

      {/* ── Sidebar (desktop) ──────────────────────────────────── */}
      <aside
        aria-label="Navigation principale"
        className={cn(
          'hidden lg:flex flex-col w-60 xl:w-64 shrink-0',
          'bg-slate-900 dark:bg-slate-950',
          'border-r border-slate-800',
        )}
      >
        <SidebarInner logo={logo} navGroups={navGroups} userPanel={userPanel} />
      </aside>

      {/* ── Sidebar mobile (drawer) ────────────────────────────── */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside
            className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-slate-900 border-r border-slate-800 lg:hidden"
            aria-label="Navigation principale"
          >
            <SidebarInner logo={logo} navGroups={navGroups} userPanel={userPanel} />
          </aside>
        </>
      )}

      {/* ── Main ──────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile top bar */}
        <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 lg:hidden">
          <button
            onClick={() => setOpen(true)}
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            aria-label="Ouvrir le menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 5A.75.75 0 0 1 2.75 9h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 9Zm0 5a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 14.75Z" clipRule="evenodd" />
            </svg>
          </button>
          {logo}
        </div>

        {/* Scroll container */}
        <main className="flex-1 overflow-y-auto" role="main">
          {children}
        </main>
      </div>
    </div>
  );
}

// ─── Inner sidebar (DRY entre desktop et drawer) ──────────────────────────────

function SidebarInner({
  logo, navGroups, userPanel,
}: Pick<SidebarLayoutProps, 'logo' | 'navGroups' | 'userPanel'>) {
  return (
    <>
      {/* Logo */}
      {logo && (
        <div className="flex h-14 items-center px-4 border-b border-slate-800 shrink-0">
          {logo}
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {navGroups.map((group, gi) => (
          <div key={gi}>
            {group.title && (
              <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                {group.title}
              </div>
            )}
            <ul role="list" className="space-y-0.5">
              {group.items.map((item, ii) => (
                <li key={ii}>
                  <a
                    href={item.href}
                    aria-current={item.active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      item.active
                        ? 'bg-slate-700 text-white'
                        : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100',
                    )}
                  >
                    {item.icon && (
                      <span className="shrink-0 w-4 h-4 flex items-center" aria-hidden>
                        {item.icon}
                      </span>
                    )}
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge != null && (
                      <span className="shrink-0 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {item.badge}
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* User panel */}
      {userPanel && (
        <div className="shrink-0 border-t border-slate-800 p-3">
          {userPanel}
        </div>
      )}
    </>
  );
}
