import {
  Injectable,
  Logger,
  Inject,
  ForbiddenException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { createHmac, createHash, timingSafeEqual, randomUUID, randomBytes } from 'crypto';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { ISecretService, SECRET_SERVICE } from '../../../infrastructure/secret/interfaces/secret.interface';
import { PLATFORM_TENANT_ID } from '../guards/permission.guard';
import { HostConfigService } from '../../tenancy';

/**
 * Durée de vie d'une session d'impersonation JIT.
 * 15 minutes — non-renouvelable, aligné sur les standards PIM/PAM.
 */
const SESSION_TTL_MS = 15 * 60 * 1_000;

/**
 * Vault path de la clé HMAC plateforme pour signer les tokens d'impersonation.
 * Clé distincte des clés HMAC tenant (QrService) — rotation indépendante.
 */
const VAULT_KEY_PATH = 'platform/impersonation_key';

export interface ImpersonationTokenPayload {
  sessionId:      string;
  actorId:        string;
  actorTenantId:  string;   // toujours PLATFORM_TENANT_ID
  targetTenantId: string;
  iat:            number;   // unix ms
  exp:            number;   // unix ms
}

export interface ImpersonationContext {
  sessionId:      string;
  targetTenantId: string;
  actorId:        string;
  actorTenantId:  string;
}

/**
 * ImpersonationService — mécanisme JIT de switch de session (PRD §IV.12)
 *
 * Architecture :
 *   1. L'agent SA/Support (tenant 00000000-...) appelle switchSession(targetTenantId).
 *   2. Ce service génère un token signé HMAC-SHA256 (clé Vault platform).
 *   3. Le token est retourné au client ET un hash SHA-256 est stocké en DB
 *      (ImpersonationSession) pour permettre la révocation et l'audit.
 *   4. Sur les requêtes suivantes, le client envoie le token via X-Impersonation-Token.
 *   5. ImpersonationGuard valide le token et injecte req.impersonation.
 *   6. PermissionGuard lit req.impersonation.targetTenantId pour le ScopeContext.
 *   7. RlsMiddleware utilise TenantContextService → SET LOCAL app.tenant_id = targetTenantId.
 *
 * Sécurité :
 *   - Token non-stocké en clair (hash SHA-256 uniquement).
 *   - Comparaison de signature en temps constant (timingSafeEqual).
 *   - Expiration 15min non-renouvelable.
 *   - Révocation immédiate possible (revokeSession).
 *   - Chaque début/fin de session est loggé en AuditLog level=critical.
 *   - L'acteur DOIT posséder control.impersonation.switch.global (vérifié par ImpersonationGuard).
 */
@Injectable()
export class ImpersonationService {
  private readonly logger = new Logger(ImpersonationService.name);

  // Cache mémoire de la clé Vault — TTL 5min (aligné sur QrService)
  private cachedKey: { value: string; cachedAt: number } | null = null;
  private readonly KEY_TTL_MS = 5 * 60 * 1_000;

  constructor(
    private readonly prisma:        PrismaService,
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
    private readonly hostConfig:    HostConfigService,
  ) {}

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Crée une session d'impersonation JIT.
   * À appeler uniquement après validation par ImpersonationGuard.
   *
   * @returns Le token signé (à transmettre au client — ne sera plus récupérable)
   */
  async switchSession(
    actorId:        string,
    targetTenantId: string,
    meta: {
      reason?:    string;
      ipAddress?: string;
      userAgent?: string;
    },
  ): Promise<{
    token:       string;
    sessionId:   string;
    expiresAt:   Date;
    /**
     * URL de redirection vers le sous-domaine du tenant cible pour échanger
     * le token contre un cookie de session scopé. Permet au super-admin de
     * basculer sur admin.translogpro.com → {target}.translogpro.com sans
     * pollution du cookie admin. Phase 2 cross-subdomain.
     */
    redirectUrl: string;
    /** Slug du tenant cible (utile pour le frontend à afficher). */
    targetSlug:  string;
  }> {
    // Vérifier que le tenant cible existe et est actif
    const targetTenant = await this.prisma.tenant.findFirst({
      where: { id: targetTenantId, isActive: true },
    });
    if (!targetTenant) {
      throw new NotFoundException(`Tenant "${targetTenantId}" introuvable ou inactif`);
    }

    // Empêcher l'impersonation du tenant plateforme lui-même
    if (targetTenantId === PLATFORM_TENANT_ID) {
      throw new ForbiddenException(
        'Impossible d\'impersoner le tenant plateforme',
      );
    }

    const sessionId = randomUUID();
    const now       = Date.now();
    const expiresAt = new Date(now + SESSION_TTL_MS);

    const payload: ImpersonationTokenPayload = {
      sessionId,
      actorId,
      actorTenantId:  PLATFORM_TENANT_ID,
      targetTenantId,
      iat:            now,
      exp:            now + SESSION_TTL_MS,
    };

    const token     = await this.signPayload(payload);
    const tokenHash = this.hashToken(token);

    await this.prisma.impersonationSession.create({
      data: {
        id:             sessionId,
        actorId,
        actorTenantId:  PLATFORM_TENANT_ID,
        targetTenantId,
        token:          `ref:${sessionId}`, // référence opaque — token non stocké en clair
        tokenHash,
        status:         'ACTIVE',
        reason:         meta.reason,
        ipAddress:      meta.ipAddress,
        userAgent:      meta.userAgent,
        expiresAt,
      },
    });

    // Audit critique — création de session
    await this.writeAuditLog({
      actorId,
      targetTenantId,
      action:    'control.impersonation.switch.global',
      resource:  `ImpersonationSession:${sessionId}`,
      level:     'critical',
      ipAddress: meta.ipAddress,
      detail:    { sessionId, targetTenantId, reason: meta.reason ?? null },
    });

    this.logger.warn(
      `[IMPERSONATION START] actor=${actorId} target=${targetTenantId} session=${sessionId}`,
    );

    // Phase 2 : URL de redirect cross-subdomain que le frontend admin va charger.
    // Le target échangera le token contre un cookie de session local.
    const redirectUrl = this.hostConfig.buildTenantUrl(
      targetTenant.slug,
      `/api/auth/impersonate/exchange?token=${encodeURIComponent(token)}`,
    );

    return {
      token,
      sessionId,
      expiresAt,
      redirectUrl,
      targetSlug: targetTenant.slug,
    };
  }

  /**
   * Phase 2 cross-subdomain — échange un token d'impersonation contre une
   * Session DB utilisable via cookie sur le sous-domaine du tenant cible.
   *
   * One-shot : une seconde tentative avec le même token est rejetée.
   *
   * Appelé par `GET /api/auth/impersonate/exchange?token=X` sur le sous-domaine
   * `{targetSlug}.translogpro.com`. Le controller pose ensuite le cookie
   * `translog_session` scopé à ce host.
   *
   * @throws UnauthorizedException si token invalide/expiré/déjà échangé
   */
  async exchangeTokenForSession(
    rawToken:  string,
    ipAddress: string,
    userAgent: string,
  ): Promise<{
    sessionToken: string;
    sessionExpiresAt: Date;
    actorId: string;
    targetTenantId: string;
    sessionId: string;
  }> {
    // 1. Vérifier signature + DB session (réutilise verifyToken)
    const ctx = await this.verifyToken(rawToken);

    // 2. Charger la ligne DB pour checker exchangedAt et setter atomiquement
    const tokenHash = this.hashToken(rawToken);

    // 3. Update atomique : si exchangedAt est NULL, le passer à NOW et verrouiller.
    //    Sinon, updateMany retourne count=0 et on throw.
    const newSessionToken = randomBytes(32).toString('hex');
    const SESSION_TTL_MS_LOCAL = 15 * 60 * 1_000; // aligné sur ImpersonationSession TTL
    const newSessionExpiresAt  = new Date(Date.now() + SESSION_TTL_MS_LOCAL);

    const { count } = await this.prisma.impersonationSession.updateMany({
      where: {
        tokenHash,
        status:     'ACTIVE',
        exchangedAt: null,
        expiresAt:  { gt: new Date() },
      },
      data: {
        exchangedAt:           new Date(),
        exchangedSessionToken: newSessionToken,
        status:                'EXCHANGED',
      },
    });

    if (count === 0) {
      // Soit déjà échangé, soit révoqué, soit expiré entre-temps
      throw new UnauthorizedException(
        'Token d\'impersonation déjà utilisé, révoqué ou expiré',
      );
    }

    // 4. Créer la Session utilisable côté tenant cible
    //    tenantId = target. userId = actor (l'acteur IMPERSONE le tenant cible
    //    mais reste identifié comme lui-même — les logs d'audit et le guard
    //    d'impersonation continuent de voir l'acteur original).
    await this.prisma.session.create({
      data: {
        userId:    ctx.actorId,
        tenantId:  ctx.targetTenantId,
        token:     newSessionToken,
        expiresAt: newSessionExpiresAt,
        ipAddress,
        userAgent,
      },
    });

    await this.writeAuditLog({
      actorId:        ctx.actorId,
      targetTenantId: ctx.targetTenantId,
      action:         'control.impersonation.exchange.global',
      resource:       `ImpersonationSession:${ctx.sessionId}`,
      level:          'critical',
      ipAddress,
      detail: {
        sessionId:      ctx.sessionId,
        targetTenantId: ctx.targetTenantId,
        newSessionIssued: true,
      },
    });

    this.logger.warn(
      `[IMPERSONATION EXCHANGE] actor=${ctx.actorId} target=${ctx.targetTenantId} ` +
      `session=${ctx.sessionId} → cookie-scoped session créée`,
    );

    return {
      sessionToken:     newSessionToken,
      sessionExpiresAt: newSessionExpiresAt,
      actorId:          ctx.actorId,
      targetTenantId:   ctx.targetTenantId,
      sessionId:        ctx.sessionId,
    };
  }

  /**
   * Valide un token d'impersonation entrant.
   * Appelé par ImpersonationGuard sur chaque requête avec X-Impersonation-Token.
   *
   * @throws UnauthorizedException si token invalide, expiré ou révoqué
   */
  async verifyToken(rawToken: string): Promise<ImpersonationContext> {
    const payload = await this.verifySignature(rawToken);

    // Vérification temporelle (double-check — payload.exp est déjà dans la signature)
    if (Date.now() > payload.exp) {
      throw new UnauthorizedException('Session d\'impersonation expirée');
    }

    // Vérification DB — session non révoquée
    const tokenHash = this.hashToken(rawToken);
    const session   = await this.prisma.impersonationSession.findUnique({
      where: { tokenHash },
    });

    if (!session) {
      throw new UnauthorizedException('Session d\'impersonation introuvable');
    }

    if (session.status !== 'ACTIVE') {
      throw new UnauthorizedException(
        `Session d\'impersonation ${session.status.toLowerCase()}`,
      );
    }

    if (new Date() > session.expiresAt) {
      // Mettre à jour le statut si TTL dépassé mais pas encore marqué
      await this.prisma.impersonationSession.update({
        where: { id: session.id },
        data:  { status: 'EXPIRED' },
      });
      throw new UnauthorizedException('Session d\'impersonation expirée');
    }

    return {
      sessionId:      session.id,
      targetTenantId: session.targetTenantId,
      actorId:        session.actorId,
      actorTenantId:  session.actorTenantId,
    };
  }

  /**
   * Révoque une session d'impersonation active.
   * Peut être appelé par l'acteur lui-même ou par un SUPER_ADMIN (L2+).
   */
  async revokeSession(
    sessionId:   string,
    revokedById: string,
    ipAddress?:  string,
  ): Promise<void> {
    const session = await this.prisma.impersonationSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException(`Session "${sessionId}" introuvable`);
    }

    if (session.status !== 'ACTIVE') {
      // Idempotent — déjà terminée
      return;
    }

    await this.prisma.impersonationSession.update({
      where: { id: sessionId },
      data: {
        status:    'REVOKED',
        revokedAt: new Date(),
        revokedBy: revokedById,
      },
    });

    await this.writeAuditLog({
      actorId:       revokedById,
      targetTenantId: session.targetTenantId,
      action:        'control.impersonation.revoke.global',
      resource:      `ImpersonationSession:${sessionId}`,
      level:         'critical',
      ipAddress,
      detail:        { sessionId, originalActor: session.actorId, revokedBy: revokedById },
    });

    this.logger.warn(
      `[IMPERSONATION REVOKE] session=${sessionId} by=${revokedById} target=${session.targetTenantId}`,
    );
  }

  /**
   * Liste les sessions actives pour un tenant cible (admin/audit).
   */
  async listActiveSessions(targetTenantId: string) {
    return this.prisma.impersonationSession.findMany({
      where: {
        targetTenantId,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
      select: {
        id:             true,
        actorId:        true,
        targetTenantId: true,
        reason:         true,
        ipAddress:      true,
        createdAt:      true,
        expiresAt:      true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── Token helpers ───────────────────────────────────────────────────────────

  private async signPayload(payload: ImpersonationTokenPayload): Promise<string> {
    const key  = await this.getPlatformKey();
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig  = createHmac('sha256', key).update(data).digest('hex');
    return `${data}.${sig}`;
  }

  private async verifySignature(token: string): Promise<ImpersonationTokenPayload> {
    const dot = token.lastIndexOf('.');
    if (dot === -1) throw new UnauthorizedException('Format de token invalide');

    const data = token.slice(0, dot);
    const sig  = token.slice(dot + 1);

    const key      = await this.getPlatformKey();
    const expected = createHmac('sha256', key).update(data).digest('hex');

    const sigBuf = Buffer.from(sig,      'hex');
    const expBuf = Buffer.from(expected, 'hex');

    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new UnauthorizedException('Signature du token d\'impersonation invalide');
    }

    try {
      return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as ImpersonationTokenPayload;
    } catch {
      throw new UnauthorizedException('Payload du token corrompu');
    }
  }

  /**
   * SHA-256 du token brut — utilisé comme clé de lookup pour la révocation.
   * Ne stocke jamais le token en clair en DB.
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async getPlatformKey(): Promise<string> {
    if (this.cachedKey && Date.now() - this.cachedKey.cachedAt < this.KEY_TTL_MS) {
      return this.cachedKey.value;
    }

    const secret = await this.secretService.getSecretObject<{ KEY: string }>(VAULT_KEY_PATH);

    if (!secret.KEY || secret.KEY.length < 32) {
      throw new Error('Clé d\'impersonation insuffisante — minimum 32 caractères (Vault)');
    }

    this.cachedKey = { value: secret.KEY, cachedAt: Date.now() };
    return secret.KEY;
  }

  // ─── Audit helper ────────────────────────────────────────────────────────────

  private async writeAuditLog(params: {
    actorId:        string;
    targetTenantId: string;
    action:         string;
    resource:       string;
    level:          string;
    ipAddress?:     string;
    detail:         Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId:    params.actorId,
          tenantId:  PLATFORM_TENANT_ID,  // log dans le tenant plateforme
          plane:     'control',
          level:     params.level,
          action:    params.action,
          resource:  params.resource,
          newValue:  params.detail as object,
          ipAddress: params.ipAddress,
        },
      });
    } catch (err) {
      // L'audit ne doit jamais bloquer l'opération principale
      this.logger.error(`[AuditLog] Failed to write impersonation audit: ${err}`);
    }
  }
}
