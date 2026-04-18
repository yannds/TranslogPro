import { IsString, IsNumber, IsOptional, IsIn } from 'class-validator';

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
}
