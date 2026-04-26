/**
 * EmailTemplate — types du registre central de templates email.
 *
 * Le registre agrège tous les groupes de templates (lifecycle voyageur,
 * invoice, voucher, refund, user, parcel, ticket, auth, subscription) sous
 * une API unifiée. Il alimente :
 *   1. Le testeur plateforme (`/admin/platform/email`) — combobox des modèles
 *      + envoi de test vers une adresse choisie.
 *   2. Les services métier qui veulent rendre un template par identifiant
 *      sans connaître le groupe d'origine.
 *
 * Chaque groupe (lifecycle, invoice, voucher…) déclare son tableau de
 * `EmailTemplateDescriptor[]` exporté ; le registre les concatène.
 */

/** Langues supportées par le rendu des templates. fr = défaut, en = anglais. */
export type EmailTemplateLang = 'fr' | 'en';

/** Groupes de templates — chaque tier du chantier email étend cette union. */
export type EmailTemplateGroup =
  | 'lifecycle'      // voyage : achat / publication / boarding / rappel / arrivée
  | 'invoice'        // facturation tenant : créée / payée / impayée / annulée
  | 'voucher'        // bons d'avoir CRM : émission
  | 'refund'         // remboursement : créé / approuvé / rejeté
  | 'user'           // invitation user par admin tenant
  | 'trip'           // notifications trip ad-hoc (annulé, retard, …)
  | 'parcel'         // colis : arrivé hub / prêt retrait / retiré / litige
  | 'ticket'         // ticket no-show : marqué / replacé / forfaité
  | 'auth'           // sécurité : reset password / vérification email / MFA
  | 'subscription';  // abonnement : créé / annulé / trial expiring / impayé

/** Résultat normalisé d'un rendu — adapté au DTO `SendEmailDto` (subject/html/text). */
export interface RenderedEmail {
  subject: string;
  html:    string;
  text:    string;
}

/**
 * Descripteur d'un template du catalogue.
 *
 * Note : `recipientNameVar` sert au testeur pour injecter le nom du destinataire
 *        saisi dans le formulaire dans la bonne variable du template
 *        (passengerName / customerName / inviteeName / adminName…).
 */
export interface EmailTemplateDescriptor {
  /** Identifiant stable, ex. `notif.ticket.purchased`, `invoice.created`. */
  id:               string;
  /** Groupe d'origine — pour grouper / filtrer dans la combobox. */
  group:            EmailTemplateGroup;
  /** Libellé fr humain (combobox testeur). */
  labelFr:          string;
  /** Libellé en humain (combobox testeur). */
  labelEn:          string;
  /** Description courte fr — affichée sous la combobox. */
  descriptionFr:    string;
  /** Description courte en. */
  descriptionEn:    string;
  /** Variables d'exemple utilisées par le testeur (sans context tenant réel). */
  sampleVars:       Record<string, string>;
  /** Clé de `sampleVars` qui reçoit le nom saisi par l'admin testeur. */
  recipientNameVar: string;
  /** Fonction de rendu — appelée par le testeur ET par les listeners métier. */
  render:           (lang: EmailTemplateLang, vars: Record<string, string>) => RenderedEmail;
}
