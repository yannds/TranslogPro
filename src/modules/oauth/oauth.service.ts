import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type {
  NormalizedOAuthProfile,
  OAuthAuthenticationResult,
  LinkingStrategy,
} from './types';
import { OAuthError } from './types';

/**
 * Le schema Account est tenant-scoped : l'unicité est `(tenantId, providerId,
 * accountId)`. Un même utilisateur peut donc avoir un compte chez plusieurs
 * tenants avec les mêmes credentials sociaux. L'OAuthService doit connaître
 * le tenantId cible AVANT de chercher — résolu depuis le state ou le host.
 */

const SESSION_TTL_MS  = 30 * 24 * 3600 * 1_000;
const SESSION_TOKEN_BYTES = 32;

/**
 * Stratégie de linking appliquée quand un profil OAuth arrive avec un
 * email qui correspond déjà à un User existant (créé via credential ou
 * un autre provider OAuth).
 *
 * Configurable via env OAUTH_LINKING_STRATEGY. Défaut : PROMPT (sécurité).
 */
function readLinkingStrategy(): LinkingStrategy {
  const v = (process.env.OAUTH_LINKING_STRATEGY ?? 'PROMPT').toUpperCase();
  if (v === 'AUTO_LINK_VERIFIED' || v === 'PROMPT' || v === 'DENY') return v;
  return 'PROMPT';
}

/**
 * OAuthService — cœur du flow : émission du state, callback, linking/login.
 *
 * Ne fait AUCUNE hypothèse sur le provider concret : reçoit un
 * NormalizedOAuthProfile et décide login / linking / refus selon la
 * stratégie configurée et l'existant en DB.
 */
@Injectable()
export class OAuthService {
  private readonly log = new Logger(OAuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * URL de callback ABSOLUE pour un provider donné. Le provider l'utilise
   * comme `redirect_uri` dans buildAuthorizeUrl ET dans l'échange du code.
   * Les deux valeurs DOIVENT être identiques (contrainte OAuth).
   */
  callbackUrl(providerKey: string): string {
    const base = (process.env.PUBLIC_APP_URL ?? '').replace(/\/$/, '');
    return `${base}/api/auth/oauth/${providerKey}/callback`;
  }

  /**
   * Résout un slug tenant en tenantId. Retourne null si inconnu.
   */
  async resolveTenantId(tenantSlug: string | undefined): Promise<string | null> {
    if (!tenantSlug) return null;
    const tenant = await this.prisma.tenant.findFirst({
      where:  { slug: tenantSlug },
      select: { id: true },
    });
    return tenant?.id ?? null;
  }

  /**
   * Étape 3 du flow : un profil normalisé arrive. On décide :
   *
   *   1. Y a-t-il déjà un Account(tenantId, providerId, providerAccountId) ?
   *      → oui → login immédiat (returning user). isNewLink=false.
   *
   *   2. Sinon, y a-t-il un User existant avec cet email dans ce tenant ?
   *      → non → USER_NOT_FOUND (pas de création silencieuse de compte).
   *      → oui → applique la stratégie de linking (AUTO/PROMPT/DENY).
   *
   * L'appelant (controller) gère les codes d'erreur pour rediriger vers
   * la bonne page front (ex: page de confirmation linking).
   */
  async authenticateOrLink(
    tenantId:  string,
    profile:   NormalizedOAuthProfile,
    ipAddress: string,
    userAgent: string,
  ): Promise<OAuthAuthenticationResult> {
    // Cas 1 — Account OAuth déjà lié (unicité tenant-scoped)
    const existingAccount = await this.prisma.account.findFirst({
      where: {
        tenantId,
        providerId: profile.providerKey,
        accountId:  profile.providerAccountId,
      },
    });

    if (existingAccount) {
      const user = await this.prisma.user.findFirst({
        where:  { id: existingAccount.userId, tenantId },
        select: { id: true, tenantId: true, isActive: true },
      });
      if (!user || !user.isActive) {
        throw new OAuthError('LINKING_DENIED', 'Compte désactivé');
      }
      // Rafraîchir les tokens si fournis
      await this.prisma.account.update({
        where: { id: existingAccount.id },
        data:  {
          accessToken:  profile.accessToken   ?? null,
          refreshToken: profile.refreshToken  ?? existingAccount.refreshToken,
          expiresAt:    profile.accessTokenExpires ?? null,
        },
      });
      const session = await this.createSession(user.id, user.tenantId, ipAddress, userAgent);
      await this.audit(user.tenantId, user.id,
        'auth.oauth.sign_in.success', 'info', { providerKey: profile.providerKey });
      return {
        sessionToken: session.token,
        userId:       user.id,
        tenantId:     user.tenantId,
        isNewLink:    false,
      };
    }

    // Cas 2 — pas de compte OAuth existant, tentative de linking par email
    if (!profile.email) {
      throw new OAuthError('NO_EMAIL', 'Le provider n\'a pas fourni d\'email');
    }

    const candidateUser = await this.prisma.user.findFirst({
      where:  { tenantId, email: profile.email },
      select: { id: true, tenantId: true, isActive: true },
    });

    if (!candidateUser) {
      // Politique stricte : OAuth ne crée pas de User. L'admin doit créer
      // le compte d'abord. Évite la prolifération de comptes fantômes.
      throw new OAuthError('USER_NOT_FOUND',
        `Aucun compte TransLog Pro pour cet email (${profile.email})`,
        { email: profile.email },
      );
    }

    if (!candidateUser.isActive) {
      throw new OAuthError('LINKING_DENIED', 'Compte désactivé');
    }

    // Appliquer la stratégie de linking
    const strategy = readLinkingStrategy();

    if (strategy === 'DENY') {
      throw new OAuthError('LINKING_DENIED',
        'Un compte existe déjà pour cet email. Connectez-vous avec votre mot de passe.',
      );
    }

    if (strategy === 'PROMPT') {
      // Le controller attrape ce code et redirige vers une page de
      // confirmation qui appellera `confirmLink()` ci-dessous.
      throw new OAuthError('LINKING_REQUIRED',
        'Confirmation requise pour lier le compte',
        { email: profile.email, providerKey: profile.providerKey },
      );
    }

    // AUTO_LINK_VERIFIED — mais SEULEMENT si le provider affirme
    // emailVerified === true. Sinon on refuse.
    if (!profile.emailVerified) {
      throw new OAuthError('EMAIL_UNVERIFIED',
        'Email non vérifié chez le provider — linking refusé',
      );
    }

    await this.linkAccount(candidateUser.id, candidateUser.tenantId, profile);
    const session = await this.createSession(
      candidateUser.id, candidateUser.tenantId, ipAddress, userAgent,
    );
    return {
      sessionToken: session.token,
      userId:       candidateUser.id,
      tenantId:     candidateUser.tenantId,
      isNewLink:    true,
    };
  }

  /**
   * Exécute le linking après confirmation explicite de l'utilisateur
   * (flow PROMPT). L'appelant doit avoir ré-authentifié le user via
   * credential OU via un token de confirmation signé remis juste avant.
   *
   * Cette méthode N'EST PAS appelée directement depuis le callback — elle
   * est appelée par un second endpoint sécurisé qui reçoit la confirmation
   * utilisateur.
   */
  async confirmLink(
    userId:    string,
    tenantId:  string,
    profile:   NormalizedOAuthProfile,
    ipAddress: string,
    userAgent: string,
  ): Promise<OAuthAuthenticationResult> {
    const user = await this.prisma.user.findFirst({
      where:  { id: userId, tenantId },
      select: { id: true, tenantId: true, isActive: true, email: true },
    });
    if (!user || !user.isActive) {
      throw new OAuthError('USER_NOT_FOUND', 'Utilisateur introuvable');
    }
    if (profile.email && user.email !== profile.email) {
      throw new OAuthError('LINKING_DENIED', 'Email du provider différent');
    }

    await this.linkAccount(userId, tenantId, profile);
    const session = await this.createSession(userId, tenantId, ipAddress, userAgent);
    return {
      sessionToken: session.token,
      userId,
      tenantId,
      isNewLink: true,
    };
  }

  // ─── Helpers privés ─────────────────────────────────────────────────────

  private async linkAccount(
    userId:   string,
    tenantId: string,
    profile:  NormalizedOAuthProfile,
  ): Promise<void> {
    await this.prisma.account.create({
      data: {
        userId,
        tenantId,
        providerId:   profile.providerKey,
        accountId:    profile.providerAccountId,
        accessToken:  profile.accessToken   ?? null,
        refreshToken: profile.refreshToken  ?? null,
        expiresAt:    profile.accessTokenExpires ?? null,
      },
    });
    await this.audit(tenantId, userId, 'auth.oauth.link.create', 'info', {
      providerKey: profile.providerKey,
    });
  }

  private async createSession(
    userId:    string,
    tenantId:  string,
    ipAddress: string,
    userAgent: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token     = randomBytes(SESSION_TOKEN_BYTES).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.session.create({
      data: { userId, tenantId, token, expiresAt, ipAddress, userAgent },
    });
    return { token, expiresAt };
  }

  private async audit(
    tenantId: string,
    userId:   string | null,
    action:   string,
    level:    'info' | 'warn',
    meta?:    Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          userId,
          plane:    'control',
          level,
          action,
          resource: userId ? `User:${userId}` : 'User:anonymous',
          newValue: meta as any,
        },
      });
    } catch (err) {
      this.log.error('[OAuth] audit log write failed', err);
    }
  }
}
