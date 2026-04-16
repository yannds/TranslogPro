/**
 * RouteDetailDialog — Detail modal for a route: waypoints management + segment price matrix.
 *
 * Opened from PageRoutes when user clicks a route row.
 * Shows two sections:
 *   1. Escales (Waypoints) — ordered list, add/remove/reorder, save
 *   2. Tarifs par segment — editable price matrix, save
 *
 * API endpoints used:
 *   GET    /api/tenants/:tid/routes/:id               → route with waypoints + segmentPrices
 *   PATCH  /api/tenants/:tid/routes/:id/waypoints     → replace waypoints
 *   GET    /api/tenants/:tid/routes/:id/segment-prices → segment price list
 *   PATCH  /api/tenants/:tid/routes/:id/segment-prices → bulk update prices
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MapPin, ChevronUp, ChevronDown, Trash2, Plus, Save, Pencil, X,
  AlertTriangle, CheckCircle2, Shield, Trees, Flag, Landmark, CircleDot,
} from 'lucide-react';
import { apiGet, apiPatch }        from '../../lib/api';
import { useI18n }             from '../../lib/i18n/useI18n';
import { Dialog }                  from '../ui/Dialog';
import { Button }                  from '../ui/Button';
import { Badge }                   from '../ui/Badge';
import { ErrorAlert }              from '../ui/ErrorAlert';
import { inputClass }              from '../ui/inputClass';

// ─── i18n ─────────────────────────────────────────────────────────────────────

const dict = {
  detailTitle:        tm('Détail ligne', 'Route Detail'),
  baseFare:           tm('Tarif de base', 'Base fare'),
  edit:               tm('Modifier', 'Edit'),
  stopsTitle:         tm('Escales', 'Stops'),
  addStop:            tm('Ajouter escale', 'Add Stop'),
  quickAdd:           tm('Ajout rapide (gare)', 'Quick Add (station)'),
  quickAddPlaceholder:tm('— Sélectionner une gare —', '— Select a station —'),
  newStop:            tm('Nouvelle escale', 'New Stop'),
  editStop:           tm('Modifier l\'escale', 'Edit Stop'),
  station:            tm('Station', 'Station'),
  distanceOrigin:     tm('Distance depuis l\'origine (km)', 'Distance from origin (km)'),
  tollCost:           tm('Frais de péage (XAF)', 'Toll cost (XAF)'),
  waitTime:           tm('Temps d\'attente estimé (min)', 'Estimated wait time (min)'),
  mandatoryStop:      tm('Arrêt obligatoire (le bus doit marquer cet arrêt)', 'Mandatory stop (bus must stop here)'),
  checkpoints:        tm('Points de contrôle (sur le segment)', 'Checkpoints (on this segment)'),
  addCheckpoint:      tm('+ Point de contrôle', '+ Checkpoint'),
  checkpointName:     tm('Nom du poste', 'Checkpoint name'),
  cancel:             tm('Annuler', 'Cancel'),
  add:                tm('Ajouter l\'escale', 'Add stop'),
  saveChanges:        tm('Enregistrer les modifications', 'Save changes'),
  saveStops:          tm('Enregistrer les escales', 'Save stops'),
  saving:             tm('Enregistrement…', 'Saving…'),
  savedSuccess:       tm('Escales enregistrées avec succès. La matrice de tarifs a été régénérée.', 'Stops saved successfully. Price matrix regenerated.'),
  segmentTitle:       tm('Tarifs par segment', 'Segment Prices'),
  configured:         tm('configuré', 'configured'),
  configuredPlural:   tm('configurés', 'configured'),
  savedPricesSuccess: tm('Tarifs enregistrés avec succès.', 'Prices saved successfully.'),
  noSegments:         tm('Aucun segment de prix. Ajoutez des escales puis enregistrez pour générer la matrice.', 'No price segments. Add stops then save to generate the matrix.'),
  from:               tm('De', 'From'),
  to:                 tm('À', 'To'),
  priceXaf:           tm('Prix (XAF)', 'Price (XAF)'),
  status:             tm('Statut', 'Status'),
  ok:                 tm('OK', 'OK'),
  notConfigured:      tm('Non configuré', 'Not configured'),
  savePrices:         tm('Enregistrer les tarifs', 'Save prices'),
  origin:             tm('Origine', 'Origin'),
  destination:        tm('Destination', 'Destination'),
  loading:            tm('Chargement…', 'Loading…'),
  moveUp:             tm('Monter', 'Move up'),
  moveDown:           tm('Descendre', 'Move down'),
  remove:             tm('Retirer', 'Remove'),
  editWp:             tm('Modifier', 'Edit'),
  mandatoryBadge:     tm('Arrêt obligatoire', 'Mandatory stop'),
  cpPeage:            tm('Péage', 'Toll'),
  cpPolice:           tm('Police', 'Police'),
  cpDouane:           tm('Douane', 'Customs'),
  cpEauxForets:       tm('Eaux & Forêts', 'Forestry'),
  cpFrontiere:        tm('Frontière', 'Border'),
  cpAutre:            tm('Autre', 'Other'),
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

interface StationLite {
  id:   string;
  name: string;
  city: string;
}

interface WaypointData {
  id?:                  string;
  stationId:            string;
  order:                number;
  distanceFromOriginKm: number;
  tollCostXaf:          number;
  checkpointCosts:      CheckpointCost[];
  isMandatoryStop:      boolean;
  estimatedWaitTime?:   number | null;
  station?:             { id: string; name: string; city: string };
}

interface CheckpointCost {
  type:    'PEAGE' | 'POLICE' | 'DOUANE' | 'EAUX_FORETS' | 'FRONTIERE' | 'AUTRE';
  name:    string;
  costXaf: number;
}

const CHECKPOINT_TYPES = [
  { value: 'PEAGE',       labelKey: 'cpPeage' as const,      icon: Landmark },
  { value: 'POLICE',      labelKey: 'cpPolice' as const,     icon: Shield },
  { value: 'DOUANE',      labelKey: 'cpDouane' as const,     icon: Flag },
  { value: 'EAUX_FORETS', labelKey: 'cpEauxForets' as const, icon: Trees },
  { value: 'FRONTIERE',   labelKey: 'cpFrontiere' as const,  icon: Flag },
  { value: 'AUTRE',       labelKey: 'cpAutre' as const,      icon: CircleDot },
] as const;

interface SegmentPriceRow {
  id?:           string;
  routeId:       string;
  fromStationId: string;
  toStationId:   string;
  basePriceXaf:  number;
  fromStation?:  { id: string; name: string };
  toStation?:    { id: string; name: string };
}

interface RouteDetail {
  id:            string;
  name:          string;
  originId:      string;
  destinationId: string;
  distanceKm:    number;
  basePrice:     number;
  origin?:       { id: string; name: string; city: string } | null;
  destination?:  { id: string; name: string; city: string } | null;
  waypoints:     WaypointData[];
  segmentPrices: SegmentPriceRow[];
}

export interface RouteDetailDialogProps {
  routeId:       string | null;
  tenantId:      string;
  stations:      StationLite[];
  onClose:       () => void;
  onEditRoute:   (routeId: string) => void;
  onSaved:       () => void;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function stationLabel(s: { name: string; city?: string } | null | undefined) {
  if (!s) return '—';
  return s.city ? `${s.name} (${s.city})` : s.name;
}

function formatXof(n: number): string {
  return new Intl.NumberFormat('fr-FR').format(n) + ' XAF';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RouteDetailDialog({
  routeId, tenantId, stations, onClose, onEditRoute, onSaved,
}: RouteDetailDialogProps) {
  const { t } = useI18n();
  const base = `/api/tenants/${tenantId}/routes`;

  // ── State ──────────────────────────────────────────────────────────────
  const [route,          setRoute]          = useState<RouteDetail | null>(null);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState<string | null>(null);

  // Waypoints
  const [waypoints,      setWaypoints]      = useState<WaypointData[]>([]);
  const [wpBusy,         setWpBusy]         = useState(false);
  const [wpError,        setWpError]        = useState<string | null>(null);
  const [wpSuccess,      setWpSuccess]      = useState(false);
  const [showAddForm,    setShowAddForm]    = useState(false);
  const [editingIdx,     setEditingIdx]     = useState<number | null>(null);

  // New / edit waypoint form
  const [newStationId,         setNewStationId]         = useState('');
  const [newDistanceKm,        setNewDistanceKm]        = useState('');
  const [newTollCostXaf,       setNewTollCostXaf]       = useState('0');
  const [newIsMandatory,       setNewIsMandatory]       = useState(false);
  const [newEstimatedWait,     setNewEstimatedWait]     = useState('');
  const [newCheckpoints,       setNewCheckpoints]       = useState<CheckpointCost[]>([]);

  // Segment prices
  const [prices,         setPrices]         = useState<SegmentPriceRow[]>([]);
  const [editedPrices,   setEditedPrices]   = useState<Record<string, number>>({});
  const [priceBusy,      setPriceBusy]      = useState(false);
  const [priceError,     setPriceError]     = useState<string | null>(null);
  const [priceSuccess,   setPriceSuccess]   = useState(false);

  // ── Load route detail ──────────────────────────────────────────────────
  const loadRoute = useCallback(async () => {
    if (!routeId) return;
    setLoading(true);
    setError(null);
    try {
      const [detail, segPrices] = await Promise.all([
        apiGet<RouteDetail>(`${base}/${routeId}`),
        apiGet<SegmentPriceRow[]>(`${base}/${routeId}/segment-prices`),
      ]);
      setRoute(detail);
      setWaypoints(detail.waypoints ?? []);
      setPrices(segPrices);
      setEditedPrices({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [routeId, base]);

  useEffect(() => {
    if (routeId) {
      loadRoute();
      setWpSuccess(false);
      setPriceSuccess(false);
      setShowAddForm(false);
    }
  }, [routeId, loadRoute]);

  // ── Available stations for adding waypoints ────────────────────────────
  const usedStationIds = useMemo(() => {
    if (!route) return new Set<string>();
    const ids = new Set<string>();
    if (route.originId) ids.add(route.originId);
    if (route.destinationId) ids.add(route.destinationId);
    waypoints.forEach(wp => ids.add(wp.stationId));
    return ids;
  }, [route, waypoints]);

  const availableForAdd = useMemo(
    () => stations.filter(s => !usedStationIds.has(s.id)),
    [stations, usedStationIds],
  );

  // ── Waypoint actions ───────────────────────────────────────────────────
  const moveWaypoint = (idx: number, dir: -1 | 1) => {
    setWaypoints(prev => {
      const next = [...prev];
      const swapIdx = idx + dir;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next.map((wp, i) => ({ ...wp, order: i + 1 }));
    });
    setWpSuccess(false);
  };

  const removeWaypoint = (idx: number) => {
    setWaypoints(prev =>
      prev.filter((_, i) => i !== idx).map((wp, i) => ({ ...wp, order: i + 1 })),
    );
    setWpSuccess(false);
  };

  const resetNewForm = () => {
    setNewStationId('');
    setNewDistanceKm('');
    setNewTollCostXaf('0');
    setNewIsMandatory(false);
    setNewEstimatedWait('');
    setNewCheckpoints([]);
    setEditingIdx(null);
  };

  const addWaypoint = () => {
    if (!newStationId || !newDistanceKm) return;
    const station = stations.find(s => s.id === newStationId);
    const newWp: WaypointData = {
      stationId:            newStationId,
      order:                waypoints.length + 1,
      distanceFromOriginKm: Number(newDistanceKm),
      tollCostXaf:          Number(newTollCostXaf) || 0,
      checkpointCosts:      newCheckpoints,
      isMandatoryStop:      newIsMandatory,
      estimatedWaitTime:    newEstimatedWait ? Number(newEstimatedWait) : null,
      station:              station ? { id: station.id, name: station.name, city: station.city } : undefined,
    };
    setWaypoints(prev => [...prev, newWp]);
    resetNewForm();
    setShowAddForm(false);
    setWpSuccess(false);
  };

  const startEditWaypoint = (idx: number) => {
    const wp = waypoints[idx];
    setNewStationId(wp.stationId);
    setNewDistanceKm(String(wp.distanceFromOriginKm));
    setNewTollCostXaf(String(wp.tollCostXaf));
    setNewIsMandatory(wp.isMandatoryStop);
    setNewEstimatedWait(wp.estimatedWaitTime ? String(wp.estimatedWaitTime) : '');
    setNewCheckpoints(wp.checkpointCosts ? [...wp.checkpointCosts] : []);
    setEditingIdx(idx);
    setShowAddForm(false);
  };

  const applyEditWaypoint = () => {
    if (editingIdx === null || !newStationId || !newDistanceKm) return;
    const station = stations.find(s => s.id === newStationId);
    setWaypoints(prev => prev.map((wp, i) => i === editingIdx ? {
      ...wp,
      stationId:            newStationId,
      distanceFromOriginKm: Number(newDistanceKm),
      tollCostXaf:          Number(newTollCostXaf) || 0,
      checkpointCosts:      newCheckpoints,
      isMandatoryStop:      newIsMandatory,
      estimatedWaitTime:    newEstimatedWait ? Number(newEstimatedWait) : null,
      station:              station ? { id: station.id, name: station.name, city: station.city } : undefined,
    } : wp));
    resetNewForm();
    setWpSuccess(false);
  };

  /** Quick-add: pick a station from dropdown, add with defaults */
  const quickAddStation = (stationId: string) => {
    if (!stationId) return;
    const station = stations.find(s => s.id === stationId);
    if (!station) return;
    const newWp: WaypointData = {
      stationId,
      order:                waypoints.length + 1,
      distanceFromOriginKm: 0,
      tollCostXaf:          0,
      checkpointCosts:      [],
      isMandatoryStop:      false,
      estimatedWaitTime:    null,
      station:              { id: station.id, name: station.name, city: station.city },
    };
    setWaypoints(prev => [...prev, newWp]);
    setWpSuccess(false);
  };

  const addCheckpoint = () => {
    setNewCheckpoints(prev => [...prev, { type: 'PEAGE', name: '', costXaf: 0 }]);
  };

  const updateCheckpoint = (idx: number, patch: Partial<CheckpointCost>) => {
    setNewCheckpoints(prev => prev.map((cp, i) => i === idx ? { ...cp, ...patch } : cp));
  };

  const removeCheckpoint = (idx: number) => {
    setNewCheckpoints(prev => prev.filter((_, i) => i !== idx));
  };

  const saveWaypoints = async () => {
    if (!routeId) return;
    setWpBusy(true);
    setWpError(null);
    setWpSuccess(false);
    try {
      await apiPatch(`${base}/${routeId}/waypoints`, {
        waypoints: waypoints.map((wp, i) => ({
          stationId:            wp.stationId,
          order:                i + 1,
          distanceFromOriginKm: wp.distanceFromOriginKm,
          tollCostXaf:          wp.tollCostXaf,
          checkpointCosts:      wp.checkpointCosts,
          isMandatoryStop:      wp.isMandatoryStop,
          estimatedWaitTime:    wp.estimatedWaitTime ?? undefined,
        })),
      });
      setWpSuccess(true);
      // Reload to get refreshed segment prices
      await loadRoute();
      onSaved();
    } catch (e) {
      setWpError((e as Error).message);
    } finally {
      setWpBusy(false);
    }
  };

  // ── Segment price actions ──────────────────────────────────────────────
  const handlePriceChange = (fromId: string, toId: string, value: number) => {
    const key = `${fromId}__${toId}`;
    setEditedPrices(prev => ({ ...prev, [key]: value }));
    setPriceSuccess(false);
  };

  const getPrice = (row: SegmentPriceRow): number => {
    const key = `${row.fromStationId}__${row.toStationId}`;
    return key in editedPrices ? editedPrices[key] : row.basePriceXaf;
  };

  const hasEditedPrices = Object.keys(editedPrices).length > 0;

  const savePrices = async () => {
    if (!routeId || !hasEditedPrices) return;
    setPriceBusy(true);
    setPriceError(null);
    setPriceSuccess(false);
    try {
      const pricesToSend = Object.entries(editedPrices).map(([key, basePriceXaf]) => {
        const [fromStationId, toStationId] = key.split('__');
        return { fromStationId, toStationId, basePriceXaf };
      });
      await apiPatch(`${base}/${routeId}/segment-prices`, { prices: pricesToSend });
      setPriceSuccess(true);
      await loadRoute();
      onSaved();
    } catch (e) {
      setPriceError((e as Error).message);
    } finally {
      setPriceBusy(false);
    }
  };

  // ── Price stats ────────────────────────────────────────────────────────
  const priceStats = useMemo(() => {
    const total      = prices.length;
    const configured = prices.filter(p => {
      const val = getPrice(p);
      return val > 0;
    }).length;
    return { total, configured };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prices, editedPrices]);

  // ── Shared waypoint form (used for both add and edit) ───────────────
  const isEditing = editingIdx !== null;
  const formStationOptions = isEditing
    ? stations.filter(s => s.id === waypoints[editingIdx].stationId || !usedStationIds.has(s.id))
    : availableForAdd;

  const renderWaypointForm = () => (
    <div className="mt-3 p-4 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 space-y-3">
      <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300">
        {isEditing ? t(dict.editStop) : t(dict.newStop)}
      </h4>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
            {t(dict.station)} <span className="text-red-500">*</span>
          </label>
          <select
            value={newStationId}
            onChange={e => setNewStationId(e.target.value)}
            className={inputClass}
          >
            <option value="">{t(dict.quickAddPlaceholder)}</option>
            {formStationOptions.map(s => (
              <option key={s.id} value={s.id}>{stationLabel(s)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
            {t(dict.distanceOrigin)} <span className="text-red-500">*</span>
          </label>
          <input
            type="number" min={0} step="0.1"
            value={newDistanceKm}
            onChange={e => setNewDistanceKm(e.target.value)}
            className={inputClass}
            placeholder="ex. 120"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
            {t(dict.tollCost)}
          </label>
          <input
            type="number" min={0} step="100"
            value={newTollCostXaf}
            onChange={e => setNewTollCostXaf(e.target.value)}
            className={inputClass}
            placeholder="0"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
            {t(dict.waitTime)}
          </label>
          <input
            type="number" min={0}
            value={newEstimatedWait}
            onChange={e => setNewEstimatedWait(e.target.value)}
            className={inputClass}
            placeholder="ex. 15"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="newIsMandatory"
          checked={newIsMandatory}
          onChange={e => setNewIsMandatory(e.target.checked)}
          className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        />
        <label htmlFor="newIsMandatory" className="text-sm text-slate-700 dark:text-slate-300">
          {t(dict.mandatoryStop)}
        </label>
      </div>

      {/* Checkpoints sub-form */}
      <div className="space-y-2 border-t border-slate-200 dark:border-slate-700 pt-3">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
            {t(dict.checkpoints)}
          </label>
          <Button
            variant="outline"
            onClick={addCheckpoint}
            className="!text-xs !px-2 !py-1"
          >
            <Plus className="w-3 h-3 mr-1" />
            {t(dict.addCheckpoint)}
          </Button>
        </div>
        {newCheckpoints.map((cp, cpIdx) => (
          <div key={cpIdx} className="grid grid-cols-[140px_1fr_100px_32px] gap-2 items-end">
            <select
              value={cp.type}
              onChange={e => updateCheckpoint(cpIdx, { type: e.target.value as CheckpointCost['type'] })}
              className={inputClass}
            >
              {CHECKPOINT_TYPES.map(ct => (
                <option key={ct.value} value={ct.value}>{t(dict[ct.labelKey])}</option>
              ))}
            </select>
            <input
              type="text"
              value={cp.name}
              onChange={e => updateCheckpoint(cpIdx, { name: e.target.value })}
              className={inputClass}
              placeholder={t(dict.checkpointName)}
            />
            <input
              type="number"
              min={0}
              value={cp.costXaf}
              onChange={e => updateCheckpoint(cpIdx, { costXaf: Number(e.target.value) })}
              className={inputClass}
              placeholder="XAF"
            />
            <button
              type="button"
              onClick={() => removeCheckpoint(cpIdx)}
              className="p-1.5 rounded text-slate-400 hover:text-red-600"
              aria-label={t(dict.remove)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-2">
        <Button
          variant="outline"
          onClick={() => { resetNewForm(); setShowAddForm(false); }}
        >
          {t(dict.cancel)}
        </Button>
        {isEditing ? (
          <Button
            onClick={applyEditWaypoint}
            disabled={!newStationId || !newDistanceKm}
          >
            <Save className="w-4 h-4 mr-1.5" aria-hidden />
            {t(dict.saveChanges)}
          </Button>
        ) : (
          <Button
            onClick={addWaypoint}
            disabled={!newStationId || !newDistanceKm}
          >
            <Plus className="w-4 h-4 mr-1.5" aria-hidden />
            {t(dict.add)}
          </Button>
        )}
      </div>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <Dialog
      open={!!routeId}
      onOpenChange={o => { if (!o) onClose(); }}
      title={route?.name ?? t(dict.detailTitle)}
      description={
        route
          ? `${stationLabel(route.origin)} → ${stationLabel(route.destination)} · ${route.distanceKm.toLocaleString('fr-FR')} km`
          : undefined
      }
      size="3xl"
    >
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full" />
          <span className="ml-3 text-sm text-slate-500">{t(dict.loading)}</span>
        </div>
      ) : error ? (
        <ErrorAlert error={error} icon />
      ) : route ? (
        <div className="space-y-8">
          {/* Route summary header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <MapPin className="w-4 h-4 text-teal-500" aria-hidden />
              <span>{t(dict.baseFare)} : <strong className="text-slate-900 dark:text-white">{formatXof(route.basePrice)}</strong></span>
            </div>
            <Button
              variant="outline"
              onClick={() => onEditRoute(route.id)}
            >
              <Pencil className="w-4 h-4 mr-1.5" aria-hidden />
              {t(dict.edit)}
            </Button>
          </div>

          {/* ── Section 1: Escales ────────────────────────────────────── */}
          <section aria-label={t(dict.stopsTitle)}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wide">
                {t(dict.stopsTitle)} ({waypoints.length})
              </h3>
              <div className="flex items-center gap-2">
                {!showAddForm && !isEditing && availableForAdd.length > 0 && (
                  <Button variant="outline" onClick={() => { resetNewForm(); setShowAddForm(true); }}>
                    <Plus className="w-4 h-4 mr-1.5" aria-hidden />
                    {t(dict.addStop)}
                  </Button>
                )}
              </div>
            </div>

            {/* Quick-add dropdown */}
            {!showAddForm && !isEditing && availableForAdd.length > 0 && (
              <div className="mb-3">
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  {t(dict.quickAdd)}
                </label>
                <select
                  value=""
                  onChange={e => quickAddStation(e.target.value)}
                  className={`${inputClass} max-w-xs`}
                >
                  <option value="">{t(dict.quickAddPlaceholder)}</option>
                  {availableForAdd.map(s => (
                    <option key={s.id} value={s.id}>{stationLabel(s)}</option>
                  ))}
                </select>
              </div>
            )}

            <ErrorAlert error={wpError} icon />

            {wpSuccess && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300 mb-3">
                <CheckCircle2 className="w-4 h-4" aria-hidden />
                {t(dict.savedSuccess)}
              </div>
            )}

            {/* Waypoints visual list */}
            <div className="space-y-1">
              {/* Origin */}
              <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800">
                <div className="w-6 h-6 rounded-full bg-teal-500 text-white flex items-center justify-center text-xs font-bold shrink-0">O</div>
                <span className="text-sm font-medium text-teal-800 dark:text-teal-200">{stationLabel(route.origin)}</span>
                <Badge variant="info" size="sm">{t(dict.origin)}</Badge>
              </div>

              {/* Waypoints */}
              {waypoints.map((wp, idx) => (
                <div key={wp.stationId + idx}>
                  <div className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${editingIdx === idx ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
                    <div className="w-6 h-6 rounded-full bg-slate-300 dark:bg-slate-600 text-slate-700 dark:text-slate-200 flex items-center justify-center text-xs font-bold shrink-0">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {stationLabel(wp.station)}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-0.5">
                        <span className="text-xs text-slate-500">{wp.distanceFromOriginKm} km</span>
                        {wp.isMandatoryStop && <Badge variant="warning" size="sm">{t(dict.mandatoryBadge)}</Badge>}
                        {(wp.estimatedWaitTime ?? 0) > 0 && (
                          <span className="text-xs text-slate-500">~{wp.estimatedWaitTime} min</span>
                        )}
                        {wp.tollCostXaf > 0 && (
                          <Badge variant="default" size="sm">Péage {formatXof(wp.tollCostXaf)}</Badge>
                        )}
                        {Array.isArray(wp.checkpointCosts) && wp.checkpointCosts.length > 0 && (
                          <Badge variant="default" size="sm">
                            {wp.checkpointCosts.length} checkpoint{wp.checkpointCosts.length > 1 ? 's' : ''}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => moveWaypoint(idx, -1)}
                        disabled={idx === 0}
                        className="p-1 rounded text-slate-400 hover:text-slate-600 disabled:opacity-30"
                        title={t(dict.moveUp)}
                        aria-label={t(dict.moveUp)}
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveWaypoint(idx, 1)}
                        disabled={idx === waypoints.length - 1}
                        className="p-1 rounded text-slate-400 hover:text-slate-600 disabled:opacity-30"
                        title={t(dict.moveDown)}
                        aria-label={t(dict.moveDown)}
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (editingIdx === idx) { resetNewForm(); }
                          else { startEditWaypoint(idx); }
                        }}
                        className={`p-1 rounded ${editingIdx === idx ? 'text-amber-600' : 'text-slate-400 hover:text-teal-600'}`}
                        title={t(dict.editWp)}
                        aria-label={t(dict.editWp)}
                      >
                        {editingIdx === idx ? <X className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeWaypoint(idx)}
                        className="p-1 rounded text-slate-400 hover:text-red-600"
                        title={t(dict.remove)}
                        aria-label={t(dict.remove)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {/* Inline edit form for this waypoint */}
                  {editingIdx === idx && renderWaypointForm()}
                </div>
              ))}

              {/* Destination */}
              <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800">
                <div className="w-6 h-6 rounded-full bg-teal-500 text-white flex items-center justify-center text-xs font-bold shrink-0">D</div>
                <span className="text-sm font-medium text-teal-800 dark:text-teal-200">{stationLabel(route.destination)}</span>
                <Badge variant="info" size="sm">{t(dict.destination)}</Badge>
              </div>
            </div>

            {/* Add waypoint form (outside list) */}
            {showAddForm && !isEditing && renderWaypointForm()}

            {/* Save waypoints */}
            <div className="flex justify-end mt-3">
              <Button onClick={saveWaypoints} disabled={wpBusy}>
                <Save className="w-4 h-4 mr-1.5" aria-hidden />
                {wpBusy ? t(dict.saving) : t(dict.saveStops)}
              </Button>
            </div>
          </section>

          {/* ── Section 2: Tarifs par segment ─────────────────────────── */}
          <section aria-label={t(dict.segmentTitle)}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wide">
                {t(dict.segmentTitle)}
              </h3>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {priceStats.configured}/{priceStats.total} {priceStats.configured > 1 ? t(dict.configuredPlural) : t(dict.configured)}
              </span>
            </div>

            <ErrorAlert error={priceError} icon />

            {priceSuccess && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300 mb-3">
                <CheckCircle2 className="w-4 h-4" aria-hidden />
                {t(dict.savedPricesSuccess)}
              </div>
            )}

            {prices.length === 0 ? (
              <div className="text-center py-8 text-slate-500 dark:text-slate-400 text-sm">
                <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-amber-500" aria-hidden />
                <p>{t(dict.noSegments)}</p>
              </div>
            ) : (
              <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-900/50 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        <th className="text-left px-4 py-2">{t(dict.from)}</th>
                        <th className="text-left px-4 py-2">{t(dict.to)}</th>
                        <th className="text-right px-4 py-2 w-48">{t(dict.priceXaf)}</th>
                        <th className="text-center px-4 py-2 w-20">{t(dict.status)}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {prices.map(row => {
                        const currentPrice = getPrice(row);
                        const configured   = currentPrice > 0;
                        return (
                          <tr key={`${row.fromStationId}_${row.toStationId}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                            <td className="px-4 py-2 text-slate-700 dark:text-slate-300">
                              {row.fromStation?.name ?? row.fromStationId}
                            </td>
                            <td className="px-4 py-2 text-slate-700 dark:text-slate-300">
                              {row.toStation?.name ?? row.toStationId}
                            </td>
                            <td className="px-4 py-2 text-right">
                              <input
                                type="number"
                                min={0}
                                step={50}
                                value={currentPrice}
                                onChange={e =>
                                  handlePriceChange(row.fromStationId, row.toStationId, Number(e.target.value))
                                }
                                className={`${inputClass} text-right w-full max-w-[180px] ml-auto`}
                              />
                            </td>
                            <td className="px-4 py-2 text-center">
                              {configured ? (
                                <Badge variant="success" size="sm">{t(dict.ok)}</Badge>
                              ) : (
                                <Badge variant="warning" size="sm">{t(dict.notConfigured)}</Badge>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Save prices */}
            {prices.length > 0 && (
              <div className="flex justify-end mt-3">
                <Button onClick={savePrices} disabled={priceBusy || !hasEditedPrices}>
                  <Save className="w-4 h-4 mr-1.5" aria-hidden />
                  {priceBusy ? t(dict.saving) : t(dict.savePrices)}
                </Button>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </Dialog>
  );
}
