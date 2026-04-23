/**
 * PageFleetTracking — « Suivi Carburant & Kilométrage »
 *
 * Deux sections visibles simultanément pour un véhicule sélectionné :
 *   - Section A — Carburant : KPIs (conso moyenne, total litres, total coût)
 *     + formulaire "Ajouter plein" + DataTableMaster des fuel logs
 *   - Section B — Kilométrage : formulaire "Nouveau relevé" + DataTableMaster
 *
 * API :
 *   GET    /api/tenants/:tid/fleet/buses                       (sélecteur)
 *   POST   /api/tenants/:tid/fleet/tracking/fuel               (ajout plein)
 *   GET    /api/tenants/:tid/fleet/tracking/fuel/:busId         (historique)
 *   GET    /api/tenants/:tid/fleet/tracking/fuel/:busId/stats   (stats conso)
 *   POST   /api/tenants/:tid/fleet/tracking/odometer            (ajout relevé)
 *   GET    /api/tenants/:tid/fleet/tracking/odometer/:busId     (historique)
 */

import { useState, useMemo, type FormEvent } from 'react';
import {
  Fuel, Plus, Gauge, Activity,
} from 'lucide-react';
import { useAuth }                         from '../../lib/auth/auth.context';
import { useFetch }                        from '../../lib/hooks/useFetch';
import { apiPost }                         from '../../lib/api';
import { useI18n }                     from '../../lib/i18n/useI18n';
import { Badge }                           from '../ui/Badge';
import { Button }                          from '../ui/Button';
import { Dialog }                          from '../ui/Dialog';
import { ErrorAlert }                      from '../ui/ErrorAlert';
import { FormFooter }                      from '../ui/FormFooter';
import { inputClass as inp }               from '../ui/inputClass';
import DataTableMaster, { type Column }    from '../DataTableMaster';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BusOption { id: string; plateNumber: string; model?: string | null; }

type FuelLogType = 'DIESEL' | 'PETROL' | 'ADBLUE';

interface FuelLogRow {
  id:           string;
  busId:        string;
  fuelType:     FuelLogType;
  quantityL:    number;
  pricePerL?:   number | null;
  totalCost?:   number | null;
  odometerKm?:  number | null;
  stationName?: string | null;
  fullTank?:    boolean | null;
  note?:        string | null;
  logDate:      string;
  createdAt:    string;
}

interface FuelStats {
  avgConsumptionPer100Km?: number | null;
  totalLitres:             number;
  totalCost:               number;
}

type OdometerSource = 'MANUAL' | 'TRIP' | 'MAINTENANCE' | 'GPS';

interface OdometerRow {
  id:          string;
  busId:       string;
  readingKm:   number;
  source?:     OdometerSource | null;
  note?:       string | null;
  readingDate: string;
  createdAt:   string;
}

// ─── Labels ───────────────────────────────────────────────────────────────────

const FUEL_TYPE_LABEL: Record<FuelLogType, string> = {
  DIESEL: 'fleetTracking.fuelDiesel',
  PETROL: 'fleetTracking.fuelPetrol',
  ADBLUE: 'fleetTracking.fuelAdblue',
};

const FUEL_TYPE_VARIANT: Record<FuelLogType, 'default' | 'success' | 'warning'> = {
  DIESEL: 'default',
  PETROL: 'warning',
  ADBLUE: 'success',
};

const SOURCE_LABEL: Record<OdometerSource, string> = {
  MANUAL:      'fleetTracking.sourceManual',
  TRIP:        'fleetTracking.sourceTrip',
  MAINTENANCE: 'fleetTracking.sourceMaintenance',
  GPS:         'fleetTracking.sourceGps',
};

const SOURCE_VARIANT: Record<OdometerSource, 'default' | 'success' | 'warning' | 'danger'> = {
  MANUAL:      'default',
  TRIP:        'success',
  MAINTENANCE: 'warning',
  GPS:         'success',
};

// ─── Fuel columns ─────────────────────────────────────────────────────────────

function buildFuelColumns(t: (keyOrMap: string | Record<string, string | undefined>) => string): Column<FuelLogRow>[] {
  return [
    {
      key: 'logDate',
      header: t('fleetTracking.colDate'),
      sortable: true,
      cellRenderer: (v) => (
        <span className="text-sm text-slate-700 dark:text-slate-300 tabular-nums">
          {new Date(v as string).toLocaleDateString('fr-FR')}
        </span>
      ),
      csvValue: (v) => new Date(v as string).toLocaleDateString('fr-FR'),
    },
    {
      key: 'fuelType',
      header: t('fleetTracking.colType'),
      sortable: true,
      cellRenderer: (v) => (
        <Badge variant={FUEL_TYPE_VARIANT[v as FuelLogType]} size="sm">
          {t(FUEL_TYPE_LABEL[v as FuelLogType])}
        </Badge>
      ),
      csvValue: (v) => t(FUEL_TYPE_LABEL[v as FuelLogType]),
    },
    {
      key: 'quantityL',
      header: t('fleetTracking.colQuantity'),
      sortable: true,
      align: 'right',
      cellRenderer: (v) => (
        <span className="text-sm text-slate-700 dark:text-slate-300 tabular-nums">
          {(v as number).toLocaleString('fr-FR', { minimumFractionDigits: 1 })} L
        </span>
      ),
      csvValue: (v) => String(v),
    },
    {
      key: 'pricePerL',
      header: t('fleetTracking.colPricePerL'),
      sortable: true,
      align: 'right',
      cellRenderer: (v) => (
        <span className="text-sm text-slate-600 dark:text-slate-400 tabular-nums">
          {v != null ? `${(v as number).toLocaleString('fr-FR')} F` : '\u2014'}
        </span>
      ),
      csvValue: (v) => (v != null ? String(v) : ''),
    },
    {
      key: 'totalCost',
      header: t('fleetTracking.colTotal'),
      sortable: true,
      align: 'right',
      cellRenderer: (v) => (
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300 tabular-nums">
          {v != null ? `${(v as number).toLocaleString('fr-FR')} F` : '\u2014'}
        </span>
      ),
      csvValue: (v) => (v != null ? String(v) : ''),
    },
    {
      key: 'odometerKm',
      header: t('fleetTracking.colKm'),
      sortable: true,
      align: 'right',
      cellRenderer: (v) => (
        <span className="text-sm text-slate-600 dark:text-slate-400 tabular-nums">
          {v != null ? `${(v as number).toLocaleString('fr-FR')} km` : '\u2014'}
        </span>
      ),
      csvValue: (v) => (v != null ? String(v) : ''),
    },
    {
      key: 'stationName',
      header: t('fleetTracking.colStation'),
      sortable: true,
      cellRenderer: (v) => (
        <span className="text-sm text-slate-600 dark:text-slate-400">
          {(v as string | null) ?? '\u2014'}
        </span>
      ),
      csvValue: (v) => (v as string | null) ?? '',
    },
  ];
}

// ─── Odometer columns ─────────────────────────────────────────────────────────

function buildOdometerColumns(t: (keyOrMap: string | Record<string, string | undefined>) => string): Column<OdometerRow>[] {
  return [
    {
      key: 'readingDate',
      header: t('fleetTracking.colDate'),
      sortable: true,
      cellRenderer: (v) => (
        <span className="text-sm text-slate-700 dark:text-slate-300 tabular-nums">
          {new Date(v as string).toLocaleDateString('fr-FR')}
        </span>
      ),
      csvValue: (v) => new Date(v as string).toLocaleDateString('fr-FR'),
    },
    {
      key: 'readingKm',
      header: t('fleetTracking.colMileage'),
      sortable: true,
      align: 'right',
      cellRenderer: (v) => (
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300 tabular-nums">
          {(v as number).toLocaleString('fr-FR')} km
        </span>
      ),
      csvValue: (v) => String(v),
    },
    {
      key: 'source',
      header: t('fleetTracking.colSource'),
      sortable: true,
      cellRenderer: (v) => {
        const s = v as OdometerSource | null;
        return s
          ? <Badge variant={SOURCE_VARIANT[s]} size="sm">{t(SOURCE_LABEL[s])}</Badge>
          : <span className="text-sm text-slate-500">{'\u2014'}</span>;
      },
      csvValue: (v) => {
        const s = v as OdometerSource | null;
        return s ? t(SOURCE_LABEL[s]) : '';
      },
    },
    {
      key: 'note',
      header: t('fleetTracking.colNote'),
      cellRenderer: (v) => (
        <span className="text-sm text-slate-500 dark:text-slate-400 truncate max-w-[200px] block">
          {(v as string | null) ?? '\u2014'}
        </span>
      ),
      csvValue: (v) => (v as string | null) ?? '',
    },
  ];
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function Kpi({
  label, value, unit, icon, tone = 'default',
}: {
  label: string; value: string; unit?: string; icon: React.ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const toneClass = {
    default: 'bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400',
    success: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    warning: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
    danger:  'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
  }[tone];
  return (
    <article
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center gap-3"
      aria-label={`${label}: ${value}`}
    >
      <div className={`p-2.5 rounded-lg shrink-0 ${toneClass}`} aria-hidden>{icon}</div>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        <p className="text-xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">
          {value}{unit && <span className="text-sm font-normal text-slate-500 ml-1">{unit}</span>}
        </p>
      </div>
    </article>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function PageFleetTracking() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/tenants/${tenantId}/fleet`;

  // ── Bus selector ────────────────────────────────────────────────────────
  const { data: buses } = useFetch<BusOption[]>(
    tenantId ? `${base}/buses` : null, [tenantId],
  );

  const [selectedBusId, setSelectedBusId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('busId') ?? '';
  });

  const selectedBus = useMemo(
    () => (buses ?? []).find(b => b.id === selectedBusId) ?? null,
    [buses, selectedBusId],
  );

  // ── Data fetching (only when bus selected) ──────────────────────────────
  const trackBase = `${base}/tracking`;

  const { data: fuelLogs, loading: fuelLoading, error: fuelError, refetch: refetchFuel } =
    useFetch<FuelLogRow[]>(
      selectedBusId ? `${trackBase}/fuel/${selectedBusId}` : null,
      [selectedBusId],
    );

  const { data: fuelStats, refetch: refetchStats } =
    useFetch<FuelStats>(
      selectedBusId ? `${trackBase}/fuel/${selectedBusId}/stats` : null,
      [selectedBusId],
    );

  const { data: odoReadings, loading: odoLoading, error: odoError, refetch: refetchOdo } =
    useFetch<OdometerRow[]>(
      selectedBusId ? `${trackBase}/odometer/${selectedBusId}` : null,
      [selectedBusId],
    );

  // ── Fuel dialog ─────────────────────────────────────────────────────────
  const [showFuelDialog, setShowFuelDialog] = useState(false);
  const [fuelBusy, setFuelBusy]             = useState(false);
  const [fuelFormErr, setFuelFormErr]        = useState<string | null>(null);

  const [fuelForm, setFuelForm] = useState({
    fuelType: 'DIESEL' as FuelLogType,
    quantityL: '',
    pricePerL: '',
    totalCost: '',
    odometerKm: '',
    stationName: '',
    fullTank: false,
    note: '',
  });

  const resetFuelForm = () => setFuelForm({
    fuelType: 'DIESEL', quantityL: '', pricePerL: '', totalCost: '',
    odometerKm: '', stationName: '', fullTank: false, note: '',
  });

  const handleFuelSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFuelBusy(true); setFuelFormErr(null);
    try {
      const numOrUndef = (v: string) => v ? Number(v) : undefined;
      await apiPost(`${trackBase}/fuel`, {
        busId:       selectedBusId,
        fuelType:    fuelForm.fuelType,
        quantityL:   Number(fuelForm.quantityL),
        pricePerL:   numOrUndef(fuelForm.pricePerL),
        totalCost:   numOrUndef(fuelForm.totalCost),
        odometerKm:  numOrUndef(fuelForm.odometerKm),
        stationName: fuelForm.stationName.trim() || undefined,
        fullTank:    fuelForm.fullTank || undefined,
        note:        fuelForm.note.trim() || undefined,
      });
      setShowFuelDialog(false);
      resetFuelForm();
      refetchFuel();
      refetchStats();
    } catch (err) { setFuelFormErr((err as Error).message); }
    finally { setFuelBusy(false); }
  };

  // ── Odometer dialog ─────────────────────────────────────────────────────
  const [showOdoDialog, setShowOdoDialog] = useState(false);
  const [odoBusy, setOdoBusy]             = useState(false);
  const [odoFormErr, setOdoFormErr]        = useState<string | null>(null);

  const [odoForm, setOdoForm] = useState({
    readingKm: '',
    source: 'MANUAL' as OdometerSource,
    note: '',
  });

  const resetOdoForm = () => setOdoForm({ readingKm: '', source: 'MANUAL', note: '' });

  const handleOdoSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setOdoBusy(true); setOdoFormErr(null);
    try {
      await apiPost(`${trackBase}/odometer`, {
        busId:     selectedBusId,
        readingKm: Number(odoForm.readingKm),
        source:    odoForm.source,
        note:      odoForm.note.trim() || undefined,
      });
      setShowOdoDialog(false);
      resetOdoForm();
      refetchOdo();
    } catch (err) { setOdoFormErr((err as Error).message); }
    finally { setOdoBusy(false); }
  };

  // ── KPI values ──────────────────────────────────────────────────────────
  const avgConso = fuelStats?.avgConsumptionPer100Km;
  const totalL   = fuelStats?.totalLitres ?? 0;
  const totalC   = fuelStats?.totalCost ?? 0;

  // ── Column memos ────────────────────────────────────────────────────────
  const fuelColumns = useMemo(() => buildFuelColumns(t), [t]);
  const odometerColumns = useMemo(() => buildOdometerColumns(t), [t]);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <main className="p-6 space-y-6" role="main" aria-label={t('fleetTracking.pageTitle')}>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
            <Fuel className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              {t('fleetTracking.pageTitle')}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {t('fleetTracking.pageSubtitle')}
            </p>
          </div>
        </div>
      </div>

      {/* Bus selector */}
      <div className="flex items-center gap-3">
        <label htmlFor="bus-select"
          className="text-sm font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
          {t('fleetTracking.vehicleLabel')}
        </label>
        <select
          id="bus-select"
          value={selectedBusId}
          onChange={e => setSelectedBusId(e.target.value)}
          className={`${inp} max-w-md`}
        >
          <option value="">{t('fleetTracking.selectVehicle')}</option>
          {(buses ?? []).map(b => (
            <option key={b.id} value={b.id}>
              {b.plateNumber}{b.model ? ` — ${b.model}` : ''}
            </option>
          ))}
        </select>
      </div>

      {!selectedBusId && (
        <p className="text-center text-slate-500 dark:text-slate-400 py-12 text-sm">
          {t('fleetTracking.selectPrompt')}
        </p>
      )}

      {selectedBusId && (
        <>
          {/* ── Section A — Carburant ────────────────────────────────────── */}
          <section className="space-y-4" aria-label={t('fleetTracking.fuelSection')}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <Fuel className="w-5 h-5 text-amber-500" aria-hidden />
                {t('fleetTracking.fuelSection')}
              </h2>
              <Button onClick={() => { setFuelFormErr(null); setShowFuelDialog(true); }}>
                <Plus className="w-4 h-4 mr-2" aria-hidden />
                {t('fleetTracking.addFillUp')}
              </Button>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" aria-label={t('fleetTracking.fuelSection')}>
              <Kpi
                label={t('fleetTracking.avgConsumption')}
                value={avgConso != null ? avgConso.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : '\u2014'}
                unit={avgConso != null ? 'L/100km' : undefined}
                icon={<Activity className="w-5 h-5" />}
                tone="warning"
              />
              <Kpi
                label={t('fleetTracking.totalLitres')}
                value={totalL.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}
                unit="L"
                icon={<Fuel className="w-5 h-5" />}
              />
              <Kpi
                label={t('fleetTracking.totalCost')}
                value={totalC.toLocaleString('fr-FR')}
                unit="F"
                icon={<Gauge className="w-5 h-5" />}
                tone="danger"
              />
            </div>

            <ErrorAlert error={fuelError} icon />

            <DataTableMaster<FuelLogRow>
              columns={fuelColumns}
              data={fuelLogs ?? []}
              loading={fuelLoading}
              defaultSort={{ key: 'logDate', dir: 'desc' }}
              defaultPageSize={25}
              searchPlaceholder={t('fleetTracking.searchFuel')}
              emptyMessage={t('fleetTracking.noFuelLog')}
              exportFormats={['csv', 'json', 'xls', 'pdf']}
              exportFilename={`carburant-${selectedBus?.plateNumber ?? 'bus'}`}
              stickyHeader
            />
          </section>

          {/* ── Section B — Kilométrage ──────────────────────────────────── */}
          <section className="space-y-4" aria-label={t('fleetTracking.odometerSection')}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <Gauge className="w-5 h-5 text-blue-500" aria-hidden />
                {t('fleetTracking.odometerSection')}
              </h2>
              <Button onClick={() => { setOdoFormErr(null); setShowOdoDialog(true); }}>
                <Plus className="w-4 h-4 mr-2" aria-hidden />
                {t('fleetTracking.newReading')}
              </Button>
            </div>

            <ErrorAlert error={odoError} icon />

            <DataTableMaster<OdometerRow>
              columns={odometerColumns}
              data={odoReadings ?? []}
              loading={odoLoading}
              defaultSort={{ key: 'readingDate', dir: 'desc' }}
              defaultPageSize={25}
              searchPlaceholder={t('fleetTracking.searchOdometer')}
              emptyMessage={t('fleetTracking.noOdometerReading')}
              exportFormats={['csv', 'json']}
              exportFilename={`odometer-${selectedBus?.plateNumber ?? 'bus'}`}
              stickyHeader
            />
          </section>
        </>
      )}

      {/* ── Dialog : Ajouter un plein ────────────────────────────────────── */}
      <Dialog
        open={showFuelDialog}
        onOpenChange={o => { if (!o) { setShowFuelDialog(false); resetFuelForm(); } }}
        title={t('fleetTracking.addFillUpTitle')}
        description={selectedBus ? `${t('fleetTracking.vehicleLabel')} ${selectedBus.plateNumber}` : ''}
        size="md"
      >
        <form onSubmit={handleFuelSubmit} className="space-y-4">
          <ErrorAlert error={fuelFormErr} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Fuel type */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('fleetTracking.colType')} <span aria-hidden className="text-red-500">*</span>
              </label>
              <select required value={fuelForm.fuelType}
                onChange={e => setFuelForm(f => ({ ...f, fuelType: e.target.value as FuelLogType }))}
                className={inp} disabled={fuelBusy}>
                {(Object.keys(FUEL_TYPE_LABEL) as FuelLogType[]).map(k => (
                  <option key={k} value={k}>{t(FUEL_TYPE_LABEL[k])}</option>
                ))}
              </select>
            </div>

            {/* Quantity */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('fleetTracking.quantityL')} <span aria-hidden className="text-red-500">*</span>
              </label>
              <input type="number" min={0.1} step="0.1" required
                value={fuelForm.quantityL}
                onChange={e => setFuelForm(f => ({ ...f, quantityL: e.target.value }))}
                className={inp} disabled={fuelBusy} placeholder="120" />
            </div>

            {/* Price per L */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('fleetTracking.pricePerL')}
              </label>
              <input type="number" min={0} step="0.01"
                value={fuelForm.pricePerL}
                onChange={e => setFuelForm(f => ({ ...f, pricePerL: e.target.value }))}
                className={inp} disabled={fuelBusy} placeholder="750" />
            </div>

            {/* Total cost */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('fleetTracking.totalCostF')}
              </label>
              <input type="number" min={0} step="1"
                value={fuelForm.totalCost}
                onChange={e => setFuelForm(f => ({ ...f, totalCost: e.target.value }))}
                className={inp} disabled={fuelBusy} placeholder="90000" />
            </div>

            {/* Odometer */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('fleetTracking.mileageKm')}
              </label>
              <input type="number" min={0} step="1"
                value={fuelForm.odometerKm}
                onChange={e => setFuelForm(f => ({ ...f, odometerKm: e.target.value }))}
                className={inp} disabled={fuelBusy} placeholder="125000" />
            </div>

            {/* Station */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('fleetTracking.station')}
              </label>
              <input type="text"
                value={fuelForm.stationName}
                onChange={e => setFuelForm(f => ({ ...f, stationName: e.target.value }))}
                className={inp} disabled={fuelBusy} placeholder={t('fleetTracking.stationPlaceholder')} />
            </div>
          </div>

          {/* Full tank checkbox */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox"
              checked={fuelForm.fullTank}
              onChange={e => setFuelForm(f => ({ ...f, fullTank: e.target.checked }))}
              disabled={fuelBusy}
              className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-teal-600 focus:ring-teal-500" />
            <span className="text-sm text-slate-700 dark:text-slate-300">{t('fleetTracking.fullTank')}</span>
          </label>

          {/* Note */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('fleetTracking.note')}
            </label>
            <input type="text"
              value={fuelForm.note}
              onChange={e => setFuelForm(f => ({ ...f, note: e.target.value }))}
              className={inp} disabled={fuelBusy} placeholder={t('fleetTracking.notePlaceholder')} />
          </div>

          <FormFooter
            onCancel={() => { setShowFuelDialog(false); resetFuelForm(); }}
            busy={fuelBusy}
            submitLabel={t('common.save')}
            pendingLabel={t('common.saving')}
          />
        </form>
      </Dialog>

      {/* ── Dialog : Nouveau relevé kilométrique ─────────────────────────── */}
      <Dialog
        open={showOdoDialog}
        onOpenChange={o => { if (!o) { setShowOdoDialog(false); resetOdoForm(); } }}
        title={t('fleetTracking.newReadingTitle')}
        description={selectedBus ? `${t('fleetTracking.vehicleLabel')} ${selectedBus.plateNumber}` : ''}
        size="sm"
      >
        <form onSubmit={handleOdoSubmit} className="space-y-4">
          <ErrorAlert error={odoFormErr} />

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('fleetTracking.readingKm')} <span aria-hidden className="text-red-500">*</span>
            </label>
            <input type="number" min={0} step="1" required
              value={odoForm.readingKm}
              onChange={e => setOdoForm(f => ({ ...f, readingKm: e.target.value }))}
              className={inp} disabled={odoBusy} placeholder="125500" />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('fleetTracking.source')}
            </label>
            <select value={odoForm.source}
              onChange={e => setOdoForm(f => ({ ...f, source: e.target.value as OdometerSource }))}
              className={inp} disabled={odoBusy}>
              {(Object.keys(SOURCE_LABEL) as OdometerSource[]).map(k => (
                <option key={k} value={k}>{t(SOURCE_LABEL[k])}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('fleetTracking.note')}
            </label>
            <input type="text"
              value={odoForm.note}
              onChange={e => setOdoForm(f => ({ ...f, note: e.target.value }))}
              className={inp} disabled={odoBusy} placeholder={t('fleetTracking.notePlaceholder')} />
          </div>

          <FormFooter
            onCancel={() => { setShowOdoDialog(false); resetOdoForm(); }}
            busy={odoBusy}
            submitLabel={t('common.save')}
            pendingLabel={t('common.saving')}
          />
        </form>
      </Dialog>
    </main>
  );
}
