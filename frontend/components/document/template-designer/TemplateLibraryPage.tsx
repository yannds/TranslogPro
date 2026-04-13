/**
 * TemplateLibraryPage — Page de gestion des templates d'impression du tenant
 *
 * Deux vues :
 *   1. "Bibliothèque" — templates système (bases de départ) + templates tenant
 *   2. "Designer" — éditeur pdfme plein écran pour un template donné
 *
 * Actions disponibles :
 *   - Dupliquer un template système → crée une copie personnalisable pour le tenant
 *   - Éditer un template tenant → ouvre le Designer
 *   - Supprimer un template tenant (soft delete)
 *
 * GET /tenants/:tenantId/templates/system  → templates système
 * GET /tenants/:tenantId/templates         → templates tenant
 * POST /tenants/:tenantId/templates/:id/duplicate
 * DELETE /tenants/:tenantId/templates/:id
 */
import { useState, useEffect, useCallback } from 'react';
import { TemplateDesigner } from './TemplateDesigner';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DocTemplate {
  id:         string;
  name:       string;
  slug:       string;
  docType:    string;
  format:     string;
  engine:     string;
  version:    number;
  isSystem:   boolean;
  isActive:   boolean;
  createdAt:  string;
}

interface TemplateLibraryPageProps {
  tenantId: string;
  apiBase?: string;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  TICKET:       'Billet de voyage',
  INVOICE:      'Facture',
  LABEL:        'Étiquette / Talon',
  MANIFEST:     'Manifeste',
  PACKING_LIST: 'Bordereau',
};

const FORMAT_LABELS: Record<string, string> = {
  A4:           'A4',
  A5:           'A5',
  THERMAL_80MM: 'Thermique 80mm',
  LABEL_62MM:   'Label 62mm / A6',
  BAGGAGE_TAG:  '99×210mm (Bagage)',
  ENVELOPE_C5:  'Enveloppe C5',
  ENVELOPE_DL:  'Enveloppe DL',
};

// ─── Composant ────────────────────────────────────────────────────────────────

export function TemplateLibraryPage({ tenantId, apiBase = '/api' }: TemplateLibraryPageProps) {
  const [systemTemplates, setSystemTemplates] = useState<DocTemplate[]>([]);
  const [tenantTemplates, setTenantTemplates] = useState<DocTemplate[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<DocTemplate | null>(null);
  const [duplicating,     setDuplicating]     = useState<string | null>(null);
  const [filterDocType,   setFilterDocType]   = useState<string>('');

  // ─── Chargement ─────────────────────────────────────────────────────────

  const loadTemplates = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [sysRes, tenantRes] = await Promise.all([
        fetch(`${apiBase}/tenants/${tenantId}/templates/system`, { credentials: 'include' }),
        fetch(`${apiBase}/tenants/${tenantId}/templates`, { credentials: 'include' }),
      ]);

      if (!sysRes.ok || !tenantRes.ok) throw new Error('Erreur de chargement des templates');

      setSystemTemplates(await sysRes.json());
      setTenantTemplates(await tenantRes.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [tenantId, apiBase]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  // ─── Actions ─────────────────────────────────────────────────────────────

  const handleDuplicate = async (template: DocTemplate) => {
    const name = window.prompt(
      `Nom pour votre copie de "${template.name}" :`,
      `${template.name} — Personnalisé`,
    );
    if (!name) return;

    try {
      setDuplicating(template.id);
      const res = await fetch(
        `${apiBase}/tenants/${tenantId}/templates/${template.id}/duplicate`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ name }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const copy = await res.json();
      await loadTemplates();
      // Ouvrir directement le designer sur la copie
      setEditingTemplate(copy);
    } catch (e: any) {
      alert(`Erreur lors de la duplication : ${e.message}`);
    } finally {
      setDuplicating(null);
    }
  };

  const handleDelete = async (template: DocTemplate) => {
    if (!window.confirm(`Supprimer le template "${template.name}" ?`)) return;

    try {
      const res = await fetch(
        `${apiBase}/tenants/${tenantId}/templates/${template.id}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadTemplates();
    } catch (e: any) {
      alert(`Erreur lors de la suppression : ${e.message}`);
    }
  };

  // ─── Vue Designer ─────────────────────────────────────────────────────────

  if (editingTemplate) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <TemplateDesigner
          tenantId={tenantId}
          templateId={editingTemplate.id}
          templateName={editingTemplate.name}
          docType={editingTemplate.docType as any}
          apiBase={apiBase}
          onClose={() => { setEditingTemplate(null); loadTemplates(); }}
          onSaved={() => loadTemplates()}
        />
      </div>
    );
  }

  // ─── Vue Bibliothèque ─────────────────────────────────────────────────────

  const filteredSystem = filterDocType
    ? systemTemplates.filter(t => t.docType === filterDocType)
    : systemTemplates;
  const filteredTenant = filterDocType
    ? tenantTemplates.filter(t => t.docType === filterDocType)
    : tenantTemplates;

  return (
    <div style={{ padding: '24px', maxWidth: '1100px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#1a3a5c', margin: 0 }}>
          Templates d'impression
        </h1>
        <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
          Personnalisez vos modèles de factures, billets et étiquettes.
          Dupliquez un modèle de base puis modifiez les zones et variables selon vos besoins.
        </p>
      </div>

      {/* Filtre */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {['', 'TICKET', 'INVOICE', 'LABEL', 'MANIFEST', 'PACKING_LIST'].map(dt => (
          <button
            key={dt || 'all'}
            onClick={() => setFilterDocType(dt)}
            style={{
              padding: '5px 12px',
              fontSize: '12px',
              border: `1px solid ${filterDocType === dt ? '#1a3a5c' : '#d1d5db'}`,
              borderRadius: '20px',
              background: filterDocType === dt ? '#1a3a5c' : '#fff',
              color: filterDocType === dt ? '#fff' : '#374151',
              cursor: 'pointer',
            }}
          >
            {dt ? DOC_TYPE_LABELS[dt] : 'Tous'}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ padding: '12px', background: '#fef2f2', color: '#dc2626', borderRadius: '6px', marginBottom: '16px', fontSize: '13px' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: '#9ca3af', fontSize: '14px' }}>Chargement…</div>
      ) : (
        <>
          {/* Templates tenant (personnalisés) */}
          {filteredTenant.length > 0 && (
            <section style={{ marginBottom: '32px' }}>
              <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#1a3a5c', marginBottom: '12px' }}>
                Vos templates personnalisés
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                {filteredTenant.map(t => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    isOwned
                    onEdit={() => setEditingTemplate(t)}
                    onDelete={() => handleDelete(t)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Templates système */}
          <section>
            <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#374151', marginBottom: '12px' }}>
              Modèles de base (système)
            </h2>
            <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '12px' }}>
              Ces modèles sont fournis par TranslogPro. Dupliquez-en un pour créer votre propre version personnalisable.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
              {filteredSystem.map(t => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  isOwned={false}
                  onDuplicate={() => handleDuplicate(t)}
                  duplicating={duplicating === t.id}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// ─── TemplateCard ─────────────────────────────────────────────────────────────

interface TemplateCardProps {
  template:    DocTemplate;
  isOwned:     boolean;
  onEdit?:     () => void;
  onDelete?:   () => void;
  onDuplicate?:() => void;
  duplicating?:boolean;
}

function TemplateCard({
  template, isOwned, onEdit, onDelete, onDuplicate, duplicating,
}: TemplateCardProps) {
  const engineColor = template.engine === 'PDFME' ? '#7c3aed' : '#2563eb';
  const engineLabel = template.engine === 'PDFME' ? 'Designer' : template.engine;

  return (
    <div
      style={{
        border: `1px solid ${isOwned ? '#c7d2fe' : '#e5e7eb'}`,
        borderRadius: '8px',
        background: isOwned ? '#f5f3ff' : '#fff',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      {/* Badges */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: '10px', fontWeight: 700,
            padding: '2px 7px', borderRadius: '3px',
            background: '#dbeafe', color: '#1d4ed8',
          }}
        >
          {DOC_TYPE_LABELS[template.docType] ?? template.docType}
        </span>
        <span
          style={{
            fontSize: '10px', fontWeight: 700,
            padding: '2px 7px', borderRadius: '3px',
            background: '#f3f4f6', color: '#374151',
          }}
        >
          {FORMAT_LABELS[template.format] ?? template.format}
        </span>
        <span
          style={{
            fontSize: '10px', fontWeight: 700,
            padding: '2px 7px', borderRadius: '3px',
            background: `${engineColor}18`, color: engineColor,
          }}
        >
          {engineLabel}
        </span>
      </div>

      {/* Title */}
      <div>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#111827' }}>
          {template.name}
        </div>
        <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
          {template.slug}  {isOwned ? `• v${template.version}` : '• Système'}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
        {isOwned && template.engine === 'PDFME' && onEdit && (
          <button
            onClick={onEdit}
            style={{
              flex: 1,
              padding: '6px',
              fontSize: '12px',
              background: '#1a3a5c',
              color: '#fff',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            ✏ Éditer
          </button>
        )}
        {isOwned && onDelete && (
          <button
            onClick={onDelete}
            style={{
              padding: '6px 10px',
              fontSize: '12px',
              background: '#fff',
              color: '#dc2626',
              border: '1px solid #fca5a5',
              borderRadius: '5px',
              cursor: 'pointer',
            }}
          >
            Supprimer
          </button>
        )}
        {!isOwned && onDuplicate && (
          <button
            onClick={onDuplicate}
            disabled={duplicating}
            style={{
              flex: 1,
              padding: '6px',
              fontSize: '12px',
              background: duplicating ? '#e5e7eb' : '#f3f4f6',
              color: duplicating ? '#9ca3af' : '#374151',
              border: '1px solid #d1d5db',
              borderRadius: '5px',
              cursor: duplicating ? 'not-allowed' : 'pointer',
              fontWeight: 600,
            }}
          >
            {duplicating ? 'Copie en cours…' : '⊕ Dupliquer & personnaliser'}
          </button>
        )}
      </div>
    </div>
  );
}
