/**
 * AuditLoggingInterceptor — Traçabilité exhaustive ISO 27001
 *
 * Capture pour chaque action mutante (POST / PUT / PATCH / DELETE) et LOGIN :
 *   Who    : userId, roleName, IP
 *   When   : timestamp ISO 8601 (géré par AuditLog.createdAt @default(now()))
 *   Where  : module déduit de l'URL, endpoint complet
 *   What   : type d'action (READ / WRITE / DELETE / LOGIN / EXPORT)
 *   Context: tenantId, requestId, userAgent
 *   Outcome: statusCode (Success / Failure), message d'erreur si applicable
 *
 * Les GETs non sensibles ne sont PAS tracés pour limiter le volume.
 * L'écriture est fire-and-forget (ne bloque pas la réponse).
 * En cas d'échec d'écriture, l'erreur est loggée mais NE propage PAS.
 */
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { CurrentUserPayload } from '../decorators/current-user.decorator';

// ─── Types internes ────────────────────────────────────────────────────────────

type AuditReq = Request & {
  user?:   CurrentUserPayload;
  params:  Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
};

// ─── Constantes ────────────────────────────────────────────────────────────────

/** Préfixes de routes ignorés (health, metrics, assets). */
const SKIP_PREFIXES = ['/health', '/metrics', '/_', '/favicon', '/static'];

/** Méthodes HTTP systématiquement tracées. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ─── Helpers purs ──────────────────────────────────────────────────────────────

/**
 * Détermine le type d'action sémantique à partir de la méthode HTTP et du chemin.
 * Conforme au PRD : READ | WRITE | DELETE | LOGIN | EXPORT
 */
function deriveActionType(method: string, path: string): string {
  const p = path.toLowerCase();
  if (p.includes('/auth/') || p.endsWith('/login') || p.includes('/sign-in'))
    return 'LOGIN';
  if (p.includes('/export') || p.includes('/csv') || p.includes('/download'))
    return 'EXPORT';
  switch (method.toUpperCase()) {
    case 'GET':    return 'READ';
    case 'POST':   return 'WRITE';
    case 'PUT':
    case 'PATCH':  return 'WRITE';
    case 'DELETE': return 'DELETE';
    default:       return method.toUpperCase();
  }
}

/** Dérive le module fonctionnel impacté depuis l'URL. */
function extractModule(path: string): string {
  // /api/tenants/:id/<module>/... → segment après l'ID tenant
  const parts  = path.split('/').filter(Boolean);
  const tidIdx = parts.indexOf('tenants');
  if (tidIdx !== -1 && parts.length > tidIdx + 2) {
    return parts[tidIdx + 2] ?? 'unknown';
  }
  // /api/<module>/... (routes sans tenant)
  return parts[2] ?? 'core';
}

/** Niveau de sévérité ISO 27001 depuis le status HTTP. */
function levelFromStatus(status: number): string {
  if (status >= 500) return 'critical';
  if (status >= 400) return 'warn';
  return 'info';
}

/**
 * Niveau de sécurité de la donnée (classification ISO 27001).
 *   RESTRICTED   — opérations de contrôle (plane=control) ou erreurs serveur
 *   CONFIDENTIAL — opérations sensibles (warn) ou mutations authentifiées
 *   INTERNAL     — opérations routinières authentifiées
 */
function securityLevelFromContext(actionKind: string, status: number): string {
  if (status >= 500) return 'RESTRICTED';
  if (actionKind === 'LOGIN') return 'INTERNAL';
  if (status >= 400) return 'CONFIDENTIAL';
  if (actionKind === 'DELETE') return 'CONFIDENTIAL';
  return 'INTERNAL';
}

/** Extrait l'IP réelle en tenant compte des proxies. */
function extractIp(req: AuditReq): string {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) {
    const first = Array.isArray(fwd) ? fwd[0] : fwd.split(',')[0];
    return first?.trim() ?? 'unknown';
  }
  return (req as any).ip ?? (req as any).socket?.remoteAddress ?? 'unknown';
}

// ─── Intercepteur ──────────────────────────────────────────────────────────────

@Injectable()
export class AuditLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('ISO27001-Audit');

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req  = context.switchToHttp().getRequest<AuditReq>();
    const path = req.path ?? req.url ?? '';

    // Ignorer les routes système
    if (SKIP_PREFIXES.some(p => path.startsWith(p))) return next.handle();

    const actionKind = deriveActionType(req.method, path);
    const shouldLog  = MUTATING_METHODS.has(req.method.toUpperCase()) || actionKind === 'LOGIN';

    if (!shouldLog) return next.handle();

    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const res        = context.switchToHttp().getResponse<Response>();
          const statusCode = res.statusCode ?? 200;
          this.persist(req, path, actionKind, statusCode, Date.now() - start, null);
        },
        error: (err: unknown) => {
          const statusCode = (err as any)?.status ?? (err as any)?.statusCode ?? 500;
          const message    = (err as any)?.message ?? 'Erreur interne';
          this.persist(req, path, actionKind, statusCode, Date.now() - start, message);
        },
      }),
    );
  }

  /** Écrit l'entrée dans AuditLog — fire-and-forget, ne bloque pas la réponse. */
  private persist(
    req:        AuditReq,
    path:       string,
    actionKind: string,
    statusCode: number,
    durationMs: number,
    errorMsg:   string | null,
  ): void {
    // Ne tracer que les routes ayant un contexte tenant identifiable
    const tenantId = req.params?.['tenantId'] ?? req.user?.tenantId;
    if (!tenantId) return;

    const reqId = req.headers['x-request-id'] as string | undefined;

    const newValue: Record<string, unknown> = {
      // What
      actionType:  actionKind,
      method:      req.method.toUpperCase(),
      module:      extractModule(path),
      endpoint:    path,
      // Context
      tenantId,
      requestId:   reqId ?? null,
      userAgent:   (req.headers['user-agent'] as string | undefined) ?? null,
      // Who (enrichissement)
      roleName:    req.user?.roleName ?? null,
      agencyId:    req.user?.agencyId ?? null,
      // Outcome
      statusCode,
      durationMs,
      outcome:     statusCode < 400 ? 'SUCCESS' : 'FAILURE',
      ...(errorMsg ? { errorMessage: errorMsg } : {}),
    };

    this.prisma.auditLog.create({
      data: {
        tenantId,
        userId:        req.user?.id ?? null,
        plane:         'http',
        level:         levelFromStatus(statusCode),
        action:        `${actionKind}:${req.method.toUpperCase()} ${path}`,
        resource:      path,
        ipAddress:     extractIp(req),
        securityLevel: securityLevelFromContext(actionKind, statusCode),
        newValue:      newValue as any,
      },
    }).catch((err: unknown) => {
      // Échec silencieux pour ne pas impacter la réponse métier
      this.logger.warn(`AuditLog persist failed: ${(err as Error).message}`);
    });
  }
}
