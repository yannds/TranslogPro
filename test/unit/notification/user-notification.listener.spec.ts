/**
 * Tests unit de UserNotificationListener — invitation user (USER_INVITED).
 *
 * Particularité : EMAIL only (pas de IN_APP/SMS/WhatsApp).
 */
import { UserNotificationListener } from '../../../src/modules/notification/user-notification.listener';
import { EventTypes } from '../../../src/common/types/domain-event.type';

describe('UserNotificationListener', () => {
  let prismaMock: any;
  let notificationsMock: any;
  let platformConfigMock: any;
  let eventBusMock: any;
  let listener: UserNotificationListener;

  beforeEach(() => {
    prismaMock = { tenant: { findUnique: jest.fn().mockResolvedValue({ language: 'fr' }) } };
    notificationsMock = {
      send: jest.fn().mockResolvedValue(true),
      sendWithChannelFallback: jest.fn().mockResolvedValue('WHATSAPP'),
    };
    platformConfigMock = { getBoolean: jest.fn().mockResolvedValue(true) };
    eventBusMock       = { subscribe: jest.fn(), publish: jest.fn() };
    listener = new UserNotificationListener(
      prismaMock, notificationsMock, platformConfigMock, eventBusMock,
    );
  });

  function fire(payload: any) {
    listener.onModuleInit();
    const handler = eventBusMock.subscribe.mock.calls.find(
      (c: any[]) => c[0] === EventTypes.USER_INVITED,
    )[1];
    return handler({
      id: 'evt-1', type: EventTypes.USER_INVITED,
      tenantId: 'T1', aggregateId: 'U1', aggregateType: 'User',
      payload, occurredAt: new Date(),
    });
  }

  it('subscribe à USER_INVITED au démarrage', () => {
    listener.onModuleInit();
    expect(eventBusMock.subscribe).toHaveBeenCalledWith(EventTypes.USER_INVITED, expect.any(Function));
  });

  it('envoie EMAIL uniquement (pas SMS, pas WhatsApp/SMS fallback)', async () => {
    await fire({
      userId: 'U1', email: 'awa@example.com', name: 'Awa Diallo',
      tenantName: 'Trans Express', tenantSlug: 'trans-express',
      roleName: 'Caissier', agencyName: 'Brazzaville',
      language: 'fr', resetUrl: 'https://trans-express.translog.pro/auth/forgot-password?email=awa',
    });

    expect(notificationsMock.sendWithChannelFallback).not.toHaveBeenCalled();
    expect(notificationsMock.send).toHaveBeenCalledTimes(1);
    const call = notificationsMock.send.mock.calls[0][0];
    expect(call.channel).toBe('EMAIL');
    expect(call.email).toBe('awa@example.com');
    expect(call.templateId).toBe('user.invited');
    expect(call.title).toContain('Trans Express');
    expect(call.html).toContain('https://trans-express.translog.pro');
  });

  it('skip silencieux si payload sans email', async () => {
    await fire({ userId: 'U1', name: 'No Email', tenantName: 'X', resetUrl: '' });
    expect(notificationsMock.send).not.toHaveBeenCalled();
  });

  it('killswitch : skip si lifecycle.enabled = false', async () => {
    platformConfigMock.getBoolean.mockResolvedValue(false);
    await fire({ userId: 'U1', email: 'awa@x.com', name: 'Awa', tenantName: 'X', resetUrl: '' });
    expect(notificationsMock.send).not.toHaveBeenCalled();
  });

  it('langue depuis payload (en) prioritaire sur tenant', async () => {
    await fire({
      userId: 'U1', email: 'john@example.com', name: 'John',
      tenantName: 'Trans Express', tenantSlug: 'trans-express',
      language: 'en', resetUrl: 'https://trans-express.translog.pro/auth/forgot-password?email=john',
    });
    const call = notificationsMock.send.mock.calls[0][0];
    expect(call.title).toContain('Invitation: your');
  });

  it('fallback langue tenant si payload n\'en a pas', async () => {
    prismaMock.tenant.findUnique.mockResolvedValueOnce({ language: 'en' });
    await fire({
      userId: 'U1', email: 'john@example.com', name: 'John',
      tenantName: 'Trans Express', tenantSlug: 'trans-express',
      resetUrl: '',
    });
    const call = notificationsMock.send.mock.calls[0][0];
    expect(call.title).toContain('Invitation: your');
  });

  it('payload incomplet (roleName/agencyName null) — pas de crash', async () => {
    await expect(fire({
      userId: 'U1', email: 'awa@example.com', name: 'Awa',
      tenantName: 'X', tenantSlug: 'x',
      roleName: null, agencyName: null, resetUrl: '',
    })).resolves.not.toThrow();
    expect(notificationsMock.send).toHaveBeenCalledTimes(1);
  });

  it('metadata contient userId + tenantSlug', async () => {
    await fire({
      userId: 'U-XYZ', email: 'a@b.c', name: 'X',
      tenantName: 'T', tenantSlug: 'slug-abc', resetUrl: '',
    });
    expect(notificationsMock.send.mock.calls[0][0].metadata).toEqual({
      userId: 'U-XYZ', tenantSlug: 'slug-abc',
    });
  });
});
