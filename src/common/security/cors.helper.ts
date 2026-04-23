/**
 * CORS helper — politique unique partagée entre l'HTTP (main.ts) et les
 * WebSocket Gateways (TrackingGateway, DisplayGateway).
 *
 * SECURITY FIRST :
 *   - Production : whitelist de regex stricts. Pas de `origin: '*'` sur des
 *     endpoints qui établissent des sessions ou émettent des données métier.
 *   - Dev : autorise Vite/Expo + tout sous-domaine `.translog.test`.
 *   - Toujours `credentials: true` car le frontend envoie le cookie
 *     httpOnly `translog_session`.
 *
 * Helper centralisé pour respecter la règle DRY : une seule source de
 * vérité pour la politique CORS.
 */

type OriginCallback = (err: Error | null, allow?: boolean) => void;
type OriginFn = (origin: string | undefined, cb: OriginCallback) => void;

const ENV_BASE_DOMAIN_KEYS = ['PUBLIC_BASE_DOMAIN', 'PLATFORM_BASE_DOMAIN'] as const;

/**
 * Liste des regex d'origines autorisées en PROD.
 * Construit dynamiquement depuis l'env var `PUBLIC_BASE_DOMAIN` (ou
 * `PLATFORM_BASE_DOMAIN` en fallback). Permet de configurer le domaine
 * sans modification de code.
 */
function buildProdOriginAllowlist(): RegExp[] {
  const env = process.env as Record<string, string | undefined>;
  const domains = ENV_BASE_DOMAIN_KEYS
    .map((k) => env[k])
    .filter((v): v is string => Boolean(v && v.trim()));

  // Fallback safe si rien n'est configuré : translogpro.com
  const list = domains.length > 0 ? domains : ['translogpro.com'];

  return list.map((d) => {
    // Échappe les points pour le regex
    const escaped = d.replace(/\./g, '\\.');
    return new RegExp(`^https:\\/\\/(?:[a-z0-9-]+\\.)?${escaped}(?::\\d+)?$`, 'i');
  });
}

const DEV_ALLOWED_LOCALHOSTS = new Set([
  'http://localhost:5173', // Vite frontend
  'http://localhost:5174', // Vite frontend (alt port)
  'http://localhost:8081', // Expo Metro
  'http://localhost:19006', // Expo Web
  'http://localhost:3000', // Backend self-call (rare)
]);

const DEV_TENANT_HOST_RE = /^https?:\/\/[^/]+\.translog\.test(?::\d+)?$/;

/**
 * Origine fonction utilisable dans `app.enableCors({ origin: ... })` et
 * `@WebSocketGateway({ cors: { origin: ... } })`.
 *
 * Comportement :
 *   - Pas d'origin (curl, server-to-server) → autorisé.
 *   - Dev : whitelist localhost + sous-domaines `.translog.test`.
 *   - Prod : whitelist regex sur PUBLIC_BASE_DOMAIN.
 */
export function corsOrigin(): OriginFn {
  const isDev = process.env.NODE_ENV !== 'production';
  const prodAllowlist = isDev ? [] : buildProdOriginAllowlist();

  return (origin, cb) => {
    if (!origin) return cb(null, true);
    if (isDev) {
      const allowed =
        DEV_ALLOWED_LOCALHOSTS.has(origin) || DEV_TENANT_HOST_RE.test(origin);
      return cb(null, allowed);
    }
    const allowed = prodAllowlist.some((re) => re.test(origin));
    return cb(null, allowed);
  };
}

/**
 * Bloc CORS prêt-à-l'emploi pour `@WebSocketGateway({ cors: ... })`.
 * Toujours `credentials: true` car les sockets héritent du cookie de session.
 */
export function websocketCorsConfig() {
  return {
    origin:      corsOrigin(),
    credentials: true,
  };
}
