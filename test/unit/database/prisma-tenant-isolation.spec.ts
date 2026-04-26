import { PrismaService } from '../../../src/infrastructure/database/prisma.service';
import { TenantContextService } from '../../../src/infrastructure/database/tenant-context.service';

/**
 * Verifie que le middleware Prisma $use injecte automatiquement le tenantId
 * pour les modeles tenant-scoped et qu'il respecte les overrides explicites.
 *
 * On instancie le PrismaService sans passer par onModuleInit() (qui ouvre une
 * connexion DB et lit Vault). On installe manuellement le middleware via la
 * methode privee, on remplace $use par un capteur de callback, puis on
 * exerce le callback avec des params synthetiques.
 */
describe('PrismaService — middleware isolation tenant ($use)', () => {
  let captured: ((params: any, next: (p: any) => Promise<any>) => Promise<any>) | null = null;
  let svc: PrismaService;

  beforeAll(() => {
    svc = Object.create(PrismaService.prototype) as PrismaService;
    (svc as any).logger = { log: () => {} };
    (svc as any).tenantScopedModels = new Set(['Ticket', 'Parcel', 'Customer', 'User', 'AuditLog']);
    (svc as any).$use = (cb: any) => {
      captured = cb;
    };
    (svc as any).installTenantIsolationMiddleware();
    if (!captured) throw new Error('middleware non installe');
  });

  const runMw = async (params: any, ctx?: { tenantId: string }) => {
    let nextParams: any = null;
    const next = async (p: any) => {
      nextParams = p;
      return { ok: true };
    };
    if (ctx) {
      await TenantContextService.run(ctx, async () => captured!(params, next));
    } else {
      await captured!(params, next);
    }
    return nextParams;
  };

  it('passe-through si le modele n\'est pas tenant-scoped', async () => {
    const params = { model: 'PlatformConfig', action: 'findMany', args: {} };
    const out = await runMw(params, { tenantId: 'tnt-1' });
    expect(out.args).toEqual({});
  });

  it('passe-through si pas de contexte tenant (signup, health, …)', async () => {
    const params = { model: 'Ticket', action: 'findMany', args: {} };
    const out = await runMw(params);
    expect(out.args).toEqual({});
  });

  it('injecte where.tenantId sur findMany', async () => {
    const params = { model: 'Ticket', action: 'findMany', args: { where: { status: 'PAID' } } };
    const out = await runMw(params, { tenantId: 'tnt-1' });
    expect(out.args.where).toEqual({ status: 'PAID', tenantId: 'tnt-1' });
  });

  it('respecte un where.tenantId explicite (override admin cross-tenant)', async () => {
    const params = {
      model: 'Ticket',
      action: 'findMany',
      args: { where: { tenantId: 'tnt-OTHER' } },
    };
    const out = await runMw(params, { tenantId: 'tnt-1' });
    expect(out.args.where.tenantId).toBe('tnt-OTHER');
  });

  it('injecte where.tenantId sur updateMany / deleteMany / count / aggregate / groupBy', async () => {
    for (const action of ['updateMany', 'deleteMany', 'count', 'aggregate', 'groupBy']) {
      const out = await runMw({ model: 'Parcel', action, args: {} }, { tenantId: 'tnt-2' });
      expect(out.args.where).toEqual({ tenantId: 'tnt-2' });
    }
  });

  it('injecte data.tenantId sur create', async () => {
    const params = { model: 'Parcel', action: 'create', args: { data: { code: 'ABC' } } };
    const out = await runMw(params, { tenantId: 'tnt-3' });
    expect(out.args.data).toEqual({ code: 'ABC', tenantId: 'tnt-3' });
  });

  it('injecte data.tenantId sur createMany (array)', async () => {
    const params = {
      model: 'Customer',
      action: 'createMany',
      args: { data: [{ name: 'a' }, { name: 'b', tenantId: 'tnt-FORCED' }] },
    };
    const out = await runMw(params, { tenantId: 'tnt-4' });
    expect(out.args.data[0]).toEqual({ name: 'a', tenantId: 'tnt-4' });
    expect(out.args.data[1].tenantId).toBe('tnt-FORCED');
  });

  it('injecte where + create sur upsert', async () => {
    const params = {
      model: 'Customer',
      action: 'upsert',
      args: {
        where: { email: 'a@b.c' },
        create: { name: 'A', email: 'a@b.c' },
        update: { name: 'A2' },
      },
    };
    const out = await runMw(params, { tenantId: 'tnt-5' });
    expect(out.args.where.tenantId).toBe('tnt-5');
    expect(out.args.create.tenantId).toBe('tnt-5');
  });

  it('respecte data.tenantId explicite sur create', async () => {
    const params = {
      model: 'Ticket',
      action: 'create',
      args: { data: { tenantId: 'tnt-FORCED', label: 'X' } },
    };
    const out = await runMw(params, { tenantId: 'tnt-6' });
    expect(out.args.data.tenantId).toBe('tnt-FORCED');
  });

  it('injecte where.tenantId sur findUnique sans args.where existant', async () => {
    const params = { model: 'Ticket', action: 'findUnique', args: {} };
    const out = await runMw(params, { tenantId: 'tnt-7' });
    expect(out.args.where).toEqual({ tenantId: 'tnt-7' });
  });

  // ─── Regression guards ────────────────────────────────────────────────────

  it('REG R1 — clé composite tenantId_email : injection top-level coherente', async () => {
    // Reproduit auth-identity.service.ts:101 : findUnique avec composite key.
    // Le middleware doit injecter tenantId au top-level SANS abimer la composite.
    // Prisma 5+ accepte le mix (composite + filtre supplementaire) si valeurs alignees.
    const params = {
      model: 'User',
      action: 'findUnique',
      args: { where: { tenantId_email: { tenantId: 'tnt-X', email: 'a@b.c' } } },
    };
    const out = await runMw(params, { tenantId: 'tnt-X' });
    expect(out.args.where.tenantId_email).toEqual({ tenantId: 'tnt-X', email: 'a@b.c' });
    expect(out.args.where.tenantId).toBe('tnt-X');
  });

  it('REG R2 — groupBy avec tenantId already in where (operator not) : pas de surcharge', async () => {
    // Reproduit platform-kpi.service.ts:898 : groupBy by tenantId, where avec operator.
    const params = {
      model: 'AuditLog',
      action: 'groupBy',
      args: {
        by:    ['tenantId'],
        where: { tenantId: { not: 'platform' } },
      },
    };
    const out = await runMw(params, { tenantId: 'tnt-1' });
    expect(out.args.where.tenantId).toEqual({ not: 'platform' });
    expect(out.args.by).toEqual(['tenantId']);
  });

  it('REG R3 — modele non-tenant-scoped (PlatformConfig) : aucune injection', async () => {
    const params = { model: 'PlatformConfig', action: 'findMany', args: { where: { key: 'x' } } };
    const out = await runMw(params, { tenantId: 'tnt-1' });
    expect(out.args.where).toEqual({ key: 'x' });
  });

  it('REG — auth-flow sans contexte HTTP (login pre-auth) : aucune injection', async () => {
    // Login appelle findUserByEmail AVANT que RlsMiddleware ait peuple le contexte.
    const params = {
      model: 'User',
      action: 'findUnique',
      args: { where: { tenantId_email: { tenantId: 'tnt-X', email: 'a@b.c' } } },
    };
    const out = await runMw(params); // pas de contexte
    expect(out.args.where.tenantId).toBeUndefined();
    expect(out.args.where.tenantId_email).toEqual({ tenantId: 'tnt-X', email: 'a@b.c' });
  });

  it('REG — kill-switch desactive le middleware quand TENANT_ISOLATION_MIDDLEWARE=off', async () => {
    // Verifie le code path explicit — onModuleInit ne reinstalle pas si flag off.
    const original = process.env.TENANT_ISOLATION_MIDDLEWARE;
    process.env.TENANT_ISOLATION_MIDDLEWARE = 'off';
    try {
      const fakeSvc: any = Object.create(PrismaService.prototype);
      fakeSvc.logger = { log: jest.fn(), warn: jest.fn() };
      fakeSvc.tenantScopedModels = new Set(['Ticket']);
      fakeSvc.$use = jest.fn();
      fakeSvc.$connect = jest.fn().mockResolvedValue(undefined);
      fakeSvc.secretService = {
        getSecret: jest.fn().mockResolvedValue('postgresql://stub'),
      };
      fakeSvc._engineConfig = {};

      await fakeSvc.onModuleInit();
      expect(fakeSvc.$use).not.toHaveBeenCalled();
      expect(fakeSvc.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('DESACTIVE'),
      );
    } finally {
      if (original === undefined) delete process.env.TENANT_ISOLATION_MIDDLEWARE;
      else process.env.TENANT_ISOLATION_MIDDLEWARE = original;
    }
  });
});
