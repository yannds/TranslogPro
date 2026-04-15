/**
 * Migration data — VOYAGEUR → CUSTOMER
 *
 * Renomme :
 *   • User.userType = 'VOYAGEUR' → 'CUSTOMER'
 *   • Role.name     = 'VOYAGEUR' → 'CUSTOMER' (tous tenants)
 *
 * Idempotent : rejouable sans effet de bord.
 * Transactionnel : tout ou rien.
 *
 * Exécution : npx ts-node prisma/seeds/migrate-voyageur-to-customer.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Migration VOYAGEUR → CUSTOMER …');

  const [usersUpdated, rolesUpdated] = await prisma.$transaction([
    prisma.user.updateMany({
      where: { userType: 'VOYAGEUR' },
      data:  { userType: 'CUSTOMER' },
    }),
    prisma.role.updateMany({
      where: { name: 'VOYAGEUR' },
      data:  { name: 'CUSTOMER' },
    }),
  ]);

  console.log(`✅ Users migrés   : ${usersUpdated.count}`);
  console.log(`✅ Rôles renommés : ${rolesUpdated.count}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
