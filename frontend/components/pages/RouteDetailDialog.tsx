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
  Zap, Loader2, Coins,
} from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '../../lib/api';
import { useI18n }             from '../../lib/i18n/useI18n';
import { Dialog }                  from '../ui/Dialog';
import { Button }                  from '../ui/Button';
import { Badge }                   from '../ui/Badge';
import { ErrorAlert }              from '../ui/ErrorAlert';
import { inputClass }              from '../ui/inputClass';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Coords = { lat: number; lng: number };

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface StationLite {
  id:            string;
  name:          string;
  city:          string;
  coordinates?:  Coords | null;
}

interface WaypointData {
  id?:                  string;
  kind:                 string;        // WaypointKind — 'STATION' | 'PEAGE' | 'POLICE' | …
  stationId?:           string;        // présent si kind = STATION
  name?:                string;        // présent si kind ≠ STATION
  order:                number;
  distanceFromOriginKm: number;
  tollCostXaf:          number;
  checkpointCosts:      CheckpointCost[];
  isMandatoryStop:      boolean;
  estimatedWaitTime?:   number | null;
  station?:             { id: string; name: string; city: string } | null;
}

interface CheckpointCost {
  type:    'PEAGE' | 'POLICE' | 'DOUANE' | 'EAUX_FORETS' | 'FRONTIERE' | 'AUTRE';
  name:    string;
  costXaf: number;
}

const CHECKPOINT_TYPES = [
  { value: 'PEAGE',       labelKey: 'routeDetail.cpPeage' as const,      icon: Landmark },
  { value: 'POLICE',      labelKey: 'routeDetail.cpPolice' as const,     icon: Shield },
  { value: 'DOUANE',      labelKey: 'routeDetail.cpDouane' as const,     icon: Flag },
  { value: 'EAUX_FORETS', labelKey: 'routeDetail.cpEauxForets' as const, icon: Trees },
  { value: 'FRONTIERE',   labelKey: 'routeDetail.cpFrontiere' as const,  icon: Flag },
  { value: 'AUTRE',       labelKey: 'routeDetail.cpAutre' as const,      icon: CircleDot },
] as const;

const KIND_OPTIONS = [
  { value: 'STATION',     labelKey: 'routeDetail.kindStation' as const,  icon: MapPin },
  ...CHECKPOINT_TYPES,
] as const;

type WaypointKindValue = typeof KIND_OPTIONS[number]['value'];

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
  origin?:       { id: string; name: string; city: string; coordinates?: Coords | null } | null;
  destination?:  { id: string; name: string; city: string; coordinates?: Coords | null } | null;
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

  // Recalibrage Google — bouton dédié + feedback
  const [recalibBusy,    setRecalibBusy]    = useState(false);
  const [recalibMsg,     setRecalibMsg]     = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Détection péages (registre TollPoint partagé)
  interface DetectedTollPoint {
    tollPointId:          string;
    name:                 string;
    kind:                 string;
    tollCostXaf:          number;
    direction:            string;
    distanceFromOriginKm: number;
    matchDistanceKm:      number;
    alreadyLinked:        boolean;
  }
  const [detectedTolls, setDetectedTolls] = useState<DetectedTollPoint[] | null>(null);
  const [detectBusy,    setDetectBusy]    = useState(false);
  const [tollSelection, setTollSelection] = useState<Set<string>>(new Set());

  // Checkpoint autocomplete — points de contrôle déjà enregistrés sur ce tenant
  const [cpSuggestions, setCpSuggestions] = useState<{ kind: string; name: string; tollCostXaf: number; estimatedWaitTime: number | null }[]>([]);
  useEffect(() => {
    if (!tenantId) return;
    apiGet<typeof cpSuggestions>(`${base}/checkpoints`)
      .then(setCpSuggestions)
      .catch(() => { /* non-bloquant */ });
  }, [tenantId, base]);

  // New / edit waypoint form
  const [newKind,              setNewKind]              = useState<WaypointKindValue>('STATION');
  const [newStationId,         setNewStationId]         = useState('');
  const [newName,              setNewName]              = useState('');
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
    waypoints.forEach(wp => { if (wp.kind === 'STATION' && wp.stationId) ids.add(wp.stationId); });
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
    setNewKind('STATION');
    setNewStationId('');
    setNewName('');
    setNewDistanceKm('');
    setNewTollCostXaf('0');
    setNewIsMandatory(false);
    setNewEstimatedWait('');
    setNewCheckpoints([]);
    setEditingIdx(null);
  };

  const addWaypoint = () => {
    const isStation = newKind === 'STATION';
    if (isStation && (!newStationId || !newDistanceKm)) return;
    if (!isStation && (!newName.trim() || !newDistanceKm)) return;
    const station = isStation ? stations.find(s => s.id === newStationId) : undefined;
    const newWp: WaypointData = {
      kind:                 newKind,
      stationId:            isStation ? newStationId : undefined,
      name:                 isStation ? undefined : newName.trim(),
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
    setNewKind((wp.kind ?? 'STATION') as WaypointKindValue);
    setNewStationId(wp.stationId ?? '');
    setNewName(wp.name ?? '');
    setNewDistanceKm(String(wp.distanceFromOriginKm));
    setNewTollCostXaf(String(wp.tollCostXaf));
    setNewIsMandatory(wp.isMandatoryStop);
    setNewEstimatedWait(wp.estimatedWaitTime ? String(wp.estimatedWaitTime) : '');
    setNewCheckpoints(wp.checkpointCosts ? [...wp.checkpointCosts] : []);
    setEditingIdx(idx);
    setShowAddForm(false);
  };

  const applyEditWaypoint = () => {
    if (editingIdx === null || !newDistanceKm) return;
    const isStation = newKind === 'STATION';
    if (isStation && !newStationId) return;
    if (!isStation && !newName.trim()) return;
    const station = isStation ? stations.find(s => s.id === newStationId) : undefined;
    setWaypoints(prev => prev.map((wp, i) => i === editingIdx ? {
      ...wp,
      kind:                 newKind,
      stationId:            isStation ? newStationId : undefined,
      name:                 isStation ? undefined : newName.trim(),
      distanceFromOriginKm: Number(newDistanceKm),
      tollCostXaf:          Number(newTollCostXaf) || 0,
      checkpointCosts:      isStation ? newCheckpoints : [],
      isMandatoryStop:      isStation ? newIsMandatory : false,
      estimatedWaitTime:    newEstimatedWait ? Number(newEstimatedWait) : null,
      station:              station ? { id: station.id, name: station.name, city: station.city } : null,
    } : wp));
    resetNewForm();
    setWpSuccess(false);
  };

  /** Quick-add: pick a station from dropdown, add with defaults */
  const quickAddStation = (stationId: string) => {
    if (!stationId) return;
    const station = stations.find(s => s.id === stationId);
    if (!station) return;
    let distKm = 0;
    if (route?.origin?.coordinates && station.coordinates) {
      const { lat: lat1, lng: lng1 } = route.origin.coordinates as Coords;
      const { lat: lat2, lng: lng2 } = station.coordinates;
      distKm = Math.round(haversineKm(lat1, lng1, lat2, lng2));
    }
    const newWp: WaypointData = {
      kind:                 'STATION',
      stationId,
      order:                waypoints.length + 1,
      distanceFromOriginKm: distKm,
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

  /**
   * Détection de "recul" — waypoint dont `distanceFromOriginKm` est inférieur
   * au précédent dans l'ordre. Signal fort d'une saisie manuelle incohérente
   * que le recalibrage Google peut corriger en un clic.
   */
  const monotonyBreaks = useMemo(() => {
    const breaks: number[] = [];
    for (let i = 1; i < waypoints.length; i++) {
      if (waypoints[i].distanceFromOriginKm < waypoints[i - 1].distanceFromOriginKm) {
        breaks.push(i);
      }
    }
    return breaks;
  }, [waypoints]);

  const recalibrate = async () => {
    if (!routeId) return;
    setRecalibBusy(true); setRecalibMsg(null);
    try {
      const res = await apiPost<{
        changed: boolean; oldDistanceKm: number; newDistanceKm: number;
        waypointsUpdated: number; provider: string; segmentsCalled: number;
        estimated: boolean;
      }>(`${base}/${routeId}/recalibrate`, {});
      if (!res.changed) {
        setRecalibMsg({ kind: 'ok', text: t('routeDetail.recalibrateUnchanged') });
      } else {
        setRecalibMsg({
          kind: 'ok',
          text: t('routeDetail.recalibrateDone')
            .replace('{old}', String(res.oldDistanceKm))
            .replace('{new}', String(res.newDistanceKm))
            .replace('{n}',   String(res.waypointsUpdated)),
        });
      }
      await loadRoute();
      onSaved();
    } catch (e) {
      setRecalibMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setRecalibBusy(false);
    }
  };

  /** Charge les péages du registre proche de l'itinéraire Google de la route. */
  const detectTolls = async () => {
    if (!routeId) return;
    setDetectBusy(true); setRecalibMsg(null);
    try {
      const detected = await apiGet<DetectedTollPoint[]>(
        `/api/tenants/${tenantId}/routes/${routeId}/detect-tolls`,
      );
      setDetectedTolls(detected);
      // pré-sélectionne tout ce qui n'est pas déjà lié
      setTollSelection(new Set(detected.filter(d => !d.alreadyLinked).map(d => d.tollPointId)));
    } catch (e) {
      setRecalibMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setDetectBusy(false);
    }
  };

  const attachSelectedTolls = async () => {
    if (!routeId || tollSelection.size === 0) return;
    setDetectBusy(true); setRecalibMsg(null);
    try {
      const ids = Array.from(tollSelection);
      const res = await apiPost<{ attached: number; skipped: number }>(
        `/api/tenants/${tenantId}/routes/${routeId}/attach-tolls`,
        { tollPointIds: ids },
      );
      setRecalibMsg({
        kind: 'ok',
        text: t('routeDetail.attachTollsDone')
          .replace('{n}', String(res.attached))
          .replace('{s}', String(res.skipped)),
      });
      setDetectedTolls(null);
      setTollSelection(new Set());
      await loadRoute();
      onSaved();
    } catch (e) {
      setRecalibMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setDetectBusy(false);
    }
  };

  const saveWaypoints = async () => {
    if (!routeId) return;
    setWpBusy(true);
    setWpError(null);
    setWpSuccess(false);
    try {
      await apiPatch(`${base}/${routeId}/waypoints`, {
        waypoints: waypoints.map((wp, i) => ({
          kind:                 wp.kind ?? 'STATION',
          stationId:            wp.stationId,
          name:                 wp.name,
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

  const renderWaypointForm = () => {
    const isStation = newKind === 'STATION';
    const canSubmit = isStation
      ? (!!newStationId && !!newDistanceKm)
      : (!!newName.trim() && !!newDistanceKm);

    return (
    <div className="mt-3 p-4 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 space-y-3">
      <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300">
        {isEditing ? t('routeDetail.editStop') : t('routeDetail.newStop')}
      </h4>

      {/* Kind selector */}
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
          {t('routeDetail.kindLabel')} <span className="text-red-500">*</span>
        </label>
        <select
          value={newKind}
          onChange={e => { setNewKind(e.target.value as WaypointKindValue); setNewStationId(''); setNewName(''); }}
          className={inputClass}
        >
          {KIND_OPTIONS.map(k => (
            <option key={k.value} value={k.value}>{t(k.labelKey)}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Station picker OU champ nom selon le kind */}
        {isStation ? (
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              {t('routeDetail.station')} <span className="text-red-500">*</span>
            </label>
            <select
              value={newStationId}
              onChange={e => {
                const sid = e.target.value;
                setNewStationId(sid);
                // Toujours recalculer quand la gare change (si coords disponibles)
                if (sid && route?.origin?.coordinates) {
                  const sel = stations.find(s => s.id === sid);
                  if (sel?.coordinates) {
                    const { lat: lat1, lng: lng1 } = route.origin.coordinates as Coords;
                    const { lat: lat2, lng: lng2 } = sel.coordinates;
                    setNewDistanceKm(String(Math.round(haversineKm(lat1, lng1, lat2, lng2))));
                  }
                }
              }}
              className={inputClass}
            >
              <option value="">{t('routeDetail.quickAddPlaceholder')}</option>
              {formStationOptions.map(s => (
                <option key={s.id} value={s.id}>{stationLabel(s)}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              {t('routeDetail.pointName')} <span className="text-red-500">*</span>
            </label>
            {/* datalist filtrée par kind pour l'autocomplete */}
            <datalist id="cp-suggestions">
              {cpSuggestions
                .filter(s => s.kind === newKind)
                .map((s, i) => <option key={i} value={s.name} />)}
            </datalist>
            <input
              type="text"
              list="cp-suggestions"
              value={newName}
              onChange={e => {
                const val = e.target.value;
                setNewName(val);
                // Auto-remplir coût et attente si la valeur correspond exactement à une suggestion
                const match = cpSuggestions.find(s => s.kind === newKind && s.name === val);
                if (match) {
                  setNewTollCostXaf(String(match.tollCostXaf));
                  if (match.estimatedWaitTime) setNewEstimatedWait(String(match.estimatedWaitTime));
                }
              }}
              className={inputClass}
              placeholder={t('routeDetail.pointNamePlaceholder')}
              autoComplete="off"
            />
          </div>
        )}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
            {t('routeDetail.distanceOrigin')} <span className="text-red-500">*</span>
          </label>
          <input
            type="number" min={0} step="0.1"
            value={newDistanceKm}
            onChange={e => setNewDistanceKm(e.target.value)}
            className={inputClass}
            placeholder={t('routeDetail.distancePlaceholder')}
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
            {t('routeDetail.tollCost')}
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
            {t('routeDetail.waitTime')}
          </label>
          <input
            type="number" min={0}
            value={newEstimatedWait}
            onChange={e => setNewEstimatedWait(e.target.value)}
            className={inputClass}
            placeholder={t('routeDetail.waitTimePlaceholder')}
          />
        </div>
      </div>

      {/* Arrêt obligatoire — uniquement pour les gares */}
      {isStation && (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="newIsMandatory"
            checked={newIsMandatory}
            onChange={e => setNewIsMandatory(e.target.checked)}
            className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          <label htmlFor="newIsMandatory" className="text-sm text-slate-700 dark:text-slate-300">
            {t('routeDetail.mandatoryStop')}
          </label>
        </div>
      )}

      {/* Checkpoints sub-form — uniquement pour les gares (legacy JSON) */}
      {isStation && (
      <div className="space-y-2 border-t border-slate-200 dark:border-slate-700 pt-3">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
            {t('routeDetail.checkpoints')}
          </label>
          <Button
            variant="outline"
            onClick={addCheckpoint}
            className="!text-xs !px-2 !py-1"
          >
            <Plus className="w-3 h-3 mr-1" />
            {t('routeDetail.addCheckpoint')}
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
                <option key={ct.value} value={ct.value}>{t(ct.labelKey)}</option>
              ))}
            </select>
            <input
              type="text"
              value={cp.name}
              onChange={e => updateCheckpoint(cpIdx, { name: e.target.value })}
              className={inputClass}
              placeholder={t('routeDetail.checkpointName')}
            />
            <input
              type="number"
              min={0}
              value={cp.costXaf}
              onChange={e => updateCheckpoint(cpIdx, { costXaf: Number(e.target.value) })}
              className={inputClass}
              placeholder={t('routeDetail.currencyPlaceholder')}
            />
            <button
              type="button"
              onClick={() => removeCheckpoint(cpIdx)}
              className="p-1.5 rounded text-slate-400 hover:text-red-600"
              aria-label={t('routeDetail.remove')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        <Button
          variant="outline"
          onClick={() => { resetNewForm(); setShowAddForm(false); }}
        >
          {t('routeDetail.cancel')}
        </Button>
        {isEditing ? (
          <Button onClick={applyEditWaypoint} disabled={!canSubmit}>
            <Save className="w-4 h-4 mr-1.5" aria-hidden />
            {t('routeDetail.saveChanges')}
          </Button>
        ) : (
          <Button onClick={addWaypoint} disabled={!canSubmit}>
            <Plus className="w-4 h-4 mr-1.5" aria-hidden />
            {t('routeDetail.add')}
          </Button>
        )}
      </div>
    </div>
  );
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <Dialog
      open={!!routeId}
      onOpenChange={o => { if (!o) onClose(); }}
      title={route?.name ?? t('routeDetail.detailTitle')}
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
          <span className="ml-3 text-sm text-slate-500">{t('routeDetail.loading')}</span>
        </div>
      ) : error ? (
        <ErrorAlert error={error} icon />
      ) : route ? (
        <div className="space-y-8">
          {/* Route summary header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <MapPin className="w-4 h-4 text-teal-500" aria-hidden />
              <span>{t('routeDetail.baseFare')} : <strong className="text-slate-900 dark:text-white">{formatXof(route.basePrice)}</strong></span>
            </div>
            <Button
              variant="outline"
              onClick={() => onEditRoute(route.id)}
            >
              <Pencil className="w-4 h-4 mr-1.5" aria-hidden />
              {t('routeDetail.edit')}
            </Button>
          </div>

          {/* ── Section 1: Escales ────────────────────────────────────── */}
          <section aria-label={t('routeDetail.stopsTitle')}>
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wide">
                {t('routeDetail.stopsTitle')} ({waypoints.length})
              </h3>
              <div className="flex items-center gap-2 flex-wrap">
                {!showAddForm && !isEditing && waypoints.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={recalibrate}
                    disabled={recalibBusy}
                    className="inline-flex items-center gap-1.5"
                    title={t('routeDetail.recalibrateTooltip')}
                  >
                    {recalibBusy
                      ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      : <Zap className="h-4 w-4" aria-hidden />}
                    {recalibBusy ? t('routeDetail.recalibrating') : t('routeDetail.recalibrate')}
                  </Button>
                )}
                {!showAddForm && !isEditing && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={detectTolls}
                    disabled={detectBusy}
                    className="inline-flex items-center gap-1.5"
                    title={t('routeDetail.detectTollsTooltip')}
                  >
                    {detectBusy
                      ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      : <Coins className="h-4 w-4" aria-hidden />}
                    {t('routeDetail.detectTolls')}
                  </Button>
                )}
                {!showAddForm && !isEditing && (
                  <Button variant="outline" onClick={() => { resetNewForm(); setShowAddForm(true); }}>
                    <Plus className="w-4 h-4 mr-1.5" aria-hidden />
                    {t('routeDetail.addStop')}
                  </Button>
                )}
              </div>
            </div>

            {/* Badge incohérence — CTA vers le recalibrage */}
            {monotonyBreaks.length > 0 && !recalibBusy && (
              <button
                type="button"
                onClick={recalibrate}
                className="mb-3 flex w-full items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-left text-sm text-red-900 transition-colors hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/60"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <div className="flex-1">
                  <p className="font-medium">
                    {t('routeDetail.monotonyBreakTitle').replace('{n}', String(monotonyBreaks.length))}
                  </p>
                  <p className="mt-0.5 text-xs opacity-80">{t('routeDetail.monotonyBreakCta')}</p>
                </div>
                <Zap className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              </button>
            )}

            {/* Feedback du recalibrage */}
            {recalibMsg && (
              <div
                role={recalibMsg.kind === 'err' ? 'alert' : 'status'}
                className={`mb-3 flex items-start gap-2 rounded-md border p-3 text-sm ${
                  recalibMsg.kind === 'ok'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                    : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200'
                }`}
              >
                {recalibMsg.kind === 'ok'
                  ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
                <span>{recalibMsg.text}</span>
              </div>
            )}

            {/* Panneau Péages détectés — après clic sur « Détecter » */}
            {detectedTolls !== null && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-100">
                    <Coins className="h-4 w-4" aria-hidden />
                    {t('routeDetail.detectTollsFound').replace('{n}', String(detectedTolls.length))}
                  </h4>
                  <button
                    type="button"
                    onClick={() => { setDetectedTolls(null); setTollSelection(new Set()); }}
                    className="text-xs text-amber-900 underline hover:no-underline dark:text-amber-100"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
                {detectedTolls.length === 0 ? (
                  <p className="text-xs text-amber-900 dark:text-amber-100">
                    {t('routeDetail.detectTollsEmpty')}
                  </p>
                ) : (
                  <>
                    <ul className="space-y-1.5">
                      {detectedTolls.map(d => (
                        <li key={d.tollPointId}
                          className="flex items-center gap-2 rounded-md bg-white/80 px-2 py-1.5 text-xs dark:bg-slate-900/60"
                        >
                          <input
                            type="checkbox"
                            checked={tollSelection.has(d.tollPointId)}
                            disabled={d.alreadyLinked}
                            onChange={e => {
                              const next = new Set(tollSelection);
                              if (e.target.checked) next.add(d.tollPointId); else next.delete(d.tollPointId);
                              setTollSelection(next);
                            }}
                          />
                          <span className="flex-1 font-medium text-slate-900 dark:text-slate-100">{d.name}</span>
                          <span className="text-slate-500 dark:text-slate-400">@{d.distanceFromOriginKm} km</span>
                          <span className="text-slate-500 dark:text-slate-400">±{d.matchDistanceKm} km</span>
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {d.tollCostXaf.toLocaleString('fr-FR')} XAF
                          </span>
                          {d.alreadyLinked && (
                            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                              {t('routeDetail.detectTollsAlreadyLinked')}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                    {tollSelection.size > 0 && (
                      <div className="mt-3 flex justify-end">
                        <Button
                          type="button"
                          onClick={attachSelectedTolls}
                          disabled={detectBusy}
                          size="sm"
                        >
                          {detectBusy
                            ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" aria-hidden />
                            : <Plus className="h-4 w-4 mr-1.5" aria-hidden />}
                          {t('routeDetail.attachTolls').replace('{n}', String(tollSelection.size))}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Quick-add dropdown */}
            {!showAddForm && !isEditing && availableForAdd.length > 0 && (
              <div className="mb-3">
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  {t('routeDetail.quickAdd')}
                </label>
                <select
                  value=""
                  onChange={e => quickAddStation(e.target.value)}
                  className={`${inputClass} max-w-xs`}
                >
                  <option value="">{t('routeDetail.quickAddPlaceholder')}</option>
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
                {t('routeDetail.savedSuccess')}
              </div>
            )}

            {/* Waypoints visual list */}
            <div className="space-y-1">
              {/* Origin */}
              <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800">
                <div className="w-6 h-6 rounded-full bg-teal-500 text-white flex items-center justify-center text-xs font-bold shrink-0">O</div>
                <span className="text-sm font-medium text-teal-800 dark:text-teal-200">{stationLabel(route.origin)}</span>
                <Badge variant="info" size="sm">{t('routeDetail.origin')}</Badge>
              </div>

              {/* Waypoints */}
              {waypoints.map((wp, idx) => {
                const kindMeta = KIND_OPTIONS.find(k => k.value === (wp.kind ?? 'STATION'));
                const KindIcon = kindMeta?.icon ?? MapPin;
                const isStation = !wp.kind || wp.kind === 'STATION';
                return (
                <div key={(wp.stationId ?? wp.name ?? '') + idx}>
                  <div className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${editingIdx === idx ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700' : isStation ? 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700' : 'bg-orange-50 dark:bg-orange-900/10 border-orange-200 dark:border-orange-800'}`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${isStation ? 'bg-slate-300 dark:bg-slate-600' : 'bg-orange-200 dark:bg-orange-700'}`}>
                      <KindIcon className="w-3.5 h-3.5 text-slate-700 dark:text-slate-200" aria-hidden />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {isStation ? stationLabel(wp.station) : wp.name}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-0.5">
                        {!isStation && kindMeta && (
                          <Badge variant="warning" size="sm">{t(kindMeta.labelKey)}</Badge>
                        )}
                        <span className="text-xs text-slate-500">{wp.distanceFromOriginKm} {t('routeDetail.unitKm')}</span>
                        {isStation && wp.isMandatoryStop && <Badge variant="warning" size="sm">{t('routeDetail.mandatoryBadge')}</Badge>}
                        {(wp.estimatedWaitTime ?? 0) > 0 && (
                          <span className="text-xs text-slate-500">~{wp.estimatedWaitTime} {t('routeDetail.unitMin')}</span>
                        )}
                        {wp.tollCostXaf > 0 && (
                          <Badge variant="default" size="sm">{t('routeDetail.cpPeage')} {formatXof(wp.tollCostXaf)}</Badge>
                        )}
                        {isStation && Array.isArray(wp.checkpointCosts) && wp.checkpointCosts.length > 0 && (
                          <Badge variant="default" size="sm">
                            {wp.checkpointCosts.length} {wp.checkpointCosts.length > 1 ? t('routeDetail.checkpointsPlural') : t('routeDetail.checkpointSingular')}
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
                        title={t('routeDetail.moveUp')}
                        aria-label={t('routeDetail.moveUp')}
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveWaypoint(idx, 1)}
                        disabled={idx === waypoints.length - 1}
                        className="p-1 rounded text-slate-400 hover:text-slate-600 disabled:opacity-30"
                        title={t('routeDetail.moveDown')}
                        aria-label={t('routeDetail.moveDown')}
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
                        title={t('routeDetail.editWp')}
                        aria-label={t('routeDetail.editWp')}
                      >
                        {editingIdx === idx ? <X className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeWaypoint(idx)}
                        className="p-1 rounded text-slate-400 hover:text-red-600"
                        title={t('routeDetail.remove')}
                        aria-label={t('routeDetail.remove')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {/* Inline edit form for this waypoint */}
                  {editingIdx === idx && renderWaypointForm()}
                </div>
              );
              })}

              {/* Destination */}
              <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800">
                <div className="w-6 h-6 rounded-full bg-teal-500 text-white flex items-center justify-center text-xs font-bold shrink-0">D</div>
                <span className="text-sm font-medium text-teal-800 dark:text-teal-200">{stationLabel(route.destination)}</span>
                <Badge variant="info" size="sm">{t('routeDetail.destination')}</Badge>
              </div>
            </div>

            {/* Add waypoint form (outside list) */}
            {showAddForm && !isEditing && renderWaypointForm()}

            {/* Save waypoints */}
            <div className="flex justify-end mt-3">
              <Button onClick={saveWaypoints} disabled={wpBusy}>
                <Save className="w-4 h-4 mr-1.5" aria-hidden />
                {wpBusy ? t('routeDetail.saving') : t('routeDetail.saveStops')}
              </Button>
            </div>
          </section>

          {/* ── Section 2: Tarifs par segment ─────────────────────────── */}
          <section aria-label={t('routeDetail.segmentTitle')}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wide">
                {t('routeDetail.segmentTitle')}
              </h3>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {priceStats.configured}/{priceStats.total} {priceStats.configured > 1 ? t('routeDetail.configuredPlural') : t('routeDetail.configured')}
              </span>
            </div>

            <ErrorAlert error={priceError} icon />

            {priceSuccess && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300 mb-3">
                <CheckCircle2 className="w-4 h-4" aria-hidden />
                {t('routeDetail.savedPricesSuccess')}
              </div>
            )}

            {prices.length === 0 ? (
              <div className="text-center py-8 text-slate-500 dark:text-slate-400 text-sm">
                <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-amber-500" aria-hidden />
                <p>{t('routeDetail.noSegments')}</p>
              </div>
            ) : (
              <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-900/50 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        <th className="text-left px-4 py-2">{t('routeDetail.from')}</th>
                        <th className="text-left px-4 py-2">{t('routeDetail.to')}</th>
                        <th className="text-right px-4 py-2 w-48">{t('routeDetail.priceXaf')}</th>
                        <th className="text-center px-4 py-2 w-20">{t('routeDetail.status')}</th>
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
                                <Badge variant="success" size="sm">{t('routeDetail.ok')}</Badge>
                              ) : (
                                <Badge variant="warning" size="sm">{t('routeDetail.notConfigured')}</Badge>
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
                  {priceBusy ? t('routeDetail.saving') : t('routeDetail.savePrices')}
                </Button>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </Dialog>
  );
}
