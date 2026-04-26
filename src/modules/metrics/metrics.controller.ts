/**
 * MetricsController — expose GET /metrics au format Prometheus exposition.
 *
 * IMPORTANT : ce contrôleur est exclu du préfixe global `/api` (cf. main.ts),
 * pour que Prometheus puisse scraper sur l'URL canonique `/metrics`.
 *
 * Sécurité : l'endpoint est accessible sans auth car il n'est joignable que
 * depuis le réseau Docker overlay `translog_net` (Prometheus côté obs stack
 * est sur ce réseau partagé). Caddy ne route AUCUNE requête publique vers
 * /metrics — bloquée par la directive @api_path qui matche /api/* uniquement.
 */
import { Controller, Get, Header } from '@nestjs/common';
import { PublicRoute } from '../../common/decorators/public-route.decorator';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @PublicRoute('Prometheus scrape endpoint — accessible only via internal Docker overlay translog_net (no public route in Caddy)')
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  async getMetrics(): Promise<string> {
    return this.metrics.registry.metrics();
  }
}
