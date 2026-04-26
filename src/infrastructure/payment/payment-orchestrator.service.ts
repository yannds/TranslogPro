/**
 * PaymentOrchestrator — API métier unique pour tout achat.
 *
 * Tous les modules (ticketing, parcel, portail public, subscription plateforme)
 * appellent UNIQUEMENT cet orchestrator. Ils ne connaissent ni les providers,
 * ni les tables PaymentAttempt/PaymentEvent — l'orchestrator encapsule tout.
 *
 * Cycle de vie d'un Intent :
 *   CREATED → PROCESSING → SUCCEEDED | FAILED | CANCELLED | EXPIRED
 *                        ↘ REFUNDED | PARTIALLY_REFUNDED
 *
 * Règles d'or :
 *   - Idempotence : (tenantId, idempotencyKey) → même Intent, jamais de double.
 *   - Audit : chaque action écrit un PaymentEvent append-only.
 *   - Secrets : jamais lus ici — les providers font leur propre accès Vault.
 *   - Taxes : calculées par TaxCalculatorService depuis TenantTax (zéro formule locale).
 *   - Durées : lues depuis TenantPaymentConfig (zéro magic number).
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  computeTaxes,
  TenantTaxInput,
} from '../../core/billing/tax-calculator.service';
import {
  InitiatePaymentDto,
  PaymentCurrency,
  PaymentMethod,
  PaymentResult,
  PaymentStatus,
  RefundDto,
  WebhookVerificationResult,
} from './interfaces/payment.interface';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { PaymentRouter } from './payment-router.service';
import { PayloadEncryptor } from './payload-encryptor.service';
import { PaymentSplitService } from './payment-split.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventTypes } from '../../common/types/domain-event.type';

// ─── Types d'entrée ──────────────────────────────────────────────────────────

export interface CreateIntentDto {
  entityType:     string;                // TICKET | PARCEL | INVOICE | SUBSCRIPTION | CUSTOM
  entityId?:      string;
  customerId?:    string;
  subtotal:       number;                // HT — taxes calculées côté orchestrator
  method:         PaymentMethod;
  currency?:      PaymentCurrency;       // défaut: tenant.currency
  /** Idempotency-Key propagée depuis le client. Obligatoire. */
  idempotencyKey: string;
  description?:   string;
  metadata?:      Record<string, unknown>;
  customerPhone?: string;
  customerEmail?: string;
  customerName?:  string;
  redirectUrl?:   string;
}

export interface CreateIntentResult {
  intentId:    string;
  status:      string;
  amount:      number;
  currency:    string;
  paymentUrl?: string;
  providerKey: string;
  expiresAt:   Date;
}

export interface RefundIntentDto {
  amount?: number;
  reason:  string;
}

// ─── Constantes locales (protocole, pas métier) ──────────────────────────────
const EVENT_SOURCE_SYSTEM  = 'SYSTEM';
const EVENT_SOURCE_WEBHOOK = 'WEBHOOK';

@Injectable()
export class PaymentOrchestrator {
  private readonly log = new Logger(PaymentOrchestrator.name);

  constructor(
    private readonly prisma:    PrismaService,
    private readonly router:    PaymentRouter,
    private readonly registry:  PaymentProviderRegistry,
    private readonly encryptor: PayloadEncryptor,
    private readonly events:    EventEmitter2,
    private readonly splitter:  PaymentSplitService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE INTENT — point d'entrée unique côté métier
  // ═══════════════════════════════════════════════════════════════════════════

  async createIntent(tenantId: string, dto: CreateIntentDto): Promise<CreateIntentResult> {
    if (!dto.idempotencyKey) throw new BadRequestException('idempotencyKey required');
    if (dto.subtotal < 0)    throw new BadRequestException('subtotal must be >= 0');

    // 1. Idempotence
    const existing = await this.prisma.paymentIntent.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: dto.idempotencyKey } },
      include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (existing) {
      const lastAttempt = existing.attempts[0];
      return {
        intentId:    existing.id,
        status:      existing.status,
        amount:      existing.amount,
        currency:    existing.currency,
        paymentUrl:  lastAttempt?.paymentUrl ?? undefined,
        providerKey: lastAttempt?.providerKey ?? '',
        expiresAt:   existing.expiresAt,
      };
    }

    // 2. Tenant + config + taxes
    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { country: true, currency: true },
    });
    if (!tenant) throw new NotFoundException(`Tenant ${tenantId} introuvable`);

    const currency = (dto.currency ?? tenant.currency) as PaymentCurrency;
    const paymentConfig = await this.prisma.tenantPaymentConfig.findUnique({
      where: { tenantId },
      select: { intentTtlMinutes: true },
    });
    const ttlMinutes = paymentConfig?.intentTtlMinutes ?? 15;

    const taxes = await this.loadTenantTaxes(tenantId);
    const taxComp = computeTaxes({
      subtotal:   dto.subtotal,
      currency,
      entityType: dto.entityType,
      taxes,
    });

    // 3. Routing
    const route = await this.router.resolve({
      tenantId, method: dto.method, country: tenant.country, currency,
      amount: taxComp.total,
    });

    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

    // 4. TX création Intent + Attempt + Events (avant tout appel réseau)
    // Enrichissement mobile money : on capture le MSISDN et sa version masquée
    // dans la metadata de l'intent. Les webhooks PSP (MTN/Airtel/Wave) ne
    // réechoent PAS le téléphone, donc sans ce capteur en amont on perdrait
    // l'identifiant nécessaire à l'auto-renew et à l'enregistrement du moyen
    // au succès (notamment pour SetupIntent mobile money).
    const baseMetadata = (dto.metadata ?? {}) as Record<string, unknown>;
    const enrichedMetadata = dto.method === 'MOBILE_MONEY' && dto.customerPhone
      ? {
          ...baseMetadata,
          customerPhone:     dto.customerPhone,
          customerPhoneMask: maskPhone(dto.customerPhone),
        }
      : baseMetadata;

    const { intent, attempt } = await this.prisma.$transaction(async (tx) => {
      const intent = await tx.paymentIntent.create({
        data: {
          tenantId,
          idempotencyKey: dto.idempotencyKey,
          entityType:     dto.entityType,
          entityId:       dto.entityId,
          customerId:     dto.customerId,
          amount:         taxComp.total,
          subtotal:       taxComp.subtotal,
          taxBreakdown:   taxComp.taxes as unknown as object,
          currency,
          method:         dto.method,
          status:         'CREATED',
          description:    dto.description,
          metadata:       enrichedMetadata as object,
          expiresAt,
        },
      });
      const attempt = await tx.paymentAttempt.create({
        data: {
          intentId:    intent.id,
          providerKey: route.providerKey,
          status:      'INITIATED',
          amount:      taxComp.total,
          currency,
        },
      });
      await tx.paymentEvent.createMany({
        data: [
          { intentId: intent.id, type: 'INTENT_CREATED',  source: EVENT_SOURCE_SYSTEM,
            payload: { providerKey: route.providerKey, mode: route.mode, subtotal: taxComp.subtotal, total: taxComp.total } },
          { intentId: intent.id, attemptId: attempt.id, type: 'ATTEMPT_STARTED', source: EVENT_SOURCE_SYSTEM,
            payload: { providerKey: route.providerKey } },
        ],
      });
      return { intent, attempt };
    });

    // 5. Calcul du split commission SaaS — uniquement si le provider supporte
    // le split natif. Sinon on reste en mode legacy (tout encaissé chez la
    // plateforme, payout T+1 manuel à coder en aval).
    const split = await this.splitter.computeSplit({
      tenantId, amount: intent.amount,
    });
    if (split && route.provider.supportsSplit() && !split.tenantSubaccountId) {
      // Tenant n'a pas configuré son subaccount alors que le provider sait splitter :
      // on log l'événement pour reconciliation manuelle. Le paiement n'est PAS bloqué.
      await this.prisma.paymentEvent.create({
        data: {
          intentId: intent.id, attemptId: attempt.id,
          type: 'SPLIT_SKIPPED_NO_SUBACCOUNT', source: EVENT_SOURCE_SYSTEM,
          payload: {
            providerKey:    route.providerKey,
            platformAmount: split.platformAmount,
            tenantAmount:   split.tenantAmount,
            policyTrace:    split.policyTrace,
          },
        },
      });
      this.log.warn(
        `[Split] tenant ${tenantId} — payoutSubaccountId absent, paiement legacy ` +
        `(provider=${route.providerKey}, intent=${intent.id})`,
      );
    } else if (split && route.provider.supportsSplit() && split.tenantSubaccountId) {
      // Split actif et supporté → trace dans l'audit log.
      await this.prisma.paymentEvent.create({
        data: {
          intentId: intent.id, attemptId: attempt.id,
          type: 'SPLIT_PLANNED', source: EVENT_SOURCE_SYSTEM,
          payload: {
            providerKey:        route.providerKey,
            platformAmount:     split.platformAmount,
            tenantAmount:       split.tenantAmount,
            tenantSubaccountId: split.tenantSubaccountId,
            policyTrace:        split.policyTrace,
          },
        },
      });
    }

    // 6. Appel provider (hors TX — réseau)
    const initiateDto: InitiatePaymentDto = {
      txRef:          intent.id,
      amount:         intent.amount,
      currency:       intent.currency as PaymentCurrency,
      method:         dto.method,
      customerPhone:  dto.customerPhone,
      customerEmail:  dto.customerEmail,
      customerName:   dto.customerName,
      redirectUrl:    dto.redirectUrl,
      meta: { tenantId, intentId: intent.id, ...(dto.metadata as Record<string, string> | undefined) },
      // Le provider décide lui-même : ignore split si supportsSplit() === false
      // (pas de mensonge dans le payload), ou si tenantSubaccountId absent.
      ...(split && route.provider.supportsSplit() ? { split } : {}),
    };

    let providerResult: PaymentResult;
    try {
      providerResult = await route.provider.initiate(initiateDto);
    } catch (err) {
      await this.recordAttemptFailure(attempt.id, intent.id, err);
      throw err;
    }

    // 6. Persistence du résultat + events
    const requestEnc  = await this.encryptor.encryptJson(initiateDto).catch(() => null);
    const responseEnc = await this.encryptor.encryptJson(providerResult).catch(() => null);

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          externalRef:        providerResult.externalRef,
          status:             mapProviderStatusToAttempt(providerResult.status),
          paymentUrl:         providerResult.paymentUrl,
          requestEnc:         requestEnc ?? undefined,
          responseEnc:        responseEnc ?? undefined,
          providerCallAt:     new Date(),
          providerResolvedAt: providerResult.processedAt ?? undefined,
        },
      });
      await tx.paymentEvent.create({
        data: {
          intentId: intent.id, attemptId: attempt.id,
          type: 'PROVIDER_CALLED', source: EVENT_SOURCE_SYSTEM,
          payload: { externalRef: providerResult.externalRef, providerStatus: providerResult.status },
        },
      });
      await tx.paymentIntent.update({
        where: { id: intent.id },
        data:  { status: deriveIntentStatusFromProvider(providerResult.status) },
      });
    });

    return {
      intentId:    intent.id,
      status:      deriveIntentStatusFromProvider(providerResult.status),
      amount:      intent.amount,
      currency:    intent.currency,
      paymentUrl:  providerResult.paymentUrl,
      providerKey: route.providerKey,
      expiresAt,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIRM — polling manuel (ou forcé) via provider.verify
  // ═══════════════════════════════════════════════════════════════════════════

  async confirm(intentId: string): Promise<{ status: string }> {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
      include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!intent) throw new NotFoundException(`Intent ${intentId} introuvable`);
    const att = intent.attempts[0];
    if (!att || !att.externalRef) return { status: intent.status };
    const provider = this.registry.get(att.providerKey);
    if (!provider) throw new BadRequestException(`Provider ${att.providerKey} introuvable`);

    const result = await provider.verify(att.externalRef);
    await this.applyProviderResult(intent.id, att.id, result, EVENT_SOURCE_SYSTEM);
    const refreshed = await this.prisma.paymentIntent.findUnique({ where: { id: intentId }, select: { status: true } });
    return { status: refreshed!.status };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // APPLY WEBHOOK — appelé par WebhookController après vérification HMAC
  // ═══════════════════════════════════════════════════════════════════════════

  async applyWebhook(providerKey: string, result: WebhookVerificationResult): Promise<void> {
    // On matche d'abord sur (providerKey, externalRef). Les providers peuvent aussi
    // renvoyer txRef (= intentId) — on l'utilise en fallback.
    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: {
        providerKey,
        OR: [
          { externalRef: result.externalRef },
          { intent: { id: result.txRef } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!attempt) {
      // Orphan webhook — on log un event « fantôme » sur un intent synthétique ?
      // Plus simple : on log uniquement côté applicatif et on renvoie 200 pour ne
      // pas pousser le provider à spammer des retries. Le cron réconciliation
      // rattrapera s'il y a un mismatch.
      this.log.warn(`[Webhook] orphan ${providerKey} externalRef=${result.externalRef} txRef=${result.txRef}`);
      return;
    }

    const providerResult: PaymentResult = {
      txRef:        result.txRef,
      externalRef:  result.externalRef,
      status:       result.status,
      amount:       result.amount,
      currency:     result.currency,
      providerName: providerKey,
    };
    await this.applyProviderResult(attempt.intentId, attempt.id, providerResult, EVENT_SOURCE_WEBHOOK);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REFUND — rembourse un intent SUCCEEDED
  // ═══════════════════════════════════════════════════════════════════════════

  async refund(intentId: string, dto: RefundIntentDto): Promise<{ status: string; refundedAmount: number }> {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
      include: { attempts: { orderBy: { createdAt: 'desc' } } },
    });
    if (!intent) throw new NotFoundException(`Intent ${intentId} introuvable`);
    if (intent.status !== 'SUCCEEDED' && intent.status !== 'PARTIALLY_REFUNDED') {
      throw new ConflictException(`Intent ${intentId} n'est pas remboursable (status=${intent.status})`);
    }
    const successAttempt = intent.attempts.find(a => a.status === 'SUCCESSFUL' && a.externalRef);
    if (!successAttempt) throw new ConflictException('Aucune tentative réussie à rembourser');

    const provider = this.registry.get(successAttempt.providerKey);
    if (!provider) throw new BadRequestException(`Provider ${successAttempt.providerKey} indisponible`);

    const refundAmount = dto.amount ?? intent.amount;
    if (refundAmount <= 0)             throw new BadRequestException('refund amount must be > 0');
    if (refundAmount > intent.amount)  throw new BadRequestException('refund > intent amount');

    await this.prisma.paymentEvent.create({
      data: {
        intentId:   intent.id,
        attemptId:  successAttempt.id,
        type:       'REFUND_INITIATED',
        source:     EVENT_SOURCE_SYSTEM,
        payload:    { amount: refundAmount, reason: dto.reason },
      },
    });

    const refundDto: RefundDto = {
      externalRef: successAttempt.externalRef!,
      amount:      refundAmount,
      reason:      dto.reason,
    };
    const result = await provider.refund(refundDto);

    const newStatus = refundAmount >= intent.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    const responseEnc = await this.encryptor.encryptJson(result).catch(() => null);

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentEvent.create({
        data: {
          intentId:   intent.id,
          attemptId:  successAttempt.id,
          type:       'REFUND_COMPLETED',
          source:     EVENT_SOURCE_SYSTEM,
          payload:    { amount: refundAmount, providerStatus: result.status, externalRef: result.externalRef },
        },
      });
      await tx.paymentIntent.update({
        where: { id: intent.id },
        data:  { status: newStatus },
      });
      if (responseEnc) {
        await tx.paymentAttempt.update({
          where: { id: successAttempt.id },
          data:  { status: 'REVERSED', responseEnc },
        });
      }
    });

    return { status: newStatus, refundedAmount: refundAmount };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CANCEL — uniquement si pas déjà PROCESSING irréversible
  // ═══════════════════════════════════════════════════════════════════════════

  async cancel(intentId: string, reason: string): Promise<{ status: string }> {
    const intent = await this.prisma.paymentIntent.findUnique({ where: { id: intentId } });
    if (!intent) throw new NotFoundException(`Intent ${intentId} introuvable`);
    if (!['CREATED', 'PROCESSING'].includes(intent.status)) {
      throw new ConflictException(`Intent ${intentId} non annulable (status=${intent.status})`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: 'CANCELLED' } });
      await tx.paymentEvent.create({
        data: { intentId: intent.id, type: 'STATUS_CHANGED', source: EVENT_SOURCE_SYSTEM, payload: { from: intent.status, to: 'CANCELLED', reason } },
      });
    });
    return { status: 'CANCELLED' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // READ helpers
  // ═══════════════════════════════════════════════════════════════════════════

  async getIntent(intentId: string) {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
      include: { attempts: { orderBy: { createdAt: 'desc' } } },
    });
    if (!intent) throw new NotFoundException(`Intent ${intentId} introuvable`);
    return intent;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Helpers privés
  // ═══════════════════════════════════════════════════════════════════════════

  private async loadTenantTaxes(tenantId: string): Promise<TenantTaxInput[]> {
    const rows = await this.prisma.tenantTax.findMany({
      where: { tenantId, enabled: true },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map(r => ({
      code: r.code, label: r.label, labelKey: r.labelKey,
      rate: r.rate, kind: r.kind as 'PERCENT' | 'FIXED',
      base: r.base as 'SUBTOTAL' | 'TOTAL_AFTER_PREVIOUS',
      appliesTo: r.appliesTo, sortOrder: r.sortOrder, enabled: r.enabled,
      validFrom: r.validFrom, validTo: r.validTo,
    }));
  }

  private async recordAttemptFailure(attemptId: string, intentId: string, err: unknown): Promise<void> {
    const msg = err instanceof Error ? err.message : String(err);
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentAttempt.update({
        where: { id: attemptId },
        data:  { status: 'FAILED', failureMessage: msg, providerResolvedAt: new Date() },
      });
      await tx.paymentEvent.create({
        data: { intentId, attemptId, type: 'ERROR', source: EVENT_SOURCE_SYSTEM, payload: { message: msg } },
      });
      await tx.paymentIntent.update({
        where: { id: intentId },
        data:  { status: 'FAILED' },
      });
    });
  }

  private async applyProviderResult(
    intentId:  string,
    attemptId: string,
    result:    PaymentResult,
    source:    typeof EVENT_SOURCE_SYSTEM | typeof EVENT_SOURCE_WEBHOOK,
  ): Promise<void> {
    const attemptStatus = mapProviderStatusToAttempt(result.status);
    const intentStatus  = deriveIntentStatusFromProvider(result.status);

    let transitionedTo: string | null = null;

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.paymentIntent.findUnique({ where: { id: intentId }, select: { status: true } });
      if (!current) return;
      await tx.paymentAttempt.update({
        where: { id: attemptId },
        data:  {
          status:             attemptStatus,
          externalRef:        result.externalRef,
          providerResolvedAt: result.processedAt ?? new Date(),
        },
      });
      await tx.paymentEvent.create({
        data: {
          intentId, attemptId, source,
          type:    source === EVENT_SOURCE_WEBHOOK ? 'WEBHOOK_RECEIVED' : 'STATUS_CHANGED',
          payload: { providerStatus: result.status, amount: result.amount, currency: result.currency },
        },
      });
      if (current.status !== intentStatus && isIntentTransitionAllowed(current.status, intentStatus)) {
        await tx.paymentIntent.update({
          where: { id: intentId },
          data:  {
            status:     intentStatus,
            settledAt:  intentStatus === 'SUCCEEDED' ? new Date() : undefined,
          },
        });
        transitionedTo = intentStatus;
      }
    });

    // Post-transaction : émet un événement domaine si transition terminale atteinte.
    // Les modules métier (subscription-checkout, ticketing, parcel) s'abonnent
    // via @OnEvent pour réconcilier leur état (abonnement ACTIVE, ticket PAID…).
    // On propage les champs de tokenisation (customerRef, methodToken, last4,
    // brand) quand le provider les a fournis — cruciale pour l'auto-renew.
    if (transitionedTo === 'SUCCEEDED' || transitionedTo === 'FAILED') {
      await this.emitIntentTerminalEvent(intentId, transitionedTo, {
        customerRef: result.customerRef,
        methodToken: result.methodToken,
        methodLast4: result.methodLast4,
        methodBrand: result.methodBrand,
        maskedPhone: result.maskedPhone,
      });
    }
  }

  private async emitIntentTerminalEvent(
    intentId: string,
    status: 'SUCCEEDED' | 'FAILED',
    tokenization?: {
      customerRef?: string; methodToken?: string;
      methodLast4?: string; methodBrand?: string;
      maskedPhone?: string;
    },
  ) {
    const intent = await this.prisma.paymentIntent.findUnique({
      where:  { id: intentId },
      select: {
        id: true, tenantId: true, entityType: true, entityId: true,
        amount: true, currency: true, metadata: true, method: true,
      },
    });
    if (!intent) return;

    const type = status === 'SUCCEEDED'
      ? EventTypes.PAYMENT_INTENT_SUCCEEDED
      : EventTypes.PAYMENT_INTENT_FAILED;

    // Enrichissement mobile money : les providers MTN/Airtel/Wave ne remplissent
    // pas `customerRef` / `maskedPhone` dans leur PaymentResult (le webhook PSP
    // n'écho pas le téléphone). On les déduit du `customerPhone` stocké dans
    // la metadata de l'intent lors de createIntent(). Sans ça, la tokenisation
    // mobile money est perdue — impossible de sauvegarder le moyen pour auto-renew.
    const meta = (intent.metadata ?? {}) as Record<string, unknown>;
    const fallbackCustomerRef =
      intent.method === 'MOBILE_MONEY' && typeof meta.customerPhone === 'string'
        ? stripPhone(meta.customerPhone)
        : undefined;
    const fallbackMaskedPhone =
      intent.method === 'MOBILE_MONEY' && typeof meta.customerPhoneMask === 'string'
        ? meta.customerPhoneMask
        : undefined;
    const enrichedTokenization = tokenization || fallbackCustomerRef || fallbackMaskedPhone
      ? {
          customerRef: tokenization?.customerRef ?? fallbackCustomerRef,
          methodToken: tokenization?.methodToken,
          methodLast4: tokenization?.methodLast4,
          methodBrand: tokenization?.methodBrand,
          maskedPhone: tokenization?.maskedPhone ?? fallbackMaskedPhone,
        }
      : undefined;

    // EventEmitter2 en mode fire-and-forget — les handlers sont `@OnEvent`
    // et n'interrompent JAMAIS le flux webhook. Un handler qui lève est logué
    // mais l'orchestrator retourne 200 au provider (évite les retry inutiles).
    this.events.emit(type, {
      tenantId:     intent.tenantId,
      intentId:     intent.id,
      entityType:   intent.entityType,
      entityId:     intent.entityId,
      amount:       intent.amount,
      currency:     intent.currency,
      metadata:     intent.metadata,
      // Tokenisation provider — vide si ni PSP ni intent.metadata n'ont fourni
      tokenization: enrichedTokenization && (
        enrichedTokenization.customerRef || enrichedTokenization.methodToken || enrichedTokenization.maskedPhone
      ) ? enrichedTokenization : undefined,
    });
    this.log.debug(
      `[events] emitted ${type} for intent=${intent.id}` +
      `${enrichedTokenization?.methodToken ? ' (tokenized card)' : ''}` +
      `${enrichedTokenization?.maskedPhone && !enrichedTokenization?.methodToken ? ' (tokenized momo)' : ''}`,
    );
  }
}

/**
 * Masque un numéro pour affichage : `+242 06 123 45 67` → `+242 •• ••• 4567`.
 * Conserve le préfixe pays et les 4 derniers chiffres, obfusque le reste.
 */
function maskPhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.length < 6) return digits;
  const last4 = digits.slice(-4);
  const prefix = digits.startsWith('+') ? digits.slice(0, 4) : digits.slice(0, 3);
  return `${prefix} ••••• ${last4}`;
}

/** Retire le + et les non-chiffres pour obtenir un MSISDN pur (clef customerRef). */
function stripPhone(phone: string): string {
  return phone.replace(/^\+/, '').replace(/\D/g, '');
}

// ─── Tables de transition (exportées pour tests) ─────────────────────────────

export function mapProviderStatusToAttempt(s: PaymentStatus): string {
  switch (s) {
    case 'SUCCESSFUL': return 'SUCCESSFUL';
    case 'FAILED':     return 'FAILED';
    case 'CANCELLED':  return 'CANCELLED';
    case 'REVERSED':   return 'REVERSED';
    case 'PENDING':
    default:           return 'PENDING';
  }
}

export function deriveIntentStatusFromProvider(s: PaymentStatus): string {
  switch (s) {
    case 'SUCCESSFUL': return 'SUCCEEDED';
    case 'FAILED':     return 'FAILED';
    case 'CANCELLED':  return 'CANCELLED';
    case 'REVERSED':   return 'REFUNDED';
    case 'PENDING':
    default:           return 'PROCESSING';
  }
}

/**
 * Règles de transition côté Intent.
 * Retourne false pour tenter d'éviter les régressions (ex. SUCCEEDED → PROCESSING).
 */
export function isIntentTransitionAllowed(from: string, to: string): boolean {
  if (from === to) return false;
  const terminal = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'EXPIRED']);
  // Depuis un état terminal, on n'accepte que les refunds (gérés ailleurs).
  if (terminal.has(from) && !['REFUNDED', 'PARTIALLY_REFUNDED'].includes(to)) return false;
  return true;
}
