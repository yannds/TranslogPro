/**
 * variables.ts — Catalogue des variables pdfme disponibles par contexte
 *
 * Ces variables sont affichées dans le panneau "Variables disponibles" du Designer.
 * Le tenant copie {{nomVariable}} et le colle dans le champ `content` d'un champ texte.
 * À l'impression, DocumentsService remplace chaque {{variable}} par la valeur réelle.
 */

export interface TemplateVariable {
  key:         string;   // Nom sans accolades : "tenantName"
  placeholder: string;   // Avec accolades : "{{tenantName}}"
  label:       string;   // Libellé français
  category:    VariableCategory;
  example:     string;   // Valeur d'exemple pour la prévisualisation
}

export type VariableCategory =
  | 'tenant'
  | 'ticket'
  | 'invoice'
  | 'parcel'
  | 'trip'
  | 'customer'
  | 'system';

export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  // ─── Tenant ──────────────────────────────────────────────────────────────────
  { key: 'tenantName',    placeholder: '{{tenantName}}',    label: 'Nom de l\'entreprise',  category: 'tenant', example: 'SATR Express' },
  { key: 'tenantAddress', placeholder: '{{tenantAddress}}', label: 'Adresse',               category: 'tenant', example: 'Av. Léopold Sédar Senghor, Dakar' },
  { key: 'tenantPhone',   placeholder: '{{tenantPhone}}',   label: 'Téléphone',             category: 'tenant', example: '+221 33 xxx xx xx' },
  { key: 'tenantNif',     placeholder: '{{tenantNif}}',     label: 'NIF',                   category: 'tenant', example: '123456789' },
  { key: 'tenantRccm',    placeholder: '{{tenantRccm}}',    label: 'RCCM',                  category: 'tenant', example: 'SN-DKR-2020-B-1234' },
  { key: 'tenantLogo',    placeholder: '{{tenantLogo}}',    label: 'Logo (base64)',         category: 'tenant', example: '' },

  // ─── Ticket ───────────────────────────────────────────────────────────────────
  { key: 'ticketRef',     placeholder: '{{ticketRef}}',     label: 'Référence billet',      category: 'ticket', example: 'TKT-2024-00123' },
  { key: 'passengerName', placeholder: '{{passengerName}}', label: 'Nom du passager',       category: 'ticket', example: 'Aminata DIALLO' },
  { key: 'passengerPhone',placeholder: '{{passengerPhone}}',label: 'Téléphone passager',    category: 'ticket', example: '+221 77 xxx xx xx' },
  { key: 'seatNumber',    placeholder: '{{seatNumber}}',    label: 'Numéro de siège',       category: 'ticket', example: '14A' },
  { key: 'price',         placeholder: '{{price}}',         label: 'Prix',                  category: 'ticket', example: '12 500' },
  { key: 'currency',      placeholder: '{{currency}}',      label: 'Devise',                category: 'ticket', example: 'FCFA' },

  // ─── Facture ──────────────────────────────────────────────────────────────────
  { key: 'invoiceNumber', placeholder: '{{invoiceNumber}}', label: 'N° facture',            category: 'invoice', example: 'INV-2024-00456' },
  { key: 'invoiceDate',   placeholder: '{{invoiceDate}}',   label: 'Date facture',          category: 'invoice', example: '15/03/2024' },
  { key: 'clientName',    placeholder: '{{clientName}}',    label: 'Nom client',            category: 'invoice', example: 'Amadou FALL' },
  { key: 'clientAddress', placeholder: '{{clientAddress}}', label: 'Adresse client',        category: 'invoice', example: 'Rue 12, Dakar' },
  { key: 'clientPhone',   placeholder: '{{clientPhone}}',   label: 'Téléphone client',      category: 'invoice', example: '+221 70 xxx xx xx' },
  { key: 'priceHt',       placeholder: '{{priceHt}}',       label: 'Montant HT',            category: 'invoice', example: '10 870' },
  { key: 'tvaRate',       placeholder: '{{tvaRate}}',       label: 'Taux TVA (%)',          category: 'invoice', example: '18' },
  { key: 'tvaAmount',     placeholder: '{{tvaAmount}}',     label: 'Montant TVA',           category: 'invoice', example: '1 957' },
  { key: 'totalTtc',      placeholder: '{{totalTtc}}',      label: 'Total TTC',             category: 'invoice', example: '12 827' },
  { key: 'paymentMethod', placeholder: '{{paymentMethod}}', label: 'Mode de paiement',      category: 'invoice', example: 'Espèces' },

  // ─── Trajet ───────────────────────────────────────────────────────────────────
  { key: 'origin',        placeholder: '{{origin}}',        label: 'Ville de départ',       category: 'trip', example: 'Dakar' },
  { key: 'destination',   placeholder: '{{destination}}',   label: 'Ville d\'arrivée',      category: 'trip', example: 'Bamako' },
  { key: 'tripDate',      placeholder: '{{tripDate}}',      label: 'Date de départ',        category: 'trip', example: '15/03/2024 07:30' },
  { key: 'routeName',     placeholder: '{{routeName}}',     label: 'Nom de la ligne',       category: 'trip', example: 'Dakar – Bamako Express' },
  { key: 'busPlate',      placeholder: '{{busPlate}}',      label: 'Immatriculation bus',   category: 'trip', example: 'DK-1234-AB' },

  // ─── Colis ────────────────────────────────────────────────────────────────────
  { key: 'parcelRef',     placeholder: '{{parcelRef}}',     label: 'Référence colis',       category: 'parcel', example: 'PCL-2024-00789' },
  { key: 'trackingCode',  placeholder: '{{trackingCode}}',  label: 'Code tracking',         category: 'parcel', example: 'TRANSLOG-PCL-789' },
  { key: 'weight',        placeholder: '{{weight}}',        label: 'Poids (kg)',            category: 'parcel', example: '5.2' },
  { key: 'dimensions',    placeholder: '{{dimensions}}',    label: 'Dimensions',            category: 'parcel', example: '30×20×15 cm' },
  { key: 'senderName',    placeholder: '{{senderName}}',    label: 'Expéditeur',            category: 'parcel', example: 'Fatou NDIAYE' },
  { key: 'senderAddress', placeholder: '{{senderAddress}}', label: 'Adresse expéditeur',   category: 'parcel', example: 'Dakar, Plateau' },
  { key: 'senderPhone',   placeholder: '{{senderPhone}}',   label: 'Tél. expéditeur',      category: 'parcel', example: '+221 76 xxx xx xx' },
  { key: 'recipientName', placeholder: '{{recipientName}}', label: 'Destinataire',          category: 'parcel', example: 'Moussa COULIBALY' },
  { key: 'recipientAddress',placeholder: '{{recipientAddress}}',label: 'Adresse destinataire',category: 'parcel', example: 'Bamako, Commune I' },
  { key: 'recipientPhone',placeholder: '{{recipientPhone}}',label: 'Tél. destinataire',    category: 'parcel', example: '+223 76 xxx xx xx' },

  // ─── Bagage ───────────────────────────────────────────────────────────────────
  { key: 'bagNumber',     placeholder: '{{bagNumber}}',     label: 'N° du bagage',          category: 'parcel', example: '1' },
  { key: 'totalBags',     placeholder: '{{totalBags}}',     label: 'Total bagages',         category: 'parcel', example: '2' },
  { key: 'bagDescription',placeholder: '{{bagDescription}}',label: 'Description bagage',   category: 'parcel', example: 'Valise rouge 24 pouces' },

  // ─── Client / Voyageur ─────────────────────────────────────────────────────────
  { key: 'customerName',     placeholder: '{{customerName}}',     label: 'Nom du voyageur',        category: 'customer', example: 'Aminata DIALLO' },
  { key: 'customerEmail',    placeholder: '{{customerEmail}}',    label: 'Email du voyageur',      category: 'customer', example: 'aminata@example.com' },
  { key: 'customerPhone',    placeholder: '{{customerPhone}}',    label: 'Téléphone du voyageur',  category: 'customer', example: '+221 77 xxx xx xx' },
  { key: 'customerLoyalty',  placeholder: '{{customerLoyalty}}',  label: 'Score fidélité',         category: 'customer', example: '2 450' },
  { key: 'customerTier',     placeholder: '{{customerTier}}',     label: 'Niveau fidélité',        category: 'customer', example: 'Gold' },
  { key: 'customerSince',    placeholder: '{{customerSince}}',    label: 'Client depuis',          category: 'customer', example: '12/01/2023' },

  // ─── Système ──────────────────────────────────────────────────────────────────
  { key: 'qrCodeValue',   placeholder: '{{qrCodeValue}}',   label: 'Valeur QR Code',        category: 'system', example: 'https://verify.translogpro.com/TKT-001' },
  { key: 'generatedAt',   placeholder: '{{generatedAt}}',   label: 'Date de génération',    category: 'system', example: '15/03/2024 14:30' },
  { key: 'pageNumber',    placeholder: '{{pageNumber}}',    label: 'N° de page',            category: 'system', example: '1' },
];

export const CATEGORY_LABELS: Record<VariableCategory, string> = {
  tenant:   'Entreprise (tenant)',
  ticket:   'Billet de voyage',
  invoice:  'Facture',
  trip:     'Trajet',
  parcel:   'Colis / Expédition',
  customer: 'Client / Voyageur',
  system:   'Système',
};

export const CATEGORY_COLORS: Record<VariableCategory, string> = {
  tenant:   '#1a3a5c',
  ticket:   '#2563eb',
  invoice:  '#16a34a',
  trip:     '#7c3aed',
  parcel:   '#dc2626',
  customer: '#0891b2',
  system:   '#6b7280',
};

/** Retourne les variables groupées par catégorie */
export function groupByCategory(
  variables: TemplateVariable[],
): Record<VariableCategory, TemplateVariable[]> {
  return variables.reduce(
    (acc, v) => {
      if (!acc[v.category]) acc[v.category] = [];
      acc[v.category].push(v);
      return acc;
    },
    {} as Record<VariableCategory, TemplateVariable[]>,
  );
}

/** Remplace les placeholders {{key}} dans un objet (recursive JSON) */
export function interpolate(
  obj: unknown,
  data: Record<string, string>,
): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? `{{${key}}}`);
  }
  if (Array.isArray(obj)) return obj.map(item => interpolate(item, data));
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, interpolate(v, data)]),
    );
  }
  return obj;
}
