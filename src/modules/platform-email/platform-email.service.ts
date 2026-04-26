/**
 * PlatformEmailService — vue d'administration des 4 providers email.
 *
 * Responsabilités :
 *   - Lister les 4 providers (console | smtp | resend | o365) avec leur état :
 *     actif courant (via env var EMAIL_PROVIDER) + credentials présents en
 *     Vault + dernier healthcheck persisté.
 *   - Déclencher un healthcheck "live" sur un provider via son `healthCheck()`
 *     et persister le résultat dans `email_provider_states`.
 *
 * **Pas d'écriture du sélecteur** : le provider actif reste piloté par la
 * variable d'env `EMAIL_PROVIDER` (+ redéploiement). L'UI plateforme est
 * read-only sur ce choix.
 */

import { Injectable, Logger, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  ConsoleEmailService,
} from '../../infrastructure/notification/email/console-email.service';
import { SmtpEmailService }    from '../../infrastructure/notification/email/smtp-email.service';
import { ResendEmailService }  from '../../infrastructure/notification/email/resend-email.service';
import { O365EmailService }    from '../../infrastructure/notification/email/o365-email.service';
import type {
  EmailProviderName, IEmailService,
} from '../../infrastructure/notification/interfaces/email.interface';
import { ISecretService, SECRET_SERVICE } from '../../infrastructure/secret/interfaces/secret.interface';

// ─── Config des providers (DRY — liste source de vérité) ────────────────────
// Note : `vaultPath=null` pour console (pas de secret). Display name et path
// servent à l'UI + au seeding de la table `email_provider_states`.
//
// `fields` décrit le schéma de credentials de chaque provider :
//   - `key`       : nom de la propriété en Vault (UPPER_SNAKE_CASE)
//   - `label`     : libellé UI (clé i18n côté FE possible plus tard)
//   - `secret`    : true → masqué au GET, conservé si placeholder envoyé au PUT
//   - `required`  : true → champ obligatoire au PUT (rejet 400 si vide)
//   - `type`      : `text` (défaut) | `email` | `password` | `number` | `boolean`
//   - `hint`      : aide affichée sous le champ
export interface ProviderField {
  key:        string;
  label:      string;
  secret?:    boolean;
  required?:  boolean;
  type?:      'text' | 'email' | 'password' | 'number' | 'boolean';
  hint?:      string;
}

const PROVIDER_DEFAULTS: ReadonlyArray<{
  key:         EmailProviderName;
  displayName: string;
  vaultPath:   string | null;
  fields:      ReadonlyArray<ProviderField>;
}> = [
  { key: 'console', displayName: 'Console (dev)', vaultPath: null, fields: [] },
  {
    key: 'smtp', displayName: 'SMTP (nodemailer)', vaultPath: 'platform/email/smtp',
    fields: [
      { key: 'HOST',       label: 'Host',          required: true,  hint: 'ex. smtp.sendgrid.net' },
      { key: 'PORT',       label: 'Port',          required: true,  type: 'number', hint: '587 (STARTTLS) / 465 (TLS) / 25' },
      { key: 'USER',       label: 'Utilisateur',   required: true },
      { key: 'PASS',       label: 'Mot de passe',  required: true,  secret: true, type: 'password' },
      { key: 'SECURE',     label: 'TLS direct',    type: 'boolean', hint: 'true = port 465, false = STARTTLS sur 587' },
      { key: 'FROM_EMAIL', label: 'Sender email',  required: true,  type: 'email' },
      { key: 'FROM_NAME',  label: 'Sender name' },
    ],
  },
  {
    key: 'resend', displayName: 'Resend', vaultPath: 'platform/email/resend',
    fields: [
      { key: 'API_KEY',    label: 'API key',       required: true, secret: true, type: 'password', hint: 'commence par re_…' },
      { key: 'FROM_EMAIL', label: 'Sender email',  required: true, type: 'email', hint: 'doit être vérifié dans Resend' },
      { key: 'FROM_NAME',  label: 'Sender name' },
    ],
  },
  {
    key: 'o365', displayName: 'Microsoft 365 / Graph', vaultPath: 'platform/email/o365',
    fields: [
      { key: 'TENANT_ID',     label: 'Tenant ID (Entra)',     required: true, hint: 'Directory (tenant) ID — UUID Azure AD' },
      { key: 'CLIENT_ID',     label: 'Client ID',             required: true, hint: 'Application (client) ID' },
      { key: 'CLIENT_SECRET', label: 'Client secret',         required: true, secret: true, type: 'password', hint: 'Value (pas Secret ID) — copiée à la création' },
      { key: 'SENDER_EMAIL',  label: 'Sender mailbox',        required: true, type: 'email', hint: 'mailbox autorisée par ApplicationAccessPolicy' },
      { key: 'SENDER_NAME',   label: 'Sender name' },
    ],
  },
];

// Placeholder retourné côté API pour les champs marqués `secret: true`.
// Si le client renvoie cette valeur exacte au PUT, le serveur conserve l'ancienne
// (permet de modifier d'autres champs sans avoir à ressaisir le secret).
export const SECRET_MASK = '••••••••';

export interface EmailProviderItem {
  key:                  EmailProviderName;
  displayName:          string;
  vaultPath:            string | null;
  /** True si c'est le provider actuellement actif (lu depuis EMAIL_PROVIDER). */
  isActive:             boolean;
  /** True si le healthcheck du provider est OK (credentials présents et API up). */
  healthStatus:         'UP' | 'DOWN' | 'DEGRADED' | 'UNKNOWN';
  lastHealthCheckAt:    string | null;
  lastHealthCheckError: string | null;
  /** Schéma de configuration du provider (champs à saisir côté UI). */
  fields:               ReadonlyArray<ProviderField>;
  /** True si Vault contient déjà des credentials non vides pour ce provider. */
  configured:           boolean;
}

@Injectable()
export class PlatformEmailService {
  private readonly log = new Logger(PlatformEmailService.name);

  /** Provider actif au boot — même source que EmailProviderFactory. */
  private readonly activeProvider: EmailProviderName =
    (process.env.EMAIL_PROVIDER as EmailProviderName | undefined) ?? 'console';

  constructor(
    private readonly prisma:     PrismaService,
    private readonly consoleSvc: ConsoleEmailService,
    private readonly smtpSvc:    SmtpEmailService,
    private readonly resendSvc:  ResendEmailService,
    private readonly o365Svc:    O365EmailService,
    @Inject(SECRET_SERVICE) private readonly secrets: ISecretService,
  ) {}

  /** Retourne le descripteur d'un provider (avec son schéma de fields). */
  private getDef(key: EmailProviderName) {
    const def = PROVIDER_DEFAULTS.find(p => p.key === key);
    if (!def) throw new NotFoundException(`Email provider ${key} inconnu`);
    return def;
  }

  /** Lit l'objet de credentials brut depuis Vault — `{}` si absent ou path null. */
  private async readVault(key: EmailProviderName): Promise<Record<string, string>> {
    const def = this.getDef(key);
    if (!def.vaultPath) return {};
    try {
      return await this.secrets.getSecretObject<Record<string, string>>(def.vaultPath);
    } catch (err) {
      // 404 Vault ou path vide → on traite comme absent (UI affichera "non configuré").
      this.log.debug(`[PlatformEmail] readVault(${key}) absent: ${(err as Error)?.message}`);
      return {};
    }
  }

  /** Résout le service concret pour une clé donnée. */
  private resolveService(key: EmailProviderName): IEmailService {
    switch (key) {
      case 'console': return this.consoleSvc;
      case 'smtp':    return this.smtpSvc;
      case 'resend':  return this.resendSvc;
      case 'o365':    return this.o365Svc;
    }
  }

  /** Liste enrichie pour l'UI admin plateforme. */
  async list(): Promise<EmailProviderItem[]> {
    const rows = await this.prisma.emailProviderState.findMany();
    return Promise.all(PROVIDER_DEFAULTS.map(async def => {
      const row = rows.find(r => r.providerKey === def.key);
      const vault = def.vaultPath ? await this.readVault(def.key) : {};
      const configured = def.fields
        .filter(f => f.required)
        .every(f => typeof vault[f.key] === 'string' && vault[f.key].length > 0);
      return {
        key:                  def.key,
        displayName:          def.displayName,
        vaultPath:            def.vaultPath,
        isActive:             this.activeProvider === def.key,
        healthStatus:         (row?.lastHealthCheckStatus as EmailProviderItem['healthStatus']) ?? 'UNKNOWN',
        lastHealthCheckAt:    row?.lastHealthCheckAt?.toISOString() ?? null,
        lastHealthCheckError: row?.lastHealthCheckError ?? null,
        fields:               def.fields,
        configured,
      };
    }));
  }

  // ─── Credentials par provider (Vault read masqué + write merge) ──────────

  /**
   * Lit les credentials d'un provider depuis Vault. Les champs marqués
   * `secret: true` (CLIENT_SECRET, PASS, API_KEY) sont masqués par le
   * placeholder `SECRET_MASK` — l'UI ne reçoit jamais la valeur en clair.
   * Les champs absents en Vault sont retournés en chaîne vide.
   *
   * `console` n'a pas de credentials → renvoie `{}`.
   */
  async getCredentials(key: EmailProviderName): Promise<Record<string, string>> {
    const def = this.getDef(key);
    if (!def.vaultPath) return {};

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

  /**
   * Écrit les credentials d'un provider en Vault. Validation :
   *   - Les champs `required` doivent être présents et non vides.
   *   - Pour les champs `secret`, si la valeur reçue est exactement
   *     `SECRET_MASK`, on conserve la valeur précédente (no-op).
   *   - Les champs hors-schéma sont ignorés (pas d'injection).
   *
   * Après l'écriture, on relance un healthcheck synchrone qui persiste le
   * résultat — l'UI peut afficher l'état immédiatement sans 2e appel.
   */
  async setCredentials(
    key:   EmailProviderName,
    input: Record<string, string | number | boolean>,
  ): Promise<{ ok: boolean; status: EmailProviderItem['healthStatus']; detail?: string }> {
    const def = this.getDef(key);
    if (!def.vaultPath) {
      throw new BadRequestException(`Provider ${key} ne prend pas de credentials`);
    }

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

      // Champ secret laissé masqué → on garde l'ancien
      if (f.secret && value === SECRET_MASK) {
        value = previous[f.key] ?? '';
      }

      if (f.required && value.length === 0) {
        throw new BadRequestException(`Champ requis manquant : ${f.key}`);
      }

      next[f.key] = value;
    }

    await this.secrets.putSecret(def.vaultPath, next);
    this.log.log(`[PlatformEmail] credentials ${key} mis à jour (${Object.keys(next).length} champs)`);

    // Healthcheck immédiat post-update — invalide tout cache de creds
    // côté provider runtime (le service relit Vault au prochain send).
    return this.runHealthcheck(key);
  }

  /**
   * Exécute un healthcheck sur un provider email et persiste le résultat.
   * Pour console, le healthcheck est toujours OK (pas de credentials à vérifier).
   */
  async runHealthcheck(
    providerKey: EmailProviderName,
  ): Promise<{ ok: boolean; status: EmailProviderItem['healthStatus']; detail?: string }> {
    const known = PROVIDER_DEFAULTS.find(p => p.key === providerKey);
    if (!known) throw new NotFoundException(`Email provider ${providerKey} inconnu`);

    const service = this.resolveService(providerKey);
    const checkedAt = new Date();
    let status: EmailProviderItem['healthStatus'] = 'UNKNOWN';
    let detail: string | undefined;
    let ok = false;

    try {
      const res = await service.healthCheck();
      ok     = res.ok;
      status = res.ok ? 'UP' : 'DOWN';
      detail = res.detail;
    } catch (err) {
      status = 'DOWN';
      detail = (err as Error)?.message ?? 'Unknown error';
    }

    await this.prisma.emailProviderState.upsert({
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

    this.log.log(`[PlatformEmail] healthcheck ${providerKey} → ${status}${detail ? ` (${detail})` : ''}`);
    return { ok, status, detail };
  }
}
