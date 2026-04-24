/**
 * Briefing Template Seed — refonte QHSE 2026-04-24.
 *
 * Crée/rafraîchit le template "Briefing standard QHSE" pour chaque tenant :
 *   - 8 chapitres seed (DOCUMENTS, VEHICLE_STATE, SAFETY_EQUIPMENT, COMFORT,
 *     PASSENGER_INSTRUCTIONS, ROUTE_LOGISTICS, EMERGENCY_PROCEDURES,
 *     DRIVER_STATE).
 *   - ~35 items seed couvrant la check-list pré-voyage transport passagers
 *     (réglementation + QHSE + consignes passagers + état conducteur).
 *
 * Backfill : les BriefingEquipmentType existants (legacy kind QUANTITY) sont
 * migrés vers BriefingItem dans le chapitre SAFETY_EQUIPMENT, sans écraser
 * les items seed du même code.
 *
 * Idempotent : upsert par (tenantId, name) pour le template, puis par
 * (templateId, code) pour sections et items. Aucune donnée tenant n'est
 * écrasée — les `update:` des upsert sont volontairement vides pour
 * préserver les surcharges locales (activation, requiredQty, labels).
 *
 * Exécution :
 *   npx ts-node prisma/seeds/briefing-template.seed.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const DEFAULT_BRIEFING_TEMPLATE_NAME = 'Briefing standard QHSE';

type ItemKind = 'CHECK' | 'QUANTITY' | 'DOCUMENT' | 'ACKNOWLEDGE' | 'INFO';
type AutoSource = 'DRIVER_REST_HOURS' | 'WEATHER' | 'MANIFEST_LOADED' | 'ROUTE_CONFIRMED';

interface ItemSeed {
  code:             string;
  kind:             ItemKind;
  labelFr:          string;
  labelEn:          string;
  helpFr?:          string;
  helpEn?:          string;
  requiredQty?:     number;
  isMandatory?:     boolean;
  autoSource?:      AutoSource;
  evidenceAllowed?: boolean;
}

interface SectionSeed {
  code:    string;
  titleFr: string;
  titleEn: string;
  items:   ItemSeed[];
}

// ─── Template par défaut ──────────────────────────────────────────────────────

export const DEFAULT_SECTIONS: SectionSeed[] = [
  // ── 1. Documents à bord ────────────────────────────────────────────────────
  {
    code: 'DOCUMENTS', titleFr: 'Documents à bord', titleEn: 'Onboard documents',
    items: [
      { code: 'DOC_CARTE_GRISE',      kind: 'DOCUMENT', labelFr: 'Carte grise présente',              labelEn: 'Vehicle registration on board',    isMandatory: true,  evidenceAllowed: true },
      { code: 'DOC_ASSURANCE',        kind: 'DOCUMENT', labelFr: 'Attestation d\'assurance',           labelEn: 'Insurance certificate',            isMandatory: true,  evidenceAllowed: true },
      { code: 'DOC_LICENCE_TRANSPORT',kind: 'DOCUMENT', labelFr: 'Licence de transport',               labelEn: 'Transport license',                isMandatory: true,  evidenceAllowed: true },
      { code: 'DOC_FEUILLE_ROUTE',    kind: 'DOCUMENT', labelFr: 'Feuille de route (si nécessaire)',   labelEn: 'Roadbook (if required)',           isMandatory: false, evidenceAllowed: true },
      { code: 'DOC_AMENAGEMENT',      kind: 'DOCUMENT', labelFr: 'Attestation d\'aménagement du véhicule', labelEn: 'Vehicle outfitting certificate', isMandatory: false, evidenceAllowed: true },
    ],
  },

  // ── 2. État du véhicule (R.V.C.) ───────────────────────────────────────────
  {
    code: 'VEHICLE_STATE', titleFr: 'État du véhicule (R.V.C.)', titleEn: 'Vehicle state (pre-departure check)',
    items: [
      { code: 'VEH_PNEUS',    kind: 'CHECK', labelFr: 'Pneumatiques : état et pression corrects',                                        labelEn: 'Tires: condition and pressure OK',                                    isMandatory: true },
      { code: 'VEH_FREINAGE', kind: 'CHECK', labelFr: 'Freinage : test des freins (service + frein à main)',                             labelEn: 'Brakes: service and parking brake tested',                            isMandatory: true },
      { code: 'VEH_FEUX',     kind: 'CHECK', labelFr: 'Feux : position, croisement, route, stop, clignotants',                           labelEn: 'Lights: position, low/high beam, stop, indicators',                   isMandatory: true },
      { code: 'VEH_NIVEAUX',  kind: 'CHECK', labelFr: 'Niveaux : huile moteur, liquide de refroidissement, lave-glace',                  labelEn: 'Fluid levels: engine oil, coolant, washer fluid',                     isMandatory: true },
    ],
  },

  // ── 3. Sécurité (équipements) ──────────────────────────────────────────────
  {
    code: 'SAFETY_EQUIPMENT', titleFr: 'Sécurité — Équipements à bord', titleEn: 'Safety — Onboard equipment',
    items: [
      { code: 'SAFETY_ISSUES_SECOURS', kind: 'CHECK',    labelFr: 'Issues de secours déverrouillées',         labelEn: 'Emergency exits unlocked',      isMandatory: true },
      { code: 'SAFETY_MARTEAUX',       kind: 'QUANTITY', labelFr: 'Marteaux brise-vitres présents',           labelEn: 'Emergency hammers present',     isMandatory: true, requiredQty: 2 },
      { code: 'SAFETY_EXTINCTEUR',     kind: 'QUANTITY', labelFr: 'Extincteur présent et accessible',         labelEn: 'Fire extinguisher present',     isMandatory: true, requiredQty: 1 },
      { code: 'SAFETY_TROUSSE',        kind: 'QUANTITY', labelFr: 'Trousse de secours présente',              labelEn: 'First-aid kit present',         isMandatory: true, requiredQty: 1 },
      { code: 'SAFETY_VESTS',          kind: 'QUANTITY', labelFr: 'Gilets de sécurité',                       labelEn: 'High-visibility vests',         isMandatory: true, requiredQty: 2 },
      { code: 'SAFETY_TRIANGLES',      kind: 'QUANTITY', labelFr: 'Triangles de signalisation',               labelEn: 'Warning triangles',             isMandatory: true, requiredQty: 2 },
      { code: 'SAFETY_CALES',          kind: 'QUANTITY', labelFr: 'Cales de roue',                            labelEn: 'Wheel chocks',                  isMandatory: false, requiredQty: 2 },
    ],
  },

  // ── 4. Confort ─────────────────────────────────────────────────────────────
  {
    code: 'COMFORT', titleFr: 'Confort', titleEn: 'Comfort',
    items: [
      { code: 'COMFORT_CLIM',      kind: 'CHECK', labelFr: 'Climatisation / chauffage fonctionnels', labelEn: 'A/C and heating functional', isMandatory: false },
      { code: 'COMFORT_INTERIEUR', kind: 'CHECK', labelFr: 'Intérieur propre et en bon état',        labelEn: 'Clean interior, good condition', isMandatory: false },
    ],
  },

  // ── 5. Consignes de sécurité passagers ────────────────────────────────────
  {
    code: 'PASSENGER_INSTRUCTIONS', titleFr: 'Consignes de sécurité passagers', titleEn: 'Passenger safety instructions',
    items: [
      { code: 'PAX_CEINTURE',            kind: 'ACKNOWLEDGE', labelFr: 'Annonce du port obligatoire de la ceinture',         labelEn: 'Seat belt announcement delivered',           isMandatory: true },
      { code: 'PAX_CONSIGNES_URGENCE',   kind: 'ACKNOWLEDGE', labelFr: 'Explication des consignes d\'urgence',               labelEn: 'Emergency instructions explained',           isMandatory: true },
      { code: 'PAX_ISSUES_SECOURS',      kind: 'ACKNOWLEDGE', labelFr: 'Localisation des issues de secours indiquée',        labelEn: 'Emergency exits location indicated',         isMandatory: true },
      { code: 'PAX_MARTEAUX_EXTINCTEURS',kind: 'ACKNOWLEDGE', labelFr: 'Emplacement des marteaux et extincteurs expliqué',    labelEn: 'Hammers and extinguishers location shown',   isMandatory: true },
      { code: 'PAX_NON_FUMEUR',          kind: 'ACKNOWLEDGE', labelFr: 'Interdiction de fumer / vapoter rappelée',           labelEn: 'No-smoking / vaping reminder delivered',     isMandatory: true },
      { code: 'PAX_ALLEE_DEGAGEE',       kind: 'CHECK',       labelFr: 'Allée centrale dégagée (pas de bagages)',            labelEn: 'Central aisle clear (no luggage)',           isMandatory: true },
    ],
  },

  // ── 6. Itinéraire, logistique et sécurité ─────────────────────────────────
  {
    code: 'ROUTE_LOGISTICS', titleFr: 'Itinéraire, logistique et sécurité', titleEn: 'Route, logistics & safety',
    items: [
      { code: 'ROUTE_CONFIRMED',             kind: 'INFO',        labelFr: 'Itinéraire confirmé (points de ramassage, arrêts)', labelEn: 'Route confirmed (pickup points, stops)',    isMandatory: true,  autoSource: 'ROUTE_CONFIRMED' },
      { code: 'ROUTE_TEMPS_VERIFIE',         kind: 'CHECK',       labelFr: 'Temps de trajet vérifié',                            labelEn: 'Travel time verified',                       isMandatory: false },
      { code: 'ROUTE_MANIFEST',              kind: 'INFO',        labelFr: 'Liste des passagers à bord',                         labelEn: 'Passenger manifest loaded',                  isMandatory: true,  autoSource: 'MANIFEST_LOADED' },
      { code: 'ROUTE_METEO',                 kind: 'INFO',        labelFr: 'Conditions météo vérifiées',                         labelEn: 'Weather conditions checked',                 isMandatory: false, autoSource: 'WEATHER' },
      { code: 'ROUTE_EQUIPEMENTS_SAISONNIERS',kind: 'CHECK',      labelFr: 'Équipements adaptés (ex : chaînes neige si besoin)', labelEn: 'Seasonal equipment ready (e.g. snow chains)', isMandatory: false },
      { code: 'ROUTE_CONDUITE_ADAPTEE',      kind: 'ACKNOWLEDGE', labelFr: 'Conduite adaptée au transport de passagers',         labelEn: 'Driving style adapted to passenger transport', isMandatory: true },
    ],
  },

  // ── 7. Procédures en cas d'urgence ────────────────────────────────────────
  {
    code: 'EMERGENCY_PROCEDURES', titleFr: 'Procédures en cas d\'urgence', titleEn: 'Emergency procedures',
    items: [
      { code: 'EMERG_PANNE',             kind: 'ACKNOWLEDGE', labelFr: 'Procédure en cas de panne connue',              labelEn: 'Breakdown procedure known',               isMandatory: true },
      { code: 'EMERG_ACCIDENT',          kind: 'ACKNOWLEDGE', labelFr: 'Procédure en cas d\'accident connue',           labelEn: 'Accident procedure known',                isMandatory: true },
      { code: 'EMERG_CONTACT',           kind: 'ACKNOWLEDGE', labelFr: 'Moyens de contact avec entreprise / assistance', labelEn: 'Company / assistance contacts known',     isMandatory: true },
      { code: 'EMERG_EVACUATION',        kind: 'ACKNOWLEDGE', labelFr: 'Procédure d\'évacuation maîtrisée',             labelEn: 'Evacuation procedure mastered',           isMandatory: true },
      { code: 'EMERG_INSTRUCTIONS_PAX',  kind: 'ACKNOWLEDGE', labelFr: 'Instructions claires à donner aux passagers',    labelEn: 'Clear instructions prepared for passengers', isMandatory: true },
    ],
  },

  // ── 8. État conducteur (autodéclaration + repos auto-calculé) ─────────────
  {
    code: 'DRIVER_STATE', titleFr: 'État du conducteur', titleEn: 'Driver state',
    items: [
      { code: 'DRIVER_REST_HOURS',  kind: 'INFO',  labelFr: 'Repos minimal respecté',                            labelEn: 'Minimum rest hours respected',                  isMandatory: true, autoSource: 'DRIVER_REST_HOURS',
        helpFr: 'Calculé automatiquement depuis la fin du dernier trajet terminé. Seuil configurable par tenant (défaut 11h).',
        helpEn: 'Auto-computed from the end of the last completed trip. Threshold configurable per tenant (default 11h).' },
      { code: 'DRIVER_FITNESS',     kind: 'CHECK', labelFr: 'Aptitude physique autodéclarée',                     labelEn: 'Self-declared fit to drive',                    isMandatory: true },
      { code: 'DRIVER_NO_ALCOHOL',  kind: 'CHECK', labelFr: 'Absence d\'alcool',                                  labelEn: 'No alcohol',                                    isMandatory: true },
      { code: 'DRIVER_NO_DRUGS',    kind: 'CHECK', labelFr: 'Absence de stupéfiants',                             labelEn: 'No drugs',                                      isMandatory: true },
      { code: 'DRIVER_MEDICATION',  kind: 'CHECK', labelFr: 'Aucun médicament impactant la conduite',             labelEn: 'No medication impairing driving ability',       isMandatory: true },
      { code: 'DRIVER_FATIGUE',     kind: 'CHECK', labelFr: 'Absence d\'état de fatigue',                         labelEn: 'No fatigue reported',                           isMandatory: true },
    ],
  },
];

// ─── Seed per-tenant ──────────────────────────────────────────────────────────

export async function seedBriefingTemplateForTenant(tenantId: string): Promise<{ templateId: string; itemsCreated: number; legacyMigrated: number }> {
  const template = await prisma.briefingTemplate.upsert({
    where:  { tenantId_name: { tenantId, name: DEFAULT_BRIEFING_TEMPLATE_NAME } },
    create: {
      tenantId,
      name:        DEFAULT_BRIEFING_TEMPLATE_NAME,
      description: 'Modèle par défaut multi-chapitres QHSE. Tenant admin peut activer/désactiver chaque item, ajuster `isMandatory`/`requiredQty`, ou créer des templates spécifiques (urbain, longue distance, fret).',
      isDefault:   true,
      isActive:    true,
    },
    update: {},
  });

  let itemsCreated = 0;

  for (const [sIdx, s] of DEFAULT_SECTIONS.entries()) {
    const section = await prisma.briefingSection.upsert({
      where:  { templateId_code: { templateId: template.id, code: s.code } },
      create: {
        tenantId,
        templateId: template.id,
        code:       s.code,
        titleFr:    s.titleFr,
        titleEn:    s.titleEn,
        order:      sIdx,
      },
      update: {},
    });

    for (const [iIdx, item] of s.items.entries()) {
      const result = await prisma.briefingItem.upsert({
        where:  { sectionId_code: { sectionId: section.id, code: item.code } },
        create: {
          tenantId,
          sectionId:       section.id,
          code:            item.code,
          kind:            item.kind,
          labelFr:         item.labelFr,
          labelEn:         item.labelEn,
          helpFr:          item.helpFr ?? null,
          helpEn:          item.helpEn ?? null,
          requiredQty:     item.requiredQty ?? 1,
          isMandatory:     item.isMandatory ?? true,
          isActive:        true,
          order:           iIdx,
          evidenceAllowed: item.evidenceAllowed ?? false,
          autoSource:      item.autoSource ?? null,
        },
        update: {},
      });
      if (result) itemsCreated++;
    }
  }

  // ── Backfill BriefingEquipmentType → BriefingItem (kind=QUANTITY) ────────
  // Pour les entrées custom que le tenant a créées avant la refonte, on les
  // intègre au chapitre SAFETY_EQUIPMENT. Les codes déjà présents dans le
  // seed (SAFETY_VESTS etc.) sont préservés — pas de duplication.
  const legacyEquipments = await prisma.briefingEquipmentType.findMany({
    where: { tenantId, isActive: true },
  });
  const safetySection = await prisma.briefingSection.findUnique({
    where: { templateId_code: { templateId: template.id, code: 'SAFETY_EQUIPMENT' } },
  });

  let legacyMigrated = 0;
  if (safetySection) {
    for (const eq of legacyEquipments) {
      const existsInTemplate = await prisma.briefingItem.findFirst({
        where: { section: { templateId: template.id }, code: eq.code },
      });
      if (existsInTemplate) continue;

      await prisma.briefingItem.create({
        data: {
          tenantId,
          sectionId:       safetySection.id,
          code:            eq.code,
          kind:            'QUANTITY',
          labelFr:         eq.name,
          labelEn:         eq.name, // tenant pourra raffiner via l'UI
          requiredQty:     eq.requiredQty,
          isMandatory:     eq.isMandatory,
          isActive:        true,
          order:           999,
          evidenceAllowed: false,
        },
      });
      legacyMigrated++;
    }
  }

  return { templateId: template.id, itemsCreated, legacyMigrated };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const tenants = await prisma.tenant.findMany({
    where:  { isActive: true },
    select: { id: true, slug: true, name: true },
  });

  // eslint-disable-next-line no-console
  console.log(`[briefing-template.seed] Traitement de ${tenants.length} tenant(s)...`);

  let totalLegacy = 0;
  for (const t of tenants) {
    const { legacyMigrated } = await seedBriefingTemplateForTenant(t.id);
    totalLegacy += legacyMigrated;
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${t.slug.padEnd(20)} (${t.name}) — legacy migrés: ${legacyMigrated}`);
  }

  // eslint-disable-next-line no-console
  console.log(`[briefing-template.seed] ✓ Fini — ${totalLegacy} items legacy migrés au total.`);
}

if (require.main === module) {
  main()
    .then(() => prisma.$disconnect())
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[briefing-template.seed] ✗ Erreur :', e);
      prisma.$disconnect();
      process.exit(1);
    });
}
