/**
 * ComboboxEditable — Combobox éditable réutilisable
 *
 * Deux modes :
 *   - Local  : `options` passées en props, filtrage côté client
 *   - Remote : `onSearch(q)` async, résultats depuis le serveur (ex. Nominatim)
 *
 * Props clés :
 *   allowFreeText  : true  → l'utilisateur peut saisir un texte non listé
 *                    false → choix contraint à la liste
 *   freeTextWarning: message affiché si allowFreeText=true et la saisie ne matche rien
 *
 * UX :
 *   - Chaque frappe filtre/recherche la liste
 *   - Le chevron ouvre/ferme le dropdown complet
 *   - Portail pour échapper aux overflow:hidden des modales
 */
import {
  useState, useRef, useEffect, useCallback, useId, useMemo,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { inputClass as inp } from './inputClass';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Sous-texte optionnel (ex. pays, région) */
  hint?: string;
}

export interface ComboboxEditableProps {
  /** Valeur contrôlée (la string affichée / sélectionnée) */
  value: string;
  onChange: (value: string) => void;

  /** Mode local : options pré-chargées */
  options?: ComboboxOption[];

  /** Mode remote : callback de recherche async */
  onSearch?: (query: string) => Promise<ComboboxOption[]>;
  /** Debounce pour le mode remote (ms) */
  searchDebounceMs?: number;

  /** Autoriser la saisie libre (valeur non listée) */
  allowFreeText?: boolean;
  /** Message d'alerte non bloquant quand la saisie ne matche rien */
  freeTextWarning?: string;

  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  label?: string;
  className?: string;
  /** Surcharge les classes CSS de l'input (par défaut : inputClass du projet) */
  inputClassName?: string;
  /** Surcharge les classes CSS du label */
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
  const listRef = useRef<HTMLUListElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [inputText, setInputText] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [remoteResults, setRemoteResults] = useState<ComboboxOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Sync external value → inputText
  useEffect(() => { setInputText(value); }, [value]);

  // ── Position du dropdown (portal fixed) ────────────────────────────────────
  const updatePos = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, []);

  // ── Filtrage local ─────────────────────────────────────────────────────────
  const filteredLocal = useMemo(() => {
    if (!localOptions) return [];
    const q = inputText.toLowerCase().trim();
    if (!q) return localOptions;
    return localOptions.filter(o =>
      o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [localOptions, inputText]);

  // ── Recherche remote (debounced) ───────────────────────────────────────────
  useEffect(() => {
    if (!onSearch) return;
    const q = inputText.trim();
    if (q.length < 2) {
      setRemoteResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setSearching(true);
      try {
        const results = await onSearch(q);
        if (!ac.signal.aborted) {
          setRemoteResults(results);
          updatePos();
          setOpen(true);
        }
      } catch {
        if (!ac.signal.aborted) setRemoteResults([]);
      } finally {
        if (!ac.signal.aborted) setSearching(false);
      }
    }, searchDebounceMs);

    return () => { clearTimeout(timer); abortRef.current?.abort(); };
  }, [inputText, onSearch, searchDebounceMs, updatePos]);

  // ── Options visibles ───────────────────────────────────────────────────────
  const visibleOptions = onSearch ? remoteResults : filteredLocal;

  // ── Saisie libre détectée ──────────────────────────────────────────────────
  const isUnmatched = allowFreeText
    && inputText.trim().length > 0
    && !visibleOptions.some(o => o.label === inputText || o.value === inputText);

  // ── Sélection d'une option ─────────────────────────────────────────────────
  const pick = useCallback((opt: ComboboxOption) => {
    setInputText(opt.label);
    onChange(opt.value);
    setOpen(false);
    setHighlightIdx(-1);
  }, [onChange]);

  // ── Blur : valider la saisie ───────────────────────────────────────────────
  const handleBlur = useCallback(() => {
    setTimeout(() => {
      setOpen(false);
      if (!allowFreeText) {
        // Contraindre à une option existante
        const match = (onSearch ? remoteResults : localOptions ?? [])
          .find(o => o.label.toLowerCase() === inputText.toLowerCase());
        if (match) {
          setInputText(match.label);
          onChange(match.value);
        } else if (inputText.trim() && value) {
          // Remettre la dernière valeur valide
          setInputText(value);
        }
      } else {
        // Free text : accepter tel quel
        onChange(inputText.trim());
      }
    }, 200);
  }, [allowFreeText, inputText, value, onChange, localOptions, remoteResults, onSearch]);

  // ── Clavier ────────────────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      updatePos();
      setOpen(true);
      return;
    }
    if (!open) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIdx(prev => Math.min(prev + 1, visibleOptions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIdx(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightIdx >= 0 && highlightIdx < visibleOptions.length) {
          pick(visibleOptions[highlightIdx]);
        }
        break;
      case 'Escape':
        setOpen(false);
        setHighlightIdx(-1);
        break;
    }
  }, [open, highlightIdx, visibleOptions, pick, updatePos]);

  // ── Scroll l'élément highlighté en vue ─────────────────────────────────────
  useEffect(() => {
    if (highlightIdx < 0 || !listRef.current) return;
    const el = listRef.current.children[highlightIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx]);

  // ── Clic chevron → ouvrir/fermer avec toutes les options ───────────────────
  const toggleDropdown = useCallback(() => {
    if (disabled) return;
    if (open) {
      setOpen(false);
    } else {
      updatePos();
      setOpen(true);
      inputRef.current?.focus();
    }
  }, [disabled, open, updatePos]);

  // ── Fermer si clic extérieur ───────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current?.contains(e.target as Node)) return;
      // Vérifier aussi le portal dropdown
      if (listRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // ── Dropdown complet (local) quand on clique le chevron sans texte ─────────
  const allOptions = onSearch
    ? remoteResults
    : (localOptions ?? []);

  const displayOptions = open && !inputText.trim() && !onSearch
    ? allOptions
    : visibleOptions;

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
          onChange={e => {
            setInputText(e.target.value);
            setHighlightIdx(-1);
            if (!open) { updatePos(); setOpen(true); }
          }}
          onFocus={() => {
            updatePos();
            if (localOptions && localOptions.length > 0) setOpen(true);
          }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className={cn(inputClassName ?? inp, 'pr-9')}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-listbox`}
          aria-activedescendant={highlightIdx >= 0 ? `${id}-opt-${highlightIdx}` : undefined}
          autoComplete="off"
        />

        {/* Icône droite : loader ou chevron */}
        <button
          type="button"
          tabIndex={-1}
          onClick={toggleDropdown}
          disabled={disabled}
          className="absolute right-0 top-0 h-full px-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          aria-label="Ouvrir la liste"
        >
          {searching
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <ChevronDown className={cn('w-4 h-4 transition-transform', open && 'rotate-180')} />
          }
        </button>
      </div>

      {/* Alerte saisie libre */}
      {isUnmatched && freeTextWarning && !open && (
        <div className="flex items-start gap-1.5 mt-1">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 dark:text-amber-300">{freeTextWarning}</p>
        </div>
      )}

      {/* Dropdown portal */}
      {open && displayOptions.length > 0 && dropdownPos && createPortal(
        <ul
          ref={listRef}
          id={`${id}-listbox`}
          role="listbox"
          style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
          className="z-[100] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl max-h-60 overflow-auto"
        >
          {displayOptions.map((opt, i) => (
            <li
              key={`${opt.value}-${i}`}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={highlightIdx === i}
            >
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
                <span className="truncate">{opt.label}</span>
                {opt.hint && (
                  <span className="text-[11px] text-slate-400 truncate">{opt.hint}</span>
                )}
              </button>
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}
