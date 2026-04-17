/**
 * ComboboxEditable — Combobox éditable réutilisable
 *
 * Deux modes :
 *   - Local  : `options` passées en props, filtrage côté client
 *   - Remote : `onSearch(q)` async, résultats depuis le serveur (ex. Nominatim)
 *
 * UX :
 *   - Chaque frappe filtre/recherche la liste
 *   - Le chevron ouvre/ferme le dropdown complet
 *   - allowFreeText + freeTextWarning pour la saisie libre avec alerte
 */
import {
  useState, useRef, useEffect, useCallback, useId, useMemo,
  type KeyboardEvent, type ChangeEvent,
} from 'react';
import { ChevronDown, AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { inputClass as inp } from './inputClass';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Sous-texte optionnel (ex. pays, région) */
  hint?: string;
  /** Afficher le label en gras */
  bold?: boolean;
  /** Emoji drapeau affiché devant le hint */
  flag?: string;
}

export interface ComboboxEditableProps {
  value: string;
  onChange: (value: string) => void;
  options?: ComboboxOption[];
  onSearch?: (query: string) => Promise<ComboboxOption[]>;
  searchDebounceMs?: number;
  allowFreeText?: boolean;
  freeTextWarning?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  label?: string;
  className?: string;
  inputClassName?: string;
  labelClassName?: string;
}

const DEBOUNCE_DEFAULT = 400;

export function ComboboxEditable({
  value,
  onChange,
  options: localOptions,
  onSearch,
  searchDebounceMs = DEBOUNCE_DEFAULT,
  allowFreeText = false,
  freeTextWarning,
  placeholder,
  disabled,
  required,
  label,
  className,
  inputClassName,
  labelClassName,
}: ComboboxEditableProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [inputText, setInputText] = useState(value);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [remoteResults, setRemoteResults] = useState<ComboboxOption[]>([]);
  const [searching, setSearching] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const skipSearchRef = useRef(false);

  // Sync external value → inputText when not typing
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setInputText(value);
  }, [value]);

  // ── Filtrage local ─────────────────────────────────────────────────────────
  const filteredLocal = useMemo(() => {
    if (!localOptions) return [];
    if (showAll) return localOptions;
    const q = inputText.toLowerCase().trim();
    if (!q) return localOptions;
    return localOptions.filter(o =>
      o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [localOptions, inputText, showAll]);

  // ── Recherche remote (debounced) ───────────────────────────────────────────
  useEffect(() => {
    if (!onSearch) return;
    if (skipSearchRef.current) { skipSearchRef.current = false; return; }
    const q = inputText.trim();
    if (q.length < 2) { setRemoteResults([]); return; }

    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setSearching(true);
      try {
        const results = await onSearch(q);
        if (!ac.signal.aborted) { setRemoteResults(results); setOpen(true); }
      } catch {
        if (!ac.signal.aborted) setRemoteResults([]);
      } finally {
        if (!ac.signal.aborted) setSearching(false);
      }
    }, searchDebounceMs);

    return () => { clearTimeout(timer); abortRef.current?.abort(); };
  }, [inputText, onSearch, searchDebounceMs]);

  // ── Options visibles ───────────────────────────────────────────────────────
  const allOptions = onSearch ? remoteResults : (localOptions ?? []);
  const displayOptions = showAll ? allOptions : (onSearch ? remoteResults : filteredLocal);

  // ── Saisie libre détectée ──────────────────────────────────────────────────
  const isUnmatched = allowFreeText
    && inputText.trim().length > 0
    && !allOptions.some(o => o.label === inputText || o.value === inputText);

  // ── Sélection d'une option ─────────────────────────────────────────────────
  const pick = useCallback((opt: ComboboxOption) => {
    skipSearchRef.current = true;
    setInputText(opt.label);
    onChange(opt.value);
    setOpen(false);
    setShowAll(false);
    setHighlightIdx(-1);
  }, [onChange]);

  // ── Blur → fermer + commit ─────────────────────────────────────────────────
  const handleBlur = useCallback(() => {
    // Petit délai pour laisser le onMouseDown du dropdown s'exécuter
    setTimeout(() => {
      // Si le focus est toujours dans le wrapper, ne rien faire
      if (wrapperRef.current?.contains(document.activeElement)) return;
      setOpen(false);
      setShowAll(false);
      if (!allowFreeText) {
        const match = allOptions.find(o => o.label.toLowerCase() === inputText.toLowerCase());
        if (match) { setInputText(match.label); onChange(match.value); }
        else if (value) setInputText(value);
      } else {
        onChange(inputText.trim());
      }
    }, 150);
  }, [allowFreeText, inputText, value, onChange, allOptions]);

  return (
    <div className={cn('flex flex-col gap-1', className)} ref={wrapperRef}>
      {label && (
        <label htmlFor={id} className={labelClassName ?? 'text-sm font-medium text-slate-700 dark:text-slate-300'}>
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
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setInputText(e.target.value);
            setHighlightIdx(-1);
            setShowAll(false);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            if (localOptions && localOptions.length > 0) { setShowAll(true); setOpen(true); }
          }}
          onBlur={handleBlur}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              setShowAll(true); setOpen(true); return;
            }
            if (!open) return;
            switch (e.key) {
              case 'ArrowDown': e.preventDefault(); setHighlightIdx(prev => Math.min(prev + 1, displayOptions.length - 1)); break;
              case 'ArrowUp':   e.preventDefault(); setHighlightIdx(prev => Math.max(prev - 1, 0)); break;
              case 'Enter':     e.preventDefault(); if (highlightIdx >= 0 && highlightIdx < displayOptions.length) pick(displayOptions[highlightIdx]); break;
              case 'Escape':    setOpen(false); setShowAll(false); setHighlightIdx(-1); break;
            }
          }}
          className={cn(inputClassName ?? inp, 'pr-9')}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-listbox`}
          autoComplete="off"
        />

        <button
          type="button"
          tabIndex={-1}
          onMouseDown={e => e.preventDefault()}
          onClick={() => {
            if (disabled) return;
            if (open) { setOpen(false); setShowAll(false); }
            else { setShowAll(true); setOpen(true); inputRef.current?.focus(); }
          }}
          disabled={disabled}
          className="absolute right-0 top-0 h-full px-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          aria-label="Ouvrir la liste"
        >
          {searching
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <ChevronDown className={cn('w-4 h-4 transition-transform', open && 'rotate-180')} />
          }
        </button>

        {/* Dropdown — absolute, dans le flux DOM (pas de portal) */}
        {open && displayOptions.length > 0 && (
          <ul
            id={`${id}-listbox`}
            role="listbox"
            className="absolute z-[100] mt-1 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl max-h-60 overflow-auto"
          >
            {displayOptions.map((opt, i) => (
              <li key={`${opt.value}-${i}`} id={`${id}-opt-${i}`} role="option" aria-selected={highlightIdx === i}>
                <button
                  type="button"
                  onMouseDown={e => { e.preventDefault(); pick(opt); }}
                  onMouseEnter={() => setHighlightIdx(i)}
                  className={cn(
                    'w-full text-left px-3 py-2 text-sm flex flex-col transition-colors',
                    highlightIdx === i
                      ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-900 dark:text-teal-100'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800',
                  )}
                >
                  <span className={cn('truncate', opt.bold && 'font-semibold')}>{opt.label}</span>
                  {opt.hint && (
                    <span className="text-[11px] text-slate-400 truncate">
                      {opt.flag && <>{opt.flag} </>}{opt.hint}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Alerte saisie libre */}
      {isUnmatched && freeTextWarning && !open && (
        <div className="flex items-start gap-1.5 mt-1">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 dark:text-amber-300">{freeTextWarning}</p>
        </div>
      )}
    </div>
  );
}
