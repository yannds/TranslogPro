import { createHmac, randomBytes } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { MtnMomoCgProvider } from '../../../src/infrastructure/payment/providers/mtn-momo-cg.provider';
import { AirtelMoneyCgProvider } from '../../../src/infrastructure/payment/providers/airtel-cg.provider';
import { WaveProvider } from '../../../src/infrastructure/payment/providers/wave.provider';

/**
 * Tests unitaires minimaux des 3 connecteurs cibles :
 *   - métadonnées correctes (méthodes/pays/devises)
 *   - supports() filtre correctement
 *   - webhookSignatureHeader présent
 *   - verifyWebhook rejette une mauvaise signature (HMAC constant-time)
 */

function makeSecretService(obj: Record<string, string>): any {
  return {
    getSecretObject: jest.fn().mockResolvedValue(obj),
    getSecret:       jest.fn(),
    putSecret:       jest.fn(),
    issueCertificate: jest.fn(),
    healthCheck:     jest.fn(),
  };
}

describe('MtnMomoCgProvider — meta & webhook', () => {
  const hmacKey = 'secret-key';
  let prov: MtnMomoCgProvider;

  beforeEach(() => {
    prov = new MtnMomoCgProvider(makeSecretService({
      COLLECTION_SUBSCRIPTION_KEY: 'col-sub',
      COLLECTION_API_USER:         'col-usr',
      COLLECTION_API_KEY:          'col-key',
      DISBURSEMENT_SUBSCRIPTION_KEY: 'dis-sub',
      DISBURSEMENT_API_USER:       'dis-usr',
      DISBURSEMENT_API_KEY:        'dis-key',
      TARGET_ENVIRONMENT:          'sandbox',
      WEBHOOK_HMAC_KEY:            hmacKey,
    }));
  });

  it('meta cible CG / XAF / MOBILE_MONEY', () => {
    expect(prov.meta.key).toBe('mtn_momo_cg');
    expect(prov.meta.supportedCountries).toEqual(['CG']);
    expect(prov.meta.supportedCurrencies).toEqual(['XAF']);
    expect(prov.meta.supportedMethods).toEqual(['MOBILE_MONEY']);
    expect(prov.webhookSignatureHeader).toBe('x-mtn-signature');
  });

  it('supports filtre correctement', () => {
    expect(prov.supports({ country: 'CG', method: 'MOBILE_MONEY', currency: 'XAF' })).toBe(true);
    expect(prov.supports({ country: 'SN', method: 'MOBILE_MONEY', currency: 'XAF' })).toBe(false);
    expect(prov.supports({ country: 'CG', method: 'CARD',         currency: 'XAF' })).toBe(false);
  });

  it('verifyWebhook rejette signature incorrecte', async () => {
    const body = Buffer.from(JSON.stringify({ externalId: 'E1', status: 'SUCCESSFUL', amount: 100, currency: 'XAF' }));
    await expect(prov.verifyWebhook(body, 'deadbeef'.repeat(8))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('verifyWebhook accepte signature valide et extrait les champs', async () => {
    const body = Buffer.from(JSON.stringify({
      externalId: 'tx-1', referenceId: 'ref-1', status: 'SUCCESSFUL', amount: 1500, currency: 'XAF',
    }));
    const sig = createHmac('sha256', hmacKey).update(body).digest('hex');
    const res = await prov.verifyWebhook(body, sig);
    expect(res.isValid).toBe(true);
    expect(res.txRef).toBe('tx-1');
    expect(res.externalRef).toBe('ref-1');
    expect(res.status).toBe('SUCCESSFUL');
    expect(res.amount).toBe(1500);
  });
});

describe('AirtelMoneyCgProvider — meta & webhook', () => {
  const hmacKey = 'airtel-hmac';
  let prov: AirtelMoneyCgProvider;

  beforeEach(() => {
    prov = new AirtelMoneyCgProvider(makeSecretService({
      CLIENT_ID:        'cid',
      CLIENT_SECRET:    'csec',
      X_COUNTRY:        'CG',
      X_CURRENCY:       'XAF',
      WEBHOOK_HMAC_KEY: hmacKey,
    }));
  });

  it('meta cible CG / XAF / MOBILE_MONEY', () => {
    expect(prov.meta.key).toBe('airtel_cg');
    expect(prov.meta.supportedCountries).toEqual(['CG']);
    expect(prov.webhookSignatureHeader).toBe('x-airtel-signature');
  });

  it('verifyWebhook HMAC-SHA256 correct', async () => {
    const body = Buffer.from(JSON.stringify({
      transaction: { id: 'a1', airtel_money_id: 'am-1', status_code: 'TS', amount: 500, currency: 'XAF' },
    }));
    const sig = createHmac('sha256', hmacKey).update(body).digest('hex');
    const res = await prov.verifyWebhook(body, sig);
    expect(res.status).toBe('SUCCESSFUL');
    expect(res.externalRef).toBe('am-1');
  });

  it('verifyWebhook rejette signature tamperée', async () => {
    const body = Buffer.from('{"transaction":{"id":"x"}}');
    await expect(prov.verifyWebhook(body, 'a'.repeat(64))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('WaveProvider — meta & webhook', () => {
  const hmacKey = 'wave-whs';
  let prov: WaveProvider;

  beforeEach(() => {
    prov = new WaveProvider(makeSecretService({ API_KEY: 'k', WEBHOOK_SECRET: hmacKey }));
  });

  it('meta multi-pays XOF', () => {
    expect(prov.meta.key).toBe('wave');
    expect(prov.meta.supportedCountries).toEqual(expect.arrayContaining(['SN', 'CI']));
    expect(prov.meta.supportedCurrencies).toEqual(['XOF']);
    expect(prov.webhookSignatureHeader).toBe('wave-signature');
  });

  it('verifyWebhook signature `t=..,v1=..` valide', async () => {
    const ts   = '1700000000';
    const body = Buffer.from(JSON.stringify({ data: { id: 'sess_1', client_reference: 'tx1', payment_status: 'succeeded', amount: 100, currency: 'XOF' } }));
    const payload = `${ts}.${body.toString('utf8')}`;
    const sig  = createHmac('sha256', hmacKey).update(payload).digest('hex');
    const res = await prov.verifyWebhook(body, `t=${ts},v1=${sig}`);
    expect(res.isValid).toBe(true);
    expect(res.externalRef).toBe('sess_1');
    expect(res.status).toBe('SUCCESSFUL');
  });

  it('verifyWebhook rejette format malformé', async () => {
    await expect(prov.verifyWebhook(Buffer.from('{}'), 'oops')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('verifyWebhook rejette signature incorrecte', async () => {
    const ts = '1';
    await expect(prov.verifyWebhook(Buffer.from('{}'), `t=${ts},v1=${'a'.repeat(64)}`))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });
});
