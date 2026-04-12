#!/usr/bin/env ts-node
/**
 * vault-bootstrap.ts — Initialisation one-shot des secrets Vault pour TransLog Pro.
 *
 * À exécuter UNE SEULE FOIS lors du premier déploiement en production.
 * Idempotent : les clés existantes ne sont PAS écrasées (--force pour forcer).
 *
 * Usage :
 *   ts-node scripts/vault-bootstrap.ts
 *   ts-node scripts/vault-bootstrap.ts --force          # re-génère toutes les clés
 *   ts-node scripts/vault-bootstrap.ts --tenant <id>    # seed une clé HMAC pour un tenant
 *
 * Variables d'environnement requises :
 *   VAULT_ADDR     : URL Vault (ex: http://vault:8200)
 *   VAULT_TOKEN    : Token root ou token avec politique bootstrap
 *
 * JAMAIS committer ce script avec des valeurs en dur.
 * Les valeurs sont générées aléatoirement (cryptographiquement sûres).
 */

import { randomBytes } from 'crypto';
import axios from 'axios';

// ─── Config depuis environment ────────────────────────────────────────────────

const VAULT_ADDR  = process.env['VAULT_ADDR']  ?? 'http://vault:8200';
const VAULT_TOKEN = process.env['VAULT_TOKEN'];
const FORCE       = process.argv.includes('--force');
const TENANT_ARG  = (() => {
  const idx = process.argv.indexOf('--tenant');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

if (!VAULT_TOKEN) {
  console.error('[VAULT] VAULT_TOKEN environment variable is required');
  process.exit(1);
}

// ─── Vault KV v2 helpers ──────────────────────────────────────────────────────

const vault = axios.create({
  baseURL: `${VAULT_ADDR}/v1`,
  headers: { 'X-Vault-Token': VAULT_TOKEN },
  timeout: 10_000,
});

async function secretExists(path: string): Promise<boolean> {
  try {
    await vault.get(`/secret/data/${path}`);
    return true;
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return false;
    throw err;
  }
}

async function putSecret(path: string, data: Record<string, string>): Promise<void> {
  await vault.post(`/secret/data/${path}`, { data });
  console.log(`[VAULT] ✅ Secret écrit : ${path}`);
}

async function upsertSecret(path: string, data: Record<string, string>): Promise<void> {
  if (!FORCE && await secretExists(path)) {
    console.log(`[VAULT] ⏭  Secret déjà présent (skip) : ${path}`);
    return;
  }
  await putSecret(path, data);
}

// ─── Générateurs sécurisés ────────────────────────────────────────────────────

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

function randomBase64(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

// ─── Bootstrap plateforme ────────────────────────────────────────────────────

async function bootstrapPlatformSecrets(): Promise<void> {
  console.log('\n─── Platform secrets ─────────────────────────────────────');

  // Clé HMAC pour les sessions d'impersonation JIT (ImpersonationService)
  await upsertSecret('platform/impersonation_key', {
    KEY: randomHex(32),   // 256 bits — HMAC-SHA256
  });

  // Redis credentials (utilisé par TrackingGateway et DisplayGateway)
  await upsertSecret('platform/redis', {
    HOST:     'redis',
    PORT:     '6379',
    PASSWORD: randomBase64(24),
  });

  // PostgreSQL URL (utilisé par PrismaService)
  await upsertSecret('platform/db', {
    DATABASE_URL: 'postgresql://app_user:app_password@pgbouncer:5432/translog?sslmode=disable',
  });

  // Flutterwave (IPaymentService)
  await upsertSecret('platform/flutterwave', {
    SECRET_KEY:   'FLWSECK_TEST-XXXX',   // Remplacer par la vraie clé en prod
    WEBHOOK_HASH: randomHex(32),          // Hash secret pour validation webhook
  });

  // Paystack (PaystackService — optionnel)
  await upsertSecret('platform/paystack', {
    SECRET_KEY: 'sk_test_XXXX',           // Remplacer par la vraie clé en prod
  });

  // Twilio SMS
  await upsertSecret('platform/sms', {
    ACCOUNT_SID:  'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    AUTH_TOKEN:   'XXXX',
    FROM_NUMBER:  '+33600000000',
  });

  // Twilio WhatsApp
  await upsertSecret('platform/whatsapp', {
    ACCOUNT_SID:  'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    AUTH_TOKEN:   'XXXX',
    FROM_NUMBER:  'whatsapp:+14155238886',   // Sandbox Twilio
  });

  // OpenWeatherMap
  await upsertSecret('platform/openweathermap', {
    API_KEY: 'OPENWEATHERMAP_API_KEY_HERE',
  });

  // Better Auth secret
  await upsertSecret('platform/auth', {
    SECRET:         randomBase64(32),
    JWT_SECRET:     randomBase64(32),
  });

  console.log('\n[VAULT] Platform secrets OK');
}

// ─── Bootstrap tenant HMAC key ───────────────────────────────────────────────

async function bootstrapTenantSecret(tenantId: string): Promise<void> {
  console.log(`\n─── Tenant secrets : ${tenantId} ──────────────────────────`);

  // Clé HMAC pour la signature des QR codes billets (QrService)
  await upsertSecret(`tenants/${tenantId}/hmac`, {
    KEY: randomHex(32),   // 256 bits — HMAC-SHA256 QR codes
  });

  // Clé SMS par tenant (optionnel — fallback sur platform/sms si absent)
  // await upsertSecret(`tenants/${tenantId}/sms`, { ACCOUNT_SID: '...', AUTH_TOKEN: '...', FROM_NUMBER: '...' });

  console.log(`[VAULT] Tenant ${tenantId} secrets OK`);
}

// ─── DB bootstrap (seedTenantRoles + bootstrapPlatform) ──────────────────────

async function bootstrapDatabase(): Promise<void> {
  console.log('\n─── Database bootstrap ──────────────────────────────────');
  console.log('[DB] Running IAM seed...');

  // Import dynamique pour éviter les erreurs si Prisma n'est pas encore disponible
  try {
    const { bootstrapPlatform } = await import('../prisma/seeds/iam.seed');
    await bootstrapPlatform();
    console.log('[DB] ✅ Platform IAM seeded (SUPER_ADMIN, SUPPORT_L1, SUPPORT_L2)');
  } catch (err: unknown) {
    console.error('[DB] ❌ IAM seed failed:', err instanceof Error ? err.message : String(err));
    console.warn('[DB] Assurez-vous que la DB est accessible et que prisma migrate a été exécuté');
  }
}

// ─── Enable Vault KV v2 engine ───────────────────────────────────────────────

async function ensureKvEngine(): Promise<void> {
  try {
    await vault.get('/sys/mounts/secret');
    console.log('[VAULT] KV v2 engine déjà actif sur /secret');
  } catch {
    await vault.post('/sys/mounts/secret', {
      type:    'kv',
      options: { version: '2' },
    });
    console.log('[VAULT] ✅ KV v2 engine activé sur /secret');
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('        TransLog Pro — Vault Bootstrap Script              ');
  console.log(`        Vault: ${VAULT_ADDR}   Force: ${FORCE}            `);
  console.log('═══════════════════════════════════════════════════════════');

  await ensureKvEngine();

  if (TENANT_ARG) {
    // Mode: seed un tenant spécifique uniquement
    await bootstrapTenantSecret(TENANT_ARG);
  } else {
    // Mode: bootstrap complet plateforme
    await bootstrapPlatformSecrets();
    await bootstrapDatabase();

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('✅ Bootstrap terminé. Actions manuelles requises :');
    console.log('   1. Remplacer les clés Flutterwave/Paystack par les vraies valeurs');
    console.log('   2. Remplacer les credentials Twilio par les vrais comptes');
    console.log('   3. Remplacer OPENWEATHERMAP_API_KEY_HERE');
    console.log('   4. Exécuter: npx prisma migrate deploy');
    console.log('   5. Pour chaque tenant: ts-node scripts/vault-bootstrap.ts --tenant <id>');
    console.log('═══════════════════════════════════════════════════════════\n');
  }
}

main().catch(err => {
  console.error('[VAULT] Bootstrap failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
