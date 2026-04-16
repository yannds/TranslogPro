/**
 * TemplateDesigner — Éditeur visuel publipostage pour les templates pdfme
 *
 * Intègre @pdfme/ui Designer pour le canvas drag-and-drop.
 * Panneau latéral droit = liste des variables disponibles par catégorie.
 *
 * Flow :
 *   1. GET /tenants/:tenantId/templates/:id/schema  → charge schemaJson
 *   2. Tenant édite les zones, déplace, recolore, insère {{variable}} dans les champs texte
 *   3. PUT /tenants/:tenantId/templates/:id/schema  → sauvegarde le JSON résultant
 *
 * Notes :
 *   - Le Designer pdfme gère la sélection, le redimensionnement et la gestion des pages
 *   - Les champs de type `text` acceptent les placeholders {{variable}}
 *   - Les champs `qrcode` aussi : leur content {{qrCodeValue}} est résolu à l'impression
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { Designer }         from '@pdfme/ui';
import { text, image, barcodes, rectangle, line, ellipse, table } from '@pdfme/schemas';
import type { Template }    from '@pdfme/common';
import { VariablesPanel }   from './VariablesPanel';
import type { VariablesPanelProps } from './VariablesPanel';
import { useTheme } from '../../theme/ThemeProvider';
import { useI18n } from '../../../lib/i18n/useI18n';

const lightPalette = {
  surface:       '#fff',
  surfaceMuted:  '#f9fafb',
  surfaceDanger: '#fef2f2',
  surfaceOk:     '#f0fdf4',
  border:        '#e5e7eb',
  borderStrong:  '#d1d5db',
  textHeading:   '#1a3a5c',
  textBody:      '#374151',
  textMuted:     '#6b7280',
  textDanger:    '#dc2626',
  textOk:        '#16a34a',
  primary:       '#1a3a5c',
  primaryMuted:  '#93c5fd',
  primaryOnDark: '#fff',
};
const darkPalette: typeof lightPalette = {
  surface:       '#1e293b',
  surfaceMuted:  '#0f172a',
  surfaceDanger: '#450a0a',
  surfaceOk:     '#052e16',
  border:        '#334155',
  borderStrong:  '#475569',
  textHeading:   '#e2e8f0',
  textBody:      '#cbd5e1',
  textMuted:     '#94a3b8',
  textDanger:    '#f87171',
  textOk:        '#86efac',
  primary:       '#3b82f6',
  primaryMuted:  '#1e3a8a',
  primaryOnDark: '#fff',
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TemplateDesignerProps {
  tenantId:    string;
  templateId:  string;
  templateName: string;
  docType?:    VariablesPanelProps['docType'];
  /** Appelé quand le template est sauvegardé avec succès */
  onSaved?:   (newTemplateId: string) => void;
  /** Appelé pour fermer le designer */
  onClose?:   () => void;
  /** Base URL de l'API (sans trailing slash) */
  apiBase?:   string;
}

// ─── Plugins pdfme déclarés une seule fois ───────────────────────────────────

const PLUGINS = {
  text,
  image,
  qrcode: barcodes.qrcode,
  rectangle,
  line,
  ellipse,
  table,
};

// ─── Composant ────────────────────────────────────────────────────────────────

export function TemplateDesigner({
  tenantId,
  templateId,
  templateName,
  docType,
  onSaved,
  onClose,
  apiBase = '/api',
}: TemplateDesignerProps) {
  const { theme } = useTheme();
  const p = theme === 'dark' ? darkPalette : lightPalette;
  const containerRef  = useRef<HTMLDivElement>(null);
  const designerRef   = useRef<Designer | null>(null);

  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [saved,    setSaved]    = useState(false);
  const [template, setTemplate] = useState<Template | null>(null);

  // ─── Chargement du schéma ─────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(
          `${apiBase}/tenants/${tenantId}/templates/${templateId}/schema`,
          { credentials: 'include' },
        );

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const { schemaJson } = await res.json();
        if (!cancelled) setTemplate(schemaJson as Template);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [tenantId, templateId, apiBase]);

  // ─── Initialisation du Designer pdfme ────────────────────────────────────

  useEffect(() => {
    if (!template || !containerRef.current) return;

    // Détruire l'instance précédente si elle existe
    if (designerRef.current) {
      designerRef.current.destroy();
      designerRef.current = null;
    }

    const designer = new Designer({
      domContainer: containerRef.current,
      template,
      plugins: PLUGINS,
      options: {
        font: {
          NotoSans: {
            fallback: true,
            data: 'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff',
          },
          'NotoSans-Bold': {
            data: 'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff',
          },
        },
      },
    });

    designerRef.current = designer;

    return () => {
      designer.destroy();
      designerRef.current = null;
    };
  }, [template]);

  // ─── Sauvegarde ───────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!designerRef.current) return;

    const currentTemplate = designerRef.current.getTemplate();

    try {
      setSaving(true);
      setError(null);
      setSaved(false);

      const res = await fetch(
        `${apiBase}/tenants/${tenantId}/templates/${templateId}/schema`,
        {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ schemaJson: currentTemplate }),
        },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }

      const saved = await res.json();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      onSaved?.(saved.id);
    } catch (e: any) {
      setError(`Erreur de sauvegarde : ${e.message}`);
    } finally {
      setSaving(false);
    }
  }, [tenantId, templateId, apiBase, onSaved]);

  // ─── Rendu ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '400px', background: p.surface }}>
        <span style={{ color: p.textMuted, fontSize: '14px' }}>Chargement du template…</span>
      </div>
    );
  }

  if (error && !template) {
    return (
      <div style={{ padding: '24px', color: p.textDanger, fontSize: '14px', background: p.surface }}>
        Impossible de charger le template : {error}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: p.surface }}>

      {/* ── Barre d'outils ────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '10px 16px',
          borderBottom: `1px solid ${p.border}`,
          background: p.surfaceMuted,
          flexShrink: 0,
        }}
      >
        {/* Titre */}
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: '14px', fontWeight: 700, color: p.textHeading }}>
            Éditeur de template
          </span>
          <span style={{ fontSize: '12px', color: p.textMuted, marginLeft: '8px' }}>
            {templateName}
          </span>
        </div>

        {/* Indicateurs */}
        {error && (
          <span style={{ fontSize: '12px', color: p.textDanger, background: p.surfaceDanger, padding: '3px 8px', borderRadius: '4px' }}>
            ⚠ {error}
          </span>
        )}
        {saved && (
          <span style={{ fontSize: '12px', color: p.textOk, background: p.surfaceOk, padding: '3px 8px', borderRadius: '4px' }}>
            ✓ Sauvegardé
          </span>
        )}

        {/* Boutons */}
        {onClose && (
          <button
            onClick={onClose}
            style={{
              padding: '6px 14px',
              fontSize: '12px',
              border: `1px solid ${p.borderStrong}`,
              borderRadius: '5px',
              background: p.surface,
              cursor: 'pointer',
              color: p.textBody,
            }}
          >
            Fermer
          </button>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '6px 16px',
            fontSize: '12px',
            border: 'none',
            borderRadius: '5px',
            background: saving ? p.primaryMuted : p.primary,
            color: p.primaryOnDark,
            cursor: saving ? 'not-allowed' : 'pointer',
            fontWeight: 600,
          }}
        >
          {saving ? 'Enregistrement…' : 'Enregistrer le template'}
        </button>
      </div>

      {/* ── Corps : canvas Designer + panneau variables ───────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Canvas pdfme Designer */}
        <div
          ref={containerRef}
          style={{ flex: 1, overflow: 'hidden', position: 'relative' }}
        />

        {/* Panneau variables */}
        <VariablesPanel docType={docType} />
      </div>

    </div>
  );
}
