import { Injectable, Logger } from '@nestjs/common';
import * as vault from 'node-vault';
import { ISecretService, VaultCertificate } from './interfaces/secret.interface';

/**
 * VaultService — client HashiCorp Vault avec initialisation lazy.
 *
 * Pourquoi lazy et pas onModuleInit ?
 * SecretModule est @Global() → NestJS lui attribue distance=0 et l'initialise
 * APRÈS les modules à distance=1 (DatabaseModule, etc.). PrismaService appelait
 * getSecret() avant que onModuleInit ait tourné → this.client undefined.
 * Avec une init lazy, le client est créé au premier appel, quel que soit l'ordre.
 */
@Injectable()
export class VaultService implements ISecretService {
  private readonly logger = new Logger(VaultService.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any | null = null;
  private cache = new Map<string, { value: string; expiresAt: number }>();
  private initPromise: Promise<void> | null = null;

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

  private async authenticateWithAppRole(): Promise<void> {
    const roleId = process.env.VAULT_ROLE_ID;
    const secretId = process.env.VAULT_SECRET_ID;
    if (!roleId || !secretId) throw new Error('VAULT_ROLE_ID and VAULT_SECRET_ID required in production');
    const result = await this.client.approleLogin({ role_id: roleId, secret_id: secretId });
    this.client.token = result.auth.client_token;
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
      const result = await this.client.read(`secret/data/${path}`);
      return result.data.data as T;
    } catch (err) {
      this.logger.error(`Failed to read secret at path: ${path}`, err);
      throw new Error(`Vault secret read failed: ${path}`);
    }
  }

  async putSecret(path: string, data: Record<string, string>): Promise<void> {
    await this.ensureClient();
    await this.client.write(`secret/data/${path}`, { data });
    for (const [key] of this.cache) {
      if (key.startsWith(`${path}::`)) this.cache.delete(key);
    }
  }

  async issueCertificate(commonName: string, ttl = '24h'): Promise<VaultCertificate> {
    await this.ensureClient();
    const result = await this.client.write('pki/issue/translog-services', {
      common_name: commonName,
      ttl,
    });
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
}
