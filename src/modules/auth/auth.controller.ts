import {
  Controller, Post, Get, Patch, Delete, Body, Req, Res, Query, Param,
  HttpCode, UseGuards, UnauthorizedException, BadRequestException,
  ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService, AuthUserDto } from './auth.service';
import { SignInDto } from './dto/sign-in.dto';
import { SignInCrossTenantDto } from './dto/sign-in-cross-tenant.dto';
import {
  RateLimit,
  RedisRateLimitGuard,
} from '../../common/guards/redis-rate-limit.guard';
import { ImpersonationService } from '../../core/iam/services/impersonation.service';
import { AppConfigService } from '../../common/config/app-config.service';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';

const COOKIE_NAME = 'translog_session';

// ── SameSite : strict en prod, none en dev ──────────────────────────────────
// Prod : `strict` — portail admin sur le même origin que l'API derrière Kong,
//        pas de cross-origin, protection CSRF maximale.
// Dev  : `none` — on a plusieurs frontends qui tapent le backend en cross-site
//        POST : Vite (5173/5174), Expo Web (8081), mobile native, plus les
//        sous-domaines tenant (.translog.test). `lax` bloquait les POST
//        cross-site → 401 sur verify-qr, scan, check-in, board, etc. depuis
//        ces frontends. Avec `none` le cookie est publié partout ; le browser
//        exige `Secure=true`, que Chrome/Firefox acceptent sur localhost sans
//        HTTPS réel (exemption secure-context). Aucun impact prod : la branche
//        `'strict' + secure:true` reste intacte.
const SAMESITE_DEV = process.env.NODE_ENV === 'production' ? 'strict' as const : 'none' as const;
// `secure:true` est requis quand SameSite=None ; Chrome l'autorise sur
// localhost en HTTP. `true` en prod de toute façon (cookies HTTPS only).
const SECURE_COOKIE = process.env.NODE_ENV === 'production' || SAMESITE_DEV === 'none';

const COOKIE_OPTS = {
  httpOnly:  true,
  sameSite:  SAMESITE_DEV,
  secure:    SECURE_COOKIE,
  maxAge:    30 * 24 * 3600 * 1_000,
  path:      '/',
};

/** Cookie pré-session MFA — TTL 5 min, distinct du cookie de session.
 *  /auth/me NE LE LIT PAS, donc impossible d'accéder à l'API tant que le
 *  challenge n'est pas finalisé via /auth/mfa/verify. */
const MFA_COOKIE_NAME = 'translog_mfa_challenge';
const MFA_COOKIE_OPTS = {
  httpOnly:  true,
  sameSite:  SAMESITE_DEV,
  secure:    SECURE_COOKIE,
  maxAge:    5 * 60 * 1_000,
  path:      '/',
};

/**
 * Extrait l'IP réelle depuis X-Forwarded-For (Kong/nginx) ou socket.
 * Ne fait confiance à X-Forwarded-For que si NODE_ENV=production
 * (en dev, l'API est exposée directement — pas de proxy de confiance).
 */
function extractIp(req: Request): string {
  if (process.env.NODE_ENV === 'production') {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0]?.trim() ?? req.ip ?? '';
    }
  }
  return req.ip ?? req.socket?.remoteAddress ?? '';
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService:         AuthService,
    private readonly impersonationService: ImpersonationService,
    private readonly appConfig:            AppConfigService,
  ) {}

  /**
   * POST /api/auth/sign-in
   *
   * Rate-limit : 5 tentatives / 15 minutes par IP (PRD §IV.6) en prod.
   * En dev : 1000/15min — évite de se bloquer pendant l'itération sur le form login.
   * DTO : validation stricte email + password (whitelist + forbidNonWhitelisted)
   */
  @Post('sign-in')
  @HttpCode(200)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit([
    {
      limit:    process.env.NODE_ENV === 'production' ? 5 : 1000,
      windowMs: 15 * 60_000,
      keyBy:    'ip',
      suffix:   'auth_signin',
    },
  ])
  /**
   * CAPTCHA ADAPTATIF (NIST/OWASP) : pas de @RequireCaptcha() statique.
   * Le CAPTCHA est exigé par AuthService.signIn seulement après N échecs
   * (par IP OU par email dans les 15 dernières minutes). Un user normal
   * ne voit JAMAIS le widget. Seul un credential-stuffer / brute-forcer
   * est confronté au défi à partir de la 4e tentative.
   */
  async signIn(
    @Body() dto:  SignInDto,
    @Req()  req:  Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthUserDto | { mfaRequired: true; expiresAt: string }> {
    // Le tenant est résolu depuis le Host par TenantHostMiddleware
    // (voir core/tenancy). Sans sous-domaine tenant valide, on refuse le login
    // — pas de fallback "global" : un cookie doit être scopé à un sous-domaine.
    const tenantId = req.resolvedHostTenant?.tenantId;
    if (!tenantId) {
      throw new BadRequestException(
        'Sous-domaine tenant requis pour s\'authentifier. ' +
        `Utilisez https://{votre-tenant}.${this.appConfig.publicBaseDomain}/login`,
      );
    }

    const result = await this.authService.signIn(
      tenantId,
      dto.email,
      dto.password,
      extractIp(req),
      req.headers['user-agent'] ?? '',
      dto.captchaToken,
    );

    // Branch MFA — on pose le cookie pré-session (TTL 5 min) et on retourne
    // un marqueur à destination du frontend pour qu'il bascule sur l'écran
    // code à 6 chiffres. Le vrai cookie de session sera posé après /mfa/verify.
    if (result.kind === 'mfaChallenge') {
      res.cookie(MFA_COOKIE_NAME, result.challengeToken, MFA_COOKIE_OPTS);
      return { mfaRequired: true, expiresAt: result.expiresAt.toISOString() };
    }

    res.cookie(COOKIE_NAME, result.token, COOKIE_OPTS);
    return result.user;
  }

  /**
   * POST /api/auth/sign-in-cross-tenant
   *
   * Sign-in cross-tenant pour clients qui ne connaissent pas leur sous-domaine
   * (mobile multi-tenant SaaS, intégrations B2B). Le serveur découvre le
   * tenant à partir de l'email + password, crée la session sur ce tenant, et
   * retourne le couple `{ tenantSlug, tenantHost, token, user }` pour que le
   * client puisse :
   *   1. persister `tenantHost` (toutes les requêtes suivantes la-bas)
   *   2. persister `token` (header Authorization: Bearer)
   *
   * Cas multi-tenants : si la même adresse a un compte sur ≥ 2 tenants avec
   * le même password, retourne `{ multiple: true, tenants: [...] }`. Le client
   * affiche un picker et re-appelle avec `preferredTenantSlug`.
   *
   * Sécurité :
   *   - rate-limit IP partagé avec sign-in (compteur global anti-bruteforce)
   *   - bcrypt systématique même si email inconnu (timing-safe)
   *   - 401 générique sur échec (pas d'enum)
   *   - CAPTCHA adaptatif au-delà de 3 échecs
   *   - PAS de cookie posé : le client mobile utilise Bearer (cookie scopé
   *     subdomain ne pourrait pas être posé sur api.* depuis ce flow)
   */
  @Post('sign-in-cross-tenant')
  @HttpCode(200)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit([
    {
      limit:    process.env.NODE_ENV === 'production' ? 5 : 1000,
      windowMs: 15 * 60_000,
      keyBy:    'ip',
      suffix:   'auth_signin_xt',
    },
  ])
  async signInCrossTenant(
    @Body() dto: SignInCrossTenantDto,
    @Req()  req: Request,
  ): Promise<
    | (AuthUserDto & { token: string; tenantHost: string })
    | { mfaRequired: true; challengeToken: string; expiresAt: string; tenantHost: string }
    | { multiple: true; tenants: Array<{ slug: string; name: string }> }
  > {
    const result = await this.authService.signInCrossTenant(
      dto.email,
      dto.password,
      extractIp(req),
      req.headers['user-agent'] ?? '',
      dto.captchaToken,
      dto.preferredTenantSlug,
    );

    if (result.kind === 'choice') {
      return { multiple: true, tenants: result.tenants };
    }

    if (result.kind === 'mfaChallenge') {
      // Pas de cookie en cross-tenant — on retourne le challenge token en
      // JSON. Le client appelle ensuite /api/auth/mfa/verify-cross-tenant
      // (cf. plus bas) avec le code TOTP + ce challengeToken. Le tenantHost
      // est déduit du challenge côté serveur ; on le retourne ici pour que
      // l'app sache vers quelle URL persister la session après MFA réussie.
      const challenge = await this.authService.lookupMfaChallenge(result.challengeToken);
      const slug = challenge?.tenantSlug ?? null;
      if (!slug) {
        throw new BadRequestException('Tenant slug introuvable pour le challenge MFA.');
      }
      const tenantHost = `${slug}.${this.appConfig.publicBaseDomain}`;
      return {
        mfaRequired:    true,
        challengeToken: result.challengeToken,
        expiresAt:      result.expiresAt.toISOString(),
        tenantHost,
      };
    }

    // result.kind === 'session' — on construit le tenantHost depuis le slug.
    const tenantSlug = result.user.tenantSlug;
    if (!tenantSlug) {
      throw new BadRequestException('Tenant slug manquant — réessayez depuis le portail web.');
    }
    const tenantHost = `${tenantSlug}.${this.appConfig.publicBaseDomain}`;
    return {
      ...result.user,
      token:      result.token,
      tenantHost,
    };
  }

  /**
   * POST /api/auth/mfa/verify-cross-tenant
   *
   * Étape 2 du sign-in MFA pour mobile multi-tenant. Reçoit le `challengeToken`
   * en body (pas en cookie — le client mobile ne maintient pas la session par
   * cookie en cross-tenant) + le code TOTP. Retourne `{ token, tenantHost,
   * ...user }` exactement comme le succès du sign-in cross-tenant.
   *
   * Sécurité : même garanties que /mfa/verify (rate-limit, IP binding,
   * single-use challenge, max attempts). Pas de tenant attendu côté
   * controller (impossible à vérifier sans Host) — la garantie tenant
   * vient du challenge lui-même qui est lié à un User.tenantId.
   */
  @Post('mfa/verify-cross-tenant')
  @HttpCode(200)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({ limit: 5, windowMs: 15 * 60_000, keyBy: 'ip', suffix: 'auth_mfa_verify_xt' })
  async verifyMfaCrossTenant(
    @Body() body: { code: string; challengeToken: string },
    @Req()  req:  Request,
  ): Promise<AuthUserDto & { token: string; tenantHost: string }> {
    if (!body?.code || typeof body.code !== 'string') {
      throw new UnauthorizedException('Code requis');
    }
    if (!body?.challengeToken || typeof body.challengeToken !== 'string') {
      throw new UnauthorizedException('challengeToken requis');
    }

    const { token, user } = await this.authService.verifyMfa(
      body.challengeToken,
      body.code,
      extractIp(req),
      req.headers['user-agent'] ?? '',
      // Pas d'expectedTenantId — on accepte le tenant que porte le challenge.
      // L'IP binding + le TTL 5 min + max 5 attempts protègent déjà.
      undefined,
    );

    if (!user.tenantSlug) {
      throw new BadRequestException('Tenant slug manquant — connectez-vous depuis le portail web.');
    }
    const tenantHost = `${user.tenantSlug}.${this.appConfig.publicBaseDomain}`;
    return { ...user, token, tenantHost };
  }

  /**
   * GET /api/auth/me
   *
   * Pas de rate-limit strict (cookie valide requis — brute-force impossible
   * sans le token opaque 256 bits).
   */
  @Get('me')
  async me(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthUserDto> {
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('Token de session absent');

    // Pas de cache — un changement de rôle/perm doit être visible au prochain
    // refresh sans attendre l'expiration d'un cache HTTP intermédiaire.
    res.setHeader('Cache-Control', 'no-store');

    const result = await this.authService.me(
      token,
      extractIp(req),
      req.headers['user-agent'] ?? '',
    );

    // Rotation à mi-TTL : AuthService a généré un nouveau token, on repose le cookie.
    if (result.rotatedToken) {
      res.cookie(COOKIE_NAME, result.rotatedToken, COOKIE_OPTS);
    }

    return result.user;
  }

  /**
   * POST /api/auth/mfa/verify
   *
   * Étape 2 du sign-in MFA. Lit le cookie `translog_mfa_challenge` posé par
   * sign-in (côté serveur) lorsqu'un user MFA-enabled aura validé son
   * password. **Endpoint NON activé tant que sign-in ne pose pas le cookie
   * pré-session** — ce qui n'est pas le cas à ce stade.
   *
   * En l'état actuel : appeler cet endpoint sans cookie pré-session retourne
   * 401 "Challenge MFA absent" → comportement bénin, aucun risque de
   * régression sur le flow login standard.
   *
   * Rate-limit : 5 tentatives / 15 min par IP (même politique que sign-in).
   */
  @Post('mfa/verify')
  @HttpCode(200)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({ limit: 5, windowMs: 15 * 60_000, keyBy: 'ip', suffix: 'auth_mfa_verify' })
  async verifyMfa(
    @Body() body: { code: string },
    @Req()  req:  Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthUserDto> {
    const challengeToken = req.cookies?.[MFA_COOKIE_NAME];
    if (typeof challengeToken !== 'string' || challengeToken.length === 0) {
      throw new UnauthorizedException('Challenge MFA absent');
    }
    if (!body?.code || typeof body.code !== 'string') {
      throw new UnauthorizedException('Code requis');
    }

    // Defense in depth : passer le tenantId du Host pour que verifyMfa
    // rejette un challenge issu d'un autre tenant que celui du sous-domaine.
    const expectedTenantId = req.resolvedHostTenant?.tenantId;
    const { token, user } = await this.authService.verifyMfa(
      challengeToken,
      body.code,
      extractIp(req),
      req.headers['user-agent'] ?? '',
      expectedTenantId,
    );

    res.clearCookie(MFA_COOKIE_NAME, { path: '/', sameSite: SAMESITE_DEV, secure: SECURE_COOKIE });
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    return user;
  }

  /**
   * POST /api/auth/change-password
   *
   * Self-service : l'utilisateur authentifié change son mot de passe en
   * fournissant l'ancien + le nouveau. Toutes ses sessions sont invalidées
   * — il devra se reconnecter (y compris sur cet onglet → cookie purgé).
   *
   * Rate-limit : 5 tentatives / 15 min par IP pour freiner une attaque
   * qui aurait volé un cookie de session et voudrait essayer des mots de
   * passe par force brute via cet endpoint.
   */
  @Post('change-password')
  @HttpCode(200)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({ limit: 5, windowMs: 15 * 60_000, keyBy: 'ip', suffix: 'auth_changepwd' })
  async changePassword(
    @Body() body: { currentPassword: string; newPassword: string },
    @Req()  req:  Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    if (typeof body?.currentPassword !== 'string' ||
        typeof body?.newPassword     !== 'string') {
      throw new BadRequestException('currentPassword et newPassword requis');
    }
    await this.authService.changePassword(
      actor.id,
      body.currentPassword,
      body.newPassword,
      extractIp(req),
    );
    // Toutes les sessions (y compris courante) ont été invalidées — on
    // purge aussi le cookie côté client pour cohérence UX.
    res.clearCookie(COOKIE_NAME, { path: '/', sameSite: SAMESITE_DEV, secure: SECURE_COOKIE });
    return { ok: true };
  }

  /**
   * PATCH /api/auth/me/preferences
   *
   * Self-service : met à jour `locale` et/ou `timezone` dans User.preferences.
   * Les autres clés du JSON sont préservées (merge partiel).
   */
  @Patch('me/preferences')
  async updateMyPreferences(
    @Body()        body:  { locale?: string; timezone?: string },
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<{ locale: string | null; timezone: string | null }> {
    // Validation simple — les valeurs inconnues (locale non supportée, TZ
    // arbitraire) sont acceptées ; le frontend choisit dans des listes fixes.
    if (body.locale !== undefined &&
        (typeof body.locale !== 'string' || body.locale.length > 8)) {
      throw new BadRequestException('locale invalide');
    }
    if (body.timezone !== undefined &&
        (typeof body.timezone !== 'string' || body.timezone.length > 64)) {
      throw new BadRequestException('timezone invalide');
    }
    return this.authService.updateMyPreferences(actor.id, {
      locale:   body.locale,
      timezone: body.timezone,
    });
  }

  /**
   * POST /api/auth/sign-out
   *
   * Invalide la session côté serveur ET côté client (cookie cleared).
   */
  @Post('sign-out')
  @HttpCode(200)
  async signOut(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const token = this.extractToken(req);
    if (token) await this.authService.signOut(token);

    res.clearCookie(COOKIE_NAME, { path: '/', sameSite: SAMESITE_DEV, secure: SECURE_COOKIE });
    return { ok: true };
  }

  /**
   * GET /api/auth/impersonate/exchange?token=X
   *
   * Phase 2 cross-subdomain — endpoint public (pas de PermissionGuard — le token
   * signé HMAC fait autorité). Atterri sur le sous-domaine du tenant cible
   * via redirect depuis admin.translogpro.com.
   *
   * Flow :
   *   1. Super-admin clique "Impersonate tenantA" sur admin.translogpro.com
   *   2. Backend génère token one-shot → retourne redirectUrl vers
   *      tenanta.translogpro.com/api/auth/impersonate/exchange?token=...
   *   3. Frontend admin redirige la fenêtre vers cette URL
   *   4. Cet endpoint échange le token contre un cookie translog_session
   *      scopé au sous-domaine tenanta.
   *   5. Redirige vers "/" du tenant cible (page d'accueil).
   *
   * Le cookie admin sur admin.translogpro.com reste INTACT — pas d'override
   * ni de pollution. Pour revenir admin : l'admin rouvre admin.translogpro.com.
   *
   * SÉCURITÉ :
   *   - Le token est vérifié HMAC + one-shot (exchangedAt).
   *   - Le host doit matcher le tenant cible du token (anti-smuggling).
   *   - Audit log level=critical à chaque exchange.
   */
  @Get('impersonate/exchange')
  @HttpCode(302)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({ limit: 10, windowMs: 60 * 60_000, keyBy: 'ip', suffix: 'auth_imp_exchange' })
  async impersonateExchange(
    @Query('token') rawToken: string,
    @Req()          req:      Request,
    @Res()          res:      Response,
  ): Promise<void> {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new BadRequestException('Token d\'impersonation requis');
    }

    const hostTenant = req.resolvedHostTenant;
    if (!hostTenant) {
      throw new BadRequestException(
        'L\'échange doit être fait sur le sous-domaine du tenant cible',
      );
    }

    const result = await this.impersonationService.exchangeTokenForSession(
      rawToken,
      extractIp(req),
      req.headers['user-agent'] ?? '',
    );

    // Le token est signé pour `targetTenantId` : si le host actuel ne correspond
    // pas, refuser (anti-smuggling : un admin qui essaie d'injecter un token de
    // tenantA sur le sous-domaine de tenantB).
    if (result.targetTenantId !== hostTenant.tenantId) {
      throw new ForbiddenException(
        'Token d\'impersonation destiné à un autre tenant que ce sous-domaine',
      );
    }

    // Poser le cookie scopé au sous-domaine courant (pas de domain attribute)
    res.cookie(COOKIE_NAME, result.sessionToken, COOKIE_OPTS);

    // Redirect vers l'UI admin du tenant cible. Le frontend lira son tenant
    // depuis window.location.host et affichera la zone admin.
    res.redirect(302, '/admin');
  }

  // ─── Sessions self-service (page /account) ─────────────────────────────
  //
  // Trois endpoints pour qu'un utilisateur voie et révoque ses propres sessions
  // (ex: oublié déconnexion d'un poste public, vol de smartphone). La session
  // courante est marquée `isCurrent: true` ; on refuse sa suppression via
  // /sessions/:id (forcer le passage par /sign-out pour clear le cookie).

  @Get('sessions')
  async listSessions(
    @Req() req: Request,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const currentToken = this.extractToken(req);
    return this.authService.listUserSessions(user.id, currentToken);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(
    @Param('id') sessionId: string,
    @Req()       req:       Request,
    @CurrentUser() user:    CurrentUserPayload,
  ): Promise<void> {
    const currentToken = this.extractToken(req);
    await this.authService.revokeSessionById(user.id, sessionId, currentToken);
  }

  @Delete('sessions')
  @HttpCode(200)
  async revokeAllOtherSessions(
    @Req() req: Request,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ revoked: number }> {
    const currentToken = this.extractToken(req);
    const revoked = await this.authService.revokeAllOtherSessions(user.id, currentToken);
    return { revoked };
  }

  // ─── Helpers privés ───────────────────────────────────────────────────────

  private extractToken(req: Request): string | null {
    // Cookie (prioritaire — httpOnly, invisible JS)
    const cookie = req.cookies?.[COOKIE_NAME];
    if (typeof cookie === 'string' && cookie.length > 0) return cookie;

    // Bearer header (clients API, tests automatisés)
    const bearer = req.headers['authorization'];
    if (typeof bearer === 'string' && bearer.startsWith('Bearer ')) {
      return bearer.slice(7).trim() || null;
    }

    return null;
  }
}
