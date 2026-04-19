/**
 * Templates de reçus — pas de magic number, i18n FR/EN inline (autres
 * locales → TODO Sprint i18n complet).
 */

import type { ReceiptPayload, ReceiptWidth } from './printer.types';

// Largeur par défaut : 58mm thermique ≈ 32 caractères. Commun en Afrique centrale.
export const DEFAULT_RECEIPT_WIDTH: ReceiptWidth = 32;

export interface TicketReceiptInput {
  tenantName:    string;
  agencyName?:   string;
  ticketId:      string;
  passengerName: string;
  seatNumber?:   string | null;
  origin:        string;
  destination:   string;
  departure:     string;  // ISO
  pricePaid:     number;
  currency:      string;
  qrToken?:      string | null;
  lang?:         'fr' | 'en';
}

export function buildTicketReceipt(input: TicketReceiptInput, width: ReceiptWidth = DEFAULT_RECEIPT_WIDTH): ReceiptPayload {
  const lang = input.lang ?? 'fr';
  const L = STRINGS[lang];
  const date = new Date(input.departure).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  return {
    id:     `ticket:${input.ticketId}`,
    kind:   'ticket',
    width,
    lines: [
      { text: input.tenantName.toUpperCase(), align: 'center', bold: true, double: true },
      { text: input.agencyName ?? '',         align: 'center' },
      { divider: true, text: '' },
      { text: L.ticketTitle, align: 'center', bold: true },
      { divider: true, text: '' },
      { text: `${L.passenger}: ${input.passengerName}` },
      { text: `${L.route}: ${input.origin} → ${input.destination}` },
      { text: `${L.departure}: ${date}` },
      ...(input.seatNumber ? [{ text: `${L.seat}: ${input.seatNumber}` }] : []),
      { divider: true, text: '' },
      {
        text: `${L.amount}: ${input.pricePaid.toLocaleString()} ${input.currency}`,
        bold: true, align: 'right',
      },
      { divider: true, text: '' },
      { text: `#${input.ticketId.slice(0, 12)}`, align: 'center' },
    ],
    qr:     input.qrToken ?? null,
    copies: 1,
  };
}

interface Strings {
  ticketTitle: string;
  passenger:   string;
  route:       string;
  departure:   string;
  seat:        string;
  amount:      string;
}

const STRINGS: Record<'fr' | 'en', Strings> = {
  fr: {
    ticketTitle: 'TITRE DE TRANSPORT',
    passenger:   'Passager',
    route:       'Trajet',
    departure:   'Départ',
    seat:        'Siège',
    amount:      'Montant',
  },
  en: {
    ticketTitle: 'TRAVEL TICKET',
    passenger:   'Passenger',
    route:       'Route',
    departure:   'Departure',
    seat:        'Seat',
    amount:      'Amount',
  },
};
