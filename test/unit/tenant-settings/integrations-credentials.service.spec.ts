/**
 * Unit tests — IntegrationsService : BYO-credentials (PUT/DELETE/GET schema).
 *
 * Vault et Prisma sont mockés — pas de DB ni Vault réels.
 *
 * Cas couverts :
 *   1. getCredentialSchema — provider connu / inconnu
 *   2. saveCredentials — écriture Vault + upsert DB (creation + update)
 *   3. saveCredentials — validation champs requis manquants
 *   4. saveCredentials — rejet de champs non déclarés dans le schéma
 *   5. saveCredentials — rétrogradation LIVE → SANDBOX si mode courant = LIVE
 *   6. saveCredentials — mode reste DISABLED si nouveau provider
 *   7. deleteCredentials — suppression Vault + suppression row tenant (fallback plateforme)
 *   8. deleteCredentials — sans row plateforme → mode DISABLED
 *   9. deleteCredentials — provider inconnu → NotFoundException
 *  10. deleteCredentials — row tenant absente → NotFoundException
 *  11. saveCredentials — path Vault = tenants/<tid>/payments/<key>
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IntegrationsService } from '../../../src/modules/tenant-settings/integrations.service';

const TENANT_ID   = 'tenant-abc';
const PROVIDER    = 'wave';
const ACTOR       = 'user-admin-1';

const WAVE_SCHEMA = [
  { key: 'API_KEY',        label: 'API Key',        type: 'password', required: true },
  { key: 'WEBHOOK_SECRET', label: 'Webhook Secret', type: 'password', required: true },
  { key: 'BASE_URL',       label: 'Base URL',        type: 'text',    required: false },
];

function buildMocks(opts: {
  schema?:      typeof WAVE_SCHEMA | null;
  tenantRow?:   any;
  platformRow?: any;
}) {
  const vault: any = {
    putSecret:    jest.fn().mockResolvedValue(undefined),
    deleteSecret: jest.fn().mockResolvedValue(undefined),
  };

  const paymentReg: any = {
    getCredentialSchema: jest.fn().mockReturnValue(opts.schema === undefined ? WAVE_SCHEMA : opts.schema),
    get: jest.fn().mockReturnValue({
      meta: {
        displayName:         'Wave',
        supportedMethods:    ['MOBILE_MONEY'],
        supportedCountries:  ['SN'],
        supportedCurrencies: ['XOF'],
      },
    }),
  };

  const prisma: any = {
    paymentProviderState: {
      findFirst:  jest.fn().mockImplementation(({ where }: any) => {
        if (where?.tenantId === TENANT_ID)  return Promise.resolve(opts.tenantRow   ?? null);
        if (where?.tenantId === null)        return Promise.resolve(opts.platformRow ?? null);
        if (where?.OR) {
          if (where.OR.find((c: any) => c.tenantId === TENANT_ID)) return Promise.resolve(opts.tenantRow ?? null);
          return Promise.resolve(opts.platformRow ?? null);
        }
        return Promise.resolve(null);
      }),
      findMany:   jest.fn().mockResolvedValue([]),
      create:     jest.fn().mockImplementation((args: any) => Promise.resolve(args.data)),
      update:     jest.fn().mockImplementation((args: any) => Promise.resolve(args.data)),
      delete:     jest.fn().mockResolvedValue({}),
    },
  };

  // listPaymentHydrated est appelée après saveCredentials pour retourner l'item à jour.
  // On réimplémente partiellement en mockant la méthode instanciée.
  const svc = new IntegrationsService(prisma, paymentReg, {} as any, vault);
  jest.spyOn(svc as any, 'listPaymentHydrated').mockResolvedValue([{
    category: 'PAYMENT', key: PROVIDER, displayName: 'Wave', mode: 'DISABLED',
    methods: [], countries: [], currencies: [], healthStatus: 'UNKNOWN',
    lastHealthCheckAt: null, secretsConfigured: true, vaultPathPreview: 'tenants/…/wave',
    activatedAt: null, activatedBy: null, scopedToTenant: true, notes: null,
  }]);

  return { svc, vault, paymentReg, prisma };
}

describe('IntegrationsService — BYO credentials', () => {
  describe('getCredentialSchema', () => {
    it('retourne le schéma du provider', () => {
      const { svc } = buildMocks({});
      const res = svc.getCredentialSchema(PROVIDER);
      expect(res.providerKey).toBe(PROVIDER);
      expect(res.fields).toHaveLength(WAVE_SCHEMA.length);
    });

    it('lève NotFoundException si provider inconnu', () => {
      const { svc } = buildMocks({ schema: null });
      expect(() => svc.getCredentialSchema('unknown')).toThrow(NotFoundException);
    });
  });

  describe('saveCredentials', () => {
    const validCreds = { API_KEY: 'wave_key', WEBHOOK_SECRET: 'whsec_abc' };

    it('écrit dans Vault au chemin tenants/<tenantId>/payments/<providerKey>', async () => {
      const { svc, vault } = buildMocks({});
      await svc.saveCredentials(TENANT_ID, PROVIDER, { credentials: validCreds }, ACTOR);
      expect(vault.putSecret).toHaveBeenCalledWith(
        `tenants/${TENANT_ID}/payments/${PROVIDER}`,
        validCreds,
      );
    });

    it('crée la row DB si elle n\'existe pas encore', async () => {
      const { svc, prisma } = buildMocks({ tenantRow: null });
      await svc.saveCredentials(TENANT_ID, PROVIDER, { credentials: validCreds }, ACTOR);
      expect(prisma.paymentProviderState.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          tenantId:   TENANT_ID,
          providerKey: PROVIDER,
          vaultPath:  `tenants/${TENANT_ID}/payments/${PROVIDER}`,
          mode:       'DISABLED',
        }),
      }));
    });

    it('met à jour la row DB si elle existe déjà (mode SANDBOX conservé)', async () => {
      const existing = { id: 'row-1', mode: 'SANDBOX', activatedAt: null, activatedBy: null, notes: null };
      const { svc, prisma } = buildMocks({ tenantRow: existing });
      await svc.saveCredentials(TENANT_ID, PROVIDER, { credentials: validCreds }, ACTOR);
      expect(prisma.paymentProviderState.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ mode: 'SANDBOX', vaultPath: `tenants/${TENANT_ID}/payments/${PROVIDER}` }),
      }));
    });

    it('rétrograde LIVE → SANDBOX lors d\'une rotation de credentials', async () => {
      const existing = { id: 'row-1', mode: 'LIVE', activatedAt: new Date(), activatedBy: ACTOR, notes: null };
      const { svc, prisma } = buildMocks({ tenantRow: existing });
      await svc.saveCredentials(TENANT_ID, PROVIDER, { credentials: validCreds }, ACTOR);
      expect(prisma.paymentProviderState.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ mode: 'SANDBOX' }),
      }));
    });

    it('lève BadRequestException si un champ requis est absent', async () => {
      const { svc } = buildMocks({});
      await expect(
        svc.saveCredentials(TENANT_ID, PROVIDER, { credentials: { API_KEY: 'k' } }, ACTOR),
      ).rejects.toThrow(BadRequestException);
    });

    it('lève BadRequestException si un champ hors schéma est envoyé', async () => {
      const { svc } = buildMocks({});
      await expect(
        svc.saveCredentials(TENANT_ID, PROVIDER, {
          credentials: { ...validCreds, INJECTED_FIELD: 'evil' },
        }, ACTOR),
      ).rejects.toThrow(BadRequestException);
    });

    it('lève NotFoundException si le provider est inconnu', async () => {
      const { svc } = buildMocks({ schema: null });
      await expect(
        svc.saveCredentials(TENANT_ID, 'unknown_prov', { credentials: validCreds }, ACTOR),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteCredentials', () => {
    it('supprime dans Vault et la row DB si une row plateforme existe (fallback)', async () => {
      const tenantRow  = { id: 'row-t', tenantId: TENANT_ID, providerKey: PROVIDER, vaultPath: `tenants/${TENANT_ID}/payments/${PROVIDER}`, mode: 'SANDBOX' };
      const platformRow = { id: 'row-p', tenantId: null, providerKey: PROVIDER };
      const { svc, vault, prisma } = buildMocks({ tenantRow, platformRow });
      const res = await svc.deleteCredentials(TENANT_ID, PROVIDER);
      expect(vault.deleteSecret).toHaveBeenCalledWith(`tenants/${TENANT_ID}/payments/${PROVIDER}`);
      expect(prisma.paymentProviderState.delete).toHaveBeenCalledWith({ where: { id: 'row-t' } });
      expect(res).toEqual({ deleted: true, fallback: 'platform' });
    });

    it('passe mode=DISABLED (sans suppression DB) si pas de row plateforme', async () => {
      const tenantRow = { id: 'row-t', tenantId: TENANT_ID, providerKey: PROVIDER, vaultPath: `tenants/${TENANT_ID}/payments/${PROVIDER}`, mode: 'SANDBOX' };
      const { svc, vault, prisma } = buildMocks({ tenantRow, platformRow: null });
      const res = await svc.deleteCredentials(TENANT_ID, PROVIDER);
      expect(vault.deleteSecret).toHaveBeenCalled();
      expect(prisma.paymentProviderState.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ mode: 'DISABLED' }),
      }));
      expect(res).toEqual({ deleted: true, fallback: 'none' });
    });

    it('lève NotFoundException si le provider est inconnu', async () => {
      const { svc, paymentReg } = buildMocks({});
      paymentReg.get.mockReturnValue(undefined);
      await expect(svc.deleteCredentials(TENANT_ID, 'unknown')).rejects.toThrow(NotFoundException);
    });

    it('lève NotFoundException si aucune row tenant n\'existe', async () => {
      const { svc } = buildMocks({ tenantRow: null });
      await expect(svc.deleteCredentials(TENANT_ID, PROVIDER)).rejects.toThrow(NotFoundException);
    });

    it('ne supprime PAS Vault si le vaultPath n\'est pas tenant-scoped', async () => {
      const tenantRow = { id: 'row-t', tenantId: TENANT_ID, providerKey: PROVIDER, vaultPath: `platform/payments/${PROVIDER}`, mode: 'DISABLED' };
      const { svc, vault } = buildMocks({ tenantRow });
      await svc.deleteCredentials(TENANT_ID, PROVIDER);
      expect(vault.deleteSecret).not.toHaveBeenCalled();
    });
  });
});
