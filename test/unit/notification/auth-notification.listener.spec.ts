/**
 * Tests AuthNotificationListener — fan-out EMAIL only sur les 5 events sécurité.
 */
import { AuthNotificationListener } from '../../../src/modules/notification/auth-notification.listener';
import { EventTypes } from '../../../src/common/types/domain-event.type';

describe('AuthNotificationListener', () => {
  let prismaMock: any, notificationsMock: any, eventBusMock: any;
  let listener: AuthNotificationListener;

  beforeEach(() => {
    prismaMock = {
      user:   { findFirst: jest.fn().mockResolvedValue({ name: 'Awa Diallo', email: 'awa@example.com' }) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'Trans Express CG', language: 'fr' }) },
    };
    notificationsMock = { send: jest.fn().mockResolvedValue(true) };
    eventBusMock      = { subscribe: jest.fn(), publish: jest.fn() };
    listener = new AuthNotificationListener(prismaMock, notificationsMock, eventBusMock);
  });

  function fire(eventType: string, payload: any) {
    listener.onModuleInit();
    const handler = eventBusMock.subscribe.mock.calls.find((c: any[]) => c[0] === eventType)[1];
    return handler({
      id: 'evt', type: eventType, tenantId: 'T1',
      aggregateId: payload.userId ?? 'U1', aggregateType: 'User',
      payload, occurredAt: new Date(),
    });
  }

  it('subscribe aux 5 events Auth', () => {
    listener.onModuleInit();
    const types = eventBusMock.subscribe.mock.calls.map((c: any[]) => c[0]);
    expect(types).toEqual(expect.arrayContaining([
      EventTypes.AUTH_PASSWORD_RESET_LINK,
      EventTypes.AUTH_PASSWORD_RESET_COMPLETED,
      EventTypes.AUTH_EMAIL_VERIFICATION_SENT,
      EventTypes.AUTH_MFA_ENABLED,
      EventTypes.AUTH_MFA_DISABLED,
    ]));
  });

  it('AUTH_PASSWORD_RESET_LINK envoie EMAIL avec bouton', async () => {
    await fire(EventTypes.AUTH_PASSWORD_RESET_LINK, {
      userId: 'U1', email: 'awa@example.com',
      resetUrl: 'https://x.translog.pro/auth/reset?token=abc',
      expiresAt: '2026-04-27T09:00:00Z', tenantSlug: 'x', source: 'self',
    });
    expect(notificationsMock.send).toHaveBeenCalledTimes(1);
    const call = notificationsMock.send.mock.calls[0][0];
    expect(call.channel).toBe('EMAIL');
    expect(call.email).toBe('awa@example.com');
    expect(call.html).toContain('https://x.translog.pro/auth/reset');
  });

  it('AUTH_PASSWORD_RESET_COMPLETED inclut l\'IP dans le mail', async () => {
    await fire(EventTypes.AUTH_PASSWORD_RESET_COMPLETED, {
      userId: 'U1', email: 'awa@example.com',
      completedAt: '2026-04-27T08:42:00Z', ipAddress: '192.0.2.42',
    });
    expect(notificationsMock.send.mock.calls[0][0].html).toContain('192.0.2.42');
  });

  it('AUTH_MFA_DISABLED dispatche en alerte sécurité', async () => {
    await fire(EventTypes.AUTH_MFA_DISABLED, {
      userId: 'U1', email: 'awa@example.com', factor: 'TOTP', by: 'self',
    });
    const call = notificationsMock.send.mock.calls[0][0];
    expect(call.title).toContain('désactivée');
    expect(call.html).toContain('alerte sécurité');
  });

  it('skip si payload sans email', async () => {
    await fire(EventTypes.AUTH_PASSWORD_RESET_LINK, { userId: 'U1' });
    expect(notificationsMock.send).not.toHaveBeenCalled();
  });

  it('langue tenant en (en)', async () => {
    prismaMock.tenant.findUnique.mockResolvedValueOnce({ name: 'X Corp', language: 'en' });
    await fire(EventTypes.AUTH_PASSWORD_RESET_LINK, {
      userId: 'U1', email: 'john@example.com',
      resetUrl: 'https://x.translog.pro/auth/reset?token=abc',
    });
    const call = notificationsMock.send.mock.calls[0][0];
    expect(call.title).toContain('Reset your password');
  });

  it('userName fallback à email si user introuvable', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce(null);
    await fire(EventTypes.AUTH_PASSWORD_RESET_LINK, {
      userId: 'U-MISSING', email: 'unknown@example.com',
      resetUrl: 'https://x.translog.pro/auth/reset?token=abc',
    });
    const call = notificationsMock.send.mock.calls[0][0];
    expect(call.html).toContain('unknown@example.com'); // utilisé comme userName
  });

  it('templateId mapping correct pour chaque event', async () => {
    await fire(EventTypes.AUTH_PASSWORD_RESET_LINK, { userId: 'U1', email: 'a@b' });
    expect(notificationsMock.send.mock.calls[0][0].templateId).toBe('auth.password_reset.link');
    notificationsMock.send.mockClear();
    await fire(EventTypes.AUTH_MFA_ENABLED, { userId: 'U1', email: 'a@b', factor: 'TOTP' });
    expect(notificationsMock.send.mock.calls[0][0].templateId).toBe('auth.mfa.enabled');
  });
});
