/**
 * CRM Customer Backfill — Phase 1 migration post-merge.
 *
 * Objectifs :
 *   1. Pour chaque User(userType='CUSTOMER') existant avec phone dans
 *      preferences.phone : créer ou lier un Customer (Customer.userId = user.id).
 *   2. Pour chaque Ticket existant avec passengerPhone ou avec passengerId
 *      pointant vers un User CUSTOMER : setter customerId + recopier phone/email
 *      dénormalisés si manquants.
 *   3. Pour chaque Parcel existant : setter recipientCustomerId à partir de
 *      recipientInfo.phone ; setter senderCustomerId à partir de senderId
 *      (lookup User CUSTOMER).
 *   4. Recalculer totalTickets / totalParcels / totalSpentCents.
 *
 * Idempotent : rejouable sans duplicats. Skip si customerId déjà set.
 *
 * Sécurité multi-tenant : toutes les requêtes sont scopées par tenantId.
 */

import { PrismaClient } from '@prisma/client';
import { normalizePhone } from '../../src/common/helpers/phone.helper';
import { PLATFORM_TENANT_ID } from './iam.seed';

const prisma = new PrismaClient();

interface BackfillReport {
  tenantsScanned: number;
  customersCreated: number;
  customersLinked:  number;        // Customer.userId posé rétroactivement
  ticketsLinked:    number;
  parcelsLinked:    number;
  countersRefreshed: number;
}

async function backfillTenant(tenantId: string, tenantCountry: string): Promise<Partial<BackfillReport>> {
  let customersCreated = 0;
  let customersLinked  = 0;
  let ticketsLinked    = 0;
  let parcelsLinked    = 0;
  let countersRefreshed = 0;

  // ── 1. User CUSTOMER → Customer ────────────────────────────────────────────
  const customerUsers = await prisma.user.findMany({
    where: { tenantId, userType: 'CUSTOMER' },
    select: { id: true, email: true, name: true, preferences: true, customerProfile: { select: { id: true } } },
  });

  for (const u of customerUsers) {
    if (u.customerProfile) continue;  // déjà lié

    const prefs = (u.preferences ?? {}) as Record<string, unknown>;
    const rawPhone = typeof prefs.phone === 'string' ? prefs.phone : null;
    const phoneE164 = rawPhone
      ? (normalizePhone(rawPhone, tenantCountry).ok
          ? (normalizePhone(rawPhone, tenantCountry) as { e164: string }).e164
          : null)
      : null;

    // Lookup par phone OU email
    let existing = phoneE164
      ? await prisma.customer.findFirst({ where: { tenantId, phoneE164, deletedAt: null } })
      : null;
    if (!existing && u.email) {
      existing = await prisma.customer.findFirst({ where: { tenantId, email: u.email, deletedAt: null } });
    }

    if (existing) {
      await prisma.customer.update({
        where: { id: existing.id },
        data:  {
          userId: u.id,
          ...(phoneE164 && !existing.phoneE164 ? { phoneE164 } : {}),
          ...(u.email   && !existing.email     ? { email: u.email } : {}),
        },
      });
      customersLinked++;
    } else {
      await prisma.customer.create({
        data: {
          tenantId,
          userId: u.id,
          phoneE164,
          email:  u.email ?? null,
          name:   u.name ?? u.email ?? (phoneE164 ?? 'Client'),
        },
      });
      customersCreated++;
    }
  }

  // ── 2. Tickets → customerId ────────────────────────────────────────────────
  const ticketsWithoutCustomer = await prisma.ticket.findMany({
    where:  { tenantId, customerId: null },
    select: { id: true, passengerId: true, passengerName: true, passengerPhone: true, passengerEmail: true, pricePaid: true },
  });

  for (const t of ticketsWithoutCustomer) {
    let customerId: string | null = null;

    // Priorité : passengerId (User CUSTOMER) → customerProfile
    if (t.passengerId) {
      const u = await prisma.user.findFirst({
        where: { tenantId, id: t.passengerId, userType: 'CUSTOMER' },
        select: { customerProfile: { select: { id: true } } },
      });
      customerId = u?.customerProfile?.id ?? null;
    }

    // Fallback : passengerPhone → Customer existant
    if (!customerId && t.passengerPhone) {
      const r = normalizePhone(t.passengerPhone, tenantCountry);
      if (r.ok) {
        const c = await prisma.customer.findFirst({
          where: { tenantId, phoneE164: r.e164, deletedAt: null },
          select: { id: true },
        });
        customerId = c?.id ?? null;
      }
    }

    if (customerId) {
      await prisma.ticket.update({ where: { id: t.id }, data: { customerId } });
      ticketsLinked++;
    }
  }

  // ── 3. Parcels → senderCustomerId + recipientCustomerId ────────────────────
  const parcelsToLink = await prisma.parcel.findMany({
    where: {
      tenantId,
      OR: [{ senderCustomerId: null }, { recipientCustomerId: null }],
    },
    select: { id: true, senderId: true, recipientInfo: true, senderCustomerId: true, recipientCustomerId: true, price: true },
  });

  for (const p of parcelsToLink) {
    const patch: Record<string, unknown> = {};

    if (!p.senderCustomerId && p.senderId) {
      const u = await prisma.user.findFirst({
        where:  { tenantId, id: p.senderId, userType: 'CUSTOMER' },
        select: { customerProfile: { select: { id: true } } },
      });
      const sc = u?.customerProfile?.id ?? null;
      if (sc) patch.senderCustomerId = sc;
    }

    if (!p.recipientCustomerId && p.recipientInfo && typeof p.recipientInfo === 'object') {
      const r = p.recipientInfo as { phone?: string; email?: string };
      const phone = r.phone ? normalizePhone(r.phone, tenantCountry) : null;
      if (phone?.ok) {
        const c = await prisma.customer.findFirst({
          where: { tenantId, phoneE164: phone.e164, deletedAt: null },
          select: { id: true },
        });
        if (c) patch.recipientCustomerId = c.id;
      } else if (r.email) {
        const c = await prisma.customer.findFirst({
          where: { tenantId, email: r.email.toLowerCase(), deletedAt: null },
          select: { id: true },
        });
        if (c) patch.recipientCustomerId = c.id;
      }
    }

    if (Object.keys(patch).length > 0) {
      await prisma.parcel.update({ where: { id: p.id }, data: patch });
      parcelsLinked++;
    }
  }

  // ── 4. Recalcul compteurs ──────────────────────────────────────────────────
  const customers = await prisma.customer.findMany({
    where:  { tenantId, deletedAt: null },
    select: { id: true },
  });

  for (const c of customers) {
    const [ticketAgg, sentAgg, receivedAgg] = await Promise.all([
      prisma.ticket.aggregate({
        where: { tenantId, customerId: c.id, status: { notIn: ['CANCELLED', 'EXPIRED'] } },
        _count: true,
        _sum:   { pricePaid: true },
      }),
      prisma.parcel.count({ where: { tenantId, senderCustomerId: c.id } }),
      prisma.parcel.count({ where: { tenantId, recipientCustomerId: c.id } }),
    ]);

    const totalSpentCents = BigInt(Math.round((ticketAgg._sum.pricePaid ?? 0) * 100));
    await prisma.customer.update({
      where: { id: c.id },
      data:  {
        totalTickets:    ticketAgg._count,
        totalParcels:    sentAgg + receivedAgg,
        totalSpentCents,
      },
    });
    countersRefreshed++;
  }

  return { customersCreated, customersLinked, ticketsLinked, parcelsLinked, countersRefreshed };
}

async function main(): Promise<BackfillReport> {
  const tenants = await prisma.tenant.findMany({
    where:  { id: { not: PLATFORM_TENANT_ID } },
    select: { id: true, slug: true, country: true },
  });

  const report: BackfillReport = {
    tenantsScanned:   tenants.length,
    customersCreated: 0,
    customersLinked:  0,
    ticketsLinked:    0,
    parcelsLinked:    0,
    countersRefreshed: 0,
  };

  for (const t of tenants) {
    const r = await backfillTenant(t.id, t.country ?? 'CG');
    report.customersCreated += r.customersCreated ?? 0;
    report.customersLinked  += r.customersLinked  ?? 0;
    report.ticketsLinked    += r.ticketsLinked    ?? 0;
    report.parcelsLinked    += r.parcelsLinked    ?? 0;
    report.countersRefreshed += r.countersRefreshed ?? 0;
    console.log(
      `[CRM Backfill] tenant=${t.slug} — ` +
      `customers ${r.customersCreated ?? 0} créés, ${r.customersLinked ?? 0} liés ; ` +
      `tickets ${r.ticketsLinked ?? 0}, parcels ${r.parcelsLinked ?? 0} ; ` +
      `${r.countersRefreshed ?? 0} compteurs rafraîchis`,
    );
  }

  console.log(`\n[CRM Backfill] Total: ${JSON.stringify(report, null, 2)}`);
  return report;
}

if (require.main === module) {
  main()
    .catch(err => { console.error(err); process.exit(1); })
    .finally(() => prisma.$disconnect());
}

export { main as runCrmCustomerBackfill };
