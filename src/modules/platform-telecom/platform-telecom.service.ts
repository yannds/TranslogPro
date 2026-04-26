/**
 * PlatformTelecomService — vue d'administration des providers SMS / WhatsApp.
 *
 * Symétrique à PlatformEmailService :
 *   - Liste des providers (sms, whatsapp) avec état Vault + dernier healthcheck.
 *   - Lecture credentials depuis Vault (secrets masqués `••••••••`).
 *   - Écriture credentials Vault (merge — si secret laissé masqué on conserve).
 *   - Healthcheck : valide la présence des creds Vault + tente un appel API
 *     Twilio (Accounts/{sid}.json) pour vérifier l'authentification.
 *
 * Twilio est aujourd'hui le seul backend SMS/WhatsApp ; le module est
 * extensible : ajouter une entrée dans PROVIDER_DEFAULTS et router via
 * `resolveService(key)`.
 */
import { Injectable, Logger, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ISecretService, SECRET_SERVICE } from '../../infrastructure/secret/interfaces/secret.interface';

export type TelecomProviderName = 'sms' | 'whatsapp';

export interface ProviderField {
  key:        string;
  label:      string;
  secret?:    boolean;
  required?:  boolean;
  type?:      'text' | 'email' | 'password' | 'number' | 'boolean';
  hint?:      string;
}

const PROVIDER_DEFAULTS: ReadonlyArray<{
  key:         TelecomProviderName;
  displayName: string;
  vaultPath:   string;
  fields:      ReadonlyArray<ProviderField>;
}> = [
  {
    key: 'sms', displayName: 'Twilio SMS', vaultPath: 'platform/sms',
    fields: [
      { key: 'ACCOUNT_SID', label: 'Account SID',  required: true,
        hint: 'Identifiant compte Twilio — commence par AC…' },
      { key: 'AUTH_TOKEN',  label: 'Auth Token',   required: true, secret: true, type: 'password',
        hint: 'Token API Twilio (32 caractères hex)' },
      { key: 'FROM_NUMBER', label: 'Numéro émetteur', required: true,
        hint: 'Numéro Twilio E.164 — ex: +14155552671' },
    ],
  },
  {
    key: 'whatsapp', displayName: 'Twilio WhatsApp', vaultPath: 'platform/whatsapp',
    fields: [
      { key: 'ACCOUNT_SID', label: 'Account SID',  required: true,
        hint: 'Identifiant compte Twilio — commence par AC…' },
      { key: 'AUTH_TOKEN',  label: 'Auth Token',   required: true, secret: true, type: 'password',
        hint: 'Token API Twilio (32 caractères hex)' },
      { key: 'FROM_NUMBER', label: 'Numéro WhatsApp émetteur', required: true,
        hint: 'Format Twilio WhatsApp : whatsapp:+14155552671' },
    ],
  },
];

/** Placeholder retourné côté API pour les champs marqués `secret: true`. */
export const SECRET_MASK = '••••••••';

export interface TelecomProviderItem {
  key:                  TelecomProviderName;
  displayName:          string;
  vaultPath:            string;
  healthStatus:         'UP' | 'DOWN' | 'DEGRADED' | 'UNKNOWN';
  lastHealthCheckAt:    string | null;
  lastHealthCheckError: string | null;
  fields:               ReadonlyArray<ProviderField>;
  configured:           boolean;
}

@Injectable()
export class PlatformTelecomService {
  private readonly log = new Logger(PlatformTelecomService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SECRET_SERVICE) private readonly secrets: ISecretService,
  ) {}

  private getDef(key: TelecomProviderName) {
    const def = PROVIDER_DEFAULTS.find(p => p.key === key);
    if (!def) throw new NotFoundException(`Telecom provider ${key} inconnu`);
    return def;
  }

  /** Lit l'objet de credentials brut depuis Vault — `{}` si absent. */
  private async readVault(key: TelecomProviderName): Promise<Record<string, string>> {
    const def = this.getDef(key);
    try {
      return await this.secrets.getSecretObject<Record<string, string>>(def.vaultPath);
    } catch (err) {
      this.log.debug(`[PlatformTelecom] readVault(${key}) absent: ${(err as Error)?.message}`);
      return {};
    }
  }

  /** Liste enrichie pour l'UI admin plateforme. */
  async list(): Promise<TelecomProviderItem[]> {
    const rows = await this.prisma.telecomProviderState.findMany();
    return Promise.all(PROVIDER_DEFAULTS.map(async def => {
      const row = rows.find(r => r.providerKey === def.key);
      const vault = await this.readVault(def.key);
      const configured = def.fields
        .filter(f => f.required)
        .every(f => typeof vault[f.key] === 'string' && vault[f.key].length > 0);
      return {
        key:                  def.key,
        displayName:          def.displayName,
        vaultPath:            def.vaultPath,
        healthStatus:         (row?.lastHealthCheckStatus as TelecomProviderItem['healthStatus']) ?? 'UNKNOWN',
        lastHealthCheckAt:    row?.lastHealthCheckAt?.toISOString() ?? null,
        lastHealthCheckError: row?.lastHealthCheckError ?? null,
        fields:               def.fields,
        configured,
      };
    }));
  }

  // ─── Credentials par provider ─────────────────────────────────────────────

  /** Lit les credentials d'un provider (secrets masqués). */
  async getCredentials(key: TelecomProviderName): Promise<Record<string, string>> {
    const def = this.getDef(key);
    const vault = await this.readVault(key);
    const out: Record<string, string> = {};
    for (const f of def.fields) {
      const v = vault[f.key];
      if (typeof v !== 'string' || v.length === 0) {
        out[f.key] = '';
        continue;
      }
      out[f.key] = f.secret ? SECRET_MASK : v;
    }
    return out;
  }

  /** Écrit les credentials d'un provider en Vault + relance healthcheck. */
  async setCredentials(
    key:   TelecomProviderName,
    input: Record<string, string | number | boolean>,
  ): Promise<{ ok: boolean; status: TelecomProviderItem['healthStatus']; detail?: string }> {
    const def = this.getDef(key);
    const previous = await this.readVault(key);
    const next: Record<string, string> = {};

    for (const f of def.fields) {
      const raw = input[f.key];
      let value: string;

      if (raw === undefined || raw === null) {
        value = '';
      } else if (typeof raw === 'boolean') {
        value = raw ? 'true' : 'false';
      } else {
        value = String(raw).trim();
      }

      if (f.secret && value === SECRET_MASK) {
        value = previous[f.key] ?? '';
      }

      if (f.required && value.length === 0) {
        throw new BadRequestException(`Champ requis manquant : ${f.key}`);
      }

      next[f.key] = value;
    }

    await this.secrets.putSecret(def.vaultPath, next);
    this.log.log(`[PlatformTelecom] credentials ${key} mis à jour (${Object.keys(next).length} champs)`);

    return this.runHealthcheck(key);
  }

  /**
   * Healthcheck Twilio : tente GET /Accounts/{ACCOUNT_SID}.json en Basic Auth.
   * Si HTTP 200 → UP. 401/403 → DOWN (creds invalides). Autre → DEGRADED.
   * Persiste le résultat dans `telecom_provider_states`.
   */
  async runHealthcheck(
    providerKey: TelecomProviderName,
  ): Promise<{ ok: boolean; status: TelecomProviderItem['healthStatus']; detail?: string }> {
    const known = PROVIDER_DEFAULTS.find(p => p.key === providerKey);
    if (!known) throw new NotFoundException(`Telecom provider ${providerKey} inconnu`);

    const checkedAt = new Date();
    let status: TelecomProviderItem['healthStatus'] = 'UNKNOWN';
    let detail: string | undefined;
    let ok = false;

    try {
      const creds = await this.readVault(providerKey);
      const required = known.fields.filter(f => f.required).map(f => f.key);
      const missing = required.filter(k => !creds[k] || creds[k].length === 0);
      if (missing.length > 0) {
        status = 'DOWN';
        detail = `Credentials manquants : ${missing.join(', ')}`;
      } else {
        // Test API Twilio — appel léger /Accounts/{sid}.json (pas de send réel).
        const sid = creds.ACCOUNT_SID;
        const tok = creds.AUTH_TOKEN;
        const res = await axios.get(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
          auth:    { username: sid, password: tok },
          timeout: 8_000,
          validateStatus: () => true, // gère l'erreur HTTP nous-mêmes
        });
        if (res.status === 200) {
          ok = true;
          status = 'UP';
          detail = `Twilio API OK (account ${sid.slice(0, 6)}…)`;
        } else if (res.status === 401 || res.status === 403) {
          status = 'DOWN';
          detail = `Twilio auth refusée (HTTP ${res.status}) — vérifier ACCOUNT_SID / AUTH_TOKEN`;
        } else {
          status = 'DEGRADED';
          detail = `Twilio HTTP ${res.status}`;
        }
      }
    } catch (err) {
      status = 'DOWN';
      detail = (err as Error)?.message ?? 'Unknown error';
    }

    await this.prisma.telecomProviderState.upsert({
      where:  { providerKey },
      update: {
        displayName:           known.displayName,
        vaultPath:             known.vaultPath,
        lastHealthCheckAt:     checkedAt,
        lastHealthCheckStatus: status,
        lastHealthCheckError:  ok ? null : detail ?? null,
      },
      create: {
        providerKey,
        displayName:           known.displayName,
        vaultPath:             known.vaultPath,
        lastHealthCheckAt:     checkedAt,
        lastHealthCheckStatus: status,
        lastHealthCheckError:  ok ? null : detail ?? null,
      },
    });

    this.log.log(`[PlatformTelecom] healthcheck ${providerKey} → ${status}${detail ? ` (${detail})` : ''}`);
    return { ok, status, detail };
  }
}
