/**
 * SidebarNavItem — Élément de navigation sidebar avec expand/collapse
 *
 * Gère deux variantes :
 *   - Groupe avec enfants (bouton expansible + sous-liste)
 *   - Lien simple (bouton avec badge et indicateur WIP)
 *
 * Utilise useNavigate (react-router-dom) pour la navigation SPA.
 */
import { useState }     from 'react';
import { useNavigate }  from 'react-router-dom';
import { cn }           from '../../lib/utils';
import { NavIcon }      from './NavIcon';
import type { ResolvedNavItem } from '../../lib/navigation/nav.types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SidebarNavItemProps {
  item:       ResolvedNavItem;
  activeHref: string | null;
  /** Profondeur courante (non utilisé visuellement, réservé) */
  depth?:     number;
}

// ─── Composant ────────────────────────────────────────────────────────────────

export function SidebarNavItem({
  item, activeHref, depth: _depth = 0,
}: SidebarNavItemProps) {
  const navigate = useNavigate();

  const isChildActive = item.children?.some(c => c.href === activeHref) ?? false;
  const [expanded, setExpanded] = useState(() => isChildActive);
  const isActive = item.href === activeHref || isChildActive;

  // ── Groupe avec sous-items ─────────────────────────────────────────────────
  if (item.children) {
    return (
      <li>
        <button
          onClick={() => setExpanded(e => !e)}
          className={cn(
            'w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left',
            isActive ? 'bg-slate-700/60 text-slate-100' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100',
          )}
        >
          <NavIcon name={item.icon} />
          <span className="flex-1 truncate">{item.label}</span>
          <svg
            className={cn('w-3.5 h-3.5 shrink-0 transition-transform', expanded ? 'rotate-180' : '')}
            viewBox="0 0 20 20" fill="currentColor" aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {expanded && (
          <ul className="mt-0.5 ml-3 pl-3 border-l border-slate-800 space-y-0.5">
            {item.children.map(child => (
              <li key={child.id}>
                <button
                  onClick={() => !child.wip && navigate(child.href)}
                  disabled={child.wip}
                  aria-current={child.href === activeHref ? 'page' : undefined}
                  className={cn(
                    'w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors text-left',
                    child.href === activeHref
                      ? 'bg-teal-900/40 text-teal-300 font-medium'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/60',
                    child.wip && 'opacity-40 cursor-not-allowed',
                  )}
                >
                  <NavIcon name={child.icon} className="w-3.5 h-3.5" />
                  <span className="flex-1 truncate">{child.label}</span>
                  {child.wip && (
                    <span className="text-[9px] bg-amber-900/40 text-amber-500 px-1 rounded">WIP</span>
                  )}
                  {child.badge != null && (
                    <span className="shrink-0 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {child.badge}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  }

  // ── Lien simple ───────────────────────────────────────────────────────────
  return (
    <li>
      <button
        onClick={() => !item.wip && navigate(item.href)}
        disabled={item.wip}
        aria-current={item.href === activeHref ? 'page' : undefined}
        className={cn(
          'w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left',
          item.href === activeHref
            ? 'bg-teal-900/40 text-teal-300'
            : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100',
          item.wip && 'opacity-40 cursor-not-allowed',
        )}
      >
        <NavIcon name={item.icon} />
        <span className="flex-1 truncate">{item.label}</span>
        {item.wip && (
          <span className="text-[9px] bg-amber-900/40 text-amber-500 px-1 rounded">WIP</span>
        )}
        {item.badge != null && (
          <span className="shrink-0 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {item.badge}
          </span>
        )}
      </button>
    </li>
  );
}
