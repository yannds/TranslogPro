/**
 * Templates email Subscription — abonnement tenant.
 *
 * 4 templates :
 *   1. subscription.created          — confirmation d'abonnement
 *   2. subscription.cancelled        — confirmation d'annulation + offre rétention
 *   3. subscription.trial_expiring   — rappel J-3 fin de trial
 *   4. subscription.payment_failed   — paiement de renouvellement échoué
 *
 * Note : welcome tenant (signup.welcome) + activation Day1/3/7 + dunning D+1/4/7
 * + renewal J-3 sont DÉJÀ implémentés dans leurs services dédiés (avec leurs
 * propres templates inline). Ces 4 templates couvrent les events pour le
 * testeur plateforme et permettent une future migration vers le registre
 * central + listener unifié.
 */

export type SubscriptionTemplateId =
  | 'subscription.created'
  | 'subscription.cancelled'
  | 'subscription.trial_expiring'
  | 'subscription.payment_failed';

type Lang = 'fr' | 'en';

interface RenderedTemplate { title: string; body: string; html: string; }

interface TemplateVars {
  adminName:   string;
  tenantName:  string;
  planName:    string;
  formattedPrice: string;   // ex: "49 000 XAF / mois"
  trialEndsAt: string;      // localisé
  cancelledAt: string;      // localisé
  reason:      string;      // motif annulation ou échec paiement
  billingUrl:  string;
}

type RenderFn = (v: TemplateVars) => RenderedTemplate;

const TEMPLATES: Record<SubscriptionTemplateId, Record<Lang, RenderFn>> = {
  // ─── 1. Created ────────────────────────────────────────────────────────────
  'subscription.created': {
    fr: (v) => ({
      title: `Abonnement ${v.planName} confirmé — ${v.tenantName}`,
      body:  `Bonjour ${v.adminName}, votre abonnement ${v.planName} pour ${v.tenantName} est actif (${v.formattedPrice}). Bienvenue !`,
      html:  htmlWrap(
        `Abonnement confirmé`,
        `<p>Bonjour ${escape(v.adminName)},</p>
         <p>Votre abonnement <strong>${escape(v.planName)}</strong> pour <strong>${escape(v.tenantName)}</strong> est désormais <strong>actif</strong>.</p>
         <p><strong>Tarif :</strong> ${escape(v.formattedPrice)}</p>
         <p>Vous accédez maintenant à toutes les fonctionnalités de votre plan.</p>
         ${safeButton(v.billingUrl, 'Gérer mon abonnement')}`,
      ),
    }),
    en: (v) => ({
      title: `${v.planName} subscription confirmed — ${v.tenantName}`,
      body:  `Hello ${v.adminName}, your ${v.planName} subscription for ${v.tenantName} is active (${v.formattedPrice}). Welcome!`,
      html:  htmlWrap(
        `Subscription confirmed`,
        `<p>Hello ${escape(v.adminName)},</p>
         <p>Your <strong>${escape(v.planName)}</strong> subscription for <strong>${escape(v.tenantName)}</strong> is now <strong>active</strong>.</p>
         <p><strong>Price:</strong> ${escape(v.formattedPrice)}</p>
         <p>You now have access to all features in your plan.</p>
         ${safeButton(v.billingUrl, 'Manage my subscription')}`,
      ),
    }),
  },

  // ─── 2. Cancelled ──────────────────────────────────────────────────────────
  'subscription.cancelled': {
    fr: (v) => ({
      title: `Abonnement annulé — ${v.tenantName}`,
      body:  `Bonjour ${v.adminName}, votre abonnement ${v.planName} pour ${v.tenantName} a été annulé${v.cancelledAt ? ` le ${v.cancelledAt}` : ''}. Vous pouvez le réactiver à tout moment.`,
      html:  htmlWrap(
        `Abonnement annulé`,
        `<p>Bonjour ${escape(v.adminName)},</p>
         <p>Votre abonnement <strong>${escape(v.planName)}</strong> pour <strong>${escape(v.tenantName)}</strong> a été <strong>annulé</strong>${v.cancelledAt ? ` le <strong>${escape(v.cancelledAt)}</strong>` : ''}.</p>
         ${v.reason ? `<p>Motif : ${escape(v.reason)}</p>` : ''}
         <p>Vos données restent disponibles en lecture seule pendant 30 jours, puis archivées 12 mois avant suppression définitive.</p>
         <p>Vous pouvez réactiver votre abonnement à tout moment depuis l'espace facturation.</p>
         ${safeButton(v.billingUrl, 'Réactiver mon abonnement')}`,
      ),
    }),
    en: (v) => ({
      title: `Subscription cancelled — ${v.tenantName}`,
      body:  `Hello ${v.adminName}, your ${v.planName} subscription for ${v.tenantName} has been cancelled${v.cancelledAt ? ` on ${v.cancelledAt}` : ''}. You can reactivate it at any time.`,
      html:  htmlWrap(
        `Subscription cancelled`,
        `<p>Hello ${escape(v.adminName)},</p>
         <p>Your <strong>${escape(v.planName)}</strong> subscription for <strong>${escape(v.tenantName)}</strong> has been <strong>cancelled</strong>${v.cancelledAt ? ` on <strong>${escape(v.cancelledAt)}</strong>` : ''}.</p>
         ${v.reason ? `<p>Reason: ${escape(v.reason)}</p>` : ''}
         <p>Your data remains available read-only for 30 days, then archived for 12 months before final deletion.</p>
         <p>You can reactivate your subscription at any time from the billing area.</p>
         ${safeButton(v.billingUrl, 'Reactivate my subscription')}`,
      ),
    }),
  },

  // ─── 3. Trial expiring ─────────────────────────────────────────────────────
  'subscription.trial_expiring': {
    fr: (v) => ({
      title: `Votre essai expire bientôt — ${v.tenantName}`,
      body:  `Bonjour ${v.adminName}, votre période d'essai pour ${v.tenantName} se termine ${v.trialEndsAt ? `le ${v.trialEndsAt}` : 'bientôt'}. Choisissez un plan pour continuer à utiliser TransLog Pro.`,
      html:  htmlWrap(
        `Votre essai gratuit se termine bientôt`,
        `<p>Bonjour ${escape(v.adminName)},</p>
         <p>Votre période d'essai gratuit pour <strong>${escape(v.tenantName)}</strong> se termine ${v.trialEndsAt ? `le <strong>${escape(v.trialEndsAt)}</strong>` : '<strong>bientôt</strong>'}.</p>
         <p style="background:#fef3c7;border-left:3px solid #f59e0b;padding:10px">
           Pour continuer à utiliser TransLog Pro sans interruption, choisissez un plan dès maintenant.
         </p>
         <p>Si vous ne sélectionnez pas de plan, votre tenant passera en lecture seule à l'expiration.</p>
         ${safeButton(v.billingUrl, 'Choisir mon plan')}`,
      ),
    }),
    en: (v) => ({
      title: `Your trial expires soon — ${v.tenantName}`,
      body:  `Hello ${v.adminName}, your trial for ${v.tenantName} ends ${v.trialEndsAt ? `on ${v.trialEndsAt}` : 'soon'}. Choose a plan to keep using TransLog Pro.`,
      html:  htmlWrap(
        `Your free trial ends soon`,
        `<p>Hello ${escape(v.adminName)},</p>
         <p>Your free trial for <strong>${escape(v.tenantName)}</strong> ends ${v.trialEndsAt ? `on <strong>${escape(v.trialEndsAt)}</strong>` : '<strong>soon</strong>'}.</p>
         <p style="background:#fef3c7;border-left:3px solid #f59e0b;padding:10px">
           To keep using TransLog Pro without interruption, choose a plan now.
         </p>
         <p>If no plan is selected, your tenant will switch to read-only at expiration.</p>
         ${safeButton(v.billingUrl, 'Choose my plan')}`,
      ),
    }),
  },

  // ─── 4. Payment failed ─────────────────────────────────────────────────────
  'subscription.payment_failed': {
    fr: (v) => ({
      title: `Échec du paiement — ${v.tenantName}`,
      body:  `Bonjour ${v.adminName}, le paiement de ${v.formattedPrice} pour votre abonnement ${v.planName} (${v.tenantName}) a échoué${v.reason ? ` (${v.reason})` : ''}. Mettez à jour votre moyen de paiement pour éviter une suspension.`,
      html:  htmlWrap(
        `Échec du paiement de votre abonnement`,
        `<p>Bonjour ${escape(v.adminName)},</p>
         <p>Le paiement de <strong>${escape(v.formattedPrice)}</strong> pour votre abonnement <strong>${escape(v.planName)}</strong> (${escape(v.tenantName)}) a <strong>échoué</strong>.</p>
         ${v.reason ? `<p>Motif : ${escape(v.reason)}</p>` : ''}
         <p style="background:#fee2e2;border-left:3px solid #ef4444;padding:10px">
           Mettez à jour votre moyen de paiement rapidement pour éviter une suspension de service.
         </p>
         ${safeButton(v.billingUrl, 'Mettre à jour mon paiement')}`,
      ),
    }),
    en: (v) => ({
      title: `Payment failed — ${v.tenantName}`,
      body:  `Hello ${v.adminName}, the payment of ${v.formattedPrice} for your ${v.planName} subscription (${v.tenantName}) failed${v.reason ? ` (${v.reason})` : ''}. Update your payment method to avoid a suspension.`,
      html:  htmlWrap(
        `Subscription payment failed`,
        `<p>Hello ${escape(v.adminName)},</p>
         <p>The payment of <strong>${escape(v.formattedPrice)}</strong> for your <strong>${escape(v.planName)}</strong> subscription (${escape(v.tenantName)}) <strong>failed</strong>.</p>
         ${v.reason ? `<p>Reason: ${escape(v.reason)}</p>` : ''}
         <p style="background:#fee2e2;border-left:3px solid #ef4444;padding:10px">
           Update your payment method quickly to avoid service suspension.
         </p>
         ${safeButton(v.billingUrl, 'Update my payment method')}`,
      ),
    }),
  },
};

export function renderSubscriptionTemplate(
  templateId: SubscriptionTemplateId,
  lang:       Lang,
  vars:       TemplateVars,
): RenderedTemplate {
  const localeMap = TEMPLATES[templateId];
  return (localeMap[lang] ?? localeMap.fr)(vars);
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function htmlWrap(title: string, body: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:20px;">
<h2 style="color:#0f172a">${escape(title)}</h2>
${body}
<hr style="margin-top:24px;border:0;border-top:1px solid #e2e8f0">
<p style="color:#64748b;font-size:12px">TransLog Pro</p>
</body></html>`;
}

function safeButton(url: string, label: string): string {
  if (!url || !/^https?:\/\//.test(url)) return '';
  return `<p style="margin-top:20px"><a href="${escape(url)}" style="display:inline-block;padding:10px 18px;background:#0f172a;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">${escape(label)}</a></p>`;
}
