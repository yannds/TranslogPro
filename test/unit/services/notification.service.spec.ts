/**
 * NotificationService — Tests unitaires
 *
 * Ce qui est testé :
 *   - send()               : consulte les prefs avec tenantId dans le WHERE
 *   - getPreferences()     : filtre par (tenantId, userId), retourne defaults
 *                            si la ligne appartient à un autre tenant
 *   - upsertPreferences()  : ne met JAMAIS à jour une ligne d'un autre tenant
 *                            (crée à la place)
 *
 * Objectif sécurité : verrouiller la règle "tenantId racine de toute requête"
 * — même si userId est @unique aujourd'hui, on se protège contre un futur
 * passage multi-tenant user.
 */
import { NotificationService } from '@modules/notification/notification.service';
import { PrismaService }        from '@infra/database/prisma.service';
import {
  SMS_SERVICE,
  WHATSAPP_SERVICE,
} from '@infra/notification/interfaces/sms.interface';
import { EMAIL_SERVICE } from '@infra/notification/interfaces/email.interface';

const TENANT_A = 'tenant-A';
const TENANT_B = 'tenant-B';
const USER_ID  = 'user-shared';

function makeService(prismaOverrides: Record<string, any>) {
  const prisma = {
    notificationPreference: {
      findFirst: jest.fn(),
      update:    jest.fn(),
      create:    jest.fn(),
      ...prismaOverrides.notificationPreference,
    },
    notification: {
      create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
      update: jest.fn().mockResolvedValue({}),
      ...prismaOverrides.notification,
    },
  } as unknown as PrismaService;

  const smsSvc   = { send: jest.fn().mockResolvedValue({ providerId: 'sid-1' }) } as any;
  const waSvc    = { send: jest.fn().mockResolvedValue({ providerId: 'wa-1'  }) } as any;
  const emailSvc = { send: jest.fn().mockResolvedValue({ providerId: 'eml-1' }) } as any;

  return {
    prisma,
    service: new NotificationService(prisma, smsSvc, waSvc, emailSvc),
  };
}

describe('NotificationService — tenant isolation', () => {
  describe('getPreferences()', () => {
    it('appelle findFirst avec tenantId dans le WHERE (jamais findUnique)', async () => {
      const findFirst = jest.fn().mockResolvedValue(null);
      const { service, prisma } = makeService({
        notificationPreference: { findFirst },
      });

      await service.getPreferences(TENANT_A, USER_ID);

      expect(findFirst).toHaveBeenCalledWith({
        where: { tenantId: TENANT_A, userId: USER_ID },
      });
      // findUnique non utilisé → garantit qu'on ne lit pas par userId seul
      expect((prisma.notificationPreference as any).findUnique).toBeUndefined();
    });

    it('retourne les defaults si aucune pref pour (tenantId, userId)', async () => {
      const { service } = makeService({
        notificationPreference: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      });

      const result = await service.getPreferences(TENANT_A, USER_ID);

      expect(result).toEqual({
        id:       null,
        userId:   USER_ID,
        tenantId: TENANT_A,
        sms:      true,
        whatsapp: true,
        push:     true,
        email:    false,
      });
    });

    it('retourne les defaults si la pref existante est d\'un autre tenant (fuite bloquée)', async () => {
      // findFirst contrainte par tenantId → pref du tenant B invisible depuis tenant A
      const findFirst = jest.fn().mockImplementation(({ where }: any) => {
        if (where.tenantId === TENANT_B) {
          return Promise.resolve({
            id: 'p-leak', tenantId: TENANT_B, userId: USER_ID,
            sms: false, whatsapp: false, push: false, email: true,
          });
        }
        return Promise.resolve(null);
      });
      const { service } = makeService({ notificationPreference: { findFirst } });

      const result = await service.getPreferences(TENANT_A, USER_ID);

      expect(result.id).toBeNull();
      expect(result.tenantId).toBe(TENANT_A);
      expect(result.sms).toBe(true);
    });
  });

  describe('upsertPreferences()', () => {
    it('crée une nouvelle ligne si aucune pref existante pour (tenantId, userId)', async () => {
      const findFirst = jest.fn().mockResolvedValue(null);
      const create    = jest.fn().mockResolvedValue({ id: 'p-new', tenantId: TENANT_A });
      const update    = jest.fn();
      const { service } = makeService({
        notificationPreference: { findFirst, create, update },
      });

      await service.upsertPreferences(TENANT_A, USER_ID, { sms: false });

      expect(findFirst).toHaveBeenCalledWith({
        where:  { tenantId: TENANT_A, userId: USER_ID },
        select: { id: true },
      });
      expect(create).toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it('met à jour la ligne uniquement si elle appartient au bon tenant', async () => {
      const findFirst = jest.fn().mockResolvedValue({ id: 'p-own' });
      const update    = jest.fn().mockResolvedValue({ id: 'p-own' });
      const create    = jest.fn();
      const { service } = makeService({
        notificationPreference: { findFirst, update, create },
      });

      await service.upsertPreferences(TENANT_A, USER_ID, { email: true });

      expect(update).toHaveBeenCalledWith({
        where: { id: 'p-own' },
        data:  { email: true },
      });
      expect(create).not.toHaveBeenCalled();
    });

    it('ne tente JAMAIS un update sur le record d\'un autre tenant (findFirst retourne null pour tenant A)', async () => {
      // Même userId que le tenant B mais on requête comme tenant A
      const findFirst = jest.fn().mockImplementation(({ where }: any) =>
        where.tenantId === TENANT_B
          ? Promise.resolve({ id: 'p-B' })
          : Promise.resolve(null),
      );
      const update = jest.fn();
      const create = jest.fn().mockResolvedValue({ id: 'p-A-new', tenantId: TENANT_A });
      const { service } = makeService({
        notificationPreference: { findFirst, update, create },
      });

      await service.upsertPreferences(TENANT_A, USER_ID, { push: false });

      expect(update).not.toHaveBeenCalled();
      expect(create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT_A,
          userId:   USER_ID,
          push:     false,
        }),
      }));
    });
  });

  describe('send() — consulte les prefs tenant-scoped', () => {
    it('passe tenantId au findFirst lors de la vérification des préférences', async () => {
      const findFirst = jest.fn().mockResolvedValue({
        sms: true, whatsapp: true, push: true, email: false,
      });
      const { service } = makeService({
        notificationPreference: { findFirst },
      });

      await service.send({
        tenantId:   TENANT_A,
        userId:     USER_ID,
        channel:    'IN_APP',
        templateId: 'tpl-x',
        body:       'hello',
      });

      expect(findFirst).toHaveBeenCalledWith({
        where: { tenantId: TENANT_A, userId: USER_ID },
      });
    });
  });
});
