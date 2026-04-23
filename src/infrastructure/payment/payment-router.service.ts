/**
 * PaymentRouter — résout `{tenant, country, method, currency}` → provider à utiliser.
 *
 * Ordre de résolution (le plus spécifique gagne) :
 *   1. TenantPaymentConfig.defaultProviderByMethod[method]   (choix explicite du tenant)
 *   2. Premier provider du fallbackChainByMethod[method] dont l'état est SANDBOX|LIVE
 *   3. Premier provider dont `supports({country, method, currency})` est vrai
 *      ET dont l'état effectif (tenant ou plateforme) est SANDBOX|LIVE.
 *
 * Aucune constante hardcodée : tout remonte de
 *   - PaymentProviderState (mode)
 *   - TenantPaymentConfig  (routing, limites, devises)
 *   - PaymentMethodConfig  (méthodes dispo par pays)
 *   - Tenant.country/currency (défaut)
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  PaymentCurrency,
  PaymentMethod,
} from './interfaces/payment.interface';
import {
  IPaymentProvider,
  ProviderMode,
  SupportsQuery,
} from './providers/types';
import { PaymentProviderRegistry } from './payment-provider.registry';

export interface RouteRequest {
  tenantId: string;
  method:   PaymentMethod;
  /** Pays ISO 3166-1 alpha-2. Si absent, on lit Tenant.country. */
  country?: string;
  /** Devise ISO 4217. Si absente, on lit Tenant.currency. */
  currency?: PaymentCurrency;
  /** Montant à router (pour limites min/max). */
  amount?:   number;
}

export interface RouteResolution {
  provider:    IPaymentProvider;
  providerKey: string;
  mode:        ProviderMode;
  vaultPath:   string;
  country:     string;
  currency:    PaymentCurrency;
}

@Injectable()
export class PaymentRouter {
  private readonly log = new Logger(PaymentRouter.name);

  constructor(
    private readonly prisma:   PrismaService,
    private readonly registry: PaymentProviderRegistry,
  ) {}

  async resolve(req: RouteRequest): Promise<RouteResolution> {
    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: req.tenantId },
      select: { country: true, currency: true },
    });
    if (!tenant) throw new BadRequestException(`Tenant ${req.tenantId} introuvable`);

    const country  = req.country  ?? tenant.country;
    const currency = (req.currency ?? tenant.currency) as PaymentCurrency;

    let config = await this.prisma.tenantPaymentConfig.findUnique({
      where: { tenantId: req.tenantId },
      select: {
        defaultProviderByMethod: true,
        fallbackChainByMethod:   true,
        minAmountByMethod:       true,
        maxAmountByMethod:       true,
        allowedCurrencies:       true,
      },
    });

    // Self-heal : une devise "légitime de plein droit" est ajoutée si manquante.
    // Deux sources légitimes :
    //   1. Tenant.currency = source de vérité choisie par l'admin tenant
    //   2. PlatformSubscription.plan.currency = devise tarifaire du plan
    //      plateforme actif (business fact imposé par la plateforme, ex. plans
    //      en USD vendus à des tenants XAF).
    // On ne self-heal PAS pour une devise arbitraire — cela défairait le rôle
    // défensif de allowedCurrencies contre un mischarge.
    if (
      config &&
      config.allowedCurrencies.length > 0 &&
      !config.allowedCurrencies.includes(currency)
    ) {
      const isTenantCurrency = currency === tenant.currency;
      const isPlanCurrency   = !isTenantCurrency
        ? await this.isActivePlanCurrency(req.tenantId, currency)
        : false;

      if (isTenantCurrency || isPlanCurrency) {
        await this.prisma.tenantPaymentConfig.update({
          where: { tenantId: req.tenantId },
          data:  { allowedCurrencies: { push: currency } },
        });
        config = { ...config, allowedCurrencies: [...config.allowedCurrencies, currency] };
        this.log.log(
          `[Router] self-heal : ${currency} ajoutée à allowedCurrencies du tenant ${req.tenantId} ` +
          `(source : ${isTenantCurrency ? 'tenant.currency' : 'plan.currency'})`,
        );
      }
    }

    this.enforceLimits(config, req.method, req.amount);
    this.enforceCurrency(config, currency, tenant.currency);

    const q: SupportsQuery = { country, method: req.method, currency };

    // 1. Choix explicite tenant
    const explicit = (config?.defaultProviderByMethod as Record<string, string> | null)?.[req.method];
    if (explicit) {
      const res = await this.tryResolve(explicit, q, req.tenantId);
      if (res) return res;
      this.log.warn(`[Router] provider explicite "${explicit}" non utilisable (${JSON.stringify(q)}) → fallback`);
    }

    // 2. Fallback chain configurée par le tenant
    const chain = ((config?.fallbackChainByMethod as Record<string, string[]> | null)?.[req.method]) ?? [];
    for (const key of chain) {
      const res = await this.tryResolve(key, q, req.tenantId);
      if (res) return res;
    }

    // 3. Scan global — premier provider enabled + supports + mode ≠ DISABLED
    for (const p of this.registry.list()) {
      if (!p.supports(q)) continue;
      const state = await this.registry.getEffectiveState(p.meta.key, req.tenantId);
      if (state && state.mode !== 'DISABLED') {
        return {
          provider:    p,
          providerKey: p.meta.key,
          mode:        state.mode,
          vaultPath:   state.vaultPath,
          country,
          currency,
        };
      }
    }

    throw new BadRequestException(
      `Aucun provider de paiement disponible pour method=${req.method} country=${country} currency=${currency}`,
    );
  }

  private async tryResolve(
    providerKey: string,
    q:           SupportsQuery,
    tenantId:    string,
  ): Promise<RouteResolution | null> {
    const provider = this.registry.get(providerKey);
    if (!provider) return null;
    if (!provider.supports(q)) return null;
    const state = await this.registry.getEffectiveState(providerKey, tenantId);
    if (!state || state.mode === 'DISABLED') return null;
    return {
      provider,
      providerKey,
      mode:      state.mode,
      vaultPath: state.vaultPath,
      country:   q.country,
      currency:  q.currency,
    };
  }

  private enforceLimits(
    config: { minAmountByMethod: unknown; maxAmountByMethod: unknown } | null,
    method: PaymentMethod,
    amount: number | undefined,
  ): void {
    if (amount === undefined || !config) return;
    const mins = (config.minAmountByMethod ?? {}) as Record<string, number>;
    const maxs = (config.maxAmountByMethod ?? {}) as Record<string, number>;
    const min  = mins[method];
    const max  = maxs[method];
    if (min !== undefined && amount < min) {
      throw new BadRequestException(`Montant ${amount} < min ${min} pour ${method}`);
    }
    if (max !== undefined && amount > max) {
      throw new BadRequestException(`Montant ${amount} > max ${max} pour ${method}`);
    }
  }

  /**
   * True si `currency` correspond à la devise du plan plateforme actif du
   * tenant. Utilisé pour étendre le self-heal aux plans tarifés dans une devise
   * différente de Tenant.currency (ex. plan en USD vendu à un tenant XAF).
   */
  private async isActivePlanCurrency(tenantId: string, currency: string): Promise<boolean> {
    const sub = await this.prisma.platformSubscription.findUnique({
      where:  { tenantId },
      select: { plan: { select: { currency: true } } },
    });
    return sub?.plan?.currency === currency;
  }

  private enforceCurrency(
    config: { allowedCurrencies: string[] } | null,
    currency: PaymentCurrency,
    tenantDefault: string,
  ): void {
    if (!config || !config.allowedCurrencies?.length) {
      // Fallback : devise tenant obligatoire si aucune liste configurée.
      if (currency !== tenantDefault) {
        throw new BadRequestException(`Devise ${currency} non autorisée (tenant par défaut : ${tenantDefault})`);
      }
      return;
    }
    if (!config.allowedCurrencies.includes(currency)) {
      throw new BadRequestException(
        `Devise ${currency} non autorisée (autorisées : ${config.allowedCurrencies.join(', ')})`,
      );
    }
  }
}
