/**
 * SidebarNavItem — Élément de navigation sidebar avec expand/collapse
 *
 * Utilise les tokens sémantiques (t-nav-*, t-badge-wip) définis dans index.css.
 * Pour modifier les couleurs de navigation, modifier index.css uniquement.
 *
 * Mode `collapsed` : rendu rail d'icônes (w-14). Pas de label, pas de chevron,
 * pas de liste enfants — un clic sur un groupe en mode rail auto-déplie la
 * sidebar via `onRequestExpand`. Badge numérique → petit point ambre.
 */
import { useState }     from 'react';
import { useNavigate }  from 'react-router-dom';
import { cn }           from '../../lib/utils';
import { NavIcon }      from './NavIcon';
import type { ResolvedNavItem } from '../../lib/navigation/nav.types';

export interface SidebarNavItemProps {
  item:             ResolvedNavItem;
  activeHref:       string | null;
  depth?:           number;
  collapsed?:       boolean;
  onRequestExpand?: () => void;
}

export function SidebarNavItem({
  item,
  activeHref,
  depth: _depth = 0,
  collapsed = false,
  onRequestExpand,
}: SidebarNavItemProps) {
  const navigate = useNavigate();

  const isChildActive = item.children?.some(c => c.href === activeHref) ?? false;
  const [expanded, setExpanded] = useState(() => isChildActive);
  const isActive = item.href === activeHref || isChildActive;

  // ── Mode rail d'icônes (desktop collapsed) ────────────────────────────────
  // On rend un bouton compact icône-seule pour tout item (groupe comme leaf).
  // Le clic sur un groupe auto-déplie la sidebar via onRequestExpand et
  // marque le groupe comme expanded pour que ses enfants soient visibles
  // immédiatement après la bascule.
  if (collapsed) {
    const onClick = () => {
      if (item.wip) return;
      if (item.children) {
        setExpanded(true);
        onRequestExpand?.();
      } else {
        navigate(item.href);
      }
    };
    const hasNew = item.badge != null;
    return (
      <li>
        <button
          onClick={onClick}
          disabled={item.wip}
          title={item.label}
          aria-label={item.label}
          aria-current={item.href === activeHref ? 'page' : undefined}
          className={cn(
            'relative w-full flex items-center justify-center rounded-lg px-0 py-2 transition-colors',
            isActive ? 't-nav-active' : cn('t-nav-text', 't-nav-hover'),
            item.wip && 'opacity-40 cursor-not-allowed',
          )}
        >
          <NavIcon name={item.icon} />
          {hasNew && (
            <span
              aria-hidden
              className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-white dark:ring-slate-900"
            />
          )}
        </button>
      </li>
    );
  }

  // ── Groupe avec sous-items ─────────────────────────────────────────────────
  if (item.children) {
    return (
      <li>
        <button
          onClick={() => setExpanded(e => !e)}
          className={cn(
            'w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left',
            isActive ? 't-nav-group-active' : cn('t-nav-text', 't-nav-hover'),
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
          <ul className={cn('mt-0.5 ml-3 pl-3 t-nav-indent space-y-0.5')}>
            {item.children.map(child => (
              <li key={child.id}>
                <button
                  onClick={() => !child.wip && navigate(child.href)}
                  disabled={child.wip}
                  aria-current={child.href === activeHref ? 'page' : undefined}
                  className={cn(
                    'w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors text-left',
                    child.href === activeHref ? 't-nav-active font-medium' : cn('t-nav-text', 't-nav-hover'),
                    child.wip && 'opacity-40 cursor-not-allowed',
                  )}
                >
                  <NavIcon name={child.icon} className="w-3.5 h-3.5" />
                  <span className="flex-1 truncate">{child.label}</span>
                  {child.wip && (
                    <span className="text-[9px] t-badge-wip px-1 rounded">WIP</span>
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
          item.href === activeHref ? 't-nav-active' : cn('t-nav-text', 't-nav-hover'),
          item.wip && 'opacity-40 cursor-not-allowed',
        )}
      >
        <NavIcon name={item.icon} />
        <span className="flex-1 truncate">{item.label}</span>
        {item.wip && (
          <span className="text-[9px] t-badge-wip px-1 rounded">WIP</span>
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
