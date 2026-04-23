import {
  Injectable, Logger, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { SavedMethodEntry } from './subscription-reconciliation.service';

/**
 * SubscriptionPaymentMethodsService — gère la liste des moyens de paiement
 * enregistrés pour l'abonnement SaaS du tenant.
 *
 * Source de vérité : `PlatformSubscription.externalRefs.savedMethods: SavedMethodEntry[]`.
 * Alimenté automatiquement par SubscriptionReconciliationService sur chaque
 * paiement réussi (dedup par token/last4/maskedPhone). Max 5 entrées.
 *
 * Opérations :
 *   - `list(tenantId)` — retourne la liste (trié default first, puis lastUsed desc)
 *   - `remove(tenantId, methodId)` — supprime une entrée
 *   - `setDefault(tenantId, methodId)` — promeut une entrée comme default
 *
 * Note : l'ajout passe par le flow checkout existant (`POST /subscription/checkout`).
 * À chaque paiement réussi, le nouveau moyen est automatiquement sauvegardé ici.
 */
@Injectable()
export class SubscriptionPaymentMethodsService {
  private readonly logger = new Logger(SubscriptionPaymentMethodsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<SavedMethodEntry[]> {
    const list = await this.readList(tenantId);
    return sortMethods(list);
  }

  async remove(tenantId: string, methodId: string): Promise<void> {
    const list = await this.readList(tenantId);
    const target = list.find(m => m.id === methodId);
    if (!target) throw new NotFoundException(`Moyen de paiement ${methodId} introuvable`);

    const next = list.filter(m => m.id !== methodId);
    // Si on supprime le default et qu'il reste des méthodes, promouvoir la
    // plus récemment utilisée comme nouveau default.
    if (target.isDefault && next.length > 0) {
      const sorted = sortMethods(next);
      sorted[0] = { ...sorted[0], isDefault: true };
      await this.writeList(tenantId, sorted);
    } else {
      await this.writeList(tenantId, next);
    }

    this.logger.log(`[paymentMethods] remove tenant=${tenantId} id=${methodId}`);
  }

  async setDefault(tenantId: string, methodId: string): Promise<void> {
    const list = await this.readList(tenantId);
    const target = list.find(m => m.id === methodId);
    if (!target) throw new NotFoundException(`Moyen de paiement ${methodId} introuvable`);
    if (target.isDefault) return; // no-op

    const next = list.map(m => ({ ...m, isDefault: m.id === methodId }));
    await this.writeList(tenantId, next);
    this.logger.log(`[paymentMethods] setDefault tenant=${tenantId} id=${methodId}`);
  }

  // ── Helpers internes ────────────────────────────────────────────────────────

  private async readList(tenantId: string): Promise<SavedMethodEntry[]> {
    const sub = await this.prisma.platformSubscription.findUnique({
      where:  { tenantId },
      select: { externalRefs: true },
    });
    if (!sub) throw new NotFoundException(`Aucune souscription pour le tenant ${tenantId}`);
    const refs = (sub.externalRefs ?? {}) as Record<string, unknown>;
    const list = refs.savedMethods;
    if (!Array.isArray(list)) {
      // Fallback : si un lastMethod existe (legacy), on le remonte comme entrée
      // unique pour l'UI — pas de write-back (on attend le prochain paiement).
      if (refs.lastMethod) {
        return [{
          id:          'legacy',
          method:      String(refs.lastMethod),
          provider:    (refs.lastProvider as string) ?? null,
          brand:       (refs.methodBrand  as string) ?? null,
          last4:       (refs.methodLast4  as string) ?? null,
          maskedPhone: (refs.maskedPhone  as string) ?? null,
          tokenRef:    (refs.methodToken  as string) ?? null,
          customerRef: (refs.customerRef  as string) ?? null,
          isDefault:   true,
          lastUsedAt:  (refs.lastSuccessAt as string) ?? null,
          createdAt:   (refs.lastSuccessAt as string) ?? new Date().toISOString(),
        }];
      }
      return [];
    }
    return list as SavedMethodEntry[];
  }

  private async writeList(tenantId: string, list: SavedMethodEntry[]): Promise<void> {
    const sub = await this.prisma.platformSubscription.findUnique({
      where:  { tenantId },
      select: { id: true, externalRefs: true },
    });
    if (!sub) throw new BadRequestException(`Aucune souscription pour ce tenant`);
    const prevRefs = (sub.externalRefs ?? {}) as Record<string, unknown>;
    await this.prisma.platformSubscription.update({
      where: { id: sub.id },
      data:  { externalRefs: { ...prevRefs, savedMethods: list } as unknown as Prisma.InputJsonValue },
    });
  }
}

function sortMethods(list: SavedMethodEntry[]): SavedMethodEntry[] {
  return [...list].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    const la = a.lastUsedAt ? Date.parse(a.lastUsedAt) : 0;
    const lb = b.lastUsedAt ? Date.parse(b.lastUsedAt) : 0;
    return lb - la;
  });
}
