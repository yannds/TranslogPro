import { Injectable, Inject, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { randomBytes } from 'crypto';
import { REDIS_CLIENT } from '../../infrastructure/eventbus/redis-publisher.service';
import type { OAuthStatePayload } from './types';
import { OAuthError } from './types';

const STATE_TTL_SEC = 10 * 60;          // 10 min — suffit pour un round-trip OAuth
const STATE_NONCE_BYTES = 32;            // 256 bits entropy
const REDIS_KEY_PREFIX = 'oauth:state:';

/**
 * Émet et vérifie les states CSRF pour le flow OAuth.
 *
 * Le state est un identifiant opaque court (nonce) — le payload complet
 * (provider, tenant, returnTo) est stocké côté serveur en Redis avec TTL
 * 10 min et flag one-shot (supprimé à la vérification).
 *
 * Avantage vs HMAC signé : pas de secret à gérer, révocation immédiate,
 * one-shot strict par suppression de la clé.
 */
@Injectable()
export class OAuthStateService {
  private readonly log = new Logger(OAuthStateService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Génère un state opaque et enregistre son payload. */
  async issue(payload: Omit<OAuthStatePayload, 'nonce' | 'issuedAt'>): Promise<string> {
    const nonce = randomBytes(STATE_NONCE_BYTES).toString('hex');
    const full: OAuthStatePayload = { ...payload, nonce, issuedAt: Date.now() };
    await this.redis.set(
      `${REDIS_KEY_PREFIX}${nonce}`,
      JSON.stringify(full),
      'EX',
      STATE_TTL_SEC,
    );
    return nonce;
  }

  /**
   * Vérifie et consomme (one-shot) un state. Lance OAuthError("INVALID_STATE")
   * si absent, expiré, ou si le providerKey ne correspond pas.
   */
  async consume(stateNonce: string, expectedProviderKey: string): Promise<OAuthStatePayload> {
    if (!stateNonce || typeof stateNonce !== 'string') {
      throw new OAuthError('INVALID_STATE', 'State manquant');
    }

    const key = `${REDIS_KEY_PREFIX}${stateNonce}`;
    const raw = await this.redis.get(key);
    if (!raw) {
      throw new OAuthError('INVALID_STATE', 'State expiré ou inconnu');
    }

    // One-shot : supprime AVANT de parser, pour éviter les rejeux en cas
    // d'erreur intermittente sur le parse.
    await this.redis.del(key);

    try {
      const payload = JSON.parse(raw) as OAuthStatePayload;
      if (payload.providerKey !== expectedProviderKey) {
        throw new OAuthError('INVALID_STATE',
          `State provider mismatch: expected=${expectedProviderKey} got=${payload.providerKey}`,
        );
      }
      return payload;
    } catch (err) {
      this.log.error('[OAuth] failed to parse state', err);
      throw new OAuthError('INVALID_STATE', 'State corrompu');
    }
  }
}
