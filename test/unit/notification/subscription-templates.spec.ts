/**
 * Tests des 4 templates Subscription.
 */
import {
  renderSubscriptionTemplate,
  SubscriptionTemplateId,
} from '../../../src/modules/notification/email-templates/subscription-templates';

const baseVars = {
  adminName:      'Awa Diallo',
  tenantName:     'Trans Express CG',
  planName:       'Pro',
  formattedPrice: '49 000 XAF / mois',
  trialEndsAt:    'lundi 4 mai 2026',
  cancelledAt:    'lundi 27 avril 2026',
  reason:         'Demande utilisateur',
  billingUrl:     'https://x.translog.pro/admin/billing',
};

describe('renderSubscriptionTemplate', () => {
  const ids: SubscriptionTemplateId[] = [
    'subscription.created', 'subscription.cancelled',
    'subscription.trial_expiring', 'subscription.payment_failed',
  ];

  it.each(ids)('rend %s en fr', (id) => {
    const out = renderSubscriptionTemplate(id, 'fr', baseVars);
    expect(out.body).toContain('Awa Diallo');
    expect(out.html).toContain('Trans Express CG');
  });

  it.each(ids)('rend %s en en', (id) => {
    const out = renderSubscriptionTemplate(id, 'en', baseVars);
    expect(out.body).toContain('Awa Diallo');
  });

  it('subscription.cancelled mentionne fenêtre de rétention 30j', () => {
    const out = renderSubscriptionTemplate('subscription.cancelled', 'fr', baseVars);
    expect(out.html).toContain('30 jours');
  });

  it('subscription.trial_expiring est en bloc orange', () => {
    const out = renderSubscriptionTemplate('subscription.trial_expiring', 'fr', baseVars);
    expect(out.html).toContain('lundi 4 mai 2026');
    expect(out.html).toContain('background:#fef3c7');
  });

  it('subscription.payment_failed est en bloc rouge', () => {
    const out = renderSubscriptionTemplate('subscription.payment_failed', 'fr', baseVars);
    expect(out.html).toContain('background:#fee2e2');
    expect(out.html).toContain('Demande utilisateur');
  });

  it('échappe XSS sur tenantName', () => {
    const out = renderSubscriptionTemplate('subscription.created', 'fr', {
      ...baseVars, tenantName: '<script>x</script>',
    });
    expect(out.html).not.toContain('<script>');
  });

  it('bouton billing rendu si url https', () => {
    const out = renderSubscriptionTemplate('subscription.cancelled', 'fr', baseVars);
    expect(out.html).toContain('href="https://x.translog.pro');
  });

  it('fallback fr si langue inconnue', () => {
    const out = renderSubscriptionTemplate('subscription.created', 'wo' as 'fr', baseVars);
    expect(out.title).toContain('Abonnement');
  });
});
