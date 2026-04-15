/**
 * Migration data — VOYAGEUR → CUSTOMER
 *
 * Étapes :
 *   1. User.userType = 'VOYAGEUR' → 'CUSTOMER'
 *   2. Pour chaque tenant ayant un rôle 'VOYAGEUR' :
 *      a. Si un rôle 'CUSTOMER' existe déjà (seed re-tourné), MERGE :
 *         - users du VOYAGEUR rebranchés vers CUSTOMER
 *         - rolePermission du VOYAGEUR supprimées (CUSTOMER déjà seedé avec
 *           les bonnes perms)
 *         - role VOYAGEUR supprimé
 *      b. Sinon, simple RENAME : VOYAGEUR.name = 'CUSTOMER'
 *
 * Idempotent : rejouable sans effet de bord.
 * Transactionnel par tenant (limite le blast radius en cas d'erreur).
 *
 * Exécution : npx ts-node prisma/seeds/migrate-voyageur-to-customer.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Migration VOYAGEUR → CUSTOMER …');

  // 1. User.userType — sans contrainte d'unicité, simple updateMany
  const usersUpdated = await prisma.user.updateMany({
    where: { userType: 'VOYAGEUR' },
    data:  { userType: 'CUSTOMER' },
  });
  console.log(`✅ Users   : ${usersUpdated.count} userType migrés`);

  // 2. Role — par tenant (contrainte unique tenantId+name)
  const legacyRoles = await prisma.role.findMany({
    where:  { name: 'VOYAGEUR' },
    select: { id: true, tenantId: true },
  });

  let renamed = 0;
  let merged  = 0;
  let usersRebound = 0;

  for (const legacy of legacyRoles) {
    const existingCustomer = await prisma.role.findUnique({
      where: { tenantId_name: { tenantId: legacy.tenantId, name: 'CUSTOMER' } },
    });

    if (!existingCustomer) {
      // Cas A : pas de CUSTOMER → simple rename
      await prisma.role.update({
        where: { id: legacy.id },
        data:  { name: 'CUSTOMER' },
      });
      renamed++;
      continue;
    }

    // Cas B : merge — rebranche users + supprime rolePermission + supprime VOYAGEUR
    await prisma.$transaction(async (tx) => {
      const reb = await tx.user.updateMany({
        where: { roleId: legacy.id },
        data:  { roleId: existingCustomer.id },
      });
      usersRebound += reb.count;

      await tx.rolePermission.deleteMany({ where: { roleId: legacy.id } });
      await tx.role.delete({ where: { id: legacy.id } });
    });
    merged++;
  }

  console.log(`✅ Rôles   : ${renamed} renommés, ${merged} mergés vers CUSTOMER existant`);
  console.log(`✅ Users   : ${usersRebound} ré-attachés au rôle CUSTOMER`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
