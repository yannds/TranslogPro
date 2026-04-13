/**
 * render-pdf.js — Génère les PDFs depuis les HTML POC via Puppeteer réel
 *
 * Usage : node server/poc/render-pdf.js
 *
 * Utilise le Chrome for Testing caché par @puppeteer/browsers.
 * C'est exactement le même chemin qu'en production (PuppeteerService).
 */
const puppeteer = require('puppeteer-core');
const path      = require('path');
const fs        = require('fs');

const CHROME_PATH = '/Users/dsyann/.cache/puppeteer/chrome/mac_arm-138.0.7204.157/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const OUT_DIR  = path.join(__dirname, 'output');

// Format papier → options Puppeteer (miroir exact de puppeteer.service.ts FORMAT_OPTIONS)
const FORMAT_OPTIONS = {
  'invoice':      { width: '210mm', height: '297mm', margin: { top: '12mm', bottom: '12mm', left: '14mm', right: '14mm' } },
  'ticket':       { width: '148mm', height: '210mm', margin: { top: '10mm', bottom: '10mm', left: '12mm', right: '12mm' } },
  'label-a4':     { width: '210mm', height: '297mm', margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } },
  'envelope-c5':  { width: '229mm', height: '162mm', landscape: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } },
  'envelope-dl':  { width: '220mm', height: '110mm', landscape: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } },
  'baggage-tag':  { width: '99mm',  height: '210mm', margin: { top: '4mm',  bottom: '4mm',  left: '4mm',  right: '4mm'  } },
};

const FILES = [
  { html: 'poc-invoice-pro.html',      pdf: 'poc-invoice-pro.pdf',      format: 'invoice' },
  { html: 'poc-ticket-stub.html',      pdf: 'poc-ticket-stub.pdf',      format: 'ticket' },
  { html: 'poc-multi-label-2x4.html',  pdf: 'poc-multi-label-2x4.pdf',  format: 'label-a4' },
  { html: 'poc-multi-label-2x2.html',  pdf: 'poc-multi-label-2x2.pdf',  format: 'label-a4' },
  { html: 'poc-envelope-c5.html',      pdf: 'poc-envelope-c5.pdf',      format: 'envelope-c5' },
  { html: 'poc-envelope-dl.html',      pdf: 'poc-envelope-dl.pdf',      format: 'envelope-dl' },
  { html: 'poc-baggage-tag-1.html',    pdf: 'poc-baggage-tag-1.pdf',    format: 'baggage-tag' },
  { html: 'poc-baggage-tag-2.html',    pdf: 'poc-baggage-tag-2.pdf',    format: 'baggage-tag' },
  { html: 'poc-baggage-tag-colis.html',pdf: 'poc-baggage-tag-colis.pdf',format: 'baggage-tag' },
];

async function main() {
  console.log('══════════════════════════════════════════════');
  console.log('  TranslogPro — Rendu PDF via Puppeteer réel');
  console.log('══════════════════════════════════════════════');
  console.log(`  Chrome: ${CHROME_PATH.slice(-60)}`);
  console.log(`  Sortie: ${OUT_DIR}\n`);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=none',  // meilleur rendu texte en PDF
    ],
  });

  console.log(`  ✓ Chrome lancé (headless)\n`);

  for (const { html, pdf, format } of FILES) {
    const htmlPath = path.join(OUT_DIR, html);
    const pdfPath  = path.join(OUT_DIR, pdf);

    if (!fs.existsSync(htmlPath)) {
      console.log(`  ⚠ Fichier manquant : ${html}`);
      continue;
    }

    const page = await browser.newPage();

    // Charger le HTML via file:// (identique à page.setContent mais avec assets relatifs)
    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });

    // Attendre que les images (QR en base64) soient rendues
    await page.evaluate(() => {
      return Promise.all(
        Array.from(document.images).map(img =>
          img.complete ? Promise.resolve() :
          new Promise(r => { img.onload = r; img.onerror = r; })
        )
      );
    });

    const opts = FORMAT_OPTIONS[format];
    const pdfBuffer = await page.pdf({
      ...opts,
      printBackground: true,    // CRITIQUE : fond sombre (--c-brand), badges, badges colorés
      preferCSSPageSize: true,  // Respecte @page { size: ... } du CSS
    });

    await page.close();

    fs.writeFileSync(pdfPath, pdfBuffer);
    const sizeKb = Math.round(pdfBuffer.length / 1024);
    console.log(`  ✓ ${pdf.padEnd(35)} ${sizeKb} KB`);
  }

  await browser.close();

  // Ouvrir le premier PDF pour vérification visuelle
  const first = path.join(OUT_DIR, FILES[0].pdf);
  const { execSync } = require('child_process');
  try {
    execSync(`open "${first}"`);
    console.log(`\n  → Ouverture de ${FILES[0].pdf} pour vérification...`);
  } catch {}

  console.log('\n══════════════════════════════════════════════');
  console.log('  ✅ Tous les PDFs générés dans server/poc/output/');
  console.log('══════════════════════════════════════════════');
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
