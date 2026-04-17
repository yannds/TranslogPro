import { IsString, IsOptional, IsNumber, IsDateString, IsArray, Min } from 'class-validator';

export class CreateInvoiceDto {
  @IsString()
  customerName: string;

  @IsOptional() @IsString()
  customerEmail?: string;

  @IsOptional() @IsString()
  customerPhone?: string;

  @IsOptional() @IsString()
  customerId?: string;

  @IsNumber() @Min(0)
  subtotal: number;

  @IsOptional() @IsNumber() @Min(0)
  taxRate?: number;

  @IsString()
  entityType: string; // TICKET | PARCEL | SUBSCRIPTION | CORPORATE

  @IsOptional() @IsString()
  entityId?: string;

  @IsOptional() @IsDateString()
  dueDate?: string;

  @IsOptional() @IsString()
  paymentMethod?: string;

  @IsOptional() @IsArray()
  lineItems?: { description: string; quantity: number; unitPrice: number; total: number }[];

  @IsOptional() @IsString()
  notes?: string;
}

export class UpdateInvoiceDto {
  @IsOptional() @IsString()
  status?: string;

  @IsOptional() @IsString()
  paymentMethod?: string;

  @IsOptional() @IsString()
  paymentRef?: string;

  @IsOptional() @IsString()
  notes?: string;
}
