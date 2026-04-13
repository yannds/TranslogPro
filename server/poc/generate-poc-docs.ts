/**
 * generate-poc-docs.ts — Script POC moteur de rendu documents
 *
 * Génère des fichiers HTML (+ PDF si Puppeteer dispo) pour tester
 * TOUS les renderers haute-fidélité sans base de données ni backend.
 *
 * Données de démonstration : transporteur fictif "SATR Express"
 *
 * Usage :
 *   cd /path/to/TranslogPro
 *   npx ts-node --project tsconfig.json server/poc/generate-poc-docs.ts
 *
 * Sortie : server/poc/output/*.html  (ouvrir dans Chrome ou Firefox)
 *          server/poc/output/*.pdf   (si Puppeteer installé)
 */

import * as fs   from 'fs';
import * as path from 'path';

// ─── Imports des renderers ─────────────────────────────────────────────────
// Note: les imports TypeScript compilent directement via ts-node
import { renderInvoicePro }  from '../../src/modules/documents/renderers/invoice-pro.renderer';
import { renderTicketStub }  from '../../src/modules/documents/renderers/ticket-stub.renderer';
import { renderMultiLabel }  from '../../src/modules/documents/renderers/multi-label.renderer';
import { renderEnvelope }    from '../../src/modules/documents/renderers/envelope.renderer';
import { renderBaggageTag }  from '../../src/modules/documents/renderers/baggage-tag.renderer';

// ─── Répertoire de sortie ─────────────────────────────────────────────────
const OUT_DIR = path.join(__dirname, 'output');
fs.mkdirSync(OUT_DIR, { recursive: true });

function write(filename: string, content: string): void {
  const filepath = path.join(OUT_DIR, filename);
  fs.writeFileSync(filepath, content, 'utf-8');
  console.log(`  ✓ ${filename}  (${Math.round(content.length / 1024)} KB)`);
}

// ─── Fixtures communes ─────────────────────────────────────────────────────

const TENANT_NAME = 'SATR Express';
const ACTOR_ID    = 'admin-demo-001';

const NOW      = new Date('2026-04-13T08:00:00Z');
const DEPART   = new Date('2026-04-14T06:30:00Z');
const ARRIVE   = new Date('2026-04-14T12:15:00Z');
const DUE_AT   = new Date('2026-04-20T00:00:00Z');

const SELLER = {
  name:    TENANT_NAME,
  address: 'Avenue de la République, Dakar, Sénégal',
  phone:   '+221 33 123 45 67',
  email:   'facturation@satr-express.sn',
  nif:     'SN-2024-00123',
  rccm:    'DKR/2024/B/01234',
  bank:    'CBAO Groupe Attijariwafa Bank',
  iban:    'SN28 A 00101 152000 00001234567',
};

const CLIENT_A = {
  name:    'Ibrahima Diallo',
  phone:   '+221 77 456 78 90',
  address: '12 Rue des Almadies, Dakar',
  email:   'i.diallo@email.sn',
  taxId:   null,
};

const CLIENT_B = {
  name:    'Mariama Kouyaté',
  phone:   '+224 62 345 67 89',
  address: 'Quartier Koloma, Conakry',
  email:   'mariama.k@email.com',
  taxId:   null,
};

// ─── POC 1 : Facture Pro A4 avec talon ────────────────────────────────────

async function poc1InvoicePro(): Promise<void> {
  console.log('\n[1/5] Facture professionnelle (invoice-pro)...');

  const html = await renderInvoicePro({
    invoiceNumber: 'FAC-2026-00847',
    issuedAt:      NOW,
    dueAt:         DUE_AT,
    client:        CLIENT_A,
    seller:        SELLER,
    lines: [
      { description: 'Billet Dakar → Bamako (Classe Économie)',   quantity: 2, unitPriceHt: 25000,  tvaRate: 0.18 },
      { description: 'Billet Dakar → Bamako (Classe Business)',   quantity: 1, unitPriceHt: 45000,  tvaRate: 0.18 },
      { description: 'Supplément bagage 23 kg (x2)',              quantity: 2, unitPriceHt: 5000,   tvaRate: 0.18 },
      { description: 'Assurance voyage (forfait)',                 quantity: 3, unitPriceHt: 2500,   tvaRate: 0.00 },
    ],
    currency: 'FCFA',
    notes:    'Réservation confirmée sous 48h. Annulation remboursable à 80% avant 7 jours.',
    actorId:  ACTOR_ID,
  });

  write('poc-invoice-pro.html', html);
}

// ─── POC 2 : Billet Boarding-Pass avec talon ─────────────────────────────

async function poc2TicketStub(): Promise<void> {
  console.log('\n[2/5] Billet boarding-pass avec talon (ticket-stub)...');

  const html = await renderTicketStub({
    ticket: {
      id:            'TKT-2026-00123',
      passengerName: 'Ibrahima DIALLO',
      seatNumber:    '14C',
      pricePaid:     28000,
      status:        'CONFIRMED',
      qrToken:       'TKT-2026-00123:DAKAR-BAMAKO:14C:SHA256:a3f9b8c1',
      createdAt:     NOW,
      expiresAt:     null,
      class:         'ECONOMY',
    },
    trip: {
      id:                 'TRIP-2026-04140630',
      departureScheduled: DEPART,
      arrivalScheduled:   ARRIVE,
      route: {
        name:          'Dakar — Bamako Express',
        originId:      'Dakar, Sénégal',
        destinationId: 'Bamako, Mali',
      },
      bus: {
        plateNumber: 'DK 4521 AB',
        model:       'Mercedes Tourismo 15RHD',
      },
    },
    tenantName: TENANT_NAME,
    actorId:    ACTOR_ID,
  });

  write('poc-ticket-stub.html', html);
}

// ─── POC 3 : Planche multi-étiquettes colis (2×4) ────────────────────────

async function poc3MultiLabel(): Promise<void> {
  console.log('\n[3/5] Planche multi-étiquettes colis 2×4 (multi-label)...');

  const html = await renderMultiLabel({
    tenantName: TENANT_NAME,
    layout:     '2x4',
    actorId:    ACTOR_ID,
    items: [
      {
        trackingCode:  'COLIS-2026-00451',
        weight:        8.5,
        price:         12000,
        status:        'IN_TRANSIT',
        createdAt:     NOW,
        recipientInfo: { name: 'Mariama Kouyaté', phone: '+224 62 345 67 89', address: 'Koloma, Conakry' },
        sender:        { name: 'Boutique Dakar Mode', email: 'contact@dakar-mode.sn' } as any,
        destination:   { name: 'Agence Conakry Centre', city: 'Conakry' },
      },
      {
        trackingCode:  'COLIS-2026-00452',
        weight:        2.1,
        price:         4500,
        status:        'COLLECTED',
        createdAt:     NOW,
        recipientInfo: { name: 'Oumar Traoré', phone: '+223 76 123 45 67', address: 'Lafiabougou, Bamako' },
        sender:        { name: 'Pharmacie Centrale', email: 'pharma@centrale.sn' },
        destination:   { name: 'Agence Bamako Nord', city: 'Bamako' },
      },
      {
        trackingCode:  'COLIS-2026-00453',
        weight:        14.0,
        price:         22500,
        status:        'AT_DESTINATION',
        createdAt:     NOW,
        recipientInfo: { name: 'Aissatou Barry', phone: '+224 65 987 65 43', address: 'Matam, Conakry' },
        sender:        { name: 'SATR Logistics', email: undefined },
        destination:   { name: 'Agence Conakry Port', city: 'Conakry' },
      },
      {
        trackingCode:  'COLIS-2026-00454',
        weight:        5.3,
        price:         8000,
        status:        'OUT_FOR_DELIVERY',
        createdAt:     NOW,
        recipientInfo: { name: 'Cheikh Ndiaye', phone: '+221 77 654 32 10', address: 'Pikine, Dakar' },
        sender:        { name: 'Import Bamako', email: undefined },
        destination:   { name: 'Agence Pikine', city: 'Dakar' },
      },
      {
        trackingCode:  'COLIS-2026-00455',
        weight:        1.8,
        price:         3200,
        status:        'CONFIRMED',
        createdAt:     NOW,
        recipientInfo: { name: 'Fatou Sow', phone: '+221 70 111 22 33', address: 'Ziguinchor' },
        sender:        { name: 'Boutique Kaolack', email: undefined },
        destination:   { name: 'Agence Ziguinchor', city: 'Ziguinchor' },
      },
      {
        trackingCode:  'COLIS-2026-00456',
        weight:        22.5,
        price:         35000,
        status:        'DELIVERED',
        createdAt:     NOW,
        recipientInfo: { name: 'Alpha Camara', phone: '+224 64 555 66 77', address: 'Kaloum, Conakry' },
        sender:        { name: 'Sarl Tekki', email: 'tekki@tekki.sn' },
        destination:   { name: 'Agence Kaloum', city: 'Conakry' },
      },
      {
        trackingCode:  'COLIS-2026-00457',
        weight:        0.9,
        price:         1500,
        status:        'IN_TRANSIT',
        createdAt:     NOW,
        recipientInfo: { name: 'Mamadou Balde', phone: '+224 61 444 33 22', address: 'Hamdallaye, Conakry' },
        sender:        { name: undefined, email: undefined },
        destination:   { name: 'Agence Hamdallaye', city: 'Conakry' },
      },
      {
        trackingCode:  'COLIS-2026-00458',
        weight:        6.7,
        price:         10000,
        status:        'COLLECTED',
        createdAt:     NOW,
        recipientInfo: { name: 'Seydou Keïta', phone: '+223 79 888 77 66', address: 'Badalabougou, Bamako' },
        sender:        { name: 'Express Shop', email: undefined },
        destination:   { name: 'Agence Bamako Sud', city: 'Bamako' },
      },
    ],
  });

  write('poc-multi-label-2x4.html', html);

  // Version 2×2 (4 grandes étiquettes)
  const html2x2 = await renderMultiLabel({
    tenantName: TENANT_NAME,
    layout:     '2x2',
    actorId:    ACTOR_ID,
    items: [
      {
        trackingCode:  'COLIS-2026-00461',
        weight:        45.0,
        price:         68000,
        status:        'IN_TRANSIT',
        createdAt:     NOW,
        recipientInfo: { name: 'Société BATA Conakry', phone: '+224 30 456 78 90', address: 'Quartier Madina, Conakry' },
        sender:        { name: 'Entrepôt SATR Dakar', email: 'logistique@satr.sn' },
        destination:   { name: 'Agence Conakry Centre', city: 'Conakry' },
      },
      {
        trackingCode:  'COLIS-2026-00462',
        weight:        18.2,
        price:         27000,
        status:        'COLLECTED',
        createdAt:     NOW,
        recipientInfo: { name: 'Pharmacie du Peuple', phone: '+223 20 123 45 67', address: 'Quartier du Fleuve, Bamako' },
        sender:        { name: 'Grossiste Dakar Médical', email: undefined },
        destination:   { name: 'Agence Bamako Centre', city: 'Bamako' },
      },
      {
        trackingCode:  'COLIS-2026-00463',
        weight:        3.5,
        price:         5500,
        status:        'OUT_FOR_DELIVERY',
        createdAt:     NOW,
        recipientInfo: { name: 'Diallo Electronics', phone: '+221 77 999 88 77', address: 'Thiaroye, Dakar' },
        sender:        { name: 'Import Asie Express', email: 'import@asie.sn' },
        destination:   { name: 'Agence Thiaroye', city: 'Dakar' },
      },
      {
        trackingCode:  'COLIS-2026-00464',
        weight:        11.0,
        price:         16500,
        status:        'AT_DESTINATION',
        createdAt:     NOW,
        recipientInfo: { name: 'Kantara SARL', phone: '+224 63 777 88 99', address: 'Dixinn, Conakry' },
        sender:        { name: 'Import Abidjan', email: undefined },
        destination:   { name: 'Agence Dixinn', city: 'Conakry' },
      },
    ],
  });

  write('poc-multi-label-2x2.html', html2x2);
}

// ─── POC 4 : Enveloppe C5 + DL ────────────────────────────────────────────

async function poc4Envelope(): Promise<void> {
  console.log('\n[4/5] Enveloppes C5 et DL (envelope)...');

  const htmlC5 = await renderEnvelope({
    format:     'C5',
    tenantName: TENANT_NAME,
    actorId:    ACTOR_ID,
    reference:  'COLIS-2026-00451',
    barcode:    'https://track.satr-express.sn/COLIS-2026-00451',
    sender: {
      name:    TENANT_NAME,
      address: 'Avenue de la République, BP 1234',
      city:    'Dakar',
      zip:     'BP 1234',
    },
    recipient: {
      name:    CLIENT_B.name,
      address: CLIENT_B.address!,
      city:    'Conakry',
      zip:     'BP 5678',
      country: 'Guinée',
    },
  });
  write('poc-envelope-c5.html', htmlC5);

  const htmlDL = await renderEnvelope({
    format:     'DL',
    tenantName: TENANT_NAME,
    actorId:    ACTOR_ID,
    reference:  'FAC-2026-00847',
    barcode:    'https://factures.satr-express.sn/FAC-2026-00847',
    sender: {
      name:    TENANT_NAME,
      address: 'Avenue de la République, BP 1234',
      city:    'Dakar',
    },
    recipient: {
      name:    CLIENT_A.name,
      address: CLIENT_A.address!,
      city:    'Dakar',
      country: 'Sénégal',
    },
  });
  write('poc-envelope-dl.html', htmlDL);
}

// ─── POC 5 : Talons bagages ────────────────────────────────────────────────

async function poc5BaggageTags(): Promise<void> {
  console.log('\n[5/5] Talons bagages QR tracking (baggage-tag)...');

  // Bagage 1/2
  const html1 = await renderBaggageTag({
    tag: {
      trackingCode: 'SATR-BAG-00123-1',
      weight:       22.5,
      bagNumber:    1,
      totalBags:    2,
      description:  'Valise rigide 24" — couleur bordeaux',
    },
    passenger: {
      name:     'Ibrahima DIALLO',
      phone:    '+221 77 456 78 90',
      ticketId: 'TKT-2026-00123',
    },
    trip: {
      id:                  'TRIP-2026-04140630',
      departureScheduled:  DEPART,
      origin:              'Dakar, Sénégal',
      destination:         'Bamako, Mali',
      routeName:           'Dakar — Bamako Express',
      busPlate:            'DK 4521 AB',
    },
    tenantName: TENANT_NAME,
    actorId:    ACTOR_ID,
  });
  write('poc-baggage-tag-1.html', html1);

  // Bagage 2/2
  const html2 = await renderBaggageTag({
    tag: {
      trackingCode: 'SATR-BAG-00123-2',
      weight:       8.0,
      bagNumber:    2,
      totalBags:    2,
      description:  'Sac à dos noir — fragile',
    },
    passenger: {
      name:     'Ibrahima DIALLO',
      phone:    '+221 77 456 78 90',
      ticketId: 'TKT-2026-00123',
    },
    trip: {
      id:                  'TRIP-2026-04140630',
      departureScheduled:  DEPART,
      origin:              'Dakar, Sénégal',
      destination:         'Bamako, Mali',
      routeName:           'Dakar — Bamako Express',
      busPlate:            'DK 4521 AB',
    },
    tenantName: TENANT_NAME,
    actorId:    ACTOR_ID,
  });
  write('poc-baggage-tag-2.html', html2);

  // Bagage colis express (tracking)
  const html3 = await renderBaggageTag({
    tag: {
      trackingCode: 'COLIS-EXPRESS-2026-00451',
      weight:       8.5,
      bagNumber:    1,
      totalBags:    1,
      description:  'Colis commercial — Boutique Dakar Mode',
    },
    passenger: {
      name:     'Mariama Kouyaté (destinataire)',
      phone:    '+224 62 345 67 89',
      ticketId: null,
    },
    trip: {
      id:                  'TRIP-2026-04140630',
      departureScheduled:  DEPART,
      origin:              'Dakar, Sénégal',
      destination:         'Conakry, Guinée',
      routeName:           'Dakar — Conakry Cargo',
      busPlate:            'DK 9812 CD',
    },
    tenantName: TENANT_NAME,
    actorId:    ACTOR_ID,
  });
  write('poc-baggage-tag-colis.html', html3);
}

// ─── Génère la page d'index HTML ──────────────────────────────────────────

function generateIndex(files: string[]): void {
  const links = files.map(f =>
    `<li><a href="${f}" target="_blank" style="color:#3b82f6;font-size:14px;">${f}</a></li>`
  ).join('\n    ');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>TranslogPro — POC Documents</title>
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 680px; margin: 40px auto; padding: 0 20px; color: #0f172a; }
    h1   { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
    p    { color: #64748b; font-size: 14px; margin-bottom: 24px; }
    ul   { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    li a { display: block; padding: 12px 16px; border-radius: 8px; border: 1px solid #e2e8f0;
           text-decoration: none; background: #f8fafc; transition: background .15s; }
    li a:hover { background: #eff6ff; border-color: #3b82f6; }
    .badge { display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 6px;
             border-radius: 4px; margin-left: 8px; background: #0f172a; color: #fff;
             text-transform: uppercase; letter-spacing: .06em; vertical-align: middle; }
  </style>
</head>
<body>
  <h1>TranslogPro — POC Documents</h1>
  <p>Ouvrir chaque fichier dans Chrome/Firefox pour voir le rendu WYSIWYG.<br>
     Ctrl+P déclenche l'impression avec les styles @media print embarqués.</p>
  <ul>
    ${links}
  </ul>
  <p style="margin-top:32px;font-size:12px;color:#94a3b8;">
    Généré le ${new Date().toLocaleString('fr-FR')} · SATR Express (données factices)
  </p>
</body>
</html>`;

  write('index.html', html);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('══════════════════════════════════════════════');
  console.log('  TranslogPro — POC Moteur de Rendu Documents');
  console.log('══════════════════════════════════════════════');
  console.log(`  Sortie : ${OUT_DIR}`);

  try {
    await poc1InvoicePro();
    await poc2TicketStub();
    await poc3MultiLabel();
    await poc4Envelope();
    await poc5BaggageTags();

    const files = [
      'poc-invoice-pro.html',
      'poc-ticket-stub.html',
      'poc-multi-label-2x4.html',
      'poc-multi-label-2x2.html',
      'poc-envelope-c5.html',
      'poc-envelope-dl.html',
      'poc-baggage-tag-1.html',
      'poc-baggage-tag-2.html',
      'poc-baggage-tag-colis.html',
    ];

    generateIndex(files);

    console.log('\n══════════════════════════════════════════════');
    console.log('  ✅ Génération terminée !');
    console.log(`  Ouvrir : server/poc/output/index.html`);
    console.log('══════════════════════════════════════════════');
  } catch (err) {
    console.error('\n❌ Erreur :', err);
    process.exit(1);
  }
}

main();
