/**
 * FreightLoadingPanel — vue opérationnelle "chargement fret" pour un trajet.
 *
 * Réutilisable entre :
 *   - Portail chauffeur (/driver/freight)  → trip = trajet actif du chauffeur
 *   - Portail agent de quai (/quai)        → trip sélectionné dans le dropdown du jour
 *
 * Données :
 *   GET  /api/tenants/:tid/shipments/trips/:tripId     → liste shipments + parcels
 *   POST /api/tenants/:tid/parcels/:id/transition      → transition d'état (LOAD / ARRIVE / DELIVER)
 *   POST /api/tenants/:tid/parcels/:id/report-damage   → déclaration casse
 *
 * Permissions requises côté backend (vérifiées par PermissionGuard) :
 *   - data.parcel.update.agency  (GET shipments + POST transition)
 *   - data.parcel.scan.agency    (POST scan alternatif)
 *   - data.parcel.report.agency  (POST damage)
 *
 * Les 3 rôles qui les ont : AGENT_QUAI, DRIVER (ajouts 2026-04-19),
 * AGENCY_MANAGER (historique).
 *
 * UX :
 *   - Mobile-first : lignes empilées, boutons min 44px tap target
 *   - Chaque parcel affiche son code tracking (mono), poids, status badge et
 *     l'action contextuelle selon l'état courant (LOAD / ARRIVE / DELIVER)
 *   - Actions in-line avec spinner et error inline par ligne
 *   - Compteur en tête : "X/Y chargés" pour voir la progression
 */

import { useMemo, useState } from 'react';
import {
  PackagePlus, PackageCheck, PackageOpen, AlertTriangle, Loader2, Boxes, Lock,
} from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { useI18n } from '../../lib/i18n/useI18n';
import { apiPost, ApiError } from '../../lib/api';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Skeleton } from '../ui/Skeleton';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParcelLite {
  id:           string;
  trackingCode: string;
  status:       string;
  weight:       number;
}

interface ShipmentWithParcels {
  id:              string;
  destinationId:   string;
  totalWeight:     number;
  remainingWeight: number;
  status:          string;
  parcels:         ParcelLite[];
}

export interface FreightLoadingPanelProps {
  tenantId: string;
  tripId:   string;
  /** Utilisé pour l'i18n du titre — "Fret de mon trajet" (driver) vs
   *  "Fret du trajet sélectionné" (quai). */
  role?:    'driver' | 'quai';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type BadgeVariant = 'default' | 'info' | 'success' | 'warning' | 'danger';

// Mapping status courant → variant de badge + clé i18n.
const STATUS_MAP: Record<string, { variant: BadgeVariant; key: string }> = {
  CREATED:    { variant: 'default', key: 'freight.statusCreated' },
  AT_ORIGIN:  { variant: 'info',    key: 'freight.statusAtOrigin' },
  PACKED:     { variant: 'info',    key: 'freight.statusPacked' },
  LOADED:     { variant: 'success', key: 'freight.statusLoaded' },
  IN_TRANSIT: { variant: 'warning', key: 'freight.statusInTransit' },
  ARRIVED:    { variant: 'success', key: 'freight.statusArrived' },
  DELIVERED:  { variant: 'success', key: 'freight.statusDelivered' },
  DAMAGED:    { variant: 'danger',  key: 'freight.statusDamaged' },
  LOST:       { variant: 'danger',  key: 'freight.statusLost' },
};

/**
 * Détermine l'action prioritaire disponible selon le status. Le backend fait
 * autorité sur les transitions via ParcelAction ; on projette juste l'état
 * sur le bouton pertinent.
 */
function nextAction(status: string): { action: string; labelKey: string; icon: React.ReactNode } | null {
  switch (status) {
    case 'AT_ORIGIN':
    case 'PACKED':
      return {
        action:   'LOAD',
        labelKey: 'freight.actionLoad',
        icon:     <PackagePlus className="w-4 h-4" aria-hidden />,
      };
    case 'IN_TRANSIT':
      return {
        action:   'ARRIVE',
        labelKey: 'freight.actionArrive',
        icon:     <PackageCheck className="w-4 h-4" aria-hidden />,
      };
    case 'ARRIVED':
      return {
        action:   'DELIVER',
        labelKey: 'freight.actionDeliver',
        icon:     <PackageOpen className="w-4 h-4" aria-hidden />,
      };
    default:
      // LOADED, DELIVERED, DAMAGED, LOST, CREATED, RETURNED → pas d'action primaire
      return null;
  }
}

// ─── Composant ────────────────────────────────────────────────────────────────

export function FreightLoadingPanel({ tenantId, tripId, role = 'driver' }: FreightLoadingPanelProps) {
  const { t } = useI18n();

  const { data: shipments, loading, error, refetch } = useFetch<ShipmentWithParcels[]>(
    tenantId && tripId ? `/api/tenants/${tenantId}/shipments/trips/${tripId}` : null,
    [tenantId, tripId],
  );

  // Busy par colis — permet de cliquer en parallèle sans bloquer les autres
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({});
  const [errorMap, setErrorMap] = useState<Record<string, string | null>>({});

  const shipList = useMemo(() => shipments ?? [], [shipments]);

  // Compteurs globaux — X/Y chargés
  const { total, loaded } = useMemo(() => {
    const all = shipList.flatMap(s => s.parcels);
    return {
      total:  all.length,
      loaded: all.filter(p => ['LOADED', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED'].includes(p.status)).length,
    };
  }, [shipList]);

  async function handleAction(parcelId: string, action: string) {
    setBusyMap(m => ({ ...m, [parcelId]: true }));
    setErrorMap(m => ({ ...m, [parcelId]: null }));
    try {
      await apiPost(`/api/tenants/${tenantId}/parcels/${parcelId}/transition`, { action });
      refetch();
    } catch (e) {
      const msg = e instanceof ApiError
        ? String((e.body as { message?: string })?.message ?? e.message)
        : String(e);
      setErrorMap(m => ({ ...m, [parcelId]: msg }));
    } finally {
      setBusyMap(m => ({ ...m, [parcelId]: false }));
    }
  }

  // Clôture d'un shipment entier : OPEN → LOADED. Le backend rejette si des
  // colis ne sont pas encore en état LOADED. On passe le shipmentId au même
  // busyMap/errorMap pour feedback inline (key = shipmentId).
  async function handleCloseShipment(shipmentId: string) {
    if (!window.confirm(t('freight.confirmCloseShipment'))) return;
    setBusyMap(m => ({ ...m, [shipmentId]: true }));
    setErrorMap(m => ({ ...m, [shipmentId]: null }));
    try {
      await apiPost(`/api/tenants/${tenantId}/shipments/${shipmentId}/close`, {});
      refetch();
    } catch (e) {
      const msg = e instanceof ApiError
        ? String((e.body as { message?: string })?.message ?? e.message)
        : String(e);
      setErrorMap(m => ({ ...m, [shipmentId]: msg }));
    } finally {
      setBusyMap(m => ({ ...m, [shipmentId]: false }));
    }
  }

  async function handleDamage(parcelId: string) {
    const description = window.prompt(t('freight.damagePrompt'));
    if (!description || description.trim().length === 0) return;
    setBusyMap(m => ({ ...m, [parcelId]: true }));
    setErrorMap(m => ({ ...m, [parcelId]: null }));
    try {
      await apiPost(`/api/tenants/${tenantId}/parcels/${parcelId}/report-damage`, { description });
      refetch();
    } catch (e) {
      const msg = e instanceof ApiError
        ? String((e.body as { message?: string })?.message ?? e.message)
        : String(e);
      setErrorMap(m => ({ ...m, [parcelId]: msg }));
    } finally {
      setBusyMap(m => ({ ...m, [parcelId]: false }));
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <section aria-label={t('freight.sectionLabel')} className="space-y-4">
      <ErrorAlert error={error} icon />

      {/* Header compteur */}
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Boxes className="w-5 h-5 text-teal-500" aria-hidden />
          <h3 className="text-sm font-semibold t-text">
            {role === 'driver' ? t('freight.titleDriver') : t('freight.titleQuai')}
          </h3>
        </div>
        <Badge variant={loaded === total && total > 0 ? 'success' : 'info'}>
          {loaded}/{total} {t('freight.loadedCount')}
        </Badge>
      </header>

      {/* Empty state */}
      {shipList.length === 0 ? (
        <div className="flex flex-col items-center py-10 text-slate-500 dark:text-slate-400" role="status">
          <Boxes className="w-10 h-10 mb-2 text-slate-300 dark:text-slate-600" aria-hidden />
          <p className="text-sm font-medium">{t('freight.noShipments')}</p>
          <p className="text-xs mt-1">{t('freight.noShipmentsHint')}</p>
        </div>
      ) : (
        <ul role="list" className="space-y-4">
          {shipList.map(shipment => (
            <li
              key={shipment.id}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden"
            >
              {/* En-tête shipment — le bouton "Clôturer" apparaît uniquement
                  tant que le shipment est OPEN, et reste disabled tant que
                  tous les colis ne sont pas LOADED (ou au-delà). Le backend
                  rejette aussi toute tentative invalide en 400. */}
              <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Boxes className="w-4 h-4 text-purple-500 shrink-0" aria-hidden />
                  <code className="text-xs font-mono font-semibold t-text">{shipment.id.slice(0, 8)}</code>
                  <Badge size="sm" variant={shipment.status === 'OPEN' ? 'warning' : 'success'}>
                    {shipment.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs t-text-3 tabular-nums">
                    {(shipment.totalWeight - shipment.remainingWeight).toLocaleString('fr-FR')} /{' '}
                    {shipment.totalWeight.toLocaleString('fr-FR')} kg
                  </span>
                  {shipment.status === 'OPEN' && (() => {
                    const CLEARED = new Set(['LOADED', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED']);
                    const allLoaded = shipment.parcels.length > 0
                      && shipment.parcels.every(p => CLEARED.has(p.status));
                    const isBusy = !!busyMap[shipment.id];
                    return (
                      <Button
                        variant={allLoaded ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleCloseShipment(shipment.id)}
                        disabled={!allLoaded || isBusy}
                        className="min-h-[36px]"
                        leftIcon={isBusy
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                          : <Lock className="w-3.5 h-3.5" aria-hidden />}
                        title={allLoaded
                          ? t('freight.closeShipmentOk')
                          : t('freight.closeShipmentBlocked')}
                      >
                        {t('freight.closeShipment')}
                      </Button>
                    );
                  })()}
                </div>
              </div>
              {errorMap[shipment.id] && (
                <div role="alert" className="px-4 py-2 text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30">
                  {errorMap[shipment.id]}
                </div>
              )}

              {/* Liste des colis — chaque ligne = 1 action contextuelle */}
              <ul role="list" className="divide-y divide-slate-100 dark:divide-slate-800">
                {shipment.parcels.map(parcel => {
                  const next     = nextAction(parcel.status);
                  const isBusy   = !!busyMap[parcel.id];
                  const rowError = errorMap[parcel.id];
                  const meta     = STATUS_MAP[parcel.status] ?? { variant: 'default', key: parcel.status };

                  return (
                    <li
                      key={parcel.id}
                      className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="text-sm font-mono font-semibold t-text">{parcel.trackingCode}</code>
                          <Badge size="sm" variant={meta.variant as BadgeVariant}>
                            {t(meta.key)}
                          </Badge>
                          <span className="text-xs t-text-3 tabular-nums ml-auto sm:ml-0">
                            {parcel.weight} kg
                          </span>
                        </div>
                        {rowError && (
                          <p className="text-xs text-red-600 dark:text-red-400 mt-1">{rowError}</p>
                        )}
                      </div>

                      <div className="flex gap-2 sm:justify-end">
                        {next ? (
                          <Button
                            onClick={() => handleAction(parcel.id, next.action)}
                            disabled={isBusy}
                            className="min-h-[40px] flex-1 sm:flex-initial justify-center"
                            leftIcon={isBusy
                              ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                              : next.icon}
                          >
                            {t(next.labelKey)}
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          onClick={() => handleDamage(parcel.id)}
                          disabled={isBusy || ['DAMAGED', 'LOST'].includes(parcel.status)}
                          className="min-h-[40px]"
                          leftIcon={<AlertTriangle className="w-4 h-4" aria-hidden />}
                          aria-label={t('freight.actionDamage')}
                          title={t('freight.actionDamage')}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
