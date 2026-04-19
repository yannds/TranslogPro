/**
 * Contrat d'impression receipt — abstraction au-dessus de la lib ESC/POS.
 *
 * L'app publie des jobs via un driver ; l'implémentation réelle (Bluetooth
 * vers imprimante thermique 58/80mm) vit dans un EAS build natif — pas dans
 * Expo Go. Le driver MOCK ci-contre permet de tester toute la stack métier
 * (queue offline + templates) sans matériel.
 */

/** Largeurs usuelles des imprimantes thermiques de comptoir. */
export type ReceiptWidth = 32 | 42;

export interface ReceiptLine {
  /** Texte brut (une ligne). Pas de HTML — on est en ESC/POS. */
  text:      string;
  /** Alignement — défaut 'left'. */
  align?:    'left' | 'center' | 'right';
  /** Mise en forme ESC/POS. Le driver mappe si supporté. */
  bold?:     boolean;
  /** Double taille verticale + horizontale (utile pour montants/titres). */
  double?:   boolean;
  /** Impression d'une ligne de séparation stylée. */
  divider?:  boolean;
}

export interface ReceiptPayload {
  /** Identifiant unique du reçu (pour idempotency + traçabilité). */
  id:       string;
  /** Type métier — utile pour filtrage / stats côté printer backend. */
  kind:     'ticket' | 'parcel' | 'refund' | 'report' | 'other';
  /** Largeur du printer cible (caractères). */
  width:    ReceiptWidth;
  /** Lignes à imprimer, dans l'ordre. */
  lines:    ReceiptLine[];
  /** QR code optionnel imprimé à la fin (base64url du payload HMAC-signé). */
  qr?:      string | null;
  /** Nombre de copies (2 pour duplicata voyageur + caisse). */
  copies?:  number;
}

export interface PrinterStatus {
  connected: boolean;
  name?:     string;
  /** Code d'erreur ESC/POS si défaut (ex: 'NO_PAPER', 'COVER_OPEN'). */
  error?:    string;
}

/**
 * Driver bas niveau — une implémentation par plateforme / lib.
 * Toutes les méthodes doivent être idempotentes ou gérer la réentrance
 * (l'outbox rejoue un même job sans causer de double impression).
 */
export interface PrinterDriver {
  /** Renvoie l'état de connexion actuel (sans I/O bloquant). */
  getStatus(): Promise<PrinterStatus>;
  /** Connexion — peut proposer un picker BT natif, ou utiliser la dernière adresse. */
  connect(): Promise<PrinterStatus>;
  /** Envoi d'un reçu à imprimer. */
  print(payload: ReceiptPayload): Promise<void>;
  /** Déconnexion propre — libère le périphérique. */
  disconnect(): Promise<void>;
}
