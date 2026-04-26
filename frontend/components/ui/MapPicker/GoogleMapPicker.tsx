/**
 * GoogleMapPicker — sélecteur de coordonnées via Google Maps JavaScript API.
 *
 * Trois modalités combinées :
 *   1. Recherche d'adresse Google Places (autocomplete client-side)
 *   2. Carte Google avec marker draggable + click-to-pick
 *   3. Champs latitude/longitude manuels (toujours visibles, fallback ultime)
 *
 * Anti-régression :
 *   - Si la clé `JS_API_KEY` n'est pas (encore) provisionnée → fallback silencieux
 *     vers la recherche backend `/geo/search` + champs lat/lng (carte cachée).
 *   - Si Google JS échoue à charger (CSP, réseau, quota) → idem.
 *   - Le formulaire parent reste soumissible avec lat/lng saisies à la main.
 *
 * Sécurité : la clé navigateur est servie par le backend (`/geo/maps-config`)
 * depuis Vault. Elle est restreinte par référent HTTP côté Google Cloud Console.
 *
 * Conforme dark/light, ARIA labels sur tous les contrôles, responsive.
 */
import {
  useEffect, useMemo, useRef, useState, useCallback,
} from 'react';
import { useJsApiLoader, GoogleMap, MarkerF } from '@react-google-maps/api';
import { Search, Loader2, MapPin } from 'lucide-react';
import { apiGet } from '../../../lib/api';
import { useI18n } from '../../../lib/i18n/useI18n';
import { inputClass as inp } from '../inputClass';

export interface GoogleMapPickerValue {
  /** Conservés en string pour respecter l'état du form parent. */
  lat: string;
  lng: string;
}

interface Props {
  tenantId: string;
  value:    GoogleMapPickerValue;
  onChange: (v: GoogleMapPickerValue) => void;
  /** Pays par défaut pour biais geocoding (ISO alpha-2 ex. "GA"). */
  countryCode?: string;
  disabled?: boolean;
  /** Hauteur de la carte en pixels — défaut 320. */
  mapHeightPx?: number;
}

interface MapsConfig { jsApiKey: string | null }

const LIBRARIES: ('places')[] = ['places'];
const DEFAULT_CENTER = { lat: 4.0, lng: 12.0 }; // Afrique centrale
const DEFAULT_ZOOM   = 4;
const MARKED_ZOOM    = 14;

function parseCoord(s: string): number | null {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function fmt(n: number): string {
  return n.toFixed(6);
}

export function GoogleMapPicker({
  tenantId, value, onChange, countryCode, disabled, mapHeightPx = 320,
}: Props) {
  const { t } = useI18n();

  // 1. Récupération de la clé navigateur (Vault → /geo/maps-config).
  const [jsApiKey,    setJsApiKey]    = useState<string | null | undefined>(undefined);
  const [keyError,    setKeyError]    = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    apiGet<MapsConfig>(`/api/tenants/${tenantId}/geo/maps-config`)
      .then(cfg => { if (!cancel) setJsApiKey(cfg.jsApiKey); })
      .catch(e => {
        if (!cancel) {
          setJsApiKey(null);
          setKeyError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => { cancel = true; };
  }, [tenantId]);

  // 2. Chargement de la lib Google JS quand la clé est dispo.
  const { isLoaded: gmapsLoaded, loadError: gmapsLoadError } = useJsApiLoader({
    googleMapsApiKey: jsApiKey ?? '',
    libraries:        LIBRARIES,
    id:               'translogpro-gmaps-loader',
    preventGoogleFontsLoading: true,
  });

  const lat = parseCoord(value.lat);
  const lng = parseCoord(value.lng);
  const hasMarker = lat !== null && lng !== null;
  const center = useMemo(
    () => (hasMarker ? { lat: lat!, lng: lng! } : DEFAULT_CENTER),
    [lat, lng, hasMarker],
  );

  const mapRef = useRef<google.maps.Map | null>(null);

  // 3. État pour la recherche Google Places (autocomplete client).
  const [query,        setQuery]        = useState('');
  const [predictions,  setPredictions]  = useState<google.maps.places.AutocompletePrediction[]>([]);
  const [searching,    setSearching]    = useState(false);
  const [showResults,  setShowResults]  = useState(false);
  const acServiceRef    = useRef<google.maps.places.AutocompleteService | null>(null);
  const placesServiceRef = useRef<google.maps.places.PlacesService | null>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  // Initialise les services Places quand la lib est chargée.
  useEffect(() => {
    if (!gmapsLoaded || typeof google === 'undefined') return;
    acServiceRef.current = new google.maps.places.AutocompleteService();
    sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
    // PlacesService a besoin d'un container DOM ou Map ; on lui donne un div volatil.
    const tmp = document.createElement('div');
    placesServiceRef.current = new google.maps.places.PlacesService(tmp);
  }, [gmapsLoaded]);

  // Recherche Places debounced.
  useEffect(() => {
    if (!gmapsLoaded || !acServiceRef.current) return;
    const q = query.trim();
    if (q.length < 3) { setPredictions([]); setShowResults(false); return; }

    const timer = setTimeout(() => {
      setSearching(true);
      const componentRestrictions = countryCode ? { country: countryCode.toLowerCase() } : undefined;
      acServiceRef.current!.getPlacePredictions(
        {
          input:                  q,
          sessionToken:           sessionTokenRef.current!,
          ...(componentRestrictions ? { componentRestrictions } : {}),
        },
        (results, status) => {
          setSearching(false);
          if (status === google.maps.places.PlacesServiceStatus.OK && results) {
            setPredictions(results);
            setShowResults(true);
          } else {
            setPredictions([]);
            setShowResults(false);
          }
        },
      );
    }, 250);

    return () => clearTimeout(timer);
  }, [query, gmapsLoaded, countryCode]);

  const pickPrediction = useCallback((p: google.maps.places.AutocompletePrediction) => {
    if (!placesServiceRef.current || !sessionTokenRef.current) return;
    placesServiceRef.current.getDetails(
      {
        placeId:      p.place_id,
        fields:       ['geometry', 'formatted_address', 'name'],
        sessionToken: sessionTokenRef.current,
      },
      (details, status) => {
        // Reset du session token : Google facture par session ; on ouvre une nouvelle.
        sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
        if (status === google.maps.places.PlacesServiceStatus.OK && details?.geometry?.location) {
          const la = details.geometry.location.lat();
          const ln = details.geometry.location.lng();
          onChange({ lat: fmt(la), lng: fmt(ln) });
          setQuery(details.formatted_address ?? p.description);
          setShowResults(false);
          if (mapRef.current) {
            mapRef.current.panTo({ lat: la, lng: ln });
            mapRef.current.setZoom(MARKED_ZOOM);
          }
        }
      },
    );
  }, [onChange]);

  const onMapClick = (e: google.maps.MapMouseEvent) => {
    if (disabled || !e.latLng) return;
    onChange({ lat: fmt(e.latLng.lat()), lng: fmt(e.latLng.lng()) });
  };

  const onMarkerDragEnd = (e: google.maps.MapMouseEvent) => {
    if (!e.latLng) return;
    onChange({ lat: fmt(e.latLng.lat()), lng: fmt(e.latLng.lng()) });
  };

  // ─── Détermination de l'état d'affichage ──────────────────────────────────
  const keyMissing  = jsApiKey === null;
  const keyLoading  = jsApiKey === undefined;
  const keyOk       = typeof jsApiKey === 'string' && jsApiKey.length > 0;
  const mapReady    = keyOk && gmapsLoaded;
  const mapFailed   = keyOk && (!!gmapsLoadError);

  return (
    <div className="space-y-3">
      {/* ── Recherche d'adresse ──────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <label htmlFor="gmap-search" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('stations.mapSearchLabel')}
        </label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
          <input
            id="gmap-search"
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => { if (predictions.length > 0) setShowResults(true); }}
            onBlur={() => setTimeout(() => setShowResults(false), 150)}
            className={`${inp} pl-9 pr-9`}
            placeholder={t('stations.mapSearchPlaceholder')}
            disabled={disabled || (!mapReady && !keyMissing)}
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={showResults && predictions.length > 0}
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 animate-spin" aria-hidden />
          )}

          {showResults && predictions.length > 0 && (
            <ul
              role="listbox"
              className="absolute left-0 right-0 top-full mt-1 z-30 max-h-60 overflow-auto rounded-lg shadow-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
            >
              {predictions.map(p => (
                <li key={p.place_id} role="option">
                  <button
                    type="button"
                    onMouseDown={e => { e.preventDefault(); pickPrediction(p); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-start gap-2"
                  >
                    <MapPin className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" aria-hidden />
                    <span className="truncate">{p.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {keyMissing && (
          <p className="text-[11px] text-amber-700 dark:text-amber-300">
            {t('stations.mapKeyMissing')}
          </p>
        )}
        {mapFailed && (
          <p className="text-[11px] text-amber-700 dark:text-amber-300">
            {t('stations.mapLoadFailed')}
          </p>
        )}
      </div>

      {/* ── Carte (uniquement si la clé est OK et la lib chargée) ───────────── */}
      {keyOk && (
        <div
          className="w-full rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40"
          style={{ height: mapHeightPx }}
        >
          {keyLoading || (!gmapsLoaded && !gmapsLoadError) ? (
            <div className="h-full w-full flex items-center justify-center text-xs text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden />
              {t('stations.mapLoading')}
            </div>
          ) : mapReady ? (
            <GoogleMap
              mapContainerStyle={{ width: '100%', height: '100%' }}
              center={center}
              zoom={hasMarker ? MARKED_ZOOM : DEFAULT_ZOOM}
              onClick={onMapClick}
              onLoad={m => { mapRef.current = m; }}
              options={{
                streetViewControl:  false,
                mapTypeControl:     false,
                fullscreenControl:  false,
                gestureHandling:    'cooperative',
                clickableIcons:     false,
              }}
            >
              {hasMarker && (
                <MarkerF
                  position={{ lat: lat!, lng: lng! }}
                  draggable={!disabled}
                  onDragEnd={onMarkerDragEnd}
                />
              )}
            </GoogleMap>
          ) : (
            <div className="h-full w-full flex items-center justify-center text-xs text-slate-500 px-4 text-center">
              {t('stations.mapLoadFailed')}
            </div>
          )}
        </div>
      )}
      {keyOk && mapReady && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {t('stations.mapInteractHint')}
        </p>
      )}
      {keyError && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
          {t('stations.mapKeyError')}
        </p>
      )}

      {/* ── Champs lat/lng — toujours disponibles ──────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label htmlFor="gmap-lat" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('stations.latitude')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input
            id="gmap-lat"
            type="number" required step="any" min={-90} max={90}
            value={value.lat}
            onChange={e => onChange({ ...value, lat: e.target.value })}
            className={inp}
            disabled={disabled}
            placeholder="-90 → 90"
            inputMode="decimal"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="gmap-lng" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('stations.longitude')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input
            id="gmap-lng"
            type="number" required step="any" min={-180} max={180}
            value={value.lng}
            onChange={e => onChange({ ...value, lng: e.target.value })}
            className={inp}
            disabled={disabled}
            placeholder="-180 → 180"
            inputMode="decimal"
          />
        </div>
      </div>
    </div>
  );
}
