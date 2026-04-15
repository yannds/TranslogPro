/**
 * LocationPicker — sélecteur de coordonnées avec 3 modalités :
 *   1. Recherche d'adresse (proxy Nominatim) → autocomplete
 *   2. Carte OSM cliquable / marker draggable (chargée en lazy)
 *   3. Champs latitude/longitude manuels (toujours disponibles en fallback)
 *
 * Design anti-régression :
 *   - Si le bundle Leaflet échoue (offline, CSP), les champs lat/lng restent utilisables.
 *   - Si le géocodage échoue (réseau, quota), la recherche se désactive silencieusement.
 *   - La modale parente n'a aucune dépendance à la carte pour soumettre un form.
 */
import {
  lazy, Suspense, useEffect, useRef, useState, Component,
  type ReactNode,
} from 'react';
import { MapPin, Search, Loader2 } from 'lucide-react';
import { apiGet } from '../../../lib/api';
import { inputClass as inp } from '../inputClass';

const LocationMap = lazy(() => import('./LocationMap'));

interface GeoResult {
  displayName: string;
  lat:         number;
  lng:         number;
}

interface SearchResponse { results: GeoResult[] }

export interface LocationPickerValue {
  lat: string;  // kept as string to mirror existing form state
  lng: string;
}

interface Props {
  tenantId:  string;
  value:     LocationPickerValue;
  onChange:  (v: LocationPickerValue) => void;
  disabled?: boolean;
}

const DEBOUNCE_MS = 600;
const MIN_Q       = 3;
const MAX_Q       = 120;

class MapErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) {
      return (
        <div className="h-full w-full flex items-center justify-center text-xs text-slate-500 bg-slate-50 dark:bg-slate-900/50 rounded-md border border-dashed border-slate-300 dark:border-slate-700 p-4 text-center">
          Carte indisponible — utilisez la recherche d'adresse ou la saisie manuelle.
        </div>
      );
    }
    return this.props.children;
  }
}

function parseCoord(s: string): number | null {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function LocationPicker({ tenantId, value, onChange, disabled }: Props) {
  const [query,     setQuery]     = useState('');
  const [results,   setResults]   = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const lat = parseCoord(value.lat);
  const lng = parseCoord(value.lng);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_Q) {
      setResults([]); setSearchErr(null); setSearching(false);
      return;
    }
    if (q.length > MAX_Q) {
      setSearchErr(`Requête trop longue (max ${MAX_Q} caractères)`);
      return;
    }

    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setSearching(true); setSearchErr(null);
      try {
        const data = await apiGet<SearchResponse>(
          `/api/tenants/${tenantId}/geo/search?q=${encodeURIComponent(q)}`,
          { signal: ac.signal },
        );
        setResults(data.results ?? []);
        setShowResults(true);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setSearchErr('Recherche indisponible — saisissez les coordonnées manuellement.');
          setResults([]);
        }
      } finally {
        setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => { clearTimeout(timer); abortRef.current?.abort(); };
  }, [query, tenantId]);

  const pickResult = (r: GeoResult) => {
    onChange({ lat: String(r.lat), lng: String(r.lng) });
    setQuery(r.displayName);
    setShowResults(false);
  };

  const pickMap = (la: number, ln: number) => {
    onChange({
      lat: la.toFixed(6),
      lng: ln.toFixed(6),
    });
  };

  return (
    <div className="space-y-3">
      {/* Recherche adresse */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Rechercher une adresse
        </label>
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
            aria-hidden
          />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => results.length > 0 && setShowResults(true)}
            onBlur={() => setTimeout(() => setShowResults(false), 150)}
            className={`${inp} pl-9 pr-9`}
            placeholder="ex. Gare routière Poto-Poto, Brazzaville"
            disabled={disabled}
            maxLength={MAX_Q}
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={showResults}
          />
          {searching && (
            <Loader2
              className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 animate-spin"
              aria-hidden
            />
          )}
          {showResults && results.length > 0 && (
            <ul
              role="listbox"
              className="absolute z-20 mt-1 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg max-h-60 overflow-auto"
            >
              {results.map((r, i) => (
                <li key={`${r.lat},${r.lng},${i}`} role="option">
                  <button
                    type="button"
                    onMouseDown={e => { e.preventDefault(); pickResult(r); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 flex items-start gap-2"
                  >
                    <MapPin className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" aria-hidden />
                    <span className="truncate">{r.displayName}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {searchErr && (
          <p className="text-xs text-amber-700 dark:text-amber-300">{searchErr}</p>
        )}
      </div>

      {/* Carte — lazy + error boundary + fallback silencieux */}
      <div className="h-64 w-full rounded-md overflow-hidden border border-slate-200 dark:border-slate-700">
        <MapErrorBoundary>
          <Suspense fallback={
            <div className="h-full w-full flex items-center justify-center text-xs text-slate-500 bg-slate-50 dark:bg-slate-900/50">
              Chargement de la carte…
            </div>
          }>
            <LocationMap lat={lat} lng={lng} onPick={pickMap} className="h-full w-full" />
          </Suspense>
        </MapErrorBoundary>
      </div>
      <p className="text-[11px] text-slate-500">
        Cliquez sur la carte ou déplacez le marker pour ajuster les coordonnées.
      </p>

      {/* Champs lat/lng — toujours disponibles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Latitude <span aria-hidden className="text-red-500">*</span>
          </label>
          <input
            type="number" required step="any" min={-90} max={90}
            value={value.lat}
            onChange={e => onChange({ ...value, lat: e.target.value })}
            className={inp} disabled={disabled}
            placeholder="ex. -4.2634"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Longitude <span aria-hidden className="text-red-500">*</span>
          </label>
          <input
            type="number" required step="any" min={-180} max={180}
            value={value.lng}
            onChange={e => onChange({ ...value, lng: e.target.value })}
            className={inp} disabled={disabled}
            placeholder="ex. 15.2429"
          />
        </div>
      </div>
    </div>
  );
}
