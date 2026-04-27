/**
 * AuthService.toDto() — politique MFA 2026-04-27.
 *
 * Vérifie que le bloc { mustEnrollMfa, suggestedEnrollMfa } retourné par
 * /api/auth/me et /api/auth/sign-in respecte la nouvelle séparation :
 *
 *   - mustEnrollMfa     = staff plateforme (PLATFORM_TENANT_ID + STAFF) sans MFA
 *   - suggestedEnrollMfa = autre staff (TENANT_ADMIN, AGENCY_MANAGER…) sans MFA
 *   - Aucun des deux pour CUSTOMER ou MFA déjà actif
 *
 * Méthode privée `toDto` testée via cast `(svc as any)` — pattern admis pour
 * tester la dérivation de DTO sans monter l'app NestJS.
 */
import { AuthService } from '../../../src/modules/auth/auth.service';

const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';

function makePrismaMock() {
  return {
    staff:   { findFirst: jest.fn().mockResolvedValue(null) },
    tenant:  { findUnique: jest.fn().mockResolvedValue({
      onboardingCompletedAt: null, businessActivity: 'TICKETING', slug: 'acme',
    }) },
    platformSubscription: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    account: { findFirst: jest.fn().mockResolvedValue({ forcePasswordChange: false }) },
    user:    { findUnique: jest.fn().mockResolvedValue(null) },
  };
}

function makeService(prismaMock: any) {
  const modulesMock = { listActiveKeys: jest.fn().mockResolvedValue(['TICKETING']) };
  return new AuthService(
    prismaMock as any,
    modulesMock as any,
    {} as any,            // mfa — non utilisé par toDto
    {} as any,            // identity
    {} as any,            // turnstile
    {} as any,            // redis
  );
}

const baseUser = {
  id: 'u-1', email: 'admin@acme.test', name: 'Admin',
  tenantId: 'tenant-acme', roleId: 'role-1', userType: 'STAFF',
  mfaEnabled: false,
  preferences: {},
  role: { name: 'TENANT_ADMIN', permissions: [
    { permission: 'control.iam.manage.tenant' },
    { permission: 'control.iam.audit.tenant' },
  ] },
};

describe('AuthService.toDto — politique MFA 2026-04-27', () => {
  it("staff TENANT (TENANT_ADMIN) sans MFA → suggestedEnrollMfa=true, mustEnrollMfa=false", async () => {
    const svc = makeService(makePrismaMock());
    const dto = await (svc as any).toDto(baseUser);
    expect(dto.mustEnrollMfa).toBe(false);
    expect(dto.suggestedEnrollMfa).toBe(true);
  });

  it("staff PLATEFORME (SUPER_ADMIN) sans MFA → mustEnrollMfa=true, suggestedEnrollMfa=false", async () => {
    const svc = makeService(makePrismaMock());
    const dto = await (svc as any).toDto({
      ...baseUser,
      tenantId: PLATFORM_TENANT_ID,
      role: { name: 'SUPER_ADMIN', permissions: [{ permission: 'control.tenant.manage.global' }] },
    });
    expect(dto.mustEnrollMfa).toBe(true);
    expect(dto.suggestedEnrollMfa).toBe(false);
  });

  it("staff PLATEFORME avec MFA déjà actif → ni mustEnrollMfa ni suggestedEnrollMfa", async () => {
    const svc = makeService(makePrismaMock());
    const dto = await (svc as any).toDto({
      ...baseUser,
      tenantId: PLATFORM_TENANT_ID,
      mfaEnabled: true,
    });
    expect(dto.mustEnrollMfa).toBe(false);
    expect(dto.suggestedEnrollMfa).toBe(false);
  });

  it("staff TENANT avec MFA actif → ni mustEnrollMfa ni suggestedEnrollMfa", async () => {
    const svc = makeService(makePrismaMock());
    const dto = await (svc as any).toDto({ ...baseUser, mfaEnabled: true });
    expect(dto.mustEnrollMfa).toBe(false);
    expect(dto.suggestedEnrollMfa).toBe(false);
  });

  it("CUSTOMER sans MFA → ni mustEnrollMfa ni suggestedEnrollMfa (notif jamais envoyée)", async () => {
    const svc = makeService(makePrismaMock());
    const dto = await (svc as any).toDto({
      ...baseUser, userType: 'CUSTOMER',
      role: { name: 'CUSTOMER', permissions: [] },
    });
    expect(dto.mustEnrollMfa).toBe(false);
    expect(dto.suggestedEnrollMfa).toBe(false);
  });

  it("staff TENANT avec rôle simple (CASHIER, sans permission haut-privilège) → suggestedEnrollMfa=true (politique 2026-04-27 : la suggestion ne dépend plus des permissions)", async () => {
    const svc = makeService(makePrismaMock());
    const dto = await (svc as any).toDto({
      ...baseUser,
      role: { name: 'CASHIER', permissions: [{ permission: 'data.ticket.create.own' }] },
    });
    expect(dto.mustEnrollMfa).toBe(false);
    expect(dto.suggestedEnrollMfa).toBe(true);
  });
});
