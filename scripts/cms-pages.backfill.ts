#!/usr/bin/env ts-node
/**
 * cms-pages.backfill.ts — Seed les pages CMS par défaut pour les tenants
 * qui n'en ont aucune (créés avant l'introduction de seedDefaultCmsPages
 * dans TenantService, ou via seed direct).
 *
 * Idempotent : skipDuplicates=true, les tenants déjà seedés ne sont pas touchés.
 *
 * Usage :
 *   ts-node scripts/cms-pages.backfill.ts
 *   ts-node scripts/cms-pages.backfill.ts --tenant <id>   # un seul tenant
 *   ts-node scripts/cms-pages.backfill.ts --dry-run       # liste seulement
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DRY_RUN   = process.argv.includes('--dry-run');
const TENANT_ID = (() => {
  const idx = process.argv.indexOf('--tenant');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

const DEFAULT_PAGES = (tenantId: string) => [
  { tenantId, slug: 'hero', locale: 'fr', sortOrder: 0, published: true, showInFooter: false,
    title:   'Hero — Accroche principale',
    content: JSON.stringify({ title: 'Voyagez en toute élégance', subtitle: 'Réservez vos billets de bus en quelques secondes. Confort, sécurité et ponctualité garantis.', trustedBy: 'Des milliers de voyageurs nous font confiance' }) },
  { tenantId, slug: 'hero', locale: 'en', sortOrder: 0, published: true, showInFooter: false,
    title:   'Hero — Main tagline',
    content: JSON.stringify({ title: 'Travel in Style', subtitle: 'Book your bus tickets in seconds. Comfort, safety, and punctuality guaranteed.', trustedBy: 'Thousands of travelers trust us' }) },
  { tenantId, slug: 'about', locale: 'fr', sortOrder: 1, published: true, showInFooter: false,
    title:   'À propos',
    content: JSON.stringify({ description: 'Nous sommes une compagnie de transport de premier plan, dédiée à offrir des voyages confortables, sûrs et ponctuels à travers tout le pays. Notre flotte moderne et notre équipe expérimentée sont au service de votre sérénité.', features: [{ icon: 'shield', title: 'Sécurité', description: 'Véhicules inspectés, chauffeurs certifiés' }, { icon: 'sparkles', title: 'Confort', description: 'Climatisation, WiFi, prises USB' }, { icon: 'target', title: 'Fiabilité', description: 'Départs ponctuels, suivi en temps réel' }] }) },
  { tenantId, slug: 'about', locale: 'en', sortOrder: 1, published: true, showInFooter: false,
    title:   'About',
    content: JSON.stringify({ description: 'We are a leading transport company, dedicated to offering comfortable, safe, and punctual journeys across the country. Our modern fleet and experienced team serve your peace of mind.', features: [{ icon: 'shield', title: 'Safety', description: 'Inspected vehicles, certified drivers' }, { icon: 'sparkles', title: 'Comfort', description: 'Air conditioning, WiFi, USB outlets' }, { icon: 'target', title: 'Reliability', description: 'On-time departures, real-time tracking' }] }) },
  { tenantId, slug: 'contact', locale: 'fr', sortOrder: 2, published: true, showInFooter: true,
    title:   'Contact — Horaires',
    content: JSON.stringify({ hours: 'Lun-Sam : 06h — 20h' }) },
  { tenantId, slug: 'contact', locale: 'en', sortOrder: 2, published: true, showInFooter: true,
    title:   'Contact — Hours',
    content: JSON.stringify({ hours: 'Mon-Sat: 6 AM — 8 PM' }) },
];

async function backfillTenant(tenantId: string, tenantName: string): Promise<number> {
  const existing = await prisma.tenantPage.count({ where: { tenantId } });
  if (existing > 0) {
    console.log(`  ⏭  ${tenantName} (${tenantId}) — déjà ${existing} page(s), skip`);
    return 0;
  }

  if (DRY_RUN) {
    console.log(`  🔍 ${tenantName} (${tenantId}) — 0 pages → serait seedé (dry-run)`);
    return 0;
  }

  const pages = DEFAULT_PAGES(tenantId);
  await prisma.tenantPage.createMany({ data: pages, skipDuplicates: true });
  console.log(`  ✅ ${tenantName} (${tenantId}) — ${pages.length} pages créées`);
  return pages.length;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('     TransLog Pro — CMS Pages Backfill Script');
  if (DRY_RUN)   console.log('     MODE DRY-RUN — aucune écriture');
  if (TENANT_ID) console.log(`     Tenant ciblé : ${TENANT_ID}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  const tenants = TENANT_ID
    ? await prisma.tenant.findMany({ where: { id: TENANT_ID } })
    : await prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } });

  if (tenants.length === 0) {
    console.log('Aucun tenant trouvé.');
    return;
  }

  let total = 0;
  for (const tenant of tenants) {
    total += await backfillTenant(tenant.id, tenant.name);
  }

  console.log(`\n[BACKFILL] Terminé — ${total} pages créées sur ${tenants.length} tenant(s).`);
}

main()
  .catch(err => { console.error('[BACKFILL] Erreur :', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
