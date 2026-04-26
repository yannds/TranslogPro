import { PrismaService, wrapPrismaServiceWithTxProxy } from '../../../src/infrastructure/database/prisma.service';
import { TenantContextService } from '../../../src/infrastructure/database/tenant-context.service';

/**
 * Test integration end-to-end de la fondation V6.1 RLS DB-level.
 *
 * Verifie sur une vraie Postgres (testcontainers) :
 *  - `runInTenantTx` ouvre une transaction et y appelle set_config('app.tenant_id', X)
 *  - Le Proxy route `$queryRaw` vers la transaction → la query voit le tenant
 *  - Hors du scope `runInTenantTx`, la connexion ne voit aucun tenant (vide)
 *  - Les acces aux modeles Prisma fonctionnent dans le scope (pas d'erreur d'API)
 *  - Le bind `this = tx` du Proxy ne casse pas l'invocation des methodes raw
 *
 * Ces 4 points couvrent les trous laisses par les tests unit (qui mockent Prisma).
 */
describe('RLS V6.1 — request-scoped tx + set_config (integration vraie DB)', () => {
  const ORIGINAL_FLAG = process.env.TENANT_DB_LEVEL_RLS;
  let prismaReal: PrismaService;
  let prismaProxied: PrismaService;

  beforeAll(async () => {
    process.env.TENANT_DB_LEVEL_RLS = 'on';

    // Stub SecretService : retourne directement le DATABASE_URL injecte
    // par db.setup.ts (testcontainers ou Postgres local en fallback)
    const fakeSecret: any = {
      getSecret: async () => process.env.DATABASE_URL,
    };
    prismaReal = new PrismaService(fakeSecret, new TenantContextService());
    await prismaReal.onModuleInit();
    prismaProxied = wrapPrismaServiceWithTxProxy(prismaReal);
  });

  afterAll(async () => {
    await prismaReal.$disconnect();
    if (ORIGINAL_FLAG === undefined) delete process.env.TENANT_DB_LEVEL_RLS;
    else process.env.TENANT_DB_LEVEL_RLS = ORIGINAL_FLAG;
  });

  it('Proxy != real (kill-switch ON cree bien le wrap)', () => {
    expect(prismaProxied).not.toBe(prismaReal);
  });

  it('Hors runInTenantTx : current_setting(app.tenant_id) est vide', async () => {
    const rows = await prismaProxied.$queryRaw<{ tid: string | null }[]>`
      SELECT current_setting('app.tenant_id', true) AS tid
    `;
    expect(rows[0]?.tid ?? '').toBe('');
  });

  it('Dans runInTenantTx : current_setting(app.tenant_id) = tenantId fourni', async () => {
    let seenTenant: string | null = null;
    await prismaProxied.runInTenantTx('tnt-INTEG-1', async () => {
      const rows = await prismaProxied.$queryRaw<{ tid: string }[]>`
        SELECT current_setting('app.tenant_id', true) AS tid
      `;
      seenTenant = rows[0]?.tid ?? null;
    });
    expect(seenTenant).toBe('tnt-INTEG-1');
  });

  it('Apres runInTenantTx : current_setting redevient vide (tx commit, scope restore)', async () => {
    await prismaProxied.runInTenantTx('tnt-INTEG-2', async () => {
      // tx active, set_config a 'tnt-INTEG-2'
    });
    const rows = await prismaProxied.$queryRaw<{ tid: string | null }[]>`
      SELECT current_setting('app.tenant_id', true) AS tid
    `;
    expect(rows[0]?.tid ?? '').toBe('');
  });

  it('Acces a un modele Prisma dans tx : pas d\'exception, query OK', async () => {
    let queriedOk = false;
    await prismaProxied.runInTenantTx('tnt-INTEG-3', async () => {
      // Tenant n'a pas de field tenantId → $use middleware ne touche rien
      const tenants = await (prismaProxied as any).tenant.findMany({ take: 1, select: { id: true } });
      queriedOk = Array.isArray(tenants);
    });
    expect(queriedOk).toBe(true);
  });

  it('Tx isolees : 2 runInTenantTx en sequence ont chacune leur propre tenantId', async () => {
    let t1: string | null = null;
    let t2: string | null = null;

    await prismaProxied.runInTenantTx('tnt-A', async () => {
      const rows = await prismaProxied.$queryRaw<{ tid: string }[]>`
        SELECT current_setting('app.tenant_id', true) AS tid
      `;
      t1 = rows[0]?.tid ?? null;
    });

    await prismaProxied.runInTenantTx('tnt-B', async () => {
      const rows = await prismaProxied.$queryRaw<{ tid: string }[]>`
        SELECT current_setting('app.tenant_id', true) AS tid
      `;
      t2 = rows[0]?.tid ?? null;
    });

    expect(t1).toBe('tnt-A');
    expect(t2).toBe('tnt-B');
  });

  it('Erreur dans le handler : la tx rollback (set_config visible disparait)', async () => {
    await expect(
      prismaProxied.runInTenantTx('tnt-ERROR', async () => {
        const rows = await prismaProxied.$queryRaw<{ tid: string }[]>`
          SELECT current_setting('app.tenant_id', true) AS tid
        `;
        expect(rows[0]?.tid).toBe('tnt-ERROR');
        throw new Error('handler error');
      }),
    ).rejects.toThrow('handler error');

    // La connexion suivante n'a plus le set_config (tx a rollback)
    const rows = await prismaProxied.$queryRaw<{ tid: string | null }[]>`
      SELECT current_setting('app.tenant_id', true) AS tid
    `;
    expect(rows[0]?.tid ?? '').toBe('');
  });
});
