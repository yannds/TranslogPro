import type { EmailAddress, SendEmailDto } from '../interfaces/email.interface';

/**
 * Normalise les différentes formes d'adresse acceptées par SendEmailDto
 * (string | EmailAddress | EmailAddress[]) en un tableau propre.
 */
export function toAddressArray(
  input: SendEmailDto['to'] | SendEmailDto['cc'] | SendEmailDto['bcc'],
): EmailAddress[] {
  if (!input) return [];
  if (typeof input === 'string') return [{ email: input }];
  if (Array.isArray(input)) return input;
  return [input];
}

/** Normalise une adresse simple (from, replyTo). */
export function toAddress(input: SendEmailDto['from'] | SendEmailDto['replyTo']): EmailAddress | undefined {
  if (!input) return undefined;
  // Cast explicite vers `EmailAddress` pour que TS préserve la forme
  // { email, name? } côté caller (sinon le `name` optionnel est narrowed-out).
  if (typeof input === 'string') return { email: input } as EmailAddress;
  return input;
}

/**
 * Formate une adresse au format RFC 5322 : "Name <email@host>" ou "email@host".
 * Pour Graph API on envoie un objet {name, address}, donc ce helper est surtout
 * utilisé pour le log structuré + SMTP.
 */
export function formatAddress(addr: EmailAddress): string {
  if (!addr.name) return addr.email;
  // Quote le nom s'il contient des caractères spéciaux.
  const needsQuote = /["(),:;<>@\[\]\\]/.test(addr.name);
  const name = needsQuote ? `"${addr.name.replace(/"/g, '\\"')}"` : addr.name;
  return `${name} <${addr.email}>`;
}

/** Validation email basique — ne remplace pas une validation côté DTO. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

/**
 * Génère un messageId unique côté application (pour idempotency / logs)
 * quand le provider n'en renvoie pas. Format compatible RFC 5322.
 */
export function generateLocalMessageId(provider: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts   = Date.now().toString(36);
  return `<${ts}.${rand}.${provider}@translogpro.local>`;
}

/**
 * Masque un email pour les logs — évite de dumper des PII en clair.
 * "moussa.ndiaye@acme.com" → "mo***@acme.com"
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const prefix = local.slice(0, Math.min(2, local.length));
  return `${prefix}***@${domain}`;
}
