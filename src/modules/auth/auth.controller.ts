import {
  Controller, Post, Get, Body, Req, Res,
  HttpCode, UseGuards, UnauthorizedException, BadRequestException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService, AuthUserDto } from './auth.service';
import { SignInDto } from './dto/sign-in.dto';
import {
  RateLimit,
  RedisRateLimitGuard,
} from '../../common/guards/redis-rate-limit.guard';

const COOKIE_NAME = 'translog_session';

const COOKIE_OPTS = {
  httpOnly:  true,
  sameSite:  'strict' as const,   // CSRF: strict > lax pour un portail admin
  secure:    process.env.NODE_ENV === 'production',
  maxAge:    30 * 24 * 3600 * 1_000,
  path:      '/',
};

/** Cookie pré-session MFA — TTL 5 min, distinct du cookie de session.
 *  /auth/me NE LE LIT PAS, donc impossible d'accéder à l'API tant que le
 *  challenge n'est pas finalisé via /auth/mfa/verify. */
const MFA_COOKIE_NAME = 'translog_mfa_challenge';
const MFA_COOKIE_OPTS = {
  httpOnly:  true,
  sameSite:  'strict' as const,
  secure:    process.env.NODE_ENV === 'production',
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
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /api/auth/sign-in
   *
   * Rate-limit : 5 tentatives / 15 minutes par IP (PRD §IV.6)
   * DTO : validation stricte email + password (whitelist + forbidNonWhitelisted)
   */
  @Post('sign-in')
  @HttpCode(200)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({ limit: 5, windowMs: 15 * 60_000, keyBy: 'ip', suffix: 'auth_signin' })
  async signIn(
    @Body() dto:  SignInDto,
    @Req()  req:  Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<AuthUserDto, 'roleId'> & { roleId: string | null }> {
    // Le tenant est résolu depuis le Host par TenantHostMiddleware
    // (voir core/tenancy). Sans sous-domaine tenant valide, on refuse le login
    // — pas de fallback "global" : un cookie doit être scopé à un sous-domaine.
    const tenantId = req.resolvedHostTenant?.tenantId;
    if (!tenantId) {
      throw new BadRequestException(
        'Sous-domaine tenant requis pour s\'authentifier. ' +
        'Utilisez https://{votre-tenant}.translogpro.com/login',
      );
    }

    const { token, user } = await this.authService.signIn(
      tenantId,
      dto.email,
      dto.password,
      extractIp(req),
      req.headers['user-agent'] ?? '',
    );

    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    return user;
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

    const { token, user } = await this.authService.verifyMfa(
      challengeToken,
      body.code,
      extractIp(req),
      req.headers['user-agent'] ?? '',
    );

    res.clearCookie(MFA_COOKIE_NAME, { path: '/', sameSite: 'strict' });
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    return user;
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

    res.clearCookie(COOKIE_NAME, { path: '/', sameSite: 'strict' });
    return { ok: true };
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
