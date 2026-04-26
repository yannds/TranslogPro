/**
 * Point d'entrée du registre central des templates email.
 * Re-export propre — les modules importent toujours depuis ce barrel.
 */
export type {
  EmailTemplateDescriptor,
  EmailTemplateGroup,
  EmailTemplateLang,
  RenderedEmail,
} from './types';

export {
  listEmailTemplates,
  getEmailTemplate,
  renderEmailTemplate,
  getKnownTemplateIds,
} from './registry';
