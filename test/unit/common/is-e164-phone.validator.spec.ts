import { validate, IsString } from 'class-validator';
import { IsE164Phone } from '../../../src/common/validators/is-e164-phone.validator';

/**
 * Tests unit — @IsE164Phone validator (2026-04-20).
 * Vérifie que le validator accepte les numéros normalisables via phone.helper
 * et rejette les formats invalides (garbage, trop courts, préfixe inconnu).
 */
class Dto { @IsString() @IsE164Phone() phone!: string; }
class DtoCG { @IsString() @IsE164Phone({ defaultCountry: 'CG' }) phone!: string; }

describe('@IsE164Phone', () => {
  it('accepte un E.164 valide (préfixe + connu)', async () => {
    const d = new Dto(); d.phone = '+242061234567';
    const errors = await validate(d);
    expect(errors).toHaveLength(0);
  });

  it('accepte un national avec defaultCountry', async () => {
    const d = new DtoCG(); d.phone = '061234567';
    const errors = await validate(d);
    expect(errors).toHaveLength(0);
  });

  it('rejette un numéro garbage (non digit)', async () => {
    const d = new Dto(); d.phone = 'abcdef';
    const errors = await validate(d);
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints?.isE164Phone).toMatch(/téléphone valide/);
  });

  it('rejette un numéro trop court', async () => {
    const d = new Dto(); d.phone = '+24212';
    const errors = await validate(d);
    expect(errors).toHaveLength(1);
  });

  it('rejette un préfixe pays inconnu', async () => {
    const d = new Dto(); d.phone = '+9999123456789';
    const errors = await validate(d);
    expect(errors).toHaveLength(1);
  });

  it('rejette une chaîne vide', async () => {
    const d = new Dto(); d.phone = '';
    const errors = await validate(d);
    // @IsString passe (chaîne vide est valide comme string), mais @IsE164Phone reject
    const e164Err = errors.find(e => e.constraints?.isE164Phone);
    expect(e164Err).toBeDefined();
  });
});
