/**
 * Payment Config Seed — initialise la plomberie paiement :
 *   1. PlatformPaymentConfig : singleton (id='singleton')
 *   2. TenantPaymentConfig   : une ligne par tenant existant (valeurs par défaut)
 *   3. PaymentProviderState  : lignes plateforme (tenantId=null) pour chaque
 *      connecteur prévu, toutes en mode DISABLED par défaut — aucune activation
 *      implicite. Un SA plateforme devra les basculer en SANDBOX depuis l'UI.
 *
 * Idempotent. Sûr à ré-exécuter après ajout d'un nouveau provider.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ProviderSeed {
  providerKey:         string;
  displayName:         string;
  vaultPath:           string;
  supportedMethods:    string[];
  supportedCountries:  string[];
  supportedCurrencies: string[];
  notes:               string;
}

const PROVIDERS: ProviderSeed[] = [
  {
    providerKey:  'mtn_momo_cg',
    displayName:  'MTN MoMo Congo',
    vaultPath:    'platform/payments/mtn_momo_cg',
    supportedMethods:    ['MOBILE_MONEY'],
    supportedCountries:  ['CG'],
    supportedCurrencies: ['XAF'],
    notes: 'MTN MoMo Collection + Disbursement (sandbox momodeveloper.mtn.com).',
  },
  {
    providerKey:  'airtel_cg',
    displayName:  'Airtel Money Congo',
    vaultPath:    'platform/payments/airtel_cg',
    supportedMethods:    ['MOBILE_MONEY'],
    supportedCountries:  ['CG'],
    supportedCurrencies: ['XAF'],
    notes: 'Airtel Africa API — Collection + Disbursement (refund = push sortant).',
  },
  {
    providerKey:  'wave',
    displayName:  'Wave',
    vaultPath:    'platform/payments/wave',
    supportedMethods:    ['MOBILE_MONEY'],
    supportedCountries:  ['SN', 'CI', 'ML', 'BF'],
    supportedCurrencies: ['XOF'],
    notes: 'Wave Business API — paiement in/out.',
  },
  {
    providerKey:  'flutterwave_agg',
    displayName:  'Flutterwave (Aggregator)',
    vaultPath:    'platform/payments/flutterwave_agg',
    supportedMethods:    ['MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'USSD'],
    supportedCountries:  ['CG', 'CD', 'SN', 'CI', 'CM', 'GA', 'BF', 'ML', 'NG', 'GH', 'KE'],
    supportedCurrencies: ['XAF', 'XOF', 'NGN', 'GHS', 'KES', 'USD'],
    notes: 'Agrégateur multi-méthodes toute Afrique sub-saharienne. Cartes Visa/MC via hosted page (PCI SAQ-A).',
  },
  {
    providerKey:  'paystack_agg',
    displayName:  'Paystack (Aggregator)',
    vaultPath:    'platform/payments/paystack_agg',
    supportedMethods:    ['CARD', 'BANK_TRANSFER', 'MOBILE_MONEY'],
    supportedCountries:  ['NG', 'GH', 'ZA', 'KE'],
    supportedCurrencies: ['NGN', 'GHS', 'KES', 'ZAR', 'USD'],
    notes: 'Fallback Nigeria/Ghana/Kenya/SA.',
  },
  {
    providerKey:  'stripe_cards',
    displayName:  'Stripe (Cards — Europe/US)',
    vaultPath:    'platform/payments/stripe_cards',
    supportedMethods:    ['CARD'],
    supportedCountries:  ['FR', 'BE', 'DE', 'ES', 'PT', 'US', 'CA', 'GB'],
    supportedCurrencies: ['EUR', 'USD', 'GBP', 'CAD'],
    notes: 'Non disponible en Afrique sub-saharienne — cartes en zone XAF/XOF passent par flutterwave_agg.',
  },
];

async function seedPlatformPaymentConfig() {
  await prisma.platformPaymentConfig.upsert({
    where:  { id: 'singleton' },
    create: { id: 'singleton' },
    update: {},
  });
  console.log('[payment-config.seed] PlatformPaymentConfig singleton OK');
}

async function seedTenantPaymentConfigs() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, currency: true } });
  let count = 0;
  for (const tenant of tenants) {
    await prisma.tenantPaymentConfig.upsert({
      where:  { tenantId: tenant.id },
      create: {
        tenantId: tenant.id,
        allowedCurrencies: [tenant.currency],
      },
      update: {},
    });
    count++;
  }
  console.log(`[payment-config.seed] TenantPaymentConfig — ${count} tenant(s)`);
}

async function seedPlatformProviderStates() {
  // Note : on ne peut pas `upsert` sur (tenantId, providerKey) car Postgres
  // considère chaque NULL distinct → l'unicité ne matche jamais pour les lignes
  // plateforme. On utilise findFirst + create/update en deux temps.
  for (const p of PROVIDERS) {
    const existing = await prisma.paymentProviderState.findFirst({
      where: { tenantId: null, providerKey: p.providerKey },
      select: { id: true },
    });
    if (existing) {
      await prisma.paymentProviderState.update({
        where: { id: existing.id },
        // Mode jamais forcé : un SA peut l'avoir basculé en SANDBOX/LIVE.
        data: {
          displayName:         p.displayName,
          vaultPath:           p.vaultPath,
          supportedMethods:    p.supportedMethods,
          supportedCountries:  p.supportedCountries,
          supportedCurrencies: p.supportedCurrencies,
          notes:               p.notes,
        },
      });
    } else {
      await prisma.paymentProviderState.create({
        data: {
          tenantId:            null,
          providerKey:         p.providerKey,
          displayName:         p.displayName,
          mode:                'DISABLED',
          vaultPath:           p.vaultPath,
          supportedMethods:    p.supportedMethods,
          supportedCountries:  p.supportedCountries,
          supportedCurrencies: p.supportedCurrencies,
          notes:               p.notes,
        },
      });
    }
  }
  console.log(`[payment-config.seed] PaymentProviderState — ${PROVIDERS.length} provider(s)`);
}

export async function seedPaymentConfig() {
  console.log('[payment-config.seed] Démarrage…');
  await seedPlatformPaymentConfig();
  await seedTenantPaymentConfigs();
  await seedPlatformProviderStates();
  console.log('[payment-config.seed] Terminé.');
}

if (require.main === module) {
  seedPaymentConfig()
    .catch(err => { console.error('[payment-config.seed] Échec :', err); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
