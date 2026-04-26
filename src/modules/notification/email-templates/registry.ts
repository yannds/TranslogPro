/**
 * Registre central des templates email.
 *
 * Source de vérité unique pour :
 *   1. Le testeur plateforme (`PagePlatformEmail` → `SendTestEmailDialog`)
 *      qui liste, prévisualise et envoie n'importe quel template.
 *   2. Tout listener métier qui rend un email par identifiant sans connaître
 *      son groupe (utile pour les listeners polymorphes).
 *
 * Chaque tier du chantier email ajoute son propre fichier `*.descriptors.ts`
 * et l'enregistre dans `ALL_DESCRIPTORS` ci-dessous. Tester :
 *
 *   import { listEmailTemplates, renderEmailTemplate } from './registry';
 *   const tpl = listEmailTemplates().find(d => d.id === 'invoice.created');
 *   const out = renderEmailTemplate('invoice.created', 'fr', { ... });
 */

import type {
  EmailTemplateDescriptor,
  EmailTemplateLang,
  RenderedEmail,
} from './types';
import { LIFECYCLE_DESCRIPTORS } from './lifecycle.descriptors';
import { INVOICE_DESCRIPTORS }   from './invoice.descriptors';
import { VOUCHER_DESCRIPTORS }   from './voucher.descriptors';
import { REFUND_DESCRIPTORS }    from './refund.descriptors';
import { USER_DESCRIPTORS }      from './user.descriptors';
import { TRIP_DESCRIPTORS }      from './trip.descriptors';
import { PARCEL_DESCRIPTORS }    from './parcel.descriptors';
import { TICKET_DESCRIPTORS }    from './ticket.descriptors';

/**
 * Catalogue exhaustif des templates email.
 *
 * Ordre = ordre d'apparition dans la combobox du testeur plateforme.
 * À chaque nouveau tier (Trip cancelled, Parcel…) on ajoute son tableau
 * importé de son fichier `*.descriptors.ts`.
 */
const ALL_DESCRIPTORS: ReadonlyArray<EmailTemplateDescriptor> = [
  ...LIFECYCLE_DESCRIPTORS,
  ...INVOICE_DESCRIPTORS,
  ...VOUCHER_DESCRIPTORS,
  ...REFUND_DESCRIPTORS,
  ...USER_DESCRIPTORS,
  ...TRIP_DESCRIPTORS,
  ...PARCEL_DESCRIPTORS,
  ...TICKET_DESCRIPTORS,
  // À venir : ...AUTH_DESCRIPTORS, ...SUBSCRIPTION_DESCRIPTORS
];

/** Catalogue complet — utilisé par `GET /platform/email/templates`. */
export function listEmailTemplates(): ReadonlyArray<EmailTemplateDescriptor> {
  return ALL_DESCRIPTORS;
}

/** Recherche d'un template par identifiant — `undefined` si inconnu. */
export function getEmailTemplate(id: string): EmailTemplateDescriptor | undefined {
  return ALL_DESCRIPTORS.find(d => d.id === id);
}

/**
 * Rendu d'un template par identifiant.
 * - Les `vars` reçus sont fusionnés par-dessus `sampleVars` du descripteur,
 *   pour que les variables manquantes tombent sur des valeurs sûres lors
 *   d'un test plateforme.
 * - Renvoie `undefined` si l'identifiant est inconnu (le caller doit lever).
 */
export function renderEmailTemplate(
  id:   string,
  lang: EmailTemplateLang,
  vars: Record<string, string> = {},
): RenderedEmail | undefined {
  const desc = getEmailTemplate(id);
  if (!desc) return undefined;
  const merged = { ...desc.sampleVars, ...vars };
  return desc.render(lang, merged);
}

/** Liste des identifiants connus — utile pour DTO `@IsIn(...)`. */
export function getKnownTemplateIds(): readonly string[] {
  return ALL_DESCRIPTORS.map(d => d.id);
}
