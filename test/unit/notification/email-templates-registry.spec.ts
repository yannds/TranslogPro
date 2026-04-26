/**
 * Tests du registre central des templates email.
 *
 * Vérifie :
 *   - Catalogue exposé (id, group, labels, sampleVars, recipientNameVar).
 *   - Dispatch correct vers les renderers lifecycle existants (zéro régression).
 *   - Fusion `sampleVars + vars utilisateur` (le caller ne doit pas avoir
 *     à fournir toutes les variables pour le testeur plateforme).
 *   - Helper `getKnownTemplateIds()` pour les DTO `@IsIn`.
 *
 * Ces tests doivent rester verts à chaque ajout de tier (Invoice, Voucher…) :
 *   on ajoute des cases pour les nouveaux groupes mais on ne casse pas l'API.
 */

import {
  listEmailTemplates,
  getEmailTemplate,
  renderEmailTemplate,
  getKnownTemplateIds,
} from '../../../src/modules/notification/email-templates';
import { renderLifecycleTemplate } from '../../../src/modules/notification/lifecycle-templates';

describe('EmailTemplate registry — fondation', () => {
  it('expose au moins les 5 descripteurs lifecycle', () => {
    const ids = listEmailTemplates().map(d => d.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'notif.ticket.purchased',
        'notif.trip.published',
        'notif.trip.boarding',
        'notif.trip.reminder',
        'notif.trip.arrived',
      ]),
    );
  });

  it('chaque descripteur expose les champs obligatoires non vides', () => {
    for (const d of listEmailTemplates()) {
      expect(d.id).toMatch(/^[a-z0-9._-]+$/);
      expect(d.group).toBeTruthy();
      expect(d.labelFr.length).toBeGreaterThan(0);
      expect(d.labelEn.length).toBeGreaterThan(0);
      expect(d.descriptionFr.length).toBeGreaterThan(0);
      expect(d.descriptionEn.length).toBeGreaterThan(0);
      expect(typeof d.render).toBe('function');
      expect(d.recipientNameVar.length).toBeGreaterThan(0);
      // recipientNameVar doit être une clé de sampleVars
      expect(Object.prototype.hasOwnProperty.call(d.sampleVars, d.recipientNameVar)).toBe(true);
    }
  });

  it('lifecycle descriptors ont tous recipientNameVar = "passengerName"', () => {
    const lifecycle = listEmailTemplates().filter(d => d.group === 'lifecycle');
    expect(lifecycle.length).toBe(5);
    for (const d of lifecycle) {
      expect(d.recipientNameVar).toBe('passengerName');
    }
  });

  it('getEmailTemplate trouve par id et renvoie undefined si inconnu', () => {
    expect(getEmailTemplate('notif.ticket.purchased')?.id).toBe('notif.ticket.purchased');
    expect(getEmailTemplate('inexistant.template')).toBeUndefined();
  });

  it('renderEmailTemplate délègue au renderer lifecycle (parité fr)', () => {
    const baseVars = {
      routeName:         'Brazzaville → Pointe-Noire',
      origin:            'Brazzaville',
      destination:       'Pointe-Noire',
      scheduledHHMM:     '08:30',
      scheduledDateLong: 'lundi 27 avril 2026',
      passengerName:     'Awa Diallo',
      ticketId:          'TKT-001',
      price:             '12 500 XAF',
    };
    const direct   = renderLifecycleTemplate('notif.ticket.purchased', 'fr', baseVars);
    const viaReg   = renderEmailTemplate('notif.ticket.purchased', 'fr', baseVars);

    expect(viaReg).toBeDefined();
    // Le wrapper mappe (title, body, html) → (subject, text, html)
    expect(viaReg!.subject).toBe(direct.title);
    expect(viaReg!.html).toBe(direct.html);
    expect(viaReg!.text).toBe(direct.body);
  });

  it('renderEmailTemplate délègue au renderer lifecycle (parité en)', () => {
    const out = renderEmailTemplate('notif.trip.boarding', 'en', { passengerName: 'John' });
    expect(out?.subject).toContain('Boarding open');
    expect(out?.html).toContain('John');
    expect(out?.text).toContain('Boarding is now open');
  });

  it('fusionne sampleVars par défaut quand vars partielles', () => {
    // Aucun var fourni → sampleVars du descripteur s'appliquent → rendu non vide
    const out = renderEmailTemplate('notif.ticket.purchased', 'fr', {});
    expect(out).toBeDefined();
    expect(out!.subject).toContain('Brazzaville → Pointe-Noire');
    expect(out!.html).toContain('TKT-2026-DEMO-A1B2');
  });

  it('renderEmailTemplate retourne undefined pour id inconnu', () => {
    expect(renderEmailTemplate('inexistant.template', 'fr', {})).toBeUndefined();
  });

  it('getKnownTemplateIds renvoie tous les ids du catalogue', () => {
    const ids = getKnownTemplateIds();
    const cat = listEmailTemplates();
    expect(ids.length).toBe(cat.length);
    expect(new Set(ids).size).toBe(ids.length); // pas de doublon
  });
});
