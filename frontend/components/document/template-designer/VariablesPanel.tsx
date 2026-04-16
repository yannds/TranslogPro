/**
 * VariablesPanel — Panneau latéral "Variables disponibles" du Template Designer
 *
 * Affiche toutes les variables groupées par catégorie.
 * Clic sur une variable → copie le placeholder {{key}} dans le presse-papier.
 * Un toast confirme la copie.
 */
import { useState, useMemo } from 'react';
import {
  TEMPLATE_VARIABLES,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  groupByCategory,
  type VariableCategory,
  type TemplateVariable,
} from './variables';
import { useTheme } from '../../theme/ThemeProvider';

const lightPalette = {
  surface:        '#fff',
  surfaceMuted:   '#f9fafb',
  surfaceCopied:  '#dcfce7',
  border:         '#e5e7eb',
  borderStrong:   '#d1d5db',
  borderCopied:   '#86efac',
  textPrimary:    '#111827',
  textHeading:    '#1a3a5c',
  textMuted:      '#6b7280',
  textFaint:      '#9ca3af',
  textOk:         '#16a34a',
};
const darkPalette: typeof lightPalette = {
  surface:        '#1e293b',
  surfaceMuted:   '#0f172a',
  surfaceCopied:  '#052e16',
  border:         '#334155',
  borderStrong:   '#475569',
  borderCopied:   '#166534',
  textPrimary:    '#f1f5f9',
  textHeading:    '#e2e8f0',
  textMuted:      '#94a3b8',
  textFaint:      '#64748b',
  textOk:         '#86efac',
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface VariablesPanelProps {
  /** Filtre optionnel : n'afficher que les variables de ces catégories */
  docType?: 'TICKET' | 'INVOICE' | 'LABEL' | 'MANIFEST' | 'PACKING_LIST';
  /** Callback appelé quand une variable est sélectionnée (alternative au clipboard) */
  onSelect?: (variable: TemplateVariable) => void;
}

// ─── Catégories pertinentes par type de document ─────────────────────────────

const DOC_TYPE_CATEGORIES: Record<string, VariableCategory[]> = {
  TICKET:       ['tenant', 'ticket', 'trip', 'system'],
  INVOICE:      ['tenant', 'ticket', 'invoice', 'trip', 'system'],
  LABEL:        ['tenant', 'parcel', 'trip', 'system'],
  MANIFEST:     ['tenant', 'trip', 'system'],
  PACKING_LIST: ['tenant', 'parcel', 'system'],
};

// ─── Composant ────────────────────────────────────────────────────────────────

export function VariablesPanel({ docType, onSelect }: VariablesPanelProps) {
  const { theme } = useTheme();
  const p = theme === 'dark' ? darkPalette : lightPalette;
  const isDark = theme === 'dark';
  const [copied, setCopied] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const relevantCategories = docType ? DOC_TYPE_CATEGORIES[docType] : undefined;

  const filtered = useMemo(() => {
    let vars = TEMPLATE_VARIABLES;
    if (relevantCategories) {
      vars = vars.filter(v => relevantCategories.includes(v.category));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      vars = vars.filter(
        v =>
          v.key.toLowerCase().includes(q) ||
          v.label.toLowerCase().includes(q) ||
          v.example.toLowerCase().includes(q),
      );
    }
    return vars;
  }, [relevantCategories, search]);

  const grouped = useMemo(() => groupByCategory(filtered), [filtered]);

  const handleCopy = async (variable: TemplateVariable) => {
    try {
      await navigator.clipboard.writeText(variable.placeholder);
      setCopied(variable.key);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // Fallback : sélectionner le texte
    }
    onSelect?.(variable);
  };

  return (
    <div
      style={{
        width: '260px',
        height: '100%',
        overflowY: 'auto',
        borderLeft: `1px solid ${p.border}`,
        background: p.surfaceMuted,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 14px 8px',
          borderBottom: `1px solid ${p.border}`,
          background: p.surface,
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ fontSize: '13px', fontWeight: 700, color: p.textHeading, marginBottom: '8px' }}>
          Variables disponibles
        </div>
        <input
          type="search"
          placeholder="Rechercher une variable…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '5px 8px',
            fontSize: '12px',
            border: `1px solid ${p.borderStrong}`,
            borderRadius: '5px',
            outline: 'none',
            boxSizing: 'border-box',
            background: p.surface,
            color: p.textPrimary,
          }}
        />
        <div style={{ fontSize: '10px', color: p.textFaint, marginTop: '5px' }}>
          Clic → copie <code>{'{{variable}}'}</code> dans le presse-papier
        </div>
      </div>

      {/* Variable groups */}
      <div style={{ padding: '8px', flex: 1 }}>
        {Object.entries(grouped).map(([cat, vars]) => (
          <div key={cat} style={{ marginBottom: '12px' }}>
            {/* Category header */}
            <div
              style={{
                fontSize: '10px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: CATEGORY_COLORS[cat as VariableCategory],
                padding: '4px 6px',
                marginBottom: '4px',
                borderRadius: '3px',
                background: `${CATEGORY_COLORS[cat as VariableCategory]}${isDark ? '33' : '14'}`,
              }}
            >
              {CATEGORY_LABELS[cat as VariableCategory]}
            </div>

            {/* Variable chips */}
            {vars.map(v => (
              <button
                key={v.key}
                onClick={() => handleCopy(v)}
                title={`Copier ${v.placeholder}\nEx: ${v.example}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '5px 8px',
                  marginBottom: '2px',
                  background: copied === v.key ? p.surfaceCopied : p.surface,
                  border: `1px solid ${copied === v.key ? p.borderCopied : p.border}`,
                  borderRadius: '4px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.2s',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color: p.textPrimary,
                      fontFamily: 'monospace',
                    }}
                  >
                    {v.placeholder}
                  </div>
                  <div style={{ fontSize: '10px', color: p.textMuted }}>{v.label}</div>
                </div>
                {copied === v.key && (
                  <span style={{ fontSize: '10px', color: p.textOk, fontWeight: 700 }}>
                    ✓ Copié
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}

        {Object.keys(grouped).length === 0 && (
          <div style={{ fontSize: '12px', color: p.textFaint, textAlign: 'center', marginTop: '20px' }}>
            Aucune variable ne correspond à "{search}"
          </div>
        )}
      </div>
    </div>
  );
}
