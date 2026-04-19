/**
 * Telemetry mobile — miroir du frontend, adapté React Native.
 * Driver par défaut : console.log. Injectable via setTelemetryDriver().
 */

export interface TelemetryContext {
  userId?:        string;
  tenantId?:      string;
  sessionId?:     string;
  route?:         string;
  correlationId?: string;
  [key: string]:  unknown;
}

export interface TelemetryDriver {
  event:    (name: string, ctx?: TelemetryContext) => void;
  error:    (err: unknown, ctx?: TelemetryContext) => void;
  pageview: (path: string, ctx?: TelemetryContext) => void;
}

const LOG_PREFIX = '[tlm-mobile]';

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
export function setTelemetryDriver(d: TelemetryDriver): void { driver = d; }

function shortCorrelation(): string {
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
 * Hook global — à appeler une fois dans App.tsx.
 * Capture les erreurs JS non attrapées via ErrorUtils (React Native).
 */
export function installGlobalErrorCapture(): void {
  const G = (globalThis as unknown as {
    ErrorUtils?: { setGlobalHandler: (fn: (err: Error, isFatal?: boolean) => void) => void };
  });
  G.ErrorUtils?.setGlobalHandler((err, isFatal) => {
    trackError(err, { source: 'ErrorUtils', isFatal: Boolean(isFatal) });
  });
}
