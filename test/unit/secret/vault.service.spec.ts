/**
 * VaultService — tests unit du fix gestion token AppRole (2026-04-26).
 *
 * Reproduit le bug : token AppRole expire au bout de 1h, le backend tombe en
 * "permission denied" jusqu'au prochain restart. Le fix combine :
 *   1. Renouvellement préventif à 75% du TTL
 *   2. Retry réactif sur 403/permission denied
 *   3. Mutex re-login pour ne pas dupliquer les login concurrents
 */

// node-vault est mocké pour ne pas dépendre d'un Vault réel. La factory
// renvoie le mockClient courant — chaque test peut le remplacer via
// `setMockClient()` avant d'instancier VaultService.
let __currentMockClient: any = null;
jest.mock('node-vault', () => {
  const factory = jest.fn(() => __currentMockClient);
  return Object.assign(factory, { default: factory });
});

import { VaultService } from '../../../src/infrastructure/secret/vault.service';

function setMockClient(c: any) { __currentMockClient = c; }

describe('VaultService — gestion AppRole token (fix 2026-04-26)', () => {
  const ORIG_ENV = { ...process.env };
  let svc: VaultService;
  let mockClient: any;
  let approleLoginCalls: number;

  function mkMockClient(overrides: Partial<any> = {}) {
    return {
      token: 'initial-token',
      read:           jest.fn(),
      write:          jest.fn().mockResolvedValue({}),
      delete:         jest.fn().mockResolvedValue({}),
      health:         jest.fn().mockResolvedValue({}),
      tokenRenewSelf: jest.fn().mockResolvedValue({ auth: { lease_duration: 3600, renewable: true } }),
      approleLogin:   jest.fn().mockImplementation(async () => {
        approleLoginCalls++;
        return { auth: { client_token: `tok-${approleLoginCalls}`, lease_duration: 3600, renewable: true } };
      }),
      ...overrides,
    };
  }

  beforeEach(() => {
    (process.env as any).NODE_ENV = 'production';
    process.env.VAULT_ADDR     = 'http://vault:8200';
    process.env.VAULT_TOKEN    = 'env-token';
    process.env.VAULT_ROLE_ID  = 'role-x';
    process.env.VAULT_SECRET_ID = 'secret-y';
    approleLoginCalls = 0;
    mockClient = mkMockClient();
    setMockClient(mockClient);
    svc = new VaultService();
  });

  afterEach(() => {
    svc.onModuleDestroy();
    process.env = { ...ORIG_ENV };
    jest.clearAllMocks();
  });

  it('AppRole login au boot puis lecture normale', async () => {
    mockClient.read.mockResolvedValueOnce({ data: { data: { HOST: 'mail.example' } } });
    const out = await svc.getSecretObject('platform/email/smtp');
    expect(out).toEqual({ HOST: 'mail.example' });
    expect(mockClient.approleLogin).toHaveBeenCalledTimes(1);
    expect(mockClient.read).toHaveBeenCalledWith('secret/data/platform/email/smtp');
  });

  it('🐛 Token expiré → 403 permission denied → re-login + retry réussit', async () => {
    mockClient.read
      .mockRejectedValueOnce(new Error('Status 403 - permission denied'))
      .mockResolvedValueOnce({ data: { data: { HOST: 'mail.example' } } });

    const out = await svc.getSecretObject('platform/email/smtp');
    expect(out).toEqual({ HOST: 'mail.example' });
    // 1 login au boot + 1 re-login après le 403
    expect(mockClient.approleLogin).toHaveBeenCalledTimes(2);
    expect(mockClient.read).toHaveBeenCalledTimes(2);
  });

  it('Détecte les variantes de message d\'erreur d\'auth', async () => {
    const variants = [
      'Status 403 - permission denied',
      'permission denied',
      'invalid token',
      'token expired',
      'Status 401',
      'Vault returned 403',
    ];
    for (const msg of variants) {
      jest.clearAllMocks();
      approleLoginCalls = 0;
      mockClient.read
        .mockRejectedValueOnce(new Error(msg))
        .mockResolvedValueOnce({ data: { data: { ok: 'yes' } } });
      svc = new VaultService();
      const out = await svc.getSecretObject('test/path');
      expect(out).toEqual({ ok: 'yes' });
      expect(mockClient.read).toHaveBeenCalledTimes(2);
      svc.onModuleDestroy();
    }
  });

  it('404 NE déclenche PAS de re-login (path absent ≠ token expiré)', async () => {
    mockClient.read.mockRejectedValueOnce(new Error('Status 404'));
    await expect(svc.getSecretObject('platform/email/resend')).rejects.toThrow('Vault secret read failed');
    // 1 seul login au boot, pas de re-login
    expect(mockClient.approleLogin).toHaveBeenCalledTimes(1);
    expect(mockClient.read).toHaveBeenCalledTimes(1);
  });

  it('2 reads concurrents en 403 → 1 SEUL re-login (mutex)', async () => {
    mockClient.read
      .mockRejectedValueOnce(new Error('Status 403'))
      .mockRejectedValueOnce(new Error('Status 403'))
      .mockResolvedValueOnce({ data: { data: { v: 1 } } })
      .mockResolvedValueOnce({ data: { data: { v: 2 } } });

    const results = await Promise.all([
      svc.getSecretObject('p/a'),
      svc.getSecretObject('p/b'),
    ]);
    // Les 2 reads ont retry avec succès — ordre des résultats non garanti
    // (les promises courent en concurrence, le mock répond dans l'ordre du
    // shift). Important : les 2 ont reçu une réponse non-erreur.
    expect(results).toHaveLength(2);
    expect(results.every(r => typeof (r as any).v === 'number')).toBe(true);
    // 1 login boot + 1 re-login partagé pour les 2 retries (pas 2 re-logins)
    expect(mockClient.approleLogin).toHaveBeenCalledTimes(2);
  });

  it('Si retry échoue aussi avec 403 → propage l\'erreur', async () => {
    mockClient.read
      .mockRejectedValueOnce(new Error('Status 403'))
      .mockRejectedValueOnce(new Error('Status 403'));

    await expect(svc.getSecretObject('p/x')).rejects.toThrow('Vault secret read failed');
    // 1 login boot + 1 re-login. Pas de 3e tentative.
    expect(mockClient.approleLogin).toHaveBeenCalledTimes(2);
    expect(mockClient.read).toHaveBeenCalledTimes(2);
  });

  it('writes (putSecret/deleteSecret) bénéficient aussi du retry', async () => {
    mockClient.write
      .mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValueOnce({});
    await svc.putSecret('p/y', { K: 'v' });
    expect(mockClient.write).toHaveBeenCalledTimes(2);
    expect(mockClient.approleLogin).toHaveBeenCalledTimes(2);
  });

  it('Mode dev (NODE_ENV ≠ production) — pas d\'AppRole login, pas de retry', async () => {
    svc.onModuleDestroy();
    (process.env as any).NODE_ENV = 'development';
    approleLoginCalls = 0;
    mockClient = mkMockClient();
    setMockClient(mockClient);
    svc = new VaultService();

    mockClient.read.mockRejectedValueOnce(new Error('Status 403'));
    await expect(svc.getSecretObject('p/z')).rejects.toThrow('Vault secret read failed');
    // En dev on utilise VAULT_TOKEN root, pas d'AppRole et pas de retry sur 403
    expect(mockClient.approleLogin).not.toHaveBeenCalled();
    expect(mockClient.read).toHaveBeenCalledTimes(1);
  });

  it('Renew préventif programmé après login (lease ≥ 60s)', async () => {
    jest.useFakeTimers();
    svc.onModuleDestroy();
    approleLoginCalls = 0;
    mockClient = mkMockClient();
    setMockClient(mockClient);
    svc = new VaultService();

    // Force l'init en faisant un read
    mockClient.read.mockResolvedValueOnce({ data: { data: {} } });
    await svc.getSecretObject('p/init');

    // Avance dans le temps à 75% du lease (3600 * 0.75 = 2700s)
    await jest.advanceTimersByTimeAsync(2700 * 1000);

    expect(mockClient.tokenRenewSelf).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('Lease < 60s → pas de renew préventif (mode test/dev court)', async () => {
    jest.useFakeTimers();
    svc.onModuleDestroy();
    approleLoginCalls = 0;
    mockClient = mkMockClient({
      approleLogin: jest.fn().mockResolvedValue({
        auth: { client_token: 'short-tok', lease_duration: 30, renewable: true },
      }),
    });
    setMockClient(mockClient);
    svc = new VaultService();

    mockClient.read.mockResolvedValueOnce({ data: { data: {} } });
    await svc.getSecretObject('p/init');

    await jest.advanceTimersByTimeAsync(60 * 1000);
    expect(mockClient.tokenRenewSelf).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('onModuleDestroy nettoie le timer de renew', async () => {
    mockClient.read.mockResolvedValueOnce({ data: { data: {} } });
    await svc.getSecretObject('p/init');
    expect(() => svc.onModuleDestroy()).not.toThrow();
  });
});
