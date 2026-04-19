/**
 * hmac-keys.backfill.ts
 *
 * Garantit qu'un secret HMAC existe dans Vault pour chaque tenant en DB.
 *
 * Contexte : les tenants créés via `TenantService.createTenant()` ou
 * `OnboardingService.finalize()` reçoivent automatiquement leur clé HMAC à
 * `tenants/{id}/hmac`. Les tenants seedés directement (dev.seed.ts) n'ont
 * jamais eu cette étape → QR scan → 500 (Vault secret read failed).
 *
 * Idempotent : si la clé existe déjà et fait ≥32 caractères, on la laisse
 * (jamais de rotation — cela invaliderait tous les QR déjà émis).
 *
 * Usage : npx ts-node prisma/seeds/hmac-keys.backfill.ts
 */

import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as vault from 'node-vault';
import 'dotenv/config';

async function run() {
  const vaultAddr = process.env.VAULT_ADDR;
  if (!vaultAddr) {
    console.error('VAULT_ADDR env required');
    process.exit(1);
  }

  const vaultFactory = ((vault as unknown as { default?: typeof vault }).default ?? vault) as unknown as (...args: unknown[]) => {
    read:  (path: string) => Promise<{ data: { data: Record<string, string> } }>;
    write: (path: string, data: { data: Record<string, string> }) => Promise<unknown>;
  };
  const client = vaultFactory({
    apiVersion: 'v1',
    endpoint:   vaultAddr,
    token:      process.env.VAULT_TOKEN,
  });

  const prisma = new PrismaClient();
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true } });

  let created = 0;
  let skipped = 0;
  let failed  = 0;
  const errors: Array<{ tenantId: string; error: string }> = [];

  for (const tenant of tenants) {
    const path = `tenants/${tenant.id}/hmac`;
    let exists = false;
    try {
      const result = await client.read(`secret/data/${path}`);
      const key = result?.data?.data?.KEY;
      if (key && String(key).length >= 32) exists = true;
    } catch {
      exists = false;
    }

    if (exists) {
      skipped += 1;
      continue;
    }

    const hmacKey = randomBytes(32).toString('hex');
    try {
      await client.write(`secret/data/${path}`, { data: { KEY: hmacKey } });
      console.log(`[hmac-backfill] provisioned tenant=${tenant.slug} (${tenant.id})`);
      created += 1;
    } catch (err) {
      failed += 1;
      errors.push({ tenantId: tenant.id, error: (err as Error)?.message ?? String(err) });
      console.error(`[hmac-backfill] FAILED tenant=${tenant.slug}: ${(err as Error)?.message ?? err}`);
    }
  }

  console.log('[hmac-backfill] Terminé :', { scanned: tenants.length, created, skipped, failed });
  if (failed > 0) {
    console.error('[hmac-backfill] Erreurs :', JSON.stringify(errors, null, 2));
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

run().catch(err => {
  console.error('[hmac-backfill] Erreur fatale :', err);
  process.exit(1);
});
