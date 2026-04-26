import { PrismaService, wrapPrismaServiceWithTxProxy } from '../../../src/infrastructure/database/prisma.service';
import { TenantTxStorage } from '../../../src/infrastructure/database/tenant-tx.storage';

/**
 * Verifie le comportement du Proxy `wrapPrismaServiceWithTxProxy` :
 *  - kill-switch OFF (default) : retourne l'instance reelle, aucun proxy
 *  - kill-switch ON + tx active dans TenantTxStorage : routes les modeles vers la tx
 *  - kill-switch ON + pas de tx : routes vers l'instance reelle
 *  - methodes infrastructurelles ($transaction, $connect, withTenant…) toujours
 *    sur l'instance reelle quel que soit le flag
 */
describe('wrapPrismaServiceWithTxProxy', () => {
  const mkRealStub = () => {
    const findManyReal = jest.fn().mockResolvedValue([{ id: 'real' }]);
    const $transactionReal = jest.fn();
    const real: any = Object.create(PrismaService.prototype);
    real.user = { findMany: findManyReal };
    real.$transaction = $transactionReal;
    real.runInTenantTx = jest.fn();
    return { real, findManyReal, $transactionReal };
  };

  const mkTxStub = () => {
    const findManyTx = jest.fn().mockResolvedValue([{ id: 'tx' }]);
    const tx: any = { user: { findMany: findManyTx } };
    return { tx, findManyTx };
  };

  afterEach(() => {
    delete process.env.TENANT_DB_LEVEL_RLS;
  });

  it('kill-switch OFF (defaut) : retourne l\'instance reelle directement', () => {
    const { real } = mkRealStub();
    const wrapped = wrapPrismaServiceWithTxProxy(real);
    expect(wrapped).toBe(real);
  });

  it('kill-switch OFF : meme avec tx active, route vers reel', async () => {
    process.env.TENANT_DB_LEVEL_RLS = 'off';
    const { real, findManyReal } = mkRealStub();
    const { tx, findManyTx } = mkTxStub();
    const wrapped = wrapPrismaServiceWithTxProxy(real);

    await TenantTxStorage.run(tx, async () => {
      await (wrapped as any).user.findMany();
    });
    expect(findManyReal).toHaveBeenCalled();
    expect(findManyTx).not.toHaveBeenCalled();
  });

  it('kill-switch ON + tx active : route les modeles vers la tx', async () => {
    process.env.TENANT_DB_LEVEL_RLS = 'on';
    const { real, findManyReal } = mkRealStub();
    const { tx, findManyTx } = mkTxStub();
    const wrapped = wrapPrismaServiceWithTxProxy(real);

    await TenantTxStorage.run(tx, async () => {
      await (wrapped as any).user.findMany();
    });
    expect(findManyTx).toHaveBeenCalled();
    expect(findManyReal).not.toHaveBeenCalled();
  });

  it('kill-switch ON + pas de tx : route vers l\'instance reelle', async () => {
    process.env.TENANT_DB_LEVEL_RLS = 'on';
    const { real, findManyReal } = mkRealStub();
    const { findManyTx } = mkTxStub();
    const wrapped = wrapPrismaServiceWithTxProxy(real);

    await (wrapped as any).user.findMany();
    expect(findManyReal).toHaveBeenCalled();
    expect(findManyTx).not.toHaveBeenCalled();
  });

  it('kill-switch ON : $transaction toujours sur l\'instance reelle', () => {
    process.env.TENANT_DB_LEVEL_RLS = 'on';
    const { real, $transactionReal } = mkRealStub();
    const { tx } = mkTxStub();
    (tx as any).$transaction = jest.fn(); // tx.$transaction existe aussi
    const wrapped = wrapPrismaServiceWithTxProxy(real);

    TenantTxStorage.run(tx, async () => {
      // Acces a $transaction → doit etre sur real, pas sur tx
      expect((wrapped as any).$transaction).toBe($transactionReal);
    });
  });

  it('kill-switch ON : runInTenantTx toujours sur l\'instance reelle', async () => {
    process.env.TENANT_DB_LEVEL_RLS = 'on';
    const { real } = mkRealStub();
    const wrapped = wrapPrismaServiceWithTxProxy(real);
    expect((wrapped as any).runInTenantTx).toBe(real.runInTenantTx);
  });
});
