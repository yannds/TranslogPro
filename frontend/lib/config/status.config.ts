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
  id:      string;
  label:   TranslationMap;
  visual:  StatusVisual;
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
