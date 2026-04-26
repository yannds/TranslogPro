import { TenantIamService } from '../../../src/modules/tenant-iam/tenant-iam.service';

/**
 * Tests reset MFA tenant — couvrent :
 *   - SÉCURITÉ : findFirst toujours scopé par tenantId (pas de cross-tenant)
 *   - 404 si user introuvable dans le tenant
 *   - clear mfaSecret + mfaBackupCodes + mfaEnabled + mfaVerifiedAt
 *   - delete sessions du user (force re-login)
 *   - audit log level=warn avec action 'control.iam.user.reset-mfa.tenant'
 */
describe('TenantIamService.resetUserMfa', () => {
  let prismaMock: any;
  let svc: TenantIamService;

  beforeEach(() => {
    prismaMock = {
      user: {
        findFirst: jest.fn(),
        update:    jest.fn().mockResolvedValue({}),
      },
      session: {
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockImplementation(async (fn: any) => fn(prismaMock)),
    };
    svc = new TenantIamService(prismaMock, null as any);
  });

  it('SÉCURITÉ : findFirst scopé par tenantId', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: 'U1', email: 'a@b.c', mfaEnabled: true,
    });
    await svc.resetUserMfa('TENANT-A', 'U1', 'ACTOR-1');
    expect(prismaMock.user.findFirst.mock.calls[0][0].where).toEqual({
      id: 'U1', tenantId: 'TENANT-A',
    });
  });

  it('404 si user pas dans le tenant (cross-tenant block)', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce(null);
    await expect(svc.resetUserMfa('TENANT-A', 'U1', 'ACTOR-1'))
      .rejects.toThrow(/introuvable/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.session.deleteMany).not.toHaveBeenCalled();
  });

  it('clear tous les champs MFA + sessions', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: 'U1', email: 'a@b.c', mfaEnabled: true,
    });
    await svc.resetUserMfa('TENANT-A', 'U1', 'ACTOR-1');

    const updateCall = prismaMock.user.update.mock.calls[0][0];
    expect(updateCall.where.id).toBe('U1');
    expect(updateCall.data).toEqual({
      mfaEnabled:     false,
      mfaSecret:      null,
      mfaBackupCodes: [],
      mfaVerifiedAt:  null,
    });
    expect(prismaMock.session.deleteMany.mock.calls[0][0].where).toEqual({
      userId: 'U1', tenantId: 'TENANT-A',
    });
  });

  it('audit log level=warn + action control.iam.user.reset-mfa.tenant', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: 'U1', email: 'a@b.c', mfaEnabled: true,
    });
    await svc.resetUserMfa('TENANT-A', 'U1', 'ACTOR-1');

    const auditArgs = prismaMock.auditLog.create.mock.calls[0][0].data;
    expect(auditArgs.action).toBe('control.iam.user.reset-mfa.tenant');
    expect(auditArgs.level).toBe('warn');
    expect(auditArgs.tenantId).toBe('TENANT-A');
    expect(auditArgs.userId).toBe('ACTOR-1');
    expect(auditArgs.resource).toBe('User:U1');
  });

  it('audit log même si user.mfaEnabled était déjà false (idempotent)', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: 'U1', email: 'a@b.c', mfaEnabled: false,
    });
    await svc.resetUserMfa('TENANT-A', 'U1', 'ACTOR-1');
    expect(prismaMock.auditLog.create).toHaveBeenCalled();
    const auditArgs = prismaMock.auditLog.create.mock.calls[0][0].data;
    expect(auditArgs.oldValue).toEqual({ mfaWasEnabled: false, email: 'a@b.c' });
  });
});
