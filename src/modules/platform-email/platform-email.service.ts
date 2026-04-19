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

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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

// ─── Config des providers (DRY — liste source de vérité) ────────────────────
// Note : `vaultPath=null` pour console (pas de secret). Display name et path
// servent à l'UI + au seeding de la table `email_provider_states`.
const PROVIDER_DEFAULTS: ReadonlyArray<{
  key:         EmailProviderName;
  displayName: string;
  vaultPath:   string | null;
}> = [
  { key: 'console', displayName: 'Console (dev)',        vaultPath: null },
  { key: 'smtp',    displayName: 'SMTP (nodemailer)',    vaultPath: 'platform/email/smtp' },
  { key: 'resend',  displayName: 'Resend',               vaultPath: 'platform/email/resend' },
  { key: 'o365',    displayName: 'Microsoft 365 / Graph', vaultPath: 'platform/email/o365' },
];

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
  ) {}

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
    return PROVIDER_DEFAULTS.map(def => {
      const row = rows.find(r => r.providerKey === def.key);
      return {
        key:                  def.key,
        displayName:          def.displayName,
        vaultPath:            def.vaultPath,
        isActive:             this.activeProvider === def.key,
        healthStatus:         (row?.lastHealthCheckStatus as EmailProviderItem['healthStatus']) ?? 'UNKNOWN',
        lastHealthCheckAt:    row?.lastHealthCheckAt?.toISOString() ?? null,
        lastHealthCheckError: row?.lastHealthCheckError ?? null,
      };
    });
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
