/**
 * PageParcelsList — « Gestion des colis »
 *
 * Vue complète des colis du tenant avec :
 *   - DataTableMaster (tri, recherche, pagination, export)
 *   - Actions de transition par ligne (RECEIVE, LOAD, ARRIVE, DELIVER)
 *   - Recherche par code de suivi (tracking public)
 *   - Signalement dommage / perte
 *
 * API :
 *   GET  /api/tenants/:tid/parcels                      (liste complète)
 *   GET  /api/tenants/:tid/parcels/track/:code           (tracking public)
 *   POST /api/tenants/:tid/parcels/:id/transition        body: { action }
 *   POST /api/tenants/:tid/parcels/:id/report-damage     body: { description }
 */

import { useState, useRef, useCallback, type FormEvent } from 'react';
import {
  Package, Search, PackageCheck, PackageX, Truck, MapPin, ArrowDownToLine,
  AlertOctagon, Eye, Printer, Warehouse,
} from 'lucide-react';
import { ParcelHubActionsDialog } from '../parcels/ParcelHubActionsDialog';
import { useAuth }                       from '../../lib/auth/auth.context';
import { useI18n }                        from '../../lib/i18n/useI18n';
import { useFetch }                      from '../../lib/hooks/useFetch';
import { apiGet, apiPost }               from '../../lib/api';
import { useTenantConfig }               from '../../providers/TenantConfigProvider';
import { Badge, statusToVariant }        from '../ui/Badge';
import { Button }                        from '../ui/Button';
import { Dialog }                        from '../ui/Dialog';
import { ErrorAlert }                    from '../ui/ErrorAlert';
import { FormFooter }                    from '../ui/FormFooter';
import { inputClass as inp }             from '../ui/inputClass';
import DataTableMaster                   from '../DataTableMaster';
import type { Column, RowAction, BulkAction } from '../DataTableMaster';
import { ParcelLabel }                   from '../parcels/ParcelLabel';
import { printHtmlBatch }                from '../tickets/TicketReceipt';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Parcel {
  id:            string;
  trackingCode:  string;
  status:        string;
  weight:        number;
  price:         number;
  destinationId: string;
  destination?:  { name: string; city: string } | null;
  shipment?:     { id: string; tripId: string; status: string } | null;
  recipientInfo?: { name?: string; phone?: string; address?: string } | null;
  createdAt?:    string;
}

// Maps parcel state → list of available actions
const ACTION_MAP: Record<string, { action: string; labelKey: string; icon: React.ReactNode }[]> = {
  CREATED:    [{ action: 'RECEIVE',         labelKey: 'parcelsList.actionReceive',   icon: <ArrowDownToLine className="w-3.5 h-3.5" /> }],
  AT_ORIGIN:  [],  // ADD_TO_SHIPMENT is done from PageShipments
  PACKED:     [{ action: 'LOAD',            labelKey: 'parcelsList.actionLoad',      icon: <Truck className="w-3.5 h-3.5" /> }],
  LOADED:     [],  // DEPART is auto via Trip side-effect
  IN_TRANSIT: [{ action: 'ARRIVE',          labelKey: 'parcelsList.actionArrive',    icon: <MapPin className="w-3.5 h-3.5" /> }],
  ARRIVED:    [{ action: 'DELIVER',         labelKey: 'parcelsList.actionDeliver',   icon: <PackageCheck className="w-3.5 h-3.5" /> }],
};


// ─── Page ─────────────────────────────────────────────────────────────────────

export function PageParcelsList() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { brand } = useTenantConfig();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/tenants/${tenantId}`;

  const { data: parcels, loading, error, refetch } =
    useFetch<Parcel[]>(tenantId ? `${base}/parcels` : null, [tenantId]);

  // ─── Detail dialog ────────────────────────────────────────────────────────
  const [detail, setDetail]       = useState<Parcel | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [hubTarget, setHubTarget] = useState<Parcel | null>(null);

  const openDetail = (p: Parcel) => {
    setDetail(p);
    setDetailOpen(true);
  };

  // ─── Transition ──────────────────────────────────────────────────────────
  const [actionBusy, setActionBusy]   = useState(false);
  const [actionErr, setActionErr]     = useState<string | null>(null);

  const doTransition = async (parcelId: string, action: string) => {
    setActionBusy(true); setActionErr(null);
    try {
      await apiPost(`${base}/parcels/${parcelId}/transition`, { action });
      refetch();
      setDetailOpen(false);
    } catch (err) { setActionErr((err as Error).message); }
    finally { setActionBusy(false); }
  };

  // ─── Damage dialog ───────────────────────────────────────────────────────
  const [damageOpen, setDamageOpen] = useState(false);
  const [damageId, setDamageId]     = useState<string | null>(null);
  const [damageText, setDamageText] = useState('');
  const [damageBusy, setDamageBusy] = useState(false);
  const [damageErr, setDamageErr]   = useState<string | null>(null);

  const openDamage = (p: Parcel) => {
    setDamageId(p.id);
    setDamageText('');
    setDamageErr(null);
    setDamageOpen(true);
  };

  const handleDamage = async () => {
    if (!damageId) return;
    setDamageBusy(true); setDamageErr(null);
    try {
      await apiPost(`${base}/parcels/${damageId}/report-damage`, { description: damageText.trim() });
      setDamageOpen(false);
      refetch();
    } catch (err) { setDamageErr((err as Error).message); }
    finally { setDamageBusy(false); }
  };

  // ─── Print label (per-row + bulk) ────────────────────────────────────────
  const singleLabelRef = useRef<HTMLDivElement>(null);
  const bulkLabelsRef  = useRef<HTMLDivElement>(null);
  const [labelTarget, setLabelTarget] = useState<Parcel | null>(null);
  const [bulkLabelTargets, setBulkLabelTargets] = useState<Parcel[]>([]);

  const handlePrintLabel = useCallback((row: Parcel) => {
    setLabelTarget(row);
    setTimeout(() => {
      if (singleLabelRef.current) {
        printHtmlBatch(
          singleLabelRef.current.innerHTML,
          brand.brandName,
          t('parcelsList.parcelLabel'),
        );
      }
      setLabelTarget(null);
    }, 400);
  }, [brand.brandName, t]);

  const handleBulkPrintLabels = useCallback((rows: Parcel[]) => {
    if (rows.length === 0) return;
    setBulkLabelTargets(rows);
    // Attend la génération des QR codes (async) avant de sérialiser.
    setTimeout(() => {
      if (bulkLabelsRef.current) {
        printHtmlBatch(
          bulkLabelsRef.current.innerHTML,
          brand.brandName,
          t('parcelsList.parcelLabel'),
        );
      }
      setBulkLabelTargets([]);
    }, 600);
  }, [brand.brandName, t]);

  // ─── Tracking search ─────────────────────────────────────────────────────
  const [trackCode, setTrackCode]     = useState('');
  const [trackResult, setTrackResult] = useState<Parcel | null>(null);
  const [trackBusy, setTrackBusy]     = useState(false);
  const [trackErr, setTrackErr]       = useState<string | null>(null);
  const [trackOpen, setTrackOpen]     = useState(false);

  const doTrack = async (e: FormEvent) => {
    e.preventDefault();
    const code = trackCode.trim();
    if (!code) return;
    setTrackBusy(true); setTrackErr(null); setTrackResult(null);
    try {
      const p = await apiGet<Parcel>(`${base}/parcels/track/${encodeURIComponent(code)}`);
      setTrackResult(p);
    } catch (err) { setTrackErr((err as Error).message); }
    finally { setTrackBusy(false); }
  };

  // ─── Columns ──────────────────────────────────────────────────────────────
  const columns: Column<Parcel>[] = [
    {
      key: 'trackingCode', header: t('parcelsList.trackingCode'), sortable: true,
      cellRenderer: (v) => <span className="font-mono tabular-nums text-xs">{v as string}</span>,
    },
    {
      key: 'status', header: t('parcelsList.status'), sortable: true,
      cellRenderer: (v) => <Badge size="sm" variant={statusToVariant(v as string)}>{v as string}</Badge>,
    },
    {
      key: 'destination', header: t('parcelsList.destination'), sortable: false,
      cellRenderer: (_v, row) =>
        row.destination ? `${row.destination.name} — ${row.destination.city}` : '—',
    },
    {
      key: 'weight', header: t('parcelsList.weight'), sortable: true, align: 'right',
      cellRenderer: (v) => `${(v as number).toLocaleString('fr-FR')} kg`,
    },
    {
      key: 'price', header: t('parcelsList.value'), sortable: true, align: 'right',
      cellRenderer: (v) => `${(v as number).toLocaleString('fr-FR')} XAF`,
    },
    {
      key: 'createdAt', header: t('parcelsList.createdOn'), sortable: true,
      cellRenderer: (v) => v ? new Date(v as string).toLocaleDateString('fr-FR') : '—',
    },
  ];

  // ─── Row Actions ─────────────────────────────────────────────────────────
  const rowActions: RowAction<Parcel>[] = [
    {
      label: t('parcelsList.details'),
      icon: <Eye className="w-3.5 h-3.5" />,
      onClick: (row) => openDetail(row),
    },
    {
      label: t('parcelsList.printLabel'),
      icon: <Printer className="w-3.5 h-3.5" />,
      onClick: (row) => handlePrintLabel(row),
    },
    // Dynamic transition actions
    ...(['CREATED', 'PACKED', 'IN_TRANSIT', 'ARRIVED'] as const).flatMap(status =>
      (ACTION_MAP[status] ?? []).map(a => ({
        label: t(a.labelKey),
        icon: a.icon,
        onClick: (row: Parcel) => doTransition(row.id, a.action),
        hidden: (row: Parcel) => row.status !== status,
      })),
    ),
    {
      label: t('parcelsList.reportDamage'),
      icon: <AlertOctagon className="w-3.5 h-3.5" />,
      onClick: (row) => openDamage(row),
      hidden: (row) => ['DELIVERED', 'DAMAGED', 'LOST', 'RETURNED'].includes(row.status),
      danger: true,
    },
    {
      label: t('parcelsList.declareLost'),
      icon: <PackageX className="w-3.5 h-3.5" />,
      onClick: (row) => doTransition(row.id, 'DECLARE_LOST'),
      hidden: (row) => row.status !== 'IN_TRANSIT',
      danger: true,
    },
    {
      label: t('parcelHub.openMenu'),
      icon: <Warehouse className="w-3.5 h-3.5" />,
      onClick: (row) => setHubTarget(row),
      hidden: (row) => ![
        'IN_TRANSIT', 'AT_HUB_INBOUND', 'STORED_AT_HUB', 'AT_HUB_OUTBOUND',
        'ARRIVED', 'AVAILABLE_FOR_PICKUP', 'DELIVERED', 'RETURN_TO_SENDER',
      ].includes(row.status),
    },
  ];

  const bulkActions: BulkAction<Parcel>[] = [
    {
      icon:    <Printer className="w-4 h-4" />,
      label:   t('parcelsList.bulkPrintLabels'),
      onClick: handleBulkPrintLabels,
    },
  ];

  return (
    <main className="p-6 space-y-6" role="main" aria-label={t('parcelsList.title')}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
            <Package className="w-5 h-5 text-indigo-600 dark:text-indigo-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('parcelsList.title')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {t('parcelsList.subtitle')}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => { setTrackOpen(true); setTrackResult(null); setTrackErr(null); setTrackCode(''); }}>
          <Search className="w-4 h-4 mr-2" aria-hidden />
          {t('parcelsList.trackByCode')}
        </Button>
      </div>

      <ErrorAlert error={error || actionErr} icon />

      <DataTableMaster<Parcel>
        columns={columns}
        data={parcels ?? []}
        loading={loading}
        rowActions={rowActions}
        bulkActions={bulkActions}
        onRowClick={openDetail}
        defaultSort={{ key: 'createdAt', dir: 'desc' }}
        exportFormats={['csv', 'xls']}
        exportFilename="colis"
        emptyMessage={t('parcelsList.noParcels')}
        searchPlaceholder={t('parcelsList.searchPlaceholder')}
      />

      {/* Detail dialog */}
      <Dialog
        open={detailOpen}
        onOpenChange={o => { if (!o) setDetailOpen(false); }}
        title={detail?.trackingCode ?? ''}
        description={`${t('parcelsList.parcelDetail')} — ${detail?.status ?? ''}`}
        size="lg"
      >
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{t('parcelsList.status')}</p>
                <Badge variant={statusToVariant(detail.status)}>{detail.status}</Badge>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{t('parcelsList.destination')}</p>
                <p>{detail.destination ? `${detail.destination.name} — ${detail.destination.city}` : '—'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{t('parcelsList.weight')}</p>
                <p className="tabular-nums">{detail.weight} kg</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{t('parcelsList.value')}</p>
                <p className="tabular-nums">{detail.price.toLocaleString('fr-FR')} XAF</p>
              </div>
              {detail.recipientInfo?.name && (
                <div className="col-span-2">
                  <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{t('parcelsList.recipient')}</p>
                  <p>{detail.recipientInfo.name} {detail.recipientInfo.phone && `· ${detail.recipientInfo.phone}`}</p>
                  {detail.recipientInfo.address && <p className="text-xs text-slate-500">{detail.recipientInfo.address}</p>}
                </div>
              )}
              {detail.shipment && (
                <div className="col-span-2">
                  <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{t('parcelsList.shipment')}</p>
                  <p className="text-xs tabular-nums">Shipment {detail.shipment.id.slice(0, 8)} · {detail.shipment.status}</p>
                </div>
              )}
            </div>

            {/* Action buttons */}
            {(ACTION_MAP[detail.status] ?? []).length > 0 && (
              <div className="flex gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                {(ACTION_MAP[detail.status] ?? []).map(a => (
                  <Button key={a.action} size="sm" disabled={actionBusy}
                    onClick={() => doTransition(detail.id, a.action)}>
                    {a.icon}
                    <span className="ml-1.5">{t(a.labelKey)}</span>
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </Dialog>

      {/* Tracking dialog */}
      <Dialog
        open={trackOpen}
        onOpenChange={o => { if (!o) setTrackOpen(false); }}
        title={t('parcelsList.trackByCode')}
        description={t('parcelsList.trackDesc')}
      >
        <div className="space-y-4">
          <form onSubmit={doTrack} className="flex gap-2">
            <input type="text" value={trackCode}
              onChange={e => setTrackCode(e.target.value.toUpperCase())}
              className={inp} placeholder="Ex. TENA-MXYZ-AB12"
              disabled={trackBusy} />
            <Button type="submit" disabled={trackBusy || !trackCode.trim()}>
              <Search className="w-4 h-4 mr-1.5" aria-hidden />
              {trackBusy ? t('parcelsList.searching') : t('ui.search')}
            </Button>
          </form>
          <ErrorAlert error={trackErr} />
          {trackResult && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm tabular-nums">{trackResult.trackingCode}</span>
                <Badge variant={statusToVariant(trackResult.status)}>{trackResult.status}</Badge>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {trackResult.destination ? `${trackResult.destination.name} — ${trackResult.destination.city}` : '—'}
              </p>
              <p className="text-xs text-slate-500 tabular-nums">{trackResult.weight} kg · {trackResult.price.toLocaleString('fr-FR')} XAF</p>
            </div>
          )}
        </div>
      </Dialog>

      {/* Hidden print container — génération hors-viewport puis impression */}
      <div style={{ position: 'fixed', left: -9999, top: 0, width: 560 }} aria-hidden>
        <div ref={singleLabelRef}>
          {labelTarget && <ParcelLabel parcel={labelTarget} />}
        </div>
        <div ref={bulkLabelsRef} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {bulkLabelTargets.map(p => (
            <ParcelLabel key={p.id} parcel={p} />
          ))}
        </div>
      </div>

      {/* Damage dialog */}
      <Dialog
        open={damageOpen}
        onOpenChange={o => { if (!o) setDamageOpen(false); }}
        title={t('parcelsList.reportDamage')}
        description={t('parcelsList.damageDialogDesc')}
      >
        <form onSubmit={(e) => { e.preventDefault(); void handleDamage(); }} className="space-y-4">
          <ErrorAlert error={damageErr} />
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('parcelsList.damageDesc')} <span aria-hidden className="text-red-500">*</span>
            </label>
            <textarea required rows={4} value={damageText}
              onChange={e => setDamageText(e.target.value)}
              className={inp} disabled={damageBusy}
              placeholder={t('parcelsList.damagePlaceholder')} />
          </div>
          <FormFooter onCancel={() => setDamageOpen(false)} busy={damageBusy}
            submitLabel={t('parcelsList.report')} pendingLabel={t('parcelsList.sending')} />
        </form>
      </Dialog>

      <ParcelHubActionsDialog
        open={!!hubTarget}
        onClose={() => setHubTarget(null)}
        onDone={refetch}
        tenantId={tenantId}
        parcel={hubTarget ? {
          id: hubTarget.id,
          trackingCode: hubTarget.trackingCode,
          status: hubTarget.status,
        } : null}
      />
    </main>
  );
}
