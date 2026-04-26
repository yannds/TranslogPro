/**
 * MetricsService — registry prom-client centralisé.
 *
 * Expose un Counter + Histogram pour les requêtes HTTP, plus le registry par
 * défaut prom-client (qui collecte automatiquement les métriques Node.js :
 * heap, GC, event loop lag, RSS, file descriptors, etc.).
 *
 * L'endpoint GET /metrics (cf. MetricsController) sérialise tout le registry
 * au format Prometheus exposition.
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
} from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();

  /** Compteur de requêtes par route × méthode × status. */
  readonly httpRequestsTotal: Counter;

  /** Histogramme latence HTTP en secondes par route × méthode × status. */
  readonly httpRequestDurationSeconds: Histogram;

  constructor() {
    this.registry.setDefaultLabels({ app: 'translog_api' });

    // Métriques Node.js par défaut (heap, GC, event loop, …)
    collectDefaultMetrics({ register: this.registry, prefix: 'translog_' });

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests processed by the API.',
      labelNames: ['method', 'route', 'status_code'] as const,
      registers: [this.registry],
    });

    this.httpRequestDurationSeconds = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds, by route × method × status.',
      labelNames: ['method', 'route', 'status_code'] as const,
      // Buckets adaptés API REST (ms → s) : 5ms à 10s
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });
  }

  onModuleInit(): void {
    // Hook réservé pour métriques applicatives futures (ex: nb tenants actifs,
    // queue depth, etc.). Aujourd'hui les compteurs ci-dessus suffisent.
  }
}
