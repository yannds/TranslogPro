/**
 * templates.seed.ts — Seed des templates de documents système (renderers HTML)
 *
 * Enregistre les templates Puppeteer/HTML (renderers code) en DB comme
 * DocumentTemplate système (tenantId=null, isSystem=true).
 *
 * Usage :
 *   npx ts-node -r tsconfig-paths/register prisma/seeds/templates.seed.ts
 *
 * Idempotent — upsert par slug + tenantId null.
 * Duplique automatiquement vers tous les tenants existants.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL ?? 'postgresql://postgres:app_password@localhost:5432/translog' } },
});

const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

// ── Templates système HTML/Puppeteer ─────────────────────────────────────────

// ticket-2026 et boarding-pass-2026 sont désormais gérés comme templates PDFME
// (server/seed/templates/*.template.json) — ne plus les créer en PUPPETEER.
const SYSTEM_HTML_TEMPLATES: { slug: string; name: string; docType: string; format: string; engine: string; description: string; variables: string[] }[] = [];

// ── Seed function ────────────────────────────────────────────────────────────

export async function seedHtmlTemplates(client: PrismaClient = prisma) {
  console.log('\n📄 Seeding templates HTML/Puppeteer système…');

  for (const tpl of SYSTEM_HTML_TEMPLATES) {
    const varsSchema: Record<string, object> = {};
    for (const v of tpl.variables) {
      varsSchema[v] = { type: 'object', description: v };
    }

    const existing = await client.documentTemplate.findFirst({
      where: { tenantId: null, slug: tpl.slug, version: 1 },
    });

    if (existing) {
      await client.documentTemplate.update({
        where: { id: existing.id },
        data: {
          name:       tpl.name,
          varsSchema: varsSchema as object,
          isSystem:   true,
          isActive:   true,
          engine:     tpl.engine,
        },
      });
      console.log(`  ✓ Mis à jour : ${tpl.slug}`);
    } else {
      await client.documentTemplate.create({
        data: {
          tenantId:    null,
          name:        tpl.name,
          slug:        tpl.slug,
          docType:     tpl.docType,
          format:      tpl.format,
          engine:      tpl.engine,
          varsSchema:  varsSchema as object,
          version:     1,
          isSystem:    true,
          isActive:    true,
          createdById: SYSTEM_ACTOR,
        },
      });
      console.log(`  ✓ Créé      : ${tpl.slug}  (${tpl.docType} · ${tpl.format})`);
    }
  }

  // ── Dupliquer vers tous les tenants existants ──────────────────────────────
  console.log('\n📋 Distribution aux tenants existants…');

  const tenants = await client.tenant.findMany({
    where: { isActive: true },
    select: { id: true, slug: true },
  });

  const systemTemplates = await client.documentTemplate.findMany({
    where: {
      tenantId: null,
      slug: { in: SYSTEM_HTML_TEMPLATES.map(t => t.slug) },
      isActive: true,
    },
  });

  for (const tenant of tenants) {
    for (const sys of systemTemplates) {
      const already = await client.documentTemplate.findFirst({
        where: { tenantId: tenant.id, slug: sys.slug },
      });
      if (already) {
        console.log(`  · ${tenant.slug} / ${sys.slug} — déjà présent`);
        continue;
      }

      await client.documentTemplate.create({
        data: {
          tenantId:    tenant.id,
          name:        sys.name,
          slug:        sys.slug,
          docType:     sys.docType,
          format:      sys.format,
          engine:      sys.engine,
          storageKey:  sys.storageKey,
          body:        sys.body,
          schemaJson:  sys.schemaJson ?? undefined,
          varsSchema:  sys.varsSchema as object,
          version:     1,
          isSystem:    false,
          isActive:    true,
          createdById: SYSTEM_ACTOR,
        },
      });
      console.log(`  ✓ ${tenant.slug} / ${sys.slug} — copie créée`);
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('  ✅ Templates HTML système seedés + distribués');
  console.log('═══════════════════════════════════════════════');
}

// Exécution standalone
if (require.main === module) {
  seedHtmlTemplates()
    .catch((e: Error) => { console.error('\n❌', e.message); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
