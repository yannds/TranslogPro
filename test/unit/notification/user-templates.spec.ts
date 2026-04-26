/**
 * Tests du template user.invited (fr+en).
 */
import {
  renderUserTemplate,
} from '../../../src/modules/notification/email-templates/user-templates';

const baseVars = {
  inviteeName: 'Awa Diallo',
  tenantName:  'Trans Express CG',
  roleName:    'Caissier',
  agencyName:  'Agence Brazzaville',
  resetUrl:    'https://trans-express.translog.pro/auth/forgot-password?email=awa%40example.com',
};

describe('renderUserTemplate', () => {
  it('rend user.invited en fr', () => {
    const out = renderUserTemplate('user.invited', 'fr', baseVars);
    expect(out.title).toContain('Trans Express CG');
    expect(out.body).toContain('Awa Diallo');
    expect(out.html).toContain('Awa Diallo');
    expect(out.html).toContain('Trans Express CG');
    expect(out.html).toContain('Caissier');
    expect(out.html).toContain('Agence Brazzaville');
  });

  it('rend user.invited en en', () => {
    const out = renderUserTemplate('user.invited', 'en', baseVars);
    expect(out.title).toContain('your Trans Express CG account');
    expect(out.html).toContain('Welcome to Trans Express CG');
  });

  it('masque le rôle si vide', () => {
    const out = renderUserTemplate('user.invited', 'fr', { ...baseVars, roleName: '' });
    expect(out.html).not.toContain('Rôle');
  });

  it('masque l\'agence si vide', () => {
    const out = renderUserTemplate('user.invited', 'fr', { ...baseVars, agencyName: '' });
    expect(out.html).not.toContain('Agence :');
  });

  it('échappement HTML appliqué sur tenantName + name malveillants', () => {
    const out = renderUserTemplate('user.invited', 'fr', {
      ...baseVars,
      tenantName:  '<img src=x onerror=alert(1)>',
      inviteeName: '<script>alert(2)</script>',
    });
    expect(out.html).not.toContain('<img');
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;img');
    expect(out.html).toContain('&lt;script&gt;');
  });

  it('bouton "Définir mon mot de passe" rendu si resetUrl https', () => {
    const out = renderUserTemplate('user.invited', 'fr', baseVars);
    expect(out.html).toContain('Définir mon mot de passe');
    expect(out.html).toContain('href="https://trans-express.translog.pro');
  });

  it('bouton NON rendu si resetUrl vide', () => {
    const out = renderUserTemplate('user.invited', 'fr', { ...baseVars, resetUrl: '' });
    expect(out.html).not.toContain('Définir mon mot de passe');
  });

  it('bouton NON rendu si resetUrl javascript:', () => {
    const out = renderUserTemplate('user.invited', 'fr', { ...baseVars, resetUrl: 'javascript:alert(1)' });
    expect(out.html).not.toContain('javascript:');
  });

  it('fallback fr si langue inconnue', () => {
    const out = renderUserTemplate('user.invited', 'wo' as 'fr', baseVars);
    expect(out.title).toContain('Invitation');
  });
});
