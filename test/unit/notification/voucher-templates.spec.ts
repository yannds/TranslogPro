/**
 * Tests du template voucher.issued (fr+en).
 * Couvre :
 *   - variables substituées dans subject/body/html
 *   - échappement HTML anti-XSS
 *   - bouton lien rendu uniquement si url http(s)
 *   - fallback fr si langue inconnue
 */
import {
  renderVoucherTemplate,
} from '../../../src/modules/notification/email-templates/voucher-templates';

const baseVars = {
  recipientName:   'Awa Diallo',
  voucherCode:     'VCHR-9F3K-2M1X',
  formattedAmount: '5 000 XAF',
  validityEnd:     'mardi 26 mai 2026',
  scopeLabel:      'sur tous nos trajets',
  originLabel:     'geste commercial',
  redeemUrl:       'https://app.translog.pro/vouchers/V1',
};

describe('renderVoucherTemplate', () => {
  it('rend voucher.issued en fr — code, montant, validité, nom', () => {
    const out = renderVoucherTemplate('voucher.issued', 'fr', baseVars);
    expect(out.title).toContain('VCHR-9F3K-2M1X');
    expect(out.title).toContain('5 000 XAF');
    expect(out.body).toContain('Awa Diallo');
    expect(out.body).toContain('mardi 26 mai 2026');
    expect(out.html).toContain('Awa Diallo');
    expect(out.html).toContain('VCHR-9F3K-2M1X');
    expect(out.html).toContain('5 000 XAF');
  });

  it('rend voucher.issued en en', () => {
    const out = renderVoucherTemplate('voucher.issued', 'en', baseVars);
    expect(out.title).toContain('Your voucher');
    expect(out.body).toContain('Hello Awa Diallo');
    expect(out.html).toContain('Hello Awa Diallo');
  });

  it('échappe customerName malveillant (XSS)', () => {
    const out = renderVoucherTemplate('voucher.issued', 'fr', {
      ...baseVars,
      recipientName: '<img src=x onerror=alert(1)>',
    });
    expect(out.html).not.toContain('<img');
    expect(out.html).toContain('&lt;img');
  });

  it('inclut origin et scope dans le HTML', () => {
    const out = renderVoucherTemplate('voucher.issued', 'fr', baseVars);
    expect(out.html).toContain('geste commercial');
    expect(out.html).toContain('sur tous nos trajets');
  });

  it('bouton lien rendu si redeemUrl https', () => {
    const out = renderVoucherTemplate('voucher.issued', 'fr', baseVars);
    expect(out.html).toContain('href="https://app.translog.pro/vouchers/V1"');
    expect(out.html).toContain('Utiliser mon bon');
  });

  it('bouton NON rendu si redeemUrl vide ou non http(s)', () => {
    const empty = renderVoucherTemplate('voucher.issued', 'fr', { ...baseVars, redeemUrl: '' });
    expect(empty.html).not.toContain('Utiliser mon bon');
    const js = renderVoucherTemplate('voucher.issued', 'fr', { ...baseVars, redeemUrl: 'javascript:alert(1)' });
    expect(js.html).not.toContain('javascript:');
  });

  it('fallback fr si langue inconnue', () => {
    const out = renderVoucherTemplate('voucher.issued', 'wo' as 'fr', baseVars);
    expect(out.title).toContain('Votre bon d\'avoir');
  });
});
