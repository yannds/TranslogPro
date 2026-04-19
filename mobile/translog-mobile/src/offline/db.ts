/**
 * SQLite outbox mobile — API Promise-based (op-sqlite expose uniquement des
 * `execute() → Promise<QueryResult>`).
 *
 * Web : op-sqlite n'a pas d'impl web. On sert un shim in-memory qui permet
 * à l'UI de se charger, mais sans persistance. Utile pour prototyper en
 * navigateur ; la vraie stack offline n'est garantie que sur iOS/Android.
 */

import { Platform } from 'react-native';

const DB_NAME = 'translog_offline.db';

// Types partagés avec op-sqlite (minimalistes, suffisant pour nos besoins).
interface QueryResult { rows: Array<Record<string, unknown>>; }
interface DB { execute(q: string, p?: unknown[]): Promise<QueryResult>; }

// Shim web — stocke tout en mémoire. Perte au reload (attendu).
function createWebShimDb(): DB {
  const store: Record<string, Array<Record<string, unknown>>> = {};
  return {
    async execute(q: string, _p?: unknown[]): Promise<QueryResult> {
      // Suffisant pour que les appels `CREATE TABLE`, `INSERT`, `SELECT COUNT`,
      // `UPDATE` utilisés côté outbox/print queue ne throwent pas. Les tests
      // offline réels se valident sur iOS/Android — pas en web.
      if (/CREATE TABLE/i.test(q) || /CREATE INDEX/i.test(q)) {
        return { rows: [] };
      }
      if (/SELECT COUNT/i.test(q)) {
        return { rows: [{ n: 0 }] };
      }
      if (/SELECT \*/i.test(q)) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

let _db: DB | null = null;
let _initPromise: Promise<DB> | null = null;

export function getDb(): Promise<DB> {
  if (_db) return Promise.resolve(_db);
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    // Web : shim in-memory, pas d'open() natif.
    if (Platform.OS === 'web') {
      const db = createWebShimDb();
      _db = db;
      return db;
    }
    // Import différé pour éviter que le bundler web charge la dep native.
    const { open } = await import('@op-engineering/op-sqlite');
    const db = open({ name: DB_NAME }) as unknown as DB;
    await db.execute(`
      CREATE TABLE IF NOT EXISTS outbox (
        id            TEXT PRIMARY KEY,
        tenant_id     TEXT NOT NULL,
        kind          TEXT NOT NULL,
        method        TEXT NOT NULL,
        url           TEXT NOT NULL,
        headers       TEXT,
        body          TEXT,
        context       TEXT,
        attempts      INTEGER NOT NULL DEFAULT 0,
        last_error    TEXT,
        created_at    INTEGER NOT NULL,
        next_try_at   INTEGER NOT NULL,
        status        TEXT NOT NULL DEFAULT 'PENDING',
        done_at       INTEGER
      );
    `);
    await db.execute(`CREATE INDEX IF NOT EXISTS outbox_status_idx ON outbox(status, next_try_at);`);
    await db.execute(`CREATE INDEX IF NOT EXISTS outbox_tenant_idx ON outbox(tenant_id, status);`);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS cache (
        key           TEXT PRIMARY KEY,
        tenant_id     TEXT NOT NULL,
        table_name    TEXT NOT NULL,
        data          TEXT NOT NULL,
        updated_at    INTEGER NOT NULL
      );
    `);
    await db.execute(`CREATE INDEX IF NOT EXISTS cache_tenant_idx ON cache(tenant_id, table_name);`);
    _db = db;
    return db;
  })();
  return _initPromise;
}

export interface OutboxItem {
  id:         string;
  tenantId:   string;
  kind:       string;
  method:     'POST' | 'PATCH' | 'DELETE' | 'PUT';
  url:        string;
  headers:    Record<string, string> | null;
  body:       unknown;
  context:    unknown;
  attempts:   number;
  lastError:  string | null;
  createdAt:  number;
  nextTryAt:  number;
  status:     'PENDING' | 'RUNNING' | 'FAILED' | 'DONE';
  doneAt:     number | null;
}

function rowToItem(r: Record<string, unknown>): OutboxItem {
  return {
    id:         r.id as string,
    tenantId:   r.tenant_id as string,
    kind:       r.kind as string,
    method:     r.method as OutboxItem['method'],
    url:        r.url as string,
    headers:    r.headers ? JSON.parse(r.headers as string) : null,
    body:       r.body    ? JSON.parse(r.body as string)    : null,
    context:    r.context ? JSON.parse(r.context as string) : null,
    attempts:   Number(r.attempts),
    lastError:  (r.last_error as string) ?? null,
    createdAt:  Number(r.created_at),
    nextTryAt:  Number(r.next_try_at),
    status:     r.status as OutboxItem['status'],
    doneAt:     r.done_at !== null && r.done_at !== undefined ? Number(r.done_at) : null,
  };
}

export async function listPending(now = Date.now()): Promise<OutboxItem[]> {
  const db = await getDb();
  const res = await db.execute(
    `SELECT * FROM outbox WHERE status = 'PENDING' AND next_try_at <= ? ORDER BY created_at ASC`,
    [now],
  );
  return (res.rows ?? []).map(rowToItem);
}

export async function countPending(tenantId?: string): Promise<number> {
  const db = await getDb();
  const res = tenantId
    ? await db.execute(`SELECT COUNT(*) AS n FROM outbox WHERE status = 'PENDING' AND tenant_id = ?`, [tenantId])
    : await db.execute(`SELECT COUNT(*) AS n FROM outbox WHERE status = 'PENDING'`);
  const row = res.rows?.[0];
  return row ? Number(row.n) : 0;
}
