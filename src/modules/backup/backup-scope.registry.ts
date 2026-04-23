/**
 * BackupScopeRegistry — définition des scopes de sauvegarde.
 *
 * Chaque scope déclare :
 *   - rootTables   : tables "racines" du domaine (celles qu'on choisit)
 *   - dependencies : graphe directed (table → tables dont elle dépend par FK)
 *                    utilisé pour résoudre l'ordre d'insertion à la restauration
 *
 * Le moteur résout transitivement toutes les dépendances et génère un
 * tri topologique pour garantir que les contraintes FK sont respectées
 * au moment du restore.
 *
 * Règle MinIO : chaque scope définit aussi minioEntityTypes — les types
 * d'entités dont les fichiers MinIO doivent être inclus dans l'archive.
 * Le BackupService recherche les object keys MinIO via StorageService
 * filtré par tenantId + entityType + entityId.
 */
import { Injectable } from '@nestjs/common';

export interface BackupScope {
  id:               string;
  label:            string;         // clé i18n : 'backup.scope.{id}.label'
  description:      string;         // clé i18n : 'backup.scope.{id}.desc'
  // Tables incluses directement (sans résolution FK — juste les racines déclarées)
  rootTables:       string[];
  // Graphe de dépendances FK : table → tables prérequises (doivent exister avant)
  // Structure : { tableA: ['tableB', 'tableC'] } signifie que tableA a des FK vers B et C
  dependencies:     Record<string, string[]>;
  // Types d'entités MinIO à inclure (filtrage par entityType dans StorageService)
  minioEntityTypes: string[];
  // Scopes inclus (un GROUP inclut ses sous-scopes)
  includes?:        string[];
}

@Injectable()
export class BackupScopeRegistry {
  private readonly scopes = new Map<string, BackupScope>([
    // ── MODULE : Billetterie ───────────────────────────────────────────────
    ['billetterie', {
      id:          'billetterie',
      label:       'backup.scope.billetterie.label',
      description: 'backup.scope.billetterie.desc',
      rootTables: [
        'trips', 'tickets', 'issued_tickets', 'customers',
        'routes', 'route_segments', 'stations',
        'tariffs', 'fare_classes', 'peak_periods', 'seasonal_aggregates',
        'payment_intents', 'payment_attempts', 'payment_events',
      ],
      dependencies: {
        trips:               ['routes', 'buses', 'agencies'],
        tickets:             ['trips', 'customers', 'tariffs'],
        issued_tickets:      ['tickets'],
        tariffs:             ['routes', 'fare_classes'],
        routes:              ['stations'],
        route_segments:      ['routes', 'stations'],
        payment_intents:     ['agencies'],
        payment_attempts:    ['payment_intents'],
        payment_events:      ['payment_intents'],
        seasonal_aggregates: ['routes'],
        peak_periods:        [],
        customers:           [],
        stations:            [],
        fare_classes:        [],
        buses:               [],
        agencies:            [],
      },
      minioEntityTypes: ['ticket', 'issued_ticket', 'customer_document'],
    }],

    // ── MODULE : Colis ─────────────────────────────────────────────────────
    ['colis', {
      id:          'colis',
      label:       'backup.scope.colis.label',
      description: 'backup.scope.colis.desc',
      rootTables: [
        'parcels', 'parcel_items', 'parcel_hub_events',
        'customers', 'stations', 'agencies',
        'payment_intents', 'payment_attempts', 'payment_events',
      ],
      dependencies: {
        parcels:          ['customers', 'stations', 'trips', 'agencies'],
        parcel_items:     ['parcels'],
        parcel_hub_events:['parcels', 'stations'],
        payment_intents:  ['agencies'],
        payment_attempts: ['payment_intents'],
        payment_events:   ['payment_intents'],
        customers:        [],
        stations:         [],
        trips:            [],
        agencies:         [],
      },
      minioEntityTypes: ['parcel', 'parcel_item_photo', 'customer_document'],
    }],

    // ── GROUPE : Opérations transport ──────────────────────────────────────
    // Inclut billetterie + colis + flotte + équipage + manifests + incidents
    ['operations', {
      id:          'operations',
      label:       'backup.scope.operations.label',
      description: 'backup.scope.operations.desc',
      rootTables: [
        // flotte
        'buses', 'vehicle_types', 'maintenance_reports', 'vehicle_documents',
        // équipage
        'drivers', 'driver_documents', 'driver_trainings', 'crew_assignments',
        // manifests
        'manifests', 'checklist_items',
        // incidents + compensation
        'incidents', 'compensation_items', 'vouchers',
        // shipments
        'shipments', 'shipment_items',
      ],
      dependencies: {
        buses:              ['agencies', 'vehicle_types'],
        maintenance_reports:['buses'],
        vehicle_documents:  ['buses'],
        drivers:            ['agencies'],
        driver_documents:   ['drivers'],
        driver_trainings:   ['drivers'],
        crew_assignments:   ['drivers', 'trips'],
        manifests:          ['trips', 'buses', 'agencies'],
        checklist_items:    ['manifests'],
        incidents:          ['trips', 'agencies'],
        compensation_items: ['incidents', 'tickets', 'customers'],
        vouchers:           ['compensation_items', 'customers'],
        shipments:          ['agencies', 'stations'],
        shipment_items:     ['shipments', 'parcels'],
        vehicle_types:      [],
        trips:              [],
        tickets:            [],
        customers:          [],
        agencies:           [],
        stations:           [],
      },
      minioEntityTypes: [
        'bus_document', 'maintenance_report', 'driver_document',
        'driver_training', 'incident_photo', 'manifest', 'shipment_document',
      ],
      includes: ['billetterie', 'colis'],
    }],

    // ── SNAPSHOT COMPLET ───────────────────────────────────────────────────
    // Toutes les tables du tenant + bucket MinIO entier.
    // La liste des tables est résolue dynamiquement par BackupService
    // via pg_catalog (toutes les tables avec colonne tenantId).
    ['full', {
      id:          'full',
      label:       'backup.scope.full.label',
      description: 'backup.scope.full.desc',
      rootTables:       [],  // résolu dynamiquement
      dependencies:     {},  // résolu dynamiquement
      minioEntityTypes: [],  // '*' = tout le bucket tenant
      includes: ['billetterie', 'colis', 'operations'],
    }],
  ]);

  getAll(): BackupScope[] {
    return Array.from(this.scopes.values());
  }

  get(scopeId: string): BackupScope | undefined {
    return this.scopes.get(scopeId);
  }

  /**
   * Résout toutes les tables nécessaires pour un scope (racines + dépendances
   * transitives des scopes inclus) et retourne l'ordre topologique pour
   * la restauration (les prérequis d'abord).
   */
  resolveTablesOrdered(scopeId: string): string[] {
    const scope = this.scopes.get(scopeId);
    if (!scope) throw new Error(`Scope inconnu : ${scopeId}`);

    // Collecter toutes les tables de ce scope + sous-scopes
    const allTables = new Set<string>(scope.rootTables);
    const allDeps: Record<string, string[]> = { ...scope.dependencies };

    for (const includedId of scope.includes ?? []) {
      const included = this.scopes.get(includedId);
      if (!included) continue;
      for (const t of included.rootTables) allTables.add(t);
      for (const [t, deps] of Object.entries(included.dependencies)) {
        allDeps[t] = [...new Set([...(allDeps[t] ?? []), ...deps])];
      }
    }

    // Tri topologique (Kahn's algorithm)
    const inDegree = new Map<string, number>();
    const adjList  = new Map<string, Set<string>>();

    for (const table of allTables) {
      inDegree.set(table, 0);
      adjList.set(table, new Set());
    }

    for (const [table, deps] of Object.entries(allDeps)) {
      if (!allTables.has(table)) continue;
      for (const dep of deps) {
        if (!allTables.has(dep)) continue;
        // dep doit être restauré avant table → dep → table
        adjList.get(dep)!.add(table);
        inDegree.set(table, (inDegree.get(table) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [table, deg] of inDegree) {
      if (deg === 0) queue.push(table);
    }
    queue.sort(); // ordre déterministe à degré égal

    const ordered: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      ordered.push(current);
      const neighbors = adjList.get(current) ?? new Set();
      for (const neighbor of [...neighbors].sort()) {
        const newDeg = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }

    // Vérification cycle
    if (ordered.length !== allTables.size) {
      const missing = [...allTables].filter(t => !ordered.includes(t));
      throw new Error(`Cycle FK détecté dans le scope ${scopeId} pour les tables : ${missing.join(', ')}`);
    }

    return ordered;
  }

  /**
   * Collecte tous les types d'entités MinIO pour un scope (y compris sous-scopes).
   * Retourne [] si scope=full (signifie "tout le bucket").
   */
  resolveMinioEntityTypes(scopeId: string): string[] | null {
    const scope = this.scopes.get(scopeId);
    if (!scope) return null;
    if (scopeId === 'full') return null; // null = tout le bucket

    const types = new Set<string>(scope.minioEntityTypes);
    for (const includedId of scope.includes ?? []) {
      const included = this.scopes.get(includedId);
      if (!included) continue;
      for (const t of included.minioEntityTypes) types.add(t);
    }
    return [...types];
  }
}
