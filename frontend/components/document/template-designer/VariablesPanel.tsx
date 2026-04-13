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
        borderLeft: '1px solid #e5e7eb',
        background: '#f9fafb',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 14px 8px',
          borderBottom: '1px solid #e5e7eb',
          background: '#fff',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a3a5c', marginBottom: '8px' }}>
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
            border: '1px solid #d1d5db',
            borderRadius: '5px',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '5px' }}>
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
                background: `${CATEGORY_COLORS[cat as VariableCategory]}14`,
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
                  background: copied === v.key ? '#dcfce7' : '#fff',
                  border: `1px solid ${copied === v.key ? '#86efac' : '#e5e7eb'}`,
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
                      color: '#111827',
                      fontFamily: 'monospace',
                    }}
                  >
                    {v.placeholder}
                  </div>
                  <div style={{ fontSize: '10px', color: '#6b7280' }}>{v.label}</div>
                </div>
                {copied === v.key && (
                  <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 700 }}>
                    ✓ Copié
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}

        {Object.keys(grouped).length === 0 && (
          <div style={{ fontSize: '12px', color: '#9ca3af', textAlign: 'center', marginTop: '20px' }}>
            Aucune variable ne correspond à "{search}"
          </div>
        )}
      </div>
    </div>
  );
}
