/**
 * Descripteurs User pour le registre central — 1 template (invitation par admin).
 * recipientNameVar = 'inviteeName'.
 */

import { renderUserTemplate, UserTemplateId } from './user-templates';
import type { EmailTemplateDescriptor, EmailTemplateLang, RenderedEmail } from './types';

const USER_SAMPLE_VARS = {
  inviteeName: '',
  tenantName:  'Trans Express CG',
  roleName:    'Caissier',
  agencyName:  'Agence Brazzaville',
  resetUrl:    'https://trans-express.translog.pro/auth/forgot-password?email=demo%40example.com',
} as const;

function adapt(id: UserTemplateId, lang: EmailTemplateLang, vars: Record<string, string>): RenderedEmail {
  const merged = { ...USER_SAMPLE_VARS, ...vars };
  const out    = renderUserTemplate(id, lang, merged);
  return { subject: out.title, html: out.html, text: out.body };
}

export const USER_DESCRIPTORS: EmailTemplateDescriptor[] = [
  {
    id:               'user.invited',
    group:            'user',
    labelFr:          'Invitation utilisateur (admin tenant)',
    labelEn:          'User invitation (tenant admin)',
    descriptionFr:    'Envoyé au collaborateur quand TENANT_ADMIN ou AGENCY_MANAGER l\'ajoute via /admin/users. Inclut un lien pour définir son mot de passe.',
    descriptionEn:    'Sent to the staff member when TENANT_ADMIN or AGENCY_MANAGER adds them via /admin/users. Includes a link to set their password.',
    sampleVars:       { ...USER_SAMPLE_VARS },
    recipientNameVar: 'inviteeName',
    render:           (lang, vars) => adapt('user.invited', lang, vars),
  },
];
