/**
 * useRealtimeEvents — Hook EventSource pour le stream SSE tenant (Sprint 6).
 *
 * Ouvre une connexion SSE vers /api/tenants/:tenantId/realtime/events et
 * appelle `onEvent` à chaque événement reçu, filtré optionnellement par type.
 *
 * Ne gère pas l'auth explicite : EventSource envoie les cookies same-origin
 * automatiquement (le middleware NestJS gère l'auth + permission + scope tenant).
 *
 * Pour éviter le burn CPU, les événements sont transmis tels quels au caller.
 * Le caller est responsable de débouncer les refresh (ex: setTimeout 500ms).
 */

import { useEffect, useRef } from 'react';

export interface RealtimeEvent<P = Record<string, unknown>> {
  type:          string;
  aggregateId?:  string;
  aggregateType?: string;
  occurredAt?:   string;
  payload?:      P;
}

export interface UseRealtimeEventsOptions {
  /** Filtre par types d'events (ex: ['ticket.issued', 'cashregister.closed']). */
  types?:  string[];
  /** Désactive le hook sans re-render (ex: user sans permission). */
  enabled?: boolean;
}

export function useRealtimeEvents(
  tenantId: string | undefined,
  onEvent:  (evt: RealtimeEvent) => void,
  options:  UseRealtimeEventsOptions = {},
): void {
  const { types, enabled = true } = options;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled || !tenantId) return;

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      try {
        es = new EventSource(`/api/tenants/${tenantId}/realtime/events`, {
          withCredentials: true,
        });

        const handler = (msg: MessageEvent) => {
          try {
            const parsed = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data;
            const evt: RealtimeEvent = {
              type:          String(parsed?.type ?? msg.type ?? ''),
              aggregateId:   parsed?.aggregateId,
              aggregateType: parsed?.aggregateType,
              occurredAt:    parsed?.occurredAt,
              payload:       parsed?.payload,
            };
            if (!types || types.length === 0 || types.includes(evt.type)) {
              onEventRef.current(evt);
            }
          } catch {
            // Ignore messages non-JSON (heartbeat éventuel)
          }
        };

        es.addEventListener('message', handler);
        // NestJS SSE publie aussi un event spécifique par type → on écoute tout
        if (types) {
          for (const tp of types) {
            es.addEventListener(tp, handler as EventListener);
          }
        }

        es.onerror = () => {
          // Reco exponentielle simple (1s → 5s → 10s…)
          es?.close();
          es = null;
          if (!closed) {
            retryTimer = setTimeout(connect, 5_000);
          }
        };
      } catch {
        // EventSource non dispo (test env) — silencieux
      }
    };

    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
      es = null;
    };
  }, [tenantId, enabled, types?.join('|')]);
}
