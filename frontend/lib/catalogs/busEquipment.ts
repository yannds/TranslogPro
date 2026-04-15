/**
 * Catalogue de référence des équipements d'autocar — normes européennes.
 *
 * Sources normatives :
 *   - UNECE R107 (homologation véhicules transport passagers)
 *   - Règlement UE 2018/858 (homologation véhicules)
 *   - Directive 2007/46/CE (sécurité active / passive)
 *   - Règlement UE 2019/2144 (General Safety Regulation)
 *   - Code de la route FR — Art. R.313-1 à R.317-23
 *   - DIN 13164 (trousse de premiers secours DE)
 *   - Code de la route BE / IT / ES / DE (équivalents)
 *
 * Le champ `isMandatory` reflète une exigence réglementaire ou d'usage
 * dans la majorité des pays UE. Les tenants peuvent surcharger la valeur.
 *
 * Les catégories ne sont pas persistées côté serveur ; elles servent
 * uniquement à grouper l'affichage dans le module de checklist.
 */

export type BusEquipmentCategory =
  | 'SECURITY'
  | 'FIRE'
  | 'FIRST_AID'
  | 'SIGNALING'
  | 'TOOLS'
  | 'ACCESSIBILITY'
  | 'CHILDREN'
  | 'COMFORT'
  | 'ONBOARD'
  | 'LUGGAGE'
  | 'TECHNICAL';

export interface BusEquipmentCatalogItem {
  /** Code unique stable (SNAKE_CASE, MAJUSCULES, ≤ 32 car.). */
  code:        string;
  /** Libellé court francophone. */
  name:        string;
  /** Catégorie logique (grouping UI). */
  category:    BusEquipmentCategory;
  /** Quantité normalement requise par véhicule. */
  requiredQty: number;
  /** Exigence réglementaire UE / bloquante au départ. */
  isMandatory: boolean;
  /** Contexte, norme ou référence légale. */
  notes?:      string;
}

export interface BusEquipmentCategoryMeta {
  id:          BusEquipmentCategory;
  label:       string;
  description: string;
}

export const BUS_EQUIPMENT_CATEGORIES: readonly BusEquipmentCategoryMeta[] = [
  { id: 'SECURITY',      label: 'Sécurité active',    description: 'Gilets, ceintures, coupe-ceinture, marteaux brise-vitre' },
  { id: 'FIRE',          label: 'Lutte incendie',     description: 'Extincteurs, détecteur de fumée, système anti-feu moteur' },
  { id: 'FIRST_AID',     label: 'Premiers secours',   description: 'Trousse DIN 13164, défibrillateur, couverture de survie' },
  { id: 'SIGNALING',     label: 'Signalisation',      description: 'Triangles, lampes, fusées de détresse, girouette' },
  { id: 'TOOLS',         label: 'Outillage & dépannage', description: 'Cric, cales, roue de secours, boîte à outils' },
  { id: 'ACCESSIBILITY', label: 'Accessibilité PMR',  description: 'Rampe, plateforme, fixations fauteuil, boucle magnétique' },
  { id: 'CHILDREN',      label: 'Famille & enfants',  description: 'Sièges bébé, rehausseurs, table à langer, ceintures enfant' },
  { id: 'COMFORT',       label: 'Confort passagers',  description: 'Climatisation, appui-tête, repose-pieds, éclairage individuel' },
  { id: 'ONBOARD',       label: 'Services embarqués', description: 'WC, réfrigérateur, USB, Wi-Fi, écrans' },
  { id: 'LUGGAGE',       label: 'Bagages',            description: 'Soute, porte-bagages, sangles, filets' },
  { id: 'TECHNICAL',     label: 'Technique véhicule', description: 'Tachygraphe, limiteur, éthylomètre, caméras' },
] as const;

export const CATEGORY_LABEL: Record<BusEquipmentCategory, string> =
  BUS_EQUIPMENT_CATEGORIES.reduce((acc, c) => {
    acc[c.id] = c.label;
    return acc;
  }, {} as Record<BusEquipmentCategory, string>);

// ─── Catalogue ────────────────────────────────────────────────────────────────
//
// Ordre logique : sécurité active → incendie → secours → signalisation → outillage
// → accessibilité → enfants → confort → services → bagages → technique.

export const BUS_EQUIPMENT_CATALOG: readonly BusEquipmentCatalogItem[] = [
  // ── Sécurité active ──
  { code: 'SAFETY_VEST',          name: 'Gilet haute visibilité',            category: 'SECURITY',  requiredQty: 2, isMandatory: true,  notes: 'EN ISO 20471 — 1 par agent à bord' },
  { code: 'SEATBELT_3P',          name: 'Ceintures 3 points (sièges)',       category: 'SECURITY',  requiredQty: 1, isMandatory: true,  notes: 'Obligatoire UE depuis 2007/46/CE' },
  { code: 'SEATBELT_CUTTER',      name: 'Coupe-ceinture d\'urgence',         category: 'SECURITY',  requiredQty: 2, isMandatory: true },
  { code: 'EMERGENCY_HAMMER',     name: 'Marteau brise-vitre',               category: 'SECURITY',  requiredQty: 4, isMandatory: true,  notes: 'UNECE R107 — 1 tous les 6 rangs mini' },
  { code: 'EMERGENCY_EXIT_SIGN',  name: 'Signalétique issues de secours',    category: 'SECURITY',  requiredQty: 1, isMandatory: true },
  { code: 'ANTI_SLIP_FLOOR',      name: 'Revêtement de sol antidérapant',    category: 'SECURITY',  requiredQty: 1, isMandatory: true },
  { code: 'DRIVER_SHIELD',        name: 'Écran de protection cabine conducteur', category: 'SECURITY', requiredQty: 1, isMandatory: false, notes: 'Recommandé post-COVID' },

  // ── Lutte incendie ──
  { code: 'FIRE_EXT_ABC_6KG',     name: 'Extincteur ABC 6 kg',               category: 'FIRE',      requiredQty: 1, isMandatory: true,  notes: 'NF EN 3 — habitacle' },
  { code: 'FIRE_EXT_ABC_2KG',     name: 'Extincteur ABC 2 kg (cabine)',      category: 'FIRE',      requiredQty: 1, isMandatory: true },
  { code: 'ENGINE_FIRE_SUPPR',    name: 'Système anti-incendie moteur',      category: 'FIRE',      requiredQty: 1, isMandatory: true,  notes: 'UE 2019/2144 — cars >22 passagers' },
  { code: 'SMOKE_DETECTOR',       name: 'Détecteur de fumée habitacle',      category: 'FIRE',      requiredQty: 1, isMandatory: true,  notes: 'UE 2019/2144 — applicable 2021+' },
  { code: 'FIRE_BLANKET',         name: 'Couverture anti-feu',               category: 'FIRE',      requiredQty: 1, isMandatory: false },

  // ── Premiers secours ──
  { code: 'FIRST_AID_KIT',        name: 'Trousse de premiers secours',       category: 'FIRST_AID', requiredQty: 1, isMandatory: true,  notes: 'DIN 13164 (DE) / NF X08-003 (FR)' },
  { code: 'AED_DEFIB',            name: 'Défibrillateur automatisé externe', category: 'FIRST_AID', requiredQty: 1, isMandatory: false, notes: 'Recommandé lignes longues > 4h' },
  { code: 'SURVIVAL_BLANKET',     name: 'Couverture de survie',              category: 'FIRST_AID', requiredQty: 4, isMandatory: false },
  { code: 'EMERGENCY_OXYGEN',     name: 'Bouteille d\'oxygène de secours',   category: 'FIRST_AID', requiredQty: 1, isMandatory: false },
  { code: 'VOMIT_BAGS',           name: 'Sacs vomitoires',                   category: 'FIRST_AID', requiredQty: 20, isMandatory: false },
  { code: 'HAND_SANITIZER',       name: 'Gel hydroalcoolique',               category: 'FIRST_AID', requiredQty: 1, isMandatory: false },

  // ── Signalisation ──
  { code: 'WARNING_TRIANGLE',     name: 'Triangle de signalisation',         category: 'SIGNALING', requiredQty: 2, isMandatory: true,  notes: 'Article R416-19 FR — 2 pour véhicules > 3,5 t' },
  { code: 'SAFETY_FLARE',         name: 'Fusée de détresse',                 category: 'SIGNALING', requiredQty: 2, isMandatory: false, notes: 'Obligatoire ES / IT' },
  { code: 'FLASHLIGHT',           name: 'Lampe torche rechargeable',         category: 'SIGNALING', requiredQty: 2, isMandatory: true },
  { code: 'ROAD_CONE',            name: 'Cône de balisage',                  category: 'SIGNALING', requiredQty: 2, isMandatory: false },
  { code: 'DESTINATION_SIGN',     name: 'Girouette électronique (destination)', category: 'SIGNALING', requiredQty: 1, isMandatory: true },

  // ── Outillage & dépannage ──
  { code: 'WHEEL_CHOCKS',         name: 'Cales de roues',                    category: 'TOOLS',     requiredQty: 2, isMandatory: true,  notes: 'R.317-23 FR — 2 pour PL' },
  { code: 'JACK_HYDRAULIC',       name: 'Cric hydraulique',                  category: 'TOOLS',     requiredQty: 1, isMandatory: true },
  { code: 'SPARE_WHEEL',          name: 'Roue de secours',                   category: 'TOOLS',     requiredQty: 1, isMandatory: false, notes: 'Optionnel si contrat dépannage UE' },
  { code: 'TIRE_IRON',            name: 'Clé en croix / manivelle',          category: 'TOOLS',     requiredQty: 1, isMandatory: true },
  { code: 'TOOLBOX_BASIC',        name: 'Boîte à outils de base',            category: 'TOOLS',     requiredQty: 1, isMandatory: true },
  { code: 'TOW_STRAP',            name: 'Sangle de remorquage',              category: 'TOOLS',     requiredQty: 1, isMandatory: false },
  { code: 'JUMPER_CABLES',        name: 'Câbles de démarrage',               category: 'TOOLS',     requiredQty: 1, isMandatory: false },
  { code: 'SPILL_KIT',            name: 'Kit absorbant hydrocarbures',       category: 'TOOLS',     requiredQty: 1, isMandatory: false, notes: 'Recommandé transport scolaire' },

  // ── Accessibilité PMR ──
  { code: 'PMR_RAMP',             name: 'Rampe d\'accès PMR',                category: 'ACCESSIBILITY', requiredQty: 1, isMandatory: true, notes: 'UE 2001/85/CE' },
  { code: 'PMR_LIFT',             name: 'Plateforme élévatrice',             category: 'ACCESSIBILITY', requiredQty: 1, isMandatory: false },
  { code: 'WHEELCHAIR_RESTRAINT', name: 'Système de fixation fauteuil roulant', category: 'ACCESSIBILITY', requiredQty: 4, isMandatory: true, notes: '4 sangles + ceinture ISO 10542' },
  { code: 'HEARING_LOOP',         name: 'Boucle magnétique malentendants',   category: 'ACCESSIBILITY', requiredQty: 1, isMandatory: false },
  { code: 'BRAILLE_SIGNS',        name: 'Signalétique braille intérieure',   category: 'ACCESSIBILITY', requiredQty: 1, isMandatory: false },
  { code: 'STOP_ANNOUNCER',       name: 'Annonceur vocal d\'arrêts',         category: 'ACCESSIBILITY', requiredQty: 1, isMandatory: true,  notes: 'UE 2001/85/CE — urbain' },
  { code: 'TACTILE_STRIPS',       name: 'Bandes podotactiles',               category: 'ACCESSIBILITY', requiredQty: 1, isMandatory: false },
  { code: 'HANDRAIL_PMR',         name: 'Barres d\'appui contrastées',       category: 'ACCESSIBILITY', requiredQty: 2, isMandatory: true },

  // ── Famille & enfants ──
  { code: 'BABY_SEAT',            name: 'Siège bébé ISOFIX (0-13 kg)',       category: 'CHILDREN',  requiredQty: 1, isMandatory: false, notes: 'Groupe 0+ / i-Size UN R129' },
  { code: 'CHILD_SEAT',           name: 'Siège enfant (9-18 kg)',            category: 'CHILDREN',  requiredQty: 1, isMandatory: false, notes: 'Groupe 1 — UN R44/04' },
  { code: 'BOOSTER_SEAT',         name: 'Rehausseur (15-36 kg)',             category: 'CHILDREN',  requiredQty: 2, isMandatory: false },
  { code: 'CHILD_HARNESS',        name: 'Harnais enfant supplémentaire',     category: 'CHILDREN',  requiredQty: 2, isMandatory: false },
  { code: 'CHANGING_TABLE',       name: 'Table à langer (toilettes)',        category: 'CHILDREN',  requiredQty: 1, isMandatory: false, notes: 'Cars famille / longue distance' },
  { code: 'NURSING_CURTAIN',      name: 'Rideau d\'intimité allaitement',    category: 'CHILDREN',  requiredQty: 1, isMandatory: false },

  // ── Confort passagers ──
  { code: 'HVAC_AC',              name: 'Climatisation habitacle',           category: 'COMFORT',   requiredQty: 1, isMandatory: false },
  { code: 'HEATING',              name: 'Chauffage indépendant',             category: 'COMFORT',   requiredQty: 1, isMandatory: true,  notes: 'Obligatoire pays froids UE' },
  { code: 'ADJUSTABLE_HEADREST',  name: 'Appui-têtes réglables',             category: 'COMFORT',   requiredQty: 1, isMandatory: true },
  { code: 'RECLINING_SEATS',      name: 'Sièges inclinables',                category: 'COMFORT',   requiredQty: 1, isMandatory: false },
  { code: 'FOOTREST',             name: 'Repose-pieds',                      category: 'COMFORT',   requiredQty: 1, isMandatory: false },
  { code: 'READING_LIGHTS',       name: 'Éclairage de lecture individuel',   category: 'COMFORT',   requiredQty: 1, isMandatory: false },
  { code: 'AIR_NOZZLES',          name: 'Aérateurs individuels',             category: 'COMFORT',   requiredQty: 1, isMandatory: false },
  { code: 'WINDOW_CURTAINS',      name: 'Rideaux occultants latéraux',       category: 'COMFORT',   requiredQty: 1, isMandatory: false },

  // ── Services embarqués ──
  { code: 'ONBOARD_WC',           name: 'Toilettes embarquées',              category: 'ONBOARD',   requiredQty: 1, isMandatory: false },
  { code: 'MINI_FRIDGE',          name: 'Réfrigérateur / bar',               category: 'ONBOARD',   requiredQty: 1, isMandatory: false },
  { code: 'WATER_DISPENSER',      name: 'Distributeur d\'eau',               category: 'ONBOARD',   requiredQty: 1, isMandatory: false },
  { code: 'USB_OUTLET',           name: 'Prises USB individuelles',          category: 'ONBOARD',   requiredQty: 1, isMandatory: false },
  { code: 'POWER_OUTLET_220V',    name: 'Prises 220V (rangée)',              category: 'ONBOARD',   requiredQty: 1, isMandatory: false },
  { code: 'WIFI_ONBOARD',         name: 'Wi-Fi embarqué',                    category: 'ONBOARD',   requiredQty: 1, isMandatory: false },
  { code: 'VIDEO_SCREENS',        name: 'Écrans vidéo passagers',            category: 'ONBOARD',   requiredQty: 1, isMandatory: false },
  { code: 'AUDIO_SYSTEM',         name: 'Sono / micros conducteur et guide', category: 'ONBOARD',   requiredQty: 2, isMandatory: false },
  { code: 'PA_MICROPHONE',        name: 'Micro annonces conducteur',         category: 'ONBOARD',   requiredQty: 1, isMandatory: true },

  // ── Bagages ──
  { code: 'LUGGAGE_HOLD',         name: 'Soute à bagages',                   category: 'LUGGAGE',   requiredQty: 1, isMandatory: true },
  { code: 'OVERHEAD_RACK',        name: 'Porte-bagages cabine',              category: 'LUGGAGE',   requiredQty: 1, isMandatory: true },
  { code: 'LUGGAGE_STRAPS',       name: 'Sangles d\'arrimage bagages',       category: 'LUGGAGE',   requiredQty: 4, isMandatory: true },
  { code: 'LUGGAGE_NET',          name: 'Filet de séparation soute',         category: 'LUGGAGE',   requiredQty: 1, isMandatory: false },
  { code: 'LUGGAGE_TAGS',         name: 'Étiquettes bagages numérotées',     category: 'LUGGAGE',   requiredQty: 50, isMandatory: false },

  // ── Technique véhicule ──
  { code: 'DIGITAL_TACHOGRAPH',   name: 'Tachygraphe numérique',             category: 'TECHNICAL', requiredQty: 1, isMandatory: true,  notes: 'UE 165/2014 — véhicules > 3,5 t' },
  { code: 'SPEED_LIMITER_100',    name: 'Limiteur de vitesse 100 km/h',      category: 'TECHNICAL', requiredQty: 1, isMandatory: true,  notes: 'Directive 92/6/CE — cars >10 places' },
  { code: 'ALCOHOL_INTERLOCK',    name: 'Éthylomètre antidémarrage',         category: 'TECHNICAL', requiredQty: 1, isMandatory: false, notes: 'Obligatoire FR 2024 transport enfants' },
  { code: 'BREATHALYZER',         name: 'Éthylotest (non antidémarrage)',    category: 'TECHNICAL', requiredQty: 2, isMandatory: false },
  { code: 'DASHCAM',              name: 'Caméra de tableau de bord',         category: 'TECHNICAL', requiredQty: 1, isMandatory: false },
  { code: 'CCTV_INTERIOR',        name: 'Caméras intérieures passagers',     category: 'TECHNICAL', requiredQty: 2, isMandatory: false, notes: 'RGPD — information passagers requise' },
  { code: 'REVERSE_CAMERA',       name: 'Caméra de recul',                   category: 'TECHNICAL', requiredQty: 1, isMandatory: true,  notes: 'UE 2019/2144' },
  { code: 'ECALL_SYSTEM',         name: 'Appel d\'urgence automatique eCall', category: 'TECHNICAL', requiredQty: 1, isMandatory: true, notes: 'UE 2015/758' },
  { code: 'GPS_TRACKER',          name: 'Traceur GPS temps réel',            category: 'TECHNICAL', requiredQty: 1, isMandatory: false },
  { code: 'TIRE_PRESSURE_MON',    name: 'Contrôleur pression pneus (TPMS)',  category: 'TECHNICAL', requiredQty: 1, isMandatory: true,  notes: 'UE 2019/2144' },
  { code: 'LANE_KEEP_ASSIST',     name: 'Aide au maintien de voie',          category: 'TECHNICAL', requiredQty: 1, isMandatory: true,  notes: 'UE 2019/2144 — 07/2024' },
  { code: 'DROWSINESS_MONITOR',   name: 'Détecteur de somnolence conducteur', category: 'TECHNICAL', requiredQty: 1, isMandatory: true, notes: 'UE 2019/2144' },
  { code: 'EMERGENCY_BRAKE_AEBS', name: 'Freinage d\'urgence automatique',   category: 'TECHNICAL', requiredQty: 1, isMandatory: true,  notes: 'UE 2019/2144 — AEBS' },
] as const;

/** Map rapide code → item pour lookup. */
export const BUS_EQUIPMENT_INDEX: ReadonlyMap<string, BusEquipmentCatalogItem> = new Map(
  BUS_EQUIPMENT_CATALOG.map(i => [i.code, i]),
);

/** Dérive la catégorie d'un équipement persisté à partir de son code. */
export function inferEquipmentCategory(code: string): BusEquipmentCategory {
  return BUS_EQUIPMENT_INDEX.get(code)?.category ?? 'SECURITY';
}
