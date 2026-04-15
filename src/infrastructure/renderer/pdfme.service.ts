/**
 * PdfmeService — Moteur de rendu publipostage via @pdfme/generator
 *
 * Principe :
 *   1. Le tenant édite visuellement son template via le Designer @pdfme/ui (frontend)
 *   2. Le JSON résultant (Template) est stocké dans DocumentTemplate.schemaJson
 *   3. À l'impression, ce service injecte les valeurs réelles dans les placeholders
 *      et produit un Buffer PDF directement (pas de Chromium nécessaire)
 *
 * Format template pdfme :
 *   {
 *     basePdf: { width: 210, height: 297, padding: [10,10,10,10] },
 *     schemas: [
 *       [
 *         { name: 'tenantName', type: 'text', position: {x:14, y:12}, width: 80, height: 10,
 *           content: '{{tenantName}}', fontSize: 14, fontColor: '#1a3a5c' },
 *         { name: 'qrCode', type: 'qrcode', position: {x:160, y:8}, width: 30, height: 30,
 *           content: '{{qrCodeValue}}' },
 *       ]
 *     ]
 *   }
 *
 * Variables standard disponibles :
 *   Tenant   : tenantName, tenantAddress, tenantPhone, tenantNif, tenantRccm, tenantLogo
 *   Ticket   : ticketRef, passengerName, passengerPhone, seatNumber, tripDate,
 *              origin, destination, routeName, busPlate, price, currency
 *   Invoice  : invoiceNumber, invoiceDate, totalHt, tva, totalTtc, paymentMethod
 *   Parcel   : parcelRef, senderName, recipientName, weight, dimensions, trackingCode
 *   Generic  : generatedAt, pageNumber
 */
import { Injectable, Logger }  from '@nestjs/common';
import { generate }             from '@pdfme/generator';
import type { Template } from '@pdfme/common';
import { text, image, barcodes, rectangle, line, ellipse, table } from '@pdfme/schemas';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PdfmeInputRecord = Record<string, string>;

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class PdfmeService {
  private readonly logger = new Logger(PdfmeService.name);

  /**
   * Génère un PDF à partir d'un template pdfme JSON + un ensemble de variables.
   *
   * @param schemaJson  Le Template stocké dans DocumentTemplate.schemaJson
   * @param inputs      Tableau de records (une page par record)
   * @returns           Buffer PDF
   */
  async render(
    schemaJson: Record<string, unknown>,
    inputs: PdfmeInputRecord[],
  ): Promise<Buffer> {
    const template = schemaJson as unknown as Template;

    // Résoudre les placeholders {{variable}} → valeurs réelles dans chaque schema
    const resolvedTemplate = this.resolvePlaceholders(template, inputs[0] ?? {});

    this.logger.debug(
      `pdfme render: ${resolvedTemplate.schemas?.[0]?.length ?? 0} champs, ${inputs.length} page(s)`,
    );

    const pdfBuffer = await generate({
      template: resolvedTemplate,
      inputs,
      plugins: {
        text,
        image,
        qrcode: barcodes.qrcode,
        rectangle,
        line,
        ellipse,
        table,
      },
    });

    return Buffer.from(pdfBuffer);
  }

  /**
   * Remplace les valeurs `content` des schemas qui sont des placeholders statiques
   * par leur valeur réelle. Utilisé pour pré-remplir les defaults dans le template.
   *
   * Note : pdfme génère à partir du tableau `inputs` — les valeurs du template
   * sont utilisées comme fallback si la clé n'existe pas dans `inputs`.
   */
  private resolvePlaceholders(
    template: Template,
    defaults: PdfmeInputRecord,
  ): Template {
    if (!template.schemas) return template;

    const schemas = template.schemas.map(page =>
      page.map(field => {
        const content = (field as any).content;
        if (typeof content !== 'string') return field;
        // Les champs de type table contiennent du JSON — ne pas toucher
        if ((field as any).type === 'table') return field;
        // Substitution globale : remplace chaque {{var}} par defaults[var] si défini
        const resolved = content.replace(/\{\{(\w+)\}\}/g, (match, key) =>
          defaults[key] !== undefined ? defaults[key] : match,
        );
        return resolved === content ? field : { ...field, content: resolved };
      }),
    );

    return { ...template, schemas };
  }

  /**
   * Construit le record d'inputs pour pdfme depuis les données métier.
   * Seules les clés présentes dans les schemas du template sont conservées.
   *
   * @param template  Template pdfme
   * @param data      Toutes les variables disponibles (tenant + document)
   */
  buildInputs(
    template: Record<string, unknown>,
    data: PdfmeInputRecord,
  ): PdfmeInputRecord[] {
    const t = template as unknown as Template;
    if (!t.schemas) return [data];

    // Extraire les noms des champs du premier schéma (= page 1)
    const fields = new Set<string>(
      (t.schemas[0] ?? []).map((f: any) => f.name as string),
    );

    // Filtrer les données pour ne garder que les champs du template
    const filtered: PdfmeInputRecord = {};
    for (const [k, v] of Object.entries(data)) {
      if (fields.has(k)) filtered[k] = v;
    }

    return [filtered];
  }
}
