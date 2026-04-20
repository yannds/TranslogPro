import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { PaymentProviderRegistry } from '../../infrastructure/payment/payment-provider.registry';
import { ISecretService, SECRET_SERVICE } from '../../infrastructure/secret/interfaces/secret.interface';
import { OAuthProviderRegistry } from '../oauth/providers/oauth-provider.registry';
import { defaultOAuthVaultPath } from '../oauth/types';

/**
 * IntegrationsService — vue agrégée des intégrations API du tenant.
 *
 * Catégories :
 *   - PAYMENT    : providers de paiement (MTN/Airtel/Wave/Flutterwave/Paystack)
 *   - AUTH       : providers OAuth (Google/Microsoft/Facebook)
 *   - (futur)    : NOTIFICATION, STORAGE…
 *
 * Règles critiques :
 *   - On ne renvoie JAMAIS de secret. Uniquement la mention « secret configuré ✓ »,
 *     l'empreinte tronquée, la date de dernière rotation.
 *   - Le passage DISABLED → SANDBOX peut être fait par tout utilisateur avec
 *     `control.integration.setup.tenant`.
 *   - Le passage en LIVE requiert MFA step-up (implémenté côté controller).
 */

export interface IntegrationItem {
  category:    'PAYMENT' | 'AUTH';
  key:         string;                // 'mtn_momo_cg', 'google', …
  displayName: string;
  mode:        'DISABLED' | 'SANDBOX' | 'LIVE';
  methods:     string[];
  countries:   string[];
  currencies:  string[];
  healthStatus:  'UP' | 'DOWN' | 'DEGRADED' | 'UNKNOWN';
  lastHealthCheckAt: string | null;
  secretsConfigured: boolean;
  /** Empreinte courte du path Vault, affichée sans révéler la valeur. */
  vaultPathPreview:  string;
  activatedAt:       string | null;
  activatedBy:       string | null;
  scopedToTenant:    boolean;
  notes:             string | null;
}

export interface UpdateIntegrationModeDto {
  mode: 'DISABLED' | 'SANDBOX' | 'LIVE';
  /** Obligatoire si mode=LIVE (step-up MFA vérifié côté controller). */
  mfaVerified?: boolean;
  notes?:       string;
}

/** Payload pour PUT /credentials — paires clé/valeur issues du formulaire tenant. */
export interface SaveCredentialsDto {
  /** Map<VaultKey, valeur> — ex: { API_KEY: 'wave_xxx', WEBHOOK_SECRET: 'whsec_yyy' } */
  credentials: Record<string, string>;
}

@Injectable()
export class IntegrationsService {
  private readonly log = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma:        PrismaService,
    private readonly paymentReg:    PaymentProviderRegistry,
    private readonly oauthReg:      OAuthProviderRegistry,
    @Inject(SECRET_SERVICE) private readonly vault: ISecretService,
  ) {}

  /** Liste agrégée pour l'UI Intégrations API. */
  async list(tenantId: string): Promise<IntegrationItem[]> {
    const [payment, auth] = await Promise.all([
      this.listPaymentHydrated(tenantId),
      this.listOAuthHydrated(tenantId),
    ]);
    return [...payment, ...auth];
  }

  /** Enrichit l'item PAYMENT avec les données DB (lastHealthCheck, activatedBy, notes). */
  async listPaymentHydrated(tenantId: string): Promise<IntegrationItem[]> {
    const effective = await this.paymentReg.listEffective(tenantId);
    const rows = await this.prisma.paymentProviderState.findMany({
      where: { OR: [{ tenantId }, { tenantId: null }] },
    });
    return effective.map(e => {
      const dbRow = rows.find(r => r.tenantId === tenantId && r.providerKey === e.providerKey)
                ?? rows.find(r => r.tenantId === null     && r.providerKey === e.providerKey);
      return {
        category:          'PAYMENT' as const,
        key:               e.providerKey,
        displayName:       e.displayName,
        mode:              e.mode,
        methods:           e.meta.supportedMethods,
        countries:         e.meta.supportedCountries,
        currencies:        e.meta.supportedCurrencies,
        healthStatus:      (dbRow?.lastHealthCheckStatus as IntegrationItem['healthStatus']) ?? 'UNKNOWN',
        lastHealthCheckAt: dbRow?.lastHealthCheckAt?.toISOString() ?? null,
        secretsConfigured: !!dbRow,    // placeholder — une sonde réelle est P11 runHealthcheck
        vaultPathPreview:  this.previewVaultPath(e.vaultPath),
        activatedAt:       dbRow?.activatedAt?.toISOString() ?? null,
        activatedBy:       dbRow?.activatedBy ?? null,
        scopedToTenant:    e.scopedToTenant,
        notes:             dbRow?.notes ?? null,
      };
    });
  }

  /**
   * Enrichit les providers OAuth avec :
   *   - leur statut de configuration Vault (`secretsConfigured`)
   *   - leur mode effectif en DB (fallback DISABLED)
   *   - leur dernier healthcheck
   *
   * Tous les providers déclarés sont toujours retournés — même non configurés,
   * pour affichage grisé dans l'UI avec une invitation à provisionner Vault.
   */
  async listOAuthHydrated(tenantId: string): Promise<IntegrationItem[]> {
    const providersWithStatus = await this.oauthReg.listWithStatus();
    const rows = await this.prisma.oAuthProviderState.findMany({
      where: { OR: [{ tenantId }, { tenantId: null }] },
    });

    return providersWithStatus.map(({ meta, configured }) => {
      const dbRow = rows.find(r => r.tenantId === tenantId && r.providerKey === meta.key)
                 ?? rows.find(r => r.tenantId === null     && r.providerKey === meta.key);
      return {
        category:          'AUTH' as const,
        key:               meta.key,
        displayName:       meta.displayName ?? meta.key,
        mode:              (dbRow?.mode as IntegrationItem['mode']) ?? 'DISABLED',
        methods:           [],
        countries:         [],
        currencies:        [],
        healthStatus:      (dbRow?.lastHealthCheckStatus as IntegrationItem['healthStatus']) ?? 'UNKNOWN',
        lastHealthCheckAt: dbRow?.lastHealthCheckAt?.toISOString() ?? null,
        secretsConfigured: configured,
        vaultPathPreview:  this.previewVaultPath(defaultOAuthVaultPath(meta.key)),
        activatedAt:       dbRow?.activatedAt?.toISOString() ?? null,
        activatedBy:       dbRow?.activatedBy ?? null,
        scopedToTenant:    false,
        notes:             dbRow?.notes ?? null,
      };
    });
  }

  /** Change le mode effectif d'un provider paiement pour un tenant. */
  async updatePaymentMode(
    tenantId: string,
    providerKey: string,
    dto: UpdateIntegrationModeDto,
    actorUserId: string,
  ): Promise<IntegrationItem> {
    if (dto.mode === 'LIVE' && !dto.mfaVerified) {
      throw new ConflictException('MFA step-up required for LIVE activation');
    }

    const provider = this.paymentReg.get(providerKey);
    if (!provider) throw new NotFoundException(`Provider ${providerKey} inconnu`);

    const platformRow = await this.prisma.paymentProviderState.findFirst({
      where: { tenantId: null, providerKey },
    });

    const existing = await this.prisma.paymentProviderState.findFirst({
      where: { tenantId, providerKey },
    });

    const payload = {
      mode:        dto.mode,
      notes:       dto.notes,
      activatedAt: dto.mode === 'LIVE' ? new Date() : existing?.activatedAt ?? null,
      activatedBy: dto.mode === 'LIVE' ? actorUserId : existing?.activatedBy ?? null,
    };

    if (existing) {
      await this.prisma.paymentProviderState.update({
        where: { id: existing.id }, data: payload,
      });
    } else {
      await this.prisma.paymentProviderState.create({
        data: {
          tenantId,
          providerKey,
          displayName:         platformRow?.displayName         ?? provider.meta.displayName,
          vaultPath:           platformRow?.vaultPath           ?? provider.meta.defaultVaultPath,
          supportedMethods:    platformRow?.supportedMethods    ?? provider.meta.supportedMethods,
          supportedCountries:  platformRow?.supportedCountries  ?? provider.meta.supportedCountries,
          supportedCurrencies: platformRow?.supportedCurrencies ?? provider.meta.supportedCurrencies,
          ...payload,
        },
      });
    }
    this.log.log(`[Integrations] ${providerKey} tenant=${tenantId} → ${dto.mode} by ${actorUserId}`);
    const hydrated = await this.listPaymentHydrated(tenantId);
    const item = hydrated.find(i => i.key === providerKey);
    if (!item) throw new NotFoundException(`Provider ${providerKey} introuvable après update`);
    return item;
  }

  /**
   * Change le mode effectif d'un provider OAuth pour un tenant.
   * Symétrique à `updatePaymentMode` — mêmes règles (MFA step-up pour LIVE,
   * trace activatedBy/activatedAt).
   */
  async updateOAuthMode(
    tenantId: string,
    providerKey: string,
    dto: UpdateIntegrationModeDto,
    actorUserId: string,
  ): Promise<IntegrationItem> {
    if (dto.mode === 'LIVE' && !dto.mfaVerified) {
      throw new ConflictException('MFA step-up required for LIVE activation');
    }

    const provider = this.oauthReg.get(providerKey);
    if (!provider) throw new NotFoundException(`OAuth provider ${providerKey} inconnu`);

    // On refuse d'activer un provider dont Vault n'a pas les secrets —
    // éviterait une erreur opaque au premier clic utilisateur.
    if (dto.mode !== 'DISABLED') {
      const configured = await provider.isConfigured();
      if (!configured) {
        throw new BadRequestException(
          `OAuth provider ${providerKey} non configuré — provisionner Vault (${defaultOAuthVaultPath(providerKey)}) avant activation`,
        );
      }
    }

    const existing = await this.prisma.oAuthProviderState.findFirst({
      where: { tenantId, providerKey },
    });

    const payload = {
      mode:        dto.mode,
      notes:       dto.notes,
      activatedAt: dto.mode === 'LIVE' ? new Date() : existing?.activatedAt ?? null,
      activatedBy: dto.mode === 'LIVE' ? actorUserId : existing?.activatedBy ?? null,
    };

    if (existing) {
      await this.prisma.oAuthProviderState.update({
        where: { id: existing.id }, data: payload,
      });
    } else {
      await this.prisma.oAuthProviderState.create({
        data: {
          tenantId,
          providerKey,
          displayName: provider.meta.displayName,
          vaultPath:   defaultOAuthVaultPath(providerKey),
          ...payload,
        },
      });
    }
    this.log.log(`[Integrations/OAuth] ${providerKey} tenant=${tenantId} → ${dto.mode} by ${actorUserId}`);
    const hydrated = await this.listOAuthHydrated(tenantId);
    const item = hydrated.find(i => i.key === providerKey);
    if (!item) throw new NotFoundException(`OAuth provider ${providerKey} introuvable après update`);
    return item;
  }

  /**
   * Exécute un healthcheck "live" sur un provider OAuth — tente de lire les
   * credentials Vault et de valider leur présence (pas de test effectif
   * d'appel vers Google/Microsoft/Facebook, qui exigerait un utilisateur).
   * Persiste le résultat dans `oauth_provider_states`.
   */
  async runOAuthHealthcheck(
    tenantId: string,
    providerKey: string,
  ): Promise<{ status: string; error?: string }> {
    const provider = this.oauthReg.get(providerKey);
    if (!provider) throw new NotFoundException(`OAuth provider ${providerKey} inconnu`);

    const configured = await provider.isConfigured();
    const status = configured ? 'UP' : 'DOWN';
    const error  = configured ? undefined : 'Credentials Vault absents ou incomplets';
    const checkedAt = new Date();

    const existing = await this.prisma.oAuthProviderState.findFirst({
      where: { OR: [{ tenantId, providerKey }, { tenantId: null, providerKey }] },
      orderBy: { tenantId: 'desc' },
    });
    if (existing) {
      await this.prisma.oAuthProviderState.update({
        where: { id: existing.id },
        data:  { lastHealthCheckAt: checkedAt, lastHealthCheckStatus: status, lastHealthCheckError: error ?? null },
      });
    } else {
      await this.prisma.oAuthProviderState.create({
        data: {
          tenantId,
          providerKey,
          displayName:           provider.meta.displayName,
          vaultPath:             defaultOAuthVaultPath(providerKey),
          lastHealthCheckAt:     checkedAt,
          lastHealthCheckStatus: status,
          lastHealthCheckError:  error ?? null,
        },
      });
    }
    return { status, error };
  }

  /** Exécute un healthcheck live sur un provider paiement (UI "tester la connexion"). */
  async runPaymentHealthcheck(tenantId: string, providerKey: string): Promise<{ status: string; latencyMs?: number; error?: string }> {
    const provider = this.paymentReg.get(providerKey);
    if (!provider) throw new NotFoundException(`Provider ${providerKey} inconnu`);
    const result = await provider.healthcheck();

    const existing = await this.prisma.paymentProviderState.findFirst({
      where: { OR: [{ tenantId, providerKey }, { tenantId: null, providerKey }] },
      orderBy: { tenantId: 'desc' },
    });
    if (existing) {
      await this.prisma.paymentProviderState.update({
        where: { id: existing.id },
        data:  { lastHealthCheckAt: result.checkedAt, lastHealthCheckStatus: result.status, lastHealthCheckError: result.error ?? null },
      });
    }
    return { status: result.status, latencyMs: result.latencyMs, error: result.error };
  }

  // ─── BYO-credentials (tenant-scoped Vault path) ────────────────────────────

  /** Schéma des champs attendus pour un provider paiement (sert à construire le formulaire UI). */
  getCredentialSchema(providerKey: string) {
    const schema = this.paymentReg.getCredentialSchema(providerKey);
    if (!schema) throw new NotFoundException(`Provider ${providerKey} inconnu`);
    return { providerKey, fields: schema };
  }

  /**
   * Sauvegarde les credentials tenant dans Vault à `tenants/<tenantId>/payments/<providerKey>`,
   * crée/met-à-jour la ligne `paymentProviderState` avec `scopedToTenant=true`,
   * et rétrograde le mode LIVE → SANDBOX si nécessaire (les creds viennent de changer).
   */
  async saveCredentials(
    tenantId:    string,
    providerKey: string,
    dto:         SaveCredentialsDto,
    actorUserId: string,
  ): Promise<IntegrationItem> {
    const schema = this.paymentReg.getCredentialSchema(providerKey);
    if (!schema) throw new NotFoundException(`Provider ${providerKey} inconnu`);

    // Validation des champs requis
    const missing = schema.filter(f => f.required && !dto.credentials[f.key]?.trim());
    if (missing.length > 0) {
      throw new BadRequestException(`Champs requis manquants : ${missing.map(f => f.key).join(', ')}`);
    }

    // Valider que seules les clés déclarées dans le schéma sont envoyées (pas d'injection)
    const allowedKeys = new Set(schema.map(f => f.key));
    const unknown = Object.keys(dto.credentials).filter(k => !allowedKeys.has(k));
    if (unknown.length > 0) {
      throw new BadRequestException(`Champs non reconnus : ${unknown.join(', ')}`);
    }

    const vaultPath = `tenants/${tenantId}/payments/${providerKey}`;
    await this.vault.putSecret(vaultPath, dto.credentials);

    const existing = await this.prisma.paymentProviderState.findFirst({
      where: { tenantId, providerKey },
    });

    // Si le mode était LIVE, on rétrograde à SANDBOX — les creds viennent de changer.
    const currentMode = (existing?.mode ?? 'DISABLED') as 'DISABLED' | 'SANDBOX' | 'LIVE';
    const newMode     = currentMode === 'LIVE' ? 'SANDBOX' : currentMode;

    const provider = this.paymentReg.get(providerKey);
    const platformRow = await this.prisma.paymentProviderState.findFirst({
      where: { tenantId: null, providerKey },
    });

    const payload = {
      mode:         newMode,
      vaultPath,
      activatedAt:  existing?.activatedAt ?? null,
      activatedBy:  existing?.activatedBy ?? actorUserId,
      notes:        existing?.notes ?? null,
    };

    if (existing) {
      await this.prisma.paymentProviderState.update({ where: { id: existing.id }, data: payload });
    } else {
      await this.prisma.paymentProviderState.create({
        data: {
          tenantId,
          providerKey,
          displayName:         platformRow?.displayName         ?? provider?.meta.displayName ?? providerKey,
          supportedMethods:    platformRow?.supportedMethods    ?? provider?.meta.supportedMethods    ?? [],
          supportedCountries:  platformRow?.supportedCountries  ?? provider?.meta.supportedCountries  ?? [],
          supportedCurrencies: platformRow?.supportedCurrencies ?? provider?.meta.supportedCurrencies ?? [],
          ...payload,
        },
      });
    }

    if (currentMode === 'LIVE') {
      this.log.warn(`[Credentials] ${providerKey} tenant=${tenantId} — mode rétrogradé LIVE→SANDBOX suite rotation credentials`);
    }
    this.log.log(`[Credentials] ${providerKey} tenant=${tenantId} — credentials sauvegardés par ${actorUserId}`);

    const hydrated = await this.listPaymentHydrated(tenantId);
    const item = hydrated.find(i => i.key === providerKey);
    if (!item) throw new NotFoundException(`Provider ${providerKey} introuvable après save`);
    return item;
  }

  /**
   * Supprime les credentials tenant-scoped depuis Vault et retire l'override tenant en DB.
   * Si une ligne plateforme existe, le tenant retombe sur elle (mode=DISABLED).
   * Si aucune ligne plateforme, la row DB est supprimée.
   */
  async deleteCredentials(tenantId: string, providerKey: string): Promise<{ deleted: true; fallback: 'platform' | 'none' }> {
    if (!this.paymentReg.get(providerKey)) {
      throw new NotFoundException(`Provider ${providerKey} inconnu`);
    }

    const tenantRow = await this.prisma.paymentProviderState.findFirst({
      where: { tenantId, providerKey },
    });
    if (!tenantRow) throw new NotFoundException(`Aucun credential tenant pour ${providerKey}`);

    // Supprime dans Vault uniquement si le path est bien tenant-scoped
    if (tenantRow.vaultPath.startsWith(`tenants/${tenantId}/`)) {
      await this.vault.deleteSecret(tenantRow.vaultPath);
    }

    const platformRow = await this.prisma.paymentProviderState.findFirst({
      where: { tenantId: null, providerKey },
    });

    if (platformRow) {
      // Retour sur la config plateforme : on efface la row tenant
      await this.prisma.paymentProviderState.delete({ where: { id: tenantRow.id } });
      this.log.log(`[Credentials] ${providerKey} tenant=${tenantId} — credentials supprimés, retour config plateforme`);
      return { deleted: true, fallback: 'platform' };
    } else {
      // Pas de plateforme de repli : on remet le mode à DISABLED
      await this.prisma.paymentProviderState.update({
        where: { id: tenantRow.id },
        data:  { mode: 'DISABLED', vaultPath: `platform/payments/${providerKey}`, activatedAt: null, activatedBy: null },
      });
      this.log.log(`[Credentials] ${providerKey} tenant=${tenantId} — credentials supprimés, mode=DISABLED`);
      return { deleted: true, fallback: 'none' };
    }
  }

  private previewVaultPath(path: string): string {
    // Montre `platform/payments/•••_cg` (masque le milieu)
    const parts = path.split('/');
    const last  = parts[parts.length - 1];
    if (last.length <= 6) return path;
    return [...parts.slice(0, -1), `${last.slice(0, 3)}•••${last.slice(-3)}`].join('/');
  }
}
