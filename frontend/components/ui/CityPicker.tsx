/**
 * CityPicker — saisie de ville avec validation géographique.
 * Autocomplete via le proxy Nominatim du tenant. Fallback silencieux en texte libre
 * si le géocodage est indisponible. Retourne un nom de ville normalisé (string).
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, Search, Loader2, CheckCircle2 } from 'lucide-react';
import { apiGet } from '../../lib/api';
import { inputClass as inp } from './inputClass';

interface GeoResult {
  displayName: string;
  lat:         number;
  lng:         number;
}
interface SearchResponse { results: GeoResult[] }

interface Props {
  tenantId:    string;
  value:       string;
  onChange:    (city: string) => void;
  id?:         string;
  placeholder?: string;
  required?:   boolean;
  disabled?:   boolean;
}

const DEBOUNCE_MS = 500;
const MIN_Q       = 2;
const MAX_Q       = 120;

function extractCityName(displayName: string): string {
  // "Brazzaville, Pool, Republic of the Congo" → "Brazzaville"
  const parts = displayName.split(',');
  return parts[0]?.trim() ?? displayName;
}

export function CityPicker({
  tenantId, value, onChange, id, placeholder, required, disabled,
}: Props) {
  const [query,       setQuery]       = useState(value);
  const [results,     setResults]     = useState<GeoResult[]>([]);
  const [searching,   setSearching]   = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [validated,   setValidated]   = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // If the parent resets value externally, sync query
  useEffect(() => {
    if (!value) { setQuery(''); setValidated(false); }
  }, [value]);

  const updateDropdownPos = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_Q || validated) {
      setResults([]); setSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setSearching(true);
      try {
        const data = await apiGet<SearchResponse>(
          `/api/tenants/${tenantId}/geo/search?q=${encodeURIComponent(q)}`,
          { signal: ac.signal },
        );
        setResults(data.results ?? []);
        updateDropdownPos();
        setShowResults(true);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setResults([]);
      } finally {
        setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => { clearTimeout(timer); abortRef.current?.abort(); };
  }, [query, tenantId, validated]);

  const pickResult = (r: GeoResult) => {
    const city = extractCityName(r.displayName);
    setQuery(city);
    onChange(city);
    setValidated(true);
    setShowResults(false);
  };

  const handleChange = (v: string) => {
    setQuery(v);
    onChange(v);
    setValidated(false);
  };

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
        aria-hidden
      />
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={query}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => { updateDropdownPos(); if (results.length > 0) setShowResults(true); }}
        onBlur={() => setTimeout(() => setShowResults(false), 200)}
        className={`${inp} pl-9 pr-9`}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        maxLength={MAX_Q}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={showResults}
      />
      {searching && (
        <Loader2
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 animate-spin"
          aria-hidden
        />
      )}
      {validated && !searching && (
        <CheckCircle2
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-teal-500"
          aria-hidden
        />
      )}

      {showResults && results.length > 0 && dropdownPos && createPortal(
        <ul
          role="listbox"
          style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
          className="z-[100] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg max-h-60 overflow-auto"
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
        </ul>,
        document.body,
      )}
    </div>
  );
}
