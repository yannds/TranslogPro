import { renderAuthTemplate, AuthTemplateId } from './auth-templates';
import type { EmailTemplateDescriptor, EmailTemplateLang, RenderedEmail } from './types';

const AUTH_SAMPLE_VARS = {
  userName:    '',
  tenantName:  'Trans Express CG',
  resetUrl:    'https://trans-express.translog.pro/auth/reset?token=demo-token-here',
  verifyUrl:   'https://trans-express.translog.pro/auth/verify-email?token=demo-token',
  expiresAt:   'lundi 27 avril 2026 à 09:00',
  completedAt: 'lundi 27 avril 2026 à 08:42',
  ipAddress:   '192.0.2.42',
  factor:      'TOTP',
} as const;

function adapt(id: AuthTemplateId, lang: EmailTemplateLang, vars: Record<string, string>): RenderedEmail {
  const merged = { ...AUTH_SAMPLE_VARS, ...vars };
  const out    = renderAuthTemplate(id, lang, merged);
  return { subject: out.title, html: out.html, text: out.body };
}

export const AUTH_DESCRIPTORS: EmailTemplateDescriptor[] = [
  {
    id:               'auth.password_reset.link',
    group:            'auth',
    labelFr:          'Réinitialisation mot de passe — lien',
    labelEn:          'Password reset — link',
    descriptionFr:    'Lien de réinitialisation envoyé à la demande utilisateur (forgot password) ou à l\'initiative d\'un admin. TTL 30 min.',
    descriptionEn:    'Reset link sent on user request (forgot password) or admin-initiated. TTL 30 min.',
    sampleVars:       { ...AUTH_SAMPLE_VARS },
    recipientNameVar: 'userName',
    render:           (lang, vars) => adapt('auth.password_reset.link', lang, vars),
  },
  {
    id:               'auth.password_reset.completed',
    group:            'auth',
    labelFr:          'Mot de passe modifié — alerte sécurité',
    labelEn:          'Password changed — security alert',
    descriptionFr:    'Confirmation envoyée après changement de mot de passe — alerte si l\'action n\'est pas légitime.',
    descriptionEn:    'Confirmation sent after password change — alerts user if action is illegitimate.',
    sampleVars:       { ...AUTH_SAMPLE_VARS },
    recipientNameVar: 'userName',
    render:           (lang, vars) => adapt('auth.password_reset.completed', lang, vars),
  },
  {
    id:               'auth.email_verification',
    group:            'auth',
    labelFr:          'Vérification d\'adresse email',
    labelEn:          'Email verification',
    descriptionFr:    'Lien de confirmation d\'adresse email lors de l\'inscription ou du changement d\'email.',
    descriptionEn:    'Email confirmation link on signup or email change.',
    sampleVars:       { ...AUTH_SAMPLE_VARS },
    recipientNameVar: 'userName',
    render:           (lang, vars) => adapt('auth.email_verification', lang, vars),
  },
  {
    id:               'auth.mfa.enabled',
    group:            'auth',
    labelFr:          'MFA activée — confirmation',
    labelEn:          'MFA enabled — confirmation',
    descriptionFr:    'Notification envoyée à l\'activation de l\'authentification à deux facteurs.',
    descriptionEn:    'Notification sent when two-factor authentication is enabled.',
    sampleVars:       { ...AUTH_SAMPLE_VARS },
    recipientNameVar: 'userName',
    render:           (lang, vars) => adapt('auth.mfa.enabled', lang, vars),
  },
  {
    id:               'auth.mfa.disabled',
    group:            'auth',
    labelFr:          'MFA désactivée — alerte sécurité',
    labelEn:          'MFA disabled — security alert',
    descriptionFr:    'Alerte sécurité critique : l\'authentification à deux facteurs vient d\'être désactivée.',
    descriptionEn:    'Critical security alert: two-factor authentication has just been disabled.',
    sampleVars:       { ...AUTH_SAMPLE_VARS },
    recipientNameVar: 'userName',
    render:           (lang, vars) => adapt('auth.mfa.disabled', lang, vars),
  },
];
