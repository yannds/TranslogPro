/**
 * Backfill — Caisses VIRTUELLES par agence (CashRegister.kind='VIRTUAL').
 *
 * Provisionne pour chaque agence existante sa caisse système si absente.
 * Idempotent : n'écrit que les caisses manquantes, skip celles déjà présentes.
 *
 * Usage :
 *   npx ts-node prisma/seeds/virtual-register.backfill.ts
 *
 * Invariant :
 *   - Une seule caisse VIRTUAL par (tenantId, agencyId).
 *   - Toujours status='OPEN', agentId='SYSTEM', initialBalance=0.
 *   - Exclue du cycle open/close (jamais fermable, pas de discrepancy).
 *
 * Contexte : introduit pour supporter les side-effects comptables sans
 * session caissier humain — voucher redeem self-service, refund.process,
 * paiement en ligne. Cf. ADR-15 (workflow-driven) + commentaire CashRegister
 * dans prisma/schema.prisma.
 */
import { PrismaClient } from '@prisma/client';
import { backfillVirtualRegisters } from './iam.seed';

async function main() {
  const prisma = new PrismaClient();
  try {
    // eslint-disable-next-line no-console
    console.log('[backfill] Virtual cash registers — scan agencies…');
    const result = await backfillVirtualRegisters(prisma);
    // eslint-disable-next-line no-console
    console.log(
      `[backfill] Done — ${result.agenciesScanned} agences scannées, ` +
      `${result.virtualsCreated} caisses virtuelles créées.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[backfill] ERROR', err);
  process.exit(1);
});
