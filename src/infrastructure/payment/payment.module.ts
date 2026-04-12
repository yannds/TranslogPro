import { Module, Global } from '@nestjs/common';
import { FlutterwaveService } from './flutterwave.service';
import { PAYMENT_SERVICE } from './interfaces/payment.interface';

/**
 * PaymentModule — global, fournit IPaymentService via FlutterwaveService.
 *
 * Pour switcher vers Paystack : remplacer FlutterwaveService par PaystackService
 * dans le provider useClass. Le code métier (TicketingService, CashierService)
 * ne connaît que le token PAYMENT_SERVICE — zéro modification requise.
 *
 * Vault path utilisé : "platform/flutterwave" → { SECRET_KEY, WEBHOOK_HASH }
 */
@Global()
@Module({
  providers: [
    {
      provide:  PAYMENT_SERVICE,
      useClass: FlutterwaveService,
    },
  ],
  exports: [PAYMENT_SERVICE],
})
export class PaymentModule {}
