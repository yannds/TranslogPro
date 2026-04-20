import { normalizeMonthlyAmount } from '../../../prisma/seeds/subscription-change.backfill';

describe('subscription-change.backfill — normalizeMonthlyAmount', () => {
  it('returns 0 for 0 or negative price regardless of cycle', () => {
    expect(normalizeMonthlyAmount(0, 'MONTHLY')).toBe(0);
    expect(normalizeMonthlyAmount(-10, 'YEARLY')).toBe(0);
  });

  it('returns identity for MONTHLY', () => {
    expect(normalizeMonthlyAmount(29.9, 'MONTHLY')).toBeCloseTo(29.9);
  });

  it('divides YEARLY by 12', () => {
    expect(normalizeMonthlyAmount(600, 'YEARLY')).toBeCloseTo(50);
  });

  it('amortizes ONE_SHOT over 12 months', () => {
    expect(normalizeMonthlyAmount(360, 'ONE_SHOT')).toBeCloseTo(30);
  });

  it('falls back to identity for unknown cycles', () => {
    expect(normalizeMonthlyAmount(99, 'WEEKLY' as any)).toBeCloseTo(99);
    expect(normalizeMonthlyAmount(99, 'CUSTOM')).toBeCloseTo(99);
  });
});
