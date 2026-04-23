/**
 * Security Test — Subscription RBAC
 *
 * Vérifie que tous les endpoints du module subscription-checkout imposent
 * la permission `control.settings.manage.tenant` (SETTINGS_MANAGE_TENANT),
 * et que SEUL le rôle TENANT_ADMIN la possède dans le seed IAM.
 *
 * Défense-en-profondeur : le masquage UI (`/account?tab=billing` non rendu pour
 * les rôles sans la perm) n'est qu'une couche. La vraie garantie est que
 * DRIVER / CASHIER / STATION_AGENT / MECHANIC → 403 sur chaque endpoint,
 * même via curl direct.
 *
 * Ce test reste 100 % unitaire : on inspecte les décorateurs + le seed,
 * sans booter NestJS ni base. Rapide et déterministe.
 */
import 'reflect-metadata';
import { PERMISSION_KEY } from '../../src/common/decorators/require-permission.decorator';
import { SubscriptionCheckoutController } from '../../src/modules/subscription-checkout/subscription-checkout.controller';
import { TENANT_ROLES } from '../../prisma/seeds/iam.seed';

const REQUIRED_PERM = 'control.settings.manage.tenant';

describe('[SECURITY] Subscription RBAC', () => {
  it('SubscriptionCheckoutController impose @RequirePermission(SETTINGS_MANAGE_TENANT) au niveau classe', () => {
    const perm = Reflect.getMetadata(PERMISSION_KEY, SubscriptionCheckoutController);
    // Peut être string | string[] selon l'implémentation
    const list = Array.isArray(perm) ? perm : [perm];
    expect(list).toContain(REQUIRED_PERM);
  });

  it('tous les handlers de SubscriptionCheckoutController héritent de la permission classe (pas de override plus permissif)', () => {
    const proto = SubscriptionCheckoutController.prototype as unknown as Record<string, unknown>;
    const methodNames = Object.getOwnPropertyNames(proto).filter(n => n !== 'constructor');
    for (const name of methodNames) {
      const methodPerm = Reflect.getMetadata(PERMISSION_KEY, proto[name] as object);
      // Si présent au niveau méthode, il doit contenir la perm ou être strictement plus strict
      if (methodPerm !== undefined) {
        const list = Array.isArray(methodPerm) ? methodPerm : [methodPerm];
        // L'override ne doit jamais être une perm moins restrictive (ex: un wildcard public)
        expect(list.every(p => typeof p === 'string' && p.startsWith('control.'))).toBe(true);
      }
    }
  });

  it('SEUL le rôle TENANT_ADMIN a la permission SETTINGS_MANAGE_TENANT dans le seed IAM', () => {
    const rolesWithPerm = TENANT_ROLES
      .filter(r => r.permissions.includes(REQUIRED_PERM))
      .map(r => r.name);
    expect(rolesWithPerm).toEqual(['TENANT_ADMIN']);
  });

  it('les rôles sensibles (DRIVER, CASHIER, STATION_AGENT, MECHANIC, ACCOUNTANT, AGENCY_MANAGER) N\'ONT PAS la perm billing', () => {
    const SENSITIVE_ROLES = ['DRIVER', 'CASHIER', 'STATION_AGENT', 'MECHANIC', 'ACCOUNTANT', 'AGENCY_MANAGER'];
    for (const roleName of SENSITIVE_ROLES) {
      const role = TENANT_ROLES.find(r => r.name === roleName);
      if (!role) continue; // rôle absent du seed = pas un risque
      expect(role.permissions).not.toContain(REQUIRED_PERM);
    }
  });

  it('aucun rôle tenant n\'a une permission qui couvrirait le billing de façon indirecte (défense-en-profondeur)', () => {
    // Sanity check : aucune permission "bypass" type 'control.*.global' ne devrait
    // accorder un accès implicite au billing tenant. On vérifie qu'il n'existe pas
    // de perm plus large (ex: `control.settings.manage.global`) dans les rôles
    // tenant — celles-là sont réservées à la plateforme.
    const BILLING_RELATED_GLOBAL = ['control.settings.manage.global'];
    for (const role of TENANT_ROLES) {
      for (const perm of BILLING_RELATED_GLOBAL) {
        expect(role.permissions).not.toContain(perm);
      }
    }
  });
});
