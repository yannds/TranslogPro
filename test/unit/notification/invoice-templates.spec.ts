/**
 * Tests des 4 templates Invoice (issued / paid / overdue / cancelled)
 * en fr et en. Couvre :
 *   - Présence des variables substituées dans subject/body/html
 *   - Échappement HTML des variables (anti-XSS)
 *   - Bouton lien rendu uniquement si url http(s) valide
 *   - Fallback fr si la langue est inconnue
 */
import {
  renderInvoiceTemplate,
  InvoiceTemplateId,
} from '../../../src/modules/notification/email-templates/invoice-templates';

const baseVars = {
  invoiceNumber:   'INV-2026-00042',
  customerName:    'Jean Mbemba',
  formattedAmount: '12 500 XAF',
  issuedDate:      'lundi 27 avril 2026',
  dueDate:         'mardi 27 mai 2026',
  paidAt:          'lundi 27 avril 2026',
  paymentMethod:   'Mobile Money',
  daysOverdue:     '5',
  portalUrl:       'https://app.translog.pro/invoices/INV-42',
};

describe('renderInvoiceTemplate', () => {
  const ids: InvoiceTemplateId[] = [
    'invoice.issued',
    'invoice.paid',
    'invoice.overdue',
    'invoice.cancelled',
  ];

  it.each(ids)('rend %s en fr — variables clés présentes', (id) => {
    const out = renderInvoiceTemplate(id, 'fr', baseVars);
    expect(out.title).toContain('INV-2026-00042');
    expect(out.body).toContain('Jean Mbemba');
    expect(out.html).toContain('Jean Mbemba');
    expect(out.html).toContain('INV-2026-00042');
    expect(out.html).toContain('12 500 XAF');
  });

  it.each(ids)('rend %s en en — variables clés présentes', (id) => {
    const out = renderInvoiceTemplate(id, 'en', baseVars);
    expect(out.title).toContain('INV-2026-00042');
    expect(out.body).toContain('Jean Mbemba');
    expect(out.html).toContain('Jean Mbemba');
    expect(out.html).toContain('INV-2026-00042');
  });

  it('invoice.issued affiche échéance si dueDate présente', () => {
    const out = renderInvoiceTemplate('invoice.issued', 'fr', baseVars);
    expect(out.html).toContain('mardi 27 mai 2026');
    expect(out.body).toContain('échéance mardi 27 mai 2026');
  });

  it('invoice.issued masque échéance si dueDate vaut "-"', () => {
    const out = renderInvoiceTemplate('invoice.issued', 'fr', { ...baseVars, dueDate: '-' });
    expect(out.html).not.toContain('Échéance');
    expect(out.body).not.toContain('échéance');
  });

  it('invoice.paid affiche le moyen de paiement quand fourni', () => {
    const out = renderInvoiceTemplate('invoice.paid', 'fr', baseVars);
    expect(out.html).toContain('Mobile Money');
    expect(out.body).toContain('Mobile Money');
  });

  it('invoice.overdue inclut le nombre de jours de retard', () => {
    const out = renderInvoiceTemplate('invoice.overdue', 'fr', baseVars);
    expect(out.title).toContain('en retard');
    expect(out.html).toContain('5 jour(s)');
    expect(out.body).toContain('5 jour(s)');
  });

  it('échappement HTML appliqué sur customerName malveillant', () => {
    const out = renderInvoiceTemplate('invoice.issued', 'fr', {
      ...baseVars,
      customerName: '<script>alert("xss")</script>',
    });
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  it('bouton lien rendu si portalUrl https', () => {
    const out = renderInvoiceTemplate('invoice.issued', 'fr', baseVars);
    expect(out.html).toContain('href="https://app.translog.pro/invoices/INV-42"');
    expect(out.html).toContain('Consulter la facture');
  });

  it('bouton lien NON rendu si portalUrl vide ou non http(s)', () => {
    const noUrl = renderInvoiceTemplate('invoice.issued', 'fr', { ...baseVars, portalUrl: '' });
    expect(noUrl.html).not.toContain('Consulter la facture');

    const javaScriptUrl = renderInvoiceTemplate('invoice.issued', 'fr', {
      ...baseVars,
      portalUrl: 'javascript:alert(1)',
    });
    expect(javaScriptUrl.html).not.toContain('javascript:');
  });

  it('fallback fr si langue inconnue', () => {
    // Cast type-safe — simule un lang incorrect en runtime (autres locales)
    const out = renderInvoiceTemplate('invoice.paid', 'wo' as 'fr', baseVars);
    expect(out.title).toContain('Paiement reçu');
  });
});
