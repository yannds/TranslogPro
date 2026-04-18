/**
 * PaymentWebhookController — endpoint unique `/webhooks/payments/:providerKey`.
 *
 * Flow :
 *   1. Rate-limit 60 req/min/IP (anti-DDoS, normal est ~1 req/attempt).
 *   2. Récupère le rawBody (préservé par NestFactory({ rawBody: true })).
 *   3. Extrait le header de signature spécifique au provider.
 *   4. Délègue à `provider.verifyWebhook(rawBody, signature)` — HMAC temps constant.
 *   5. Passe le résultat vérifié à l'Orchestrator qui met à jour Intent/Attempt/Event.
 *
 * Sécurité :
 *   - Signature obligatoire — aucune réponse 200 sans vérification.
 *   - On renvoie TOUJOURS 200 après verify (même si Intent inconnu) pour
 *     éviter de faire retry indéfiniment un provider pour un intent qu'on
 *     ne connaît plus (cron réconciliation prend le relais).
 *   - En cas d'erreur de signature → 401 + log. Jamais de 500.
 */
import {
  BadRequestException,
  Controller,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { PaymentOrchestrator } from './payment-orchestrator.service';

@Controller('webhooks/payments')
export class PaymentWebhookController {
  private readonly log = new Logger(PaymentWebhookController.name);

  constructor(
    private readonly registry:     PaymentProviderRegistry,
    private readonly orchestrator: PaymentOrchestrator,
  ) {}

  @Post(':providerKey')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async handle(
    @Param('providerKey') providerKey: string,
    @Req() req: Request & { rawBody?: Buffer },
  ): Promise<{ received: boolean }> {
    const provider = this.registry.get(providerKey);
    if (!provider) {
      this.log.warn(`[Webhook] provider inconnu: ${providerKey}`);
      throw new BadRequestException(`Unknown provider ${providerKey}`);
    }

    const rawBody = req.rawBody;
    if (!rawBody || rawBody.length === 0) {
      throw new BadRequestException('Missing raw body — enable rawBody in NestFactory');
    }

    const signatureHeader = provider.webhookSignatureHeader.toLowerCase();
    const signature = req.headers[signatureHeader];
    if (!signature || Array.isArray(signature)) {
      this.log.warn(`[Webhook] ${providerKey} signature absente (header ${signatureHeader})`);
      throw new UnauthorizedException('Missing webhook signature');
    }

    try {
      const result = await provider.verifyWebhook(rawBody, signature);
      await this.orchestrator.applyWebhook(providerKey, result);
      return { received: true };
    } catch (err) {
      // verifyWebhook lève UnauthorizedException → on laisse remonter.
      if (err instanceof UnauthorizedException) {
        this.log.warn(`[Webhook] ${providerKey} signature invalide`);
        throw err;
      }
      // Toute autre erreur : on log et on renvoie 200 pour éviter un retry agressif.
      // La réconciliation cron finira le boulot.
      this.log.error(`[Webhook] ${providerKey} handler error: ${err instanceof Error ? err.message : err}`);
      return { received: true };
    }
  }
}
