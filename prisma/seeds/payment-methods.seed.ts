/**
 * Payment Methods Seed — Moyens de paiement par pays
 *
 * Chaque tenant hérite des méthodes de paiement de son `country` (ISO 3166-1 alpha-2).
 * Seed idempotent — upsert sur (countryCode, providerId).
 *
 * Pays supportés :
 *   CG — Congo-Brazzaville (MTN MoMo, Airtel Money, Carte bancaire)
 *   CD — RD Congo (MTN MoMo, Airtel Money, Orange Money, M-Pesa, Carte)
 *   SN — Sénégal (Wave, Orange Money, Free Money, Carte)
 *   CM — Cameroun (MTN MoMo, Orange Money, Carte)
 *   CI — Côte d'Ivoire (MTN MoMo, Orange Money, Moov Money, Wave, Carte)
 *   GA — Gabon (Airtel Money, Moov Money, Carte)
 *   BF — Burkina Faso (Orange Money, Moov Money, Carte)
 *   ML — Mali (Orange Money, Moov Money, Carte)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface PaymentMethodSeed {
  countryCode: string;
  providerId:  string;
  displayName: string;
  type:        string;
  logoUrl:     string | null;
  phonePrefix: string | null;
  sortOrder:   number;
}

const PAYMENT_METHODS: PaymentMethodSeed[] = [
  // ── Congo-Brazzaville (CG) ────────────────────────────────────────────────
  { countryCode: 'CG', providerId: 'mtn_momo',        displayName: 'MTN Mobile Money',  type: 'MOBILE_MONEY', logoUrl: null, phonePrefix: '+242', sortOrder: 1 },
  { countryCode: 'CG', providerId: 'airtel_money',    displayName: 'Airtel Money',      type: 'MOBILE_MONEY', logoUrl: null, phonePrefix: '+242', sortOrder: 2 },
  { countryCode: 'CG', providerId: 'card_visa',       displayName: 'Visa',              type: 'CARD',         logoUrl: null, phonePrefix: null,   sortOrder: 3 },
  { countryCode: 'CG', providerId: 'card_mastercard', displayName: 'Mastercard',        type: 'CARD',         logoUrl: null, phonePrefix: null,   sortOrder: 4 },

  // ── RD Congo (CD) ─────────────────────────────────────────────────────────
  { countryCode: 'CD', providerId: 'mtn_momo',        displayName: 'MTN Mobile Money',  type: 'MOBILE_MONEY', logoUrl: null, phonePrefix: '+243', sortOrder: 1 },
  { countryCode: 'CD', providerId: 'airtel_money',    displayName: 'Airtel Money',      type: 'MOBILE_MONEY', logoUrl: null, phonePrefix: '+243', sortOrder: 2 },
  { countryCode: 'CD', providerId: 'orange_money',    displayName: 'Orange Money',      type: 'MOBILE_MONEY', logoUrl: null, phonePrefix: '+243', sortOrder: 3 },
  { countryCode: 'CD', providerId: 'mpesa',           displayName: 'M-Pesa (Vodacom)', type: 'MOBILE_MONEY', logoUrl: null, phonePrefix: '+243', sortOrder: 4 },
  { countryCode: 'CD', providerId: 'card_visa',       displayName: 'Visa',              type: 'CARD',         logoUrl: null, phonePrefix: null,   sortOrder: 5 },
  { countryCode: 'CD', providerId: 'card_mastercard', displayName: 'Mastercard',        type: 'CARD',         logoUrl: null, phonePrefix: null,   sortOrder: 6 },

  // ── Sénégal (SN) ──────────────────────────────────────────────────────────
  { countryCode: 'SN', providerId: 'wave',            displayName: 'Wave',              type: 'MOBILE_MONEY', logoUrl: null, phonePrefix: '+221', sortOrder: 1 },
  { countryCode: 'SN', providerId: 'orange_money',    displayName: 'Orange Money',      type: 'MOBILE_MONEY', logoUrl: null, phonePrefix: '+221', sortOrder: 2 },
  { countryCode: 'SN', providerId: 'free_money',      displayName: 'Free Money',        type: 'MOBILE_MONEY', logoUrl: null, phonePrefix: '+221', sortOrder: 3 },
  { countryCode: 'SN', providerId: 'card_visa',       displayName: 'Visa',              type: 'CARD',         logoUrl: null, phonePrefix: null,   sortOrder: 4 },
  { countryCode: 'SN', providerId: 'card_mastercard', displayName: 'Mastercard',        type: 'CARD',         logoUrl: null, phonePrefix: null,   sortOrder: 5 },

  // ── Cameroun (CM) ─────────────────────────────────────────────────────────
  { countryCode: 'CM', providerId: 'mtn_momo',        displayName: 'MTN Mobile Money',  type: 'MOBILE_MONEY', logoUrl: null, phonePrefix: '+237', sortOrder: 1 },
  { countryCode: 'CM', providerId: 'orange_money',    displayName: 'Orange Money',      type: 'MOBILE_MONEY', logoUrl: null, phonePrefix: '+237', sortOrder: 2 },
  { countryCode: 'CM', providerId: 'card_visa',       displayName: 'Visa',              type: 'CARD',         logoUrl: null, phonePrefix: null,   sortOrder: 3 },
  { countryCode: 'CM', providerId: 'card_mastercard', displayName: 'Mastercard',        type: 'CARD',         logoUrl: null, phonePrefix: null,   sortOrder: 4 },

  // ── Côte d'Ivoire (CI) ────────────────────────────────────────────────────
  { countryCode: 'CI', providerId: 'mtn_momo',        displayName: 'MTN Mobile Money',  type: 'MOBILE_MONEY', logoUrl: null, phonePrefix: '+225', sortOrder: 1 },
  { countryCode: 'CI', providerId: 'orange_money',    displayName: 'Orange Money',      type: 'MOBILE_MONEY', logoUrl: null, phonePrefix: '+225', sortOrder: 2 },
  { countryCode: 'CI', providerId: 'moov_money',      displayName: 'Moov Money',        type: 'MOBILE_MONEY', logoUrl: null, phonePrefix: '+225', sortOrder: 3 },
  { countryCode: 'CI', providerId: 'wave',            displayName: 'Wave',              type: 'MOBILE_MONEY', logoUrl: null, phonePrefix: '+225', sortOrder: 4 },
  { countryCode: 'CI', providerId: 'card_visa',       displayName: 'Visa',              type: 'CARD',         logoUrl: null, phonePrefix: null,   sortOrder: 5 },
  { countryCode: 'CI', providerId: 'card_mastercard', displayName: 'Mastercard',        type: 'CARD',         logoUrl: null, phonePrefix: null,   sortOrder: 6 },

  // ── Gabon (GA) ────────────────────────────────────────────────────────────
  { countryCode: 'GA', providerId: 'airtel_money',    displayName: 'Airtel Money',      type: 'MOBILE_MONEY', logoUrl: null, phonePrefix: '+241', sortOrder: 1 },
  { countryCode: 'GA', providerId: 'moov_money',      displayName: 'Moov Money',        type: 'MOBILE_MONEY', logoUrl: null, phonePrefix: '+241', sortOrder: 2 },
  { countryCode: 'GA', providerId: 'card_visa',       displayName: 'Visa',              type: 'CARD',         logoUrl: null, phonePrefix: null,   sortOrder: 3 },

  // ── Burkina Faso (BF) ─────────────────────────────────────────────────────
  { countryCode: 'BF', providerId: 'orange_money',    displayName: 'Orange Money',      type: 'MOBILE_MONEY', logoUrl: null, phonePrefix: '+226', sortOrder: 1 },
  { countryCode: 'BF', providerId: 'moov_money',      displayName: 'Moov Money',        type: 'MOBILE_MONEY', logoUrl: null, phonePrefix: '+226', sortOrder: 2 },
  { countryCode: 'BF', providerId: 'card_visa',       displayName: 'Visa',              type: 'CARD',         logoUrl: null, phonePrefix: null,   sortOrder: 3 },

  // ── Mali (ML) ─────────────────────────────────────────────────────────────
  { countryCode: 'ML', providerId: 'orange_money',    displayName: 'Orange Money',      type: 'MOBILE_MONEY', logoUrl: null, phonePrefix: '+223', sortOrder: 1 },
  { countryCode: 'ML', providerId: 'moov_money',      displayName: 'Moov Money',        type: 'MOBILE_MONEY', logoUrl: null, phonePrefix: '+223', sortOrder: 2 },
  { countryCode: 'ML', providerId: 'card_visa',       displayName: 'Visa',              type: 'CARD',         logoUrl: null, phonePrefix: null,   sortOrder: 3 },
];

export async function seedPaymentMethods() {
  console.log('Seeding payment methods…');

  for (const pm of PAYMENT_METHODS) {
    await prisma.paymentMethodConfig.upsert({
      where: {
        countryCode_providerId: {
          countryCode: pm.countryCode,
          providerId:  pm.providerId,
        },
      },
      create: pm,
      update: {
        displayName: pm.displayName,
        type:        pm.type,
        logoUrl:     pm.logoUrl,
        phonePrefix: pm.phonePrefix,
        sortOrder:   pm.sortOrder,
        enabled:     true,
      },
    });
  }

  console.log(`  ✓ ${PAYMENT_METHODS.length} payment methods seeded across ${new Set(PAYMENT_METHODS.map(p => p.countryCode)).size} countries`);
}

// Direct execution
seedPaymentMethods()
  .then(() => prisma.$disconnect())
  .catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
