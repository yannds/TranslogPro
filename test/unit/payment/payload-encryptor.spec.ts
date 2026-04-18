import { randomBytes } from 'crypto';
import { PayloadEncryptor } from '../../../src/infrastructure/payment/payload-encryptor.service';

/**
 * Tests PayloadEncryptor — roundtrip AES-256-GCM.
 * On mock SecretService pour éviter Vault.
 */

function makeSecretService(keyHex: string): any {
  return {
    getSecretObject: jest.fn().mockResolvedValue({ KEY: keyHex }),
    getSecret:       jest.fn(),
    putSecret:       jest.fn(),
    issueCertificate: jest.fn(),
    healthCheck:     jest.fn(),
  };
}

describe('PayloadEncryptor', () => {
  const validKey = randomBytes(32).toString('hex');
  let encryptor: PayloadEncryptor;

  beforeEach(() => {
    encryptor = new PayloadEncryptor(makeSecretService(validKey));
  });

  it('roundtrip encrypt/decrypt string', async () => {
    const token = await encryptor.encrypt('hello secret');
    expect(token.split('.')).toHaveLength(3);
    expect(token).not.toContain('hello');
    expect(await encryptor.decrypt(token)).toBe('hello secret');
  });

  it('roundtrip encryptJson / decryptJson', async () => {
    const obj = { phone: '+242064123456', amount: 1000, meta: { ticket: 'T1' } };
    const token = await encryptor.encryptJson(obj);
    expect(typeof token).toBe('string');
    const back = await encryptor.decryptJson<typeof obj>(token!);
    expect(back).toEqual(obj);
  });

  it('encryptJson null/undefined → null', async () => {
    expect(await encryptor.encryptJson(null)).toBeNull();
    expect(await encryptor.encryptJson(undefined)).toBeNull();
    expect(await encryptor.decryptJson(null)).toBeNull();
  });

  it('chaque encrypt produit un IV différent (non-déterministe)', async () => {
    const a = await encryptor.encrypt('same');
    const b = await encryptor.encrypt('same');
    expect(a).not.toBe(b);
  });

  it('rejette token mal formé', async () => {
    await expect(encryptor.decrypt('not.a.valid')).rejects.toThrow();
    await expect(encryptor.decrypt('onlyonesegment')).rejects.toThrow();
  });

  it('rejette clé de mauvaise taille', async () => {
    const bad = new PayloadEncryptor(makeSecretService('deadbeef'));  // 4 octets
    await expect(bad.encrypt('x')).rejects.toThrow(/32 octets/);
  });

  it('rejette si KEY absent dans Vault', async () => {
    const empty = new PayloadEncryptor({ getSecretObject: jest.fn().mockResolvedValue({}) } as any);
    await expect(empty.encrypt('x')).rejects.toThrow(/clé absente/);
  });

  it('tampering sur le tag → échec de décryption', async () => {
    const token = await encryptor.encrypt('tamper me');
    const [iv, tag, ct] = token.split('.');
    const tagBuf = Buffer.from(tag, 'base64');
    tagBuf[0] ^= 1;
    const tampered = [iv, tagBuf.toString('base64'), ct].join('.');
    await expect(encryptor.decrypt(tampered)).rejects.toThrow();
  });
});
