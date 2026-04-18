/**
 * PayloadEncryptor — chiffrement AES-256-GCM des payloads bruts provider.
 *
 * Les champs `PaymentAttempt.requestEnc` et `PaymentAttempt.responseEnc`
 * stockent des requêtes/réponses contenant potentiellement des identifiants
 * clients (numéros de téléphone, emails, références). On les chiffre au repos
 * pour limiter l'impact d'un dump DB.
 *
 * Clé : 32 octets en hex dans Vault (clé "KEY" au path configuré par
 * PlatformPaymentConfig.payloadEncryptionVaultPath, défaut 'platform/payments/app-key').
 *
 * Format du token émis : `iv_b64.tag_b64.ciphertext_b64` (3 segments dot-separated).
 *
 * Rotation de clé : on peut ajouter une "KEY_PREV" pour decrypt legacy ; pas
 * implémenté ici — scope Phase ultérieure (cron qui ré-encrypte).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { ISecretService, SECRET_SERVICE } from '../secret/interfaces/secret.interface';

const ALGO         = 'aes-256-gcm';
const KEY_BYTES    = 32;
const IV_BYTES     = 12;          // GCM : 96 bits recommandés
const TAG_BYTES    = 16;
const CACHE_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_VAULT_PATH = 'platform/payments/app-key';

@Injectable()
export class PayloadEncryptor {
  private readonly log = new Logger(PayloadEncryptor.name);
  private keyCache: { key: Buffer; cachedAt: number } | null = null;
  private vaultPath = DEFAULT_VAULT_PATH;

  constructor(
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
  ) {}

  /** Permet au bootstrap (PlatformPaymentConfig.payloadEncryptionVaultPath) de surcharger le path. */
  setVaultPath(path: string): void {
    if (path && path !== this.vaultPath) {
      this.vaultPath = path;
      this.keyCache = null;
    }
  }

  /** Chiffre une chaîne arbitraire. Retourne un token `iv.tag.ct` base64. */
  async encrypt(plaintext: string): Promise<string> {
    const key = await this.getKey();
    const iv  = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, key, iv);
    const ct  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
  }

  /** Déchiffre un token produit par `encrypt`. Rejette tout token mal formé. */
  async decrypt(token: string): Promise<string> {
    const [ivB64, tagB64, ctB64] = token.split('.');
    if (!ivB64 || !tagB64 || !ctB64) throw new Error('Malformed encrypted payload');
    const iv  = Buffer.from(ivB64,  'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const ct  = Buffer.from(ctB64,  'base64');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new Error('Invalid IV or auth tag length');
    }
    const key = await this.getKey();
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  }

  /** Sérialise + chiffre un objet JSON. null/undefined → null (ne chiffre rien). */
  async encryptJson(obj: unknown | null | undefined): Promise<string | null> {
    if (obj === null || obj === undefined) return null;
    return this.encrypt(JSON.stringify(obj));
  }

  async decryptJson<T = unknown>(token: string | null): Promise<T | null> {
    if (!token) return null;
    return JSON.parse(await this.decrypt(token)) as T;
  }

  // ── privé ──────────────────────────────────────────────────────────────────

  private async getKey(): Promise<Buffer> {
    const now = Date.now();
    if (this.keyCache && now - this.keyCache.cachedAt < CACHE_TTL_MS) {
      return this.keyCache.key;
    }
    const obj = await this.secretService.getSecretObject<{ KEY: string }>(this.vaultPath);
    if (!obj.KEY) throw new Error(`PayloadEncryptor: clé absente (${this.vaultPath}/KEY)`);
    const key = Buffer.from(obj.KEY, 'hex');
    if (key.length !== KEY_BYTES) {
      throw new Error(`PayloadEncryptor: clé invalide (attendu ${KEY_BYTES} octets, reçu ${key.length})`);
    }
    this.keyCache = { key, cachedAt: now };
    return key;
  }
}
