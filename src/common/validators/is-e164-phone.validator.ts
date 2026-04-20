/**
 * @IsE164Phone() — validator class-validator qui délègue à `normalizePhone`.
 *
 * Usage :
 *   class CreateBookingDto {
 *     @IsE164Phone({ countryFromTenant: true })   // 'CG' déduit du tenant
 *     phone: string;
 *   }
 *
 * Design :
 *   - N'accepte QUE des formats normalisables vers E.164 (cf. phone.helper.ts).
 *   - Ne modifie pas la valeur reçue (pas de transform) — la normalisation
 *     canonique se fait côté `CustomerResolverService.resolveOrCreate` avec
 *     le pays du tenant. Ici on filtre juste les formats invalides.
 *   - Rejette les chaînes trop courtes/longues, caractères non-numériques, etc.
 *
 * Important : cette validation ne remplace PAS le rate limit / CAPTCHA —
 * un phone valide peut quand même être un phone d'autrui utilisé pour spam.
 */
import { registerDecorator, ValidationOptions, ValidationArguments } from 'class-validator';
import { normalizePhone } from '../helpers/phone.helper';

export interface IsE164PhoneOptions {
  /** Pays ISO fallback si le numéro n'a pas de préfixe +XX. Ex: 'CG'. Default null. */
  defaultCountry?: string | null;
}

export function IsE164Phone(
  opts:    IsE164PhoneOptions      = {},
  options: ValidationOptions | undefined = undefined,
): PropertyDecorator {
  return function (object: object, propertyName: string | symbol) {
    registerDecorator({
      name:         'isE164Phone',
      target:       object.constructor,
      propertyName: propertyName as string,
      constraints:  [opts],
      options,
      validator: {
        validate(value: unknown, _args: ValidationArguments) {
          if (typeof value !== 'string') return false;
          const res = normalizePhone(value, opts.defaultCountry ?? null);
          return res.ok;
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} doit être un numéro de téléphone valide (format E.164 ou national avec indicatif pays connu)`;
        },
      },
    });
  };
}
