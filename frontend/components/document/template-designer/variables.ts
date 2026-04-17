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
  { key: 'tenantName',     placeholder: '{{tenantName}}',     label: 'templateVar.tenantName',     category: 'tenant', example: 'SATR Express' },
  { key: 'tenantSlug',     placeholder: '{{tenantSlug}}',     label: 'templateVar.tenantSlug',     category: 'tenant', example: 'satr-express' },
  { key: 'tenantAddress',  placeholder: '{{tenantAddress}}',  label: 'templateVar.tenantAddress',  category: 'tenant', example: 'Av. Léopold Sédar Senghor, Dakar' },
  { key: 'tenantPhone',    placeholder: '{{tenantPhone}}',    label: 'templateVar.tenantPhone',    category: 'tenant', example: '+221 33 xxx xx xx' },
  { key: 'tenantEmail',    placeholder: '{{tenantEmail}}',    label: 'templateVar.tenantEmail',    category: 'tenant', example: 'contact@satr.sn' },
  { key: 'tenantWebsite',  placeholder: '{{tenantWebsite}}',  label: 'templateVar.tenantWebsite',  category: 'tenant', example: 'https://satr.sn' },
  { key: 'tenantNif',      placeholder: '{{tenantNif}}',      label: 'templateVar.tenantNif',      category: 'tenant', example: '123456789' },
  { key: 'tenantRccm',     placeholder: '{{tenantRccm}}',     label: 'templateVar.tenantRccm',     category: 'tenant', example: 'SN-DKR-2020-B-1234' },
  { key: 'tenantCountry',  placeholder: '{{tenantCountry}}',  label: 'templateVar.tenantCountry',  category: 'tenant', example: 'SN' },
  { key: 'tenantCurrency', placeholder: '{{tenantCurrency}}', label: 'templateVar.tenantCurrency', category: 'tenant', example: 'FCFA' },
  { key: 'tenantContact',  placeholder: '{{tenantContact}}',  label: 'templateVar.tenantContact',  category: 'tenant', example: 'Av. Léopold…\nTél : +221…' },
  { key: 'tenantLogo',     placeholder: '{{tenantLogo}}',     label: 'templateVar.tenantLogo',     category: 'tenant', example: '' },

  // ─── Ticket ───────────────────────────────────────────────────────────────────
  { key: 'ticketRef',          placeholder: '{{ticketRef}}',          label: 'templateVar.ticketRef',          category: 'ticket', example: 'clxyz123abc456' },
  { key: 'ticketStatus',       placeholder: '{{ticketStatus}}',       label: 'templateVar.ticketStatus',       category: 'ticket', example: 'CONFIRMED' },
  { key: 'bookingRef',         placeholder: '{{bookingRef}}',         label: 'templateVar.bookingRef',         category: 'ticket', example: '3ABC456' },
  { key: 'passengerName',      placeholder: '{{passengerName}}',      label: 'templateVar.passengerName',      category: 'ticket', example: 'Aminata DIALLO' },
  { key: 'passengerPhone',     placeholder: '{{passengerPhone}}',     label: 'templateVar.passengerPhone',     category: 'ticket', example: '+221 77 xxx xx xx' },
  { key: 'seatNumber',         placeholder: '{{seatNumber}}',         label: 'templateVar.seatNumber',         category: 'ticket', example: '14A' },
  { key: 'fareClass',          placeholder: '{{fareClass}}',          label: 'templateVar.fareClass',          category: 'ticket', example: 'CONFORT' },
  { key: 'price',              placeholder: '{{price}}',              label: 'templateVar.price',              category: 'ticket', example: '12 500' },
  { key: 'priceFmt',           placeholder: '{{priceFmt}}',           label: 'templateVar.priceFmt',           category: 'ticket', example: '12 500 FCFA' },
  { key: 'currency',           placeholder: '{{currency}}',           label: 'templateVar.currency',           category: 'ticket', example: 'FCFA' },
  { key: 'ticketCreatedAt',    placeholder: '{{ticketCreatedAt}}',    label: 'templateVar.ticketCreatedAt',    category: 'ticket', example: '15/03/2024 10:30' },
  { key: 'ticketExpiresAt',    placeholder: '{{ticketExpiresAt}}',    label: 'templateVar.ticketExpiresAt',    category: 'ticket', example: '15/03/2024 18:00' },
  { key: 'boardingStation',    placeholder: '{{boardingStation}}',    label: 'templateVar.boardingStation',    category: 'ticket', example: 'Gare Routière Dakar' },
  { key: 'boardingCity',       placeholder: '{{boardingCity}}',       label: 'templateVar.boardingCity',       category: 'ticket', example: 'Dakar' },
  { key: 'alightingStation',   placeholder: '{{alightingStation}}',   label: 'templateVar.alightingStation',   category: 'ticket', example: 'Gare Bamako' },
  { key: 'alightingCity',      placeholder: '{{alightingCity}}',      label: 'templateVar.alightingCity',      category: 'ticket', example: 'Bamako' },

  // ─── Facture ──────────────────────────────────────────────────────────────────
  { key: 'invoiceNumber',  placeholder: '{{invoiceNumber}}',  label: 'templateVar.invoiceNumber',  category: 'invoice', example: 'INV-2024-00456' },
  { key: 'invoiceDate',    placeholder: '{{invoiceDate}}',    label: 'templateVar.invoiceDate',    category: 'invoice', example: '15/03/2024' },
  { key: 'clientName',     placeholder: '{{clientName}}',     label: 'templateVar.clientName',     category: 'invoice', example: 'Amadou FALL' },
  { key: 'clientAddress',  placeholder: '{{clientAddress}}',  label: 'templateVar.clientAddress',  category: 'invoice', example: 'Rue 12, Dakar' },
  { key: 'clientPhone',    placeholder: '{{clientPhone}}',    label: 'templateVar.clientPhone',    category: 'invoice', example: '+221 70 xxx xx xx' },
  { key: 'priceHt',        placeholder: '{{priceHt}}',        label: 'templateVar.priceHt',        category: 'invoice', example: '10 870' },
  { key: 'tvaRate',        placeholder: '{{tvaRate}}',        label: 'templateVar.tvaRate',        category: 'invoice', example: '18' },
  { key: 'tvaAmount',      placeholder: '{{tvaAmount}}',      label: 'templateVar.tvaAmount',      category: 'invoice', example: '1 957' },
  { key: 'tvaEnabled',     placeholder: '{{tvaEnabled}}',     label: 'templateVar.tvaEnabled',     category: 'invoice', example: 'true' },
  { key: 'totalTtc',       placeholder: '{{totalTtc}}',       label: 'templateVar.totalTtc',       category: 'invoice', example: '12 827 FCFA' },
  { key: 'totalHtValue',   placeholder: '{{totalHtValue}}',   label: 'templateVar.totalHtValue',   category: 'invoice', example: '10 870 FCFA' },
  { key: 'tvaValue',       placeholder: '{{tvaValue}}',       label: 'templateVar.tvaValue',       category: 'invoice', example: '1 957 FCFA' },
  { key: 'paymentMethod',  placeholder: '{{paymentMethod}}',  label: 'templateVar.paymentMethod',  category: 'invoice', example: 'Espèces' },
  { key: 'invoiceLines',   placeholder: '{{invoiceLines}}',   label: 'templateVar.invoiceLines',   category: 'invoice', example: '[["Transport…","1","10 870","12 827"]]' },

  // ─── Trajet / Route ───────────────────────────────────────────────────────────
  { key: 'origin',         placeholder: '{{origin}}',         label: 'templateVar.origin',         category: 'trip', example: 'Dakar' },
  { key: 'destination',    placeholder: '{{destination}}',    label: 'templateVar.destination',    category: 'trip', example: 'Bamako' },
  { key: 'originStation',  placeholder: '{{originStation}}',  label: 'templateVar.originStation',  category: 'trip', example: 'Gare Routière Dakar' },
  { key: 'destStation',    placeholder: '{{destStation}}',    label: 'templateVar.destStation',    category: 'trip', example: 'Gare Routière Bamako' },
  { key: 'routeName',      placeholder: '{{routeName}}',      label: 'templateVar.routeName',      category: 'trip', example: 'Dakar – Bamako Express' },
  { key: 'distanceKm',     placeholder: '{{distanceKm}}',     label: 'templateVar.distanceKm',     category: 'trip', example: '1 250 km' },
  { key: 'tripDate',       placeholder: '{{tripDate}}',       label: 'templateVar.tripDate',       category: 'trip', example: '15/03/2024 07:30' },
  { key: 'departureTime',  placeholder: '{{departureTime}}',  label: 'templateVar.departureTime',  category: 'trip', example: '07:30' },
  { key: 'arrivalTime',    placeholder: '{{arrivalTime}}',    label: 'templateVar.arrivalTime',    category: 'trip', example: '19:45' },
  { key: 'arrivalDate',    placeholder: '{{arrivalDate}}',    label: 'templateVar.arrivalDate',    category: 'trip', example: '15/03/2024 19:45' },
  { key: 'boardingDate',   placeholder: '{{boardingDate}}',   label: 'templateVar.boardingDate',   category: 'trip', example: '15/03/2024' },
  { key: 'boardingTime',   placeholder: '{{boardingTime}}',   label: 'templateVar.boardingTime',   category: 'trip', example: '07:15' },
  { key: 'tripId',         placeholder: '{{tripId}}',         label: 'templateVar.tripId',         category: 'trip', example: 'CLXYZ123AB' },
  { key: 'tripIdFull',     placeholder: '{{tripIdFull}}',     label: 'templateVar.tripIdFull',     category: 'trip', example: 'clxyz123abc456def789' },
  { key: 'tripStatus',     placeholder: '{{tripStatus}}',     label: 'templateVar.tripStatus',     category: 'trip', example: 'IN_PROGRESS' },
  { key: 'flightCode',     placeholder: '{{flightCode}}',     label: 'templateVar.flightCode',     category: 'trip', example: 'DKR-BMK01' },

  // ─── Bus / Véhicule ──────────────────────────────────────────────────────────
  { key: 'busPlate',       placeholder: '{{busPlate}}',       label: 'templateVar.busPlate',       category: 'trip', example: 'DK-1234-AB' },
  { key: 'busModel',       placeholder: '{{busModel}}',       label: 'templateVar.busModel',       category: 'trip', example: 'Mercedes Tourismo' },
  { key: 'busType',        placeholder: '{{busType}}',        label: 'templateVar.busType',        category: 'trip', example: 'CONFORT' },
  { key: 'busCapacity',    placeholder: '{{busCapacity}}',    label: 'templateVar.busCapacity',    category: 'trip', example: '55' },

  // ─── Conducteur ───────────────────────────────────────────────────────────────
  { key: 'driverName',     placeholder: '{{driverName}}',     label: 'templateVar.driverName',     category: 'trip', example: 'Ibrahima SARR' },
  { key: 'driverEmail',    placeholder: '{{driverEmail}}',    label: 'templateVar.driverEmail',    category: 'trip', example: 'ibrahima@satr.sn' },

  // ─── Colis ────────────────────────────────────────────────────────────────────
  { key: 'parcelRef',         placeholder: '{{parcelRef}}',         label: 'templateVar.parcelRef',         category: 'parcel', example: 'PCL-2024-00789' },
  { key: 'trackingCode',      placeholder: '{{trackingCode}}',      label: 'templateVar.trackingCode',      category: 'parcel', example: 'TRANSLOG-PCL-789' },
  { key: 'parcelStatus',      placeholder: '{{parcelStatus}}',      label: 'templateVar.parcelStatus',      category: 'parcel', example: 'IN_TRANSIT' },
  { key: 'weight',            placeholder: '{{weight}}',            label: 'templateVar.weight',            category: 'parcel', example: '5.2' },
  { key: 'dimensions',        placeholder: '{{dimensions}}',        label: 'templateVar.dimensions',        category: 'parcel', example: '30×20×15 cm' },
  { key: 'parcelCreatedAt',   placeholder: '{{parcelCreatedAt}}',   label: 'templateVar.parcelCreatedAt',   category: 'parcel', example: '14/03/2024 16:00' },
  { key: 'senderName',        placeholder: '{{senderName}}',        label: 'templateVar.senderName',        category: 'parcel', example: 'Fatou NDIAYE' },
  { key: 'senderEmail',       placeholder: '{{senderEmail}}',       label: 'templateVar.senderEmail',       category: 'parcel', example: 'fatou@example.com' },
  { key: 'senderAddress',     placeholder: '{{senderAddress}}',     label: 'templateVar.senderAddress',     category: 'parcel', example: 'Dakar, Plateau' },
  { key: 'senderPhone',       placeholder: '{{senderPhone}}',       label: 'templateVar.senderPhone',       category: 'parcel', example: '+221 76 xxx xx xx' },
  { key: 'recipientName',     placeholder: '{{recipientName}}',     label: 'templateVar.recipientName',     category: 'parcel', example: 'Moussa COULIBALY' },
  { key: 'recipientAddress',  placeholder: '{{recipientAddress}}',  label: 'templateVar.recipientAddress',  category: 'parcel', example: 'Bamako, Commune I' },
  { key: 'recipientPhone',    placeholder: '{{recipientPhone}}',    label: 'templateVar.recipientPhone',    category: 'parcel', example: '+223 76 xxx xx xx' },
  { key: 'destinationCity',   placeholder: '{{destinationCity}}',   label: 'templateVar.destinationCity',   category: 'parcel', example: 'Bamako' },

  // ─── Expédition (Shipment) ────────────────────────────────────────────────────
  { key: 'shipmentId',     placeholder: '{{shipmentId}}',     label: 'templateVar.shipmentId',     category: 'parcel', example: 'CLXYZ123AB' },
  { key: 'shipmentIdFull', placeholder: '{{shipmentIdFull}}', label: 'templateVar.shipmentIdFull', category: 'parcel', example: 'clxyz123abc456def789' },
  { key: 'shipmentDate',   placeholder: '{{shipmentDate}}',   label: 'templateVar.shipmentDate',   category: 'parcel', example: '14/03/2024' },
  { key: 'shipmentStatus', placeholder: '{{shipmentStatus}}', label: 'templateVar.shipmentStatus', category: 'parcel', example: 'LOADED' },
  { key: 'totalWeight',    placeholder: '{{totalWeight}}',    label: 'templateVar.totalWeight',    category: 'parcel', example: '47.5' },
  { key: 'parcelCount',    placeholder: '{{parcelCount}}',    label: 'templateVar.parcelCount',    category: 'parcel', example: '12' },
  { key: 'passengerCount', placeholder: '{{passengerCount}}', label: 'templateVar.passengerCount', category: 'trip',   example: '42' },

  // ─── Bagage ───────────────────────────────────────────────────────────────────
  { key: 'bagNumber',      placeholder: '{{bagNumber}}',      label: 'templateVar.bagNumber',      category: 'parcel', example: '1' },
  { key: 'totalBags',      placeholder: '{{totalBags}}',      label: 'templateVar.totalBags',      category: 'parcel', example: '2' },
  { key: 'bagDescription', placeholder: '{{bagDescription}}', label: 'templateVar.bagDescription', category: 'parcel', example: 'Valise rouge 24 pouces' },

  // ─── Client / Voyageur ─────────────────────────────────────────────────────────
  { key: 'customerName',     placeholder: '{{customerName}}',     label: 'templateVar.customerName',     category: 'customer', example: 'Aminata DIALLO' },
  { key: 'customerEmail',    placeholder: '{{customerEmail}}',    label: 'templateVar.customerEmail',    category: 'customer', example: 'aminata@example.com' },
  { key: 'customerPhone',    placeholder: '{{customerPhone}}',    label: 'templateVar.customerPhone',    category: 'customer', example: '+221 77 xxx xx xx' },
  { key: 'customerLoyalty',  placeholder: '{{customerLoyalty}}',  label: 'templateVar.customerLoyalty',  category: 'customer', example: '2 450' },
  { key: 'customerTier',     placeholder: '{{customerTier}}',     label: 'templateVar.customerTier',     category: 'customer', example: 'Gold' },
  { key: 'customerSince',    placeholder: '{{customerSince}}',    label: 'templateVar.customerSince',    category: 'customer', example: '12/01/2023' },

  // ─── Système ──────────────────────────────────────────────────────────────────
  { key: 'qrCodeValue',   placeholder: '{{qrCodeValue}}',   label: 'templateVar.qrCodeValue',   category: 'system', example: 'https://verify.translogpro.com/TKT-001' },
  { key: 'qrCode',        placeholder: '{{qrCode}}',        label: 'templateVar.qrCode',        category: 'system', example: 'https://verify.translogpro.com/TKT-001' },
  { key: 'barcodeValue',  placeholder: '{{barcodeValue}}',  label: 'templateVar.barcodeValue',  category: 'system', example: 'clxyz123abc456' },
  { key: 'barcodeText',   placeholder: '{{barcodeText}}',   label: 'templateVar.barcodeText',   category: 'system', example: 'clxyz123abc456' },
  { key: 'generatedAt',   placeholder: '{{generatedAt}}',   label: 'templateVar.generatedAt',   category: 'system', example: '15/03/2024 14:30' },
  { key: 'pageNumber',    placeholder: '{{pageNumber}}',    label: 'templateVar.pageNumber',    category: 'system', example: '1' },
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
