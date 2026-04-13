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
  'ticket-a5.template.json',
  'baggage-tag.template.json',
  'parcel-label.template.json',
  'manifest-a4.template.json',
  'packing-list-a4.template.json',
  'receipt-thermal.template.json',
  'envelope-c5.template.json',
  'envelope-dl.template.json',
  'parcel-label-multi.template.json',
];

const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  TranslogPro — Seed Templates pdfme');
  console.log('═══════════════════════════════════════════════\n');

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
    const existing = await prisma.documentTemplate.findFirst({
      where: { tenantId: null, slug: _meta.slug, version: 1 },
    });

    if (existing) {
      // Mettre à jour le schéma (redesign possible lors des upgrades)
      await prisma.documentTemplate.update({
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
      await prisma.documentTemplate.create({
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

  console.log('\n═══════════════════════════════════════════════');
  console.log('  ✅ Templates système chargés');
  console.log('═══════════════════════════════════════════════');
}

main()
  .catch(e => { console.error('\n❌', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
