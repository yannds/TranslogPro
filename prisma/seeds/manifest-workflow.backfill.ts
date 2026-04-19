/**
 * manifest-workflow.backfill.ts
 *
 * Objectif — aligner la donnée manifeste sur le blueprint `manifest-standard`.
 *
 * Avant 2026-04-19 les manifestes étaient des artefacts stockage (clé MinIO) +
 * audit logs. Depuis cette date, il existe une vraie table `manifests` dont
 * le cycle de vie est gouverné par le WorkflowEngine. Ce script reconstitue
 * les lignes Manifest à partir des audit logs historiques — idempotent.
 *
 * Règles :
 *   - Lecture : `data.manifest.sign.agency` + (optionnellement) `data.manifest.signed_pdf.agency`
 *   - Pour chaque signature, upsert Manifest(tenant, trip, kind) au statut SIGNED
 *   - Skip si le trip a disparu (FK Manifest.tripId vers trips.id)
 *   - Skip si la ligne existe déjà (unique [tenant, trip, kind])
 *
 * Usage : npx ts-node prisma/seeds/manifest-workflow.backfill.ts [--tenant <id>]
 *
 * Post-run conseillé :
 *   POST /api/tenants/:tid/manifests/backfill-signed-pdfs
 *   pour régénérer les `signedPdfStorageKey` manquants (ex. PDFs jamais générés
 *   avant 2026-04-19).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type ManifestKind = 'ALL' | 'PASSENGERS' | 'PARCELS';

function coerceKind(raw: unknown): ManifestKind {
  const s = String(raw ?? '').toUpperCase();
  return s === 'PASSENGERS' || s === 'PARCELS' ? s : 'ALL';
}

function extractTripId(storageKey: string): string | null {
  const m = storageKey.match(/\/manifests\/([^/]+)\//);
  return m ? m[1] : null;
}

function extractKindFromKey(storageKey: string): ManifestKind | null {
  const m = storageKey.match(/\/manifests\/[^/]+\/(all|passengers|parcels)\//i);
  if (!m) return null;
  const up = m[1].toUpperCase();
  return up === 'ALL' || up === 'PASSENGERS' || up === 'PARCELS' ? (up as ManifestKind) : null;
}

function storageKeyFromResource(resource: string): string | null {
  return resource.startsWith('Manifest:') ? resource.slice('Manifest:'.length) : null;
}

interface Summary {
  scanned:         number;
  created:         number;
  alreadyPresent:  number;
  orphanTrip:      number;
  failed:          number;
  errors:          Array<{ resource: string; error: string }>;
}

async function run(filterTenantId?: string): Promise<Summary> {
  const summary: Summary = {
    scanned: 0, created: 0, alreadyPresent: 0, orphanTrip: 0, failed: 0, errors: [],
  };

  // 1. Collecte de toutes les signatures historiques
  const signatures = await prisma.auditLog.findMany({
    where: {
      action: 'data.manifest.sign.agency',
      ...(filterTenantId ? { tenantId: filterTenantId } : {}),
    },
    orderBy: { createdAt: 'asc' },
  });

  // 2. Indexation des PDFs déjà générés (pour lier signedPdfStorageKey)
  const pdfLogs = await prisma.auditLog.findMany({
    where: {
      action: 'data.manifest.signed_pdf.agency',
      ...(filterTenantId ? { tenantId: filterTenantId } : {}),
    },
  });
  const pdfByResource = new Map<string, string>();
  for (const log of pdfLogs) {
    const raw = (log.newValue ?? {}) as { signedPdfStorageKey?: string };
    if (raw.signedPdfStorageKey) pdfByResource.set(log.resource, raw.signedPdfStorageKey);
  }

  summary.scanned = signatures.length;

  for (const sig of signatures) {
    const storageKey = storageKeyFromResource(sig.resource);
    if (!storageKey) { summary.failed += 1; summary.errors.push({ resource: sig.resource, error: 'resource format invalide' }); continue; }

    const tripId = extractTripId(storageKey);
    if (!tripId) { summary.failed += 1; summary.errors.push({ resource: sig.resource, error: 'tripId non extractible' }); continue; }

    const rawNew = (sig.newValue ?? {}) as { kind?: string; signatureSvg?: string };
    const kind = extractKindFromKey(storageKey) ?? coerceKind(rawNew.kind);

    // 3. Vérifier que le trip existe (FK) et appartient au tenant de l'audit log
    const trip = await prisma.trip.findFirst({
      where:  { id: tripId, tenantId: sig.tenantId },
      select: { id: true },
    });
    if (!trip) { summary.orphanTrip += 1; continue; }

    // 4. Skip si déjà présent (unicité [tenant, trip, kind])
    const existing = await prisma.manifest.findFirst({
      where: { tenantId: sig.tenantId, tripId, kind },
    });
    if (existing) { summary.alreadyPresent += 1; continue; }

    // 5. Création Manifest au statut SIGNED — le contenu source de vérité est
    //    le PDF figé (si présent) ou peut être régénéré via backfillSignedPdfs()
    //
    //    generatedById est NOT NULL sur Manifest. Si l'audit log n'a pas d'userId
    //    (signature système / anonyme rarissime), on skip — la signature historique
    //    restera accessible uniquement via l'audit log, le nouveau blueprint
    //    refuse explicitement les manifestes orphelins d'auteur.
    if (!sig.userId) {
      summary.failed += 1;
      summary.errors.push({ resource: sig.resource, error: 'audit log sans userId — manifeste non reconstructible' });
      continue;
    }
    try {
      await prisma.manifest.create({
        data: {
          tenantId:            sig.tenantId,
          tripId,
          kind,
          status:              'SIGNED',
          version:             2,  // 1 (DRAFT create) + 1 (sign) — aligné engine
          storageKey,
          signedPdfStorageKey: pdfByResource.get(sig.resource) ?? null,
          passengerCount:      0,  // compteurs non recomposables rétroactivement
          parcelCount:         0,
          signatureSvg:        rawNew.signatureSvg ?? null,
          signedAt:            sig.createdAt,
          signedById:          sig.userId,
          generatedAt:         sig.createdAt, // approximation — pas de log de génération en prod
          generatedById:       sig.userId,
        },
      });
      summary.created += 1;
    } catch (err) {
      summary.failed += 1;
      summary.errors.push({ resource: sig.resource, error: (err as Error)?.message ?? String(err) });
    }
  }

  return summary;
}

async function main() {
  const tenantFlag = process.argv.indexOf('--tenant');
  const tenantId   = tenantFlag !== -1 ? process.argv[tenantFlag + 1] : undefined;

  console.log(`[manifest-workflow.backfill] Démarrage (tenant=${tenantId ?? 'ALL'})`);
  const start = Date.now();
  const result = await run(tenantId);
  const elapsed = Date.now() - start;

  console.log(JSON.stringify(result, null, 2));
  console.log(`[manifest-workflow.backfill] Terminé en ${elapsed}ms`);
  console.log(
    `  scanned=${result.scanned} created=${result.created} alreadyPresent=${result.alreadyPresent} orphanTrip=${result.orphanTrip} failed=${result.failed}`,
  );
  if (result.failed > 0) {
    console.error('[manifest-workflow.backfill] Des échecs détectés — cf. erreurs ci-dessus');
    process.exitCode = 1;
  }
}

main()
  .catch(err => {
    console.error('[manifest-workflow.backfill] Erreur fatale:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
