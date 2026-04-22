/**
 * Navigation types — architecture permission-driven
 *
 * Un NavItem est visible si l'utilisateur possède AU MOINS UNE permission
 * de la liste `anyOf`. Si `anyOf` est absent, l'item est toujours visible.
 *
 * Un NavSection disparaît entièrement si aucun de ses items n'est visible.
 *
 * Usage :
 *   const { sections } = useNavigation(userPermissions);
 *   // sections contient uniquement les groupes + items accessibles
 */

import type { TranslationMap } from '../i18n/types';

export type NavItemId = string;
/** Label: string simple OU TranslationMap (résolu en string par useNavigation via t()) */
type Label = string | TranslationMap;

// ─── Item feuille ─────────────────────────────────────────────────────────────

export interface NavLeaf {
  kind:          'leaf';
  id:            NavItemId;
  label:         Label;
  href:          string;
  icon:          string;          // lucide icon name — résolu dans le composant
  badge?:        string | number;
  /** L'item est visible si le user a AU MOINS UNE de ces permissions */
  anyOf?:        string[];
  /** moduleKey SaaS requis — l'item est masqué si le module n'est pas actif pour le tenant */
  moduleKey?:    string;
  /** Marque l'item comme "en développement" — visible mais désactivé */
  wip?:          boolean;
}

// ─── Item avec sous-menu ──────────────────────────────────────────────────────

export interface NavGroup {
  kind:          'group';
  id:            NavItemId;
  label:         Label;
  icon:          string;
  /** Le groupe est visible si le user a AU MOINS UNE de ces permissions */
  anyOf?:        string[];
  /** moduleKey SaaS requis — le groupe est masqué si le module n'est pas actif */
  moduleKey?:    string;
  children:      NavLeaf[];
}

export type NavItem = NavLeaf | NavGroup;

// ─── Section (catégorie de la sidebar) ───────────────────────────────────────

export interface NavSection {
  id:            string;
  title?:        Label;           // undefined = pas de titre (section anonyme)
  /** Lucide icon name — affiché comme icône L0 dans la sidebar accordion */
  icon?:         string;
  items:         NavItem[];
  /** La section est visible si le user a AU MOINS UNE de ces permissions */
  anyOf?:        string[];
  /** moduleKey SaaS requis — toute la section est masquée si le module n'est pas actif */
  moduleKey?:    string;
}

// ─── Config complète d'un portail ─────────────────────────────────────────────

export interface PortalNavConfig {
  portalId:      string;          // 'admin' | 'station-agent' | 'quai-agent' | 'driver'
  sections:      NavSection[];
}

// ─── Résultat filtré retourné par useNavigation ───────────────────────────────

export interface ResolvedNavSection {
  id:            string;
  title?:        string;
  icon?:         string;
  items:         ResolvedNavItem[];
}

export interface ResolvedNavItem {
  id:            NavItemId;
  label:         string;
  href:          string;
  icon:          string;
  badge?:        string | number;
  wip?:          boolean;
  children?:     ResolvedNavLeaf[];
}

export interface ResolvedNavLeaf {
  id:            NavItemId;
  label:         string;
  href:          string;
  icon:          string;
  badge?:        string | number;
  wip?:          boolean;
}
