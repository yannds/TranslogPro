/**
 * PaymentProviderRegistry — inventaire runtime des providers de paiement.
 *
 * Calqué sur le pattern OAuthProviderRegistry : un provider est retenu si
 * `isEnabled = true` au démarrage (meta valide) ; l'état effectif par
 * tenant/plateforme (DISABLED | SANDBOX | LIVE) est ensuite résolu via la
 * table PaymentProviderState à chaque requête.
 *
 * Règle clé : la résolution par tenant surcharge la résolution plateforme.
 *   - Si PaymentProviderState(tenantId=<X>, providerKey='mtn_momo_cg') existe → sa mode prime.
 *   - Sinon on retombe sur la ligne plateforme (tenantId=null).
 *   - Sinon le provider est considéré DISABLED (safe default).
 *
 * Le registry ne FAIT AUCUN appel réseau : tout est en mémoire ou DB.
 */
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  CredentialFieldSpec,
  IPaymentProvider,
  PAYMENT_PROVIDERS,
  PaymentProviderMeta,
  ProviderMode,
} from './providers/types';

export interface EffectiveProviderState {
  providerKey: string;
  displayName: string;
  mode:        ProviderMode;
  vaultPath:   string;
  /** true si l'état vient d'une ligne tenant-spécifique, false si du défaut plateforme. */
  scopedToTenant: boolean;
  meta:        PaymentProviderMeta;
}

@Injectable()
export class PaymentProviderRegistry implements OnModuleInit {
  private readonly log = new Logger(PaymentProviderRegistry.name);
  private readonly active = new Map<string, IPaymentProvider>();

  constructor(
    @Inject(PAYMENT_PROVIDERS) private readonly all: IPaymentProvider[],
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    for (const p of this.all) {
      if (!p.isEnabled) {
        this.log.debug(`[Payment] provider "${p.meta.key}" isEnabled=false — skipped`);
        continue;
      }
      if (this.active.has(p.meta.key)) {
        this.log.warn(`[Payment] duplicate provider key "${p.meta.key}" — keeping first`);
        continue;
      }
      this.active.set(p.meta.key, p);
      this.log.log(`[Payment] provider "${p.meta.key}" registered`);
    }
  }

  /** Retourne l'instance provider (sans tenir compte de l'état DB). */
  get(providerKey: string): IPaymentProvider | undefined {
    return this.active.get(providerKey);
  }

  /** Liste brute de tous les providers actifs en DI (sans état DB). */
  list(): IPaymentProvider[] {
    return Array.from(this.active.values());
  }

  /**
   * Résout l'état effectif d'un provider pour un tenant donné.
   * La ligne tenant prime sur la ligne plateforme.
   * Si aucune ligne n'existe → mode = DISABLED (safe default).
   */
  async getEffectiveState(
    providerKey: string,
    tenantId?:   string,
  ): Promise<EffectiveProviderState | null> {
    const provider = this.active.get(providerKey);
    if (!provider) return null;

    // On requête les deux lignes d'un coup et on choisit la plus spécifique.
    const rows = await this.prisma.paymentProviderState.findMany({
      where: {
        providerKey,
        OR: [{ tenantId: tenantId ?? null }, { tenantId: null }],
      },
    });

    const tenantRow = tenantId ? rows.find(r => r.tenantId === tenantId) : undefined;
    const platformRow = rows.find(r => r.tenantId === null);
    const row = tenantRow ?? platformRow;

    if (!row) {
      return {
        providerKey,
        displayName:    provider.meta.displayName,
        mode:           'DISABLED',
        vaultPath:      provider.meta.defaultVaultPath,
        scopedToTenant: false,
        meta:           provider.meta,
      };
    }

    return {
      providerKey,
      displayName:    row.displayName,
      mode:           row.mode as ProviderMode,
      vaultPath:      row.vaultPath,
      scopedToTenant: row.tenantId === tenantId && !!tenantId,
      meta:           provider.meta,
    };
  }

  /** Schéma des champs Vault pour un provider donné (sert au formulaire BYO-credentials). */
  getCredentialSchema(providerKey: string): CredentialFieldSpec[] | null {
    const p = this.active.get(providerKey);
    return p ? p.meta.credentialFields : null;
  }

  /**
   * Retourne la liste des providers avec leur état effectif pour un tenant.
   * Utile pour alimenter l'UI "Intégrations API" et le router.
   */
  async listEffective(tenantId?: string): Promise<EffectiveProviderState[]> {
    const results: EffectiveProviderState[] = [];
    for (const key of this.active.keys()) {
      const state = await this.getEffectiveState(key, tenantId);
      if (state) results.push(state);
    }
    return results;
  }
}
