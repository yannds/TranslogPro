/**
 * StatusConfig — Abstraction complète des statuts
 *
 * Zéro couleur hardcodée. Toutes les valeurs visuelles utilisent
 * des classes Tailwind CSS sémantiques (dark: compatibles) ou des
 * variables CSS custom property définies par le ThemeProvider/TenantConfig.
 *
 * En production, cette config est chargée depuis l'API tenant :
 *   GET /api/tenant/config/statuses
 * Le DEFAULT_STATUS_CONFIG sert de fallback si l'API est indisponible.
 */

import type { TranslationMap } from '../i18n/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StatusVisual {
  /** Classes Tailwind pour le badge (bg, text, border) — dark: natif */
  badgeCls:      string;
  /** Classes de row quand ce statut est actif */
  rowCls?:       string;
  /** Animation Tailwind optionnelle */
  animateCls?:   string;
  /** Priorité d'affichage (1 = top) */
  priority:      number;
  /** Le statut est-il "terminal" (n'évolue plus) */
  terminal:      boolean;
}

export interface StatusConfig {
  id:          string;
  label:       TranslationMap;
  /**
   * Description longue affichée en tooltip / info contextuelle.
   * Explique ce que l'état signifie dans la langue du système.
   * Optionnelle — si absente, l'UI retombe sur label seul.
   */
  description?: TranslationMap;
  visual:       StatusVisual;
}

// ─── Registre agnostique (chargé depuis API, fallback ci-dessous) ─────────────

export type StatusRegistry = Record<string, StatusConfig>;

// ─── Config par défaut ────────────────────────────────────────────────────────
// Utilise exclusivement des tokens Tailwind dark-mode natifs.

export const DEFAULT_TRIP_STATUS_REGISTRY: StatusRegistry = {
  SCHEDULED: {
    id: 'SCHEDULED',
    label: {
      fr: 'Prévu',       en: 'Scheduled',  ln: 'Elakisami',  ktu: 'Elakisi',
      es: 'Programado',  pt: 'Programado', ar: 'مجدول',      wo: 'Yëgël',
    },
    visual: {
      badgeCls:  'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800',
      priority:  4,
      terminal:  false,
    },
  },
  BOARDING: {
    id: 'BOARDING',
    label: {
      fr: 'Embarquement', en: 'Boarding',   ln: 'Kolɛkɛ',    ktu: 'Kokela',
      es: 'Embarcando',   pt: 'Embarcando', ar: 'صعود',      wo: 'Yëngël',
    },
    visual: {
      badgeCls:  'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-700',
      rowCls:    'dark:bg-amber-950/10',
      animateCls: 'animate-pulse',
      priority:  1,
      terminal:  false,
    },
  },
  BOARDING_COMPLETE: {
    id: 'BOARDING_COMPLETE',
    label: {
      fr: 'Terminé',    en: 'Complete',   ln: 'Esilemba',  ktu: 'Esilisa',
      es: 'Completo',   pt: 'Completo',   ar: 'اكتمل',     wo: 'Sàqu',
    },
    visual: {
      badgeCls:  'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-800',
      priority:  2,
      terminal:  false,
    },
  },
  DEPARTED: {
    id: 'DEPARTED',
    label: {
      fr: 'Parti',      en: 'Departed',   ln: 'Akei',      ktu: 'Akei',
      es: 'Partido',    pt: 'Partiu',     ar: 'غادر',      wo: 'Dem',
    },
    visual: {
      badgeCls:  'bg-slate-100 text-slate-400 border-slate-200 dark:bg-slate-900 dark:text-slate-600 dark:border-slate-800',
      rowCls:    'opacity-40',
      priority:  6,
      terminal:  true,
    },
  },
  DELAYED: {
    id: 'DELAYED',
    label: {
      fr: 'Retard',     en: 'Delayed',    ln: 'Elɔkɔ',     ktu: 'Elɔkɔ',
      es: 'Retrasado',  pt: 'Atrasado',   ar: 'متأخر',     wo: 'Rëdd',
    },
    visual: {
      badgeCls:  'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800',
      rowCls:    'dark:bg-orange-950/5',
      priority:  3,
      terminal:  false,
    },
  },
  CANCELLED: {
    id: 'CANCELLED',
    label: {
      fr: 'Annulé',     en: 'Cancelled',  ln: 'Etiki',     ktu: 'Etiki',
      es: 'Cancelado',  pt: 'Cancelado',  ar: 'ملغى',      wo: 'Yokk',
    },
    visual: {
      badgeCls:  'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-400 dark:border-red-900',
      rowCls:    'opacity-50',
      priority:  5,
      terminal:  true,
    },
  },
  ON_TIME: {
    id: 'ON_TIME',
    label: {
      fr: 'À l\'heure',  en: 'On Time',   ln: 'Na ntango',  ktu: 'Na ntangu',
      es: 'A tiempo',    pt: 'No horário', ar: 'في الموعد',  wo: 'Ci waxtaan',
    },
    visual: {
      badgeCls:  'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
      priority:  3,
      terminal:  false,
    },
  },
  ARRIVED: {
    id: 'ARRIVED',
    label: {
      fr: 'Arrivé',     en: 'Arrived',    ln: 'Akokɔma',   ktu: 'Akwisa',
      es: 'Llegado',    pt: 'Chegou',     ar: 'وصل',       wo: 'Dellu',
    },
    visual: {
      badgeCls:  'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800',
      priority:  2,
      terminal:  true,
    },
  },
  IN_TRANSIT: {
    id: 'IN_TRANSIT',
    label: {
      fr: 'En route',    en: 'In Transit',  ln: 'Na nzela',   ktu: 'Na nzela',
      es: 'En tránsito', pt: 'Em trânsito', ar: 'في الطريق',  wo: 'Ci yoon bi',
    },
    visual: {
      badgeCls:  'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800',
      animateCls: 'animate-pulse',
      priority:  2,
      terminal:  false,
    },
  },
};

// ─── Ticket — cycle de vie billet (PRD §III.7) ────────────────────────────────

export const DEFAULT_TICKET_STATUS_REGISTRY: StatusRegistry = {
  CREATED: {
    id: 'CREATED',
    label:       { fr: 'Créé',            en: 'Created' },
    description: {
      fr: "Billet initialisé, en attente de paiement ou de confirmation.",
      en: 'Ticket initialized, awaiting payment or confirmation.',
    },
    visual: { badgeCls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700', priority: 5, terminal: false },
  },
  PENDING_PAYMENT: {
    id: 'PENDING_PAYMENT',
    label:       { fr: 'À payer',         en: 'Pending payment' },
    description: {
      fr: "Réservation posée, le paiement doit être finalisé avant expiration.",
      en: 'Booking placed, payment must be completed before expiry.',
    },
    visual: { badgeCls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800', priority: 2, terminal: false, animateCls: 'animate-pulse' },
  },
  CONFIRMED: {
    id: 'CONFIRMED',
    label:       { fr: 'Confirmé',        en: 'Confirmed' },
    description: {
      fr: "Paiement reçu. Le billet est valide et peut être scanné à l'embarquement.",
      en: 'Payment received. The ticket is valid and can be scanned at boarding.',
    },
    visual: { badgeCls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800', priority: 3, terminal: false },
  },
  CHECKED_IN: {
    id: 'CHECKED_IN',
    label:       { fr: 'Enregistré',      en: 'Checked in' },
    description: {
      fr: "Voyageur scanné en gare, autorisé à accéder au quai.",
      en: 'Passenger scanned at the station, authorized to the platform.',
    },
    visual: { badgeCls: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800', priority: 2, terminal: false },
  },
  BOARDED: {
    id: 'BOARDED',
    label:       { fr: 'À bord',          en: 'Boarded' },
    description: {
      fr: "Voyageur monté à bord — billet attaché au trajet en cours.",
      en: 'Passenger on board — ticket bound to the current trip.',
    },
    visual: { badgeCls: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800', priority: 1, terminal: false },
  },
  COMPLETED: {
    id: 'COMPLETED',
    label:       { fr: 'Terminé',         en: 'Completed' },
    description: {
      fr: "Trajet achevé, billet clos — archivé pour la fidélité.",
      en: 'Trip completed, ticket closed — archived for loyalty.',
    },
    visual: { badgeCls: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700', priority: 6, terminal: true },
  },
  CANCELLED: {
    id: 'CANCELLED',
    label:       { fr: 'Annulé',          en: 'Cancelled' },
    description: {
      fr: "Billet annulé (par le client ou l'agent). Remboursement possible selon règles.",
      en: 'Ticket cancelled (by customer or agent). Refund possible per policy.',
    },
    visual: { badgeCls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900', priority: 4, terminal: true },
  },
  EXPIRED: {
    id: 'EXPIRED',
    label:       { fr: 'Expiré',          en: 'Expired' },
    description: {
      fr: "Paiement non effectué dans le délai — billet automatiquement libéré.",
      en: 'Payment not completed within time limit — ticket automatically released.',
    },
    visual: { badgeCls: 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700', priority: 7, terminal: true },
  },
  REFUND_PENDING: {
    id: 'REFUND_PENDING',
    label:       { fr: 'Remboursement',   en: 'Refund pending' },
    description: {
      fr: "Demande de remboursement en cours de traitement.",
      en: 'Refund request being processed.',
    },
    visual: { badgeCls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800', priority: 3, terminal: false },
  },
  REFUNDED: {
    id: 'REFUNDED',
    label:       { fr: 'Remboursé',       en: 'Refunded' },
    description: {
      fr: "Remboursement effectué. Billet clos.",
      en: 'Refund issued. Ticket closed.',
    },
    visual: { badgeCls: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700', priority: 6, terminal: true },
  },
};

// ─── Parcel — workflow colis (PRD §III.7, 10 états) ──────────────────────────

export const DEFAULT_PARCEL_STATUS_REGISTRY: StatusRegistry = {
  CREATED: {
    id: 'CREATED',
    label:       { fr: 'Enregistré',      en: 'Registered' },
    description: {
      fr: "Colis enregistré, en attente de dépôt physique à l'agence.",
      en: 'Parcel registered, awaiting physical drop-off at the agency.',
    },
    visual: { badgeCls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700', priority: 5, terminal: false },
  },
  AT_ORIGIN: {
    id: 'AT_ORIGIN',
    label:       { fr: "À l'agence",      en: 'At origin' },
    description: {
      fr: "Colis reçu physiquement à l'agence de départ. En attente de groupage.",
      en: 'Parcel physically received at origin agency. Awaiting grouping.',
    },
    visual: { badgeCls: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800', priority: 4, terminal: false },
  },
  PACKED: {
    id: 'PACKED',
    label:       { fr: 'Groupé',          en: 'Packed' },
    description: {
      fr: "Ajouté à une expédition (Shipment) — prêt au chargement.",
      en: 'Added to a shipment — ready for loading.',
    },
    visual: { badgeCls: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800', priority: 3, terminal: false },
  },
  LOADED: {
    id: 'LOADED',
    label:       { fr: 'Chargé',          en: 'Loaded' },
    description: {
      fr: "Chargé dans le véhicule. Départ imminent.",
      en: 'Loaded onto the vehicle. Departure imminent.',
    },
    visual: { badgeCls: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800', priority: 2, terminal: false },
  },
  IN_TRANSIT: {
    id: 'IN_TRANSIT',
    label:       { fr: 'En route',        en: 'In transit' },
    description: {
      fr: "Véhicule parti. Colis en cours d'acheminement.",
      en: 'Vehicle departed. Parcel being transported.',
    },
    visual: { badgeCls: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800', priority: 1, terminal: false, animateCls: 'animate-pulse' },
  },
  ARRIVED: {
    id: 'ARRIVED',
    label:       { fr: 'Arrivé',          en: 'Arrived' },
    description: {
      fr: "Colis arrivé à destination. En attente de retrait ou livraison.",
      en: 'Parcel arrived at destination. Awaiting pickup or delivery.',
    },
    visual: { badgeCls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800', priority: 2, terminal: false },
  },
  DELIVERED: {
    id: 'DELIVERED',
    label:       { fr: 'Livré',           en: 'Delivered' },
    description: {
      fr: "Colis remis au destinataire. Dossier clôturé.",
      en: 'Parcel delivered to recipient. Case closed.',
    },
    visual: { badgeCls: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-800', priority: 6, terminal: true },
  },
  DAMAGED: {
    id: 'DAMAGED',
    label:       { fr: 'Endommagé',       en: 'Damaged' },
    description: {
      fr: "Colis déclaré endommagé. Ouverture automatique d'un dossier SAV.",
      en: 'Parcel reported damaged. SAV claim opened automatically.',
    },
    visual: { badgeCls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800', priority: 3, terminal: false },
  },
  LOST: {
    id: 'LOST',
    label:       { fr: 'Perdu',           en: 'Lost' },
    description: {
      fr: "Colis déclaré perdu après recherche. Remboursement initié.",
      en: 'Parcel declared lost after investigation. Refund initiated.',
    },
    visual: { badgeCls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900', priority: 4, terminal: true },
  },
  RETURNED: {
    id: 'RETURNED',
    label:       { fr: 'Retourné',        en: 'Returned' },
    description: {
      fr: "Colis renvoyé à l'expéditeur (refus, erreur d'adresse…).",
      en: 'Parcel returned to sender (refusal, address error…).',
    },
    visual: { badgeCls: 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700', priority: 5, terminal: true },
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Récupère un StatusConfig avec fallback safe — retourne un objet "inconnu"
 * plutôt que null pour éviter les crash UI.
 */
export function lookupStatus(
  registry: StatusRegistry,
  id:       string,
): StatusConfig {
  const found = registry[id];
  if (found) return found;
  return {
    id,
    label:  { fr: id, en: id } as TranslationMap,
    visual: {
      badgeCls: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
      priority: 99,
      terminal: false,
    },
  };
}
