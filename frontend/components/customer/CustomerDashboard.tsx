/**
 * CustomerDashboard — Orchestrateur du portail Client (CUSTOMER).
 *
 * Responsabilités :
 *   - Charge CUSTOMER_NAV via useNavigation (filtré par permissions/.own)
 *   - Sidebar latérale + dispatch sur l'activeId
 *   - Garde-fous : redirige vers /admin si l'utilisateur n'est pas userType=CUSTOMER
 *
 * Distinct d'AdminDashboard pour isoler les surfaces (sécurité + UX simple).
 */

import { useMemo } from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { LogOut, Sun, Moon } from 'lucide-react';
import { useAuth }            from '../../lib/auth/auth.context';
import { useI18n }            from '../../lib/i18n/useI18n';
import { useNavigation }      from '../../lib/hooks/useNavigation';
import { useTheme }           from '../theme/ThemeProvider';
import { CUSTOMER_NAV }       from '../../lib/navigation/nav.config';
import { SidebarNavItem }     from '../dashboard/SidebarNavItem';
import { PageCustomerHome }   from './PageCustomerHome';
import { PageMyTickets }      from './PageMyTickets';
import { PageMyParcels }      from './PageMyParcels';
import { PageRetroClaim }     from './PageRetroClaim';
import type { ResolvedNavItem, ResolvedNavSection } from '../../lib/navigation/nav.types';

function PageCustomerWip({ title }: { title: string }) {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">{title}</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Bientôt disponible.
      </p>
    </div>
  );
}

function CustomerPageRouter({ activeId }: { activeId: string | null }) {
  switch (activeId) {
    case 'cust-home':     return <PageCustomerHome />;
    case 'cust-trips':    return <PageMyTickets />;
    case 'cust-parcels':  return <PageMyParcels />;
    case 'cust-retro':    return <PageRetroClaim />;
    case 'cust-claim':    return <PageCustomerWip title="Réclamation" />;
    case 'cust-feedback': return <PageCustomerWip title="Donner un avis" />;
    default:              return <PageCustomerHome />;
  }
}

function SidebarSection({ title, items, activeHref }: { title?: string; items: ResolvedNavItem[]; activeHref: string }) {
  return (
    <div>
      {title && (
        <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
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

export function CustomerDashboard() {
  const { user, logout }  = useAuth();
  const { theme, toggle } = useTheme();
  const { t }             = useI18n();
  const location = useLocation();

  // Garde-fou : seuls les CUSTOMER accèdent à /customer.
  // Le STAFF et SUPER_ADMIN sont redirigés vers leurs propres portails.
  if (user && user.userType !== 'CUSTOMER') {
    return <Navigate to="/admin" replace />;
  }

  const { sections, activeId } = useNavigation({
    config:         CUSTOMER_NAV,
    permissions:    user?.permissions ?? [],
    t,
    enabledModules: user?.enabledModules ?? [],
    currentHref:    location.pathname,
  });

  const sidebarContent = useMemo(() => (
    <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4" aria-label="Navigation client">
      {sections.map((section: ResolvedNavSection) => (
        <SidebarSection
          key={section.id}
          title={section.title}
          items={section.items}
          activeHref={location.pathname}
        />
      ))}
    </nav>
  ), [sections, location.pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950">

      <aside
        aria-label="Navigation client"
        className="hidden lg:flex flex-col w-60 shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800"
      >
        <div className="flex h-14 items-center px-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-teal-600 flex items-center justify-center text-white font-black text-sm">
              T
            </div>
            <span className="font-bold text-slate-900 dark:text-white text-sm tracking-wide">
              Espace Client
            </span>
          </div>
        </div>
        {sidebarContent}
        <div className="shrink-0 border-t border-slate-200 dark:border-slate-800 p-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-teal-600 flex items-center justify-center text-white text-xs font-bold shrink-0" aria-hidden>
              {(user?.name ?? user?.email ?? '?').slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                {user?.name ?? user?.email}
              </p>
              <p className="text-[10px] text-slate-500 truncate">Client</p>
            </div>
            <button
              onClick={toggle}
              title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
              aria-label="Toggle theme"
              className="shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-slate-700/60"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={() => void logout()}
              title="Déconnexion"
              aria-label="Se déconnecter"
              className="shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto" role="main">
        <CustomerPageRouter activeId={activeId} />
      </main>
    </div>
  );
}
