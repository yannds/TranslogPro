import { AuthService } from '../../../src/modules/auth/auth.service';

/**
 * Tests sessions self-service — couvrent :
 *   - listUserSessions filtre par userId + sessions non expirées
 *   - isCurrent calculé depuis le token courant (pas leak du token brut)
 *   - revokeSessionById refuse session courante (force /sign-out)
 *   - revokeAllOtherSessions exclut la session courante
 *   - sécurité cross-user : findFirst pose toujours userId
 */
describe('AuthService — self-service sessions', () => {
  let prismaMock: any;
  let svc: AuthService;

  beforeEach(() => {
    prismaMock = {
      session: {
        findMany:   jest.fn(),
        findFirst:  jest.fn(),
        delete:     jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    // On ne consomme que les méthodes session — les autres deps peuvent rester null.
    svc = new AuthService(
      prismaMock,
      null as any, null as any, null as any, null as any, null as any,
    );
  });

  describe('listUserSessions', () => {
    it('filtre par userId + expiresAt > now, jamais de leak du token brut', async () => {
      prismaMock.session.findMany.mockResolvedValueOnce([
        { id: 'S1', token: 'tk-curr', ipAddress: '1.2.3.4', userAgent: 'UA1',
          createdAt: new Date('2026-04-25'), expiresAt: new Date('2026-05-25') },
        { id: 'S2', token: 'tk-other', ipAddress: '5.6.7.8', userAgent: 'UA2',
          createdAt: new Date('2026-04-20'), expiresAt: new Date('2026-05-20') },
      ]);
      const out = await svc.listUserSessions('U1', 'tk-curr');

      expect(prismaMock.session.findMany.mock.calls[0][0].where.userId).toBe('U1');
      expect(prismaMock.session.findMany.mock.calls[0][0].where.expiresAt.gt).toBeInstanceOf(Date);
      expect(out).toHaveLength(2);
      expect(out[0].isCurrent).toBe(true);
      expect(out[1].isCurrent).toBe(false);
      // Aucune ligne ne contient `token` dans la réponse
      expect(out.some(r => 'token' in r)).toBe(false);
    });

    it('isCurrent=false pour toutes si pas de token', async () => {
      prismaMock.session.findMany.mockResolvedValueOnce([
        { id: 'S1', token: 'tk', ipAddress: null, userAgent: null,
          createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) },
      ]);
      const out = await svc.listUserSessions('U1', null);
      expect(out[0].isCurrent).toBe(false);
    });
  });

  describe('revokeSessionById', () => {
    it('SÉCURITÉ : findFirst toujours scopé userId (pas de cross-user)', async () => {
      prismaMock.session.findFirst.mockResolvedValueOnce({ id: 'S1', token: 'tk' });
      await svc.revokeSessionById('U1', 'S1', 'other-token');
      expect(prismaMock.session.findFirst.mock.calls[0][0].where).toEqual({
        id: 'S1', userId: 'U1',
      });
      expect(prismaMock.session.delete).toHaveBeenCalledWith({ where: { id: 'S1' } });
    });

    it('refuse de révoquer la session courante (force /sign-out)', async () => {
      prismaMock.session.findFirst.mockResolvedValueOnce({ id: 'S1', token: 'tk-curr' });
      await expect(svc.revokeSessionById('U1', 'S1', 'tk-curr'))
        .rejects.toThrow(/sign-out/i);
      expect(prismaMock.session.delete).not.toHaveBeenCalled();
    });

    it('404 si session introuvable (id ou tenant invalide)', async () => {
      prismaMock.session.findFirst.mockResolvedValueOnce(null);
      await expect(svc.revokeSessionById('U1', 'NOPE', 'tk'))
        .rejects.toThrow(/introuvable/i);
    });
  });

  describe('revokeAllOtherSessions', () => {
    it('exclut la session courante via token: { not: ... }', async () => {
      prismaMock.session.deleteMany.mockResolvedValueOnce({ count: 3 });
      const n = await svc.revokeAllOtherSessions('U1', 'tk-curr');
      expect(n).toBe(3);
      const where = prismaMock.session.deleteMany.mock.calls[0][0].where;
      expect(where.userId).toBe('U1');
      expect(where.token).toEqual({ not: 'tk-curr' });
    });

    it('si pas de token courant, supprime tout', async () => {
      prismaMock.session.deleteMany.mockResolvedValueOnce({ count: 2 });
      const n = await svc.revokeAllOtherSessions('U1', null);
      expect(n).toBe(2);
      const where = prismaMock.session.deleteMany.mock.calls[0][0].where;
      expect(where.userId).toBe('U1');
      expect(where.token).toBeUndefined();
    });
  });
});
