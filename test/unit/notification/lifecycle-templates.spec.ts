import { renderLifecycleTemplate, LifecycleTemplateId } from '../../../src/modules/notification/lifecycle-templates';

const baseVars = {
  routeName:         'Pointe-Noire ⇄ Brazzaville',
  origin:            'Pointe-Noire',
  destination:       'Brazzaville',
  scheduledHHMM:     '08:30',
  scheduledDateLong: 'lundi 27 avril 2026',
};

describe('renderLifecycleTemplate', () => {
  const allTemplates: LifecycleTemplateId[] = [
    'notif.ticket.purchased',
    'notif.trip.published',
    'notif.trip.boarding',
    'notif.trip.reminder',
    'notif.trip.arrived',
  ];

  it.each(allTemplates)('rend titre + body + html non vides en fr pour %s', (templateId) => {
    const out = renderLifecycleTemplate(templateId, 'fr', { ...baseVars });
    expect(out.title).toBeTruthy();
    expect(out.body).toBeTruthy();
    expect(out.html).toContain('<html>');
    expect(out.html).toContain('</html>');
  });

  it.each(allTemplates)('rend titre + body + html non vides en en pour %s', (templateId) => {
    const out = renderLifecycleTemplate(templateId, 'en', { ...baseVars });
    expect(out.title).toBeTruthy();
    expect(out.body).toBeTruthy();
    expect(out.html).toContain('<html>');
  });

  it('reminder fr : titre "demain" si threshold ≥ 24h', () => {
    const out = renderLifecycleTemplate('notif.trip.reminder', 'fr', {
      ...baseVars, hoursThreshold: '24',
    });
    expect(out.title).toMatch(/demain/i);
  });

  it('reminder fr : titre "dans Xh" si 6 ≤ threshold < 24', () => {
    const out = renderLifecycleTemplate('notif.trip.reminder', 'fr', {
      ...baseVars, hoursThreshold: '6',
    });
    expect(out.title).toMatch(/dans 6h/);
  });

  it('reminder fr : titre "approche" si threshold < 6', () => {
    const out = renderLifecycleTemplate('notif.trip.reminder', 'fr', {
      ...baseVars, hoursThreshold: '1',
    });
    expect(out.title).toMatch(/approche/i);
  });

  it('reminder en : titre "tomorrow" si ≥ 24h', () => {
    const out = renderLifecycleTemplate('notif.trip.reminder', 'en', {
      ...baseVars, hoursThreshold: '24',
    });
    expect(out.title).toMatch(/tomorrow/i);
  });

  it('échappe les caractères HTML dans passengerName (sécurité XSS email)', () => {
    const out = renderLifecycleTemplate('notif.ticket.purchased', 'fr', {
      ...baseVars,
      passengerName: '<script>alert(1)</script>',
      ticketId:      'T1',
      price:         '5000',
    });
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  it('fallback fr si la locale est inconnue (ex: ar)', () => {
    const out = renderLifecycleTemplate('notif.ticket.purchased', 'fr', {
      ...baseVars, ticketId: 'T1', price: '5000',
    });
    const fallback = renderLifecycleTemplate(
      'notif.ticket.purchased',
      'ar' as 'fr' | 'en',
      { ...baseVars, ticketId: 'T1', price: '5000' },
    );
    // Le rendu fallback doit être identique au fr
    expect(fallback.title).toEqual(out.title);
  });

  it('inclut le ticketId pour le template ticket.purchased', () => {
    const out = renderLifecycleTemplate('notif.ticket.purchased', 'fr', {
      ...baseVars, ticketId: 'TK-42', price: '7500',
    });
    expect(out.body).toContain('TK-42');
  });

  it('inclut origin et destination dans tous les templates fr', () => {
    for (const id of allTemplates) {
      const out = renderLifecycleTemplate(id, 'fr', { ...baseVars, hoursThreshold: '6' });
      // Au moins un des deux apparaît dans body OU title (ex: arrived n'a que destination)
      expect(out.body + ' ' + out.title).toMatch(/Pointe-Noire|Brazzaville/);
    }
  });
});
