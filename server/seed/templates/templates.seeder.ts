/**
 * templates.seeder.ts — Charge les templates pdfme système en DB
 *
 * Usage : npx ts-node -r tsconfig-paths/register server/seed/templates/templates.seeder.ts
 *
 * - Upsert idempotent (slug + tenantId null + version 1)
 * - Marque les templates comme isSystem=true (protégés contre suppression)
 * - Le champ schemaJson reçoit l'objet template pdfme complet (basePdf + schemas)
 * - Le champ _meta est extrait et ne va pas dans schemaJson
 */
import { PrismaClient } from '@prisma/client';
import * as path from 'path';
import * as fs   from 'fs';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL ?? 'postgresql://postgres:app_password@localhost:5432/translog' } },
});

// Slugs du pack de démarrage dupliqué automatiquement à l'onboarding d'un tenant.
// Ces templates reçoivent une copie tenantId=<id> immédiatement éditable.
export const STARTER_PACK_SLUGS = [
  'ticket-a5',
  'ticket-2026',
  'boarding-pass-2026',
  'invoice-a4',
  'receipt-thermal',
  'manifest-a4',
  'parcel-label',
];

interface TemplateMeta {
  slug:        string;
  name:        string;
  docType:     string;
  format:      string;
  engine:      string;
  description: string;
  variables:   string[];
}

interface TemplateFile {
  _meta:     TemplateMeta;
  basePdf:   object;
  schemas:   object[][];
}

const SEED_DIR = __dirname;
const TEMPLATE_FILES = [
  'invoice-a4.template.json',
  'invoice-simple-a5.template.json',
  'ticket-a5.template.json',
  'ticket-2026.template.json',
  'boarding-pass-a6.template.json',
  'boarding-pass-2026.template.json',
  'baggage-tag.template.json',
  'parcel-label.template.json',
  'parcel-label-multi.template.json',
  'manifest-a4.template.json',
  'packing-list-a4.template.json',
  'receipt-thermal.template.json',
  'receipt-a4.template.json',
  'envelope-c5.template.json',
  'envelope-dl.template.json',
];

const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

export async function seedSystemTemplates(client: PrismaClient = prisma) {
  console.log('\n📄 Seeding document templates système (pdfme)…');

  for (const filename of TEMPLATE_FILES) {
    const filepath = path.join(SEED_DIR, filename);
    if (!fs.existsSync(filepath)) {
      console.warn(`  ⚠ Fichier manquant: ${filename}`);
      continue;
    }

    const file: TemplateFile = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    const { _meta, ...schemaJson } = file;

    // Construire le varsSchema à partir de la liste des variables
    const varsSchema: Record<string, object> = {};
    for (const v of _meta.variables) {
      varsSchema[v] = { type: 'string', description: v };
    }

    // Upsert : trouver par slug + tenantId null + version 1
    const existing = await client.documentTemplate.findFirst({
      where: { tenantId: null, slug: _meta.slug, version: 1 },
    });

    if (existing) {
      // Mettre à jour le schéma (redesign possible lors des upgrades)
      await client.documentTemplate.update({
        where: { id: existing.id },
        data: {
          name:       _meta.name,
          schemaJson: schemaJson as object,
          varsSchema: varsSchema as object,
          isSystem:   true,
          isActive:   true,
          engine:     _meta.engine,
        },
      });
      console.log(`  ✓ Mis à jour : ${_meta.slug}`);
    } else {
      await client.documentTemplate.create({
        data: {
          tenantId:    null,
          name:        _meta.name,
          slug:        _meta.slug,
          docType:     _meta.docType,
          format:      _meta.format,
          engine:      _meta.engine,
          schemaJson:  schemaJson as object,
          varsSchema:  varsSchema as object,
          version:     1,
          isSystem:    true,
          isActive:    true,
          createdById: SYSTEM_ACTOR,
        },
      });
      console.log(`  ✓ Créé      : ${_meta.slug}  (${_meta.docType} · ${_meta.format})`);
    }
  }

  // ── Backfill : migrer les copies tenant PUPPETEER → PDFME ────────────────
  // Si un template tenant existe avec engine=PUPPETEER et qu'un template système
  // PDFME avec le même slug est maintenant disponible, mettre à jour la copie tenant.
  console.log('\n🔄 Backfill copies tenant existantes (PUPPETEER → PDFME)…');

  const systemPdfme = await client.documentTemplate.findMany({
    where: { tenantId: null, engine: 'PDFME', isSystem: true, isActive: true },
  });

  for (const sys of systemPdfme) {
    const tenantCopies = await client.documentTemplate.findMany({
      where: { slug: sys.slug, engine: 'PUPPETEER', isActive: true, tenantId: { not: null } },
    });

    for (const copy of tenantCopies) {
      await client.documentTemplate.update({
        where: { id: copy.id },
        data: {
          engine:     'PDFME',
          schemaJson: sys.schemaJson as object,
          varsSchema: sys.varsSchema as object,
        },
      });
      console.log(`  ✓ ${copy.tenantId?.slice(0, 8)}… / ${copy.slug} : PUPPETEER → PDFME`);
    }
  }

  // ── Backfill defaults : un template par défaut par docType par tenant ─────
  // Pour chaque tenant, si aucun template n'est marqué isDefault pour un docType,
  // marquer le premier du STARTER_PACK comme défaut.
  console.log('\n⭐ Backfill isDefault par docType et par tenant…');

  const DEFAULT_SLUGS_BY_DOCTYPE: Record<string, string> = {
    TICKET:       'ticket-a5',
    MANIFEST:     'manifest-a4',
    INVOICE:      'invoice-a4',
    LABEL:        'parcel-label',
    PACKING_LIST: 'packing-list-a4',
    ENVELOPE:     'envelope-c5',
  };

  const tenantIds = await client.documentTemplate.findMany({
    where:    { tenantId: { not: null }, isActive: true },
    select:   { tenantId: true },
    distinct: ['tenantId'],
  });

  for (const { tenantId } of tenantIds) {
    if (!tenantId) continue;
    for (const [docType, defaultSlug] of Object.entries(DEFAULT_SLUGS_BY_DOCTYPE)) {
      // Vérifie si un défaut existe déjà pour ce docType
      const existing = await client.documentTemplate.findFirst({
        where: { tenantId, docType, isDefault: true, isActive: true },
      });
      if (existing) continue;

      // Marque le template avec le slug par défaut
      const target = await client.documentTemplate.findFirst({
        where: { tenantId, slug: defaultSlug, isActive: true },
      });
      if (target) {
        await client.documentTemplate.update({ where: { id: target.id }, data: { isDefault: true } });
        console.log(`  ⭐ ${tenantId.slice(0, 8)}… / ${docType} → ${defaultSlug}`);
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('  ✅ Templates système chargés + copies migrées + defaults appliqués');
  console.log('═══════════════════════════════════════════════');
}

// Exécution standalone : `ts-node server/seed/templates/templates.seeder.ts`
if (require.main === module) {
  seedSystemTemplates()
    .catch((e: Error) => { console.error('\n❌', e.message); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
