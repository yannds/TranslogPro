import { renderSubscriptionTemplate, SubscriptionTemplateId } from './subscription-templates';
import type { EmailTemplateDescriptor, EmailTemplateLang, RenderedEmail } from './types';

const SUB_SAMPLE_VARS = {
  adminName:      '',
  tenantName:     'Trans Express CG',
  planName:       'Pro',
  formattedPrice: '49 000 XAF / mois',
  trialEndsAt:    'lundi 4 mai 2026',
  cancelledAt:    'lundi 27 avril 2026',
  reason:         'Demande de l\'utilisateur',
  billingUrl:     'https://trans-express.translog.pro/admin/billing',
} as const;

function adapt(id: SubscriptionTemplateId, lang: EmailTemplateLang, vars: Record<string, string>): RenderedEmail {
  const merged = { ...SUB_SAMPLE_VARS, ...vars };
  const out    = renderSubscriptionTemplate(id, lang, merged);
  return { subject: out.title, html: out.html, text: out.body };
}

export const SUBSCRIPTION_DESCRIPTORS: EmailTemplateDescriptor[] = [
  {
    id:               'subscription.created',
    group:            'subscription',
    labelFr:          'Abonnement confirmé',
    labelEn:          'Subscription confirmed',
    descriptionFr:    'Confirmation envoyée à la souscription d\'un plan (après checkout réussi).',
    descriptionEn:    'Confirmation sent on plan subscription (after successful checkout).',
    sampleVars:       { ...SUB_SAMPLE_VARS },
    recipientNameVar: 'adminName',
    render:           (lang, vars) => adapt('subscription.created', lang, vars),
  },
  {
    id:               'subscription.cancelled',
    group:            'subscription',
    labelFr:          'Abonnement annulé',
    labelEn:          'Subscription cancelled',
    descriptionFr:    'Confirmation d\'annulation avec offre de réactivation et fenêtre de rétention de données.',
    descriptionEn:    'Cancellation confirmation with reactivation offer and data retention window.',
    sampleVars:       { ...SUB_SAMPLE_VARS },
    recipientNameVar: 'adminName',
    render:           (lang, vars) => adapt('subscription.cancelled', lang, vars),
  },
  {
    id:               'subscription.trial_expiring',
    group:            'subscription',
    labelFr:          'Période d\'essai expire bientôt',
    labelEn:          'Trial expiring soon',
    descriptionFr:    'Rappel envoyé J-3 avant la fin de la période d\'essai gratuit.',
    descriptionEn:    'Reminder sent 3 days before the end of the free trial.',
    sampleVars:       { ...SUB_SAMPLE_VARS },
    recipientNameVar: 'adminName',
    render:           (lang, vars) => adapt('subscription.trial_expiring', lang, vars),
  },
  {
    id:               'subscription.payment_failed',
    group:            'subscription',
    labelFr:          'Échec de paiement (renouvellement)',
    labelEn:          'Payment failed (renewal)',
    descriptionFr:    'Notification d\'échec de paiement de renouvellement avec lien pour mettre à jour le moyen de paiement.',
    descriptionEn:    'Renewal payment failure notification with link to update payment method.',
    sampleVars:       { ...SUB_SAMPLE_VARS },
    recipientNameVar: 'adminName',
    render:           (lang, vars) => adapt('subscription.payment_failed', lang, vars),
  },
];
