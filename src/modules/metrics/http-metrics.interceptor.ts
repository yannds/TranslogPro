/**
 * HttpMetricsInterceptor — capture latence + status code de chaque requête
 * et incrémente les métriques Prometheus exposées sur /metrics.
 *
 * Stratégie route label :
 *   - Si Express a matché une route (req.route.path), on l'utilise.
 *   - Sinon (404 sur path inconnu), on tag "unmatched" pour éviter
 *     l'explosion de cardinalité (un attaquant qui fuzz /XXX...).
 */
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req  = http.getRequest<Request & { route?: { path?: string } }>();
    const res  = http.getResponse<Response>();
    const startNs = process.hrtime.bigint();

    return next.handle().pipe(
      tap({
        next:  () => this.record(req, res, startNs),
        error: () => this.record(req, res, startNs),
      }),
    );
  }

  private record(req: Request & { route?: { path?: string } }, res: Response, startNs: bigint): void {
    // /metrics ne doit pas s'auto-mesurer (sinon boucle de scrape pollue les
    // top-N et fausse le calcul de p95).
    if (req.path === '/metrics') return;

    const durationSec = Number(process.hrtime.bigint() - startNs) / 1e9;
    const route       = req.route?.path ?? 'unmatched';
    const method      = req.method;
    const statusCode  = String(res.statusCode);

    this.metrics.httpRequestsTotal.inc({ method, route, status_code: statusCode });
    this.metrics.httpRequestDurationSeconds.observe(
      { method, route, status_code: statusCode },
      durationSec,
    );
  }
}
