/**
 * Document renderer i18n — labels traduits pour les documents PDF.
 *
 * Utilisé côté serveur (NestJS) — indépendant du système i18n React frontend.
 * Chaque renderer appelle `docLabels(lang)` pour obtenir les labels dans la
 * langue du tenant.
 *
 * Ajout d'une langue : ajouter un bloc dans DOC_LABELS + le code dans le type.
 */

type SupportedLang = 'fr' | 'en' | 'es' | 'pt' | 'ar' | 'ln' | 'ktu' | 'wo';

interface DocLabels {
  // ── Ticket / boarding pass ──
  travelTicket:     string;
  passenger:        string;
  seat:             string;
  class_:           string;
  route:            string;
  vehicle:          string;
  issuedOn:         string;
  expiresOn:        string;
  pricePaid:        string;
  presentAtBoarding: string;
  boardingCoupon:   string;
  doNotSeparate:    string;
  from:             string;
  to:               string;
  departure:        string;
  ticketNumber:     string;
  validForTrip:     string;
  inspectorVisa:    string;
  keepStub:         string;

  // ── Invoice ──
  invoice:          string;
  issuedDate:       string;
  dueDate:          string;
  billedTo:         string;
  summary:          string;
  date:             string;
  currency:         string;
  description:      string;
  qty:              string;
  unitPrice:        string;
  amount:           string;
  unitPriceHt:      string;
  tvaPercent:       string;
  tvaAmount:        string;
  totalTtc:         string;
  subtotalHt:       string;
  tva:              string;
  total:            string;
  paymentInfo:      string;
  bank:             string;
  ibanAccount:      string;
  notes:            string;
  sellerStamp:      string;
  clientSignature:  string;
  tvaLegal:         string;
  noTvaLegal:       string;
  dispute:          string;
  paymentFinal:     string;
  paymentCoupon:    string;
  detachAndReturn:  string;
  invoiceNumber:    string;
  client:           string;
  mentionInvoice:   string;
  nonRefundable:    string;

  // ── Ticket extended ──
  fareClass:            string;
  boardingStation:      string;
  alightingStation:     string;
  distance:             string;
  busType:              string;
  busModel:             string;
  originStation:        string;
  destinationStation:   string;
  scheduledDeparture:   string;
  scheduledArrival:     string;
  status:               string;

  // ── Manifest extended ──
  boardManifest:        string;
  generatedOn:          string;
  tripInfo:             string;
  vehicleCapacity:      string;
  driver:               string;
  registration:         string;
  model:                string;
  capacity:             string;
  passengersOnBoard:    string;
  parcels:              string;
  dropOffStation:       string;
  noPassengers:         string;
  noParcels:            string;
  trackingCode:         string;
  weight:               string;
  destinationLabel:     string;

  // ── Parcel / Packing list extended ──
  packingList:          string;
  shipmentLabel:        string;
  shipmentStatus:       string;
  totalWeight:          string;
  parcelCount:          string;
  sender:               string;
  recipient:            string;
  value:                string;
  senderSignature:      string;
  receiverSignature:    string;
  parcelLabel:          string;
  destinationCity:      string;

  // ── Baggage tag extended ──
  baggageTag:           string;
  checkedBaggage:       string;
  bagNumber:            string;
  descriptionBag:       string;
  passengerCoupon:      string;
  trackingRef:          string;
  trip:                 string;
  busPlate:             string;

  // ── Shared ──
  boarding:         string;
}

const FR: DocLabels = {
  travelTicket:     'Billet de Voyage',
  passenger:        'Passager',
  seat:             'Siège',
  class_:           'Classe',
  route:            'Ligne',
  vehicle:          'Véhicule',
  issuedOn:         'Émis le',
  expiresOn:        'Expire le',
  pricePaid:        'Tarif payé',
  presentAtBoarding: 'Présenter à l\'embarquement',
  boardingCoupon:   'Coupon d\'embarquement',
  doNotSeparate:    'Ne pas séparer avant le contrôle',
  from:             'De',
  to:               'À',
  departure:        'Départ',
  ticketNumber:     'N° Billet',
  validForTrip:     'Billet valide pour ce voyage uniquement',
  inspectorVisa:    'Visa contrôleur',
  keepStub:         'Conserver le talon — À remettre au contrôleur',
  nonRefundable:    'Non remboursable',

  invoice:          'Facture',
  issuedDate:       'Émise le',
  dueDate:          'Échéance',
  billedTo:         'Facturé à',
  summary:          'Récapitulatif',
  date:             'Date',
  currency:         'Devise',
  description:      'Description',
  qty:              'Qté',
  unitPrice:        'Prix unitaire',
  amount:           'Montant',
  unitPriceHt:      'P.U. HT',
  tvaPercent:       'TVA',
  tvaAmount:        'TVA',
  totalTtc:         'Total TTC',
  subtotalHt:       'Sous-total HT',
  tva:              'TVA',
  total:            'TOTAL',
  paymentInfo:      'Informations de paiement',
  bank:             'Banque',
  ibanAccount:      'IBAN / Compte',
  notes:            'Notes',
  sellerStamp:      'Cachet & Signature vendeur',
  clientSignature:  'Signature client',
  tvaLegal:         'TVA appliquée conformément à la législation en vigueur.',
  noTvaLegal:       'Non assujetti à la TVA — prix nets.',
  dispute:          'En cas de litige :',
  paymentFinal:     'Tout paiement après émission est définitif.',
  paymentCoupon:    'Coupon de paiement',
  detachAndReturn:  'Détacher et retourner avec votre règlement',
  invoiceNumber:    'N° Facture',
  client:           'Client',
  mentionInvoice:   'Merci de mentionner le numéro de facture sur votre virement.',

  // ── Ticket extended ──
  fareClass:            'Classe',
  boardingStation:      'Gare de montée',
  alightingStation:     'Gare de descente',
  distance:             'Distance',
  busType:              'Type de véhicule',
  busModel:             'Modèle',
  originStation:        'Gare de départ',
  destinationStation:   'Gare d\'arrivée',
  scheduledDeparture:   'Départ prévu',
  scheduledArrival:     'Arrivée prévue',
  status:               'Statut',

  // ── Manifest extended ──
  boardManifest:        'Manifeste de bord',
  generatedOn:          'Généré le',
  tripInfo:             'Informations trajet',
  vehicleCapacity:      'Véhicule & Capacité',
  driver:               'Conducteur',
  registration:         'Immatriculation',
  model:                'Modèle',
  capacity:             'Capacité',
  passengersOnBoard:    'Passagers à bord',
  parcels:              'Colis',
  dropOffStation:       'Descente',
  noPassengers:         'Aucun passager embarqué',
  noParcels:            'Aucun colis',
  trackingCode:         'Code suivi',
  weight:               'Poids',
  destinationLabel:     'Destination',

  // ── Parcel / Packing list extended ──
  packingList:          'Bordereau d\'expédition',
  shipmentLabel:        'Expédition',
  shipmentStatus:       'Statut expédition',
  totalWeight:          'Poids total',
  parcelCount:          'Nombre de colis',
  sender:               'Expéditeur',
  recipient:            'Destinataire',
  value:                'Valeur',
  senderSignature:      'Signature Expéditeur',
  receiverSignature:    'Signature Réceptionnaire',
  parcelLabel:          'Étiquette colis',
  destinationCity:      'Gare dest.',

  // ── Baggage tag extended ──
  baggageTag:           'Talon Bagage',
  checkedBaggage:       'Bagage enregistré',
  bagNumber:            'Bagage',
  descriptionBag:       'Description',
  passengerCoupon:      'Coupon passager — à conserver',
  trackingRef:          'Référence tracking',
  trip:                 'Trajet',
  busPlate:             'Bus',

  boarding:         'Embarquement',
};

const EN: DocLabels = {
  travelTicket:     'Travel Ticket',
  passenger:        'Passenger',
  seat:             'Seat',
  class_:           'Class',
  route:            'Route',
  vehicle:          'Vehicle',
  issuedOn:         'Issued on',
  expiresOn:        'Expires on',
  pricePaid:        'Fare paid',
  presentAtBoarding: 'Present at boarding',
  boardingCoupon:   'Boarding coupon',
  doNotSeparate:    'Do not separate before inspection',
  from:             'From',
  to:               'To',
  departure:        'Departure',
  ticketNumber:     'Ticket #',
  validForTrip:     'Valid for this trip only',
  inspectorVisa:    'Inspector stamp',
  keepStub:         'Keep the stub — Hand to the inspector',
  nonRefundable:    'Non-refundable',

  invoice:          'Invoice',
  issuedDate:       'Issued on',
  dueDate:          'Due date',
  billedTo:         'Billed to',
  summary:          'Summary',
  date:             'Date',
  currency:         'Currency',
  description:      'Description',
  qty:              'Qty',
  unitPrice:        'Unit price',
  amount:           'Amount',
  unitPriceHt:      'Unit (excl. tax)',
  tvaPercent:       'Tax',
  tvaAmount:        'Tax',
  totalTtc:         'Total (incl. tax)',
  subtotalHt:       'Subtotal (excl. tax)',
  tva:              'Tax',
  total:            'TOTAL',
  paymentInfo:      'Payment information',
  bank:             'Bank',
  ibanAccount:      'IBAN / Account',
  notes:            'Notes',
  sellerStamp:      'Seller stamp & signature',
  clientSignature:  'Client signature',
  tvaLegal:         'Tax applied in accordance with applicable legislation.',
  noTvaLegal:       'Not subject to VAT — net prices.',
  dispute:          'In case of dispute:',
  paymentFinal:     'All payments after issuance are final.',
  paymentCoupon:    'Payment coupon',
  detachAndReturn:  'Detach and return with your payment',
  invoiceNumber:    'Invoice #',
  client:           'Client',
  mentionInvoice:   'Please quote the invoice number on your transfer.',

  // ── Ticket extended ──
  fareClass:            'Class',
  boardingStation:      'Boarding station',
  alightingStation:     'Alighting station',
  distance:             'Distance',
  busType:              'Vehicle type',
  busModel:             'Model',
  originStation:        'Departure station',
  destinationStation:   'Arrival station',
  scheduledDeparture:   'Scheduled departure',
  scheduledArrival:     'Scheduled arrival',
  status:               'Status',

  // ── Manifest extended ──
  boardManifest:        'Board manifest',
  generatedOn:          'Generated on',
  tripInfo:             'Trip information',
  vehicleCapacity:      'Vehicle & Capacity',
  driver:               'Driver',
  registration:         'Registration',
  model:                'Model',
  capacity:             'Capacity',
  passengersOnBoard:    'Passengers on board',
  parcels:              'Parcels',
  dropOffStation:       'Drop-off',
  noPassengers:         'No passengers on board',
  noParcels:            'No parcels',
  trackingCode:         'Tracking code',
  weight:               'Weight',
  destinationLabel:     'Destination',

  // ── Parcel / Packing list extended ──
  packingList:          'Packing list',
  shipmentLabel:        'Shipment',
  shipmentStatus:       'Shipment status',
  totalWeight:          'Total weight',
  parcelCount:          'Parcel count',
  sender:               'Sender',
  recipient:            'Recipient',
  value:                'Value',
  senderSignature:      'Sender signature',
  receiverSignature:    'Receiver signature',
  parcelLabel:          'Parcel label',
  destinationCity:      'Dest. station',

  // ── Baggage tag extended ──
  baggageTag:           'Baggage tag',
  checkedBaggage:       'Checked baggage',
  bagNumber:            'Baggage',
  descriptionBag:       'Description',
  passengerCoupon:      'Passenger coupon — keep this',
  trackingRef:          'Tracking reference',
  trip:                 'Trip',
  busPlate:             'Bus',

  boarding:         'Boarding',
};

const LABELS: Record<string, DocLabels> = { fr: FR, en: EN };

/**
 * Retourne les labels de document traduits pour la langue du tenant.
 * Fallback : français si la langue n'est pas encore traduite.
 */
export function docLabels(lang: string): DocLabels {
  return LABELS[lang] ?? LABELS['fr'];
}

export type { DocLabels };
