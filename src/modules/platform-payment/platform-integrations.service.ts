/**
 * PlatformIntegrationsService — gestion des PaymentProviderState au niveau
 * **plateforme** (rows avec `tenantId = null`).
 *
 * Sépare clairement deux scopes :
 *   - Plateforme (tenantId=null) : config par défaut héritée par tous les
 *     tenants. Édité ici par un super-admin (PLATFORM_BILLING_MANAGE_GLOBAL).
 *   - Tenant (tenantId=<id>)     : override par tenant, géré par
 *     IntegrationsService dans tenant-settings/.
 *
 * Règles d'or :
 *   - On ne renvoie JAMAIS un secret. Vault est write-only depuis l'API.
 *   - Le passage en LIVE exige `mfaVerified: true` (step-up MFA côté
 *     controller via decorator dédié).
 *   - Vault path par défaut = provider.meta.defaultVaultPath
 *     (`platform/payments/<key>`). Surchargeable mais non recommandé.
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { PaymentProviderRegistry } from '../../infrastructure/payment/payment-provider.registry';
import { ISecretService, SECRET_SERVICE } from '../../infrastructure/secret/interfaces/secret.interface';
import { CredentialFieldSpec } from '../../infrastructure/payment/providers/types';

export interface PlatformProviderItem {
  key:                string;
  displayName:        string;
  mode:               'DISABLED' | 'SANDBOX' | 'LIVE';
  methods:            string[];
  countries:          string[];
  currencies:         string[];
  supportsSplit:      boolean;
  vaultPath:          string;
  /** Schéma des champs Vault à saisir (rendu UI auto-généré). */
  credentialFields:   CredentialFieldSpec[];
  secretsConfigured:  boolean;
  healthStatus:       'UP' | 'DOWN' | 'DEGRADED' | 'UNKNOWN';
  lastHealthCheckAt:  string | null;
  lastHealthCheckError: string | null;
  activatedAt:        string | null;
  activatedBy:        string | null;
  notes:              string | null;
}

export interface UpdatePlatformProviderModeDto {
  mode:        'DISABLED' | 'SANDBOX' | 'LIVE';
  mfaVerified?: boolean;
  notes?:       string;
}

export interface SavePlatformCredentialsDto {
  credentials: Record<string, string>;
}

@Injectable()
export class PlatformIntegrationsService {
  private readonly log = new Logger(PlatformIntegrationsService.name);

  constructor(
    private readonly prisma:     PrismaService,
    private readonly registry:   PaymentProviderRegistry,
    @Inject(SECRET_SERVICE) private readonly vault: ISecretService,
  ) {}

  /** Liste tous les providers paiement avec leur état au niveau plateforme. */
  async list(): Promise<PlatformProviderItem[]> {
    const rows = await this.prisma.paymentProviderState.findMany({
      where: { tenantId: null },
    });
    return this.registry.list().map(p => {
      const row = rows.find(r => r.providerKey === p.meta.key);
      return {
        key:                p.meta.key,
        displayName:        row?.displayName ?? p.meta.displayName,
        mode:               (row?.mode ?? 'DISABLED') as PlatformProviderItem['mode'],
        methods:            p.meta.supportedMethods,
        countries:          p.meta.supportedCountries,
        currencies:         p.meta.supportedCurrencies,
        supportsSplit:      p.supportsSplit(),
        vaultPath:          row?.vaultPath ?? p.meta.defaultVaultPath,
        credentialFields:   p.meta.credentialFields,
        secretsConfigured:  !!row,  // sondage vrai = healthcheck
        healthStatus:       (row?.lastHealthCheckStatus as PlatformProviderItem['healthStatus']) ?? 'UNKNOWN',
        lastHealthCheckAt:  row?.lastHealthCheckAt?.toISOString() ?? null,
        lastHealthCheckError: row?.lastHealthCheckError ?? null,
        activatedAt:        row?.activatedAt?.toISOString() ?? null,
        activatedBy:        row?.activatedBy ?? null,
        notes:              row?.notes ?? null,
      };
    });
  }

  async updateMode(
    providerKey: string,
    dto:         UpdatePlatformProviderModeDto,
    actorUserId: string,
  ): Promise<PlatformProviderItem> {
    if (dto.mode === 'LIVE' && !dto.mfaVerified) {
      throw new ConflictException('MFA step-up requis pour activer en LIVE');
    }
    const provider = this.registry.get(providerKey);
    if (!provider) throw new NotFoundException(`Provider ${providerKey} inconnu`);

    const existing = await this.prisma.paymentProviderState.findFirst({
      where: { tenantId: null, providerKey },
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
          tenantId:            null,
          providerKey,
          displayName:         provider.meta.displayName,
          vaultPath:           provider.meta.defaultVaultPath,
          supportedMethods:    provider.meta.supportedMethods,
          supportedCountries:  provider.meta.supportedCountries,
          supportedCurrencies: provider.meta.supportedCurrencies,
          ...payload,
        },
      });
    }
    this.log.log(`[PlatformIntegrations] ${providerKey} → ${dto.mode} by ${actorUserId}`);
    return this.findOneOrFail(providerKey);
  }

  /** Sauvegarde des credentials dans Vault (path partagé plateforme). */
  async saveCredentials(
    providerKey: string,
    dto:         SavePlatformCredentialsDto,
    actorUserId: string,
  ): Promise<PlatformProviderItem> {
    const provider = this.registry.get(providerKey);
    if (!provider) throw new NotFoundException(`Provider ${providerKey} inconnu`);

    const schema = provider.meta.credentialFields;
    const missing = schema.filter(f => f.required && !dto.credentials[f.key]?.trim());
    if (missing.length > 0) {
      throw new BadRequestException(
        `Champs requis manquants : ${missing.map(f => f.key).join(', ')}`,
      );
    }
    const allowed = new Set(schema.map(f => f.key));
    const unknown = Object.keys(dto.credentials).filter(k => !allowed.has(k));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Champs non reconnus : ${unknown.join(', ')}`,
      );
    }

    const vaultPath = provider.meta.defaultVaultPath;
    await this.vault.putSecret(vaultPath, dto.credentials);

    const existing = await this.prisma.paymentProviderState.findFirst({
      where: { tenantId: null, providerKey },
    });

    // Sécurité : si on était en LIVE, on retombe à SANDBOX — les creds ont
    // changé, on force une re-validation explicite avant de re-passer LIVE.
    const currentMode = (existing?.mode ?? 'DISABLED') as 'DISABLED' | 'SANDBOX' | 'LIVE';
    const newMode     = currentMode === 'LIVE' ? 'SANDBOX' : currentMode;

    const payload = {
      mode:         newMode,
      vaultPath,
      activatedBy:  existing?.activatedBy ?? actorUserId,
    };

    if (existing) {
      await this.prisma.paymentProviderState.update({ where: { id: existing.id }, data: payload });
    } else {
      await this.prisma.paymentProviderState.create({
        data: {
          tenantId:            null,
          providerKey,
          displayName:         provider.meta.displayName,
          supportedMethods:    provider.meta.supportedMethods,
          supportedCountries:  provider.meta.supportedCountries,
          supportedCurrencies: provider.meta.supportedCurrencies,
          ...payload,
        },
      });
    }
    this.log.log(`[PlatformIntegrations] ${providerKey} credentials saved by ${actorUserId}`);
    return this.findOneOrFail(providerKey);
  }

  async runHealthcheck(providerKey: string): Promise<PlatformProviderItem> {
    const provider = this.registry.get(providerKey);
    if (!provider) throw new NotFoundException(`Provider ${providerKey} inconnu`);

    const health = await provider.healthcheck();
    const existing = await this.prisma.paymentProviderState.findFirst({
      where: { tenantId: null, providerKey },
    });
    if (existing) {
      await this.prisma.paymentProviderState.update({
        where: { id: existing.id },
        data: {
          lastHealthCheckAt:     health.checkedAt,
          lastHealthCheckStatus: health.status,
          lastHealthCheckError:  health.error,
        },
      });
    } else {
      await this.prisma.paymentProviderState.create({
        data: {
          tenantId:            null,
          providerKey,
          displayName:         provider.meta.displayName,
          vaultPath:           provider.meta.defaultVaultPath,
          supportedMethods:    provider.meta.supportedMethods,
          supportedCountries:  provider.meta.supportedCountries,
          supportedCurrencies: provider.meta.supportedCurrencies,
          lastHealthCheckAt:     health.checkedAt,
          lastHealthCheckStatus: health.status,
          lastHealthCheckError:  health.error,
        },
      });
    }
    return this.findOneOrFail(providerKey);
  }

  private async findOneOrFail(providerKey: string): Promise<PlatformProviderItem> {
    const all = await this.list();
    const item = all.find(i => i.key === providerKey);
    if (!item) throw new NotFoundException(`Provider ${providerKey} introuvable`);
    return item;
  }
}
