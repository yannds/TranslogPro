/**
 * PuppeteerService — Moteur de rendu HTML → PDF WYSIWYG
 *
 * Architecture serverless-compatible :
 *   - puppeteer-core + @sparticuz/chromium (binaire auto-extracté)
 *   - Chromium extrait dans /tmp (compatible Lambda/Cloud Run)
 *   - Instance navigateur réutilisée (pool implicite — 1 instance par pod)
 *
 * Formats supportés (préréglages papier) :
 *   A4 | A5 | THERMAL_80MM | LABEL_62MM | ENVELOPE_C5 | BAGGAGE_TAG
 *
 * Usage :
 *   const pdf = await puppeteerService.htmlToPdf(html, 'A4');
 *   // pdf est un Buffer — uploadez-le directement via IStorageService.putObject()
 */
import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import puppeteer, { Browser, PDFOptions } from 'puppeteer-core';

export type PrintFormat =
  | 'A4'
  | 'A5'
  | 'THERMAL_80MM'
  | 'LABEL_62MM'
  | 'ENVELOPE_C5'
  | 'BAGGAGE_TAG';

/**
 * Correspondances format → options puppeteer PDF
 * Les formats non-standard (Thermal, Label, Baggage) sont définis en mm.
 */
const FORMAT_OPTIONS: Record<PrintFormat, Partial<PDFOptions>> = {
  A4: {
    format: 'A4',
    margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
  },
  A5: {
    format: 'A5',
    margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
  },
  THERMAL_80MM: {
    width:  '80mm',
    // Hauteur auto — croît avec le contenu
    height: '200mm',
    margin: { top: '3mm', right: '3mm', bottom: '3mm', left: '3mm' },
  },
  LABEL_62MM: {
    width:  '62mm',
    height: '100mm',
    margin: { top: '2mm', right: '2mm', bottom: '2mm', left: '2mm' },
  },
  ENVELOPE_C5: {
    // C5 : 162 × 229 mm
    width:  '162mm',
    height: '229mm',
    margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
  },
  BAGGAGE_TAG: {
    // Étiquette bagage standard IATA : 99 × 210 mm
    width:  '99mm',
    height: '210mm',
    margin: { top: '4mm', right: '4mm', bottom: '4mm', left: '4mm' },
  },
};

@Injectable()
export class PuppeteerService implements OnModuleDestroy {
  private readonly logger = new Logger(PuppeteerService.name);
  private browser: Browser | null = null;

  private async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.connected) return this.browser;

    // En environnement CI/local, tenter Chromium système en fallback
    const executablePath = await this.resolveChromiumPath();

    this.browser = await puppeteer.launch({
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none',
      ],
      headless: true,
    });

    this.logger.log('Chromium browser launched');
    return this.browser;
  }

  private async resolveChromiumPath(): Promise<string> {
    // @sparticuz/chromium disponible en environnement serverless
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const chromium = require('@sparticuz/chromium');
      return await chromium.executablePath();
    } catch {
      // Fallback local — nécessite chromium ou google-chrome installé
      const candidates = [
        process.env.CHROMIUM_PATH,
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ].filter(Boolean) as string[];

      const { existsSync } = require('fs');
      const found = candidates.find(p => existsSync(p));
      if (!found) throw new Error('Chromium introuvable. Définissez CHROMIUM_PATH ou installez @sparticuz/chromium.');
      return found;
    }
  }

  /**
   * Convertit un document HTML en buffer PDF.
   *
   * @param html    HTML complet (doit inclure <!DOCTYPE html> + styles inline)
   * @param format  Format papier (défaut A4)
   * @param landscape Orientation paysage (défaut portrait)
   */
  async htmlToPdf(
    html:      string,
    format:    PrintFormat = 'A4',
    landscape  = false,
  ): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page    = await browser.newPage();

    try {
      await page.setContent(html, { waitUntil: 'networkidle0' });

      // Attendre les images data-URL (QR codes, barcodes)
      await page.evaluate(() =>
        Promise.all(
          Array.from(document.images)
            .filter(img => !img.complete)
            .map(img => new Promise(resolve => { img.onload = img.onerror = resolve; })),
        ),
      );

      const pdfOptions: PDFOptions = {
        ...FORMAT_OPTIONS[format],
        landscape,
        printBackground: true,
        displayHeaderFooter: false,
      };

      const pdfBuffer = await page.pdf(pdfOptions);
      this.logger.debug(`PDF généré format=${format} taille=${pdfBuffer.length}B`);
      return Buffer.from(pdfBuffer);
    } finally {
      await page.close();
    }
  }

  async onModuleDestroy() {
    if (this.browser) {
      await this.browser.close();
      this.logger.log('Chromium browser closed');
    }
  }
}
