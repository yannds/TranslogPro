import { Injectable, Logger, Inject, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { ISecretService, SECRET_SERVICE } from '../../../infrastructure/secret/interfaces/secret.interface';

/**
 * QR payload — PRD §IV.1
 * Format signé : HMAC-SHA256(ticketId:tripId:seatNumber, tenant_hmac_key_vault)
 *
 * Le seatNumber est inclus dans la signature pour empêcher la réutilisation
 * d'un QR sur un siège différent (fraude de transfert de billet).
 */
export interface QrPayload {
  ticketId:   string;
  tenantId:   string;
  tripId:     string;
  seatNumber: string;   // obligatoire — partie de la signature
  issuedAt:   number;   // unix ms
}

/**
 * HMAC-SHA256 QR code service.
 *
 * Clé par tenant stockée dans Vault :
 *   secret/tenants/{tenantId}/hmac  →  { KEY: "hex-32-bytes" }
 *
 * Format token :  base64url(payload_json) + "." + hex(hmac)
 *
 * La comparaison de signature est toujours en temps constant (timingSafeEqual)
 * pour résister aux timing attacks.
 */
@Injectable()
export class QrService {
  private readonly logger = new Logger(QrService.name);
  private readonly keyCache = new Map<string, { key: string; cachedAt: number }>();
  private readonly KEY_TTL_MS = 5 * 60 * 1_000; // 5 min — aligné sur le TTL cache Vault

  constructor(
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
  ) {}

  async sign(payload: QrPayload): Promise<string> {
    this.assertPayloadComplete(payload);
    const key  = await this.getTenantKey(payload.tenantId);
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig  = this.hmac(key, data);
    return `${data}.${sig}`;
  }

  async verify(token: string, tenantId: string): Promise<QrPayload> {
    const dot = token.lastIndexOf('.');
    if (dot === -1) throw new UnauthorizedException('Invalid QR token format');

    const data = token.slice(0, dot);
    const sig  = token.slice(dot + 1);

    const key      = await this.getTenantKey(tenantId);
    const expected = this.hmac(key, data);

    // Constant-time comparison — résiste aux timing attacks
    const sigBuf = Buffer.from(sig,      'hex');
    const expBuf = Buffer.from(expected, 'hex');

    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new UnauthorizedException('QR token signature invalide');
    }

    let payload: QrPayload;
    try {
      payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as QrPayload;
    } catch {
      throw new UnauthorizedException('QR token payload corrompu');
    }

    // Vérification cross-tenant — empêche l'utilisation d'un QR d'un autre tenant
    if (payload.tenantId !== tenantId) {
      throw new UnauthorizedException('QR token tenant mismatch');
    }

    // Vérification présence seatNumber — les tokens sans seatNumber sont rejetés
    if (!payload.seatNumber) {
      throw new UnauthorizedException('QR token incomplet — seatNumber manquant');
    }

    return payload;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private hmac(key: string, data: string): string {
    return createHmac('sha256', key).update(data).digest('hex');
  }

  private assertPayloadComplete(payload: QrPayload): void {
    const missing = (['ticketId', 'tenantId', 'tripId', 'seatNumber'] as const)
      .filter(f => !payload[f]);
    if (missing.length > 0) {
      throw new Error(`QR payload incomplet — champs manquants: ${missing.join(', ')}`);
    }
  }

  private async getTenantKey(tenantId: string): Promise<string> {
    const cached = this.keyCache.get(tenantId);
    if (cached && Date.now() - cached.cachedAt < this.KEY_TTL_MS) {
      return cached.key;
    }

    const secret = await this.secretService.getSecretObject<{ KEY: string }>(
      `tenants/${tenantId}/hmac`,
    );

    if (!secret.KEY || secret.KEY.length < 32) {
      throw new Error(`Clé HMAC insuffisante pour tenant ${tenantId} — minimum 32 caractères`);
    }

    this.keyCache.set(tenantId, { key: secret.KEY, cachedAt: Date.now() });
    return secret.KEY;
  }
}
