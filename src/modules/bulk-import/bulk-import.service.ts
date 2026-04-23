import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../infrastructure/database/prisma.service';

// ── Types ────────────────────────────────────────────────────────────────────

export type BulkEntity = 'stations' | 'vehicles' | 'staff' | 'drivers';

interface ColDef {
  key:      string;
  label:    string;
  required: boolean;
  hint:     string;
  width:    number;
  /** Si true, en-tête colorée différemment — section profil de coûts */
  costProfile?: boolean;
}

export interface BulkImportResult {
  total:   number;
  created: number;
  updated: number;
  skipped: number;
  errors:  Array<{ row: number; field?: string; message: string }>;
}

// ── Définitions de colonnes par entité ──────────────────────────────────────

const COLS: Record<BulkEntity, ColDef[]> = {
  stations: [
    { key: 'nom',       label: 'Nom de la gare *',  required: true,  hint: 'ex. Gare routière de Poto-Poto', width: 32 },
    { key: 'ville',     label: 'Ville *',            required: true,  hint: 'ex. Brazzaville',               width: 20 },
    { key: 'type',      label: 'Type *',             required: true,  hint: 'PRINCIPALE ou RELAIS',          width: 14 },
    { key: 'latitude',  label: 'Latitude *',         required: true,  hint: 'ex. -4.2634',                   width: 14 },
    { key: 'longitude', label: 'Longitude *',        required: true,  hint: 'ex. 15.2429',                   width: 14 },
  ],
  vehicles: [
    // ── Identité véhicule ──────────────────────────────────────────────────
    { key: 'immatriculation', label: 'Immatriculation *',           required: true,  hint: 'ex. AB-1234-CD',                   width: 18 },
    { key: 'modele',          label: 'Modèle *',                     required: true,  hint: 'ex. Toyota Coaster',               width: 22 },
    { key: 'type',            label: 'Type (opt.)',                  required: false, hint: 'STANDARD, CONFORT, VIP ou MINIBUS', width: 16 },
    { key: 'capacite',        label: 'Capacité passagers *',        required: true,  hint: 'ex. 30',                           width: 16 },
    { key: 'bagages_kg',      label: 'Bagages kg *',                 required: true,  hint: 'ex. 500',                          width: 13 },
    { key: 'bagages_m3',      label: 'Bagages m³ *',                 required: true,  hint: 'ex. 3.5',                          width: 13 },
    { key: 'annee',           label: 'Année (opt.)',                 required: false, hint: 'ex. 2021',                         width: 10 },
    { key: 'vin',             label: 'VIN / N° châssis (opt.)',     required: false, hint: 'ex. VF1BBA00012345678',             width: 22 },
    { key: 'date_immat',      label: 'Date 1ère immat. (opt.)',     required: false, hint: 'JJ/MM/AAAA',                        width: 20 },
    { key: 'date_achat',      label: 'Date acquisition (opt.)',     required: false, hint: 'JJ/MM/AAAA',                        width: 20 },
    { key: 'prix_achat',      label: 'Prix acquisition XOF (opt.)', required: false, hint: 'ex. 25000000',                     width: 22 },
    { key: 'carburant',       label: 'Carburant (opt.)',            required: false, hint: 'DIESEL, PETROL, HYBRID, ELECTRIC',  width: 18 },
    { key: 'conso_l100km',    label: 'Conso. L/100km (opt.)',       required: false, hint: 'ex. 18.5',                         width: 18 },
    { key: 'agence',          label: 'Nom agence (opt.)',           required: false, hint: 'ex. Agence Brazzaville',            width: 22 },
    // ── Profil de coûts (auto-seedé depuis les champs ci-dessus) ──────────
    { key: 'prix_carburant',     label: 'Prix carburant XOF/L *¹',       required: false, hint: 'ex. 750 — obligatoire si profil',   width: 26, costProfile: true },
    { key: 'salaire_chauffeur',  label: 'Salaire chauffeur/mois XOF *¹', required: false, hint: 'ex. 250000',                        width: 28, costProfile: true },
    { key: 'assurance_annuelle', label: 'Assurance annuelle XOF *¹',     required: false, hint: 'ex. 500000',                        width: 24, costProfile: true },
    { key: 'frais_agence_mois',  label: 'Frais fixes agence/mois XOF *¹',required: false, hint: 'ex. 50000',                         width: 26, costProfile: true },
    { key: 'maintenance_km',     label: 'Maintenance XOF/km (opt.)',      required: false, hint: 'ex. 0.05 — défaut 0.05',            width: 24, costProfile: true },
    { key: 'trajets_mois',       label: 'Trajets moyens/mois (opt.)',     required: false, hint: 'ex. 30 — défaut 30',               width: 24, costProfile: true },
  ],
  staff: [
    { key: 'nom',          label: 'Nom complet *',              required: true,  hint: 'ex. Jean-Pierre Ngoma',       width: 26 },
    { key: 'email',        label: 'Email *',                    required: true,  hint: 'ex. jean.ngoma@example.com',  width: 30 },
    { key: 'mot_de_passe', label: 'Mot de passe temporaire *', required: true,  hint: 'ex. Azerty123! — ignoré si compte existant', width: 28 },
    { key: 'role',         label: 'Slug rôle (opt.)',           required: false, hint: 'ex. AGENT_VENTE — vide = aucun rôle',        width: 22 },
    { key: 'agence',       label: 'Nom agence (opt.)',          required: false, hint: 'ex. Agence Pointe-Noire',     width: 24 },
    { key: 'date_embauche',label: 'Date embauche (opt.)',       required: false, hint: 'JJ/MM/AAAA — ex. 01/03/2024',width: 20 },
  ],
  drivers: [
    { key: 'nom',              label: 'Nom complet *',              required: true,  hint: 'ex. Michel Moukouri',             width: 26 },
    { key: 'email',            label: 'Email *',                    required: true,  hint: 'ex. michel.moukouri@example.com', width: 30 },
    { key: 'mot_de_passe',     label: 'Mot de passe temporaire *', required: true,  hint: 'ex. Azerty123! — ignoré si compte existant', width: 28 },
    { key: 'agence',           label: 'Nom agence (opt.)',          required: false, hint: 'ex. Agence Nord',                 width: 22 },
    { key: 'date_embauche',    label: 'Date embauche (opt.)',       required: false, hint: 'JJ/MM/AAAA — ex. 01/03/2024',    width: 20 },
    { key: 'permis_numero',    label: 'N° permis *',                required: true,  hint: 'ex. CG-2023-001234',              width: 18 },
    { key: 'permis_categorie', label: 'Catégorie permis *',         required: true,  hint: 'B, D ou EC',                      width: 16 },
    { key: 'permis_emission',  label: 'Date émission *',            required: true,  hint: 'JJ/MM/AAAA — ex. 15/06/2018',    width: 18 },
    { key: 'permis_expiration',label: 'Date expiration *',          required: true,  hint: 'JJ/MM/AAAA — ex. 14/06/2028',    width: 18 },
    { key: 'permis_pays',      label: 'Pays émetteur (opt.)',       required: false, hint: 'ex. Congo',                       width: 16 },
  ],
};

const ENTITY_LABELS: Record<BulkEntity, string> = {
  stations: 'Gares',
  vehicles: 'Véhicules',
  staff:    'Personnel',
  drivers:  'Chauffeurs',
};

// Couleurs en-têtes Excel
const COLOR_MAIN         = 'FF0F766E'; // teal-700 — colonnes principales
const COLOR_COST_PROFILE = 'FF1E40AF'; // blue-800 — section profil de coûts
const COLOR_FONT         = 'FFFFFFFF';

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class BulkImportService {
  private readonly log = new Logger(BulkImportService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Template generation ───────────────────────────────────────────────────

  async generateTemplate(entity: BulkEntity, tenantId?: string): Promise<Buffer> {
    const cols = COLS[entity];
    const wb   = new ExcelJS.Workbook();
    const ws   = wb.addWorksheet(ENTITY_LABELS[entity]);

    ws.columns = cols.map(c => ({ key: c.key, width: c.width }));

    // Ligne 1 — en-têtes (deux couleurs selon section)
    const headerRow = ws.addRow(cols.map(c => c.label));
    headerRow.height = 22;
    headerRow.eachCell((cell, colIdx) => {
      const isCost = cols[colIdx - 1]?.costProfile;
      cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: isCost ? COLOR_COST_PROFILE : COLOR_MAIN } };
      cell.font   = { bold: true, color: { argb: COLOR_FONT }, size: 11 };
      cell.border = { bottom: { style: 'thin', color: { argb: isCost ? 'FF3B82F6' : 'FF0D9488' } } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
    });

    // Ligne 2 — indications de format
    const hintRow = ws.addRow(cols.map(c => c.hint));
    hintRow.height = 18;
    hintRow.eachCell(cell => {
      cell.font      = { italic: true, color: { argb: 'FF94A3B8' }, size: 10 };
      cell.alignment = { vertical: 'middle' };
    });

    // ── Validations Excel ────────────────────────────────────────────────────

    if (entity === 'stations') {
      const typeCol = cols.findIndex(c => c.key === 'type') + 1;
      for (let r = 3; r <= 502; r++) {
        ws.getCell(r, typeCol).dataValidation = {
          type: 'list', allowBlank: false,
          formulae: ['"PRINCIPALE,RELAIS"'],
          showErrorMessage: true, errorTitle: 'Valeur invalide',
          error: 'Choisissez PRINCIPALE ou RELAIS',
        };
      }
    }

    if (entity === 'vehicles') {
      const vTypeCol    = cols.findIndex(c => c.key === 'type') + 1;
      const fuelTypeCol = cols.findIndex(c => c.key === 'carburant') + 1;

      for (let r = 3; r <= 502; r++) {
        if (vTypeCol > 0) {
          ws.getCell(r, vTypeCol).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: ['"STANDARD,CONFORT,VIP,MINIBUS"'],
            showErrorMessage: true, errorTitle: 'Valeur invalide',
            error: 'STANDARD, CONFORT, VIP ou MINIBUS',
          };
        }
        if (fuelTypeCol > 0) {
          ws.getCell(r, fuelTypeCol).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: ['"DIESEL,PETROL,BIO_DIESEL,HYBRID,ELECTRIC"'],
            showErrorMessage: true, errorTitle: 'Valeur invalide',
            error: 'DIESEL, PETROL, BIO_DIESEL, HYBRID ou ELECTRIC',
          };
        }
      }
    }

    // Dropdown agences dynamique depuis la DB du tenant
    const agenceColIdx = cols.findIndex(c => c.key === 'agence');
    if (agenceColIdx >= 0 && tenantId) {
      const agencies = await this.prisma.agency.findMany({
        where: { tenantId },
        select: { name: true },
        orderBy: { name: 'asc' },
      });
      if (agencies.length > 0) {
        const agenceCol = agenceColIdx + 1;
        const list = agencies.map(a => a.name).join(',');
        for (let r = 3; r <= 502; r++) {
          ws.getCell(r, agenceCol).dataValidation = {
            type: 'list', allowBlank: true,
            formulae: [`"${list}"`],
            showErrorMessage: false,
          };
        }
      }
    }

    ws.views = [{ state: 'frozen', ySplit: 2 }];
    for (let i = 0; i < 10; i++) ws.addRow([]);

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  // ── Import ────────────────────────────────────────────────────────────────

  async importFile(
    tenantId: string,
    entity: BulkEntity,
    buffer: Buffer,
    actorId: string,
  ): Promise<BulkImportResult> {
    const wb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('Fichier Excel vide ou invalide');

    const cols = COLS[entity];
    const rows = this.extractRows(ws, cols);

    if (rows.length === 0) {
      throw new BadRequestException('Aucune ligne de données trouvée dans le fichier');
    }

    const result: BulkImportResult = { total: rows.length, created: 0, updated: 0, skipped: 0, errors: [] };

    switch (entity) {
      case 'stations': await this.importStations(tenantId, rows, result); break;
      case 'vehicles': await this.importVehicles(tenantId, rows, result); break;
      case 'staff':    await this.importStaff(tenantId, rows, result, actorId); break;
      case 'drivers':  await this.importDrivers(tenantId, rows, result, actorId); break;
    }

    return result;
  }

  // ── Row extraction ────────────────────────────────────────────────────────

  private extractRows(ws: ExcelJS.Worksheet, cols: ColDef[]): Array<{ rowNum: number; data: Record<string, string> }> {
    const out: Array<{ rowNum: number; data: Record<string, string> }> = [];
    ws.eachRow((row, rowNum) => {
      if (rowNum <= 2) return;
      const values = row.values as (string | number | null | undefined | ExcelJS.CellValue)[];
      const hasData = values.slice(1).some(v => v !== null && v !== undefined && String(v).trim() !== '');
      if (!hasData) return;
      const data: Record<string, string> = {};
      cols.forEach((col, idx) => { data[col.key] = this.cellToString(values[idx + 1]); });
      out.push({ rowNum, data });
    });
    return out;
  }

  private cellToString(v: ExcelJS.CellValue | undefined): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v.normalize('NFC').trim();
    if (typeof v === 'number') return String(v);
    if (v instanceof Date) {
      const d = v.getDate().toString().padStart(2, '0');
      const m = (v.getMonth() + 1).toString().padStart(2, '0');
      return `${d}/${m}/${v.getFullYear()}`;
    }
    if (typeof v === 'object' && 'text' in v) return String((v as { text: string }).text).normalize('NFC').trim();
    return String(v).normalize('NFC').trim();
  }

  // ── Validation helpers ────────────────────────────────────────────────────

  private parseDate(raw: string, rowNum: number, field: string, errors: BulkImportResult['errors']): Date | null {
    const parts = raw.includes('/') ? raw.split('/') : raw.split('-');
    if (raw.includes('/') && parts.length === 3) {
      const [d, m, y] = parts.map(Number);
      const dt = new Date(y, m - 1, d);
      if (!isNaN(dt.getTime())) return dt;
    }
    if (raw.includes('-') && parts.length === 3) {
      const dt = new Date(raw);
      if (!isNaN(dt.getTime())) return dt;
    }
    errors.push({ row: rowNum, field, message: `Date invalide "${raw}" (attendu JJ/MM/AAAA)` });
    return null;
  }

  private normalizeEnum(v: string, allowed: string[]): string {
    const up = v.toUpperCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_');
    return allowed.includes(up) ? up : v.toUpperCase().trim();
  }

  // ── Entity importers ──────────────────────────────────────────────────────

  private async importStations(
    tenantId: string,
    rows: Array<{ rowNum: number; data: Record<string, string> }>,
    result: BulkImportResult,
  ) {
    for (const { rowNum, data } of rows) {
      const errors: BulkImportResult['errors'] = [];
      const nom   = data['nom']?.trim().normalize('NFC');
      const ville = data['ville']?.trim().normalize('NFC');
      const type  = this.normalizeEnum(data['type'] ?? '', ['PRINCIPALE', 'RELAIS']);
      const lat   = parseFloat(data['latitude'] ?? '');
      const lng   = parseFloat(data['longitude'] ?? '');

      if (!nom)   errors.push({ row: rowNum, field: 'nom',       message: 'Nom obligatoire' });
      if (!ville) errors.push({ row: rowNum, field: 'ville',     message: 'Ville obligatoire' });
      if (!['PRINCIPALE', 'RELAIS'].includes(type))
        errors.push({ row: rowNum, field: 'type',      message: `Type invalide "${data['type']}" — attendu PRINCIPALE ou RELAIS` });
      if (isNaN(lat) || lat < -90  || lat > 90)
        errors.push({ row: rowNum, field: 'latitude',  message: `Latitude invalide "${data['latitude']}"` });
      if (isNaN(lng) || lng < -180 || lng > 180)
        errors.push({ row: rowNum, field: 'longitude', message: `Longitude invalide "${data['longitude']}"` });

      if (errors.length) { result.errors.push(...errors); result.skipped++; continue; }

      try {
        const existing = await this.prisma.station.findFirst({
          where: { tenantId, name: nom!, city: ville! },
          select: { id: true },
        });
        if (existing) {
          await this.prisma.station.update({
            where: { id: existing.id },
            data: { type, coordinates: { lat, lng } },
          });
          result.updated++;
        } else {
          await this.prisma.station.create({
            data: { tenantId, name: nom!, city: ville!, type, coordinates: { lat, lng } },
          });
          result.created++;
        }
      } catch (e: unknown) {
        result.errors.push({ row: rowNum, message: `Erreur gare : ${e instanceof Error ? e.message : String(e)}` });
        result.skipped++;
      }
    }
  }

  private async importVehicles(
    tenantId: string,
    rows: Array<{ rowNum: number; data: Record<string, string> }>,
    result: BulkImportResult,
  ) {
    const agencies = await this.prisma.agency.findMany({ where: { tenantId }, select: { id: true, name: true } });
    const agencyByName = new Map(agencies.map(a => [a.name.toLowerCase().normalize('NFC'), a.id]));

    for (const { rowNum, data } of rows) {
      const errors: BulkImportResult['errors'] = [];

      // ── Champs Bus ──────────────────────────────────────────────────────
      const plate    = data['immatriculation']?.trim().toUpperCase();
      const model    = data['modele']?.trim().normalize('NFC');
      const type     = data['type']?.trim().toUpperCase() || undefined;
      const capacity = parseInt(data['capacite'] ?? '', 10);
      const bagsKg   = parseFloat(data['bagages_kg'] ?? '');
      const bagsM3   = parseFloat(data['bagages_m3'] ?? '');
      const year     = data['annee']   ? parseInt(data['annee'], 10) : undefined;
      const vin      = data['vin']?.trim() || undefined;
      const fuelType = data['carburant']?.trim().toUpperCase() || undefined;
      const consoRaw = data['conso_l100km']?.trim();
      const conso    = consoRaw ? parseFloat(consoRaw) : undefined;
      const prixAchatRaw = data['prix_achat']?.trim();
      const prixAchat    = prixAchatRaw ? parseFloat(prixAchatRaw) : undefined;
      const agName   = data['agence']?.trim().normalize('NFC');

      const dateImmatRaw = data['date_immat']?.trim();
      const dateAchatRaw = data['date_achat']?.trim();

      if (!plate)  errors.push({ row: rowNum, field: 'immatriculation', message: 'Immatriculation obligatoire' });
      if (!model)  errors.push({ row: rowNum, field: 'modele',           message: 'Modèle obligatoire' });
      if (isNaN(capacity) || capacity < 1)
        errors.push({ row: rowNum, field: 'capacite',   message: `Capacité invalide "${data['capacite']}"` });
      if (isNaN(bagsKg) || bagsKg < 0)
        errors.push({ row: rowNum, field: 'bagages_kg', message: `Bagages kg invalide "${data['bagages_kg']}"` });
      if (isNaN(bagsM3) || bagsM3 < 0)
        errors.push({ row: rowNum, field: 'bagages_m3', message: `Bagages m³ invalide "${data['bagages_m3']}"` });
      if (type && !['STANDARD','CONFORT','VIP','MINIBUS'].includes(type))
        errors.push({ row: rowNum, field: 'type',       message: `Type véhicule invalide "${type}"` });
      if (fuelType && !['DIESEL','PETROL','BIO_DIESEL','HYBRID','ELECTRIC'].includes(fuelType))
        errors.push({ row: rowNum, field: 'carburant',  message: `Carburant invalide "${fuelType}"` });

      let agencyId: string | undefined;
      if (agName) {
        agencyId = agencyByName.get(agName.toLowerCase());
        if (!agencyId) errors.push({ row: rowNum, field: 'agence', message: `Agence introuvable : "${agName}"` });
      }

      let registrationDate: Date | undefined;
      let purchaseDate:     Date | undefined;
      if (dateImmatRaw) { const d = this.parseDate(dateImmatRaw, rowNum, 'date_immat', errors); if (d) registrationDate = d; }
      if (dateAchatRaw) { const d = this.parseDate(dateAchatRaw, rowNum, 'date_achat', errors); if (d) purchaseDate = d; }

      // ── Champs profil de coûts (optionnels) ─────────────────────────────
      const prixCarburantRaw    = data['prix_carburant']?.trim();
      const salaireRaw          = data['salaire_chauffeur']?.trim();
      const assuranceRaw        = data['assurance_annuelle']?.trim();
      const fraisAgenceRaw      = data['frais_agence_mois']?.trim();
      const maintenanceKmRaw    = data['maintenance_km']?.trim();
      const trajetsMoisRaw      = data['trajets_mois']?.trim();

      const hasCostProfile = prixCarburantRaw && salaireRaw && assuranceRaw && fraisAgenceRaw;
      const prixCarburant  = prixCarburantRaw ? parseFloat(prixCarburantRaw) : undefined;
      const salaire        = salaireRaw       ? parseFloat(salaireRaw)       : undefined;
      const assurance      = assuranceRaw     ? parseFloat(assuranceRaw)     : undefined;
      const fraisAgence    = fraisAgenceRaw   ? parseFloat(fraisAgenceRaw)   : undefined;
      const maintenanceKm  = maintenanceKmRaw ? parseFloat(maintenanceKmRaw) : undefined;
      const trajetsMois    = trajetsMoisRaw   ? parseInt(trajetsMoisRaw, 10) : undefined;

      if (hasCostProfile) {
        if (!prixCarburant || prixCarburant <= 0)
          errors.push({ row: rowNum, field: 'prix_carburant', message: `Prix carburant invalide "${prixCarburantRaw}"` });
        if (!salaire || salaire < 0)
          errors.push({ row: rowNum, field: 'salaire_chauffeur', message: `Salaire invalide "${salaireRaw}"` });
        if (!assurance || assurance < 0)
          errors.push({ row: rowNum, field: 'assurance_annuelle', message: `Assurance invalide "${assuranceRaw}"` });
        if (!fraisAgence || fraisAgence < 0)
          errors.push({ row: rowNum, field: 'frais_agence_mois', message: `Frais agence invalide "${fraisAgenceRaw}"` });
      }

      if (errors.length) { result.errors.push(...errors); result.skipped++; continue; }

      const busData = {
        tenantId,
        plateNumber:       plate!,
        model:             model!,
        type:              type ?? null,
        capacity,
        luggageCapacityKg: bagsKg,
        luggageCapacityM3: bagsM3,
        year:              year ?? null,
        vin:               vin ?? null,
        fuelType:          fuelType ?? null,
        fuelConsumptionPer100Km: (!conso || isNaN(conso)) ? null : conso,
        registrationDate:  registrationDate ?? null,
        purchaseDate:      purchaseDate ?? null,
        purchasePrice:     (!prixAchat || isNaN(prixAchat)) ? null : prixAchat,
        agencyId:          agencyId ?? null,
      };

      try {
        const existing = await this.prisma.bus.findUnique({
          where: { plateNumber: plate! },
          select: { id: true, tenantId: true },
        });

        // Cross-tenant guard
        if (existing && existing.tenantId !== tenantId) {
          errors.push({ row: rowNum, field: 'immatriculation', message: `Immatriculation "${plate}" appartient à un autre tenant` });
          result.errors.push(...errors); result.skipped++; continue;
        }

        let busId: string;

        if (existing) {
          // Mise à jour — on n'écrase pas les champs null si non fournis
          const updateData: Record<string, unknown> = {
            model: busData.model,
            capacity: busData.capacity,
            luggageCapacityKg: busData.luggageCapacityKg,
            luggageCapacityM3: busData.luggageCapacityM3,
          };
          if (busData.type              !== null) updateData['type']              = busData.type;
          if (busData.year              !== null) updateData['year']              = busData.year;
          if (busData.vin               !== null) updateData['vin']               = busData.vin;
          if (busData.fuelType          !== null) updateData['fuelType']          = busData.fuelType;
          if (busData.fuelConsumptionPer100Km !== null) updateData['fuelConsumptionPer100Km'] = busData.fuelConsumptionPer100Km;
          if (busData.registrationDate  !== null) updateData['registrationDate']  = busData.registrationDate;
          if (busData.purchaseDate      !== null) updateData['purchaseDate']      = busData.purchaseDate;
          if (busData.purchasePrice     !== null) updateData['purchasePrice']     = busData.purchasePrice;
          if (busData.agencyId          !== null) updateData['agencyId']          = busData.agencyId;

          await this.prisma.bus.update({ where: { id: existing.id }, data: updateData });
          busId = existing.id;
          result.updated++;
        } else {
          const created = await this.prisma.bus.create({ data: busData });
          busId = created.id;
          result.created++;
        }

        // Profil de coûts — upsert si les 4 champs obligatoires sont fournis
        // conso et prix_achat sont copiés depuis Bus sans ressaisie
        if (hasCostProfile && prixCarburant && salaire && assurance && fraisAgence) {
          const costData = {
            tenantId,
            busId,
            fuelConsumptionPer100Km: conso && !isNaN(conso) ? conso : 0,
            fuelPricePerLiter:        prixCarburant,
            driverMonthlySalary:      salaire,
            annualInsuranceCost:      assurance,
            monthlyAgencyFees:        fraisAgence,
            purchasePrice:            prixAchat && !isNaN(prixAchat) ? prixAchat : 0,
            ...(maintenanceKm !== undefined && !isNaN(maintenanceKm) ? { maintenanceCostPerKm: maintenanceKm } : {}),
            ...(trajetsMois   !== undefined && !isNaN(trajetsMois)   ? { avgTripsPerMonth:     trajetsMois   } : {}),
          };
          await this.prisma.busCostProfile.upsert({
            where:  { busId },
            update: costData,
            create: costData,
          });
        }
      } catch (e: unknown) {
        result.errors.push({ row: rowNum, message: `Erreur véhicule : ${e instanceof Error ? e.message : String(e)}` });
        result.skipped++;
        // annule le created/updated déjà incrémenté si l'erreur vient après
        if (result.created > 0) result.created--;
        else if (result.updated > 0) result.updated--;
      }
    }
  }

  private async importStaff(
    tenantId: string,
    rows: Array<{ rowNum: number; data: Record<string, string> }>,
    result: BulkImportResult,
    _actorId: string,
  ) {
    const agencies   = await this.prisma.agency.findMany({ where: { tenantId }, select: { id: true, name: true } });
    const agencyByName = new Map(agencies.map(a => [a.name.toLowerCase().normalize('NFC'), a.id]));
    const roles      = await this.prisma.role.findMany({ where: { tenantId }, select: { id: true, name: true } });
    const roleByName   = new Map(roles.map(r => [r.name.toLowerCase().normalize('NFC'), r.id]));

    for (const { rowNum, data } of rows) {
      const errors: BulkImportResult['errors'] = [];
      const nom      = data['nom']?.trim().normalize('NFC');
      const email    = data['email']?.trim().toLowerCase();
      const password = data['mot_de_passe']?.trim();
      const roleName = data['role']?.trim().normalize('NFC');
      const agName   = data['agence']?.trim().normalize('NFC');
      const hireDateRaw = data['date_embauche']?.trim();

      if (!nom)   errors.push({ row: rowNum, field: 'nom',   message: 'Nom obligatoire' });
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        errors.push({ row: rowNum, field: 'email', message: `Email invalide "${data['email']}"` });

      let roleId:   string | undefined;
      let agencyId: string | undefined;
      if (roleName) {
        roleId = roleByName.get(roleName.toLowerCase());
        if (!roleId) errors.push({ row: rowNum, field: 'role', message: `Rôle introuvable : "${roleName}"` });
      }
      if (agName) {
        agencyId = agencyByName.get(agName.toLowerCase());
        if (!agencyId) errors.push({ row: rowNum, field: 'agence', message: `Agence introuvable : "${agName}"` });
      }
      let hireDate: Date | undefined;
      if (hireDateRaw) {
        const parsed = this.parseDate(hireDateRaw, rowNum, 'date_embauche', errors);
        if (parsed) hireDate = parsed;
      }

      if (errors.length) { result.errors.push(...errors); result.skipped++; continue; }

      try {
        const existingUser = await this.prisma.user.findFirst({
          where: { tenantId, email: email! },
          include: { staffProfile: { select: { id: true } } },
        });

        if (existingUser) {
          // Mise à jour partielle — le mot de passe n'est jamais réécrasé
          await this.prisma.$transaction(async tx => {
            await tx.user.update({
              where: { id: existingUser.id },
              data: {
                name:     nom!,
                agencyId: agencyId ?? existingUser.agencyId,
                roleId:   roleId   ?? existingUser.roleId,
              },
            });
            if (existingUser.staffProfile) {
              await tx.staff.update({
                where: { id: existingUser.staffProfile.id },
                data: {
                  agencyId: agencyId ?? null,
                  ...(hireDate ? { hireDate } : {}),
                },
              });
            }
          });
          result.updated++;
        } else {
          if (!password || password.length < 8) {
            result.errors.push({ row: rowNum, field: 'mot_de_passe', message: 'Mot de passe obligatoire à la création (min. 8 caractères)' });
            result.skipped++;
            continue;
          }
          const hash = await bcrypt.hash(password, 12);
          await this.prisma.$transaction(async tx => {
            const user = await tx.user.create({
              data: { tenantId, email: email!, name: nom!, userType: 'STAFF', roleId: roleId ?? null, agencyId: agencyId ?? null },
            });
            await tx.account.create({
              data: { tenantId, userId: user.id, providerId: 'credential', accountId: email!, password: hash },
            });
            await tx.staff.create({
              data: { tenantId, userId: user.id, agencyId: agencyId ?? null, hireDate: hireDate ?? new Date() },
            });
          });
          result.created++;
        }
      } catch (e: unknown) {
        result.errors.push({ row: rowNum, message: `Erreur personnel : ${e instanceof Error ? e.message : String(e)}` });
        result.skipped++;
      }
    }
  }

  private async importDrivers(
    tenantId: string,
    rows: Array<{ rowNum: number; data: Record<string, string> }>,
    result: BulkImportResult,
    _actorId: string,
  ) {
    const agencies = await this.prisma.agency.findMany({ where: { tenantId }, select: { id: true, name: true } });
    const agencyByName = new Map(agencies.map(a => [a.name.toLowerCase().normalize('NFC'), a.id]));

    for (const { rowNum, data } of rows) {
      const errors: BulkImportResult['errors'] = [];
      const nom          = data['nom']?.trim().normalize('NFC');
      const email        = data['email']?.trim().toLowerCase();
      const password     = data['mot_de_passe']?.trim();
      const agName       = data['agence']?.trim().normalize('NFC');
      const hireDateRaw  = data['date_embauche']?.trim();
      const permisNum    = data['permis_numero']?.trim().normalize('NFC');
      const permisCat    = data['permis_categorie']?.trim().toUpperCase();
      const permisEmRaw  = data['permis_emission']?.trim();
      const permisExpRaw = data['permis_expiration']?.trim();
      const permisPays   = data['permis_pays']?.trim().normalize('NFC') || undefined;

      if (!nom)      errors.push({ row: rowNum, field: 'nom',              message: 'Nom obligatoire' });
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        errors.push({ row: rowNum, field: 'email',           message: `Email invalide "${data['email']}"` });
      if (!permisNum)  errors.push({ row: rowNum, field: 'permis_numero',    message: 'N° permis obligatoire' });
      if (!permisCat)  errors.push({ row: rowNum, field: 'permis_categorie', message: 'Catégorie permis obligatoire' });
      if (!permisEmRaw)  errors.push({ row: rowNum, field: 'permis_emission',   message: 'Date émission permis obligatoire' });
      if (!permisExpRaw) errors.push({ row: rowNum, field: 'permis_expiration', message: 'Date expiration permis obligatoire' });

      let agencyId: string | undefined;
      if (agName) {
        agencyId = agencyByName.get(agName.toLowerCase());
        if (!agencyId) errors.push({ row: rowNum, field: 'agence', message: `Agence introuvable : "${agName}"` });
      }
      let hireDate: Date | undefined;
      if (hireDateRaw) {
        const parsed = this.parseDate(hireDateRaw, rowNum, 'date_embauche', errors);
        if (parsed) hireDate = parsed;
      }
      const permisEm  = permisEmRaw  ? this.parseDate(permisEmRaw,  rowNum, 'permis_emission',   errors) : null;
      const permisExp = permisExpRaw ? this.parseDate(permisExpRaw, rowNum, 'permis_expiration',  errors) : null;

      if (errors.length) { result.errors.push(...errors); result.skipped++; continue; }

      try {
        const existingUser = await this.prisma.user.findFirst({
          where: { tenantId, email: email! },
          include: { staffProfile: { select: { id: true } } },
        });

        if (existingUser) {
          // Mise à jour partielle — pas de réinitialisation du mot de passe
          await this.prisma.$transaction(async tx => {
            await tx.user.update({
              where: { id: existingUser.id },
              data: { name: nom!, agencyId: agencyId ?? existingUser.agencyId },
            });
            if (existingUser.staffProfile) {
              await tx.staff.update({
                where: { id: existingUser.staffProfile.id },
                data: { agencyId: agencyId ?? null, ...(hireDate ? { hireDate } : {}) },
              });
              // Mise à jour du permis si fourni
              if (permisNum && permisCat && permisEm && permisExp) {
                await tx.driverLicense.updateMany({
                  where: { staffId: existingUser.staffProfile.id },
                  data: {
                    licenseNo:    permisNum,
                    category:     permisCat,
                    issuedAt:     permisEm,
                    expiresAt:    permisExp,
                    issuingState: permisPays ?? null,
                    status:       permisExp > new Date() ? 'VALID' : 'EXPIRED',
                  },
                });
              }
            }
          });
          result.updated++;
        } else {
          if (!password || password.length < 8) {
            result.errors.push({ row: rowNum, field: 'mot_de_passe', message: 'Mot de passe obligatoire à la création (min. 8 caractères)' });
            result.skipped++;
            continue;
          }
          const hash = await bcrypt.hash(password, 12);
          await this.prisma.$transaction(async tx => {
            const user = await tx.user.create({
              data: { tenantId, email: email!, name: nom!, userType: 'STAFF', agencyId: agencyId ?? null },
            });
            await tx.account.create({
              data: { tenantId, userId: user.id, providerId: 'credential', accountId: email!, password: hash },
            });
            const staff = await tx.staff.create({
              data: { tenantId, userId: user.id, agencyId: agencyId ?? null, hireDate: hireDate ?? new Date() },
            });
            await tx.staffAssignment.create({
              data: { staffId: staff.id, role: 'DRIVER', agencyId: agencyId ?? null, status: 'ACTIVE', startDate: hireDate ?? new Date() },
            });
            if (permisNum && permisCat && permisEm && permisExp) {
              await tx.driverLicense.create({
                data: {
                  tenantId,
                  staffId:      staff.id,
                  licenseNo:    permisNum,
                  category:     permisCat,
                  issuedAt:     permisEm,
                  expiresAt:    permisExp,
                  issuingState: permisPays ?? null,
                  status:       permisExp > new Date() ? 'VALID' : 'EXPIRED',
                },
              });
            }
          });
          result.created++;
        }
      } catch (e: unknown) {
        result.errors.push({ row: rowNum, message: `Erreur chauffeur : ${e instanceof Error ? e.message : String(e)}` });
        result.skipped++;
      }
    }
  }
}
