/**
 * Blueprints Seeder
 *
 * Charge les blueprints système depuis les fichiers JSON et les insère en DB.
 * Idempotent : ne réinsère pas si le slug+isSystem existe déjà.
 * Recalcule les checksums à chaque exécution (source of truth = JSON).
 *
 * Usage :
 *   npx ts-node server/seed/workflows/blueprints.seeder.ts
 *   // ou depuis prisma/seed.ts : import { seedBlueprints } from './workflows/blueprints.seeder'
 */
import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs';

const BLUEPRINT_FILES = [
  'ticket-simple.blueprint.json',
  'ticket-standard.blueprint.json',
  'parcel-complex.blueprint.json',
  'trip-standard.blueprint.json',
];

const CATEGORIES = [
  { name: 'Billetterie',  slug: 'ticketing', icon: '🎫', sortOrder: 1 },
  { name: 'Logistique',   slug: 'logistics', icon: '📦', sortOrder: 2 },
  { name: 'Trajets',      slug: 'trips',     icon: '🚌', sortOrder: 3 },
  { name: 'Support',      slug: 'support',   icon: '🔧', sortOrder: 4 },
];

function computeChecksum(graph: Record<string, unknown>): string {
  const nodes = (graph.nodes as any[]).sort((a, b) => a.id.localeCompare(b.id)).map((n: any) => ({
    id: n.id, type: n.type,
  }));
  const edges = (graph.edges as any[]).sort((a, b) => a.id.localeCompare(b.id)).map((e: any) => ({
    id: e.id, source: e.source, target: e.target,
    label: e.label, permission: e.permission,
    guards: [...e.guards].sort(),
    sideEffects: [...e.sideEffects].sort(),
  }));
  const payload = { entityType: graph.entityType, nodes, edges };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

const ENTITY_TO_CATEGORY: Record<string, string> = {
  Ticket: 'ticketing',
  Parcel: 'logistics',
  Trip:   'trips',
  Claim:  'support',
};

export async function seedBlueprints(prisma: PrismaClient): Promise<void> {
  console.log('[Seeder] Démarrage — blueprints workflow système...');

  // 1. Upsert des catégories
  const categoryMap: Record<string, string> = {};
  for (const cat of CATEGORIES) {
    const upserted = await prisma.blueprintCategory.upsert({
      where:  { slug: cat.slug },
      create: cat,
      update: { name: cat.name, icon: cat.icon, sortOrder: cat.sortOrder },
    });
    categoryMap[cat.slug] = upserted.id;
    console.log(`  ✓ Catégorie "${cat.name}" (id=${upserted.id})`);
  }

  // 2. Charger et insérer chaque blueprint
  const dir = path.dirname(__filename);
  for (const file of BLUEPRINT_FILES) {
    const filePath = path.join(dir, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`  ⚠ Fichier manquant : ${file}`);
      continue;
    }

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const graph = raw.graph;

    // Recalculer le checksum
    const checksum = computeChecksum(graph);
    graph.checksum = checksum;

    const categorySlug = ENTITY_TO_CATEGORY[raw.entityType] ?? 'support';
    const categoryId   = categoryMap[categorySlug];

    const existing = await prisma.workflowBlueprint.findFirst({
      where: { slug: raw.slug, isSystem: true },
    });

    if (existing) {
      await prisma.workflowBlueprint.update({
        where: { id: existing.id },
        data: {
          name:        raw.name,
          description: raw.description,
          graphJson:   graph,
          checksum,
          isPublic:    raw.isPublic ?? true,
          tags:        raw.tags ?? [],
          categoryId,
        },
      });
      console.log(`  ↺ Blueprint "${raw.slug}" mis à jour (id=${existing.id})`);
    } else {
      const created = await prisma.workflowBlueprint.create({
        data: {
          name:           raw.name,
          slug:           raw.slug,
          description:    raw.description,
          entityType:     raw.entityType,
          graphJson:      graph,
          checksum,
          isPublic:       raw.isPublic ?? true,
          isSystem:       true,
          authorTenantId: null,
          categoryId,
          tags:           raw.tags ?? [],
          version:        graph.version ?? '1.0.0',
          usageCount:     0,
        },
      });
      console.log(`  ✓ Blueprint "${raw.slug}" créé (id=${created.id})`);
    }
  }

  console.log('[Seeder] Blueprints workflow seedés avec succès.');
}

// Exécution standalone
if (require.main === module) {
  const prisma = new PrismaClient();
  seedBlueprints(prisma)
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
