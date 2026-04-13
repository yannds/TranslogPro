/**
 * BarcodeService — Génération de codes-barres SVG/PNG côté serveur
 *
 * Backend bwip-js (v4+) — rendu sans Canvas ni browser.
 * Retourne une data-URL PNG directement insérable dans <img src="...">.
 *
 * Symbologies supportées :
 *   - QR (qrcode)          — tracking public, liens URL
 *   - Code128 (code128)    — codes internes (trackingCode, RFID)
 *   - EAN13 (ean13)        — codes produits standards
 *   - DataMatrix (datamatrix) — haute densité, petite surface
 *   - PDF417 (pdf417)      — passeports, cartes d'identité
 *   - Aztec (azteccode)    — variante QR haute tolérance
 */
import { Injectable, Logger } from '@nestjs/common';
import bwipjs from 'bwip-js';

export type BarcodeSymbology =
  | 'qrcode'
  | 'code128'
  | 'ean13'
  | 'datamatrix'
  | 'pdf417'
  | 'azteccode';

export interface BarcodeOptions {
  symbology: BarcodeSymbology;
  value:     string;
  scale?:    number;   // Facteur d'échelle (défaut 3)
  height?:   number;   // Hauteur en mm (défaut 10 — ignoré pour QR)
  color?:    string;   // Couleur encre hex sans # (défaut '000000')
  bgColor?:  string;   // Couleur fond hex sans # (défaut 'ffffff')
}

@Injectable()
export class BarcodeService {
  private readonly logger = new Logger(BarcodeService.name);

  /**
   * Génère un code-barres et retourne un Buffer PNG.
   */
  async toPngBuffer(options: BarcodeOptions): Promise<Buffer> {
    const { symbology, value, scale = 3, height = 10, color = '000000', bgColor = 'ffffff' } = options;

    try {
      const png = await bwipjs.toBuffer({
        bcid:        symbology,
        text:        value,
        scale,
        height,
        includetext: false,
        barcolor:    color,
        backgroundcolor: bgColor,
      });
      return png;
    } catch (err) {
      this.logger.warn(`bwip-js erreur symbology=${symbology} value="${value}": ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Génère un code-barres et retourne une data-URL PNG (pour HTML inline).
   */
  async toDataUrl(options: BarcodeOptions): Promise<string> {
    const buf = await this.toPngBuffer(options);
    return `data:image/png;base64,${buf.toString('base64')}`;
  }
}
