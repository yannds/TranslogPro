/**
 * Helpers de construction des URLs publiques de vérification.
 *
 * Ces URLs sont encodées dans les QR codes imprimés sur les billets et
 * talons. Quand un passager ou un destinataire scanne le QR, son navigateur
 * ouvre l'URL et affiche le document officiel rendu par le backend
 * (même renderer que le back-office, avec fingerprint + certification).
 *
 * Backend correspondant : src/modules/document-verify/*
 *   GET /verify/ticket/:ticketId?q=HMAC_TOKEN
 *   GET /verify/parcel/:trackingCode
 */

function getBaseUrl(): string {
  // En prod sur sous-domaine tenant, window.location.origin = l'URL tenant.
  // Les documents imprimés fonctionnent donc sur le bon domaine.
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return '';
}

/**
 * URL de vérification publique d'un billet.
 * Contient l'ID du billet + le token HMAC signé (requis pour accès).
 */
export function buildTicketVerifyUrl(ticket: {
  id: string;
  qrCode: string;   // token HMAC signé par QrService côté backend
}): string {
  const base = getBaseUrl();
  const q = encodeURIComponent(ticket.qrCode);
  return `${base}/verify/ticket/${encodeURIComponent(ticket.id)}?q=${q}`;
}

/**
 * URL de vérification publique d'un talon de colis.
 * Le trackingCode est déjà opaque (imprimé sur le talon physique), il sert
 * lui-même de secret — pas de HMAC supplémentaire requis.
 */
export function buildParcelVerifyUrl(trackingCode: string): string {
  const base = getBaseUrl();
  return `${base}/verify/parcel/${encodeURIComponent(trackingCode)}`;
}
