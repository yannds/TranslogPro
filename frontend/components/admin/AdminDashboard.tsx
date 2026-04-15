/**
 * AdminDashboard — Orchestrateur du portail d'administration TranslogPro
 *
 * Responsabilités :
 *   - Résoudre les permissions depuis le rôle de l'utilisateur connecté
 *   - Construire la navigation sidebar filtrée (useNavigation)
 *   - Rendre le layout sidebar + contenu principal
 *   - Déléguer le routage à PageRouter (avec Suspense pour les pages lazy)
 *
 * Ce fichier ne contient PAS de définitions de pages ni de composants visuels.
 * Tout est dans frontend/components/dashboard/.
 *
 * Pages disponibles selon profil : cf. nav.config.ts
 */

import { useMemo, Suspense }  from 'react';
import { useLocation }        from 'react-router-dom';
import { LogOut }             from 'lucide-react';
import { useAuth }            from '../../lib/auth/auth.context';
import { useNavigation, ROLE_PERMISSIONS } from '../../lib/hooks/useNavigation';
import { ADMIN_NAV }          from '../../lib/navigation/nav.config';
import { SidebarNavItem }     from '../dashboard/SidebarNavItem';
import { PageRouter }         from '../dashboard/PageRouter';
import type { ResolvedNavItem } from '../../lib/navigation/nav.types';

// ─── Type local ───────────────────────────────────────────────────────────────

type RoleKey = keyof typeof ROLE_PERMISSIONS;

// ─── Fallback Suspense ────────────────────────────────────────────────────────

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

// ─── Sidebar nav section ──────────────────────────────────────────────────────

interface SidebarSectionProps {
  title?:     string;
  items:      ResolvedNavItem[];
  activeHref: string;
}

function SidebarSection({ title, items, activeHref }: SidebarSectionProps) {
  return (
    <div>
      {title && (
        <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
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

// ─── AdminDashboard ───────────────────────────────────────────────────────────

export function AdminDashboard() {
  const { user: authUser, logout } = useAuth();
  const location = useLocation();

  // Permissions dérivées du rôle réel de l'utilisateur connecté
  const permissions = ROLE_PERMISSIONS[(authUser?.roleName ?? '') as RoleKey] ?? [];

  const { sections, activeId } = useNavigation({
    config:      ADMIN_NAV,
    permissions,
    currentHref: location.pathname,
  });

  const activeHref = location.pathname;

  // ── Sidebar content (mémorisé — re-render uniquement si sections/URL changent) ──

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

  // ── Logo ──────────────────────────────────────────────────────────────────

  const logo = (
    <div className="flex items-center gap-2">
      <div className="w-7 h-7 rounded-lg bg-teal-600 flex items-center justify-center text-white font-black text-sm">
        T
      </div>
      <span className="font-bold text-white text-sm tracking-wide">TranslogPro</span>
    </div>
  );

  // ── User panel ────────────────────────────────────────────────────────────

  const userPanel = (
    <div className="flex items-center gap-2.5">
      <div
        className="w-8 h-8 rounded-full bg-teal-700 flex items-center justify-center text-white text-xs font-bold shrink-0"
        aria-hidden
      >
        {(authUser?.name ?? authUser?.email ?? '?').slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-200 truncate">
          {authUser?.name ?? authUser?.email}
        </p>
        <p className="text-[10px] text-slate-500 truncate">
          {authUser?.roleName ?? authUser?.userType}
        </p>
      </div>
      <button
        onClick={() => void logout()}
        title="Déconnexion"
        aria-label="Se déconnecter"
        className="shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-950/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
      >
        <LogOut className="w-4 h-4" />
      </button>
    </div>
  );

  // ── Layout ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">
      {/* Sidebar desktop */}
      <aside
        aria-label="Navigation principale"
        className="hidden lg:flex flex-col w-64 shrink-0 bg-slate-900 border-r border-slate-800"
      >
        <div className="flex h-14 items-center px-4 border-b border-slate-800 shrink-0">
          {logo}
        </div>
        {sidebarContent}
        <div className="shrink-0 border-t border-slate-800 p-3">
          {userPanel}
        </div>
      </aside>

      {/* Contenu principal */}
      <main className="flex-1 overflow-y-auto bg-slate-950" role="main">
        <Suspense fallback={<PageLoadingFallback />}>
          <PageRouter activeId={activeId} />
        </Suspense>
      </main>
    </div>
  );
}
