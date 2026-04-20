/**
 * AuthService.updateMyPreferences — unit test
 *
 * - Merge partiel : locale fourni sans timezone → preserve timezone existante
 * - Autres clés de User.preferences (ex. siège préféré) préservées
 * - User introuvable → 404
 */
import { NotFoundException } from '@nestjs/common';
import { AuthService } from '../../../src/modules/auth/auth.service';

describe('AuthService.updateMyPreferences', () => {
  let prismaMock: any;
  let service:    AuthService;

  beforeEach(() => {
    prismaMock = {
      user: {
        findUnique: jest.fn(),
        update:     jest.fn().mockResolvedValue({}),
      },
    };
    service = new AuthService(
      prismaMock,
      { listActiveKeys: jest.fn() } as any,
      { verifyLoginCode: jest.fn() } as any,
      { findCredentialAccount: jest.fn() } as any,
      {} as any,
      {} as any,
    );
  });

  it('throw NotFound si user absent', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(
      service.updateMyPreferences('missing', { locale: 'fr' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('merge partiel : timezone préservée quand seul locale est fourni', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1',
      preferences: { locale: 'en', timezone: 'Europe/Paris', favoriteSeat: '3A' },
    });

    const out = await service.updateMyPreferences('u1', { locale: 'fr' });

    expect(out).toEqual({ locale: 'fr', timezone: 'Europe/Paris' });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data:  {
        preferences: {
          locale:       'fr',
          timezone:     'Europe/Paris',
          favoriteSeat: '3A', // clé non-i18n préservée
        },
      },
    });
  });

  it('sur preferences vides, crée juste les clés fournies', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', preferences: null });
    const out = await service.updateMyPreferences('u1', { timezone: 'Africa/Brazzaville' });
    expect(out).toEqual({ locale: null, timezone: 'Africa/Brazzaville' });
  });
});
