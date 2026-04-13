/**
 * ExcelService — Export Excel via exceljs
 *
 * Génère des classeurs formatés prêts à télécharger.
 * Le buffer retourné est uploadé directement via IStorageService.putObject().
 *
 * Fonctionnalités :
 *   - En-têtes stylisés (fond sombre, texte blanc, gras)
 *   - Lignes alternées (zebraStripe)
 *   - Largeur de colonne auto-ajustée
 *   - Feuille de métadonnées (tenant, date, acteur)
 *   - Format XLSX (Open XML — compatible Excel, LibreOffice, Google Sheets)
 */
import { Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';

export interface ExcelColumn<T = Record<string, unknown>> {
  header: string;
  key:    keyof T & string;
  width?: number;
  // Formateur optionnel — appelé avec la valeur brute
  format?: (value: unknown) => string | number;
}

export interface ExcelExportOptions<T = Record<string, unknown>> {
  sheetName:  string;
  columns:    ExcelColumn<T>[];
  rows:       T[];
  title?:     string;
  metadata?:  Record<string, string>; // Affiché sur une feuille "Info"
}

@Injectable()
export class ExcelService {
  private readonly logger = new Logger(ExcelService.name);

  async toBuffer<T = Record<string, unknown>>(options: ExcelExportOptions<T>): Promise<Buffer> {
    const { sheetName, columns, rows, title, metadata } = options;

    const wb = new ExcelJS.Workbook();
    wb.creator  = 'TranslogPro';
    wb.created  = new Date();
    wb.modified = new Date();

    // ── Feuille principale ────────────────────────────────────────────────────
    const ws = wb.addWorksheet(sheetName, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    ws.columns = columns.map(c => ({
      header: c.header,
      key:    c.key,
      width:  c.width ?? Math.max(c.header.length + 4, 14),
    }));

    // Style en-tête
    const headerRow = ws.getRow(1);
    headerRow.eachCell(cell => {
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A1A' } };
      cell.font  = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FF444444' } },
      };
    });
    headerRow.height = 22;

    // Données
    rows.forEach((row, idx) => {
      const values: Record<string, unknown> = {};
      for (const col of columns) {
        const raw = (row as Record<string, unknown>)[col.key];
        values[col.key] = col.format ? col.format(raw) : raw;
      }
      const dataRow = ws.addRow(values);

      // Zèbre
      if (idx % 2 === 0) {
        dataRow.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } };
        });
      }
    });

    // ── Feuille Info (métadonnées) ────────────────────────────────────────────
    if (metadata || title) {
      const info = wb.addWorksheet('Info');
      info.getColumn(1).width = 24;
      info.getColumn(2).width = 40;
      if (title) {
        const titleRow = info.addRow([title]);
        titleRow.getCell(1).font = { bold: true, size: 13 };
        info.addRow([]);
      }
      if (metadata) {
        for (const [key, value] of Object.entries(metadata)) {
          info.addRow([key, value]);
        }
      }
    }

    const arrayBuffer = await wb.xlsx.writeBuffer();
    const buf = Buffer.from(arrayBuffer);
    this.logger.debug(`Excel généré sheet="${sheetName}" rows=${rows.length} size=${buf.length}B`);
    return buf;
  }
}
