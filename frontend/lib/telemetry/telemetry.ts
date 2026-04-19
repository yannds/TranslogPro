/**
 * Telemetry frontend — abstraction provider-agnostique.
 *
 * Capture :
 *   - `trackEvent(name, props?)` : événements métier (clics CTA, mutations UI)
 *   - `trackError(err, ctx?)`    : erreurs applicatives
 *   - `trackPageview(path)`      : navigation SPA
 *
 * Le driver par défaut loggue en console. En prod, appeler
 * `setTelemetryDriver(sentryDriver)` dans `main.tsx` après l'init DSN.
 *
 * Sécurité :
 *   - Pas de PII implicite — le caller est responsable de redacter.
 *   - Chaque event a un correlationId UUID court (ne fuit pas la session).
 */

export interface TelemetryContext {
  userId?:     string;
  tenantId?:   string;
  sessionId?:  string;
  route?:      string;
  correlationId?: string;
  /** Props additionnelles — doivent rester PII-free. */
  [key: string]: unknown;
}

export interface TelemetryDriver {
  event:    (name: string, ctx?: TelemetryContext) => void;
  error:    (err: unknown, ctx?: TelemetryContext) => void;
  pageview: (path: string, ctx?: TelemetryContext) => void;
}

// Pas de magic number : nom explicite pour la config log prefix.
const LOG_PREFIX = '[tlm]';

/** Driver par défaut — console uniquement (safe en dev). */
const consoleDriver: TelemetryDriver = {
  event(name, ctx) {
    // eslint-disable-next-line no-console
    console.info(LOG_PREFIX, 'event', name, ctx ?? {});
  },
  error(err, ctx) {
    // eslint-disable-next-line no-console
    console.error(LOG_PREFIX, 'error', err, ctx ?? {});
  },
  pageview(path, ctx) {
    // eslint-disable-next-line no-console
    console.info(LOG_PREFIX, 'pageview', path, ctx ?? {});
  },
};

let driver: TelemetryDriver = consoleDriver;

export function setTelemetryDriver(d: TelemetryDriver): void {
  driver = d;
}

function shortCorrelation(): string {
  // Pas cryptographique — suffit pour une corrélation humaine.
  return Math.random().toString(36).slice(2, 10);
}

export function trackEvent(name: string, ctx: TelemetryContext = {}): void {
  driver.event(name, { correlationId: shortCorrelation(), ...ctx });
}

export function trackError(err: unknown, ctx: TelemetryContext = {}): void {
  driver.error(err, { correlationId: shortCorrelation(), ...ctx });
}

export function trackPageview(path: string, ctx: TelemetryContext = {}): void {
  driver.pageview(path, { correlationId: shortCorrelation(), ...ctx });
}

/**
 * Handler global des Promise.unhandledrejection + window.onerror.
 * À appeler une fois au démarrage de l'app.
 */
export function installGlobalErrorCapture(): () => void {
  function onError(e: ErrorEvent) {
    trackError(e.error ?? e.message, { route: location.pathname, source: 'window.onerror' });
  }
  function onRejection(e: PromiseRejectionEvent) {
    trackError(e.reason, { route: location.pathname, source: 'unhandledrejection' });
  }
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
