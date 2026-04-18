/**
 * Outbox — file d'attente de mutations à rejouer quand le réseau est rétabli.
 *
 * Pattern :
 *   - enqueue() : ajoute une mutation (avec idempotencyKey, body, url).
 *   - flush()   : retente tous les items PENDING dans l'ordre createdAt.
 *   - auto     : démarré via startSyncLoop() sur event `online`.
 *
 * Chaque retry utilise un back-off exponentiel plafonné à 60 s. Les items
 * qui atteignent 10 tentatives passent en FAILED (l'UI peut les relancer
 * manuellement ou les supprimer).
 *
 * Sécurité : le serveur est source de vérité. L'idempotencyKey garantit
 * qu'un replay ne crée pas de doublon (cf. PaymentIntent, CashierTx).
 */

import { offlineDB, type OutboxItem } from './db';
import { apiFetch } from '../api';

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
  const id = crypto.randomUUID();
  const headers = { ...(input.headers ?? {}) };
  if (input.idempotencyKey && !headers['Idempotency-Key']) {
    headers['Idempotency-Key'] = input.idempotencyKey;
  } else if (!headers['Idempotency-Key']) {
    headers['Idempotency-Key'] = id;
  }

  const item: OutboxItem = {
    id,
    tenantId:   input.tenantId,
    kind:       input.kind,
    method:     input.method,
    url:        input.url,
    headers,
    body:       input.body,
    context:    input.context,
    attempts:   0,
    createdAt:  Date.now(),
    nextTryAt:  Date.now(),
    status:     'PENDING',
  };

  await offlineDB.outbox.add(item);
  return item;
}

/** Retourne le nombre d'items PENDING (pour badge UI). */
export async function countPending(tenantId?: string): Promise<number> {
  const col = tenantId
    ? offlineDB.outbox.where({ tenantId, status: 'PENDING' })
    : offlineDB.outbox.where('status').equals('PENDING');
  return col.count();
}

export async function listOutbox(tenantId?: string): Promise<OutboxItem[]> {
  const col = tenantId
    ? offlineDB.outbox.where({ tenantId })
    : offlineDB.outbox.toCollection();
  return (await col.toArray()).sort((a, b) => a.createdAt - b.createdAt);
}

export async function deleteOutbox(id: string): Promise<void> {
  await offlineDB.outbox.delete(id);
}

function nextBackoff(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempts - 1)), MAX_BACKOFF_MS);
}

let flushInFlight: Promise<void> | null = null;

/**
 * Rejoue tous les items PENDING dans l'ordre. Single-flight : deux appels
 * concurrents partagent la même promesse (évite les doubles rejeux).
 */
export function flushOutbox(): Promise<void> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = (async () => {
    try {
      const pending = await offlineDB.outbox
        .where('status').equals('PENDING')
        .and(it => it.nextTryAt <= Date.now())
        .toArray();
      // Trier par createdAt pour garantir l'ordre d'émission.
      pending.sort((a, b) => a.createdAt - b.createdAt);

      for (const item of pending) {
        await offlineDB.outbox.update(item.id, { status: 'RUNNING', attempts: item.attempts + 1 });
        try {
          await apiFetch(item.url, {
            method: item.method,
            body:   item.body,
            headers: item.headers,
            // Pas de redirect auto : on veut l'erreur pour décider du retry.
            skipRedirectOn401: true,
          });
          await offlineDB.outbox.update(item.id, {
            status: 'DONE',
            doneAt: Date.now(),
            lastError: null,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const attempts = item.attempts + 1;
          const status: OutboxItem['status'] = attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING';
          await offlineDB.outbox.update(item.id, {
            status,
            lastError: msg,
            nextTryAt: Date.now() + nextBackoff(attempts),
          });
          // On ne stoppe pas la boucle : d'autres items peuvent être
          // indépendants du serveur qui vient de tomber. Le caller décide.
        }
      }
    } finally {
      flushInFlight = null;
    }
  })();
  return flushInFlight;
}

/**
 * Boucle sync auto : flush à chaque retour online + toutes les 2 min en online.
 * Retourne une fonction de cleanup.
 */
export function startSyncLoop(): () => void {
  const onOnline = () => { flushOutbox().catch(() => {}); };
  window.addEventListener('online', onOnline);

  // Kick-off immédiat si online au démarrage
  if (navigator.onLine) flushOutbox().catch(() => {});

  const interval = setInterval(() => {
    if (navigator.onLine) flushOutbox().catch(() => {});
  }, 120_000);

  return () => {
    window.removeEventListener('online', onOnline);
    clearInterval(interval);
  };
}
