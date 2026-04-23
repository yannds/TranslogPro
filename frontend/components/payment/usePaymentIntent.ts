/**
 * usePaymentIntent — hook React autour des endpoints paiement.
 *
 * Flux :
 *   1. `createIntent(dto)` → POST /api/v1/payments/intents
 *   2. Polling confirm toutes les 3s tant que status ∈ {CREATED, PROCESSING}
 *      (arrêt après TTL de l'intent ou 5 min max côté client)
 *   3. onStatus(status) callback pour UI
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiPost, apiGet } from '../../lib/api';

export type PaymentMethod = 'MOBILE_MONEY' | 'CARD' | 'BANK_TRANSFER' | 'USSD';

export interface CreateIntentInput {
  entityType:     'TICKET' | 'PARCEL' | 'INVOICE' | 'SUBSCRIPTION' | 'CUSTOM';
  entityId?:      string;
  customerId?:    string;
  subtotal:       number;
  method:         PaymentMethod;
  currency?:      string;
  idempotencyKey: string;
  description?:   string;
  customerPhone?: string;
  customerEmail?: string;
  customerName?:  string;
  redirectUrl?:   string;
  metadata?:      Record<string, unknown>;
}

export interface CreateIntentResult {
  intentId:    string;
  status:      string;
  amount:      number;
  currency:    string;
  paymentUrl?: string;
  providerKey: string;
  expiresAt:   string;
}

const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_MS      = 5 * 60 * 1_000;

export function usePaymentIntent(tenantId: string | null) {
  const [intent, setIntent]   = useState<CreateIntentResult | null>(null);
  const [status, setStatus]   = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartedAt = useRef<number>(0);

  const clearPoll = useCallback(() => {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
  }, []);

  useEffect(() => clearPoll, [clearPoll]);

  const createIntent = useCallback(async (dto: CreateIntentInput): Promise<CreateIntentResult | null> => {
    if (!tenantId) { setError('Tenant inconnu'); return null; }
    setLoading(true); setError(null);
    try {
      // Endpoint officiel : POST /api/tenants/:tenantId/payments/intents
      // (PaymentController — Sprint 10).
      const res = await apiPost<CreateIntentResult>(`/api/tenants/${tenantId}/payments/intents`, dto);
      setIntent(res); setStatus(res.status);
      startPolling(res.intentId);
      return res;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
      return null;
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  // Statuts non-terminaux : on continue le polling. Les autres sont finaux.
  const NON_TERMINAL_STATUSES = ['CREATED', 'PROCESSING'];

  const startPolling = useCallback((intentId: string) => {
    clearPoll();
    pollStartedAt.current = Date.now();
    pollTimer.current = setInterval(async () => {
      if (Date.now() - pollStartedAt.current > POLL_MAX_MS) { clearPoll(); return; }
      try {
        // GET /intents/:id — lecture read-only, côté serveur on vérifie tenantId.
        const res = await apiGet<{ status: string }>(
          `/api/tenants/${tenantId}/payments/intents/${intentId}`,
        );
        setStatus(res.status);
        if (!NON_TERMINAL_STATUSES.includes(res.status)) clearPoll();
      } catch (err) {
        /* on retente jusqu'au max */
      }
    }, POLL_INTERVAL_MS);
  }, [tenantId, clearPoll]);

  return { intent, status, loading, error, createIntent, stopPolling: clearPoll };
}
