import {
  computeTaxes,
  computeTaxAmount,
  filterApplicableTaxes,
  TenantTaxInput,
} from '../../../src/core/billing/tax-calculator.service';

/** Fixture TVA 18 % classique. */
const tvaFixture: TenantTaxInput = {
  code:      'TVA',
  label:     'TVA 18%',
  rate:      0.18,
  kind:      'PERCENT',
  base:      'SUBTOTAL',
  appliesTo: ['ALL'],
  sortOrder: 0,
  enabled:   true,
};

/** Fixture timbre fiscal montant fixe. */
const timbreFixture: TenantTaxInput = {
  code:      'TIMBRE',
  label:     'Timbre fiscal',
  rate:      500,
  kind:      'FIXED',
  base:      'SUBTOTAL',
  appliesTo: ['ALL'],
  sortOrder: 10,
  enabled:   true,
};

/** Fixture taxe communale cascade (après TVA). */
const taxeCommunaleCascade: TenantTaxInput = {
  code:      'TAXE_COMMUNALE',
  label:     'Taxe communale 2%',
  rate:      0.02,
  kind:      'PERCENT',
  base:      'TOTAL_AFTER_PREVIOUS',
  appliesTo: ['ALL'],
  sortOrder: 20,
  enabled:   true,
};

describe('TaxCalculator', () => {
  describe('filterApplicableTaxes', () => {
    const AT = new Date('2026-04-18T10:00:00Z');

    it('exclut les taxes désactivées', () => {
      const disabled: TenantTaxInput = { ...tvaFixture, enabled: false };
      expect(filterApplicableTaxes([disabled], 'TICKET', AT)).toHaveLength(0);
    });

    it('retient les taxes appliesTo=[ALL] pour tous les entityType', () => {
      expect(filterApplicableTaxes([tvaFixture], 'TICKET', AT)).toHaveLength(1);
      expect(filterApplicableTaxes([tvaFixture], 'PARCEL', AT)).toHaveLength(1);
      expect(filterApplicableTaxes([tvaFixture], 'SUBSCRIPTION', AT)).toHaveLength(1);
    });

    it('filtre par entityType ciblé', () => {
      const parcelOnly: TenantTaxInput = { ...tvaFixture, appliesTo: ['PARCEL'] };
      expect(filterApplicableTaxes([parcelOnly], 'TICKET', AT)).toHaveLength(0);
      expect(filterApplicableTaxes([parcelOnly], 'PARCEL', AT)).toHaveLength(1);
    });

    it('respecte validFrom/validTo (bornes inclusive/exclusive)', () => {
      const future: TenantTaxInput = { ...tvaFixture, validFrom: new Date('2026-12-31') };
      const expired: TenantTaxInput = { ...tvaFixture, validTo: new Date('2026-01-01') };
      expect(filterApplicableTaxes([future], 'TICKET', AT)).toHaveLength(0);
      expect(filterApplicableTaxes([expired], 'TICKET', AT)).toHaveLength(0);
    });
  });

  describe('computeTaxAmount', () => {
    it('PERCENT sur SUBTOTAL → subtotal × rate', () => {
      const { amount, appliedOn } = computeTaxAmount(tvaFixture, 1000, 0);
      expect(amount).toBe(180);
      expect(appliedOn).toBe(1000);
    });

    it('FIXED → ignore subtotal, retourne rate tel quel', () => {
      const { amount, appliedOn } = computeTaxAmount(timbreFixture, 1000, 0);
      expect(amount).toBe(500);
      expect(appliedOn).toBe(1000);
    });

    it('TOTAL_AFTER_PREVIOUS → cascade (subtotal + cumul)', () => {
      const { amount, appliedOn } = computeTaxAmount(taxeCommunaleCascade, 1000, 180);
      expect(amount).toBe(23.6);           // (1000 + 180) × 0.02
      expect(appliedOn).toBe(1180);
    });
  });

  describe('computeTaxes — scénarios complets', () => {
    it('aucune taxe → total = subtotal', () => {
      const res = computeTaxes({ subtotal: 1500, currency: 'XAF', entityType: 'TICKET', taxes: [] });
      expect(res.subtotal).toBe(1500);
      expect(res.taxes).toHaveLength(0);
      expect(res.taxTotal).toBe(0);
      expect(res.total).toBe(1500);
    });

    it('TVA 18 % simple sur un billet à 1000', () => {
      const res = computeTaxes({
        subtotal: 1000,
        currency: 'XAF',
        entityType: 'TICKET',
        taxes: [tvaFixture],
      });
      expect(res.taxes).toEqual([
        expect.objectContaining({ code: 'TVA', amount: 180, appliedOn: 1000 }),
      ]);
      expect(res.taxTotal).toBe(180);
      expect(res.total).toBe(1180);
    });

    it('TVA + timbre fixe → somme correcte', () => {
      const res = computeTaxes({
        subtotal: 10000,
        currency: 'XAF',
        entityType: 'PARCEL',
        taxes: [tvaFixture, timbreFixture],
      });
      expect(res.taxes).toHaveLength(2);
      expect(res.taxTotal).toBe(2300);       // 1800 TVA + 500 timbre
      expect(res.total).toBe(12300);
    });

    it('cascade : TVA puis taxe communale sur (HT + TVA)', () => {
      const res = computeTaxes({
        subtotal: 1000,
        currency: 'XAF',
        entityType: 'TICKET',
        taxes: [tvaFixture, taxeCommunaleCascade],
      });
      const tva = res.taxes.find(l => l.code === 'TVA')!;
      const communale = res.taxes.find(l => l.code === 'TAXE_COMMUNALE')!;
      expect(tva.amount).toBe(180);
      expect(tva.appliedOn).toBe(1000);
      expect(communale.amount).toBe(23.6);       // (1000 + 180) × 0.02
      expect(communale.appliedOn).toBe(1180);
      expect(res.total).toBe(1203.6);
    });

    it('respecte le sortOrder pour la cascade, pas l’ordre d’entrée', () => {
      // Taxe cascade avant TVA dans le tableau mais sortOrder=20
      const res = computeTaxes({
        subtotal: 1000,
        currency: 'XAF',
        entityType: 'TICKET',
        taxes: [taxeCommunaleCascade, tvaFixture],
      });
      expect(res.taxes[0].code).toBe('TVA');
      expect(res.taxes[1].code).toBe('TAXE_COMMUNALE');
      expect(res.taxes[1].appliedOn).toBe(1180);  // cascade correcte
    });

    it('ignore les taxes désactivées', () => {
      const res = computeTaxes({
        subtotal: 1000,
        currency: 'XAF',
        entityType: 'TICKET',
        taxes: [{ ...tvaFixture, enabled: false }],
      });
      expect(res.taxes).toHaveLength(0);
      expect(res.total).toBe(1000);
    });

    it('arrondit à 2 décimales les montants et le total', () => {
      const taxe13_33: TenantTaxInput = { ...tvaFixture, rate: 0.1333, code: 'X', label: 'X' };
      const res = computeTaxes({
        subtotal: 777.77,
        currency: 'EUR',
        entityType: 'TICKET',
        taxes: [taxe13_33],
      });
      expect(res.taxes[0].amount).toBe(103.68);  // round2(777.77 × 0.1333)
      expect(res.total).toBe(881.45);
    });

    it('entityType non couvert par appliesTo → pas appliqué', () => {
      const ticketOnly: TenantTaxInput = { ...tvaFixture, appliesTo: ['TICKET'] };
      const res = computeTaxes({
        subtotal: 1000,
        currency: 'XAF',
        entityType: 'PARCEL',
        taxes: [ticketOnly],
      });
      expect(res.taxes).toHaveLength(0);
      expect(res.total).toBe(1000);
    });

    it('renvoie la devise passée en entrée (pas d’inférence)', () => {
      const res = computeTaxes({ subtotal: 100, currency: 'EUR', entityType: 'TICKET', taxes: [] });
      expect(res.currency).toBe('EUR');
    });
  });
});
