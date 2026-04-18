import { normalizePhone, requireE164, isValidPhone, maskPhone } from '../../../src/common/helpers/phone.helper';

describe('phone.helper', () => {
  describe('normalizePhone()', () => {
    it('accepts already formatted E.164', () => {
      const r = normalizePhone('+242061234567');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.e164).toBe('+242061234567');
        expect(r.dial).toBe('242');
        expect(r.national).toBe('061234567');
      }
    });

    it('strips spaces, dashes, parens', () => {
      const r = normalizePhone('+242 06 (12) 34-567');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.e164).toBe('+242061234567');
    });

    it('accepts 00 prefix as equivalent to +', () => {
      const r = normalizePhone('00242061234567');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.e164).toBe('+242061234567');
    });

    it('prepends country dial when raw is national + countryIso given', () => {
      const r = normalizePhone('06 12 34 56 78', 'CG');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.e164).toBe('+242612345678'); // leading 0 stripped
    });

    it('strips leading 0 for France national format', () => {
      const r = normalizePhone('06 12 34 56 78', 'FR');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.e164).toBe('+33612345678');
    });

    it('is deterministic: same input ⇒ same e164', () => {
      const a = normalizePhone('+242 06 12-34.567');
      const b = normalizePhone('242061234567'.replace(/^/, '+'));
      expect(a.ok && b.ok && a.e164 === b.e164).toBe(true);
    });

    it('rejects empty / whitespace', () => {
      expect(normalizePhone(null).ok).toBe(false);
      expect(normalizePhone('   ').ok).toBe(false);
    });

    it('rejects non-digit garbage', () => {
      const r = normalizePhone('+242abc123');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('non_digit');
    });

    it('rejects unknown country dial', () => {
      const r = normalizePhone('+99912345678');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('unknown_country');
    });

    it('rejects too short', () => {
      const r = normalizePhone('+24212');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('too_short');
    });

    it('rejects too long', () => {
      const r = normalizePhone('+242' + '1'.repeat(20));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('too_long');
    });

    it('rejects national-only without countryIso', () => {
      const r = normalizePhone('061234567');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('unknown_country');
    });
  });

  describe('requireE164() / isValidPhone()', () => {
    it('requireE164 throws on invalid', () => {
      expect(() => requireE164('abc')).toThrow(/invalid_phone/);
    });

    it('requireE164 returns normalized on valid', () => {
      expect(requireE164('+242061234567')).toBe('+242061234567');
    });

    it('isValidPhone returns boolean', () => {
      expect(isValidPhone('+242061234567')).toBe(true);
      expect(isValidPhone('bad')).toBe(false);
    });
  });

  describe('maskPhone()', () => {
    it('masks middle digits', () => {
      expect(maskPhone('+242061234567')).toBe('+242••••567');
    });
    it('returns input if not E.164', () => {
      expect(maskPhone('061234567')).toBe('061234567');
    });
    it('returns input if too short', () => {
      expect(maskPhone('+1234')).toBe('+1234');
    });
  });
});
