/**
 * Outbox mobile — enqueue() + flush() + startSyncLoop().
 * Réplique l'API web (même contrat pour unifier la logique métier).
 */

import * as Network from 'expo-network';
import { apiFetch } from '../api/client';
import { getDb, listPending, type OutboxItem } from './db';

const MAX_ATTEMPTS = 10;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS  = 60_000;

export interface EnqueueInput {
  tenantId:        string;
  kind:            string;
  method:          OutboxItem['method'];
  url:             string;
  body?:           unknown;
  headers?:        Record<string, string>;
  context?:        unknown;
  idempotencyKey?: string;
}

export async function enqueueMutation(input: EnqueueInput): Promise<OutboxItem> {
  const db = await getDb();
  const id = _uuid();
  const headers = { ...(input.headers ?? {}) };
  headers['Idempotency-Key'] ??= input.idempotencyKey ?? id;

  const item: OutboxItem = {
    id,
    tenantId:   input.tenantId,
    kind:       input.kind,
    method:     input.method,
    url:        input.url,
    headers,
    body:       input.body ?? null,
    context:    input.context ?? null,
    attempts:   0,
    lastError:  null,
    createdAt:  Date.now(),
    nextTryAt:  Date.now(),
    status:     'PENDING',
    doneAt:     null,
  };

  await db.execute(
    `INSERT INTO outbox (id, tenant_id, kind, method, url, headers, body, context, attempts, created_at, next_try_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'PENDING')`,
    [
      item.id, item.tenantId, item.kind, item.method, item.url,
      item.headers ? JSON.stringify(item.headers) : null,
      item.body    !== null ? JSON.stringify(item.body)    : null,
      item.context !== null ? JSON.stringify(item.context) : null,
      item.createdAt, item.nextTryAt,
    ],
  );
  return item;
}

function _uuid(): string {
  // Crypto-faible mais suffisant pour une clé locale (l'idempotency côté serveur protège).
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function nextBackoff(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempts - 1)), MAX_BACKOFF_MS);
}

let flushing: Promise<void> | null = null;

export function flushOutbox(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      const db = await getDb();
      const pending = await listPending();
      for (const item of pending) {
        await db.execute(
          `UPDATE outbox SET status = 'RUNNING', attempts = attempts + 1 WHERE id = ?`,
          [item.id],
        );
        try {
          await apiFetch(item.url, {
            method:  item.method,
            body:    item.body,
            headers: item.headers ?? undefined,
            skipAuthRedirect: true,
          });
          await db.execute(
            `UPDATE outbox SET status = 'DONE', done_at = ?, last_error = NULL WHERE id = ?`,
            [Date.now(), item.id],
          );
        } catch (err) {
          const attempts = item.attempts + 1;
          const failed = attempts >= MAX_ATTEMPTS;
          await db.execute(
            `UPDATE outbox SET status = ?, last_error = ?, next_try_at = ? WHERE id = ?`,
            [
              failed ? 'FAILED' : 'PENDING',
              (err as Error).message ?? String(err),
              Date.now() + nextBackoff(attempts),
              item.id,
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

/** Boucle de synchronisation : flush à chaque reconnection + toutes les 2 min. */
export function startSyncLoop(): () => void {
  let cancelled = false;
  let interval: ReturnType<typeof setInterval> | null = null;

  async function tick() {
    if (cancelled) return;
    try {
      const state = await Network.getNetworkStateAsync();
      if (state.isConnected && state.isInternetReachable !== false) {
        await flushOutbox();
      }
    } catch { /* ignore */ }
  }

  void tick();
  interval = setInterval(() => { void tick(); }, 120_000);
  return () => {
    cancelled = true;
    if (interval) clearInterval(interval);
  };
}
