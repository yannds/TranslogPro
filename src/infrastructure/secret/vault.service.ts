import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as vault from 'node-vault';
import { ISecretService, VaultCertificate } from './interfaces/secret.interface';

/**
 * VaultService — client HashiCorp Vault avec initialisation lazy +
 * gestion automatique du cycle de vie du token AppRole.
 *
 * Pourquoi lazy et pas onModuleInit ?
 *   SecretModule est @Global() → NestJS lui attribue distance=0 et l'initialise
 *   APRÈS les modules à distance=1 (DatabaseModule, etc.). PrismaService appelait
 *   getSecret() avant que onModuleInit ait tourné → this.client undefined.
 *   Avec une init lazy, le client est créé au premier appel, quel que soit l'ordre.
 *
 * Cycle de vie du token (production AppRole) — fix 2026-04-26 :
 *   Le token AppRole a un TTL court (1h par défaut). Sans gestion, le backend
 *   tombe en "permission denied" au bout de 1h jusqu'au prochain restart.
 *   Solution en 2 garde-fous :
 *     1. **Renouvellement préventif** — un timer renew le token à 75% de son
 *        TTL. Si le renew échoue (TTL max atteint), on relogue avec AppRole.
 *     2. **Retry réactif** — si une opération renvoie 403/permission denied
 *        malgré tout (token révoqué, drift d'horloge…), on tente un AppRole
 *        login + un seul retry. Évite l'erreur opaque côté caller.
 */
@Injectable()
export class VaultService implements ISecretService, OnModuleDestroy {
  private readonly logger = new Logger(VaultService.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any | null = null;
  private cache = new Map<string, { value: string; expiresAt: number }>();
  private initPromise: Promise<void> | null = null;
  /** Timer de renew préventif (production AppRole uniquement). */
  private renewTimer: ReturnType<typeof setTimeout> | null = null;
  /** Re-login en cours — évite plusieurs logins concurrents sur le même 403. */
  private reloginPromise: Promise<void> | null = null;

  // ─── Initialisation lazy ─────────────────────────────────────────────────────

  private ensureClient(): Promise<void> {
    if (this.client) return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.initClient();
    return this.initPromise;
  }

  private async initClient(): Promise<void> {
    const vaultAddr = process.env.VAULT_ADDR;
    if (!vaultAddr) throw new Error('VAULT_ADDR environment variable is required');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vaultFactory = ((vault as any).default ?? vault) as (...args: any[]) => any;
    this.client = vaultFactory({
      apiVersion: 'v1',
      endpoint: vaultAddr,
      token: process.env.VAULT_TOKEN,
    });

    if (process.env.NODE_ENV === 'production') {
      await this.authenticateWithAppRole();
    }

    this.logger.log(`✅ Vault connected at ${vaultAddr}`);
  }

  // ─── Auth AppRole (production) ────────────────────────────────────────────────

  /**
   * Effectue un AppRole login et programme le renew préventif. Idempotent —
   * un second appel reset proprement le timer précédent.
   */
  private async authenticateWithAppRole(): Promise<void> {
    const roleId = process.env.VAULT_ROLE_ID;
    const secretId = process.env.VAULT_SECRET_ID;
    if (!roleId || !secretId) throw new Error('VAULT_ROLE_ID and VAULT_SECRET_ID required in production');
    const result = await this.client.approleLogin({ role_id: roleId, secret_id: secretId });
    this.client.token = result.auth.client_token;
    const leaseSeconds = (result.auth.lease_duration as number | undefined) ?? 3600;
    this.scheduleTokenRenewal(leaseSeconds, !!result.auth.renewable);
    this.logger.log(
      `🔑 Vault AppRole login OK (lease=${leaseSeconds}s, renewable=${result.auth.renewable})`,
    );
  }

  /**
   * Programme un renew préventif à 75% du lease. Si le renew échoue (TTL max
   * atteint, token révoqué), retombe sur un nouveau AppRole login.
   *
   * Garde-fous :
   *   - On annule tout timer précédent pour ne jamais avoir 2 renews concurrents.
   *   - Le timer est `unref()` pour ne pas bloquer le shutdown du process.
   *   - Lease < 60s → on saute le renew préventif et on s'appuie sur le retry
   *     réactif (cas tests, dev, ou config volontairement courte).
   */
  private scheduleTokenRenewal(leaseSeconds: number, renewable: boolean): void {
    if (this.renewTimer) {
      clearTimeout(this.renewTimer);
      this.renewTimer = null;
    }
    if (leaseSeconds < 60) return;

    // Renew à 75% du TTL (45 min sur 1h). Marge confortable pour un retry
    // d'urgence si le renew échoue (15 min restantes avant expiration).
    const renewInMs = Math.floor(leaseSeconds * 0.75) * 1000;
    const timer = setTimeout(() => {
      void this.tryTokenRenew(renewable);
    }, renewInMs);
    (timer as { unref?: () => void }).unref?.();
    this.renewTimer = timer;
  }

  /**
   * Renouvelle le token via `tokenRenewSelf` ou retombe sur un AppRole login
   * si le renew échoue (ce qui arrive quand `token_max_ttl` est atteint).
   */
  private async tryTokenRenew(renewable: boolean): Promise<void> {
    if (!this.client) return;
    try {
      if (renewable) {
        const renewed = await this.client.tokenRenewSelf();
        const leaseSeconds = (renewed.auth?.lease_duration as number | undefined) ?? 3600;
        this.scheduleTokenRenewal(leaseSeconds, !!renewed.auth?.renewable);
        this.logger.debug(`[Vault] token renew OK (lease=${leaseSeconds}s)`);
        return;
      }
      this.logger.debug('[Vault] token non renewable → AppRole re-login préventif');
      await this.authenticateWithAppRole();
    } catch (err) {
      // Renew échoué → re-login complet. Fallback final.
      this.logger.warn(
        `[Vault] tokenRenewSelf failed (${(err as Error).message}) → fallback AppRole re-login`,
      );
      try {
        await this.authenticateWithAppRole();
      } catch (loginErr) {
        // Pas de fallback supplémentaire — on log et on laisse le retry réactif
        // gérer l'opération suivante.
        this.logger.error(`[Vault] AppRole re-login a échoué`, loginErr);
      }
    }
  }

  /**
   * Détecte une erreur d'auth Vault (403, 401, "permission denied", token
   * expiré). On match large pour couvrir les divergences entre versions de
   * node-vault (le wrapping de l'erreur change entre 0.9.x et 0.10.x).
   */
  private isAuthError(err: unknown): boolean {
    const msg = (err as Error)?.message ?? '';
    return /\b40[13]\b|permission denied|invalid token|token is not renewable|token expired/i.test(msg);
  }

  /**
   * Wrapper retry — si une opération échoue avec une erreur d'auth, on tente
   * un AppRole re-login et on rejoue UNE seule fois. Tout autre échec
   * (404, network, validation) propage.
   *
   * Mutex `reloginPromise` : si plusieurs requêtes simultanées tombent sur
   * 403, une seule re-login s'exécute et les autres l'attendent.
   */
  private async withAuthRetry<T>(label: string, op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (!this.isAuthError(err)) throw err;
      if (process.env.NODE_ENV !== 'production') throw err;

      this.logger.warn(
        `[Vault] auth error on ${label} (${(err as Error).message}) — re-login + retry once`,
      );
      if (!this.reloginPromise) {
        this.reloginPromise = this.authenticateWithAppRole().finally(() => {
          this.reloginPromise = null;
        });
      }
      await this.reloginPromise;
      return op();
    }
  }

  // ─── API publique ─────────────────────────────────────────────────────────────

  async getSecret(path: string, key: string): Promise<string> {
    const cacheKey = `${path}::${key}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const obj = await this.getSecretObject(path);
    const value = (obj as Record<string, string>)[key];
    if (!value) throw new Error(`Secret not found: ${path}/${key}`);

    this.cache.set(cacheKey, { value, expiresAt: Date.now() + 30_000 });
    return value;
  }

  async getSecretObject<T = Record<string, string>>(path: string): Promise<T> {
    await this.ensureClient();
    try {
      const result = await this.withAuthRetry<{ data: { data: T } }>(
        `read ${path}`,
        () => this.client.read(`secret/data/${path}`),
      );
      return result.data.data as T;
    } catch (err) {
      const msg = (err as Error)?.message ?? '';
      if (msg.includes('404') || msg.includes('Status 404')) {
        this.logger.warn(`Secret not found at path: ${path} (provider may be unconfigured)`);
      } else {
        this.logger.error(`Failed to read secret at path: ${path}`, err);
      }
      throw new Error(`Vault secret read failed: ${path}`);
    }
  }

  async putSecret(path: string, data: Record<string, string>): Promise<void> {
    await this.ensureClient();
    await this.withAuthRetry(
      `write ${path}`,
      () => this.client.write(`secret/data/${path}`, { data }),
    );
    for (const [key] of this.cache) {
      if (key.startsWith(`${path}::`)) this.cache.delete(key);
    }
  }

  async deleteSecret(path: string): Promise<void> {
    await this.ensureClient();
    await this.withAuthRetry(
      `delete ${path}`,
      () => this.client.delete(`secret/metadata/${path}`),
    );
    for (const [key] of this.cache) {
      if (key.startsWith(`${path}::`)) this.cache.delete(key);
    }
  }

  async issueCertificate(commonName: string, ttl = '24h'): Promise<VaultCertificate> {
    await this.ensureClient();
    const result = await this.withAuthRetry<{
      data: { certificate: string; private_key: string; issuing_ca: string; serial_number: string };
    }>(
      `pki/issue ${commonName}`,
      () => this.client.write('pki/issue/translog-services', {
        common_name: commonName,
        ttl,
      }),
    );
    return {
      certificate: result.data.certificate,
      privateKey: result.data.private_key,
      issuingCa: result.data.issuing_ca,
      serialNumber: result.data.serial_number,
      expiresAt: new Date(Date.now() + this.parseTtl(ttl)),
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.ensureClient();
      await this.client.health();
      return true;
    } catch {
      return false;
    }
  }

  private parseTtl(ttl: string): number {
    const match = ttl.match(/^(\d+)([hmd])$/);
    if (!match) return 86400000;
    const value = parseInt(match[1]);
    const unit = match[2];
    const multipliers: Record<string, number> = { h: 3600000, m: 60000, d: 86400000 };
    return value * (multipliers[unit] ?? 3600000);
  }

  /** Nettoie le timer de renew au shutdown pour ne pas bloquer Jest/process.exit. */
  onModuleDestroy(): void {
    if (this.renewTimer) {
      clearTimeout(this.renewTimer);
      this.renewTimer = null;
    }
  }
}
