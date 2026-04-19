/**
 * Queue d'impression — stockée dans la même base SQLite que la outbox réseau,
 * mais distincte (table `print_queue`). Les jobs d'impression survivent aux
 * redémarrages et se rejouent à la prochaine connexion printer disponible.
 *
 * Flux :
 *   1. UI → queuePrint(receipt) : ligne PENDING persistée.
 *   2. Driver.print() au prochain tick ; succès → DONE, échec → PENDING/FAILED
 *      avec back-off exponentiel (même logique que outbox réseau).
 */

import { getDb } from '../offline/db';
import { MockPrinterDriver } from './mock.driver';
import type { PrinterDriver, ReceiptPayload } from './printer.types';

// Constantes — pas de magic number dans le contrôle de flux.
const MAX_PRINT_ATTEMPTS = 6;
const BASE_BACKOFF_MS    = 3_000;
const MAX_BACKOFF_MS     = 60_000;

// Driver singleton — remplaçable par le vrai driver BT ESC/POS au moment du
// build EAS (cf. mobile/README.md section "Impression Bluetooth").
let driver: PrinterDriver = new MockPrinterDriver();
export function setPrinterDriver(d: PrinterDriver): void { driver = d; }
export function getPrinterDriver(): PrinterDriver { return driver; }

async function initTable(): Promise<void> {
  const db = await getDb();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS print_queue (
      id            TEXT PRIMARY KEY,
      payload       TEXT NOT NULL,
      attempts      INTEGER NOT NULL DEFAULT 0,
      last_error    TEXT,
      created_at    INTEGER NOT NULL,
      next_try_at   INTEGER NOT NULL,
      status        TEXT NOT NULL DEFAULT 'PENDING',
      done_at       INTEGER
    );
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS print_status_idx ON print_queue(status, next_try_at);`);
}

export async function queuePrint(payload: ReceiptPayload): Promise<void> {
  await initTable();
  const db = await getDb();
  const now = Date.now();
  await db.execute(
    `INSERT OR REPLACE INTO print_queue (id, payload, attempts, created_at, next_try_at, status)
     VALUES (?, ?, 0, ?, ?, 'PENDING')`,
    [payload.id, JSON.stringify(payload), now, now],
  );
  // Flush immédiat — en général l'utilisateur vient d'encaisser, printer est
  // connecté et branché sur le guichet.
  void flushPrintQueue().catch(() => {});
}

let flushing: Promise<void> | null = null;

export function flushPrintQueue(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      await initTable();
      const db = await getDb();
      const now = Date.now();
      const res = await db.execute(
        `SELECT * FROM print_queue WHERE status = 'PENDING' AND next_try_at <= ? ORDER BY created_at ASC`,
        [now],
      );
      for (const row of res.rows ?? []) {
        const id         = row.id as string;
        const attempts   = Number(row.attempts) + 1;
        const payload    = JSON.parse(row.payload as string) as ReceiptPayload;
        await db.execute(
          `UPDATE print_queue SET status='RUNNING', attempts=? WHERE id=?`,
          [attempts, id],
        );
        try {
          await driver.print(payload);
          await db.execute(
            `UPDATE print_queue SET status='DONE', done_at=?, last_error=NULL WHERE id=?`,
            [Date.now(), id],
          );
        } catch (err) {
          const failed = attempts >= MAX_PRINT_ATTEMPTS;
          const backoff = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempts - 1), MAX_BACKOFF_MS);
          await db.execute(
            `UPDATE print_queue SET status=?, last_error=?, next_try_at=? WHERE id=?`,
            [
              failed ? 'FAILED' : 'PENDING',
              err instanceof Error ? err.message : String(err),
              Date.now() + backoff,
              id,
            ],
          );
        }
      }
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}
