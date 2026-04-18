import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { normalizePhone } from '../../common/helpers/phone.helper';
import { CustomerSegmentService } from './customer-segment.service';

/**
 * CustomerResolverService — Résolution idempotente d'un Customer CRM.
 *
 * Utilisé systématiquement lors d'une transaction "anonyme ou pas" :
 *   - Caisse : vente de billet avec nom + téléphone
 *   - Colis : expéditeur et/ou destinataire avec nom + téléphone
 *   - Portail voyageur public : checkout anonyme
 *   - Portail client connecté : lie l'User au Customer au premier passage
 *
 * Contrat :
 *   - Clé de matching primaire = (tenantId, phoneE164)
 *   - Clé secondaire = (tenantId, email)
 *   - Si ni phone ni email → impossible de créer (BadMatch)
 *   - Idempotent : mêmes entrées logiques ⇒ même Customer.id
 *   - Ne lie JAMAIS automatiquement un userId au Customer trouvé : ce n'est
 *     pas le rôle du resolver (réservé au claim flow ou login).
 *
 * Sécurité :
 *   - tenantId est TOUJOURS la condition racine.
 *   - Aucune donnée cross-tenant n'est exposée.
 *   - Le phone est normalisé selon le country du tenant avant lookup.
 */

export interface ResolveInput {
  name?:     string;
  phone?:    string;
  email?:    string;
  language?: string;
}

export interface ResolveResult {
  customer: { id: string; phoneE164: string | null; email: string | null; name: string };
  created:  boolean;
  matchedBy: 'phone' | 'email' | 'new';
}

@Injectable()
export class CustomerResolverService {
  private readonly logger = new Logger(CustomerResolverService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly segments?: CustomerSegmentService,
  ) {}

  /**
   * Incrémente les compteurs CRM (totalTickets, totalParcels, totalSpentCents)
   * après création réussie d'un ticket ou d'un colis. Appelé dans la même tx
   * que le ticket/parcel pour atomicité. Fait lastSeenAt=now.
   *
   * `amountCents` est optionnel : pour un colis on peut ignorer si pas facturé.
   */
  async bumpCounters(
    tx:         { customer: { update: Function } } | undefined | null,
    customerId: string,
    kind:       'ticket' | 'parcel',
    amountCents: bigint = 0n,
  ): Promise<void> {
    const db = (tx ?? this.prisma) as unknown as typeof this.prisma;
    await db.customer.update({
      where: { id: customerId },
      data:  {
        ...(kind === 'ticket' ? { totalTickets: { increment: 1 } } : { totalParcels: { increment: 1 } }),
        ...(amountCents > 0n ? { totalSpentCents: { increment: amountCents } } : {}),
        lastSeenAt: new Date(),
      },
    });
  }

  /**
   * Fire-and-forget : recalcule les segments d'un Customer hors-transaction.
   * À appeler APRÈS le commit des tickets/colis pour éviter un SELECT/UPDATE
   * dans la tx principale.
   */
  async recomputeSegmentsFor(tenantId: string, customerId: string): Promise<void> {
    if (!this.segments) return;
    try {
      await this.segments.recomputeForCustomer(tenantId, customerId);
    } catch (err) {
      this.logger.warn(`[CRM Segments] recompute failed for ${customerId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Trouve ou crée un Customer pour un tenant donné.
   *
   * Entrée libre (nom/phone/email). Au moins phone OU email doit être fourni.
   * Le phone est normalisé via le country du tenant si pas déjà en E.164.
   *
   * Renvoie {customer, created, matchedBy}. `created:false` signifie qu'un
   * Customer existant a été retrouvé et éventuellement enrichi (ex. si on
   * avait juste son phone et qu'on vient d'apprendre son email).
   */
  async resolveOrCreate(
    tenantId: string,
    input:    ResolveInput,
    tx?:      { customer: { findFirst: Function; update: Function; create: Function }; tenant: { findUnique: Function } },
  ): Promise<ResolveResult | null> {
    const db = (tx ?? this.prisma) as unknown as typeof this.prisma;

    // Normalisation phone avec pays du tenant
    let phoneE164: string | null = null;
    if (input.phone && input.phone.trim() !== '') {
      const tenant = await db.tenant.findUnique({
        where: { id: tenantId }, select: { country: true },
      });
      const r = normalizePhone(input.phone, tenant?.country ?? null);
      if (r.ok) phoneE164 = r.e164;
      else {
        this.logger.debug(`[CRM Resolver] invalid phone "${input.phone}" → ${r.reason}`);
      }
    }

    const email = input.email?.trim().toLowerCase() || null;
    const name  = input.name?.trim() || this.fallbackName(phoneE164, email);

    // Il faut au moins un signal d'identité — sinon on ne fabrique pas d'ombre
    if (!phoneE164 && !email) {
      this.logger.debug('[CRM Resolver] no phone nor email → skip resolve');
      return null;
    }

    // 1. Lookup par phone (priorité)
    let customer = phoneE164
      ? await db.customer.findFirst({
          where: { tenantId, phoneE164, deletedAt: null },
        })
      : null;
    if (customer) {
      // Enrichir avec email/name/language si nouveaux
      const patch = this.computeEnrichPatch(customer, { email, name, language: input.language });
      if (patch) {
        customer = await db.customer.update({
          where: { id: customer.id },
          data:  { ...patch, lastSeenAt: new Date() },
        });
      } else {
        customer = await db.customer.update({
          where: { id: customer.id },
          data:  { lastSeenAt: new Date() },
        });
      }
      return {
        customer: { id: customer.id, phoneE164: customer.phoneE164, email: customer.email, name: customer.name },
        created:  false,
        matchedBy: 'phone',
      };
    }

    // 2. Lookup par email (fallback)
    customer = email
      ? await db.customer.findFirst({
          where: { tenantId, email, deletedAt: null },
        })
      : null;
    if (customer) {
      const patch = this.computeEnrichPatch(customer, { phoneE164, name, language: input.language });
      customer = await db.customer.update({
        where: { id: customer.id },
        data:  { ...(patch ?? {}), lastSeenAt: new Date() },
      });
      return {
        customer: { id: customer.id, phoneE164: customer.phoneE164, email: customer.email, name: customer.name },
        created:  false,
        matchedBy: 'email',
      };
    }

    // 3. Création — shadow profile (userId null)
    try {
      const created = await db.customer.create({
        data: {
          tenantId,
          phoneE164,
          email,
          name,
          language: input.language ?? null,
        },
      });
      return {
        customer: { id: created.id, phoneE164: created.phoneE164, email: created.email, name: created.name },
        created:  true,
        matchedBy: 'new',
      };
    } catch (err) {
      // Course possible : deux créations concurrentes pour le même phone. On
      // retombe sur le lookup pour récupérer l'instance gagnante.
      if (phoneE164) {
        const existing = await db.customer.findFirst({
          where: { tenantId, phoneE164, deletedAt: null },
        });
        if (existing) {
          return {
            customer: { id: existing.id, phoneE164: existing.phoneE164, email: existing.email, name: existing.name },
            created:  false,
            matchedBy: 'phone',
          };
        }
      }
      throw err;
    }
  }

  private computeEnrichPatch(
    existing: { phoneE164: string | null; email: string | null; name: string; language: string | null },
    incoming: { phoneE164?: string | null; email?: string | null; name?: string | null; language?: string | null },
  ): Record<string, unknown> | null {
    const patch: Record<string, unknown> = {};
    if (incoming.phoneE164 && !existing.phoneE164) patch.phoneE164 = incoming.phoneE164;
    if (incoming.email     && !existing.email)     patch.email     = incoming.email;
    if (incoming.language  && !existing.language)  patch.language  = incoming.language;
    // Le name peut être affiné si l'existant est une valeur fabriquée (ex. "Client +242…")
    if (incoming.name && incoming.name !== existing.name && this.looksLikeFallbackName(existing.name)) {
      patch.name = incoming.name;
    }
    return Object.keys(patch).length ? patch : null;
  }

  private fallbackName(phoneE164: string | null, email: string | null): string {
    if (phoneE164) return `Client ${phoneE164}`;
    if (email)    return email.split('@')[0];
    return 'Client';
  }

  private looksLikeFallbackName(name: string): boolean {
    return /^Client\s/.test(name) || /^[a-z0-9._%+\-]+$/.test(name);
  }
}
