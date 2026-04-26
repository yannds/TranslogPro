/**
 * Tests des 5 templates Auth (sécurité — Tier 3).
 */
import {
  renderAuthTemplate,
  AuthTemplateId,
} from '../../../src/modules/notification/email-templates/auth-templates';

const baseVars = {
  userName:    'Awa Diallo',
  tenantName:  'Trans Express CG',
  resetUrl:    'https://trans-express.translog.pro/auth/reset?token=abc',
  verifyUrl:   'https://trans-express.translog.pro/auth/verify?token=def',
  expiresAt:   'lundi 27 avril 2026 à 09:00',
  completedAt: 'lundi 27 avril 2026 à 08:42',
  ipAddress:   '192.0.2.42',
  factor:      'TOTP',
};

describe('renderAuthTemplate', () => {
  const ids: AuthTemplateId[] = [
    'auth.password_reset.link',
    'auth.password_reset.completed',
    'auth.email_verification',
    'auth.mfa.enabled',
    'auth.mfa.disabled',
  ];

  it.each(ids)('rend %s en fr', (id) => {
    const out = renderAuthTemplate(id, 'fr', baseVars);
    expect(out.body).toContain('Awa Diallo');
    expect(out.html).toContain('Awa Diallo');
  });

  it.each(ids)('rend %s en en', (id) => {
    const out = renderAuthTemplate(id, 'en', baseVars);
    expect(out.body).toContain('Awa Diallo');
  });

  it('auth.password_reset.link mentionne TTL 30 min + bouton', () => {
    const out = renderAuthTemplate('auth.password_reset.link', 'fr', baseVars);
    expect(out.html).toContain('30 minutes');
    expect(out.html).toContain('href="https://trans-express.translog.pro/auth/reset');
    expect(out.html).toContain('Réinitialiser mon mot de passe');
  });

  it('auth.password_reset.completed inclut IP + alerte sécu', () => {
    const out = renderAuthTemplate('auth.password_reset.completed', 'fr', baseVars);
    expect(out.html).toContain('192.0.2.42');
    expect(out.html).toContain('Si ce n\'est pas vous');
  });

  it('auth.mfa.disabled est en bloc rouge avec mention "compromis"', () => {
    const out = renderAuthTemplate('auth.mfa.disabled', 'fr', baseVars);
    expect(out.html).toContain('alerte sécurité');
    expect(out.html).toContain('compromis');
  });

  it('auth.mfa.enabled inclut le facteur (TOTP)', () => {
    const out = renderAuthTemplate('auth.mfa.enabled', 'fr', baseVars);
    expect(out.html).toContain('TOTP');
  });

  it('échappement HTML appliqué sur userName', () => {
    const out = renderAuthTemplate('auth.password_reset.link', 'fr', {
      ...baseVars, userName: '<script>alert(1)</script>',
    });
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  it('bouton lien NON rendu si resetUrl javascript:', () => {
    const out = renderAuthTemplate('auth.password_reset.link', 'fr', {
      ...baseVars, resetUrl: 'javascript:alert(1)',
    });
    expect(out.html).not.toContain('javascript:');
  });

  it('fallback fr si langue inconnue', () => {
    const out = renderAuthTemplate('auth.password_reset.link', 'wo' as 'fr', baseVars);
    expect(out.title).toContain('Réinitialisation');
  });
});
