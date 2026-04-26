import { authenticator } from 'otplib';
import { MfaService } from '../../../src/modules/mfa/mfa.service';

/**
 * Tests unit MfaService — couvrent :
 *   - setup() idempotent (réutilise mfaSecret existant si user.mfaEnabled=false)
 *   - setup() conflit si déjà mfaEnabled
 *   - getStatus() retourne flags non-sensibles
 *   - regenerateBackupCodes() exige code TOTP valide + nouveaux codes ≠ anciens
 *   - regenerateBackupCodes() rejet 401 sur code invalide, 400 si !mfaEnabled
 *
 * NB : on configure window=2 (aligné sur la prod) pour les vérifications TOTP.
 */
describe('MfaService', () => {
  let prismaMock: any;
  let svc: MfaService;

  beforeEach(() => {
    authenticator.options = { window: 2 };
    prismaMock = {
      user: {
        findUnique: jest.fn(),
        update:     jest.fn().mockResolvedValue({}),
      },
    };
    svc = new MfaService(prismaMock);
  });

  describe('setup() idempotent', () => {
    it('génère un nouveau secret si mfaSecret null', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'U1', email: 'a@b.c', mfaEnabled: false, mfaSecret: null,
      });
      const out = await svc.setup('U1');
      expect(out.secret).toBeTruthy();
      expect(out.qrDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'U1' }, data: { mfaSecret: out.secret },
      });
    });

    it('réutilise le mfaSecret existant si pending (pas de re-write DB)', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'U1', email: 'a@b.c', mfaEnabled: false, mfaSecret: 'EXISTING_SECRET_BASE32',
      });
      const out = await svc.setup('U1');
      expect(out.secret).toBe('EXISTING_SECRET_BASE32');
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('refuse 409 si déjà mfaEnabled', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'U1', email: 'a@b.c', mfaEnabled: true, mfaSecret: 'X',
      });
      await expect(svc.setup('U1')).rejects.toThrow(/déjà activé/i);
    });
  });

  describe('getStatus()', () => {
    it('retourne flags + count + pendingSetup', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        mfaEnabled: true, mfaSecret: 'S', mfaVerifiedAt: new Date('2026-04-26'),
        mfaBackupCodes: ['hash1', 'hash2', 'hash3'],
      });
      const s = await svc.getStatus('U1');
      expect(s).toEqual({
        enabled:              true,
        verifiedAt:           new Date('2026-04-26'),
        backupCodesRemaining: 3,
        pendingSetup:         false,
      });
    });

    it('pendingSetup=true si mfaSecret existe sans mfaEnabled', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        mfaEnabled: false, mfaSecret: 'S', mfaVerifiedAt: null, mfaBackupCodes: [],
      });
      const s = await svc.getStatus('U1');
      expect(s.pendingSetup).toBe(true);
    });

    it('jamais de mfaSecret leakeé dans la réponse', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        mfaEnabled: true, mfaSecret: 'TOPSECRET', mfaVerifiedAt: new Date(),
        mfaBackupCodes: [],
      });
      const s = await svc.getStatus('U1');
      expect(JSON.stringify(s)).not.toContain('TOPSECRET');
    });
  });

  describe('regenerateBackupCodes()', () => {
    it('rejet 400 si MFA non activé', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'U1', mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [],
      });
      await expect(svc.regenerateBackupCodes('U1', '123456'))
        .rejects.toThrow(/non activé/i);
    });

    it('rejet 401 si code TOTP invalide', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'U1', mfaEnabled: true, mfaSecret: authenticator.generateSecret(),
        mfaBackupCodes: [],
      });
      await expect(svc.regenerateBackupCodes('U1', '000000'))
        .rejects.toThrow(/Code invalide/);
    });

    it('génère 10 nouveaux codes, écrase mfaBackupCodes en DB', async () => {
      const secret = authenticator.generateSecret();
      const validCode = authenticator.generate(secret);
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'U1', mfaEnabled: true, mfaSecret: secret, mfaBackupCodes: ['old-hash'],
      });
      const out = await svc.regenerateBackupCodes('U1', validCode);
      expect(out.backupCodes).toHaveLength(10);
      expect(out.backupCodes.every(c => /^[A-Z0-9]+$/.test(c))).toBe(true);

      const updateCall = prismaMock.user.update.mock.calls[0][0];
      expect(updateCall.where.id).toBe('U1');
      expect(updateCall.data.mfaBackupCodes).toHaveLength(10);
      // Les codes en DB sont hashés bcrypt, pas en clair
      expect(updateCall.data.mfaBackupCodes[0]).toMatch(/^\$2[aby]\$/);
    });
  });
});
