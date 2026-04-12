/**
 * ISmsService — Port d'abstraction pour les fournisseurs SMS/WhatsApp.
 *
 * Implémentations :
 *   TwilioSmsService     → SMS standard (Twilio REST API)
 *   TwilioWhatsappService→ WhatsApp Business via Twilio Sandbox/API
 *
 * Règle PRD §II.2 : aucun import direct du SDK Twilio dans le code métier.
 * Chaque service appelle Vault pour ses credentials — jamais process.env.
 */

export const SMS_SERVICE      = 'ISmsService';
export const WHATSAPP_SERVICE = 'IWhatsappService';

export interface SendSmsDto {
  to:        string;          // E.164 format : +22507XXXXXXXX
  body:      string;          // Message texte (max 1600 chars)
  tenantId:  string;          // pour récupérer les crédentials Vault par tenant
  from?:     string;          // override sender ID (utilisé si le tenant a son propre sender)
}

export interface SendSmsResult {
  sid:        string;         // identifiant unique Twilio (pour suivi/refund)
  status:     'queued' | 'sending' | 'sent' | 'failed' | 'delivered';
  to:         string;
  sentAt:     Date;
}

export interface ISmsService {
  /**
   * Envoie un SMS. Lève une exception si le provider retourne une erreur.
   * La clé Vault utilisée : "tenants/{tenantId}/sms" → { ACCOUNT_SID, AUTH_TOKEN, FROM_NUMBER }
   * Fallback plateforme : "platform/sms" si la clé tenant n'existe pas.
   */
  send(dto: SendSmsDto): Promise<SendSmsResult>;

  /**
   * Vérifie que les credentials SMS sont valides pour un tenant.
   * Utilisé par l'onboarding pour valider la configuration.
   */
  healthCheck(tenantId: string): Promise<boolean>;
}

export interface IWhatsappService {
  /**
   * Envoie un message WhatsApp via Twilio WhatsApp API.
   * Clé Vault : "platform/whatsapp" → { ACCOUNT_SID, AUTH_TOKEN, FROM_NUMBER }
   * Format from : "whatsapp:+1XXXXXXXXXX"
   */
  send(dto: SendSmsDto): Promise<SendSmsResult>;
  healthCheck(tenantId: string): Promise<boolean>;
}
