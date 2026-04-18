/**
 * PaymentReconciliationService — cron de rattrapage.
 *
 * Deux boucles :
 *   1. RECONCILE : pour chaque Intent en CREATED|PROCESSING dont la dernière
 *      attempt est > `reconciliationLagMinutes` (tenant), on interroge
 *      provider.verify() et on applique le résultat via l'Orchestrator.
 *   2. EXPIRE    : pour chaque Intent en CREATED|PROCESSING dont expiresAt < now,
 *      on le marque EXPIRED (event append-only).
 *
 * Fréquence par défaut : toutes les 10 minutes (EVERY_10_MINUTES).
 * Peut être désactivée globalement via PlatformPaymentConfig.reconciliationCronEnabled.
 *
 * Aucune hypothèse sur le nombre de providers : on délègue à
 * provider.verify(externalRef) via le registry — ajouter un connecteur ne
 * requiert aucune modification ici.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { PaymentOrchestrator } from './payment-orchestrator.service';
import { PaymentProviderRegistry } from './payment-provider.registry';

const DEFAULT_LAG_MINUTES = 30;
const BATCH_SIZE = 100;

@Injectable()
export class PaymentReconciliationService {
  private readonly log = new Logger(PaymentReconciliationService.name);

  constructor(
    private readonly prisma:       PrismaService,
    private readonly orchestrator: PaymentOrchestrator,
    private readonly registry:     PaymentProviderRegistry,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'payment-reconciliation' })
  async runCron(): Promise<void> {
    const cfg = await this.prisma.platformPaymentConfig.findUnique({ where: { id: 'singleton' } });
    if (cfg && !cfg.reconciliationCronEnabled) {
      this.log.debug('[Reconciliation] désactivé via PlatformPaymentConfig — skip');
      return;
    }
    const lagMin = cfg?.reconciliationLagMinutes ?? DEFAULT_LAG_MINUTES;
    await this.expirePast();
    await this.reconcileStale(lagMin);
  }

  /** Marque EXPIRED les intents dont expiresAt < now. */
  async expirePast(): Promise<number> {
    const now = new Date();
    const stale = await this.prisma.paymentIntent.findMany({
      where: {
        status:    { in: ['CREATED', 'PROCESSING'] },
        expiresAt: { lt: now },
      },
      select: { id: true, status: true },
      take:   BATCH_SIZE,
    });
    for (const intent of stale) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: 'EXPIRED' } });
          await tx.paymentEvent.create({
            data: {
              intentId: intent.id, type: 'EXPIRED', source: 'CRON',
              payload: { from: intent.status, to: 'EXPIRED' },
            },
          });
        });
      } catch (err) {
        this.log.warn(`[Reconciliation] expire failed intent=${intent.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (stale.length > 0) this.log.log(`[Reconciliation] expired ${stale.length} intent(s)`);
    return stale.length;
  }

  /** Réinterroge le provider pour les intents bloqués depuis > lagMin minutes. */
  async reconcileStale(lagMin: number): Promise<number> {
    const cutoff = new Date(Date.now() - lagMin * 60_000);
    const intents = await this.prisma.paymentIntent.findMany({
      where: {
        status:    { in: ['CREATED', 'PROCESSING'] },
        expiresAt: { gte: new Date() },
        updatedAt: { lt: cutoff },
      },
      include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } },
      take: BATCH_SIZE,
    });

    let processed = 0;
    for (const intent of intents) {
      const att = intent.attempts[0];
      if (!att?.externalRef) continue;
      const provider = this.registry.get(att.providerKey);
      if (!provider) {
        this.log.warn(`[Reconciliation] provider ${att.providerKey} introuvable pour intent ${intent.id}`);
        continue;
      }
      try {
        const res = await provider.verify(att.externalRef);
        await this.orchestrator.applyWebhook(att.providerKey, {
          isValid:     true,
          txRef:       res.txRef,
          externalRef: res.externalRef,
          status:      res.status,
          amount:      res.amount,
          currency:    res.currency,
        });
        processed++;
      } catch (err) {
        this.log.warn(`[Reconciliation] verify failed intent=${intent.id} provider=${att.providerKey}: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (processed > 0) this.log.log(`[Reconciliation] reconciled ${processed}/${intents.length} intent(s)`);
    return processed;
  }
}
