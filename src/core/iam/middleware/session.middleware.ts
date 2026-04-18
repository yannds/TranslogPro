/**
 * SessionMiddleware — Hydrate req.user depuis le cookie de session TranslogPro
 *
 * Lit le cookie `translog_session` (httpOnly, posé par AuthController.signIn),
 * vérifie la session en base, et injecte req.user pour les guards aval
 * (PermissionGuard, ModuleGuard, CurrentUser decorator, RlsMiddleware...).
 *
 * Sécurité :
 *   - IP binding : si l'IP change, la session est invalidée (prévient le hijacking)
 *   - Exception RFC 1918 / localhost (dev + NAT)
 *   - Bearer header accepté en fallback (clients API, tests automatisés)
 *   - Les routes sans session voient req.user = undefined
 *     → PermissionGuard protège les routes @RequirePermission
 *     → Les routes sans @RequirePermission sont explicitement publiques
 */

import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';

const COOKIE_NAME = 'translog_session';

type SessionRequest = Request & { user?: CurrentUserPayload };

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: SessionRequest, _res: Response, next: NextFunction): Promise<void> {
    const token = this.extractToken(req);

    if (!token) {
      return next();
    }

    try {
      const session = await this.prisma.session.findUnique({
        where:   { token },
        include: { user: { include: { role: true } } },
      });

      if (!session || session.expiresAt < new Date()) {
        return next();
      }

      const ip = this.extractIp(req);

      // IP binding : invalider si l'IP change (sauf RFC 1918 / localhost)
      if (!this.isPrivateOrLocal(ip) && session.ipAddress && session.ipAddress !== ip) {
        await this.prisma.session.delete({ where: { token } }).catch(() => {/* non-bloquant */});
        return next();
      }

      const { user } = session;

      req.user = {
        id:       user.id,
        tenantId: user.tenantId,
        agencyId: user.agencyId ?? undefined,
        roleId:   user.roleId   ?? '',
        roleName: user.role?.name ?? '',
        userType: user.userType,
      };

      // Tracking d'activité — throttle à ~5 min pour éviter un write par requête.
      // Source DAU/MAU exploitée par PlatformAnalyticsService (cron DailyActiveUser).
      // Fire-and-forget : le tracking ne doit jamais ralentir la requête.
      const now = Date.now();
      const last = user.lastActiveAt?.getTime() ?? 0;
      if (now - last > 5 * 60 * 1000) {
        this.prisma.user
          .update({ where: { id: user.id }, data: { lastActiveAt: new Date(now) } })
          .catch(() => { /* non-bloquant */ });
      }
    } catch {
      // Erreur DB — ne jamais bloquer la requête (let PermissionGuard reject)
    }

    return next();
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private extractToken(req: Request): string | null {
    // Cookie httpOnly (prioritaire)
    const cookie = (req.cookies as Record<string, string> | undefined)?.[COOKIE_NAME];
    if (typeof cookie === 'string' && cookie.length > 0) return cookie;

    // Bearer header (clients API, tests)
    const auth = req.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      return auth.slice(7).trim() || null;
    }

    return null;
  }

  private extractIp(req: Request): string {
    if (process.env['NODE_ENV'] === 'production') {
      const forwarded = req.headers['x-forwarded-for'];
      if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim() ?? '';
    }
    return req.ip ?? req.socket?.remoteAddress ?? '';
  }

  private isPrivateOrLocal(ip: string): boolean {
    return (
      ip === '127.0.0.1'       ||
      ip === '::1'             ||
      ip === '::ffff:127.0.0.1'||
      ip.startsWith('10.')     ||
      ip.startsWith('192.168.')||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
    );
  }
}
