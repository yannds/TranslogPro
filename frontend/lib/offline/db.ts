/**
 * Offline store — Dexie (IndexedDB).
 *
 * Persiste localement les données "lecture" indispensables à la caisse et au
 * display gare hors connexion :
 *   - trips (voyages du jour)
 *   - tickets par voyage (liste passagers)
 *   - parcels par voyage
 *   - manifests
 *   - invoices
 *
 * La table `outbox` contient les mutations à rejouer quand le réseau revient
 * (vente de billet en mode offline, signalement incident, etc.).
 *
 * Versioning : toujours incrémenter le numéro et ajouter un bloc `stores()`
 * supplémentaire. Dexie gère la migration automatiquement.
 */

import Dexie, { Table } from 'dexie';

export interface CachedTrip {
  id:        string;
  tenantId:  string;
  data:      unknown; // payload complet du trip (JSON)
  updatedAt: number;
}

export interface CachedPassenger {
  id:        string;   // ticketId
  tenantId:  string;
  tripId:    string;
  data:      unknown;
  updatedAt: number;
}

export interface CachedParcel {
  id:        string;
  tenantId:  string;
  tripId:    string | null;
  data:      unknown;
  updatedAt: number;
}

export interface CachedManifest {
  id:        string;
  tenantId:  string;
  tripId:    string;
  data:      unknown;
  updatedAt: number;
}

export interface CachedInvoice {
  id:        string;
  tenantId:  string;
  data:      unknown;
  updatedAt: number;
}

/**
 * Item de la outbox — une mutation différée rejouée dès que le réseau revient.
 * Chaque item porte sa propre idempotencyKey afin que la rejeu n'entraîne pas
 * de double écriture si la première tentative avait réussi côté serveur.
 */
export interface OutboxItem {
  id:              string;             // uuid
  tenantId:        string;
  /** Libellé court pour UI (ex: 'sell.batch-confirm') */
  kind:            string;
  method:          'POST' | 'PATCH' | 'DELETE' | 'PUT';
  url:             string;
  /** Headers extra (ex: Idempotency-Key). Les cookies suivent automatiquement. */
  headers?:        Record<string, string>;
  body?:           unknown;
  /** Contexte UI affichable (ex: liste de passagers) */
  context?:        unknown;
  attempts:        number;
  lastError?:      string | null;
  createdAt:       number;
  nextTryAt:       number;
  /** État : PENDING | RUNNING | FAILED | DONE. Les DONE sont purgés après 7j. */
  status:          'PENDING' | 'RUNNING' | 'FAILED' | 'DONE';
  doneAt?:         number;
}

export class OfflineDB extends Dexie {
  trips!:      Table<CachedTrip, string>;
  passengers!: Table<CachedPassenger, string>;
  parcels!:    Table<CachedParcel, string>;
  manifests!:  Table<CachedManifest, string>;
  invoices!:   Table<CachedInvoice, string>;
  outbox!:     Table<OutboxItem, string>;

  constructor() {
    super('translog_offline');
    this.version(1).stores({
      // "primary, idx1, idx2"
      trips:      'id, tenantId, updatedAt',
      passengers: 'id, tenantId, tripId, updatedAt',
      parcels:    'id, tenantId, tripId, updatedAt',
      manifests:  'id, tenantId, tripId, updatedAt',
      invoices:   'id, tenantId, updatedAt',
      outbox:     'id, tenantId, status, nextTryAt, createdAt',
    });
  }
}

export const offlineDB = new OfflineDB();

/** Purge périodique : supprime les entrées DONE anciennes de la outbox. */
export async function purgeOldOutboxEntries(olderThanMs = 7 * 24 * 3600 * 1_000) {
  const cutoff = Date.now() - olderThanMs;
  return offlineDB.outbox
    .where('status').equals('DONE')
    .and(i => (i.doneAt ?? i.createdAt) < cutoff)
    .delete();
}
