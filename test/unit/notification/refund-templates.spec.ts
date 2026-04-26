/**
 * Tests des 3 templates Refund (created / approved / rejected) en fr+en.
 */
import {
  renderRefundTemplate,
  RefundTemplateId,
} from '../../../src/modules/notification/email-templates/refund-templates';

const baseVars = {
  recipientName:   'Awa Diallo',
  formattedAmount: '8 750 XAF',
  ticketRef:       'TKT-2026-DEMO-A1B2',
  reasonLabel:     'annulation client',
  policyPercent:   '75%',
  notes:           'Le délai minimum avant départ n\'est pas respecté.',
  paymentMethod:   'Mobile Money',
};

describe('renderRefundTemplate', () => {
  const ids: RefundTemplateId[] = ['refund.created', 'refund.approved', 'refund.rejected'];

  it.each(ids)('rend %s en fr — variables clés présentes', (id) => {
    const out = renderRefundTemplate(id, 'fr', baseVars);
    expect(out.title).toContain('TKT-2026-DEMO-A1B2');
    expect(out.body).toContain('Awa Diallo');
    expect(out.html).toContain('Awa Diallo');
    expect(out.html).toContain('TKT-2026-DEMO-A1B2');
  });

  it.each(ids)('rend %s en en — variables clés présentes', (id) => {
    const out = renderRefundTemplate(id, 'en', baseVars);
    expect(out.title).toContain('TKT-2026-DEMO-A1B2');
    expect(out.body).toContain('Awa Diallo');
  });

  it('refund.created affiche le pourcentage de politique si fourni', () => {
    const out = renderRefundTemplate('refund.created', 'fr', baseVars);
    expect(out.html).toContain('75%');
  });

  it('refund.created masque le pourcentage si vide', () => {
    const out = renderRefundTemplate('refund.created', 'fr', { ...baseVars, policyPercent: '' });
    expect(out.html).not.toContain('Taux applicable');
  });

  it('refund.approved montre le moyen de remboursement', () => {
    const out = renderRefundTemplate('refund.approved', 'fr', baseVars);
    expect(out.html).toContain('Mobile Money');
  });

  it('refund.approved masque le moyen si "-"', () => {
    const out = renderRefundTemplate('refund.approved', 'fr', { ...baseVars, paymentMethod: '-' });
    expect(out.html).not.toContain('Mode de remboursement');
  });

  it('refund.rejected affiche le motif notes en bloc visuel', () => {
    const out = renderRefundTemplate('refund.rejected', 'fr', baseVars);
    expect(out.html).toContain('Le délai minimum avant départ');
    expect(out.html).toContain('Motif :');
    expect(out.body).toContain('Le délai minimum avant départ');
  });

  it('refund.rejected sans notes ne montre pas le bloc motif', () => {
    const out = renderRefundTemplate('refund.rejected', 'fr', { ...baseVars, notes: '' });
    expect(out.html).not.toContain('Motif :');
  });

  it('échappement HTML appliqué sur notes malveillantes', () => {
    const out = renderRefundTemplate('refund.rejected', 'fr', {
      ...baseVars,
      notes: '<script>alert(1)</script>',
    });
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  it('fallback fr si langue inconnue', () => {
    const out = renderRefundTemplate('refund.created', 'wo' as 'fr', baseVars);
    expect(out.title).toContain('Demande de remboursement');
  });
});
