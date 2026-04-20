/**
 * Vérifie le contrat RBAC sur les endpoints /tenants/:id/settings/taxes :
 *   - GET    : data.tax.read.tenant
 *   - POST   : control.tax.manage.tenant
 *   - PATCH  : control.tax.manage.tenant
 *   - DELETE : control.tax.manage.tenant
 *
 * Et le mapping rôle → permission par défaut dans iam.seed.ts :
 *   - TENANT_ADMIN, AGENCY_MANAGER, ACCOUNTANT  : read + write
 *   - CASHIER                                   : read seul
 *   - DRIVER, AGENT_QUAI, HOSTESS, MECHANIC,
 *     PUBLIC_REPORTER, CUSTOMER, DISPATCHER     : aucune (zéro fuite)
 *
 * Source de vérité runtime : RolePermission DB + PermissionGuard.
 * Ce test garde le contrat compile-time / seed pour empêcher
 * les régressions accidentelles (ex. un dev qui ouvre TAX_MANAGE
 * au CASHIER en mergeant un seed sans relire la matrice).
 */
import 'reflect-metadata';
import { TENANT_ROLES } from '../../../prisma/seeds/iam.seed';
import { TenantSettingsController } from '../../../src/modules/tenant-settings/tenant-settings.controller';
import { PERMISSION_KEY } from '../../../src/common/decorators/require-permission.decorator';

const TAX_READ   = 'data.tax.read.tenant';
const TAX_MANAGE = 'control.tax.manage.tenant';

describe('TenantTax — contrat RBAC', () => {
  describe('Décorateurs @RequirePermission sur le controller', () => {
    const proto = TenantSettingsController.prototype;

    it('GET /taxes exige TAX_READ_TENANT (lecture seule pour caissier)', () => {
      const meta = Reflect.getMetadata(PERMISSION_KEY, proto.listTaxes);
      expect(meta).toBe(TAX_READ);
    });

    it('POST /taxes exige TAX_MANAGE_TENANT', () => {
      const meta = Reflect.getMetadata(PERMISSION_KEY, proto.createTax);
      expect(meta).toBe(TAX_MANAGE);
    });

    it('PATCH /taxes/:id exige TAX_MANAGE_TENANT', () => {
      const meta = Reflect.getMetadata(PERMISSION_KEY, proto.updateTax);
      expect(meta).toBe(TAX_MANAGE);
    });

    it('DELETE /taxes/:id exige TAX_MANAGE_TENANT', () => {
      const meta = Reflect.getMetadata(PERMISSION_KEY, proto.removeTax);
      expect(meta).toBe(TAX_MANAGE);
    });
  });

  describe('Mapping rôle → permission par défaut (iam.seed.ts)', () => {
    function permsOf(roleName: string): string[] {
      const role = TENANT_ROLES.find(r => r.name === roleName);
      if (!role) throw new Error(`Rôle ${roleName} absent du seed`);
      return role.permissions;
    }

    it('TENANT_ADMIN a read + write sur les taxes', () => {
      const perms = permsOf('TENANT_ADMIN');
      expect(perms).toContain(TAX_READ);
      expect(perms).toContain(TAX_MANAGE);
    });

    it('AGENCY_MANAGER (gérant) a read + write sur les taxes', () => {
      const perms = permsOf('AGENCY_MANAGER');
      expect(perms).toContain(TAX_READ);
      expect(perms).toContain(TAX_MANAGE);
    });

    it('ACCOUNTANT (comptable) a read + write sur les taxes', () => {
      const perms = permsOf('ACCOUNTANT');
      expect(perms).toContain(TAX_READ);
      expect(perms).toContain(TAX_MANAGE);
    });

    it('CASHIER (caissier) a read seulement, pas write', () => {
      const perms = permsOf('CASHIER');
      expect(perms).toContain(TAX_READ);
      expect(perms).not.toContain(TAX_MANAGE);
    });

    it.each(['DRIVER', 'HOSTESS', 'MECHANIC', 'AGENT_QUAI', 'CUSTOMER', 'DISPATCHER', 'PUBLIC_REPORTER'])(
      '%s n\'a aucune permission tax (zéro fuite RBAC)',
      (roleName) => {
        const perms = permsOf(roleName);
        expect(perms).not.toContain(TAX_READ);
        expect(perms).not.toContain(TAX_MANAGE);
      },
    );
  });
});
