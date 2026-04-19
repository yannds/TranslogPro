import {
  Injectable, UnauthorizedException, Logger,
  ForbiddenException, NotFoundException, BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { TenantModuleService } from '../tenant/tenant-module.service';
import { MfaService } from '../mfa/mfa.service';
import { AuthIdentityService } from '../../core/identity/auth-identity.service';

/** Durée de validité d'une session (30 jours). */
const SESSION_TTL_MS = 30 * 24 * 3600 * 1_000;

/**
 * Seuil de rotation du token de session (15 jours = demi-TTL).
 * Au-delà, `me()` regénère un nouveau token et invalide l'ancien.
 * Réduit la fenêtre d'exploitation en cas de vol de token.
 */
const SESSION_ROTATION_THRESHOLD_MS = SESSION_TTL_MS / 2;

/**
 * Longueur du token de session en octets → 256 bits d'entropie.
 * Supérieur au minimum OWASP (128 bits) pour résister aux attaques par
 * force brute sur l'espace de tokens.
 */
const SESSION_TOKEN_BYTES = 32;

/**
 * Durée de validité d'un challenge MFA (5 min). Volontairement court :
 * un user qui hésite >5min entre password et code TOTP doit recommencer.
 */
const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1_000;

/** Nombre max de codes erronés acceptés par challenge avant invalidation. */
const MFA_MAX_ATTEMPTS = 5;

/**
 * Résultat d'un sign-in : soit une session complète (flow standard), soit un
 * challenge MFA en attente (flow 2FA). Le controller discrimine via `kind`
 * pour poser le bon cookie (translog_session vs translog_mfa_challenge).
 */
export type SignInResult =
  | { kind: 'session';      token:          string; user:      AuthUserDto }
  | { kind: 'mfaChallenge'; challengeToken: string; expiresAt: Date };

export interface AuthUserDto {
  id:              string;
  email:           string;
  name:            string | null;
  /**
   * Tenant natif de l'utilisateur (User.tenantId) — inchangé pendant
   * une impersonation. Utilisé par l'audit et les vérifs d'identité.
   */
  tenantId:        string;
  /**
   * Tenant effectif de la session courante (Session.tenantId) — diffère
   * de `tenantId` pendant une impersonation (où Session.tenantId = target).
   * C'est ce champ que le frontend doit utiliser pour :
   *   - fetch config tenant (/api/tenants/:id/config)
   *   - détecter un mismatch host/session
   *   - afficher le tenant courant dans l'UI
   */
  effectiveTenantId: string;
  /**
   * Slug du tenant effectif — utilisé par le mobile pour appeler
   * /public/:tenantSlug/portal/* (endpoints portail voyageur, pas d'auth).
   */
  tenantSlug:      string | null;
  roleId:          string | null;
  roleName:        string | null;
  userType:        string;
  /**
   * Id du Staff lié à ce User, ou null si le User n'a pas de profil Staff
   * (ex. CUSTOMER, SUPER_ADMIN). Indispensable pour les endpoints qui
   * prennent :staffId (driver-profile, crew-briefing, qhse) — staff.id ≠ user.id.
   */
  staffId:         string | null;
  /**
   * Agence de rattachement RH de l'acteur (Staff.agencyId). Null pour
   * CUSTOMER / SUPER_ADMIN / Staff sans agence. Le frontend l'utilise pour
   * pré-remplir les formulaires scope .agency (ex. ouverture de caisse).
   */
  agencyId:        string | null;
  /** Liste des `moduleKey` SaaS actifs pour le tenant de l'utilisateur. */
  enabledModules:  string[];
  /**
   * Permissions effectives résolues depuis `role.permissions`.
   * Source de vérité unique pour l'affichage conditionnel côté frontend.
   * Le backend reste l'autorité finale via PermissionGuard — ces strings
   * ne servent qu'à masquer/afficher des éléments d'UI.
   */
  permissions:     string[];
  /**
   * Signal post-signup : tant que ce champ est null, l'admin est redirigé
   * vers /onboarding au login (wizard 5 étapes). Le champ est toujours renvoyé
   * pour permettre au frontend de décider sans appel supplémentaire.
   */
  onboardingCompletedAt: string | null;
  /**
   * Activité principale choisie au signup (TICKETING | PARCELS | MIXED).
   * Null pour les tenants créés hors signup public. Sert au wizard à
   * conditionner l'étape 4 (premier trajet vs premier tarif colis).
   */
  businessActivity: string | null;
  /**
   * Statut de la souscription SaaS du tenant — TRIAL | ACTIVE | PAST_DUE |
   * SUSPENDED | CANCELLED. Null si pas de souscription (tenant plateforme,
   * SA, ou provisioning hors signup). Utilisé par le frontend pour afficher
   * le SuspendedScreen bloquant quand status=SUSPENDED.
   */
  subscriptionStatus: string | null;
  /**
   * Préférences self-service — override des valeurs par défaut du tenant.
   * Null = utilise le fallback tenant. Stockées dans User.preferences JSON.
   */
  locale:           string | null;
  timezone:         string | null;
  /**
   * MFA activé sur ce compte. Quand true, le flow sign-in retourne un
   * challenge pré-session au lieu d'une session directe.
   */
  mfaEnabled:       boolean;
  /**
   * Indique qu'un admin a forcé la rotation du mot de passe au prochain
   * login (Account.forcePasswordChange). Le frontend affiche alors
   * automatiquement l'écran /account/security.
   */
  mustChangePassword: boolean;
  /**
   * Contexte d'impersonation — présent ssi la session courante a été
   * créée via exchange d'un token d'impersonation JIT (effectiveTenantId
   * ≠ tenantId). Le frontend affiche un banner + chrono tant que ce
   * champ est présent.
   */
  impersonation?:  {
    sessionId:      string;
    targetTenantId: string;
    targetSlug:     string;
    actorTenantId:  string;
    expiresAt:      string;   // ISO
    reason:         string | null;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma:   PrismaService,
    private readonly modules:  TenantModuleService,
    private readonly mfa:      MfaService,
    private readonly identity: AuthIdentityService,
  ) {}

  // ─── Sign-in ───────────────────────────────────────────────────────────────

  /**
   * Authentification credential (email+password) scopée à un tenant.
   *
   * PHASE 1 : le tenantId vient de req.resolvedHostTenant (Host header) posé
   * par TenantHostMiddleware. Le controller extrait cette valeur et la passe
   * ici. Un login sans tenant résolu → BadRequest 400 (domaine manquant).
   *
   * Même humain → peut avoir un compte credential dans chaque tenant avec les
   * mêmes email + password ; l'isolation est garantie par le tenantId.
   */
  async signIn(
    tenantId:  string,
    email:     string,
    password:  string,
    ipAddress: string,
    userAgent: string,
  ): Promise<SignInResult> {

    if (!tenantId) {
      // Filet de sécurité : ne jamais signer sans tenant résolu.
      throw new BadRequestException(
        'Tenant non résolu : l\'authentification doit passer par un sous-domaine tenant',
      );
    }

    // 1. Recherche du compte credential via AuthIdentityService
    //    (abstraction qui gère la clé composite (tenantId, providerId, accountId))
    //    On fait systématiquement le bcrypt compare même si l'account est introuvable
    //    (timing-safe : évite l'énumération d'emails par mesure du temps de réponse).
    const account = await this.identity.findCredentialAccount(tenantId, email);

    const dummyHash = '$2a$12$Wz1q2FAKEHASHJUSTFORTIMINGPROTECTION.padding.padding';
    const hashToCheck = account?.password ?? dummyHash;
    const valid = await bcrypt.compare(password, hashToCheck);

    if (!account || !account.password || !valid) {
      // Audit log tentative échouée
      await this.auditSignIn({
        userId:    account?.userId ?? null,
        tenantId,
        success:   false,
        ipAddress,
        userAgent,
        email,
      });
      throw new UnauthorizedException('Identifiants invalides');
    }

    const { user } = account;

    // 1b. Vérifier que le compte est actif
    if (!user.isActive) {
      await this.auditSignIn({
        userId:   user.id,
        tenantId: user.tenantId,
        success:  false,
        ipAddress,
        userAgent,
        email,
      });
      throw new UnauthorizedException('Compte désactivé');
    }

    // 1c. MFA wire — si le user a activé TOTP, on n'émet PAS de session mais
    //     un challenge pré-session. Le controller pose un cookie MFA distinct
    //     (TTL 5 min) et le frontend bascule sur l'écran code à 6 chiffres.
    //     La vérification passe ensuite par POST /auth/mfa/verify qui appelle
    //     verifyMfa() et crée enfin la vraie session.
    if (user.mfaEnabled) {
      const challenge = await this.issueMfaChallenge(
        user.id, user.tenantId, ipAddress, userAgent,
      );
      this.logger.log(`[AUTH] sign-in pending MFA challenge: ${email} tenant=${user.tenantId}`);
      return {
        kind:           'mfaChallenge',
        challengeToken: challenge.token,
        expiresAt:      challenge.expiresAt,
      };
    }

    // 2. Invalidation préventive des sessions expirées du même user (housekeeping)
    await this.prisma.session.deleteMany({
      where: { userId: user.id, expiresAt: { lt: new Date() } },
    });

    // 3. Création session avec token 256 bits
    const token     = randomBytes(SESSION_TOKEN_BYTES).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.prisma.session.create({
      data: {
        userId:    user.id,
        tenantId:  user.tenantId,
        token,
        expiresAt,
        ipAddress,
        userAgent,
      },
    });

    // 3b. Tracking d'activité pour les métriques plateforme (DAU/MAU/growth).
    // On incrémente loginCount et on pose lastLoginAt/lastActiveAt. Ces
    // champs sont exploités par PlatformAnalyticsService (cron DAU + KPIs).
    const now = new Date();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt:  now,
        lastActiveAt: now,
        loginCount:   { increment: 1 },
      },
    });

    // 4. Audit log succès
    await this.auditSignIn({
      userId:   user.id,
      tenantId: user.tenantId,
      success:  true,
      ipAddress,
      userAgent,
      email,
    });

    this.logger.log(`[AUTH] sign-in: ${email} tenant=${user.tenantId} ip=${ipAddress}`);

    return {
      kind:  'session',
      token,
      user:  await this.toDto(user),
    };
  }

  // ─── Self-service : changement de mot de passe ───────────────────────────

  /**
   * Permet à un utilisateur authentifié de changer son propre mot de passe.
   *
   * - Vérifie `currentPassword` via bcrypt
   * - Hashe `newPassword` (bcrypt 12)
   * - Invalide toutes les autres sessions du user (defense-in-depth)
   * - Met à jour `forcePasswordChange = false` (cas rotation forcée)
   *
   * Sessions préservées : aucune — on demande au user de se reconnecter
   * partout (par prudence). Ce choix peut être assoupli plus tard si UX
   * trop dure, en ne conservant que la session courante (via `keepToken`).
   */
  async changePassword(
    userId:          string,
    currentPassword: string,
    newPassword:     string,
    ipAddress:       string,
  ): Promise<void> {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('Nouveau mot de passe requis (≥ 8 caractères)');
    }
    if (newPassword === currentPassword) {
      throw new BadRequestException('Le nouveau mot de passe doit différer de l\'actuel');
    }

    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, tenantId: true, email: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    const account = await this.prisma.account.findFirst({
      where:  { userId: user.id, providerId: 'credential' },
      select: { id: true, password: true },
    });
    if (!account || !account.password) {
      throw new BadRequestException(
        'Ce compte n\'a pas de mot de passe (connexion OAuth uniquement)',
      );
    }

    const ok = await bcrypt.compare(currentPassword, account.password);
    if (!ok) throw new UnauthorizedException('Mot de passe actuel invalide');

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
      this.prisma.session.deleteMany({ where: { userId: user.id } }),
    ]);

    await this.auditSignIn({
      userId:    user.id,
      tenantId:  user.tenantId,
      success:   true,
      ipAddress,
      userAgent: '',
      email:     user.email,
    }).catch(() => { /* audit fails never block password change */ });

    await this.prisma.auditLog.create({
      data: {
        tenantId:  user.tenantId,
        userId:    user.id,
        plane:     'control',
        level:     'info',
        action:    'auth.password.change.self',
        resource:  `User:${user.id}`,
        ipAddress,
      },
    }).catch(() => { /* best effort */ });
  }

  // ─── Self-service : préférences (locale / timezone) ──────────────────────

  /**
   * Fusionne les clés fournies dans `User.preferences` JSON (sans écraser les
   * autres clés déjà présentes). Les valeurs null/undefined sont ignorées.
   */
  async updateMyPreferences(
    userId: string,
    patch:  { locale?: string | null; timezone?: string | null },
  ): Promise<{ locale: string | null; timezone: string | null }> {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, preferences: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    // preferences JSON peut déjà contenir d'autres clés (ex. siège préféré
    // pour clients) — on merge sans écraser.
    const prev = (user.preferences as Record<string, unknown> | null) ?? {};
    const next: Record<string, unknown> = { ...prev };
    if (typeof patch.locale === 'string')   next['locale']   = patch.locale;
    if (typeof patch.timezone === 'string') next['timezone'] = patch.timezone;

    await this.prisma.user.update({
      where: { id: userId },
      data:  { preferences: next as Prisma.InputJsonValue },
    });

    return {
      locale:   (next['locale']   as string | undefined) ?? null,
      timezone: (next['timezone'] as string | undefined) ?? null,
    };
  }

  // ─── Me ───────────────────────────────────────────────────────────────────

  /**
   * Retourne l'utilisateur courant et, si la session a dépassé le seuil de
   * rotation (mi-TTL), un nouveau token à poser en cookie.
   *
   * - `rotatedToken` : défini uniquement si une rotation a eu lieu.
   *   Le controller doit dans ce cas réécrire le cookie `translog_session`.
   * - L'ancien token est supprimé atomiquement après création du nouveau.
   */
  async me(
    token:     string,
    ipAddress: string,
    userAgent: string = '',
  ): Promise<{ user: AuthUserDto; rotatedToken?: string; rotatedExpiresAt?: Date }> {
    const session = await this.prisma.session.findUnique({
      where:   { token },
      include: { user: { include: { role: { include: { permissions: true } } } } },
    });

    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expirée ou invalide');
    }

    // Compte désactivé → révoquer la session immédiatement
    if (!session.user.isActive) {
      await this.prisma.session.delete({ where: { token } });
      throw new UnauthorizedException('Compte désactivé');
    }

    // IP binding : si l'IP change, on invalide la session (session hijacking)
    // Exception : localhost (dev) et adresses privées RFC 1918
    if (!this.isPrivateOrLocal(ipAddress) && session.ipAddress &&
        session.ipAddress !== ipAddress) {
      await this.prisma.session.delete({ where: { token } });
      this.logger.warn(
        `[AUTH] session IP mismatch — invalidated. ` +
        `stored=${session.ipAddress} current=${ipAddress}`,
      );
      throw new ForbiddenException('Session invalidée (IP modifiée)');
    }

    const user = await this.toDto(session.user, session.tenantId);

    // Si la session courante est sur un tenant ≠ tenant natif de l'utilisateur,
    // il s'agit d'une impersonation JIT. On joint le contexte (expiresAt,
    // reason, sessionId) pour que le frontend affiche un banner.
    if (session.tenantId !== session.user.tenantId) {
      const imp = await this.prisma.impersonationSession.findFirst({
        where: {
          actorId:        session.user.id,
          targetTenantId: session.tenantId,
          status:         { in: ['ACTIVE', 'EXCHANGED'] },
          expiresAt:      { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (imp) {
        const targetTenant = await this.prisma.tenant.findUnique({
          where:  { id: imp.targetTenantId },
          select: { slug: true },
        });
        user.impersonation = {
          sessionId:      imp.id,
          targetTenantId: imp.targetTenantId,
          targetSlug:     targetTenant?.slug ?? '',
          actorTenantId:  imp.actorTenantId,
          expiresAt:      imp.expiresAt.toISOString(),
          reason:         imp.reason,
        };
      }
    }

    // Rotation à mi-TTL (15 jours) : on regénère un nouveau token pour réduire
    // la fenêtre d'exploitation en cas de vol. L'ancien est invalidé immédiatement.
    const sessionAgeMs = Date.now() - session.createdAt.getTime();
    if (sessionAgeMs >= SESSION_ROTATION_THRESHOLD_MS) {
      const newToken     = randomBytes(SESSION_TOKEN_BYTES).toString('hex');
      const newExpiresAt = new Date(Date.now() + SESSION_TTL_MS);

      // Créer la nouvelle session AVANT de supprimer l'ancienne : garantit
      // qu'aucune requête concurrente ne se retrouve avec un token orphelin.
      await this.prisma.session.create({
        data: {
          userId:    session.userId,
          tenantId:  session.tenantId,
          token:     newToken,
          expiresAt: newExpiresAt,
          ipAddress,
          userAgent: userAgent || session.userAgent,
        },
      });
      await this.prisma.session.delete({ where: { token } })
        .catch(() => {/* best-effort — la nouvelle session est déjà créée */});

      this.logger.log(
        `[AUTH] session rotated — user=${session.userId} ` +
        `age=${Math.round(sessionAgeMs / 86_400_000)}d`,
      );

      return { user, rotatedToken: newToken, rotatedExpiresAt: newExpiresAt };
    }

    return { user };
  }



  // ─── MFA (scaffold — non câblé dans signIn à ce stade) ───────────────────
  //
  // Activation future : dans signIn, après bcrypt OK, AVANT
  // `prisma.session.create`, ajouter :
  //
  //     if (account.user.mfaEnabled) {
  //       const challenge = await this.issueMfaChallenge(
  //         user.id, user.tenantId, ipAddress, userAgent,
  //       );
  //       return { mfaChallengeToken: challenge.token, user: null };
  //     }
  //
  // Le controller détectera `mfaChallengeToken` et posera un cookie
  // pré-session distinct (`translog_mfa_challenge`) au lieu du cookie
  // session normal. Le frontend basculera sur l'écran "code à 6 chiffres".
  // POST /auth/mfa/verify finalisera ensuite via `verifyMfa()`.

  /**
   * Crée un challenge MFA en attente. Retourne le token opaque (256 bits)
   * à poser dans le cookie pré-session. La ligne expire dans 5 min.
   */
  async issueMfaChallenge(
    userId:    string,
    tenantId:  string,
    ipAddress: string,
    userAgent: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    // Housekeeping : on supprime les challenges expirés ou pendants du même user
    // pour éviter l'accumulation. Un user n'a jamais qu'1 challenge actif.
    await this.prisma.mfaChallenge.deleteMany({ where: { userId } });

    const token     = randomBytes(SESSION_TOKEN_BYTES).toString('hex');
    const expiresAt = new Date(Date.now() + MFA_CHALLENGE_TTL_MS);

    await this.prisma.mfaChallenge.create({
      data: { userId, tenantId, token, ipAddress, userAgent, expiresAt },
    });

    await this.auditMfa({
      userId, tenantId, ipAddress, userAgent,
      action: 'auth.mfa.challenge.issued',
      level:  'info',
    });

    return { token, expiresAt };
  }

  /**
   * Vérifie un code TOTP/backup contre un challenge en attente.
   * Si OK : supprime le challenge, crée une vraie Session, retourne le
   * couple `{ token, user }` exactement comme `signIn` (drop-in).
   *
   * IP binding : si l'IP du verify diffère de celle qui a créé le challenge
   * (et qu'elle n'est pas locale/privée), on rejette → protection contre vol
   * du cookie pré-session.
   */
  async verifyMfa(
    challengeToken: string,
    code:           string,
    ipAddress:      string,
    userAgent:      string,
    expectedTenantId?: string,
  ): Promise<{ token: string; user: AuthUserDto }> {
    const challenge = await this.prisma.mfaChallenge.findUnique({
      where:   { token: challengeToken },
      include: {
        user: { include: { role: { include: { permissions: true } } } },
      },
    });

    if (!challenge) {
      throw new UnauthorizedException('Challenge MFA invalide');
    }

    // Defense in depth : si le controller a résolu un tenant (via Host),
    // le challenge DOIT appartenir à ce tenant. Empêche qu'un token issu
    // sur tenantA soit utilisé depuis le sous-domaine tenantB.
    if (expectedTenantId && challenge.tenantId !== expectedTenantId) {
      this.logger.warn(
        `[MFA] challenge tenant mismatch — expected=${expectedTenantId} ` +
        `got=${challenge.tenantId} ip=${ipAddress}`,
      );
      throw new ForbiddenException('Challenge MFA destiné à un autre tenant');
    }

    if (challenge.expiresAt < new Date()) {
      await this.prisma.mfaChallenge.delete({ where: { id: challenge.id } });
      throw new UnauthorizedException('Challenge MFA expiré — recommencez la connexion');
    }

    if (challenge.attempts >= MFA_MAX_ATTEMPTS) {
      await this.prisma.mfaChallenge.delete({ where: { id: challenge.id } });
      await this.auditMfa({
        userId: challenge.userId, tenantId: challenge.tenantId,
        ipAddress, userAgent,
        action: 'auth.mfa.verify.lockout',
        level:  'warn',
      });
      throw new UnauthorizedException('Trop de tentatives — recommencez la connexion');
    }

    if (!this.isPrivateOrLocal(ipAddress) && challenge.ipAddress &&
        challenge.ipAddress !== ipAddress) {
      await this.prisma.mfaChallenge.delete({ where: { id: challenge.id } });
      this.logger.warn(
        `[MFA] challenge IP mismatch — invalidated. ` +
        `stored=${challenge.ipAddress} current=${ipAddress}`,
      );
      throw new ForbiddenException('IP modifiée — challenge invalidé');
    }

    const valid = await this.mfa.verifyLoginCode(challenge.userId, code);
    if (!valid) {
      await this.prisma.mfaChallenge.update({
        where: { id: challenge.id },
        data:  { attempts: { increment: 1 } },
      });
      await this.auditMfa({
        userId: challenge.userId, tenantId: challenge.tenantId,
        ipAddress, userAgent,
        action: 'auth.mfa.verify.failure',
        level:  'warn',
      });
      throw new UnauthorizedException('Code invalide');
    }

    // Code OK → supprime le challenge (single-use), crée la vraie Session.
    await this.prisma.mfaChallenge.delete({ where: { id: challenge.id } });

    const { token } = await this.createSession(
      challenge.userId, challenge.tenantId, ipAddress, userAgent,
    );

    await this.auditMfa({
      userId: challenge.userId, tenantId: challenge.tenantId,
      ipAddress, userAgent,
      action: 'auth.mfa.verify.success',
      level:  'info',
    });

    if (!challenge.user) {
      // Ne devrait pas arriver — onDelete: Cascade garantit l'intégrité.
      throw new NotFoundException('Utilisateur du challenge introuvable');
    }

    return { token, user: await this.toDto(challenge.user) };
  }

  /**
   * Helper réutilisable : housekeeping + création d'une session.
   * Utilisé par `verifyMfa` ; signIn pourra aussi être refactorisé pour s'en
   * servir (retire la duplication actuelle).
   */
  private async createSession(
    userId:    string,
    tenantId:  string,
    ipAddress: string,
    userAgent: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    await this.prisma.session.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    });

    const token     = randomBytes(SESSION_TOKEN_BYTES).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.prisma.session.create({
      data: { userId, tenantId, token, expiresAt, ipAddress, userAgent },
    });

    return { token, expiresAt };
  }

  // ─── Sign-out ─────────────────────────────────────────────────────────────

  async signOut(token: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { token } });
  }

  // ─── Création compte credential (utilisé par le seed dev) ─────────────────

  /**
   * Crée ou met à jour un compte credential pour un User.
   * Depuis Phase 1 : le tenantId est requis (Account.tenantId NOT NULL).
   * Les seeds/admins doivent passer le tenantId du User cible.
   */
  async createCredentialAccount(
    tenantId: string,
    userId:   string,
    email:    string,
    password: string,
  ): Promise<void> {
    const hash = await bcrypt.hash(password, 12);
    await this.identity.upsertCredentialAccount({
      tenantId,
      userId,
      email,
      passwordHash: hash,
    });
  }

  // ─── Helpers privés ───────────────────────────────────────────────────────

  private async toDto(user: {
    id: string; email: string; name: string | null;
    tenantId: string; roleId: string | null; userType: string;
    mfaEnabled?: boolean;
    preferences?: unknown;
    role?: { name: string; permissions?: { permission: string }[] } | null;
  }, sessionTenantId?: string): Promise<AuthUserDto> {
    const effectiveTenantId = sessionTenantId ?? user.tenantId;
    const [enabledModules, staff, tenant, subscription, credAccount, fullUser] = await Promise.all([
      this.modules.listActiveKeys(effectiveTenantId),
      this.prisma.staff.findFirst({
        where:  { userId: user.id, tenantId: user.tenantId },
        select: { id: true, agencyId: true },
      }),
      this.prisma.tenant.findUnique({
        where:  { id: effectiveTenantId },
        select: { onboardingCompletedAt: true, businessActivity: true, slug: true },
      }),
      this.prisma.platformSubscription.findUnique({
        where:  { tenantId: effectiveTenantId },
        select: { status: true },
      }),
      // Account.forcePasswordChange — indépendant de la session, propre à l'identité.
      this.prisma.account.findFirst({
        where:  { userId: user.id, providerId: 'credential' },
        select: { forcePasswordChange: true },
      }),
      // Si l'appelant a passé un user partiel sans preferences/mfaEnabled, on complète.
      (user.preferences === undefined || user.mfaEnabled === undefined)
        ? this.prisma.user.findUnique({
            where:  { id: user.id },
            select: { preferences: true, mfaEnabled: true },
          })
        : Promise.resolve(null),
    ]);

    const prefs = ((fullUser?.preferences ?? user.preferences) as Record<string, unknown> | null) ?? {};
    const mfaEnabled = fullUser?.mfaEnabled ?? user.mfaEnabled ?? false;

    return {
      id:               user.id,
      email:            user.email,
      name:             user.name,
      tenantId:         user.tenantId,
      effectiveTenantId,
      tenantSlug:       tenant?.slug ?? null,
      roleId:           user.roleId,
      roleName:         user.role?.name ?? null,
      userType:         user.userType,
      staffId:          staff?.id ?? null,
      agencyId:         staff?.agencyId ?? null,
      enabledModules,
      permissions:      user.role?.permissions?.map(p => p.permission) ?? [],
      onboardingCompletedAt: tenant?.onboardingCompletedAt ? tenant.onboardingCompletedAt.toISOString() : null,
      businessActivity:      tenant?.businessActivity ?? null,
      subscriptionStatus:    subscription?.status ?? null,
      locale:           (prefs['locale']   as string | undefined) ?? null,
      timezone:         (prefs['timezone'] as string | undefined) ?? null,
      mfaEnabled,
      mustChangePassword: credAccount?.forcePasswordChange ?? false,
    };
  }

  private isPrivateOrLocal(ip: string): boolean {
    return (
      ip === '127.0.0.1'      ||
      ip === '::1'            ||
      ip === '::ffff:127.0.0.1' ||
      ip.startsWith('10.')    ||
      ip.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
    );
  }

  private async auditSignIn(params: {
    userId:    string | null;
    tenantId:  string;
    success:   boolean;
    ipAddress: string;
    userAgent: string;
    email:     string;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId:  params.tenantId,
          userId:    params.userId,
          plane:     'control',
          level:     params.success ? 'info' : 'warn',
          action:    params.success ? 'auth.sign_in.success' : 'auth.sign_in.failure',
          resource:  `User:${params.email}`,
          ipAddress: params.ipAddress,
          newValue:  { userAgent: params.userAgent },
        },
      });
    } catch (err) {
      // Ne jamais bloquer l'auth sur un échec d'audit log
      this.logger.error('[AUTH] audit log write failed', err);
    }
  }

  private async auditMfa(params: {
    userId:    string;
    tenantId:  string;
    ipAddress: string;
    userAgent: string;
    action:    string;
    level:     'info' | 'warn';
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId:  params.tenantId,
          userId:    params.userId,
          plane:     'control',
          level:     params.level,
          action:    params.action,
          resource:  `User:${params.userId}`,
          ipAddress: params.ipAddress,
          newValue:  { userAgent: params.userAgent },
        },
      });
    } catch (err) {
      this.logger.error('[MFA] audit log write failed', err);
    }
  }
}
