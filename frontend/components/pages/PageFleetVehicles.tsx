/**
 * PageFleetVehicles — « Véhicules »
 *
 * CRUD flotte de bus. Source de vérité pour les plans de sièges et la
 * maintenance (les deux autres pages réutilisent la même liste).
 *
 * API :
 *   GET    /api/tenants/:tid/fleet/buses
 *   POST   /api/tenants/:tid/fleet/buses                 body: CreateBusDto
 *   PATCH  /api/tenants/:tid/fleet/buses/:id/status      body: { status }
 */

import { useMemo, useState, useEffect, type FormEvent } from 'react';
import { useNavigate }                     from 'react-router-dom';
import { FleetStatusHeader }               from '../dashboard/FleetStatusHeader';
import {
  Bus, Plus, Wrench, CheckCircle2, LayoutGrid, Power, Pencil, Trash2, FileText, X,
  Camera, Upload, ImageOff, ChevronDown, ChevronUp, Gauge, Coins, Sparkles,
} from 'lucide-react';
import { useAuth }                         from '../../lib/auth/auth.context';
import { useFetch }                        from '../../lib/hooks/useFetch';
import { apiGet, apiPost, apiPut, apiPatch, apiDelete, apiFetch } from '../../lib/api';
import { useI18n }                     from '../../lib/i18n/useI18n';
import { Badge }                           from '../ui/Badge';
import { Button }                          from '../ui/Button';
import { Dialog }                          from '../ui/Dialog';
import { ErrorAlert }                      from '../ui/ErrorAlert';
import { FormFooter }                      from '../ui/FormFooter';
import { inputClass as inp }               from '../ui/inputClass';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';
import { useTenantConfig }                 from '../../providers/TenantConfigProvider';

// ─── Types ────────────────────────────────────────────────────────────────────

type BusType   = 'STANDARD' | 'CONFORT' | 'VIP' | 'MINIBUS';
type BusStatus = 'AVAILABLE' | 'IN_SERVICE' | 'MAINTENANCE' | 'OFFLINE';
type FuelType  = 'DIESEL' | 'PETROL' | 'BIO_DIESEL' | 'HYBRID' | 'ELECTRIC';
type EngineType = 'EURO_3' | 'EURO_4' | 'EURO_5' | 'EURO_6';
type BusAmenity = 'WIFI' | 'AC' | 'TOILETS' | 'USB_CHARGING' | 'RECLINING_SEATS' | 'TV' | 'SNACK_BAR' | 'BLANKETS' | 'LUGGAGE_TRACKING';

const ALL_AMENITIES: BusAmenity[] = [
  'WIFI', 'AC', 'TOILETS', 'USB_CHARGING', 'RECLINING_SEATS',
  'TV', 'SNACK_BAR', 'BLANKETS', 'LUGGAGE_TRACKING',
];

const AMENITY_LABEL: Record<BusAmenity, string> = {
  WIFI:             'fleetVehicles.amenityWIFI',
  AC:               'fleetVehicles.amenityAC',
  TOILETS:          'fleetVehicles.amenityTOILETS',
  USB_CHARGING:     'fleetVehicles.amenityUSB_CHARGING',
  RECLINING_SEATS:  'fleetVehicles.amenityRECLINING_SEATS',
  TV:               'fleetVehicles.amenityTV',
  SNACK_BAR:        'fleetVehicles.amenitySNACK_BAR',
  BLANKETS:         'fleetVehicles.amenityBLANKETS',
  LUGGAGE_TRACKING: 'fleetVehicles.amenityLUGGAGE_TRACKING',
};

interface BusRow {
  id:                  string;
  tenantId:            string;
  plateNumber:         string;
  model?:              string | null;
  type?:               BusType | null;
  capacity:            number;
  status:              BusStatus;
  year?:               number | null;
  agencyId?:           string | null;
  seatLayout?:         Record<string, unknown> | null;
  vin?:                string | null;
  fuelType?:           FuelType | null;
  engineType?:         EngineType | null;
  fuelTankCapacityL?:  number | null;
  adBlueTankCapacityL?: number | null;
  luggageCapacityKg?:  number | null;
  luggageCapacityM3?:  number | null;
  registrationDate?:   string | null;
  purchaseDate?:       string | null;
  purchasePrice?:      number | null;
  initialOdometerKm?:  number | null;
  currentOdometerKm?:  number | null;
  fuelConsumptionPer100Km?:  number | null;
  adBlueConsumptionPer100Km?: number | null;
  amenities?:                BusAmenity[] | null;
}

interface AgencyRow { id: string; name: string; }

interface BusFormValues {
  plateNumber:         string;
  model:               string;
  type:                BusType;
  capacity:            string;
  year:                string;
  agencyId:            string;
  // Technique
  vin:                 string;
  fuelType:            string;
  engineType:          string;
  fuelTankCapacityL:   string;
  adBlueTankCapacityL: string;
  luggageCapacityKg:   string;
  luggageCapacityM3:   string;
  registrationDate:    string;
  purchaseDate:        string;
  purchasePrice:              string;
  initialOdometerKm:          string;
  fuelConsumptionPer100Km:    string;
  adBlueConsumptionPer100Km:  string;
  amenities:                  BusAmenity[];
}

const EMPTY_FORM: BusFormValues = {
  plateNumber: '', model: '', type: 'STANDARD', capacity: '50', year: '', agencyId: '',
  vin: '', fuelType: '', engineType: '', fuelTankCapacityL: '', adBlueTankCapacityL: '',
  luggageCapacityKg: '', luggageCapacityM3: '', registrationDate: '', purchaseDate: '',
  purchasePrice: '', initialOdometerKm: '',
  fuelConsumptionPer100Km: '', adBlueConsumptionPer100Km: '',
  amenities: [],
};

const STATUS_LABEL: Record<BusStatus, string> = {
  AVAILABLE:   'fleetVehicles.statusAvailable',
  IN_SERVICE:  'fleetVehicles.statusInService',
  MAINTENANCE: 'fleetVehicles.statusMaintenance',
  OFFLINE:     'fleetVehicles.statusOffline',
};

const STATUS_VARIANT: Record<BusStatus, 'success' | 'warning' | 'danger' | 'default'> = {
  AVAILABLE:   'success',
  IN_SERVICE:  'warning',
  MAINTENANCE: 'danger',
  OFFLINE:     'default',
};

const TYPE_LABEL: Record<BusType, string> = {
  STANDARD: 'fleetVehicles.typeStandard',
  CONFORT:  'fleetVehicles.typeConfort',
  VIP:      'fleetVehicles.typeVip',
  MINIBUS:  'fleetVehicles.typeMinibus',
};

const FUEL_TYPE_LABEL: Record<FuelType, string> = {
  DIESEL:     'fleetVehicles.fuelDiesel',
  PETROL:     'fleetVehicles.fuelPetrol',
  BIO_DIESEL: 'fleetVehicles.fuelBiodiesel',
  HYBRID:     'fleetVehicles.fuelHybrid',
  ELECTRIC:   'fleetVehicles.fuelElectric',
};

const ENGINE_TYPE_LABEL: Record<EngineType, string> = {
  EURO_3: 'fleetVehicles.engineEuro3',
  EURO_4: 'fleetVehicles.engineEuro4',
  EURO_5: 'fleetVehicles.engineEuro5',
  EURO_6: 'fleetVehicles.engineEuro6',
};

// ─── Formulaire ───────────────────────────────────────────────────────────────

function BusForm({
  agencies, initial, onSubmit, onCancel, busy, error, submitLabel, pendingLabel, currencyCode,
}: {
  agencies:     AgencyRow[];
  initial:      BusFormValues;
  onSubmit:     (v: BusFormValues) => void;
  onCancel:     () => void;
  busy:         boolean;
  error:        string | null;
  submitLabel:  string;
  pendingLabel: string;
  currencyCode: string;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<BusFormValues>(initial);
  const [showTech, setShowTech] = useState(false);
  const patch = (p: Partial<BusFormValues>) => setF(prev => ({ ...prev, ...p }));

  // Ouvrir les détails techniques si un champ technique est déjà rempli
  useEffect(() => {
    const hasTech = !!(f.vin || f.fuelType || f.engineType || f.fuelTankCapacityL ||
      f.adBlueTankCapacityL || f.luggageCapacityKg || f.luggageCapacityM3 ||
      f.registrationDate || f.purchaseDate || f.purchasePrice || f.initialOdometerKm);
    if (hasTech) setShowTech(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <form
      onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}
      className="space-y-4"
    >
      <ErrorAlert error={error} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="space-y-1.5 lg:col-span-2">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('fleetVehicles.registration')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="text" required value={f.plateNumber}
            onChange={e => patch({ plateNumber: e.target.value.toUpperCase() })}
            className={inp} disabled={busy} placeholder="KA-4421-B" />
        </div>
        <div className="space-y-1.5 lg:col-span-3">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('fleetVehicles.model')}
          </label>
          <input type="text" value={f.model}
            onChange={e => patch({ model: e.target.value })}
            className={inp} disabled={busy} placeholder="Yutong ZK6122H" />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('fleetVehicles.type')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <select required value={f.type}
            onChange={e => patch({ type: e.target.value as BusType })}
            className={inp} disabled={busy}>
            {(Object.keys(TYPE_LABEL) as BusType[]).map(k => (
              <option key={k} value={k}>{t(TYPE_LABEL[k])}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('fleetVehicles.capacity')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="number" min={1} required value={f.capacity}
            onChange={e => patch({ capacity: e.target.value })}
            className={inp} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('fleetVehicles.year')}
          </label>
          <input type="number" min={1980} max={2100} value={f.year}
            onChange={e => patch({ year: e.target.value })}
            className={inp} disabled={busy} placeholder="2020" />
        </div>
        <div className="space-y-1.5 lg:col-span-2">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('fleetVehicles.homeAgency')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <select required value={f.agencyId}
            onChange={e => patch({ agencyId: e.target.value })}
            className={inp} disabled={busy}>
            <option value="">{t('fleetVehicles.selectPlaceholder')}</option>
            {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>

      {/* ── Détails techniques (collapsible) ─────────────────────────────── */}
      <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
        <button type="button"
          onClick={() => setShowTech(!showTech)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800">
          <span className="flex items-center gap-2">
            <Wrench className="w-4 h-4 text-slate-400" aria-hidden />
            {t('fleetVehicles.technicalDetails')}
          </span>
          {showTech
            ? <ChevronUp className="w-4 h-4 text-slate-400" aria-hidden />
            : <ChevronDown className="w-4 h-4 text-slate-400" aria-hidden />}
        </button>

        {showTech && (
          <div className="px-4 py-4 space-y-4 border-t border-slate-200 dark:border-slate-700">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {t('fleetVehicles.chassisVin')}
                </label>
                <input type="text" value={f.vin}
                  onChange={e => patch({ vin: e.target.value.toUpperCase() })}
                  className={inp} disabled={busy} placeholder="1HGBH41JXMN109186" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {t('fleetVehicles.fuel')}
                </label>
                <select value={f.fuelType}
                  onChange={e => patch({ fuelType: e.target.value })}
                  className={inp} disabled={busy}>
                  <option value="">{t('fleetVehicles.notSpecified')}</option>
                  {(Object.keys(FUEL_TYPE_LABEL) as FuelType[]).map(k => (
                    <option key={k} value={k}>{t(FUEL_TYPE_LABEL[k])}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {t('fleetVehicles.engineStandard')}
                </label>
                <select value={f.engineType}
                  onChange={e => patch({ engineType: e.target.value })}
                  className={inp} disabled={busy}>
                  <option value="">{t('fleetVehicles.notSpecified')}</option>
                  {(Object.keys(ENGINE_TYPE_LABEL) as EngineType[]).map(k => (
                    <option key={k} value={k}>{t(ENGINE_TYPE_LABEL[k])}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {t('fleetVehicles.fuelTank')}
                </label>
                <input type="number" min={0} step="0.1" value={f.fuelTankCapacityL}
                  onChange={e => patch({ fuelTankCapacityL: e.target.value })}
                  className={inp} disabled={busy} placeholder="300" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {t('fleetVehicles.adBlueTank')}
                </label>
                <input type="number" min={0} step="0.1" value={f.adBlueTankCapacityL}
                  onChange={e => patch({ adBlueTankCapacityL: e.target.value })}
                  className={inp} disabled={busy} placeholder="40" />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {t('fleetVehicles.luggageKg')}
                </label>
                <input type="number" min={0} step="0.1" value={f.luggageCapacityKg}
                  onChange={e => patch({ luggageCapacityKg: e.target.value })}
                  className={inp} disabled={busy} placeholder="500" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {t('fleetVehicles.luggageM3')}
                </label>
                <input type="number" min={0} step="0.1" value={f.luggageCapacityM3}
                  onChange={e => patch({ luggageCapacityM3: e.target.value })}
                  className={inp} disabled={busy} placeholder="8" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {t('fleetVehicles.firstRegistrationDate')}
                </label>
                <input type="date" value={f.registrationDate}
                  onChange={e => patch({ registrationDate: e.target.value })}
                  className={inp} disabled={busy} />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {t('fleetVehicles.purchaseDate')}
                </label>
                <input type="date" value={f.purchaseDate}
                  onChange={e => patch({ purchaseDate: e.target.value })}
                  className={inp} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {t('fleetVehicles.purchasePrice')} ({currencyCode})
                </label>
                <input type="number" min={0} value={f.purchasePrice}
                  onChange={e => patch({ purchasePrice: e.target.value })}
                  className={inp} disabled={busy} placeholder="45 000 000" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {t('fleetVehicles.initialMileage')}
                </label>
                <input type="number" min={0} value={f.initialOdometerKm}
                  onChange={e => patch({ initialOdometerKm: e.target.value })}
                  className={inp} disabled={busy} placeholder="0" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {t('fleetVehicles.fuelConsumption')}
                </label>
                <input type="number" min={0} step="0.1" value={f.fuelConsumptionPer100Km}
                  onChange={e => patch({ fuelConsumptionPer100Km: e.target.value })}
                  className={inp} disabled={busy} placeholder="35" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {t('fleetVehicles.adBlueConsumption')}
                </label>
                <input type="number" min={0} step="0.01" value={f.adBlueConsumptionPer100Km}
                  onChange={e => patch({ adBlueConsumptionPer100Km: e.target.value })}
                  className={inp} disabled={busy} placeholder="1.75" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Commodités (checkboxes) ──────────────────────���───────────── */}
      <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
        <div className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50">
          <span className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-slate-400" aria-hidden />
            {t('fleetVehicles.amenities')}
          </span>
          {f.amenities.length > 0 && (
            <span className="text-xs text-teal-600 dark:text-teal-400 font-semibold">{f.amenities.length}</span>
          )}
        </div>
        <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-3 gap-2 border-t border-slate-200 dark:border-slate-700">
          {ALL_AMENITIES.map(a => (
            <label key={a} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={f.amenities.includes(a)}
                onChange={e => {
                  const next = e.target.checked
                    ? [...f.amenities, a]
                    : f.amenities.filter(x => x !== a);
                  patch({ amenities: next });
                }}
                disabled={busy}
                className="rounded border-slate-300 dark:border-slate-600 text-teal-600 focus:ring-teal-500"
              />
              {t(AMENITY_LABEL[a])}
            </label>
          ))}
        </div>
      </div>

      <FormFooter onCancel={onCancel} busy={busy}
        submitLabel={submitLabel} pendingLabel={pendingLabel} />
    </form>
  );
}

// ─── Gestionnaire de photos ───────────────────────────────────────────────────

interface PhotoItem { fileKey: string; url: string; expiresAt: string; }

function BusPhotoManager({ tenantId, busId }: { tenantId: string; busId: string }) {
  const { t } = useI18n();
  const base = `/api/tenants/${tenantId}/fleet/buses/${busId}/photos`;
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const reload = async () => {
    setLoading(true); setErr(null);
    try { setPhotos(await apiGet<PhotoItem[]>(base)); }
    catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [busId]);

  const handleFile = async (file: File) => {
    setUploading(true); setErr(null);
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const { uploadUrl, fileKey } = await apiPost<{ uploadUrl: string; fileKey: string }>(
        `${base}/upload-url`, { ext },
      );
      const put = await fetch(uploadUrl, {
        method: 'PUT',
        body:   file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      if (!put.ok) throw new Error(`Upload échoué (${put.status})`);
      await apiPost(base, { fileKey });
      await reload();
    } catch (e) { setErr((e as Error).message); }
    finally { setUploading(false); }
  };

  const handleDelete = async (fileKey: string) => {
    setErr(null);
    try {
      await apiFetch(base, { method: 'DELETE', body: { fileKey } });
      await reload();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            {t('fleetVehicles.vehiclePhotos')}
          </h3>
          <span className="text-xs text-slate-500">({photos.length})</span>
        </div>
        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 hover:bg-teal-100 dark:hover:bg-teal-900/50 cursor-pointer">
          <Upload className="w-3.5 h-3.5" aria-hidden />
          {uploading ? t('fleetVehicles.uploading') : t('fleetVehicles.addPhoto')}
          <input type="file" accept="image/jpeg,image/png,image/webp"
            className="hidden" disabled={uploading}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
        </label>
      </div>

      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}

      {loading ? (
        <p className="text-xs text-slate-500">{t('fleetVehicles.loadingPhotos')}</p>
      ) : photos.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 py-3">
          <ImageOff className="w-4 h-4" aria-hidden />
          {t('fleetVehicles.noPhotos')}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {photos.map(p => (
            <div key={p.fileKey}
              className="relative group aspect-video rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
              <img src={p.url} alt={t('fleetVehicles.photoAlt')}
                className="w-full h-full object-cover" loading="lazy" />
              <button type="button"
                onClick={() => handleDelete(p.fileKey)}
                aria-label={t('fleetVehicles.deletePhoto')}
                className="absolute top-1 right-1 p-1 rounded-md bg-red-600/90 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-700">
                <Trash2 className="w-3 h-3" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Profil de coûts ─────────────────────────────────────────────────────────

interface BusCostProfile {
  fuelConsumptionPer100Km: number;
  fuelPricePerLiter: number;
  adBlueCostPerLiter: number;
  adBlueRatioFuel: number;
  maintenanceCostPerKm: number;
  stationFeePerDeparture: number;
  driverAllowancePerTrip: number;
  tollFeesPerTrip: number;
  driverMonthlySalary: number;
  annualInsuranceCost: number;
  monthlyAgencyFees: number;
  purchasePrice: number;
  depreciationYears: number;
  residualValue: number;
  avgTripsPerMonth: number;
}

const COST_DEFAULTS: BusCostProfile = {
  fuelConsumptionPer100Km: 0,
  fuelPricePerLiter: 0,
  adBlueCostPerLiter: 0.18,
  adBlueRatioFuel: 0.05,
  maintenanceCostPerKm: 0.05,
  stationFeePerDeparture: 0,
  driverAllowancePerTrip: 0,
  tollFeesPerTrip: 0,
  driverMonthlySalary: 0,
  annualInsuranceCost: 0,
  monthlyAgencyFees: 0,
  purchasePrice: 0,
  depreciationYears: 10,
  residualValue: 0,
  avgTripsPerMonth: 30,
};

function BusCostProfileSection({ tenantId, busId, busHints }: {
  tenantId: string;
  busId: string;
  /** Valeurs du formulaire véhicule — pré-remplissage automatique si le profil n'a pas encore ces champs. */
  busHints?: { fuelConsumptionPer100Km?: number; purchasePrice?: number };
}) {
  const { t } = useI18n();
  const base = `/api/v1/tenants/${tenantId}/buses/${busId}/cost-profile`;
  const [form, setForm] = useState<BusCostProfile>({ ...COST_DEFAULTS });
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      try {
        const data = await apiGet<BusCostProfile | null>(base);
        if (!cancelled) {
          if (data) {
            // Sync depuis les données véhicule si le profil a des valeurs à 0
            const synced = { ...data };
            if (busHints?.fuelConsumptionPer100Km && !synced.fuelConsumptionPer100Km) {
              synced.fuelConsumptionPer100Km = busHints.fuelConsumptionPer100Km;
            }
            if (busHints?.purchasePrice && !synced.purchasePrice) {
              synced.purchasePrice = busHints.purchasePrice;
            }
            setForm(synced);
            setConfigured(true);
          } else {
            // Profil non configuré — pré-remplir depuis la fiche véhicule
            setForm({
              ...COST_DEFAULTS,
              fuelConsumptionPer100Km: busHints?.fuelConsumptionPer100Km ?? 0,
              purchasePrice:           busHints?.purchasePrice ?? 0,
            });
            setConfigured(false);
          }
        }
      } catch (e: unknown) {
        if (!cancelled) setErr((e as Error).message);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busId]);

  const patch = (p: Partial<BusCostProfile>) => {
    setForm(prev => ({ ...prev, ...p }));
    setSuccess(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null); setSuccess(false);
    try {
      await apiPut(base, form);
      setConfigured(true);
      setSuccess(true);
    } catch (ex) { setErr((ex as Error).message); }
    finally { setSaving(false); }
  };

  const numField = (
    key: keyof BusCostProfile,
    label: string,
    required = false,
    step = 'any' as string,
  ) => (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        type="number"
        step={step}
        min={0}
        value={form[key]}
        onChange={e => patch({ [key]: e.target.value === '' ? 0 : Number(e.target.value) })}
        className={inp}
        disabled={saving}
        required={required}
      />
    </div>
  );

  return (
    <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <Coins className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            {t('fleetVehicles.costProfile')}
          </h3>
          {loading ? (
            <span className="text-xs text-slate-500">…</span>
          ) : configured ? (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
              {t('fleetVehicles.configured')}
            </span>
          ) : (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
              {t('fleetVehicles.notConfigured')}
            </span>
          )}
        </div>
        {open
          ? <ChevronUp className="w-4 h-4 text-slate-400" aria-hidden />
          : <ChevronDown className="w-4 h-4 text-slate-400" aria-hidden />}
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="space-y-5">
          {err && <ErrorAlert error={err} />}

          {/* Groupe 1 — Consommation */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t('fleetVehicles.consumption')}
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {numField('fuelConsumptionPer100Km', t('fleetVehicles.fuelConsumptionLabel'), true)}
              {numField('fuelPricePerLiter', t('fleetVehicles.fuelPriceLabel'), true)}
              {numField('adBlueCostPerLiter', t('fleetVehicles.adBlueCostLabel'))}
              {numField('adBlueRatioFuel', t('fleetVehicles.adBlueRatioLabel'))}
            </div>
          </fieldset>

          {/* Groupe 2 — Coûts par trajet */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t('fleetVehicles.costPerTrip')}
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {numField('maintenanceCostPerKm', t('fleetVehicles.maintenancePerKm'))}
              {numField('stationFeePerDeparture', t('fleetVehicles.stationFee'))}
              {numField('driverAllowancePerTrip', t('fleetVehicles.driverAllowance'))}
              {numField('tollFeesPerTrip', t('fleetVehicles.tollFees'))}
            </div>
          </fieldset>

          {/* Groupe 3 — Charges fixes */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t('fleetVehicles.fixedCharges')}
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {numField('driverMonthlySalary', t('fleetVehicles.driverSalary'), true)}
              {numField('annualInsuranceCost', t('fleetVehicles.annualInsurance'), true)}
              {numField('monthlyAgencyFees', t('fleetVehicles.agencyFees'), true)}
            </div>
          </fieldset>

          {/* Groupe 4 — Amortissement */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t('fleetVehicles.depreciation')}
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {numField('purchasePrice', t('fleetVehicles.purchasePriceCost'), true)}
              {numField('depreciationYears', t('fleetVehicles.depreciationYears'))}
              {numField('residualValue', t('fleetVehicles.residualValue'))}
              {numField('avgTripsPerMonth', t('fleetVehicles.avgTripsPerMonth'))}
            </div>
          </fieldset>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? t('common.saving') : t('fleetVehicles.saveCostProfile')}
            </Button>
            {success && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">
                {t('fleetVehicles.costProfileSaved')} ✓
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

// ─── Colonnes DataTableMaster ─────────────────────────────────────────────────

function buildColumns(agencies: AgencyRow[], t: (k: string | Record<string, string | undefined>) => string): Column<BusRow>[] {
  const agencyName = (id?: string | null) =>
    id ? (agencies.find(a => a.id === id)?.name ?? '—') : '—';

  return [
    {
      key: 'plateNumber',
      header: t('fleetVehicles.registration'),
      sortable: true,
      cellRenderer: (_v, row) => (
        <div className="flex items-center gap-2 min-w-0">
          <Bus className="w-4 h-4 text-teal-500 shrink-0" aria-hidden />
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
            {row.plateNumber}
          </span>
        </div>
      ),
    },
    {
      key: 'model',
      header: t('fleetVehicles.model'),
      sortable: true,
      cellRenderer: (_v, row) => (
        <span className="text-sm text-slate-600 dark:text-slate-400">
          {row.model || '—'}
        </span>
      ),
    },
    {
      key: 'type',
      header: t('fleetVehicles.type'),
      sortable: true,
      cellRenderer: (v) => (
        <span className="text-sm text-slate-600 dark:text-slate-400">
          {v ? t(TYPE_LABEL[v as BusType]) : '—'}
        </span>
      ),
      csvValue: (v) => (v ? t(TYPE_LABEL[v as BusType]) : ''),
    },
    {
      key: 'amenities',
      header: t('fleetVehicles.amenities'),
      cellRenderer: (_v, row) => {
        const items = (row.amenities ?? []) as BusAmenity[];
        if (!items.length) return <span className="text-xs text-slate-400">—</span>;
        return (
          <div className="flex gap-1 flex-wrap">
            {items.slice(0, 3).map(a => (
              <span key={a} className="inline-flex items-center rounded-md bg-teal-50 dark:bg-teal-900/30 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 dark:text-teal-300">
                {t(AMENITY_LABEL[a])}
              </span>
            ))}
            {items.length > 3 && (
              <span className="text-[10px] text-slate-400">+{items.length - 3}</span>
            )}
          </div>
        );
      },
      csvValue: (_v, row) => ((row?.amenities ?? []) as BusAmenity[]).map(a => t(AMENITY_LABEL[a])).join(', '),
    },
    {
      key: 'capacity',
      header: t('fleetVehicles.capacity'),
      sortable: true,
      align: 'right',
      cellRenderer: (v) => (
        <span className="text-sm text-slate-600 dark:text-slate-400 tabular-nums">
          {v as number} {t('fleetVehicles.seats')}
        </span>
      ),
      csvValue: (v) => String(v),
    },
    {
      key: 'currentOdometerKm',
      header: t('fleetVehicles.mileageKm'),
      sortable: true,
      align: 'right',
      cellRenderer: (v) => (
        <span className="text-sm text-slate-600 dark:text-slate-400 tabular-nums">
          {v != null ? `${(v as number).toLocaleString('fr-FR')} km` : '—'}
        </span>
      ),
      csvValue: (v) => (v != null ? String(v) : ''),
    },
    {
      key: 'agencyId',
      header: t('fleetVehicles.agency'),
      sortable: true,
      cellRenderer: (v) => (
        <span className="text-sm text-slate-600 dark:text-slate-400">
          {agencyName(v as string | null)}
        </span>
      ),
      csvValue: (v) => agencyName(v as string | null),
    },
    {
      key: 'seatLayout',
      header: t('fleetVehicles.plan'),
      cellRenderer: (v) =>
        v
          ? <Badge variant="success" size="sm">{t('fleetVehicles.planConfigured')}</Badge>
          : <Badge variant="warning" size="sm">{t('fleetVehicles.planMissing')}</Badge>,
      csvValue: (v) => (v ? t('fleetVehicles.planConfigured') : t('fleetVehicles.planMissing')),
    },
    {
      key: 'status',
      header: t('fleetVehicles.status'),
      sortable: true,
      cellRenderer: (v) => (
        <Badge variant={STATUS_VARIANT[v as BusStatus]} size="sm">
          {t(STATUS_LABEL[v as BusStatus])}
        </Badge>
      ),
      csvValue: (v) => t(STATUS_LABEL[v as BusStatus]),
    },
  ];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toFormValues(bus: BusRow): BusFormValues {
  const dateToStr = (d?: string | null) => d ? d.slice(0, 10) : '';
  return {
    plateNumber:         bus.plateNumber,
    model:               bus.model ?? '',
    type:                (bus.type ?? 'STANDARD') as BusType,
    capacity:            String(bus.capacity),
    year:                bus.year ? String(bus.year) : '',
    agencyId:            bus.agencyId ?? '',
    vin:                 bus.vin ?? '',
    fuelType:            bus.fuelType ?? '',
    engineType:          bus.engineType ?? '',
    fuelTankCapacityL:   bus.fuelTankCapacityL != null ? String(bus.fuelTankCapacityL) : '',
    adBlueTankCapacityL: bus.adBlueTankCapacityL != null ? String(bus.adBlueTankCapacityL) : '',
    luggageCapacityKg:   bus.luggageCapacityKg ? String(bus.luggageCapacityKg) : '',
    luggageCapacityM3:   bus.luggageCapacityM3 ? String(bus.luggageCapacityM3) : '',
    registrationDate:    dateToStr(bus.registrationDate),
    purchaseDate:        dateToStr(bus.purchaseDate),
    purchasePrice:              bus.purchasePrice != null ? String(bus.purchasePrice) : '',
    initialOdometerKm:          bus.initialOdometerKm != null ? String(bus.initialOdometerKm) : '',
    fuelConsumptionPer100Km:    bus.fuelConsumptionPer100Km != null ? String(bus.fuelConsumptionPer100Km) : '',
    adBlueConsumptionPer100Km:  bus.adBlueConsumptionPer100Km != null ? String(bus.adBlueConsumptionPer100Km) : '',
    amenities:                  (bus.amenities ?? []) as BusAmenity[],
  };
}

function formToPayload(f: BusFormValues) {
  const numOrUndef = (v: string) => v ? Number(v) : undefined;
  const strOrUndef = (v: string) => v || undefined;
  return {
    plateNumber:         f.plateNumber.trim(),
    model:               f.model.trim() || undefined,
    type:                f.type,
    capacity:            Number(f.capacity),
    year:                f.year ? Number(f.year) : undefined,
    agencyId:            f.agencyId,
    vin:                 strOrUndef(f.vin.trim()),
    fuelType:            strOrUndef(f.fuelType),
    engineType:          strOrUndef(f.engineType),
    fuelTankCapacityL:   numOrUndef(f.fuelTankCapacityL),
    adBlueTankCapacityL: numOrUndef(f.adBlueTankCapacityL),
    luggageCapacityKg:   numOrUndef(f.luggageCapacityKg),
    luggageCapacityM3:   numOrUndef(f.luggageCapacityM3),
    registrationDate:    strOrUndef(f.registrationDate),
    purchaseDate:        strOrUndef(f.purchaseDate),
    purchasePrice:              numOrUndef(f.purchasePrice),
    initialOdometerKm:          numOrUndef(f.initialOdometerKm),
    fuelConsumptionPer100Km:    numOrUndef(f.fuelConsumptionPer100Km),
    adBlueConsumptionPer100Km:  numOrUndef(f.adBlueConsumptionPer100Km),
    amenities:                  f.amenities,
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function PageFleetVehicles() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { operational } = useTenantConfig();
  const { t } = useI18n();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/tenants/${tenantId}/fleet/buses`;

  const { data: buses, loading, error, refetch } = useFetch<BusRow[]>(
    tenantId ? base : null, [tenantId],
  );
  const { data: agencies } = useFetch<AgencyRow[]>(
    tenantId ? `/api/tenants/${tenantId}/agencies` : null, [tenantId],
  );

  const [showCreate,   setShowCreate]   = useState(false);
  const [editBus,      setEditBus]      = useState<BusRow | null>(null);
  const [statusBus,    setStatusBus]    = useState<BusRow | null>(null);
  const [deleteBus,    setDeleteBus]    = useState<BusRow | null>(null);
  const [busy,         setBusy]         = useState(false);
  const [actionErr,    setActionErr]    = useState<string | null>(null);

  const kpi = useMemo(() => {
    const list = buses ?? [];
    return {
      total:       list.length,
      available:   list.filter(b => b.status === 'AVAILABLE').length,
      inService:   list.filter(b => b.status === 'IN_SERVICE').length,
      maintenance: list.filter(b => b.status === 'MAINTENANCE').length,
    };
  }, [buses]);

  const handleCreate = async (f: BusFormValues) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPost(base, formToPayload(f));
      setShowCreate(false); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleEdit = async (f: BusFormValues) => {
    if (!editBus) return;
    setBusy(true); setActionErr(null);
    try {
      await apiPatch(`${base}/${editBus.id}`, formToPayload(f));
      setEditBus(null); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleStatusChange = async (bus: BusRow, status: BusStatus) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPatch(`${base}/${bus.id}/status`, { status });
      setStatusBus(null); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleDelete = async () => {
    if (!deleteBus) return;
    setBusy(true); setActionErr(null);
    try {
      await apiDelete(`${base}/${deleteBus.id}`);
      setDeleteBus(null); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const columns = useMemo(() => buildColumns(agencies ?? [], t), [agencies, t]);

  const rowActions: RowAction<BusRow>[] = [
    {
      label:   t('common.edit'),
      icon:    <Pencil size={13} />,
      onClick: (row) => { setActionErr(null); setEditBus(row); },
    },
    {
      label:   t('fleetVehicles.tracking'),
      icon:    <Gauge size={13} />,
      onClick: (row) => navigate(`/admin/fleet/tracking?busId=${row.id}`),
    },
    {
      label:   t('fleetVehicles.changeStatus'),
      icon:    <Power size={13} />,
      onClick: (row) => { setActionErr(null); setStatusBus(row); },
    },
    {
      label:   t('fleetVehicles.seatPlan'),
      icon:    <LayoutGrid size={13} />,
      onClick: (row) => navigate(`/admin/fleet/seats?busId=${row.id}`),
    },
    {
      label:   t('fleetVehicles.papers'),
      icon:    <FileText size={13} />,
      onClick: (row) => navigate(`/admin/fleet-docs?busId=${row.id}`),
    },
    {
      label:   t('common.delete'),
      icon:    <Trash2 size={13} />,
      danger:  true,
      onClick: (row) => { setActionErr(null); setDeleteBus(row); },
    },
  ];

  return (
    <main className="p-6 space-y-6" role="main" aria-label={t('fleetVehicles.pageTitle')}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
            <Bus className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('fleetVehicles.pageTitle')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {t('fleetVehicles.pageSubtitle')}
            </p>
          </div>
        </div>
        <Button onClick={() => { setActionErr(null); setShowCreate(true); }}>
          <Plus className="w-4 h-4 mr-2" aria-hidden />
          {t('fleetVehicles.addVehicle')}
        </Button>
      </div>

      <ErrorAlert error={error || actionErr} icon />

      {/* Synthèse flotte (Sprint 5) — manager vue macro : actifs/maintenance/offline
          + bus sous-utilisés sur 7 jours. DRY : KPI = /analytics/fleet-summary. */}
      {tenantId && <FleetStatusHeader tenantId={tenantId} />}

      <section aria-label={t('fleetVehicles.fleetIndicators')} className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Kpi label={t('fleetVehicles.kpiVehicles')}    value={kpi.total}       icon={<Bus className="w-5 h-5" />} />
        <Kpi label={t('fleetVehicles.kpiAvailable')}   value={kpi.available}   icon={<CheckCircle2 className="w-5 h-5" />} tone="success" />
        <Kpi label={t('fleetVehicles.kpiInService')}   value={kpi.inService}   icon={<Bus className="w-5 h-5" />} tone="warning" />
        <Kpi label={t('fleetVehicles.kpiMaintenance')} value={kpi.maintenance} icon={<Wrench className="w-5 h-5" />} tone="danger" />
      </section>

      <DataTableMaster<BusRow>
        columns={columns}
        data={buses ?? []}
        loading={loading}
        rowActions={rowActions}
        defaultSort={{ key: 'plateNumber', dir: 'asc' }}
        defaultPageSize={25}
        searchPlaceholder={t('fleetVehicles.searchPlaceholder')}
        emptyMessage={t('fleetVehicles.emptyMessage')}
        exportFormats={['csv', 'json', 'xls', 'pdf']}
        exportFilename="vehicules"
        onRowClick={(row) => { setActionErr(null); setEditBus(row); }}
        stickyHeader
      />

      {/* Modifier */}
      <Dialog
        open={!!editBus}
        onOpenChange={o => { if (!o) setEditBus(null); }}
        title={t('fleetVehicles.editVehicle')}
        description={editBus?.plateNumber}
        size="xl"
      >
        {editBus && (
          <>
            <BusForm
              agencies={agencies ?? []}
              initial={toFormValues(editBus)}
              onSubmit={handleEdit}
              onCancel={() => setEditBus(null)}
              busy={busy}
              error={actionErr}
              submitLabel={t('common.save')}
              pendingLabel={t('common.saving')}
              currencyCode={operational.currency}
            />
            <BusPhotoManager tenantId={tenantId} busId={editBus.id} />
            <BusCostProfileSection
              tenantId={tenantId}
              busId={editBus.id}
              busHints={{
                fuelConsumptionPer100Km: editBus.fuelConsumptionPer100Km ?? undefined,
                purchasePrice:           editBus.purchasePrice ?? undefined,
              }}
            />
          </>
        )}
      </Dialog>

      {/* Supprimer */}
      <Dialog
        open={!!deleteBus}
        onOpenChange={o => { if (!o) setDeleteBus(null); }}
        title={t('fleetVehicles.deleteVehicle')}
        description={`${t('common.delete')} "${deleteBus?.plateNumber}" ? ${t('fleetVehicles.deleteConfirm')}`}
        footer={
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setDeleteBus(null)} disabled={busy}>
              <X className="w-4 h-4 mr-1.5" aria-hidden />{t('common.cancel')}
            </Button>
            <Button
              onClick={handleDelete}
              disabled={busy}
              className="bg-red-600 hover:bg-red-700 text-white border-red-600"
            >
              <Trash2 className="w-4 h-4 mr-1.5" aria-hidden />
              {busy ? t('common.deleting') : t('common.delete')}
            </Button>
          </div>
        }
      >
        {actionErr && <p className="text-sm text-red-600 dark:text-red-400">{actionErr}</p>}
        <div />
      </Dialog>

      <Dialog
        open={showCreate}
        onOpenChange={o => { if (!o) setShowCreate(false); }}
        title={t('fleetVehicles.createTitle')}
        description={t('fleetVehicles.createDescription')}
        size="xl"
      >
        <BusForm
          agencies={agencies ?? []}
          initial={EMPTY_FORM}
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
          busy={busy}
          error={actionErr}
          submitLabel={t('common.create')}
          pendingLabel={t('common.creating')}
          currencyCode={operational.currency}
        />
      </Dialog>

      {/* Changer le statut */}
      <Dialog
        open={!!statusBus}
        onOpenChange={o => { if (!o) setStatusBus(null); }}
        title={t('fleetVehicles.changeStatus')}
        description={statusBus?.plateNumber}
        size="sm"
      >
        {statusBus && (
          <div className="space-y-2">
            <ErrorAlert error={actionErr} />
            {(['AVAILABLE','IN_SERVICE','MAINTENANCE','OFFLINE'] as BusStatus[]).map(s => (
              <button key={s}
                type="button"
                disabled={busy || s === statusBus.status}
                onClick={() => handleStatusChange(statusBus, s)}
                className="w-full flex items-center justify-between gap-2 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 disabled:opacity-50 disabled:cursor-not-allowed text-left">
                <span className="text-sm text-slate-800 dark:text-slate-200">{t(STATUS_LABEL[s])}</span>
                {s === statusBus.status
                  ? <Badge variant="default" size="sm">{t('fleetVehicles.current')}</Badge>
                  : <Badge variant={STATUS_VARIANT[s]} size="sm">{t(STATUS_LABEL[s])}</Badge>}
              </button>
            ))}
          </div>
        )}
      </Dialog>
    </main>
  );
}

function Kpi({
  label, value, icon, tone = 'default',
}: {
  label: string; value: number; icon: React.ReactNode;
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
          {value.toLocaleString('fr-FR')}
        </p>
      </div>
    </article>
  );
}
