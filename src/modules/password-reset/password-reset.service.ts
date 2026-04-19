import {
  Injectable, Logger, BadRequestException,
  UnauthorizedException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuthIdentityService } from '../../core/identity/auth-identity.service';
import { HostConfigService } from '../../core/tenancy';

/** 30 minutes — suffisant pour cliquer le lien email, court pour limiter l'exposition. */
const RESET_TOKEN_TTL_MS = 30 * 60 * 1_000;
const RESET_TOKEN_BYTES  = 32; // 256 bits entropy

export interface InitiateByAdminResult {
  /** Lien complet à partager hors-bande (mode 'link'). Undefined en mode 'set'. */
  resetUrl?:  string;
  /** Token brut — à remettre à l'admin une seule fois (mode 'link'). */
  rawToken?:  string;
  /** TTL du token. */
  expiresAt?: Date;
  /** Email du user cible (confirmation). */
  email:      string;
  /** Mode appliqué. */
  mode:       'link' | 'set';
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma:     PrismaService,
    private readonly identity:   AuthIdentityService,
    private readonly hostConfig: HostConfigService,
  ) {}

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Construit l'URL de reset password scopée au sous-domaine tenant.
   * En Phase 1+, chaque tenant reçoit un lien qui pointe vers SON sous-domaine :
   *   https://{slug}.translogpro.com/auth/reset?token=...
   * Un même humain avec 2 comptes (2 tenants) reçoit donc 2 liens distincts,
   * ce qui évite toute ambiguïté ("quel compte réinitialise ce lien ?").
   */
  private buildResetUrl(rawToken: string, tenantSlug: string): string {
    return this.hostConfig.buildTenantUrl(
      tenantSlug,
      `/auth/reset?token=${encodeURIComponent(rawToken)}`,
    );
  }

  private async writeAuditLog(params: {
    tenantId: string; userId: string | null; actorId: string | null;
    action: string; level?: 'info' | 'warn'; ipAddress?: string; meta?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId:  params.tenantId,
          userId:    params.actorId ?? params.userId,
          plane:     'control',
          level:     params.level ?? 'info',
          action:    params.action,
          resource:  params.userId ? `User:${params.userId}` : 'User:anonymous',
          ipAddress: params.ipAddress,
          newValue:  params.meta as any,
        },
      });
    } catch (err) {
      this.logger.error('[PasswordReset] audit log write failed', err);
    }
  }

  // ─── Public API — self-service (forgot password) ─────────────────────────

  /**
   * Auto-service : un user clique "mot de passe oublié" → on crée un token
   * de reset si le compte existe. Réponse TOUJOURS générique (pas d'énumération).
   *
   * Appelé depuis la page publique /auth/forgot-password qui est servie SUR LE
   * SOUS-DOMAINE DU TENANT (ex: compagnieA.translogpro.com/auth/forgot-password).
   * Le controller extrait `tenantId + slug` depuis req.resolvedHostTenant et les
   * passe ici — c'est le seul endroit qui connaît le bon scope.
   *
   * Le caller (controller) applique un rate-limit strict par IP + email.
   */
  async initiateBySelf(
    tenantId:   string,
    tenantSlug: string,
    email:      string,
    ipAddress:  string,
  ): Promise<void> {
    const account = await this.identity.findCredentialAccount(tenantId, email);

    if (!account || !account.user.isActive) {
      // Ne pas révéler l'inexistence du compte — réponse générique
      this.logger.debug(`[PasswordReset] self-service on unknown/inactive email=${email} tenant=${tenantId}`);
      return;
    }

    const rawToken   = randomBytes(RESET_TOKEN_BYTES).toString('hex');
    const tokenHash  = this.hashToken(rawToken);
    const expiresAt  = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await this.prisma.account.update({
      where: { id: account.id },
      data:  {
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: expiresAt,
      },
    });

    const resetUrl = this.buildResetUrl(rawToken, tenantSlug);

    // Email stub — NotificationService dispatchera quand l'EMAIL channel sera
    // câblé (Resend/SendGrid). En attendant on logge pour traçabilité.
    this.logger.log(
      `[PasswordReset] self-service link issued user=${account.user.id} ` +
      `email=${email} tenant=${tenantId} expiresAt=${expiresAt.toISOString()} link=${resetUrl}`,
    );

    await this.writeAuditLog({
      tenantId: account.user.tenantId,
      userId:   account.user.id,
      actorId:  account.user.id,
      action:   'auth.password_reset.request.self',
      ipAddress,
      meta:     { email, expiresAt: expiresAt.toISOString() },
    });
  }

  // ─── Public API — admin-initiated ────────────────────────────────────────

  /**
   * Admin initie une réinitialisation pour un user de son tenant.
   * Deux modes :
   *   - 'link' : on génère un token, on retourne l'URL pour l'admin (à transmettre)
   *   - 'set'  : l'admin fournit un mot de passe ; on l'applique + force rotation
   *
   * Garde-fous :
   *   - userId doit appartenir au même tenant que l'actor
   *   - actor ne peut pas reset son propre compte (passer par self-service)
   */
  /**
   * Variante cross-tenant réservée au staff plateforme (SUPER_ADMIN, SUPPORT_L2).
   * Même logique que `initiateByAdmin` mais SANS le filtre `tenantId: actorTenantId` :
   * le target peut vivre dans n'importe quel tenant. Son `tenantId` est résolu
   * automatiquement. L'actor vit typiquement sur le tenant plateforme.
   *
   * Garde-fou : on refuse toujours que l'actor se reset lui-même (→ forgot-password).
   */
  async initiateByPlatformAdmin(params: {
    actorId:      string;
    targetUserId: string;
    mode:         'link' | 'set';
    newPassword?: string;
    ipAddress:    string;
  }): Promise<InitiateByAdminResult> {
    if (params.actorId === params.targetUserId) {
      throw new ForbiddenException(
        'Utilisez la fonction "mot de passe oublié" pour votre propre compte',
      );
    }

    const target = await this.prisma.user.findUnique({
      where:  { id: params.targetUserId },
      select: {
        id: true, email: true, tenantId: true, isActive: true,
        tenant: { select: { slug: true } },
      },
    });
    if (!target) throw new NotFoundException('Utilisateur introuvable');

    // Délègue au flow standard en imitant un actor "du tenant du target"
    // — cette route tire l'autorisation du PermissionGuard global amont, pas
    // du check (actorTenantId ?= target.tenantId) de initiateByAdmin.
    return this.initiateByAdminCrossTenant({
      actorId:      params.actorId,
      targetUserId: params.targetUserId,
      targetUserTenantId: target.tenantId,
      mode:         params.mode,
      newPassword:  params.newPassword,
      ipAddress:    params.ipAddress,
    });
  }

  /**
   * Implémentation partagée — ne vérifie pas actor vs tenant. Utilisé par
   * `initiateByAdmin` (après check tenant match) ET `initiateByPlatformAdmin`
   * (où la permission .global fait autorité). Ne pas exposer publiquement.
   */
  private async initiateByAdminCrossTenant(params: {
    actorId:            string;
    targetUserId:       string;
    targetUserTenantId: string;
    mode:               'link' | 'set';
    newPassword?:       string;
    ipAddress:          string;
  }): Promise<InitiateByAdminResult> {
    const target = await this.prisma.user.findFirst({
      where:  { id: params.targetUserId, tenantId: params.targetUserTenantId },
      select: {
        id: true, email: true, tenantId: true, isActive: true,
        tenant: { select: { slug: true } },
      },
    });
    if (!target) throw new NotFoundException('Utilisateur introuvable');

    const account = await this.prisma.account.findFirst({
      where:  { userId: target.id, providerId: 'credential' },
      select: { id: true },
    });
    if (!account) {
      throw new BadRequestException(
        'Ce compte ne possède pas d\'identifiants — impossible de réinitialiser',
      );
    }

    if (params.mode === 'set') {
      if (!params.newPassword) throw new BadRequestException('Mot de passe requis en mode "set"');
      const hash = await bcrypt.hash(params.newPassword, 12);
      await this.prisma.account.update({
        where: { id: account.id },
        data:  {
          password: hash,
          passwordResetTokenHash: null,
          passwordResetExpiresAt: null,
          forcePasswordChange:    true,
        },
      });
      await this.prisma.session.deleteMany({ where: { userId: target.id } });
      await this.writeAuditLog({
        tenantId: target.tenantId,
        userId:   target.id,
        actorId:  params.actorId,
        action:   'auth.password_reset.platform.set',
        level:    'warn',
        ipAddress: params.ipAddress,
        meta:     { email: target.email, forcedRotation: true, crossTenant: true },
      });
      return { email: target.email, mode: 'set' };
    }

    const rawToken  = randomBytes(RESET_TOKEN_BYTES).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await this.prisma.account.update({
      where: { id: account.id },
      data:  { passwordResetTokenHash: tokenHash, passwordResetExpiresAt: expiresAt },
    });
    const resetUrl = this.buildResetUrl(rawToken, target.tenant.slug);
    await this.writeAuditLog({
      tenantId: target.tenantId,
      userId:   target.id,
      actorId:  params.actorId,
      action:   'auth.password_reset.platform.link',
      level:    'warn',
      ipAddress: params.ipAddress,
      meta:     { email: target.email, expiresAt: expiresAt.toISOString(), crossTenant: true },
    });
    return { email: target.email, mode: 'link', rawToken, resetUrl, expiresAt };
  }

  async initiateByAdmin(params: {
    actorTenantId: string;
    actorId:       string;
    targetUserId:  string;
    mode:          'link' | 'set';
    newPassword?:  string;
    ipAddress:     string;
  }): Promise<InitiateByAdminResult> {
    if (params.actorId === params.targetUserId) {
      throw new ForbiddenException(
        'Utilisez la fonction "mot de passe oublié" pour votre propre compte',
      );
    }

    const target = await this.prisma.user.findFirst({
      where:  { id: params.targetUserId, tenantId: params.actorTenantId },
      select: {
        id: true, email: true, tenantId: true, isActive: true,
        tenant: { select: { slug: true } },
      },
    });
    if (!target) {
      throw new NotFoundException('Utilisateur introuvable dans ce tenant');
    }

    const account = await this.prisma.account.findFirst({
      where:  { userId: target.id, providerId: 'credential' },
      select: { id: true },
    });
    if (!account) {
      throw new BadRequestException(
        'Ce compte ne possède pas d\'identifiants — impossible de réinitialiser',
      );
    }

    // ── Mode "set" : application immédiate d'un mot de passe ──────────────
    if (params.mode === 'set') {
      if (!params.newPassword) {
        throw new BadRequestException('Mot de passe requis en mode "set"');
      }
      const hash = await bcrypt.hash(params.newPassword, 12);
      await this.prisma.account.update({
        where: { id: account.id },
        data:  {
          password: hash,
          passwordResetTokenHash: null,
          passwordResetExpiresAt: null,
          forcePasswordChange:    true,
        },
      });
      // Invalider toutes les sessions actives du user (scoped au tenant —
      // un même userId ne doit jamais avoir de sessions cross-tenant, mais
      // defense in depth).
      await this.prisma.session.deleteMany({ where: { userId: target.id, tenantId: target.tenantId } });

      await this.writeAuditLog({
        tenantId: target.tenantId,
        userId:   target.id,
        actorId:  params.actorId,
        action:   'auth.password_reset.admin.set',
        level:    'warn',
        ipAddress: params.ipAddress,
        meta:     { email: target.email, forcedRotation: true },
      });

      return { email: target.email, mode: 'set' };
    }

    // ── Mode "link" : génération token + URL ──────────────────────────────
    const rawToken  = randomBytes(RESET_TOKEN_BYTES).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await this.prisma.account.update({
      where: { id: account.id },
      data:  {
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: expiresAt,
      },
    });

    const resetUrl = this.buildResetUrl(rawToken, target.tenant.slug);

    this.logger.log(
      `[PasswordReset] admin-issued link user=${target.id} actor=${params.actorId} ` +
      `email=${target.email} tenant=${target.tenant.slug} expiresAt=${expiresAt.toISOString()}`,
    );

    await this.writeAuditLog({
      tenantId: target.tenantId,
      userId:   target.id,
      actorId:  params.actorId,
      action:   'auth.password_reset.admin.link',
      level:    'warn',
      ipAddress: params.ipAddress,
      meta:     { email: target.email, expiresAt: expiresAt.toISOString() },
    });

    return {
      email:    target.email,
      mode:     'link',
      rawToken,
      resetUrl,
      expiresAt,
    };
  }

  // ─── Public API — complétion ─────────────────────────────────────────────

  /**
   * Vérifie le token, applique le nouveau mot de passe, invalide le token
   * (one-shot) et purge les sessions actives. Utilisé par la page publique
   * /auth/reset.
   */
  async complete(rawToken: string, newPassword: string, ipAddress: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);

    const account = await this.prisma.account.findUnique({
      where:   { passwordResetTokenHash: tokenHash },
      include: { user: { select: { id: true, tenantId: true, email: true, isActive: true } } },
    });

    if (!account || !account.passwordResetExpiresAt ||
        account.passwordResetExpiresAt < new Date()) {
      throw new UnauthorizedException('Lien invalide ou expiré');
    }

    if (!account.user.isActive) {
      throw new UnauthorizedException('Compte désactivé');
    }

    const hash = await bcrypt.hash(newPassword, 12);

    await this.prisma.$transaction([
      this.prisma.account.update({
        where: { id: account.id },
        data:  {
          password: hash,
          passwordResetTokenHash: null,
          passwordResetExpiresAt: null,
          forcePasswordChange:    false,
        },
      }),
      // Purger toutes les sessions actives — l'utilisateur doit se reconnecter
      this.prisma.session.deleteMany({ where: { userId: account.user.id, tenantId: account.user.tenantId } }),
    ]);

    await this.writeAuditLog({
      tenantId: account.user.tenantId,
      userId:   account.user.id,
      actorId:  account.user.id,
      action:   'auth.password_reset.complete',
      ipAddress,
      meta:     { email: account.user.email },
    });
  }

  // ─── Batch — plusieurs users (admin) ─────────────────────────────────────

  /**
   * Envoi en masse de liens de reset (mode 'link' uniquement).
   * Le mode 'set' en batch est volontairement INTERDIT — trop dangereux.
   */
  async initiateByAdminBatch(params: {
    actorTenantId: string;
    actorId:       string;
    targetUserIds: string[];
    ipAddress:     string;
  }): Promise<{
    results: Array<{ userId: string; email?: string; ok: boolean; reason?: string }>;
  }> {
    const results: Array<{ userId: string; email?: string; ok: boolean; reason?: string }> = [];

    for (const targetUserId of params.targetUserIds) {
      try {
        const res = await this.initiateByAdmin({
          actorTenantId: params.actorTenantId,
          actorId:       params.actorId,
          targetUserId,
          mode:          'link',
          ipAddress:     params.ipAddress,
        });
        results.push({ userId: targetUserId, email: res.email, ok: true });
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'unknown';
        results.push({ userId: targetUserId, ok: false, reason });
      }
    }

    return { results };
  }
}
