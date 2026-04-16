/**
 * i18n — Types fondamentaux
 *
 * Supporte 8 langues + RTL (Arabe).
 * Aucune langue n'est hardcodée dans les composants : ils consomment
 * uniquement les types définis ici via le contexte I18nProvider.
 */

export type Language =
  | 'fr'   // Français
  | 'en'   // English
  | 'ln'   // Lingala (Congo-Brazzaville / RDC)
  | 'ktu'  // Kituba / Kikongo ya Leta (Congo-Brazzaville)
  | 'es'   // Español
  | 'pt'   // Português
  | 'ar'   // العربية (RTL)
  | 'wo';  // Wolof (Sénégal)

export const LANGUAGE_META: Record<Language, {
  label:    string;   // Nom natif
  dir:      'ltr' | 'rtl';
  flag:     string;   // emoji drapeau représentatif
  dateLocale: string; // Intl locale string
}> = {
  fr:  { label: 'Français',   dir: 'ltr', flag: '🇫🇷', dateLocale: 'fr-FR' },
  en:  { label: 'English',    dir: 'ltr', flag: '🇬🇧', dateLocale: 'en-GB' },
  ln:  { label: 'Lingala',    dir: 'ltr', flag: '🇨🇬', dateLocale: 'fr-CG' },
  ktu: { label: 'Kituba',     dir: 'ltr', flag: '🇨🇬', dateLocale: 'fr-CG' },
  es:  { label: 'Español',    dir: 'ltr', flag: '🇪🇸', dateLocale: 'es-ES' },
  pt:  { label: 'Português',  dir: 'ltr', flag: '🇵🇹', dateLocale: 'pt-PT' },
  ar:  { label: 'العربية',   dir: 'rtl', flag: '🇸🇦', dateLocale: 'ar-SA' },
  wo:  { label: 'Wolof',      dir: 'ltr', flag: '🇸🇳', dateLocale: 'fr-SN' },
};

/** Map d'une clé vers toutes les traductions disponibles.
 *  fr et en sont obligatoires ; les autres langues ont un fallback automatique vers fr. */
export type TranslationMap = { fr: string; en: string } & Partial<Record<Exclude<Language, 'fr' | 'en'>, string>>;

/** Dictionnaire complet de l'application */
export interface TranslogTranslations {
  // ── Navigation / Mode
  board: {
    departures:   TranslationMap;
    arrivals:     TranslationMap;
    mode_toggle:  TranslationMap;
  };
  // ── Colonnes tableau
  col: {
    time:         TranslationMap;
    destination:  TranslationMap;
    origin:       TranslationMap;
    bus:          TranslationMap;
    agency:       TranslationMap;
    platform:     TranslationMap;
    status:       TranslationMap;
    remarks:      TranslationMap;
    driver:       TranslationMap;
    passengers:   TranslationMap;
    parcels:      TranslationMap;
    eta:          TranslationMap;
    delay:        TranslationMap;
    distance:     TranslationMap;
    stop:         TranslationMap;
  };
  // ── Statuts (agnostiques — labels chargés via config)
  status: {
    SCHEDULED:           TranslationMap;
    BOARDING:            TranslationMap;
    BOARDING_COMPLETE:   TranslationMap;
    DEPARTED:            TranslationMap;
    DELAYED:             TranslationMap;
    CANCELLED:           TranslationMap;
    ON_TIME:             TranslationMap;
    ARRIVED:             TranslationMap;
    IN_TRANSIT:          TranslationMap;
    MAINTENANCE:         TranslationMap;
  };
  // ── Actions communes (boutons, formulaires)
  common: {
    save:        TranslationMap;
    create:      TranslationMap;
    edit:        TranslationMap;
    delete:      TranslationMap;
    cancel:      TranslationMap;
    close:       TranslationMap;
    add:         TranslationMap;
    remove:      TranslationMap;
    archive:     TranslationMap;
    suspend:     TranslationMap;
    reactivate:  TranslationMap;
    export:      TranslationMap;
    filter:      TranslationMap;
    saving:      TranslationMap;
    creating:    TranslationMap;
    deleting:    TranslationMap;
    yes:         TranslationMap;
    no:          TranslationMap;
    actions:     TranslationMap;
    details:     TranslationMap;
    settings:    TranslationMap;
    name:        TranslationMap;
    email:       TranslationMap;
    phone:       TranslationMap;
    address:     TranslationMap;
    role:        TranslationMap;
    agency:      TranslationMap;
    date:        TranslationMap;
    type:        TranslationMap;
    description: TranslationMap;
    password:    TranslationMap;
    select:      TranslationMap;
    none:        TranslationMap;
    all:         TranslationMap;
    active:      TranslationMap;
    suspended:   TranslationMap;
    archived:    TranslationMap;
    view:        TranslationMap;
    required:    TranslationMap;
    optional:    TranslationMap;
    documents:   TranslationMap;
  };
  // ── Interface générale
  ui: {
    loading:         TranslationMap;
    no_data:         TranslationMap;
    updated_at:      TranslationMap;
    next_stop:       TranslationMap;
    current_stop:    TranslationMap;
    passed_stops:    TranslationMap;
    board_title:     TranslationMap;
    platform_label:  TranslationMap;
    departure_in:    TranslationMap;
    on_board:        TranslationMap;
    sos:             TranslationMap;
    checklist:       TranslationMap;
    scan:            TranslationMap;
    sell:            TranslationMap;
    checkin:         TranslationMap;
    parcels:         TranslationMap;
    cashier:         TranslationMap;
    confirm:         TranslationMap;
    cancel:          TranslationMap;
    back:            TranslationMap;
    search:          TranslationMap;
    book:            TranslationMap;
    full:            TranslationMap;
    available:       TranslationMap;
  };
  // ── Météo
  weather: {
    sunny:         TranslationMap;
    cloudy:        TranslationMap;
    partly_cloudy: TranslationMap;
    rainy:         TranslationMap;
    stormy:        TranslationMap;
    foggy:         TranslationMap;
    windy:         TranslationMap;
    at_destination: TranslationMap;
    feels_like:    TranslationMap;
    humidity:      TranslationMap;
  };
  // ── Notifications ticker (types de messages)
  notifications: {
    info:    TranslationMap;
    weather: TranslationMap;
    delay:   TranslationMap;
    alert:   TranslationMap;
    news:    TranslationMap;
  };
}
