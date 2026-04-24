/**
 * PayoutService — gap #4 (gateway payout adapter).
 *
 * Orchestre l'exécution réelle d'un remboursement via un provider externe
 * (Flutterwave, Paystack, etc.) en s'appuyant sur `IPaymentProvider.refund()`.
 *
 * Contrat :
 *   - `executeRefundPayout(refundId)` — à appeler APRÈS que le Refund est en
 *     PROCESSED (workflow) et que la Transaction reversal caisse est inscrite.
 *   - Best-effort : une erreur gateway est loggée + marquée sur la Transaction
 *     (status=FAILED), mais ne remet pas le Refund en arrière. L'opérateur
 *     peut relancer le payout via `/admin/sav/refunds/:id/retry-payout`.
 *
 * Déterminisme provider :
 *   - Lookup de la Transaction ORIGINALE du billet rattaché au Refund.
 *   - Si paymentMethod='CASH' → skip (le cash a déjà été rendu au guichet).
 *   - Si externalRef absent    → skip (rien à refund chez un provider).
 *   - Si externalRef présent   → appelle provider.refund({externalRef, amount, reason}).
 *
 * Rétention :
 *   - Propage l'`externalRef` du payout retourné par le provider sur la
 *     Transaction reversal pour traçabilité cross-system.
 *   - Stocke dans metadata : { payoutProvider, payoutStatus, payoutAt, payoutError? }.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PaymentProviderRegistry } from './payment-provider.registry';

export interface PayoutOutcome {
  refundId:       string;
  status:         'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  providerKey?:   string;
  externalRef?:   string;
  reason?:        string;
}

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    private readonly prisma:   PrismaService,
    private readonly registry: PaymentProviderRegistry,
  ) {}

  /**
   * Exécute le payout gateway pour un Refund en PROCESSED. Idempotent :
   * si la Transaction reversal a déjà `externalRef` non-null, on ne relance pas.
   */
  async executeRefundPayout(tenantId: string, refundId: string): Promise<PayoutOutcome> {
    const refund = await this.prisma.refund.findFirst({
      where:  { id: refundId, tenantId },
    });
    if (!refund) throw new NotFoundException(`Refund ${refundId} introuvable`);
    if (refund.status !== 'PROCESSED') {
      return { refundId, status: 'SKIPPED', reason: `Refund status=${refund.status} — payout requiert PROCESSED` };
    }

    // Transaction reversal créée par Sprint B3 (Refund.PROCESS persist).
    const reversal = await this.prisma.transaction.findFirst({
      where: {
        tenantId,
        type:        'REFUND',
        externalRef: `refund:${refund.id}`,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!reversal) {
      return { refundId, status: 'SKIPPED', reason: 'Reversal Transaction introuvable — vérifier Refund.PROCESS' };
    }

    // Idempotence : si l'externalRef a déjà été stamp par un provider, on skip.
    const meta = (reversal.metadata ?? {}) as Record<string, unknown>;
    if (meta.payoutStatus === 'SUCCEEDED') {
      return { refundId, status: 'SKIPPED', reason: 'Payout déjà exécuté (idempotent)' };
    }

    // Transaction ORIGINALE du billet — d'où vient le paiement initial.
    // referenceId est stocké dans metadata (pas colonne dédiée) — on utilise
    // externalRef=`ticket:<id>` qui est la convention posée par Ticket.PAY persist.
    const originalTx = await this.prisma.transaction.findFirst({
      where: {
        tenantId,
        type:        'TICKET',
        externalRef: `ticket:${refund.ticketId}`,
      },
      orderBy: { createdAt: 'asc' }, // prend la première vente si plusieurs (cas rare)
    });

    if (!originalTx) {
      await this.markPayoutFailed(reversal.id, null, 'Transaction originale billet introuvable');
      return { refundId, status: 'SKIPPED', reason: 'Transaction originale introuvable' };
    }

    // Cash pur — pas de gateway à appeler, le cash a été rendu au guichet.
    if (originalTx.paymentMethod === 'CASH') {
      await this.markPayoutSkipped(reversal.id, 'CASH_AT_COUNTER');
      return { refundId, status: 'SKIPPED', reason: 'Paiement initial en CASH — rendu au guichet' };
    }

    if (!originalTx.externalRef) {
      await this.markPayoutFailed(reversal.id, null, 'externalRef provider absent sur la tx originale');
      return { refundId, status: 'FAILED', reason: 'externalRef provider absent' };
    }

    // Résolution du provider via metadata ou heuristique simple (le reconciliation
    // service stocke normalement `providerKey` dans metadata — fallback : on tente
    // tous les providers disponibles via registry).
    const originalMeta = (originalTx.metadata ?? {}) as Record<string, unknown>;
    const providerKey  = typeof originalMeta.providerKey === 'string'
      ? originalMeta.providerKey
      : null;

    if (!providerKey) {
      await this.markPayoutFailed(reversal.id, null, 'providerKey absent dans metadata');
      return { refundId, status: 'FAILED', reason: 'providerKey indisponible' };
    }

    const provider = this.registry.get(providerKey);
    if (!provider) {
      await this.markPayoutFailed(reversal.id, providerKey, `Provider "${providerKey}" non enregistré`);
      return { refundId, status: 'FAILED', reason: `Provider "${providerKey}" inconnu` };
    }

    // Appel gateway externe — HORS transaction workflow. Best-effort.
    try {
      const result = await provider.refund({
        externalRef: originalTx.externalRef,
        amount:      Math.abs(reversal.amount),
        reason:      `Refund ${refund.id}`,
      });
      await this.markPayoutSucceeded(reversal.id, providerKey, result.externalRef);
      this.logger.log(
        `Payout OK refund=${refund.id} provider=${providerKey} extRef=${result.externalRef}`,
      );
      return { refundId, status: 'SUCCEEDED', providerKey, externalRef: result.externalRef };
    } catch (err) {
      const msg = (err as Error).message;
      await this.markPayoutFailed(reversal.id, providerKey, msg);
      this.logger.warn(`Payout FAILED refund=${refund.id} provider=${providerKey}: ${msg}`);
      return { refundId, status: 'FAILED', providerKey, reason: msg };
    }
  }

  private async markPayoutSucceeded(
    reversalId:  string,
    providerKey: string,
    externalRef: string,
  ): Promise<void> {
    await this.prisma.transaction.update({
      where: { id: reversalId },
      data:  {
        externalRef,
        metadata: {
          payoutStatus:   'SUCCEEDED',
          payoutProvider: providerKey,
          payoutAt:       new Date().toISOString(),
        } as object,
      },
    });
  }

  private async markPayoutFailed(
    reversalId:  string,
    providerKey: string | null,
    reason:      string,
  ): Promise<void> {
    await this.prisma.transaction.update({
      where: { id: reversalId },
      data:  {
        metadata: {
          payoutStatus:   'FAILED',
          payoutProvider: providerKey,
          payoutAt:       new Date().toISOString(),
          payoutError:    reason,
        } as object,
      },
    });
  }

  private async markPayoutSkipped(reversalId: string, reason: string): Promise<void> {
    await this.prisma.transaction.update({
      where: { id: reversalId },
      data:  {
        metadata: {
          payoutStatus: 'SKIPPED',
          payoutAt:     new Date().toISOString(),
          payoutSkip:   reason,
        } as object,
      },
    });
  }
}
