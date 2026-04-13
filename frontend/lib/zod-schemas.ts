/**
 * zod-schemas.ts — Schémas Zod partagés (validation DRY)
 *
 * Ces schémas sont la source de vérité pour les formulaires.
 * react-hook-form les consomme via @hookform/resolvers/zod.
 * Les mêmes schémas peuvent être réutilisés côté backend (NestJS DTO validation).
 */
import { z } from 'zod';

// ─── Primitives réutilisables ─────────────────────────────────────────────────

export const zEmail   = z.string().email('Email invalide');
export const zPhone   = z.string().regex(/^\+?[\d\s\-().]{6,20}$/, 'Numéro invalide');
export const zName    = z.string().min(2, 'Min. 2 caractères').max(100, 'Max. 100 caractères');
export const zSlug    = z.string().regex(/^[a-z0-9-]+$/, 'Uniquement lettres minuscules, chiffres et tirets');
export const zAmount  = z.number().nonnegative('Montant positif requis');
export const zWeight  = z.number().positive('Poids positif requis').max(5000, 'Max 5000 kg');

// ─── Schémas métier ───────────────────────────────────────────────────────────

export const ticketPrintSchema = z.object({
  ticketId:   z.string().ulid('ID billet invalide'),
  format:     z.enum(['A5', 'A4']).default('A5'),
});

export const invoiceSchema = z.object({
  entityId:     z.string(),
  entityType:   z.enum(['TICKET', 'PARCEL']),
  dueInDays:    z.number().int().min(0).max(365).default(30),
  notes:        z.string().max(500).optional(),
});

export const labelBatchSchema = z.object({
  parcelIds:   z.array(z.string()).min(1).max(100),
  layout:      z.enum(['2x4', '2x2']).default('2x4'),
});

export const envelopeSchema = z.object({
  recipientName:    zName,
  recipientAddress: z.string().min(5),
  recipientCity:    z.string().min(2),
  recipientZip:     z.string().optional(),
  format:           z.enum(['C5', 'DL']).default('C5'),
  reference:        z.string().optional(),
});

export const templateFormSchema = z.object({
  name:       zName,
  slug:       zSlug,
  docType:    z.enum(['TICKET', 'MANIFEST', 'INVOICE', 'LABEL', 'PACKING_LIST']),
  format:     z.enum(['A4', 'A5', 'THERMAL_80MM', 'LABEL_62MM', 'ENVELOPE_C5', 'BAGGAGE_TAG']),
  engine:     z.enum(['HBS', 'PUPPETEER']).default('HBS'),
  body:       z.string().optional(),
});

// ─── Types inférés ────────────────────────────────────────────────────────────

export type TicketPrintForm  = z.infer<typeof ticketPrintSchema>;
export type InvoiceForm      = z.infer<typeof invoiceSchema>;
export type LabelBatchForm   = z.infer<typeof labelBatchSchema>;
export type EnvelopeForm     = z.infer<typeof envelopeSchema>;
export type TemplateForm     = z.infer<typeof templateFormSchema>;
