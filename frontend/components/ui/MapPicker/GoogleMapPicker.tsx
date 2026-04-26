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
  disabled?: boolean;
  /** Hauteur de la carte en pixels — défaut 320. */
  mapHeightPx?: number;
}

type CountryBounds = { north: number; south: number; east: number; west: number };

interface MapsConfig {
  jsApiKey:      string | null;
  countryCode?:  string | null;
  countryBounds?: { north: number; south: number; east: number; west: number } | null;
}

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

/**
 * Wrapper public : récupère la clé navigateur depuis Vault et délègue au composant
 * interne UNIQUEMENT quand la clé est résolue. Sinon affiche le fallback (recherche
 * + lat/lng manuels).
 *
 * Critique : on ne doit JAMAIS appeler `useJsApiLoader` avec une clé vide puis avec
 * la vraie — le loader cache ses options au premier appel et refuse tout changement
 * (erreur "Loader must not be called again with different options"). D'où le split
 * en deux composants.
 */
export function GoogleMapPicker(props: Props) {
  const { t } = useI18n();
  const [config,   setConfig]   = useState<MapsConfig | null | undefined>(undefined);
  const [keyError, setKeyError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    apiGet<MapsConfig>(`/api/tenants/${props.tenantId}/geo/maps-config`)
      .then(cfg => { if (!cancel) setConfig(cfg); })
      .catch(e => {
        if (!cancel) {
          setConfig(null);
          setKeyError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => { cancel = true; };
  }, [props.tenantId]);

  const jsApiKey = config?.jsApiKey ?? null;
  const bounds   = config?.countryBounds ?? null;

  // Tant que la clé est en cours de récupération OU absente : fallback champs lat/lng.
  if (typeof jsApiKey !== 'string' || jsApiKey.length === 0) {
    return (
      <FallbackPicker
        value={props.value}
        onChange={props.onChange}
        disabled={props.disabled}
        loading={config === undefined}
        keyMissing={config !== undefined && jsApiKey === null}
        keyError={keyError}
        t={t}
      />
    );
  }

  return <GoogleMapPickerInner {...props} jsApiKey={jsApiKey} countryBounds={bounds} />;
}

/**
 * Composant interne — la clé est garantie non-vide. C'est ici qu'on appelle
 * `useJsApiLoader`, exactement une fois pour la durée de vie du composant.
 */
function GoogleMapPickerInner({
  value, onChange, disabled, mapHeightPx = 320, jsApiKey, countryBounds,
}: Props & { jsApiKey: string; countryBounds: CountryBounds | null }) {
  const { t } = useI18n();

  const { isLoaded: gmapsLoaded, loadError: gmapsLoadError } = useJsApiLoader({
    googleMapsApiKey: jsApiKey,
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

  // État pour la recherche Google Places (autocomplete client).
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
      // Bias SOFT par bounding box du pays : les resultats dans la box remontent
      // mais ceux a l'exterieur restent visibles (`location` + `radius` ou
      // `bounds` sans `strictBounds:true` = preference, pas filtre).
      const bias: google.maps.places.AutocompletionRequest = {
        input:        q,
        sessionToken: sessionTokenRef.current!,
      };
      if (countryBounds) {
        bias.bounds = new google.maps.LatLngBounds(
          { lat: countryBounds.south, lng: countryBounds.west },
          { lat: countryBounds.north, lng: countryBounds.east },
        );
        // strictBounds NON spécifié → bias soft, n'exclut pas les resultats hors box.
      }
      acServiceRef.current!.getPlacePredictions(
        bias,
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
  }, [query, gmapsLoaded, countryBounds]);

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

  const mapReady  = gmapsLoaded && !gmapsLoadError;
  const mapFailed = !!gmapsLoadError;

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
            disabled={disabled || !mapReady}
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
        {mapFailed && (
          <p className="text-[11px] text-amber-700 dark:text-amber-300">
            {t('stations.mapLoadFailed')}
          </p>
        )}
      </div>

      {/* ── Carte ──────────────────────────────────────────────────────────── */}
      <div
        className="w-full rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40"
        style={{ height: mapHeightPx }}
      >
        {!gmapsLoaded && !gmapsLoadError ? (
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
      {mapReady && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {t('stations.mapInteractHint')}
        </p>
      )}

      {/* ── Champs lat/lng — toujours disponibles ──────────────────────────── */}
      <CoordinateInputs value={value} onChange={onChange} disabled={disabled} t={t} />
    </div>
  );
}

/**
 * Pickers de fallback : pas de carte Google. Affiche juste les champs lat/lng
 * (et un message si la clé est manquante / en cours de chargement).
 */
function FallbackPicker({
  value, onChange, disabled, loading, keyMissing, keyError, t,
}: {
  value:      GoogleMapPickerValue;
  onChange:   (v: GoogleMapPickerValue) => void;
  disabled?:  boolean;
  loading:    boolean;
  keyMissing: boolean;
  keyError:   string | null;
  t:          (k: string) => string;
}) {
  return (
    <div className="space-y-3">
      {loading && (
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
          {t('stations.mapLoading')}
        </div>
      )}
      {keyMissing && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/10 p-3 text-xs text-amber-800 dark:text-amber-200">
          {t('stations.mapKeyMissing')}
        </div>
      )}
      {keyError && !keyMissing && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
          {t('stations.mapKeyError')}
        </p>
      )}
      <CoordinateInputs value={value} onChange={onChange} disabled={disabled} t={t} />
    </div>
  );
}

/**
 * Champs lat/lng manuels — partagés par GoogleMapPickerInner et FallbackPicker.
 */
function CoordinateInputs({
  value, onChange, disabled, t,
}: {
  value:    GoogleMapPickerValue;
  onChange: (v: GoogleMapPickerValue) => void;
  disabled?: boolean;
  t:        (k: string) => string;
}) {
  return (
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
  );
}
