/**
 * LicensePlateValidator — tests unitaires.
 *
 * Couvre :
 *   - normalize() : trim, uppercase, séparateurs unifiés
 *   - isJunk()    : longueur, caractères non-alphanumériques uniquement
 *   - maskToRegex() : convention permissive (chiffre = 0-9, lettre = A-Z\excluded)
 *   - matchKnownMask() : match, unknown, pays absent du registre
 *   - validate() : orchestration end-to-end (junk vs ok vs unknown)
 *   - findDuplicate() : check tenant-scoped
 *
 * Mock : PrismaService uniquement.
 */

import {
  LicensePlateValidator,
  type LicensePlateFormatsConfig,
} from '@modules/fleet/license-plate-validator.service';
import { PrismaService } from '@infra/database/prisma.service';

type PrismaMock = jest.Mocked<PrismaService>;

const FORMATS: LicensePlateFormatsConfig = {
  CG: {
    label: 'Congo Brazzaville',
    masks: ['999-A-9', '999-A-99', '999-AA-9', '999-AA-99', '999-AAA-9', '999-AAA-99'],
    excludedLetters: ['W', 'Y', 'O', 'I', 'Z'],
  },
  FR: {
    label: 'France',
    masks: ['AA-999-AA'],
  },
  CM: {
    label: 'Cameroun',
    masks: ['AA-999-AA'],
  },
};

function makePrisma(busFindFirst?: jest.Mock): PrismaMock {
  return {
    bus: { findFirst: busFindFirst ?? jest.fn().mockResolvedValue(null) },
  } as unknown as PrismaMock;
}

function build(prisma?: PrismaMock) {
  const p = prisma ?? makePrisma();
  return { service: new LicensePlateValidator(p), prisma: p };
}

// ─── normalize ─────────────────────────────────────────────────────────────────

describe('LicensePlateValidator.normalize', () => {
  const { service } = build();
  it('trim + uppercase', () => {
    expect(service.normalize('  ab-123-cd  ')).toBe('AB-123-CD');
  });
  it('strip caractères non alphanumériques sauf - et espace', () => {
    expect(service.normalize('AB.123/CD')).toBe('AB123CD');
  });
  it('compresse espaces multiples', () => {
    expect(service.normalize('AB    123    CD')).toBe('AB 123 CD');
  });
});

// ─── isJunk ────────────────────────────────────────────────────────────────────

describe('LicensePlateValidator.isJunk', () => {
  const { service } = build();
  it('rejette plaque trop courte', () => {
    expect(service.isJunk('AB')).toBe(true);
  });
  it('rejette plaque que séparateurs', () => {
    expect(service.isJunk('----')).toBe(true);
    expect(service.isJunk('   ')).toBe(true);
  });
  it('rejette plaque sans aucun caractère alphanum', () => {
    expect(service.isJunk('--- --- ---')).toBe(true);
  });
  it('accepte plaque réelle', () => {
    expect(service.isJunk('001-AS-4')).toBe(false);
    expect(service.isJunk('AB-123-CD')).toBe(false);
  });
  it('accepte plaque sans séparateur', () => {
    expect(service.isJunk('AB123CD')).toBe(false);
  });
});

// ─── maskToRegex ───────────────────────────────────────────────────────────────

describe('LicensePlateValidator.maskToRegex', () => {
  const { service } = build();

  it('mask "989-BB-SS" match 3 chiffres + 2 lettres + 2 lettres', () => {
    const re = service.maskToRegex('989-BB-SS');
    expect(re.test('001-AB-CD')).toBe(true);
    expect(re.test('999-XX-YY')).toBe(true);
    expect(re.test('001-AB-12')).toBe(false);
    expect(re.test('1-AB-CD')).toBe(false);
  });

  it('mask "001-AS-4" match 3 chiffres + 2 lettres + 1 chiffre', () => {
    const re = service.maskToRegex('001-AS-4');
    expect(re.test('234-AB-1')).toBe(true);
    expect(re.test('999-AA-9')).toBe(true);
    expect(re.test('234-AB-12')).toBe(false);
  });

  it('exclut les lettres interdites', () => {
    const re = service.maskToRegex('AB-9', ['Z']);
    expect(re.test('AB-1')).toBe(true);
    expect(re.test('AZ-1')).toBe(false);
    expect(re.test('ZA-1')).toBe(false);
  });

  it('échappe les caractères regex spéciaux dans les séparateurs', () => {
    const re = service.maskToRegex('A.9');
    expect(re.test('A.1')).toBe(true);
    expect(re.test('AX1')).toBe(false);
  });
});

// ─── matchKnownMask ────────────────────────────────────────────────────────────

describe('LicensePlateValidator.matchKnownMask', () => {
  const { service } = build();

  it("plaque CG civile standard '001-AS-4' → match", () => {
    const r = service.matchKnownMask('001-AS-4', 'CG', FORMATS);
    expect(r.status).toBe('match');
    if (r.status === 'match') expect(r.matchedMask).toBe('999-AA-9');
  });

  it("plaque CG avec 4 chiffres (État) → unknown (civil only)", () => {
    const r = service.matchKnownMask('1234-AB-4', 'CG', FORMATS);
    expect(r.status).toBe('unknown');
  });

  it('plaque CG avec lettre exclue (Z) → unknown', () => {
    const r = service.matchKnownMask('001-AZ-4', 'CG', FORMATS);
    expect(r.status).toBe('unknown');
  });

  it('plaque FR SIV → match', () => {
    const r = service.matchKnownMask('AB-123-CD', 'FR', FORMATS);
    expect(r.status).toBe('match');
  });

  it('pays sans config → unknown', () => {
    const r = service.matchKnownMask('AB-123-CD', 'XX', FORMATS);
    expect(r.status).toBe('unknown');
    if (r.status === 'unknown') expect(r.reason).toBe('no-masks-defined');
  });

  it('case-insensitive sur le pays', () => {
    const r = service.matchKnownMask('001-AS-4', 'cg', FORMATS);
    expect(r.status).toBe('match');
  });
});

// ─── validate (orchestration) ─────────────────────────────────────────────────

describe('LicensePlateValidator.validate', () => {
  const { service } = build();

  it('rejette junk avant tout', () => {
    const r = service.validate({ plate: '----', country: 'CG', formats: FORMATS });
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') expect(r.reason).toBe('junk');
  });

  it("plaque réelle CG → ok", () => {
    const r = service.validate({ plate: '001-as-4', country: 'CG', formats: FORMATS });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.normalized).toBe('001-AS-4');
  });

  it('plaque atypique → unknown (warn, pas reject)', () => {
    const r = service.validate({ plate: 'XYZ-99-XY', country: 'CG', formats: FORMATS });
    expect(r.status).toBe('unknown');
  });
});

// ─── findDuplicate ─────────────────────────────────────────────────────────────

describe('LicensePlateValidator.findDuplicate', () => {
  it('retourne le bus existant si plaque déjà utilisée dans le tenant', async () => {
    const prisma = makePrisma(jest.fn().mockResolvedValue({ id: 'bus-1', plateNumber: 'AB-123-CD' }));
    const { service } = build(prisma);
    const found = await service.findDuplicate({ plateNumber: 'AB-123-CD', tenantId: 't1' });
    expect(found?.id).toBe('bus-1');
  });

  it('exclut le bus passé en excludeBusId', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = makePrisma(findFirst);
    const { service } = build(prisma);
    await service.findDuplicate({ plateNumber: 'AB-123-CD', tenantId: 't1', excludeBusId: 'bus-1' });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ NOT: { id: 'bus-1' } }),
    }));
  });

  it('normalise la plaque avant la recherche', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = makePrisma(findFirst);
    const { service } = build(prisma);
    await service.findDuplicate({ plateNumber: '  ab-123-cd  ', tenantId: 't1' });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ plateNumber: 'AB-123-CD' }),
    }));
  });
});
