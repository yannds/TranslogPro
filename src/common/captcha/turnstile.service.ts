/**
 * TurnstileService — Validation Cloudflare Turnstile (CAPTCHA).
 *
 * Cloudflare Turnstile est une alternative gratuite à hCAPTCHA/reCAPTCHA,
 * sans cookies tiers ni collecte PII. On reçoit un `turnstile-token` du widget
 * frontend, on appelle l'endpoint `siteverify` qui retourne `{ success, ... }`.
 *
 * Secrets : Vault path `platform/captcha/turnstile` → { SECRET_KEY }.
 * En dev local, si le secret n'est pas provisionné, le service est "inactif"
 * (`isConfigured()` renvoie false) — le TurnstileGuard bascule en mode
 * fail-open avec un log d'avertissement. Cela évite de bloquer le dev tant
 * qu'aucun compte Cloudflare n'a été configuré.
 *
 * Cache : un token validé est marqué consommé en mémoire (Map + TTL 5 min)
 * pour empêcher le replay immédiat par un attaquant qui intercepterait le
 * token côté client (TLS protège déjà mais ceinture + bretelles).
 */
import { Injectable, Logger, Inject } from '@nestjs/common';
import { ISecretService, SECRET_SERVICE } from '../../infrastructure/secret/interfaces/secret.interface';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const USED_TOKEN_TTL_MS = 5 * 60_000;  // 5 min — même fenêtre que Turnstile
const CONFIG_CACHE_TTL_MS = 5 * 60_000;

@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);
  private usedTokens = new Map<string, number>();
  private cachedSecret: { value: string | null; fetchedAt: number } | null = null;

  constructor(
    @Inject(SECRET_SERVICE) private readonly secrets: ISecretService,
  ) {}

  /** Vrai si le service est configuré (secret Vault présent). */
  async isConfigured(): Promise<boolean> {
    return !!(await this.getSecretKey());
  }

  /**
   * Vérifie un token Turnstile auprès de Cloudflare.
   * Retourne true si le token est valide, unique (pas de replay récent) et frais.
   *
   * Sur erreur réseau ou config manquante → retourne false (fail-closed par
   * défaut ; le Guard décide du fail-open explicite via config tenant).
   */
  async verify(token: string | null | undefined, remoteIp?: string): Promise<{ ok: boolean; reason?: string }> {
    if (!token) return { ok: false, reason: 'missing_token' };

    // Replay protection in-memory
    this.purgeExpiredTokens();
    if (this.usedTokens.has(token)) {
      return { ok: false, reason: 'token_already_used' };
    }

    const secret = await this.getSecretKey();
    if (!secret) return { ok: false, reason: 'not_configured' };

    try {
      const body = new URLSearchParams({ secret, response: token });
      if (remoteIp) body.set('remoteip', remoteIp);

      const res = await fetch(SITEVERIFY_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const json = await res.json() as { success: boolean; 'error-codes'?: string[] };
      if (!json.success) {
        this.logger.warn(`[Turnstile] verify rejected: ${(json['error-codes'] ?? []).join(',') || 'unknown'}`);
        return { ok: false, reason: 'cloudflare_rejected' };
      }

      // Marquer comme consommé
      this.usedTokens.set(token, Date.now() + USED_TOKEN_TTL_MS);
      return { ok: true };
    } catch (err) {
      this.logger.error(`[Turnstile] verify failed: ${(err as Error).message}`);
      return { ok: false, reason: 'network_error' };
    }
  }

  // ── Internes ─────────────────────────────────────────────────────────────

  private async getSecretKey(): Promise<string | null> {
    const now = Date.now();
    if (this.cachedSecret && (now - this.cachedSecret.fetchedAt) < CONFIG_CACHE_TTL_MS) {
      return this.cachedSecret.value;
    }
    try {
      const secret = await this.secrets.getSecretObject<{ SECRET_KEY?: string }>(
        'platform/captcha/turnstile',
      );
      const value = secret?.SECRET_KEY && secret.SECRET_KEY.trim().length > 0
        ? secret.SECRET_KEY.trim()
        : null;
      this.cachedSecret = { value, fetchedAt: now };
      return value;
    } catch {
      // Vault path absent → pas de captcha configuré
      this.cachedSecret = { value: null, fetchedAt: now };
      return null;
    }
  }

  private purgeExpiredTokens(): void {
    const now = Date.now();
    for (const [token, expiry] of this.usedTokens.entries()) {
      if (expiry <= now) this.usedTokens.delete(token);
    }
  }
}
