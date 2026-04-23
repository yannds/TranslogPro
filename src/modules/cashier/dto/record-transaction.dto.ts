import { IsString, IsNumber, IsOptional, IsIn, Min } from 'class-validator';

export const CASHIER_TX_TYPES = ['TICKET', 'PARCEL', 'LUGGAGE_FEE', 'REFUND', 'CASH_IN', 'CASH_OUT'] as const;
export type CashierTxType = (typeof CASHIER_TX_TYPES)[number];

export const CASHIER_PAYMENT_METHODS = [
  'CASH',
  'MOBILE_MONEY',
  'CARD',
  'BANK_TRANSFER',
  'VOUCHER',
  'MIXED',
] as const;
export type CashierPaymentMethod = (typeof CASHIER_PAYMENT_METHODS)[number];

export class RecordTransactionDto {
  @IsIn(CASHIER_TX_TYPES)
  type: CashierTxType;

  @IsNumber()
  amount: number;

  @IsIn(CASHIER_PAYMENT_METHODS)
  paymentMethod: CashierPaymentMethod;

  @IsOptional() @IsString()
  externalRef?: string;

  @IsOptional() @IsString()
  referenceType?: string; // TICKET | PARCEL | INVOICE — lien vers l'entité métier

  @IsOptional() @IsString()
  referenceId?: string;

  @IsOptional() @IsString()
  note?: string;

  /**
   * Espèces uniquement : montant remis par le client (billet/monnaie).
   * Doit être ≥ amount (ou ≥ batchTotal si fourni).
   * Ignoré pour paymentMethod ≠ CASH.
   */
  @IsOptional() @IsNumber() @Min(0)
  tenderedAmount?: number;

  /**
   * Espèces + achat groupé : total à couvrir par tenderedAmount pour le batch
   * complet. Si présent, changeAmount = tenderedAmount - batchTotal.
   * Sinon changeAmount = tenderedAmount - amount (cas single tx).
   * Utilisé par ticketing.confirmBatch sur la 1re transaction seulement.
   */
  @IsOptional() @IsNumber() @Min(0)
  batchTotal?: number;
}
