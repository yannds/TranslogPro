import { firstValueFrom, of } from 'rxjs';
import { TenantTxInterceptor } from '../../../src/infrastructure/database/tenant-tx.interceptor';
import { TenantContextService } from '../../../src/infrastructure/database/tenant-context.service';

/**
 * Verifie que le TenantTxInterceptor :
 *  - kill-switch OFF : ne touche pas le handler (pass-through)
 *  - kill-switch ON sans contexte tenant : pass-through (login, signup, public)
 *  - kill-switch ON avec contexte tenant : appelle runInTenantTx avec le bon
 *    tenantId et propage la valeur du handler
 */
describe('TenantTxInterceptor', () => {
  const mkPrismaStub = () => ({
    runInTenantTx: jest.fn(async (_tenantId: string, fn: () => Promise<any>) => fn()),
  });

  const mkCallHandler = (value: unknown) => ({ handle: () => of(value) });

  afterEach(() => {
    delete process.env.TENANT_DB_LEVEL_RLS;
  });

  it('kill-switch OFF : ne touche pas le handler', async () => {
    const prisma: any = mkPrismaStub();
    const interceptor = new TenantTxInterceptor(prisma);
    const result$ = interceptor.intercept({} as any, mkCallHandler('handler-result') as any);

    const value = await firstValueFrom(result$);
    expect(value).toBe('handler-result');
    expect(prisma.runInTenantTx).not.toHaveBeenCalled();
  });

  it('kill-switch ON sans contexte tenant : pass-through', async () => {
    process.env.TENANT_DB_LEVEL_RLS = 'on';
    const prisma: any = mkPrismaStub();
    const interceptor = new TenantTxInterceptor(prisma);
    const result$ = interceptor.intercept({} as any, mkCallHandler('handler-result') as any);

    const value = await firstValueFrom(result$);
    expect(value).toBe('handler-result');
    expect(prisma.runInTenantTx).not.toHaveBeenCalled();
  });

  it('kill-switch ON + contexte tenant : wrap dans runInTenantTx avec le bon tenantId', async () => {
    process.env.TENANT_DB_LEVEL_RLS = 'on';
    const prisma: any = mkPrismaStub();
    const interceptor = new TenantTxInterceptor(prisma);

    const value = await TenantContextService.run({ tenantId: 'tnt-A' }, async () => {
      const result$ = interceptor.intercept(
        {} as any,
        mkCallHandler('handler-result-A') as any,
      );
      return firstValueFrom(result$);
    });

    expect(value).toBe('handler-result-A');
    expect(prisma.runInTenantTx).toHaveBeenCalledWith('tnt-A', expect.any(Function));
  });
});
