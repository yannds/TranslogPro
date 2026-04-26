/**
 * CityCombobox — autocomplete ville dédié au formulaire station.
 *
 * Différences vs `ComboboxEditable` :
 *   - Le dropdown est rendu **inline dans le wrapper** (pas via createPortal au body).
 *     C'est ce qui permet à `onMouseDown` de bloquer le blur de l'input et donc
 *     au clic de fonctionner sans avoir à valider au clavier.
 *   - L'option sélectionnée est figée par un ref `lastPickedRef` consulté dans
 *     `handleBlur` — même si une closure obsolète déclenchait `onChange`, le
 *     contenu choisi est restauré.
 *
 * Le dropdown s'auto-positionne au-dessus de l'input s'il dépasse en bas du
 * viewport (utile dans les modales partiellement visibles).
 *
 * Conforme WCAG AA : combobox/listbox ARIA, clavier complet (↑/↓/Enter/Esc),
 * `aria-activedescendant`. Variant dark inclus.
 */
import {
  useState, useRef, useEffect, useCallback, useId, useMemo,
  type KeyboardEvent, type ChangeEvent,
} from 'react';
import { ChevronDown, AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { inputClass as inp } from './inputClass';

export interface CityOption {
  /** Valeur stockée (ville canonique, ex. "Bitam") */
  value: string;
  /** Libellé principal affiché en gras */
  label: string;
  /** Sous-texte (ex. "Woleu-Ntem, Gabon") */
  hint?: string;
  /** Drapeau emoji du pays */
  flag?: string;
}

interface Props {
  value:           string;
  onChange:        (value: string) => void;
  onSearch:        (query: string) => Promise<CityOption[]>;
  searchDebounceMs?: number;
  /** Affiche un avertissement quand la valeur tapée n'a pas été choisie dans la liste. */
  freeTextWarning?: string;
  placeholder?:    string;
  disabled?:       boolean;
  required?:       boolean;
  label?:          string;
  className?:      string;
  /** id du champ pour les form-labels externes */
  id?:             string;
}

const DEBOUNCE_DEFAULT = 350;
const MIN_QUERY        = 2;

export function CityCombobox({
  value, onChange, onSearch,
  searchDebounceMs = DEBOUNCE_DEFAULT,
  freeTextWarning,
  placeholder, disabled, required, label, className, id: idProp,
}: Props) {
  const reactId = useId();
  const id = idProp ?? `city-${reactId}`;
  const listboxId = `${id}-listbox`;

  const inputRef     = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef  = useRef<HTMLUListElement>(null);
  const lastPickedRef = useRef<string | null>(null);

  const [inputText,    setInputText]    = useState(value);
  const [open,         setOpen]         = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [results,      setResults]      = useState<CityOption[]>([]);
  const [searching,    setSearching]    = useState(false);
  const [openUpward,   setOpenUpward]   = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const skipSearchRef = useRef(false);

  // Sync externe → input quand le user n'est pas en train de taper.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setInputText(value);
  }, [value]);

  // Recherche debounced.
  useEffect(() => {
    if (skipSearchRef.current) { skipSearchRef.current = false; return; }
    const q = inputText.trim();
    if (q.length < MIN_QUERY) { setResults([]); return; }

    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setSearching(true);
      try {
        const data = await onSearch(q);
        if (!ac.signal.aborted) {
          setResults(data);
          if (data.length > 0) setOpen(true);
        }
      } catch {
        if (!ac.signal.aborted) setResults([]);
      } finally {
        if (!ac.signal.aborted) setSearching(false);
      }
    }, searchDebounceMs);

    return () => { clearTimeout(timer); abortRef.current?.abort(); };
  }, [inputText, onSearch, searchDebounceMs]);

  // Décide si le dropdown doit s'ouvrir vers le haut (peu de place en bas).
  useEffect(() => {
    if (!open || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    setOpenUpward(spaceBelow < 240 && spaceAbove > spaceBelow);
  }, [open, results.length]);

  // Sélection d'une option : on figerait la valeur même si onBlur passait après.
  const pick = useCallback((opt: CityOption) => {
    skipSearchRef.current = true;
    lastPickedRef.current = opt.value;
    setInputText(opt.label);
    onChange(opt.value);
    setOpen(false);
    setHighlightIdx(-1);
  }, [onChange]);

  // Sur blur : commit free-text **sauf** si on vient juste de pick().
  const handleBlur = useCallback(() => {
    setTimeout(() => {
      if (containerRef.current?.contains(document.activeElement)) return;
      setOpen(false);
      const picked = lastPickedRef.current;
      if (picked !== null) {
        // Une option a été choisie depuis la dernière saisie — on la respecte.
        lastPickedRef.current = null;
        return;
      }
      // Free-text : on commit ce qui est tapé.
      const trimmed = inputText.trim();
      if (trimmed && trimmed !== value) onChange(trimmed);
    }, 120);
  }, [inputText, value, onChange]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && results.length > 0) {
      setOpen(true); return;
    }
    if (!open) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIdx(prev => Math.min(prev + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIdx(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        if (highlightIdx >= 0 && highlightIdx < results.length) {
          e.preventDefault();
          pick(results[highlightIdx]);
        }
        break;
      case 'Escape':
        setOpen(false);
        setHighlightIdx(-1);
        break;
    }
  };

  // Quand le user tape à nouveau, on invalide le "lastPicked" pour repasser en free-text.
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    setHighlightIdx(-1);
    lastPickedRef.current = null;
    if (!open) setOpen(true);
  };

  const isUnmatched = useMemo(() => {
    if (!freeTextWarning) return false;
    const t = inputText.trim();
    if (!t) return false;
    return !results.some(o => o.label === t || o.value === t);
  }, [freeTextWarning, inputText, results]);

  const showDropdown = open && results.length > 0;
  const activeId = highlightIdx >= 0 ? `${id}-opt-${highlightIdx}` : undefined;

  return (
    <div ref={containerRef} className={cn('relative flex flex-col gap-1', className)}>
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {label}
          {required && <span className="ml-1 text-red-500" aria-hidden>*</span>}
        </label>
      )}

      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={inputText}
          onChange={handleChange}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className={cn(inp, 'pr-9')}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          autoComplete="off"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
        />
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={e => e.preventDefault()}
          onClick={() => {
            if (disabled) return;
            if (open) { setOpen(false); }
            else if (results.length > 0) { setOpen(true); inputRef.current?.focus(); }
            else { inputRef.current?.focus(); }
          }}
          className="absolute right-0 top-0 h-full px-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          aria-label="Ouvrir les suggestions"
          disabled={disabled}
        >
          {searching
            ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
            : <ChevronDown className={cn('w-4 h-4 transition-transform', open && 'rotate-180')} aria-hidden />
          }
        </button>

        {showDropdown && (
          <ul
            ref={dropdownRef}
            id={listboxId}
            role="listbox"
            className={cn(
              'absolute left-0 right-0 z-30 max-h-60 overflow-auto rounded-lg shadow-xl',
              'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700',
              openUpward ? 'bottom-full mb-1' : 'top-full mt-1',
            )}
          >
            {results.map((opt, i) => (
              <li
                key={`${opt.value}-${i}`}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={highlightIdx === i}
              >
                <button
                  type="button"
                  // onMouseDown empêche l'input de perdre le focus avant que pick() exécute.
                  onMouseDown={e => { e.preventDefault(); pick(opt); }}
                  onMouseEnter={() => setHighlightIdx(i)}
                  className={cn(
                    'w-full text-left px-3 py-2 text-sm flex flex-col transition-colors',
                    highlightIdx === i
                      ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-900 dark:text-teal-100'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800',
                  )}
                >
                  <span className="truncate font-medium">{opt.label}</span>
                  {opt.hint && (
                    <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                      {opt.flag && <span className="mr-1">{opt.flag}</span>}
                      {opt.hint}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {isUnmatched && freeTextWarning && !open && (
        <div className="flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" aria-hidden />
          <p className="text-xs text-amber-700 dark:text-amber-300">{freeTextWarning}</p>
        </div>
      )}
    </div>
  );
}
