/**
 * Backfill : alimente `ModuleUsageDaily` depuis les entrées AuditLog
 * historiques, en rejouant le rollup nocturne pour chaque jour de la fenêtre.
 *
 * Usage :
 *   npx ts-node prisma/seeds/module-usage.backfill.ts          # 90 derniers jours
 *   npx ts-node prisma/seeds/module-usage.backfill.ts 30       # 30 derniers jours
 *   npx ts-node prisma/seeds/module-usage.backfill.ts 180      # 180 derniers jours
 *
 * Stratégie :
 *   - Pour chaque jour de la fenêtre [today - N, today) :
 *     - Pour chaque (tenant, moduleKey du registry) :
 *       - Agréger AuditLog (count + distinct userId) via MODULE_ACTION_PREFIXES
 *       - Upsert ModuleUsageDaily par triplet unique (tenantId, moduleKey, date)
 *   - Skip les cellules à actionCount=0 (même comportement que le cron nocturne)
 *   - Skip le tenant plateforme
 *
 * Idempotence : l'upsert sur (tenantId, moduleKey, date) permet de rejouer
 * le backfill sans créer de doublon — il remplace juste la valeur existante
 * par la valeur re-calculée. Zéro effet de bord sur ModuleUsageDaily des jours
 * hors fenêtre.
 *
 * Volume attendu : ~N jours × tenants actifs × 8 modules = ordre ~90 × 10 × 8
 * = 7200 lignes max pour un backfill 90j sur 10 tenants. Trivial pour Postgres.
 */

import { PrismaClient } from '@prisma/client';
import { PLATFORM_TENANT_ID } from './iam.seed';
import { MODULE_ACTION_PREFIXES } from '../../src/modules/platform-kpi/platform-kpi.constants';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfUtcDay(d: Date): Date {
  const r = new Date(d);
  r.setUTCHours(0, 0, 0, 0);
  return r;
}

async function backfillDay(prisma: PrismaClient, dayStart: Date, tenants: Array<{ id: string }>): Promise<number> {
  const dayEnd = new Date(dayStart.getTime() + MS_PER_DAY);
  let written = 0;

  for (const t of tenants) {
    for (const [moduleKey, prefixes] of Object.entries(MODULE_ACTION_PREFIXES)) {
      const whereAction = { OR: prefixes.map((p) => ({ action: { startsWith: p } })) };

      const [actionCount, users] = await Promise.all([
        prisma.auditLog.count({
          where: {
            tenantId:  t.id,
            createdAt: { gte: dayStart, lt: dayEnd },
            ...whereAction,
          },
        }),
        prisma.auditLog.findMany({
          where: {
            tenantId:  t.id,
            createdAt: { gte: dayStart, lt: dayEnd },
            userId:    { not: null },
            ...whereAction,
          },
          select:   { userId: true },
          distinct: ['userId'],
        }),
      ]);

      if (actionCount === 0) continue;

      await prisma.moduleUsageDaily.upsert({
        where:  { tenantId_moduleKey_date: { tenantId: t.id, moduleKey, date: dayStart } },
        update: { actionCount, uniqueUsers: users.length },
        create: { tenantId: t.id, moduleKey, date: dayStart, actionCount, uniqueUsers: users.length },
      });
      written += 1;
    }
  }

  return written;
}

async function main() {
  const prisma = new PrismaClient();
  const periodDays = Number(process.argv[2] ?? 90);
  if (!Number.isFinite(periodDays) || periodDays <= 0 || periodDays > 365) {
    console.error(`[backfill] période invalide: ${process.argv[2]} (attendu 1..365)`);
    process.exit(1);
  }

  const today = startOfUtcDay(new Date());
  const firstDay = new Date(today.getTime() - periodDays * MS_PER_DAY);

  console.log(`[backfill] ModuleUsageDaily — fenêtre ${firstDay.toISOString().slice(0, 10)} → ${today.toISOString().slice(0, 10)} (${periodDays}j)`);

  const tenants = await prisma.tenant.findMany({
    where:  { id: { not: PLATFORM_TENANT_ID }, isActive: true },
    select: { id: true, slug: true },
  });
  console.log(`[backfill] ${tenants.length} tenant(s) à scanner`);
  if (tenants.length === 0) {
    console.log('[backfill] aucun tenant — rien à faire.');
    await prisma.$disconnect();
    return;
  }

  let total = 0;
  for (let i = 0; i < periodDays; i++) {
    const dayStart = new Date(firstDay.getTime() + i * MS_PER_DAY);
    const n = await backfillDay(prisma, dayStart, tenants);
    total += n;
    if (n > 0) {
      console.log(`[backfill] ${dayStart.toISOString().slice(0, 10)} : ${n} ligne(s)`);
    }
  }

  console.log(`[backfill] terminé — ${total} ligne(s) ModuleUsageDaily écrites/mises à jour.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[backfill] erreur fatale :', err);
  process.exit(1);
});
