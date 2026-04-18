/**
 * IEmailService — Port d'abstraction email.
 *
 * Règle PRD §II.2 : aucun import direct d'un SDK email (Graph, Resend, nodemailer…)
 * dans le code métier. Toutes les implémentations passent par cette interface.
 *
 * Implémentations actuelles :
 *   ConsoleEmailService   → dev : log structuré vers stdout, ne part jamais
 *   O365EmailService      → Microsoft 365 / Graph API (app-only OAuth2)
 *   ResendEmailService    → Resend REST API
 *   SmtpEmailService      → SMTP générique (nodemailer) — stub à installer
 *
 * Sélection du provider via l'env `EMAIL_PROVIDER` (voir EmailProviderFactory).
 *
 * Credentials : jamais `process.env` directement côté service — la factory
 * lit l'env pour la sélection, puis chaque provider lit Vault pour ses secrets.
 */

export const EMAIL_SERVICE = 'IEmailService';

/** Formats de provider supportés — source de vérité pour la factory. */
export type EmailProviderName = 'console' | 'o365' | 'resend' | 'smtp';

export interface EmailAddress {
  email: string;
  /** Nom d'affichage (optionnel). Evite les noms bizarres genre "Support <support@x.com>" non-échappés. */
  name?: string;
}

export interface SendEmailDto {
  /** Destinataires principaux. Min 1. */
  to: EmailAddress[] | EmailAddress | string;
  /** Copie / copie cachée. */
  cc?:  EmailAddress[] | EmailAddress | string;
  bcc?: EmailAddress[] | EmailAddress | string;
  /** Expéditeur. Si absent, utilise le default du provider (platform/email.FROM). */
  from?: EmailAddress | string;
  /** Reply-To optionnel. */
  replyTo?: EmailAddress | string;

  subject: string;
  /** Corps HTML. Recommandé de fournir aussi `text` pour les clients sans HTML. */
  html?: string;
  /** Corps texte. Au moins l'un de html/text doit être fourni. */
  text?: string;

  /** Tags libres pour tracking provider (Resend, SendGrid). */
  tags?: string[];
  /** Headers custom. Utilisé pour List-Unsubscribe, X-Campaign, etc. */
  headers?: Record<string, string>;

  /**
   * Identifiant tenant pour lookup Vault des credentials par tenant.
   * Passer `null` pour utiliser uniquement la config plateforme
   * (signup public, waitlist — pas encore de tenant).
   */
  tenantId?: string | null;

  /** Catégorie métier — transactional | marketing | system. Sert pour analytics/suppression. */
  category?: 'transactional' | 'marketing' | 'system';

  /** Idempotency key — le provider dédoublonne sur cette clé si supporté (SES, Resend). */
  idempotencyKey?: string;
}

export interface SendEmailResult {
  /** Identifiant provider (Graph messageId, Resend id, nodemailer messageId). */
  messageId: string;
  provider:  EmailProviderName;
  sentAt:    Date;
  /**
   * True quand le provider a confirmé la mise en file d'attente (ou l'envoi).
   * False pour ConsoleEmailService (mode dev — l'email n'est JAMAIS délivré).
   */
  accepted:  boolean;
}

export interface IEmailService {
  /**
   * Envoie un email. Doit lever en cas d'échec provider.
   * La méthode NE doit PAS retourner silencieusement un succès en cas d'erreur
   * — le code appelant décide comment absorber (retry, DLQ, log).
   */
  send(dto: SendEmailDto): Promise<SendEmailResult>;

  /**
   * Vérifie que le provider répond (ping / auth token refresh).
   * Utilisé par les health checks plateforme et l'UI de config.
   */
  healthCheck(): Promise<{ ok: boolean; provider: EmailProviderName; detail?: string }>;

  /** Retourne le nom du provider actif — utile pour les logs et l'observabilité. */
  readonly providerName: EmailProviderName;
}
