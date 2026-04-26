/**
 * Tests unit de PlatformEmailService.sendTestEmail() + listTemplates().
 *
 * Couvre :
 *   - listTemplates renvoie le catalogue avec les champs publics (sans render)
 *   - sendTestEmail rend le bon template + remplace recipientNameVar
 *   - Provider inconnu → NotFoundException
 *   - Template inconnu → BadRequestException
 *   - Tag platform-test + category system + tenantId null
 *   - Échec provider → { ok: false, detail }
 */

import { PlatformEmailService } from '../../../src/modules/platform-email/platform-email.service';

describe('PlatformEmailService — testeur plateforme', () => {
  let svc: PlatformEmailService;
  let smtpMock: any;
  let consoleMock: any;

  beforeEach(() => {
    smtpMock    = { send: jest.fn().mockResolvedValue({ messageId: 'smtp-msg-1', provider: 'smtp', sentAt: new Date(), accepted: true }), healthCheck: jest.fn(), providerName: 'smtp' };
    consoleMock = { send: jest.fn().mockResolvedValue({ messageId: 'console-msg-1', provider: 'console', sentAt: new Date(), accepted: false }), healthCheck: jest.fn(), providerName: 'console' };
    const prismaMock = {
      emailProviderState: { findMany: jest.fn(), upsert: jest.fn() },
    } as any;
    const secrets    = { getSecretObject: jest.fn(), putSecret: jest.fn() } as any;
    svc = new PlatformEmailService(prismaMock, consoleMock, smtpMock, {} as any, {} as any, secrets);
  });

  it('listTemplates renvoie le catalogue (au moins lifecycle + invoice + voucher + refund + user + trip + parcel + ticket + auth + subscription)', () => {
    const list = svc.listTemplates();
    const ids = list.map(d => d.id);
    expect(ids).toEqual(expect.arrayContaining([
      'notif.ticket.purchased',
      'invoice.issued',
      'voucher.issued',
      'refund.created',
      'user.invited',
      'trip.cancelled',
      'parcel.registered',
      'ticket.no_show',
      'auth.password_reset.link',
      'subscription.created',
    ]));
    expect(list.length).toBeGreaterThanOrEqual(31); // total après tous les tiers
    // Structure publique : pas de fonction render
    for (const d of list) {
      expect(typeof d.id).toBe('string');
      expect(typeof d.labelFr).toBe('string');
      expect(typeof d.labelEn).toBe('string');
      expect(typeof d.recipientNameVar).toBe('string');
      expect((d as any).render).toBeUndefined();
    }
  });

  it('sendTestEmail rend le template, substitue le nom et envoie via le provider', async () => {
    const res = await svc.sendTestEmail('smtp', {
      templateId: 'invoice.issued',
      toEmail:    'awa@example.com',
      toName:     'Awa Diallo',
      lang:       'fr',
    });

    expect(res.ok).toBe(true);
    expect(res.messageId).toBe('smtp-msg-1');
    expect(smtpMock.send).toHaveBeenCalledTimes(1);
    const sendArg = smtpMock.send.mock.calls[0][0];
    expect(sendArg.to).toEqual({ email: 'awa@example.com', name: 'Awa Diallo' });
    expect(sendArg.subject).toContain('INV-2026-00042');
    expect(sendArg.html).toContain('Awa Diallo'); // recipientNameVar = customerName remplacé
    expect(sendArg.category).toBe('system');
    expect(sendArg.tags).toEqual(expect.arrayContaining(['platform-test', 'template:invoice.issued', 'provider:smtp']));
    expect(sendArg.tenantId).toBeNull();
    expect(sendArg.idempotencyKey).toMatch(/^platform-test:smtp:awa@example.com:/);
  });

  it('lang en utilise le rendu anglais', async () => {
    await svc.sendTestEmail('smtp', {
      templateId: 'invoice.issued',
      toEmail:    'john@example.com',
      toName:     'John',
      lang:       'en',
    });
    const sendArg = smtpMock.send.mock.calls[0][0];
    expect(sendArg.subject).toContain('New invoice');
  });

  it('extraVars surchargent les sampleVars du descripteur', async () => {
    await svc.sendTestEmail('smtp', {
      templateId: 'voucher.issued',
      toEmail:    'awa@example.com',
      toName:     'Awa',
      lang:       'fr',
      extraVars:  { voucherCode: 'CUSTOM-CODE-XYZ' },
    });
    const sendArg = smtpMock.send.mock.calls[0][0];
    expect(sendArg.html).toContain('CUSTOM-CODE-XYZ');
    expect(sendArg.subject).toContain('CUSTOM-CODE-XYZ');
  });

  it('Provider inconnu → NotFoundException', async () => {
    await expect(svc.sendTestEmail('unknown' as any, {
      templateId: 'invoice.issued', toEmail: 'a@b.c', toName: 'X',
    })).rejects.toThrow('inconnu');
  });

  it('Template inconnu → BadRequestException', async () => {
    await expect(svc.sendTestEmail('smtp', {
      templateId: 'foo.bar.baz', toEmail: 'a@b.c', toName: 'X',
    })).rejects.toThrow('inconnu du catalogue');
  });

  it('Échec provider → renvoie { ok: false, detail }', async () => {
    smtpMock.send.mockRejectedValueOnce(new Error('SMTP timeout'));
    const res = await svc.sendTestEmail('smtp', {
      templateId: 'invoice.issued',
      toEmail:    'a@b.c',
      toName:     'X',
    });
    expect(res.ok).toBe(false);
    expect(res.detail).toContain('SMTP timeout');
    expect(res.messageId).toBeUndefined();
  });

  it('Provider console envoie aussi (en mode dev)', async () => {
    const res = await svc.sendTestEmail('console', {
      templateId: 'notif.ticket.purchased',
      toEmail:    'a@b.c',
      toName:     'Marie',
    });
    expect(res.ok).toBe(true);
    expect(res.messageId).toBe('console-msg-1');
    expect(consoleMock.send).toHaveBeenCalledTimes(1);
  });
});
