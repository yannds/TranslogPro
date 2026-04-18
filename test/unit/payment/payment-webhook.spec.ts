import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PaymentWebhookController } from '../../../src/infrastructure/payment/payment-webhook.controller';

describe('PaymentWebhookController', () => {
  let controller: PaymentWebhookController;
  let registry: any;
  let orchestrator: any;
  let provider: any;

  function makeReq(opts: { rawBody?: Buffer; headers?: Record<string, string> } = {}): any {
    return { rawBody: opts.rawBody, headers: opts.headers ?? {} };
  }

  beforeEach(() => {
    provider = {
      webhookSignatureHeader: 'verif-hash',
      verifyWebhook: jest.fn(),
    };
    registry     = { get: jest.fn() };
    orchestrator = { applyWebhook: jest.fn() };
    controller   = new PaymentWebhookController(registry, orchestrator);
  });

  it('400 si providerKey inconnu', async () => {
    registry.get.mockReturnValue(undefined);
    await expect(controller.handle('unknown', makeReq({ rawBody: Buffer.from('{}') })))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('400 si rawBody absent', async () => {
    registry.get.mockReturnValue(provider);
    await expect(controller.handle('flw', makeReq())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('401 si signature absente', async () => {
    registry.get.mockReturnValue(provider);
    await expect(controller.handle('flw', makeReq({ rawBody: Buffer.from('{}'), headers: {} })))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('remonte UnauthorizedException si signature invalide (provider rejette)', async () => {
    registry.get.mockReturnValue(provider);
    provider.verifyWebhook.mockRejectedValue(new UnauthorizedException('bad sig'));
    await expect(controller.handle('flw', makeReq({
      rawBody: Buffer.from('{}'),
      headers: { 'verif-hash': 'deadbeef' },
    }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('200 + applyWebhook appelé si signature OK', async () => {
    registry.get.mockReturnValue(provider);
    provider.verifyWebhook.mockResolvedValue({
      isValid: true, txRef: 'INT1', externalRef: 'EXT1', status: 'SUCCESSFUL', amount: 1000, currency: 'XAF',
    });
    const res = await controller.handle('flw', makeReq({
      rawBody: Buffer.from('{"data":{}}'),
      headers: { 'verif-hash': 'deadbeef' },
    }));
    expect(res).toEqual({ received: true });
    expect(orchestrator.applyWebhook).toHaveBeenCalledWith('flw', expect.objectContaining({ txRef: 'INT1' }));
  });

  it('200 même si applyWebhook échoue (on n’alimente pas les retries)', async () => {
    registry.get.mockReturnValue(provider);
    provider.verifyWebhook.mockResolvedValue({
      isValid: true, txRef: 'X', externalRef: 'Y', status: 'SUCCESSFUL', amount: 1, currency: 'XAF',
    });
    orchestrator.applyWebhook.mockRejectedValue(new Error('DB down'));
    const res = await controller.handle('flw', makeReq({
      rawBody: Buffer.from('{}'),
      headers: { 'verif-hash': 'x' },
    }));
    expect(res).toEqual({ received: true });
  });

  it('respecte la casse du header — header lookup lowercase', async () => {
    registry.get.mockReturnValue({ ...provider, webhookSignatureHeader: 'X-Paystack-Signature' });
    provider.verifyWebhook.mockResolvedValue({
      isValid: true, txRef: 'A', externalRef: 'B', status: 'SUCCESSFUL', amount: 1, currency: 'NGN',
    });
    // Express normalise les headers en lowercase → on simule ce comportement.
    const res = await controller.handle('ps', makeReq({
      rawBody: Buffer.from('{}'),
      headers: { 'x-paystack-signature': 'sig' },
    }));
    expect(res).toEqual({ received: true });
  });
});
