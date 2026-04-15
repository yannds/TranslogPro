import {
  Controller, Post, Get, Body, Req, Res,
  HttpCode, UseGuards, UnauthorizedException,
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
    const { token, user } = await this.authService.signIn(
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
  async me(@Req() req: Request): Promise<AuthUserDto> {
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('Token de session absent');

    return this.authService.me(token, extractIp(req));
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
