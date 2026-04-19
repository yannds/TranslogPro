/**
 * useCashierSession — Hook d'état de la caisse courante (ouverture / clôture)
 *
 * Responsabilités :
 *   - Charger la caisse ouverte de l'acteur (GET /cashier/registers/me/open)
 *   - Exposer open() / close() / recordTransaction()
 *   - Rafraîchir après chaque mutation
 *
 * Le retour `register` est null si aucune caisse n'est ouverte (agent non
 * caissier, ou caisse clôturée). Le consommateur doit guarder dessus.
 */

import { useState, useCallback } from 'react';
import { useFetch } from './useFetch';
import { apiPost, apiPatch } from '../api';

export interface CashRegister {
  id:             string;
  tenantId:       string;
  agencyId:       string;
  agentId:        string;
  openedAt:       string;
  closedAt:       string | null;
  initialBalance: number;
  finalBalance:   number | null;
  status:         'OPEN' | 'CLOSED' | 'DISCREPANCY';
  _count?:        { transactions: number };
}

export interface CashierTxInput {
  type:          'TICKET' | 'PARCEL' | 'LUGGAGE_FEE' | 'REFUND' | 'CASH_IN' | 'CASH_OUT';
  amount:        number;
  paymentMethod: 'CASH' | 'MOBILE_MONEY' | 'CARD' | 'BANK_TRANSFER' | 'VOUCHER' | 'MIXED';
  externalRef?:  string;
  referenceType?: string;
  referenceId?:   string;
  note?:         string;
}

export interface UseCashierSessionResult {
  register:    CashRegister | null;
  loading:     boolean;
  error:       string | null;
  refetch:     () => void;
  openRegister: (agencyId: string, openingBalance: number, note?: string) => Promise<CashRegister>;
  closeRegister: (countedBalance: number, note?: string) => Promise<CashRegister>;
  recordTx:    (tx: CashierTxInput) => Promise<unknown>;
  mutating:    boolean;
}

export function useCashierSession(tenantId: string | null | undefined): UseCashierSessionResult {
  const { data, loading, error, refetch } = useFetch<CashRegister | null>(
    tenantId ? `/api/tenants/${tenantId}/cashier/registers/me/open` : null,
    [tenantId],
  );

  const [mutating, setMutating] = useState(false);

  const openRegister = useCallback(async (agencyId: string, openingBalance: number, note?: string) => {
    if (!tenantId) throw new Error('tenantId required');
    setMutating(true);
    try {
      const created = await apiPost<CashRegister>(
        `/api/tenants/${tenantId}/cashier/registers`,
        { agencyId, openingBalance, note },
      );
      refetch();
      return created;
    } finally {
      setMutating(false);
    }
  }, [tenantId, refetch]);

  const closeRegister = useCallback(async (countedBalance: number, closingNote?: string) => {
    if (!tenantId) throw new Error('tenantId required');
    if (!data) throw new Error('no open register');
    setMutating(true);
    try {
      const closed = await apiPatch<CashRegister>(
        `/api/tenants/${tenantId}/cashier/registers/${data.id}/close`,
        { countedBalance, closingNote },
      );
      refetch();
      return closed;
    } finally {
      setMutating(false);
    }
  }, [tenantId, data, refetch]);

  const recordTx = useCallback(async (tx: CashierTxInput) => {
    if (!tenantId) throw new Error('tenantId required');
    if (!data) throw new Error('no open register');
    setMutating(true);
    try {
      const res = await apiPost(
        `/api/tenants/${tenantId}/cashier/registers/${data.id}/transactions`,
        tx,
      );
      refetch();
      return res;
    } finally {
      setMutating(false);
    }
  }, [tenantId, data, refetch]);

  return {
    register:    data ?? null,
    loading,
    error,
    refetch,
    openRegister,
    closeRegister,
    recordTx,
    mutating,
  };
}
