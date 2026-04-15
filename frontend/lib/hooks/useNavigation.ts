/**
 * useNavigation — Filtre l'arbre de navigation selon les permissions du user
 *
 * Utilisation :
 *   const { sections, hasPermission, activeId, setActiveId } = useNavigation({
 *     config:      ADMIN_NAV,
 *     permissions: user.permissions,   // string[] depuis le JWT / session
 *     currentHref: '/admin/trips',
 *   });
 *
 * Un item est visible si :
 *   1. Il n'a pas de `anyOf` (visible pour tous)
 *   2. OU le user possède au moins une des permissions listées dans `anyOf`
 *
 * Une section est visible si au moins un de ses items est visible.
 * Un groupe est visible si au moins un de ses enfants est visible.
 */

import { useMemo, useState, useCallback } from 'react';
import type {
  PortalNavConfig,
  NavItem,
  NavLeaf,
  NavGroup,
  NavSection,
  ResolvedNavSection,
  ResolvedNavItem,
  ResolvedNavLeaf,
} from '../navigation/nav.types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UseNavigationOptions {
  config:          PortalNavConfig;
  permissions:     string[];            // liste des permissions de l'utilisateur
  /** moduleKey SaaS actifs pour le tenant. `undefined` = pas de filtrage par module (back-compat). */
  enabledModules?: string[];
  currentHref?:    string;              // pour marquer l'item actif
}

interface UseNavigationResult {
  sections:     ResolvedNavSection[];
  hasPermission: (anyOf: string[]) => boolean;
  activeId:     string | null;
  setActiveId:  (id: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function permSet(permissions: string[]): Set<string> {
  return new Set(permissions);
}

function isVisible(anyOf: string[] | undefined, perms: Set<string>): boolean {
  if (!anyOf || anyOf.length === 0) return true;
  return anyOf.some(p => perms.has(p));
}

/** Un item masqué par module si `moduleKey` est défini ET absent de `modules`.
 *  Si `modules` est `null`, le filtrage par module est désactivé (back-compat). */
function moduleVisible(moduleKey: string | undefined, modules: Set<string> | null): boolean {
  if (!moduleKey) return true;
  if (modules === null) return true;
  return modules.has(moduleKey);
}

function resolveLeaf(leaf: NavLeaf, perms: Set<string>, modules: Set<string> | null): ResolvedNavLeaf | null {
  if (!isVisible(leaf.anyOf, perms)) return null;
  if (!moduleVisible(leaf.moduleKey, modules)) return null;
  return {
    id:     leaf.id,
    label:  leaf.label,
    href:   leaf.href,
    icon:   leaf.icon,
    badge:  leaf.badge,
    wip:    leaf.wip,
  };
}

function resolveItem(item: NavItem, perms: Set<string>, modules: Set<string> | null): ResolvedNavItem | null {
  if (item.kind === 'leaf') {
    const leaf = resolveLeaf(item, perms, modules);
    if (!leaf) return null;
    return leaf;
  }

  // Group
  const group = item as NavGroup;
  if (!isVisible(group.anyOf, perms)) return null;
  if (!moduleVisible(group.moduleKey, modules)) return null;

  const children = group.children
    .map(c => resolveLeaf(c, perms, modules))
    .filter((c): c is ResolvedNavLeaf => c !== null);

  if (children.length === 0) return null;

  return {
    id:       group.id,
    label:    group.label,
    href:     children[0]!.href,   // href par défaut = 1er enfant visible
    icon:     group.icon,
    children,
  };
}

function resolveSection(section: NavSection, perms: Set<string>, modules: Set<string> | null): ResolvedNavSection | null {
  if (!isVisible(section.anyOf, perms)) return null;
  if (!moduleVisible(section.moduleKey, modules)) return null;

  const items = section.items
    .map(item => resolveItem(item, perms, modules))
    .filter((i): i is ResolvedNavItem => i !== null);

  if (items.length === 0) return null;

  return {
    id:    section.id,
    title: section.title,
    items,
  };
}

/** Trouve l'id de l'item actif en comparant href avec currentHref.
 *  Les enfants sont testés EN PREMIER : le groupe hérite du href du premier
 *  enfant, donc il faut éviter qu'il "vole" le match avant l'enfant réel.
 */
function findActiveId(sections: ResolvedNavSection[], currentHref: string): string | null {
  for (const section of sections) {
    for (const item of section.items) {
      // 1. Chercher dans les enfants d'abord
      if (item.children) {
        for (const child of item.children) {
          if (child.href === currentHref) return child.id;
        }
      }
      // 2. Tester l'item lui-même seulement si pas d'enfant correspondant
      if (!item.children && item.href === currentHref) return item.id;
    }
  }
  return null;
}

/** Fallback sur la config brute (non filtrée par permissions/modules).
 *  Évite que PageRouter tombe sur `default` quand un leaf est masqué au user
 *  mais que le composant cible gère déjà son propre contrôle d'accès.
 */
function findActiveIdInConfig(config: PortalNavConfig, currentHref: string): string | null {
  for (const section of config.sections) {
    for (const item of section.items) {
      if (item.kind === 'group') {
        for (const child of item.children) {
          if (child.href === currentHref) return child.id;
        }
      } else if (item.href === currentHref) {
        return item.id;
      }
    }
  }
  return null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useNavigation({
  config,
  permissions,
  enabledModules,
  currentHref,
}: UseNavigationOptions): UseNavigationResult {
  const perms = useMemo(() => permSet(permissions), [permissions]);

  // null = pas de filtrage par module (back-compat). Sinon Set pour lookup O(1).
  const modules = useMemo<Set<string> | null>(
    () => (enabledModules === undefined ? null : new Set(enabledModules)),
    [enabledModules],
  );

  const sections = useMemo<ResolvedNavSection[]>(() =>
    config.sections
      .map(s => resolveSection(s, perms, modules))
      .filter((s): s is ResolvedNavSection => s !== null),
    [config, perms, modules],
  );

  const inferredActiveId = useMemo<string | null>(() => {
    if (!currentHref) return null;
    return findActiveId(sections, currentHref)
        ?? findActiveIdInConfig(config, currentHref);
  }, [sections, config, currentHref]);

  const [manualActiveId, setActiveId] = useState<string | null>(null);

  const activeId = manualActiveId ?? inferredActiveId;

  const hasPermission = useCallback(
    (anyOf: string[]) => isVisible(anyOf, perms),
    [perms],
  );

  return { sections, hasPermission, activeId, setActiveId };
}

// ─── Profils de rôles (DEMO ONLY) ─────────────────────────────────────────────
// ⚠️ NE PAS UTILISER EN PRODUCTION — duplication du seed backend.
// Le portail admin charge `permissions` depuis `/api/auth/me` (source unique).
// Cette map sert UNIQUEMENT au sélecteur de rôle mock dans DriverSpace et
// StationAgentApp (démos hors-ligne sans backend). À supprimer dès que ces
// démos consomment l'API d'auth.
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: [
    'control.iam.manage.tenant',       'control.iam.audit.tenant',
    'control.agency.manage.tenant',    'data.agency.read.tenant',
    'control.integration.setup.tenant','control.module.install.tenant',
    'control.settings.manage.tenant',  'control.workflow.studio.read.tenant',
    'control.workflow.studio.write.tenant', 'control.workflow.simulate.tenant',
    'control.workflow.marketplace.read.tenant',
    'control.route.manage.tenant',     'data.trip.create.tenant',
    'data.trip.update.agency',         'control.trip.delay.agency',
    'control.trip.cancel.tenant',      'control.trip.log_event.own',
    'data.ticket.create.agency',       'data.ticket.read.agency',
    'data.ticket.read.tenant',         'data.ticket.scan.agency',
    'data.ticket.cancel.agency',       'data.ticket.print.agency',
    'data.traveler.verify.agency',     'data.luggage.weigh.agency',
    'data.parcel.create.agency',       'data.parcel.scan.agency',
    'data.parcel.update.agency',       'data.parcel.update.tenant',
    'data.parcel.report.agency',       'data.shipment.group.agency',
    'control.fleet.manage.tenant',     'control.fleet.layout.tenant',
    'data.fleet.status.agency',        'data.maintenance.approve.tenant',
    'data.manifest.generate.agency',   'data.manifest.sign.agency',
    'data.manifest.print.agency',      'data.manifest.read.own',
    'control.pricing.manage.tenant',   'control.pricing.yield.tenant',
    'data.pricing.read.agency',        'data.cashier.open.own',
    'data.cashier.transaction.own',    'data.cashier.close.agency',
    'data.invoice.print.agency',       'data.sav.report.agency',
    'data.sav.claim.tenant',           'data.sav.deliver.agency',
    'control.staff.manage.tenant',     'data.crew.manage.tenant',
    'data.crm.read.tenant',            'control.campaign.manage.tenant',
    'control.stats.read.tenant',       'control.safety.monitor.global',
    'data.display.update.agency',      'data.template.write.agency',
    'data.template.read.agency',       'control.tenant.manage.global',
    'control.platform.staff.global',   'control.impersonation.switch.global',
    'control.impersonation.revoke.global', 'data.workflow.debug.global',
    'data.outbox.replay.global',
  ],

  TENANT_ADMIN: [
    'control.iam.manage.tenant',       'control.iam.audit.tenant',
    'control.agency.manage.tenant',    'data.agency.read.tenant',
    'control.integration.setup.tenant','control.module.install.tenant',
    'control.settings.manage.tenant',  'control.workflow.studio.read.tenant',
    'control.workflow.studio.write.tenant', 'control.workflow.simulate.tenant',
    'control.workflow.marketplace.read.tenant',
    'control.route.manage.tenant',     'data.trip.create.tenant',
    'data.trip.update.agency',         'control.trip.delay.agency',
    'control.trip.cancel.tenant',      'data.ticket.create.agency',
    'data.ticket.read.tenant',         'data.ticket.cancel.agency',
    'data.ticket.print.agency',        'data.parcel.create.agency',
    'data.parcel.update.tenant',       'data.shipment.group.agency',
    'control.fleet.manage.tenant',     'control.fleet.layout.tenant',
    'data.fleet.status.agency',        'data.maintenance.approve.tenant',
    'data.manifest.generate.agency',   'data.manifest.print.agency',
    'control.pricing.manage.tenant',   'control.pricing.yield.tenant',
    'data.cashier.close.agency',       'data.invoice.print.agency',
    'data.sav.claim.tenant',           'control.staff.manage.tenant',
    'data.crew.manage.tenant',         'data.crm.read.tenant',
    'control.campaign.manage.tenant',  'control.stats.read.tenant',
    'data.display.update.agency',      'data.template.write.agency',
  ],

  AGENCY_MANAGER: [
    'control.iam.audit.tenant',        'data.trip.update.agency',
    'control.trip.delay.agency',       'data.ticket.create.agency',
    'data.ticket.read.agency',         'data.ticket.cancel.agency',
    'data.ticket.print.agency',        'data.traveler.verify.agency',
    'data.luggage.weigh.agency',       'data.parcel.create.agency',
    'data.parcel.update.agency',       'data.parcel.report.agency',
    'data.fleet.status.agency',        'data.manifest.generate.agency',
    'data.manifest.print.agency',      'data.pricing.read.agency',
    'data.cashier.close.agency',       'data.invoice.print.agency',
    'data.sav.report.agency',          'data.sav.deliver.agency',
    'data.staff.read.agency',          'data.crm.read.tenant',
    'control.stats.read.tenant',       'data.display.update.agency',
    'data.template.read.agency',
  ],

  SUPERVISOR: [
    'data.trip.update.agency',         'control.trip.delay.agency',
    'data.ticket.read.agency',         'data.ticket.scan.agency',
    'data.ticket.print.agency',        'data.traveler.verify.agency',
    'data.luggage.weigh.agency',       'data.manifest.generate.agency',
    'data.manifest.sign.agency',       'data.manifest.print.agency',
    'data.fleet.status.agency',        'data.sav.report.agency',
    'data.staff.read.agency',          'data.display.update.agency',
  ],

  CASHIER: [
    'data.ticket.create.agency',       'data.ticket.read.agency',
    'data.ticket.cancel.agency',       'data.ticket.print.agency',
    'data.parcel.create.agency',       'data.pricing.read.agency',
    'data.cashier.open.own',           'data.cashier.transaction.own',
    'data.cashier.close.agency',       'data.invoice.print.agency',
    'data.sav.report.own',
  ],

  STATION_AGENT: [
    'data.ticket.create.agency',       'data.ticket.scan.agency',
    'data.ticket.read.agency',         'data.ticket.print.agency',
    'data.traveler.verify.agency',     'data.luggage.weigh.agency',
    'data.parcel.create.agency',       'data.parcel.scan.agency',
    'data.parcel.report.agency',       'data.manifest.generate.agency',
    'data.cashier.open.own',           'data.cashier.transaction.own',
    'data.display.update.agency',      'data.sav.report.own',
    'data.template.read.agency',
  ],

  QUAI_AGENT: [
    'data.trip.update.agency',         'data.ticket.scan.agency',
    'data.traveler.verify.agency',     'data.luggage.weigh.agency',
    'data.manifest.sign.agency',       'data.manifest.generate.agency',
    'control.trip.delay.agency',       'data.display.update.agency',
    'data.sav.report.own',
  ],

  DRIVER: [
    'data.trip.read.own',              'data.trip.check.own',
    'data.trip.report.own',            'control.trip.log_event.own',
    'data.manifest.read.own',          'data.maintenance.update.own',
    'data.feedback.submit.own',        'data.notification.read.own',
  ],
};
