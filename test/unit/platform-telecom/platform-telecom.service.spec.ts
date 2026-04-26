/**
 * PlatformTelecomService — tests unit du module SMS/WhatsApp plateforme.
 *
 * Mêmes garanties que platform-email : list, getCredentials masqué,
 * setCredentials avec merge des secrets, healthcheck Twilio mocké.
 */

jest.mock('axios');
import axios from 'axios';

import { PlatformTelecomService, SECRET_MASK } from '../../../src/modules/platform-telecom/platform-telecom.service';

describe('PlatformTelecomService', () => {
  let svc: PlatformTelecomService;
  let prismaMock: any;
  let secretsMock: any;

  beforeEach(() => {
    prismaMock = {
      telecomProviderState: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert:   jest.fn().mockResolvedValue({}),
      },
    };
    secretsMock = {
      getSecretObject: jest.fn(),
      putSecret:       jest.fn().mockResolvedValue(undefined),
    };
    svc = new PlatformTelecomService(prismaMock, secretsMock);
    (axios.get as jest.Mock) = jest.fn();
  });

  it('list renvoie les 2 providers (sms + whatsapp)', async () => {
    secretsMock.getSecretObject.mockResolvedValue({});
    const list = await svc.list();
    expect(list.map(p => p.key)).toEqual(['sms', 'whatsapp']);
    expect(list.every(p => p.vaultPath.startsWith('platform/'))).toBe(true);
    expect(list.every(p => p.configured === false)).toBe(true);
  });

  it('list marque configured=true quand tous les fields requis sont en Vault', async () => {
    secretsMock.getSecretObject.mockResolvedValue({
      ACCOUNT_SID: 'AC123', AUTH_TOKEN: 'tok', FROM_NUMBER: '+14155551234',
    });
    const list = await svc.list();
    expect(list.every(p => p.configured === true)).toBe(true);
  });

  it('getCredentials masque AUTH_TOKEN avec ••••••••', async () => {
    secretsMock.getSecretObject.mockResolvedValue({
      ACCOUNT_SID: 'ACabc', AUTH_TOKEN: 'super-secret', FROM_NUMBER: '+14155551234',
    });
    const out = await svc.getCredentials('sms');
    expect(out.ACCOUNT_SID).toBe('ACabc');
    expect(out.AUTH_TOKEN).toBe(SECRET_MASK);
    expect(out.FROM_NUMBER).toBe('+14155551234');
  });

  it('setCredentials avec AUTH_TOKEN masqué → conserve l\'ancien secret', async () => {
    secretsMock.getSecretObject.mockResolvedValue({
      ACCOUNT_SID: 'ACold', AUTH_TOKEN: 'old-secret', FROM_NUMBER: '+14155551111',
    });
    (axios.get as jest.Mock).mockResolvedValue({ status: 200 });

    await svc.setCredentials('sms', {
      ACCOUNT_SID: 'ACnew',
      AUTH_TOKEN:  SECRET_MASK, // ← masqué : doit garder l'ancien
      FROM_NUMBER: '+14155552222',
    });

    expect(secretsMock.putSecret).toHaveBeenCalledWith('platform/sms', {
      ACCOUNT_SID: 'ACnew',
      AUTH_TOKEN:  'old-secret', // ← préservé
      FROM_NUMBER: '+14155552222',
    });
  });

  it('setCredentials rejette si champ requis manquant', async () => {
    secretsMock.getSecretObject.mockResolvedValue({});
    await expect(
      svc.setCredentials('sms', { ACCOUNT_SID: 'AC123', AUTH_TOKEN: '', FROM_NUMBER: '+14155551111' }),
    ).rejects.toThrow('Champ requis manquant : AUTH_TOKEN');
  });

  it('healthcheck UP si Twilio API renvoie 200', async () => {
    secretsMock.getSecretObject.mockResolvedValue({
      ACCOUNT_SID: 'ACabc', AUTH_TOKEN: 'tok', FROM_NUMBER: '+14155551234',
    });
    (axios.get as jest.Mock).mockResolvedValue({ status: 200 });

    const res = await svc.runHealthcheck('sms');
    expect(res.ok).toBe(true);
    expect(res.status).toBe('UP');
    expect(prismaMock.telecomProviderState.upsert).toHaveBeenCalled();
  });

  it('healthcheck DOWN si Twilio renvoie 401', async () => {
    secretsMock.getSecretObject.mockResolvedValue({
      ACCOUNT_SID: 'ACabc', AUTH_TOKEN: 'wrong', FROM_NUMBER: '+14155551234',
    });
    (axios.get as jest.Mock).mockResolvedValue({ status: 401 });

    const res = await svc.runHealthcheck('whatsapp');
    expect(res.ok).toBe(false);
    expect(res.status).toBe('DOWN');
    expect(res.detail).toContain('auth refusée');
  });

  it('healthcheck DOWN si credentials Vault manquants', async () => {
    secretsMock.getSecretObject.mockResolvedValue({}); // Vault vide
    const res = await svc.runHealthcheck('sms');
    expect(res.ok).toBe(false);
    expect(res.status).toBe('DOWN');
    expect(res.detail).toContain('Credentials manquants');
    // Pas d'appel API Twilio si Vault vide
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('provider inconnu → NotFoundException', async () => {
    await expect(svc.runHealthcheck('unknown' as any)).rejects.toThrow('inconnu');
    await expect(svc.getCredentials('unknown' as any)).rejects.toThrow('inconnu');
  });
});
