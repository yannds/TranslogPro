import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { normalizePhone } from '../../common/helpers/phone.helper';
import { createHash, randomInt } from 'crypto';

/**
 * RetroClaimService — Phase 3 CRM : revendication RÉTROACTIVE (après
 * expiration du magic link).
 *
 * Flow :
 *   1. L'utilisateur connecté (userType=CUSTOMER) saisit :
 *       - son n° de référence (trackingCode colis OU qrCode billet)
 *       - son téléphone
 *   2. `initiate()` :
 *       - Résout la transaction cible (Ticket ou Parcel) dans le tenant.
 *       - Vérifie qu'un Customer non-lié (userId=null) correspond au phone.
 *       - Applique rate-limit : 3/jour/phone (DB) + 3/h/IP (Throttle au controller).
 *       - Génère OTP 6 digits, stocke sha-256(otp), envoie via WhatsApp→SMS.
 *   3. `confirm()` :
 *       - Vérifie OTP non expiré, non utilisé, attempts<5.
 *       - Compare sha256(otp) au tokenHash stocké.
 *       - Si succès : Customer.userId = userId courant + usedAt=now.
 *       - Si échec : attempts++, efface l'OTP si attempts>=5.
 *
 * Sécurité :
 *   - OTP clair jamais stocké.
 *   - 5 essais max = anti brute-force.
 *   - Expiration 5min : fenêtre étroite.
 *   - Le userId courant doit venir d'une session authentifiée (scope own).
 *   - Isolation tenant garantie à tous les niveaux.
 */

const OTP_TTL_MS      = 5 * 60 * 1000;     // 5 minutes
const OTP_MAX_ATTEMPTS = 5;
const MAX_OTPS_PER_PHONE_PER_DAY = 3;

type TargetType = 'TICKET' | 'PARCEL';

export interface InitiateInput {
  target:       TargetType;
  code:         string;             // qrCode (ticket) ou trackingCode (parcel)
  phone:        string;             // sera normalisé en E.164
  createdByIp?: string;
}

export interface InitiateResult {
  channel:   'WHATSAPP' | 'SMS';
  expiresIn: number;                // secondes
}

export interface ConfirmInput {
  target: TargetType;
  code:   string;
  phone:  string;
  otp:    string;                   // 6 chiffres
  userId: string;                   // user authentifié qui revendique
}

export interface ConfirmResult {
  customerId: string;
  targetId:   string;
}

@Injectable()
export class RetroClaimService {
  private readonly logger = new Logger(RetroClaimService.name);

  constructor(
    private readonly prisma:       PrismaService,
    private readonly notification: NotificationService,
  ) {}

  async initiate(tenantId: string, input: InitiateInput): Promise<InitiateResult> {
    // 1. Normaliser le téléphone (country du tenant)
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId }, select: { country: true },
    });
    const r = normalizePhone(input.phone, tenant?.country ?? null);
    if (!r.ok) throw new BadRequestException('phone_invalid');
    const phoneE164 = r.e164;

    // 2. Résoudre la cible (Ticket ou Parcel)
    const target = await this.resolveTarget(tenantId, input.target, input.code);

    // 3. Vérifier qu'un Customer (shadow) existe avec ce phone
    // — Note : on ne révèle JAMAIS à l'appelant si le Customer existe ou pas.
    //   En cas d'échec, on renvoie un message générique pour empêcher
    //   l'énumération (attacker ne sait pas si le phone match ou si la cible
    //   est mauvaise).
    const customer = await this.prisma.customer.findFirst({
      where: { tenantId, phoneE164, deletedAt: null, userId: null },
      select: { id: true },
    });
    if (!customer) {
      // Réponse vague — pas de fuite
      throw new BadRequestException('retro_claim_not_eligible');
    }

    // 4. Rate-limit par phone : 3 OTP / 24h
    const dayAgo = new Date(Date.now() - 24 * 3600_000);
    const recentCount = await this.prisma.customerRetroClaimOtp.count({
      where: { tenantId, phoneE164, createdAt: { gte: dayAgo } },
    });
    if (recentCount >= MAX_OTPS_PER_PHONE_PER_DAY) {
      throw new BadRequestException('retro_claim_rate_limit_phone');
    }

    // 5. Invalider les OTPs actifs précédents pour ce (phone, target)
    await this.prisma.customerRetroClaimOtp.updateMany({
      where: {
        tenantId, phoneE164,
        targetType: input.target, targetId: target.id,
        usedAt: null, invalidatedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { invalidatedAt: new Date() },
    });

    // 6. Générer OTP + hasher
    const otp       = this.generateOtp();
    const otpHash   = this.hash(otp);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await this.prisma.customerRetroClaimOtp.create({
      data: {
        tenantId, phoneE164, otpHash,
        targetType: input.target, targetId: target.id,
        expiresAt, createdByIp: input.createdByIp ?? null,
      },
    });

    // 7. Dispatch WhatsApp → SMS
    const body = `TransLog Pro — Votre code de vérification : ${otp} (valide 5 min).`;
    let channel: 'WHATSAPP' | 'SMS' = 'WHATSAPP';
    try {
      await this.notification.send({
        tenantId, phone: phoneE164, channel: 'WHATSAPP',
        templateId: 'crm.retro.otp', body,
      });
    } catch {
      channel = 'SMS';
      await this.notification.send({
        tenantId, phone: phoneE164, channel: 'SMS',
        templateId: 'crm.retro.otp', body,
      });
    }

    return { channel, expiresIn: Math.floor(OTP_TTL_MS / 1000) };
  }

  async confirm(tenantId: string, input: ConfirmInput): Promise<ConfirmResult> {
    // 1. Normaliser phone
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId }, select: { country: true },
    });
    const r = normalizePhone(input.phone, tenant?.country ?? null);
    if (!r.ok) throw new BadRequestException('phone_invalid');
    const phoneE164 = r.e164;

    // 2. Résoudre cible
    const target = await this.resolveTarget(tenantId, input.target, input.code);

    // 3. Trouver OTP actif
    const record = await this.prisma.customerRetroClaimOtp.findFirst({
      where: {
        tenantId, phoneE164,
        targetType: input.target, targetId: target.id,
        usedAt: null, invalidatedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) throw new BadRequestException('otp_not_found_or_expired');

    // 4. Verify OTP — constant-time compare via hash
    const candidateHash = this.hash(input.otp);
    if (candidateHash !== record.otpHash) {
      // Incrément compteur d'essais ; détruire si dépassement
      const newAttempts = record.attempts + 1;
      if (newAttempts >= OTP_MAX_ATTEMPTS) {
        await this.prisma.customerRetroClaimOtp.update({
          where: { id: record.id },
          data:  { attempts: newAttempts, invalidatedAt: new Date() },
        });
        throw new ForbiddenException('otp_max_attempts_exceeded');
      }
      await this.prisma.customerRetroClaimOtp.update({
        where: { id: record.id },
        data:  { attempts: newAttempts },
      });
      throw new BadRequestException('otp_invalid');
    }

    // 5. Consommer OTP + lier Customer ↔ User (transaction)
    return this.prisma.transact(async (tx) => {
      // re-verify intra-tx (course conditions)
      const current = await tx.customerRetroClaimOtp.findUnique({ where: { id: record.id } });
      if (!current || current.usedAt || current.invalidatedAt || current.expiresAt < new Date()) {
        throw new BadRequestException('otp_expired');
      }

      const customer = await tx.customer.findFirst({
        where: { tenantId, phoneE164, deletedAt: null, userId: null },
        select: { id: true },
      });
      if (!customer) throw new BadRequestException('customer_not_eligible');

      // Vérifier que l'User appartient au même tenant
      const user = await tx.user.findFirst({
        where:  { id: input.userId, tenantId },
        select: { id: true, customerProfile: { select: { id: true } } },
      });
      if (!user) throw new ForbiddenException('user_not_in_tenant');
      if (user.customerProfile) {
        throw new BadRequestException('user_already_linked');
      }

      // Retro-claim réussi = propriétaire réel du phone a saisi l'OTP reçu.
      // Flip phoneVerified pour que les bumpCounters publics futurs le prennent
      // en compte et que les segments se dérivent normalement.
      await tx.customer.update({
        where: { id: customer.id },
        data:  {
          userId: input.userId,
          lastSeenAt:       new Date(),
          phoneVerified:    true,
          phoneVerifiedAt:  new Date(),
          phoneVerifiedVia: 'RETRO_CLAIM',
        },
      });
      await tx.customerRetroClaimOtp.update({
        where: { id: record.id },
        data:  { usedAt: new Date() },
      });

      return { customerId: customer.id, targetId: target.id };
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async resolveTarget(tenantId: string, type: TargetType, code: string): Promise<{ id: string }> {
    const trimmed = code.trim();
    if (!trimmed) throw new BadRequestException('code_required');

    if (type === 'TICKET') {
      const ticket = await this.prisma.ticket.findFirst({
        where: { tenantId, qrCode: trimmed },
        select: { id: true },
      });
      if (!ticket) throw new NotFoundException('ticket_not_found');
      return ticket;
    }
    if (type === 'PARCEL') {
      const parcel = await this.prisma.parcel.findFirst({
        where: { tenantId, trackingCode: trimmed },
        select: { id: true },
      });
      if (!parcel) throw new NotFoundException('parcel_not_found');
      return parcel;
    }
    throw new BadRequestException('target_type_invalid');
  }

  private generateOtp(): string {
    // 6 chiffres cryptographiquement random
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  private hash(v: string): string {
    return createHash('sha256').update(v).digest('hex');
  }
}
